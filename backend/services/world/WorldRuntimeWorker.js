const config = require('../../config');
const { buildRuntimeEvents } = require('./WorldDeltaService');

function classifyWorkerCommandError(error, command) {
  const code = String(error?.code || error?.statusCode || 'worker_error').toLowerCase();

  if (code.includes('validation') || code.includes('forbidden') || code.includes('unauthorized')) {
    return { retryable: false, errorCode: code, delayMs: 0 };
  }

  if (code.includes('rate') || code.includes('cooldown')) {
    return { retryable: true, errorCode: code, delayMs: 1200 };
  }

  const attempt = Math.max(1, Number(command?.attempts) || 1);
  const retryBaseMs = Math.max(250, Number(config.WORLD_COMMAND_RETRY_BASE_MS) || 1200);
  const delayMs = Math.min(30000, Math.max(500, retryBaseMs * (2 ** Math.max(0, attempt - 1))));
  return { retryable: true, errorCode: code, delayMs };
}

class WorldRuntimeWorker {
  constructor({
    aiGameEngine,
    worldRuntimeRepository,
    realmId = config.REALM_ID,
    commandPollMs = config.WORLD_COMMAND_POLL_MS,
    snapshotFlushMs = config.WORLD_SNAPSHOT_FLUSH_MS,
    commandBatchSize = config.WORLD_COMMAND_BATCH_SIZE,
    commandNotificationBus = null,
    realmLeaseService = null,
    logger = console,
  } = {}) {
    this.aiGameEngine = aiGameEngine;
    this.worldRuntimeRepository = worldRuntimeRepository;
    this.realmId = realmId;
    this.commandPollMs = Math.max(100, Number(commandPollMs) || 500);
    this.snapshotFlushMs = Math.max(250, Number(snapshotFlushMs) || 1000);
    this.commandBatchSize = Math.max(1, Math.min(250, Number(commandBatchSize) || 50));
    this.commandNotificationBus = commandNotificationBus;
    this.realmLeaseService = realmLeaseService;
    this.logger = logger;
    this.commandHandle = null;
    this.snapshotHandle = null;
    this.realmLeaseHandle = null;
    this.commandLoopInFlight = false;
    this.snapshotLoopInFlight = false;
    this.busUnsubscribe = null;
    this.busWakeups = 0;
    this.handleCommandNotification = this.handleCommandNotification.bind(this);
  }

  async start() {
    this.aiGameEngine.start();

    if (this.realmLeaseService) {
      await this.realmLeaseService.heartbeat()
        .then((snapshot) => {
          this.aiGameEngine.setRealmLeaseSnapshot?.(snapshot, { evacuateOnLoss: true });
        })
        .catch((error) => {
          this.logger.error('Initial worker realm lease heartbeat failed:', error.message);
        });
      const leaseTtlMs = Math.max(3000, Number(this.realmLeaseService.leaseTtlMs) || 20000);
      this.realmLeaseHandle = setInterval(() => {
        this.realmLeaseService.heartbeat()
          .then((snapshot) => {
            this.aiGameEngine.setRealmLeaseSnapshot?.(snapshot, { evacuateOnLoss: true });
          })
          .catch((error) => {
            this.logger.error('Worker realm lease heartbeat failed:', error.message);
          });
      }, Math.max(1000, Math.floor(leaseTtlMs / 2)));
      this.realmLeaseHandle.unref?.();
    }

    if (this.commandNotificationBus && !this.busUnsubscribe) {
      this.busUnsubscribe = this.commandNotificationBus.subscribe(this.handleCommandNotification);
      await this.commandNotificationBus.start().catch((error) => {
        this.logger.error('World worker command bus start failed:', error.message);
      });
    }

    await this.flushSnapshots().catch((error) => {
      this.logger.error('Initial world snapshot flush failed:', error.message);
    });

    this.commandHandle = setInterval(() => {
      this.processCommandQueue().catch((error) => {
        this.logger.error('World command queue loop failed:', error.message);
      });
    }, this.commandPollMs);

    this.snapshotHandle = setInterval(() => {
      this.flushSnapshots().catch((error) => {
        this.logger.error('World snapshot flush loop failed:', error.message);
      });
    }, this.snapshotFlushMs);
  }

  async stop() {
    if (this.commandHandle) {
      clearInterval(this.commandHandle);
      this.commandHandle = null;
    }

    if (this.snapshotHandle) {
      clearInterval(this.snapshotHandle);
      this.snapshotHandle = null;
    }

    if (this.realmLeaseHandle) {
      clearInterval(this.realmLeaseHandle);
      this.realmLeaseHandle = null;
    }

    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }

    if (this.commandNotificationBus) {
      await this.commandNotificationBus.stop().catch(() => {});
    }

    if (this.realmLeaseService) {
      await this.realmLeaseService.release().catch(() => {});
    }

    await this.aiGameEngine.stop();
  }

  async handleCommandNotification(payload = {}) {
    if (payload.realmId && payload.realmId !== this.realmId) {
      return;
    }

    this.busWakeups += 1;
    await this.processCommandQueue();
  }

  isLeader() {
    if (this.realmLeaseService) {
      return !config.AGENT_WORLD_REQUIRE_LEASE || Boolean(this.realmLeaseService.getSnapshot()?.isLeader);
    }

    const runtime = this.aiGameEngine.getRuntimeStatus?.() || {};
    const lease = runtime.realmLease || {};
    return !config.AGENT_WORLD_REQUIRE_LEASE || Boolean(lease.isLeader);
  }

  getClaimedBy() {
    if (this.realmLeaseService) {
      return this.realmLeaseService.getSnapshot()?.localInstanceId || `worker:${process.pid}`;
    }

    const runtime = this.aiGameEngine.getRuntimeStatus?.() || {};
    return runtime.realmLease?.localInstanceId || `worker:${process.pid}`;
  }

  async processCommandQueue() {
    if (this.commandLoopInFlight || !this.isLeader()) {
      return;
    }

    this.commandLoopInFlight = true;

    try {
      const claimedBy = this.getClaimedBy();
      const commands = await this.worldRuntimeRepository.claimPendingWorldCommands({
        realmId: this.realmId,
        claimedBy,
        limit: this.commandBatchSize,
      });

      for (const command of commands) {
        try {
          const resultJson = await this.applyCommand(command);
          await this.worldRuntimeRepository.completeWorldCommand({
            id: command.id,
            claimedBy,
            status: 'done',
            resultJson,
          });
        } catch (error) {
          const plan = classifyWorkerCommandError(error, command);
          this.logger.error(`World command ${command.id} failed:`, error.message);

          if (!plan.retryable || (Number(command?.attempts) || 0) >= (Number(command?.maxAttempts) || config.WORLD_COMMAND_MAX_ATTEMPTS)) {
            await this.worldRuntimeRepository.completeWorldCommand({
              id: command.id,
              claimedBy,
              status: 'error',
              resultJson: {
                error: error.message,
                errorCode: plan.errorCode,
                attempts: command.attempts || 1,
                maxAttempts: command.maxAttempts || config.WORLD_COMMAND_MAX_ATTEMPTS,
              },
            });
          } else {
            await this.worldRuntimeRepository.requeueWorldCommand({
              id: command.id,
              claimedBy,
              errorMessage: error.message,
              errorCode: plan.errorCode,
              delayMs: plan.delayMs,
            });
          }
        }
      }
    } finally {
      this.commandLoopInFlight = false;
    }
  }

  async applyCommand(command) {
    const payload = command.payloadJson || {};

    switch (command.commandType) {
      case 'touch_session':
        await this.aiGameEngine.touchPlayerSession(payload.user || null);
        return { ok: true, commandType: command.commandType };
      case 'player_command':
        return this.aiGameEngine.applyPlayerCommand(payload.user || null, payload.command || null);
      case 'disconnect_player':
        this.aiGameEngine.disconnectPlayer(payload.userId || command.actorId, payload.reason || 'disconnect');
        return { ok: true, commandType: command.commandType };
      default:
        return { ok: true, ignored: true, commandType: command.commandType };
    }
  }

  async flushSnapshots() {
    if (this.snapshotLoopInFlight || !this.isLeader()) {
      return;
    }

    this.snapshotLoopInFlight = true;

    try {
      const previousSnapshotRow = await this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId);
      const exported = await this.aiGameEngine.exportRuntimeSnapshot();
      const runtimeEvents = buildRuntimeEvents(
        previousSnapshotRow?.snapshotJson || null,
        exported.publicState,
        exported.tick
      );

      await this.worldRuntimeRepository.upsertWorldRuntimeSnapshot({
        realmId: this.realmId,
        snapshotVersion: exported.tick,
        snapshotJson: exported.publicState,
        actorSnapshots: exported.actorSnapshots,
        runtimeEvents,
      });
    } finally {
      this.snapshotLoopInFlight = false;
    }
  }
}

module.exports = { WorldRuntimeWorker, classifyWorkerCommandError };
