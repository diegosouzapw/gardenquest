const express = require('express');
const { setupSecurity } = require('./middleware/security');
const createAuthRoutes = require('./routes/auth');
const createAiGameRoutes = require('./routes/ai-game');
const createPlatformRoutes = require('./routes/platform');
const createAgentRoutes = require('./routes/agents');
const config = require('./config');
const { verifyDatabaseConnection } = require('./database/postgres');
const agentRepository = require('./database/agents');
const authSessionRepository = require('./database/auth-sessions');
const realmRepository = require('./database/realm-leases');
const worldRuntimeRepository = require('./database/world-runtime');
const { SecretVault } = require('./services/crypto/SecretVault');
const { AgentManagementService } = require('./services/agents/AgentManagementService');
const { requireAuth } = require('./middleware/authenticate');
const { WorldRuntimeGateway } = require('./services/world/WorldRuntimeGateway');
const { WorldEventStreamService } = require('./services/world/WorldEventStreamService');
const { PostgresNotificationBus } = require('./services/world/PostgresNotificationBus');
const { WORLD_RUNTIME_BUS_CHANNEL } = require('./database/world-runtime');
const { AiGameEngine } = require('./games/garden-quest/engine');

const app = express();

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

const agentService = new AgentManagementService({
  agentRepository,
  secretVault,
});

const bootstrapEngine = new AiGameEngine({
  agentRepository,
  secretVault,
});

const worldGateway = new WorldRuntimeGateway({
  worldRuntimeRepository,
  realmId: config.REALM_ID,
  snapshotTtlMs: config.WORLD_RUNTIME_SNAPSHOT_TTL_MS,
});

const runtimeNotificationBus = config.WORLD_RUNTIME_BUS_ENABLED
  ? new PostgresNotificationBus({ channel: WORLD_RUNTIME_BUS_CHANNEL, name: 'world-runtime-api' })
  : null;

const worldEventStreamService = new WorldEventStreamService({
  worldRuntimeRepository,
  worldGateway,
  realmId: config.REALM_ID,
  notificationBus: runtimeNotificationBus,
});

app.set('trust proxy', 1);

app.get('/', (_req, res) => {
  res.json({ message: 'GardenQuest API Server', status: 'ready' });
});

setupSecurity(app);
app.use(express.json({ limit: '16kb' }));

const systemRoutes = require('./routes/logs');
app.use('/auth', createAuthRoutes({ gameEngine: bootstrapEngine, worldGateway }));
app.use('/api/v1/platform', createPlatformRoutes());
app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/ai-game', createAiGameRoutes({
  gameEngine: bootstrapEngine,
  worldGateway,
  worldEventStreamService,
  worldRuntimeRepository,
}));
app.use('/api/v1/games/garden-quest', createAiGameRoutes({
  gameEngine: bootstrapEngine,
  worldGateway,
  worldEventStreamService,
  worldRuntimeRepository,
}));
app.use('/api/v1/agents', createAgentRoutes({ agentService, authMiddleware: requireAuth }));

app.get('/health', async (_req, res) => {
  const snapshot = await worldRuntimeRepository.getLatestWorldRuntimeSnapshot(config.REALM_ID).catch(() => null);
  const updatedAtMs = snapshot?.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0;
  const stale = !updatedAtMs || (Date.now() - updatedAtMs) > config.WORLD_RUNTIME_SNAPSHOT_TTL_MS;
  const latestEventSeq = await worldRuntimeRepository.getLatestWorldRuntimeEventSeq(config.REALM_ID).catch(() => 0);

  res.json({
    status: stale ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    runtime: {
      mode: 'api',
      realmId: config.REALM_ID,
      snapshotVersion: snapshot?.snapshotVersion || 0,
      snapshotUpdatedAt: snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : null,
      snapshotStale: stale,
    },
    realtime: {
      ...worldEventStreamService.getStats(),
      latestEventSeq,
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

app.use((err, _req, res, _next) => {
  console.error('API server error:', err.message);
  res.status(err.statusCode || 500).json({ error: err.publicMessage || err.message || 'Internal server error' });
});

async function startServer() {
  try {
    await verifyDatabaseConnection();
    await agentRepository.ensureAgentTables();
    await authSessionRepository.ensureAuthSessionTable();
    await realmRepository.ensureRealmLeaseTable();
    await worldRuntimeRepository.ensureWorldRuntimeTables();
    console.log('Database connection established for API server.');
  } catch (error) {
    console.error('API server startup failed:', error.message);
    process.exit(1);
  }

  worldEventStreamService.start();

  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`GardenQuest API server running on port ${config.PORT}`);
    console.log(`Realm runtime mode: database snapshot / queue (${config.REALM_ID})`);
    console.log(`Realtime mode: SSE stream ${config.WORLD_EVENT_STREAM_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`Notify bus: ${config.WORLD_RUNTIME_BUS_ENABLED ? 'enabled' : 'disabled'}`);
  });

  const shutdown = () => {
    worldEventStreamService.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref?.();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
