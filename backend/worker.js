const config = require('./config');
const { verifyDatabaseConnection } = require('./database/postgres');
const agentRepository = require('./database/agents');
const realmRepository = require('./database/realm-leases');
const worldRuntimeRepository = require('./database/world-runtime');
const { PostgresNotificationBus } = require('./services/world/PostgresNotificationBus');
const { WORLD_COMMAND_BUS_CHANNEL } = require('./database/world-runtime');
const { SecretVault } = require('./services/crypto/SecretVault');
const { AiGameEngine } = require('./games/garden-quest/engine');
const { RealmLeaseService } = require('./services/realm/RealmLeaseService');
const { WorldRuntimeWorker } = require('./services/world/WorldRuntimeWorker');

const agentSecretMasterKeyHex = process.env.AGENT_SECRET_MASTER_KEY_HEX
  || (config.APP_ENV === 'local'
    ? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    : null);

const secretVault = agentSecretMasterKeyHex
  ? new SecretVault({
    agentRepository,
    masterKeyHex: agentSecretMasterKeyHex,
  })
  : null;

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

async function startWorker() {
  try {
    await verifyDatabaseConnection();
    await agentRepository.ensureAgentTables();
    await realmRepository.ensureRealmLeaseTable();
    await worldRuntimeRepository.ensureWorldRuntimeTables();
    console.log('Database connection established for world worker.');
  } catch (error) {
    console.error('World worker startup failed:', error.message);
    process.exit(1);
  }

  applyRuntimeLeaseSnapshot(realmLeaseService.getSnapshot?.(), { evacuateOnLoss: false });
  await worldWorker.start();
  console.log(`GardenQuest world worker online for realm ${config.REALM_ID}`);
}

async function shutdown() {
  await worldWorker.stop();
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});

startWorker();
