class AgentWorldScheduler {
  constructor({
    canRunSchedulers = () => true,
    syncWorldAgents = async () => {},
    requestAgentDecisions = async () => {},
    logger = console,
  } = {}) {
    this.canRunSchedulers = canRunSchedulers;
    this.syncWorldAgents = syncWorldAgents;
    this.requestAgentDecisions = requestAgentDecisions;
    this.logger = logger;
  }

  maybeSyncWorldAgents(now = Date.now()) {
    if (!this.canRunSchedulers()) {
      return false;
    }

    Promise.resolve(this.syncWorldAgents(now)).catch((error) => {
      this.logger.error('World agent sync loop error:', error.message);
    });
    return true;
  }

  maybeRequestAgentDecisions() {
    if (!this.canRunSchedulers()) {
      return false;
    }

    Promise.resolve(this.requestAgentDecisions()).catch((error) => {
      this.logger.error('World agent decision loop error:', error.message);
    });
    return true;
  }
}

module.exports = { AgentWorldScheduler };
