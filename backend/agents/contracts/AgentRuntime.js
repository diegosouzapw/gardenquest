class AgentRuntime {
  async decide(_params) {
    throw new Error('AgentRuntime.decide must be implemented');
  }
}

module.exports = { AgentRuntime };
