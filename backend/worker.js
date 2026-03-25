const config = require('./config');
const { verifyDatabaseConnection } = require('./database/postgres');
const agentRepository = require('./database/agents');
const realmRepository = require('./database/realm-leases');
const worldRuntimeRepository = require('./database/world-runtime');
const { PostgresNotificationBus } = require('./services/world/PostgresNotificationBus');
const { WORLD_COMMAND_BUS_CHANNEL } = require('./database/world-runtime');
const { AiGameEngine } = require('./games/garden-quest/engine');
const { RealmLeaseService } = require('./services/realm/RealmLeaseService');
const { WorldRuntimeWorker } = require('./services/world/WorldRuntimeWorker');
const { createRuntimeSecretVault, initializeRuntimeDatabase } = require('./bootstrap/runtime-bootstrap');

const secretVault = createRuntimeSecretVault({
  agentRepository,
  appEnv: config.APP_ENV,
});

const aiGameEngine = new AiGameEngine({
  agentRepository,
  secretVault,
});

function applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss = true } = {}) {
  aiGameEngine.setRealmLeaseSnapshot?.(snapshot, { evacuateOnLoss });
}

const realmLeaseService = new RealmLeaseService({
  realmRepository,
  realmId: config.REALM_ID,
  leaseTtlMs: config.REALM_LEASE_TTL_MS,
  onLeaseAcquired: (snapshot) => {
    applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: false });
  },
  onLeaseLost: (snapshot) => {
    applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: true });
  },
});

const commandNotificationBus = config.WORLD_RUNTIME_BUS_ENABLED
  ? new PostgresNotificationBus({ channel: WORLD_COMMAND_BUS_CHANNEL, name: 'world-command-worker' })
  : null;

const worldWorker = new WorldRuntimeWorker({
  aiGameEngine,
  worldRuntimeRepository,
  realmId: config.REALM_ID,
  commandNotificationBus,
  realmLeaseService,
});
let shutdownInFlight = false;
let shutdownForceHandle = null;

async function startWorker() {
  try {
    await initializeRuntimeDatabase({
      verifyDatabaseConnection,
      agentRepository,
      realmRepository,
      worldRuntimeRepository,
    });
    console.log('Database connection established for world worker.');
  } catch (error) {
    console.error('World worker startup failed:', error.message);
    process.exit(1);
  }

  applyRuntimeLeaseSnapshot(realmLeaseService.getSnapshot?.(), { evacuateOnLoss: false });
  await worldWorker.start();
  console.log(`GardenQuest world worker online for realm ${config.REALM_ID}`);
}

async function shutdown(signal) {
  if (shutdownInFlight) {
    return;
  }
  shutdownInFlight = true;
  console.log(`[SHUTDOWN] Worker received ${signal}. Draining queue and releasing resources...`);

  shutdownForceHandle = setTimeout(() => {
    console.error('[SHUTDOWN] Worker forced exit after timeout.');
    process.exit(1);
  }, 10_000);
  shutdownForceHandle.unref?.();

  await worldWorker.stop().catch((error) => {
    console.error('[SHUTDOWN] Worker stop failed:', error.message);
  });

  if (shutdownForceHandle) {
    clearTimeout(shutdownForceHandle);
    shutdownForceHandle = null;
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('[SHUTDOWN] Worker SIGINT handler failed:', error.message);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('[SHUTDOWN] Worker SIGTERM handler failed:', error.message);
    process.exit(1);
  });
});

startWorker();
