const config = require('../../config');

function normalizeInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function buildAgentKey(agent) {
  return String(agent?.id || '').trim();
}

function buildProviderKey(agent, endpointConfig = null) {
  if (agent?.mode === 'remote_endpoint' && endpointConfig?.baseUrl) {
    return `remote:${endpointConfig.baseUrl}`;
  }
  return `${agent?.mode || 'unknown'}:${String(agent?.provider || 'unknown').toLowerCase()}`;
}

class AgentGovernanceService {
  constructor({ agentRepository, logger = console, now = () => Date.now() } = {}) {
    this.agentRepository = agentRepository;
    this.logger = logger;
    this.now = now;
    this.agentState = new Map();
    this.providerState = new Map();
  }

  getPolicy(agent) {
    const raw = agent?.policyJson && typeof agent.policyJson === 'object' ? agent.policyJson : {};
    return {
      dailyRunBudget: normalizeInteger(raw.dailyRunBudget, config.AGENT_DEFAULT_DAILY_RUN_BUDGET, { min: 1, max: 100000 }),
      minDecisionIntervalMs: normalizeInteger(raw.minDecisionIntervalMs, config.AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS, { min: 250, max: 600000 }),
      failureThreshold: normalizeInteger(raw.failureThreshold, config.AGENT_CIRCUIT_FAILURE_THRESHOLD, { min: 1, max: 100 }),
      cooldownMs: normalizeInteger(raw.cooldownMs, config.AGENT_CIRCUIT_COOLDOWN_MS, { min: 1000, max: 3600000 }),
      providerFailureThreshold: normalizeInteger(raw.providerFailureThreshold, config.AGENT_PROVIDER_CIRCUIT_FAILURE_THRESHOLD, { min: 1, max: 200 }),
      providerCooldownMs: normalizeInteger(raw.providerCooldownMs, config.AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS, { min: 1000, max: 3600000 }),
    };
  }

  getState(map, key) {
    if (!map.has(key)) {
      map.set(key, {
        openUntil: 0,
        consecutiveFailures: 0,
        lastAttemptAt: 0,
        lastSuccessAt: 0,
        lastErrorCode: null,
      });
    }
    return map.get(key);
  }

  buildBlockedError(message, code, retryAfterMs, scope) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 429;
    error.retryAfterMs = Math.max(250, Math.trunc(retryAfterMs || 1000));
    error.publicMessage = message;
    error.governanceScope = scope;
    return error;
  }

  async assertCanRun({ agent, endpointConfig = null }) {
    const policy = this.getPolicy(agent);
    const now = this.now();
    const agentKey = buildAgentKey(agent);
    const providerKey = buildProviderKey(agent, endpointConfig);
    const agentState = this.getState(this.agentState, agentKey);
    const providerState = this.getState(this.providerState, providerKey);

    if (agentState.openUntil > now) {
      throw this.buildBlockedError('Agent circuit breaker aberto temporariamente.', 'agent_circuit_open', agentState.openUntil - now, 'agent');
    }

    if (providerState.openUntil > now) {
      throw this.buildBlockedError('Provider temporariamente em cooldown para este runtime.', 'provider_circuit_open', providerState.openUntil - now, 'provider');
    }

    if (agent?.mode === 'remote_endpoint' && this.agentRepository?.getAgentEndpointHealthByAgentId) {
      const health = await this.agentRepository.getAgentEndpointHealthByAgentId(agent.id).catch(() => null);
      const quarantinedUntilMs = health?.quarantinedUntil ? new Date(health.quarantinedUntil).getTime() : 0;
      if (quarantinedUntilMs && quarantinedUntilMs > now) {
        throw this.buildBlockedError('Endpoint remoto em quarantine temporaria.', 'endpoint_quarantined', quarantinedUntilMs - now, 'endpoint');
      }
    }

    const elapsed = now - (agentState.lastAttemptAt || 0);
    if (agentState.lastAttemptAt && elapsed < policy.minDecisionIntervalMs) {
      throw this.buildBlockedError('Agent rate limited pelo runtime.', 'agent_rate_limited', policy.minDecisionIntervalMs - elapsed, 'agent');
    }

    if (this.agentRepository?.getAgentDailyUsage) {
      const usage = await this.agentRepository.getAgentDailyUsage(agent.id);
      if ((usage?.runCount || 0) >= policy.dailyRunBudget) {
        throw this.buildBlockedError('Agent excedeu o budget diario de execucoes.', 'daily_budget_exceeded', 60_000, 'budget');
      }
    }

    agentState.lastAttemptAt = now;
    return {
      policy,
      providerKey,
      agentState,
      providerState,
    };
  }

  onSuccess({ agent, providerKey }) {
    const now = this.now();
    const agentState = this.getState(this.agentState, buildAgentKey(agent));
    const providerState = this.getState(this.providerState, providerKey);
    agentState.consecutiveFailures = 0;
    agentState.openUntil = 0;
    agentState.lastSuccessAt = now;
    agentState.lastErrorCode = null;
    providerState.consecutiveFailures = 0;
    providerState.openUntil = 0;
    providerState.lastSuccessAt = now;
    providerState.lastErrorCode = null;
  }

  onFailure({ agent, providerKey, error, policy = null }) {
    const resolvedPolicy = policy || this.getPolicy(agent);
    const now = this.now();
    const agentState = this.getState(this.agentState, buildAgentKey(agent));
    const providerState = this.getState(this.providerState, providerKey);
    const errorCode = error?.code || error?.statusCode || 'decision_error';

    agentState.consecutiveFailures += 1;
    agentState.lastErrorCode = errorCode;
    providerState.consecutiveFailures += 1;
    providerState.lastErrorCode = errorCode;

    if (agentState.consecutiveFailures >= resolvedPolicy.failureThreshold) {
      agentState.openUntil = now + resolvedPolicy.cooldownMs;
      this.logger.warn(`Agent circuit opened for ${agent.id} (${resolvedPolicy.cooldownMs}ms)`);
    }

    if (providerState.consecutiveFailures >= resolvedPolicy.providerFailureThreshold) {
      providerState.openUntil = now + resolvedPolicy.providerCooldownMs;
      this.logger.warn(`Provider circuit opened for ${providerKey} (${resolvedPolicy.providerCooldownMs}ms)`);
    }
  }
}

module.exports = { AgentGovernanceService, buildProviderKey };
