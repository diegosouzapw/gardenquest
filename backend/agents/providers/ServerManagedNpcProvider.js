const { AgentRuntime } = require('../contracts/AgentRuntime');
const { createOpenAiDecisionClient } = require('../../services/openai-client');
const { normalizeLegacyDecision } = require('../schemas/agent-action');
const config = require('../../config');

class ServerManagedNpcProvider extends AgentRuntime {
  constructor({ logger = console } = {}) {
    super();
    this.logger = logger;
    this.openAiClient = createOpenAiDecisionClient();
  }

  async decide({ observation, policy = {} }) {
    if (!config.OPENAI_API_KEY) {
      const error = new Error('OpenAI API key is not configured');
      error.code = 'provider_not_configured';
      throw error;
    }

    const rawDecision = await this.openAiClient.decideNextAction(observation);
    const normalized = normalizeLegacyDecision(rawDecision, {
      speechMaxChars: policy.speechMaxChars || config.AI_SPEECH_MAX_CHARS,
    });

    if (!normalized) {
      const error = new Error('Server managed NPC provider returned an invalid decision');
      error.code = 'invalid_model_decision';
      error.rawDecision = rawDecision;
      throw error;
    }

    return {
      ...normalized,
      meta: {
        mode: 'server_managed',
        provider: 'openai',
      },
    };
  }
}

module.exports = { ServerManagedNpcProvider };
