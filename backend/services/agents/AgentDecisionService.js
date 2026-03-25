const config = require('../../config');
const { createAgentProvider } = require('../../agents/providers/AgentProviderFactory');
const { AgentGovernanceService, buildProviderKey } = require('./AgentGovernanceService');
const { AgentModerationService } = require('./AgentModerationService');

function estimateTokensFromJson(value) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value || {});
    return Math.max(1, Math.ceil(String(text || '').length / 4));
  } catch (error) {
    return 1;
  }
}

class AgentDecisionService {
  constructor({ agentRepository = null, secretVault = null, governanceService = null, moderationService = null, logger = console } = {}) {
    this.agentRepository = agentRepository;
    this.secretVault = secretVault;
    this.logger = logger;
    this.governanceService = governanceService || new AgentGovernanceService({ agentRepository, logger });
    this.moderationService = moderationService || new AgentModerationService({ logger });
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
    const estimatedInputTokens = estimateTokensFromJson({ observation, policy });

    try {
      const provider = createAgentProvider({
        agent: officialNpc,
        deps: {
          logger: this.logger,
        },
      });
      const result = await provider.decide({ agent: officialNpc, observation, policy });
      const moderated = this.moderationService.moderateDecision({ agent: officialNpc, decision: result, policy });
      await this.recordRun({
        agentId: officialNpc.id,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        providerMode: result?.meta?.mode || 'server_managed',
        providerName: result?.meta?.provider || 'openai',
        estimatedInputTokens,
        estimatedOutputTokens: estimateTokensFromJson(moderated.decision),
      });
      return {
        ...moderated.decision,
        meta: {
          ...(result?.meta || {}),
          moderation: moderated.moderation,
        },
      };
    } catch (error) {
      this.logger.error('Official NPC provider failed:', error.message);
      await this.recordRun({
        agentId: officialNpc.id,
        status: 'error',
        errorCode: error.code || error.statusCode || 'decision_error',
        latencyMs: Date.now() - startedAt,
        providerMode: 'server_managed',
        providerName: 'openai',
        estimatedInputTokens,
        estimatedOutputTokens: 0,
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

    const endpointConfig = agent.mode === 'remote_endpoint'
      ? await this.agentRepository.getAgentEndpointByAgentId(agent.id)
      : null;

    let governanceContext = null;
    try {
      governanceContext = await this.governanceService.assertCanRun({ agent, endpointConfig });
    } catch (error) {
      await this.recordRun({
        agentId,
        status: 'blocked',
        errorCode: error.code || error.statusCode || 'governance_blocked',
        latencyMs: 0,
        providerMode: agent.mode,
        providerName: agent.provider,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        countTowardsBudget: false,
      });

      const fallback = typeof fallbackDecisionFactory === 'function'
        ? fallbackDecisionFactory(error)
        : { action: 'wait', targetId: null, speech: null };

      return {
        ...fallback,
        meta: {
          mode: agent.mode,
          provider: 'governance',
          fallback: true,
          errorCode: error.code || error.statusCode || 'governance_blocked',
          governanceScope: error.governanceScope || null,
          retryAfterMs: error.retryAfterMs || null,
        },
      };
    }

    const provider = createAgentProvider({
      agent,
      deps: {
        secretVault: this.secretVault,
        agentRepository: this.agentRepository,
        logger: this.logger,
      },
    });

    const startedAt = Date.now();
    const estimatedInputTokens = estimateTokensFromJson({ observation, policy });
    const providerKey = governanceContext?.providerKey || buildProviderKey(agent, endpointConfig);

    try {
      const result = await provider.decide({ agent, observation, policy });
      const moderated = this.moderationService.moderateDecision({ agent, decision: result, policy });

      this.governanceService.onSuccess({ agent, providerKey });
      if (agent.mode === 'remote_endpoint' && this.agentRepository?.resetAgentEndpointHealth) {
        await this.agentRepository.resetAgentEndpointHealth(agent.id).catch(() => {});
      }

      if (agent.mode === 'remote_endpoint' && moderated.moderation.suspicious && this.agentRepository?.recordAgentEndpointSuspicion) {
        await this.agentRepository.recordAgentEndpointSuspicion({
          agentId: agent.id,
          reason: moderated.moderation.flags.map((item) => item.code).join(',') || 'moderation_flag',
          quarantineThreshold: config.AGENT_ENDPOINT_QUARANTINE_SUSPICIOUS_THRESHOLD,
          quarantineMs: config.AGENT_ENDPOINT_QUARANTINE_MS,
        }).catch(() => {});
      }

      await this.recordRun({
        agentId,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        providerMode: result?.meta?.mode || agent.mode,
        providerName: result?.meta?.provider || agent.provider,
        estimatedInputTokens,
        estimatedOutputTokens: estimateTokensFromJson(moderated.decision),
      });
      return {
        ...moderated.decision,
        meta: {
          ...(result?.meta || {}),
          moderation: moderated.moderation,
        },
      };
    } catch (error) {
      this.governanceService.onFailure({ agent, providerKey, error, policy: governanceContext?.policy });
      this.logger.error('Player-owned agent provider failed:', error.message);

      if (agent.mode === 'remote_endpoint' && this.agentRepository?.recordAgentEndpointFailure) {
        await this.agentRepository.recordAgentEndpointFailure({
          agentId: agent.id,
          errorCode: error.code || error.statusCode || 'remote_endpoint_error',
          quarantineThreshold: config.AGENT_ENDPOINT_QUARANTINE_FAILURE_THRESHOLD,
          quarantineMs: config.AGENT_ENDPOINT_QUARANTINE_MS,
        }).catch(() => {});
      }

      await this.recordRun({
        agentId,
        status: 'error',
        errorCode: error.code || error.statusCode || 'decision_error',
        latencyMs: Date.now() - startedAt,
        providerMode: agent.mode,
        providerName: agent.provider,
        estimatedInputTokens,
        estimatedOutputTokens: 0,
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

  async recordRun({ agentId, status, errorCode = null, latencyMs = null, providerMode = null, providerName = null, estimatedInputTokens = null, estimatedOutputTokens = null, countTowardsBudget = true }) {
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
        estimatedInputTokens,
        estimatedOutputTokens,
        countTowardsBudget,
      });
    } catch (error) {
      this.logger.error('Failed to record agent run:', error.message);
    }
  }
}

module.exports = { AgentDecisionService, estimateTokensFromJson };
