const config = require('../../config');

class WorldRuntimeWorker {
  constructor({
    aiGameEngine, worldRuntimeRepository, realmId = config.REALM_ID,
    commandPollMs = config.WORLD_COMMAND_POLL_MS, snapshotFlushMs = config.WORLD_SNAPSHOT_FLUSH_MS,
    commandBatchSize = config.WORLD_COMMAND_BATCH_SIZE, logger = console,
  } = {}) {
    this.aiGameEngine = aiGameEngine;
    this.worldRuntimeRepository = worldRuntimeRepository;
    this.realmId = realmId;
    this.commandPollMs = Math.max(100, Number(commandPollMs) || 500);
    this.snapshotFlushMs = Math.max(250, Number(snapshotFlushMs) || 1000);
    this.commandBatchSize = Math.max(1, Math.min(250, Number(commandBatchSize) || 50));
    this.logger = logger;
    this.commandHandle = null;
    this.snapshotHandle = null;
    this.commandLoopInFlight = false;
    this.snapshotLoopInFlight = false;
  }

  async start() {
    this.aiGameEngine.start();
    await this.flushSnapshots().catch((e) => this.logger.error('Initial snapshot flush failed:', e.message));
    this.commandHandle = setInterval(() => {
      this.processCommandQueue().catch((e) => this.logger.error('Command queue loop failed:', e.message));
    }, this.commandPollMs);
    this.snapshotHandle = setInterval(() => {
      this.flushSnapshots().catch((e) => this.logger.error('Snapshot flush loop failed:', e.message));
    }, this.snapshotFlushMs);
  }

  async stop() {
    if (this.commandHandle) { clearInterval(this.commandHandle); this.commandHandle = null; }
    if (this.snapshotHandle) { clearInterval(this.snapshotHandle); this.snapshotHandle = null; }
    await this.aiGameEngine.stop();
  }

  isLeader() {
    const runtime = this.aiGameEngine.getRuntimeStatus?.() || {};
    const lease = runtime.realmLease || {};
    return !config.AGENT_WORLD_REQUIRE_LEASE || Boolean(lease.isLeader);
  }

  getClaimedBy() {
    const runtime = this.aiGameEngine.getRuntimeStatus?.() || {};
    return runtime.realmLease?.localInstanceId || `worker:${process.pid}`;
  }

  async processCommandQueue() {
    if (this.commandLoopInFlight || !this.isLeader()) return;
    this.commandLoopInFlight = true;
    try {
      const claimedBy = this.getClaimedBy();
      const commands = await this.worldRuntimeRepository.claimPendingWorldCommands({ realmId: this.realmId, claimedBy, limit: this.commandBatchSize });
      for (const command of commands) {
        try {
          const resultJson = await this.applyCommand(command);
          await this.worldRuntimeRepository.completeWorldCommand({ id: command.id, claimedBy, status: 'done', resultJson });
        } catch (error) {
          this.logger.error(`Command ${command.id} failed:`, error.message);
          await this.worldRuntimeRepository.requeueWorldCommand({ id: command.id, claimedBy, errorMessage: error.message });
        }
      }
    } finally { this.commandLoopInFlight = false; }
  }

  async applyCommand(command) {
    const payload = command.payloadJson || {};
    switch (command.commandType) {
      case 'touch_session': await this.aiGameEngine.touchPlayerSession(payload.user || null); return { ok: true, commandType: command.commandType };
      case 'player_command': return this.aiGameEngine.applyPlayerCommand(payload.user || null, payload.command || null);
      case 'disconnect_player': this.aiGameEngine.disconnectPlayer(payload.userId || command.actorId, payload.reason || 'disconnect'); return { ok: true, commandType: command.commandType };
      default: return { ok: true, ignored: true, commandType: command.commandType };
    }
  }

  async flushSnapshots() {
    if (this.snapshotLoopInFlight || !this.isLeader()) return;
    this.snapshotLoopInFlight = true;
    try {
      const exported = await this.aiGameEngine.exportRuntimeSnapshot();
      await this.worldRuntimeRepository.upsertWorldRuntimeSnapshot({
        realmId: this.realmId, snapshotVersion: exported.tick,
        snapshotJson: exported.publicState, actorSnapshots: exported.actorSnapshots,
      });
    } finally { this.snapshotLoopInFlight = false; }
  }
}

module.exports = { WorldRuntimeWorker };
