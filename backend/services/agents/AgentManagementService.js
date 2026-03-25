const crypto = require('crypto');
const config = require('../../config');

function sanitizePolicy(policy) {
  const raw = policy && typeof policy === 'object' ? policy : {};
  const valueOr = (name, fallback, min, max) => {
    const parsed = Number.parseInt(raw?.[name], 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  return {
    dailyRunBudget: valueOr('dailyRunBudget', config.AGENT_DEFAULT_DAILY_RUN_BUDGET, 1, 100000),
    minDecisionIntervalMs: valueOr('minDecisionIntervalMs', config.AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS, 250, 600000),
    failureThreshold: valueOr('failureThreshold', config.AGENT_CIRCUIT_FAILURE_THRESHOLD, 1, 100),
    cooldownMs: valueOr('cooldownMs', config.AGENT_CIRCUIT_COOLDOWN_MS, 1000, 3600000),
    providerFailureThreshold: valueOr('providerFailureThreshold', config.AGENT_PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 1, 200),
    providerCooldownMs: valueOr('providerCooldownMs', config.AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS, 1000, 3600000),
  };
}

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
    const policyJson = sanitizePolicy(body?.policy);

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

  async updatePolicy({ ownerUserId, agentId, policy }) {
    const existing = await this.agentRepository.getAgentByIdForOwner(agentId, ownerUserId);
    if (!existing) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      throw error;
    }

    const updated = await this.agentRepository.updateAgentPolicy({
      agentId,
      ownerUserId,
      policyJson: sanitizePolicy({ ...(existing.policyJson || {}), ...(policy || {}) }),
    });

    return {
      ok: true,
      agent: updated,
    };
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

  async resumeAgent({ ownerUserId, agentId }) {
    const updated = await this.agentRepository.updateAgentStatus({
      agentId,
      ownerUserId,
      status: 'active',
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

  async getAgentRuns({ ownerUserId, agentId, limit = 30 }) {
    const agent = await this.agentRepository.getAgentByIdForOwner(agentId, ownerUserId);
    if (!agent) {
      const error = new Error('Agent not found');
      error.statusCode = 404;
      throw error;
    }

    const runs = await this.agentRepository.listAgentRunsByOwner({
      ownerUserId,
      agentId,
      limit,
    });
    const usageToday = await this.agentRepository.getAgentDailyUsage(agentId).catch(() => null);

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        mode: agent.mode,
        provider: agent.provider,
        status: agent.status,
        policy: agent.policyJson || {},
      },
      usageToday,
      items: runs,
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

module.exports = { AgentManagementService, sanitizePolicy };
