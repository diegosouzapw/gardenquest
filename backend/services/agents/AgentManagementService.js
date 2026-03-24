const crypto = require('crypto');

class AgentManagementService {
  constructor({ agentRepository, secretVault, logger = console } = {}) {
    this.agentRepository = agentRepository;
    this.secretVault = secretVault;
    this.logger = logger;
  }

  async listAgents({ ownerUserId }) {
    return this.agentRepository.listAgentsByOwner(ownerUserId);
  }

  async createAgent({ ownerUserId, body }) {
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 64) : '';
    const mode = typeof body?.mode === 'string' ? body.mode.trim() : 'hosted_api_key';
    const provider = typeof body?.provider === 'string' ? body.provider.trim().toLowerCase() : 'openai';
    const routeHint = typeof body?.routeHint === 'string' ? body.routeHint.trim().slice(0, 64) : null;
    const policyJson = body?.policy && typeof body.policy === 'object' ? body.policy : {};

    if (!name) {
      const error = new Error('Agent name is required');
      error.statusCode = 400;
      throw error;
    }

    const id = `agt_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    return this.agentRepository.createAgent({
      id,
      ownerUserId,
      name,
      mode,
      provider,
      routeHint,
      policyJson,
    });
  }

  async storeApiKey({ ownerUserId, agentId, apiKey }) {
    if (!this.secretVault) {
      const error = new Error('Hosted API key mode is disabled until AGENT_SECRET_MASTER_KEY_HEX is configured');
      error.statusCode = 503;
      throw error;
    }

    const agent = await this.agentRepository.getAgentByIdForOwner(agentId, ownerUserId);
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      throw error;
    }

    if (agent.mode !== 'hosted_api_key') {
      const error = new Error('Agent is not configured for hosted API key mode');
      error.statusCode = 400;
      throw error;
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length < 20) {
      const error = new Error('Invalid API key');
      error.statusCode = 400;
      throw error;
    }

    const result = await this.secretVault.storeAgentSecret(agentId, apiKey.trim());
    return {
      ok: true,
      agentId,
      fingerprint: result.fingerprint,
    };
  }

  async configureEndpoint({ ownerUserId, agentId, endpoint }) {
    const agent = await this.agentRepository.getAgentByIdForOwner(agentId, ownerUserId);
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      throw error;
    }

    const baseUrl = typeof endpoint?.baseUrl === 'string' ? endpoint.baseUrl.trim() : '';
    if (!baseUrl) {
      const error = new Error('baseUrl is required');
      error.statusCode = 400;
      throw error;
    }

    try {
      const parsed = new URL(baseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (parseError) {
      const error = new Error('baseUrl must be a valid absolute URL');
      error.statusCode = 400;
      throw error;
    }

    await this.agentRepository.saveAgentEndpoint({
      agentId,
      baseUrl,
      authMode: endpoint?.authMode === 'bearer' ? 'bearer' : 'none',
      authSecret: typeof endpoint?.authSecret === 'string' ? endpoint.authSecret.trim() : null,
      timeoutMs: endpoint?.timeoutMs,
    });

    return {
      ok: true,
      agentId,
      endpointConfigured: true,
    };
  }

  async pauseAgent({ ownerUserId, agentId }) {
    const updated = await this.agentRepository.updateAgentStatus({
      agentId,
      ownerUserId,
      status: 'paused',
    });

    if (!updated) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      throw error;
    }

    return {
      ok: true,
      agent: updated,
    };
  }
}

module.exports = { AgentManagementService };
