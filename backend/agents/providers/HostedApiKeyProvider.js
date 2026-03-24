const https = require('https');
const { AgentRuntime } = require('../contracts/AgentRuntime');
const { normalizeLegacyDecision } = require('../schemas/agent-action');

class HostedApiKeyProvider extends AgentRuntime {
  constructor({ secretVault, logger = console } = {}) {
    super();
    this.secretVault = secretVault;
    this.logger = logger;
  }

  async decide({ agent, observation, policy = {} }) {
    if (!this.secretVault) {
      throw new Error('HostedApiKeyProvider requires a secret vault');
    }

    const apiKey = await this.secretVault.getAgentSecret(agent.id);
    if (!apiKey) {
      const error = new Error('Agent secret not found');
      error.code = 'secret_missing';
      throw error;
    }

    const provider = String(agent?.provider || 'openai').toLowerCase();
    if (provider !== 'openai') {
      const error = new Error(`Unsupported hosted provider: ${provider}`);
      error.code = 'unsupported_provider';
      throw error;
    }

    const payload = {
      model: policy.model || 'gpt-4.1-mini',
      store: false,
      max_output_tokens: policy.maxOutputTokens || 180,
      instructions: [
        'You control one player-owned agent in a server-authoritative multiplayer garden game.',
        'The world state is authoritative. Never invent hidden commands or extra capabilities.',
        'Return exactly one action using JSON only.',
        'Prioritize survival, policy compliance, and concise safe speech.',
      ].join(' '),
      input: JSON.stringify({ observation, policy }),
      text: {
        format: {
          type: 'json_schema',
          name: 'gardenquest_player_agent_decision',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['wait', 'move_to', 'drink_water', 'pick_fruit', 'eat_fruit'] },
              targetId: { type: ['string', 'null'] },
              speech: { type: ['string', 'null'], maxLength: policy.speechMaxChars || 140 },
            },
            required: ['action', 'targetId', 'speech'],
          },
        },
      },
    };

    const response = await this.postJson({
      hostname: 'api.openai.com',
      path: '/v1/responses',
      apiKey,
      payload,
      timeoutMs: policy.timeoutMs || 2500,
    });

    const outputText = this.extractOutputText(response);
    const normalized = normalizeLegacyDecision(JSON.parse(outputText), {
      speechMaxChars: policy.speechMaxChars || 140,
    });

    if (!normalized) {
      const error = new Error('Hosted provider returned an invalid decision');
      error.code = 'invalid_model_decision';
      throw error;
    }

    return {
      ...normalized,
      meta: {
        mode: 'hosted_api_key',
        provider,
      },
    };
  }

  extractOutputText(response) {
    if (typeof response?.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }

    if (!Array.isArray(response?.output)) {
      throw new Error('Hosted provider response missing output');
    }

    const textParts = [];
    for (const item of response.output) {
      if (!Array.isArray(item?.content)) {
        continue;
      }
      for (const contentPart of item.content) {
        if (contentPart?.type === 'output_text' && typeof contentPart.text === 'string') {
          textParts.push(contentPart.text);
        }
      }
    }

    const joined = textParts.join('').trim();
    if (!joined) {
      throw new Error('Hosted provider response missing output text');
    }

    return joined;
  }

  postJson({ hostname, path, apiKey, payload, timeoutMs }) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname,
        path,
        method: 'POST',
        port: 443,
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const parsed = raw ? JSON.parse(raw) : {};
            if (res.statusCode >= 400) {
              const error = new Error(`Hosted provider error ${res.statusCode}`);
              error.statusCode = res.statusCode;
              error.providerBody = parsed;
              return reject(error);
            }
            return resolve(parsed);
          } catch (error) {
            return reject(error);
          }
        });
      });

      req.on('timeout', () => req.destroy(new Error('Hosted provider timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { HostedApiKeyProvider };
