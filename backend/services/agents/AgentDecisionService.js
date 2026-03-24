const config = require('../../config');
const { createAgentProvider } = require('../../agents/providers/AgentProviderFactory');

class AgentDecisionService {
  constructor({ agentRepository = null, secretVault = null, logger = console } = {}) {
    this.agentRepository = agentRepository;
    this.secretVault = secretVault;
    this.logger = logger;
  }

  async decideOfficialNpc({ observation, fallbackDecisionFactory }) {
    const officialNpc = {
      id: 'npc-gardener-01',
      mode: 'server_managed',
      provider: 'openai',
      status: 'active',
    };

    const policy = {
      timeoutMs: config.OPENAI_API_TIMEOUT_MS,
      speechMaxChars: config.AI_SPEECH_MAX_CHARS,
      maxOutputTokens: 240,
      model: config.OPENAI_MODEL,
    };

    const startedAt = Date.now();

    try {
      const provider = createAgentProvider({
        agent: officialNpc,
        deps: {
          logger: this.logger,
        },
      });
      const result = await provider.decide({ agent: officialNpc, observation, policy });
      await this.recordRun({
        agentId: officialNpc.id,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        providerMode: result?.meta?.mode || 'server_managed',
        providerName: result?.meta?.provider || 'openai',
      });
      return result;
    } catch (error) {
      this.logger.error('Official NPC provider failed:', error.message);
      await this.recordRun({
        agentId: officialNpc.id,
        status: 'error',
        errorCode: error.code || error.statusCode || 'decision_error',
        latencyMs: Date.now() - startedAt,
        providerMode: 'server_managed',
        providerName: 'openai',
      });

      const fallback = typeof fallbackDecisionFactory === 'function'
        ? fallbackDecisionFactory(error)
        : { action: 'wait', targetId: null, speech: null };

      return {
        ...fallback,
        meta: {
          mode: 'server_managed',
          provider: 'fallback',
          fallback: true,
          errorCode: error.code || error.statusCode || 'decision_error',
        },
      };
    }
  }

  async decideForAgent({ agentId, observation, fallbackDecisionFactory = null }) {
    if (!this.agentRepository) {
      throw new Error('AgentDecisionService requires an agent repository');
    }

    const agent = await this.agentRepository.getAgentById(agentId);
    if (!agent || agent.status !== 'active') {
      const error = new Error('Agent not active');
      error.statusCode = 404;
      throw error;
    }

    const policy = {
      timeoutMs: 2500,
      speechMaxChars: 140,
      maxOutputTokens: 180,
      ...(agent.policyJson || {}),
    };

    const provider = createAgentProvider({
      agent,
      deps: {
        secretVault: this.secretVault,
        agentRepository: this.agentRepository,
        logger: this.logger,
      },
    });

    const startedAt = Date.now();
    try {
      const result = await provider.decide({ agent, observation, policy });
      await this.recordRun({
        agentId,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        providerMode: result?.meta?.mode || agent.mode,
        providerName: result?.meta?.provider || agent.provider,
      });
      return result;
    } catch (error) {
      this.logger.error('Player-owned agent provider failed:', error.message);
      await this.recordRun({
        agentId,
        status: 'error',
        errorCode: error.code || error.statusCode || 'decision_error',
        latencyMs: Date.now() - startedAt,
        providerMode: agent.mode,
        providerName: agent.provider,
      });

      const fallback = typeof fallbackDecisionFactory === 'function'
        ? fallbackDecisionFactory(error)
        : { action: 'wait', targetId: null, speech: null };

      return {
        ...fallback,
        meta: {
          mode: agent.mode,
          provider: 'fallback',
          fallback: true,
          errorCode: error.code || error.statusCode || 'decision_error',
        },
      };
    }
  }

  async recordRun({ agentId, status, errorCode = null, latencyMs = null, providerMode = null, providerName = null }) {
    if (!this.agentRepository?.recordAgentRun) {
      return;
    }

    try {
      await this.agentRepository.recordAgentRun({
        agentId,
        status,
        errorCode,
        latencyMs,
        providerMode,
        providerName,
      });
    } catch (error) {
      this.logger.error('Failed to record agent run:', error.message);
    }
  }
}

module.exports = { AgentDecisionService };
