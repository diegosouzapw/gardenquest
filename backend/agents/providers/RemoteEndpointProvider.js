const { request } = require('undici');
const { AgentRuntime } = require('../contracts/AgentRuntime');
const { normalizeLegacyDecision } = require('../schemas/agent-action');

class RemoteEndpointProvider extends AgentRuntime {
  constructor({ agentRepository, secretVault = null, logger = console } = {}) {
    super();
    this.agentRepository = agentRepository;
    this.secretVault = secretVault;
    this.logger = logger;
  }

  async decide({ agent, observation, policy = {} }) {
    if (!this.agentRepository) {
      throw new Error('RemoteEndpointProvider requires an agent repository');
    }

    const endpoint = await this.agentRepository.getAgentEndpointByAgentId(agent.id);
    if (!endpoint?.baseUrl) {
      const error = new Error('Agent endpoint not configured');
      error.code = 'endpoint_missing';
      throw error;
    }

    const parsedUrl = new URL(endpoint.baseUrl);
    if (parsedUrl.protocol !== 'https:') {
      const error = new Error('Remote endpoint must use https');
      error.code = 'endpoint_insecure_protocol';
      throw error;
    }

    let authSecret = endpoint.authSecret || null;
    if (endpoint.authMode === 'bearer' && endpoint.authSecretPayload) {
      if (!this.secretVault) {
        const error = new Error('Endpoint auth secret is unavailable');
        error.code = 'endpoint_auth_unavailable';
        throw error;
      }

      try {
        authSecret = this.secretVault.decryptPayload(endpoint.authSecretPayload);
      } catch (decryptError) {
        const error = new Error('Endpoint auth secret is invalid');
        error.code = 'endpoint_auth_invalid';
        throw error;
      }
    }

    const payload = {
      agent: {
        id: agent.id,
        provider: agent.provider,
        mode: agent.mode,
      },
      observation,
      policy,
      timestamp: new Date().toISOString(),
    };

    const response = await this.postJson({
      endpoint: {
        ...endpoint,
        authSecret,
      },
      payload,
      timeoutMs: endpoint.timeoutMs || policy.timeoutMs || 2500,
    });
    const normalized = normalizeLegacyDecision(response, {
      speechMaxChars: policy.speechMaxChars || 140,
    });

    if (!normalized) {
      const error = new Error('Remote endpoint returned an invalid decision');
      error.code = 'invalid_endpoint_decision';
      throw error;
    }

    return {
      ...normalized,
      meta: {
        mode: 'remote_endpoint',
        provider: agent.provider || 'custom_http',
      },
    };
  }

  postJson({ endpoint, payload, timeoutMs }) {
    const parsedUrl = new URL(endpoint.baseUrl);
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Remote endpoint must use https');
    }

    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };

    if (endpoint.authMode === 'bearer' && endpoint.authSecret) {
      headers.Authorization = `Bearer ${endpoint.authSecret}`;
    }

    const maxAttempts = 3;
    const url = `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isRetryableStatus = (statusCode) => [408, 409, 429, 500, 502, 503, 504].includes(statusCode);
    const isRetryableError = (error) => {
      const code = String(error?.code || '').toUpperCase();
      return code === 'UND_ERR_CONNECT_TIMEOUT'
        || code === 'UND_ERR_HEADERS_TIMEOUT'
        || code === 'UND_ERR_BODY_TIMEOUT'
        || code === 'ECONNRESET'
        || code === 'ECONNREFUSED'
        || code === 'EAI_AGAIN'
        || code === 'ETIMEDOUT'
        || code === 'ENOTFOUND';
    };
    const computeDelay = (attempt) => Math.min(2000, 220 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 120);

    return (async () => {
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let res;
        try {
          res = await request(url, {
            method: 'POST',
            headers,
            body,
            headersTimeout: timeoutMs,
            bodyTimeout: timeoutMs,
          });
        } catch (error) {
          lastError = error;
          if (attempt >= maxAttempts || !isRetryableError(error)) {
            throw error;
          }
          await sleep(computeDelay(attempt));
          continue;
        }

        const raw = await res.body.text();
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (error) {
          throw error;
        }

        if (res.statusCode >= 400) {
          const error = new Error(`Remote endpoint error ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.endpointBody = parsed;
          lastError = error;

          if (attempt >= maxAttempts || !isRetryableStatus(res.statusCode)) {
            throw error;
          }

          await sleep(computeDelay(attempt));
          continue;
        }

        return parsed;
      }

      throw lastError || new Error('Remote endpoint request failed');
    })();
  }
}

module.exports = { RemoteEndpointProvider };
