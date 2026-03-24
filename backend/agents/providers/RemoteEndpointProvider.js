const https = require('https');
const http = require('http');
const { AgentRuntime } = require('../contracts/AgentRuntime');
const { normalizeLegacyDecision } = require('../schemas/agent-action');

class RemoteEndpointProvider extends AgentRuntime {
  constructor({ agentRepository, logger = console } = {}) {
    super();
    this.agentRepository = agentRepository;
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

    const response = await this.postJson({ endpoint, payload, timeoutMs: endpoint.timeoutMs || policy.timeoutMs || 2500 });
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
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };

    if (endpoint.authMode === 'bearer' && endpoint.authSecret) {
      headers.Authorization = `Bearer ${endpoint.authSecret}`;
    }

    return new Promise((resolve, reject) => {
      const req = client.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        timeout: timeoutMs,
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = raw ? JSON.parse(raw) : {};
            if (res.statusCode >= 400) {
              const error = new Error(`Remote endpoint error ${res.statusCode}`);
              error.statusCode = res.statusCode;
              error.endpointBody = parsed;
              return reject(error);
            }
            return resolve(parsed);
          } catch (error) {
            return reject(error);
          }
        });
      });

      req.on('timeout', () => req.destroy(new Error('Remote endpoint timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { RemoteEndpointProvider };
