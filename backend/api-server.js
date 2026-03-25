const express = require('express');
const { setupSecurity } = require('./middleware/security');
const { requestContext } = require('./middleware/request-context');
const { buildErrorResponse } = require('./shared/errors');
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
const { AgentManagementService } = require('./services/agents/AgentManagementService');
const { requireAuth } = require('./middleware/authenticate');
const { WorldRuntimeGateway } = require('./services/world/WorldRuntimeGateway');
const { WorldEventStreamService } = require('./services/world/WorldEventStreamService');
const { PostgresNotificationBus } = require('./services/world/PostgresNotificationBus');
const { WORLD_RUNTIME_BUS_CHANNEL } = require('./database/world-runtime');
const { AiGameEngine } = require('./games/garden-quest/engine');
const { createRuntimeSecretVault, initializeRuntimeDatabase } = require('./bootstrap/runtime-bootstrap');

const app = express();

const secretVault = createRuntimeSecretVault({
  agentRepository,
  appEnv: config.APP_ENV,
});

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
let httpServer = null;
let shutdownInFlight = false;
let shutdownForceHandle = null;

app.set('trust proxy', 1);
app.use(requestContext);

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
  const runtimeHealth = await worldGateway.getRuntimeHealth();

  res.json({
    status: runtimeHealth.status,
    timestamp: new Date().toISOString(),
    runtime: {
      mode: 'api',
      realmId: runtimeHealth.realmId,
      snapshotVersion: runtimeHealth.snapshot.snapshotVersion,
      snapshotUpdatedAt: runtimeHealth.snapshot.snapshotUpdatedAt,
      snapshotStale: runtimeHealth.snapshot.stale,
    },
    dependencies: {
      database: runtimeHealth.database,
      queue: runtimeHealth.queue,
    },
    realtime: {
      ...worldEventStreamService.getStats(),
      latestEventSeq: runtimeHealth.latestEventSeq,
    },
  });
});

app.use((req, res) => {
  const { statusCode, payload } = buildErrorResponse(
    { statusCode: 404, publicMessage: 'Not found' },
    {
      fallbackCode: 'not_found',
      correlationId: req.correlationId,
    }
  );
  res.status(statusCode).json({
    ...payload,
    path: req.originalUrl,
  });
});

app.use((err, req, res, _next) => {
  const { statusCode, payload, appError } = buildErrorResponse(err, {
    fallbackCode: 'internal_error',
    correlationId: req.correlationId,
  });

  console.error('API server error', {
    correlationId: req.correlationId,
    code: appError.code,
    statusCode,
    method: req.method,
    path: req.originalUrl,
    message: err?.message || 'Unknown error',
  });

  res.status(statusCode).json(payload);
});

async function startServer() {
  try {
    await initializeRuntimeDatabase({
      verifyDatabaseConnection,
      agentRepository,
      authSessionRepository,
      realmRepository,
      worldRuntimeRepository,
    });
    console.log('Database connection established for API server.');
  } catch (error) {
    console.error('API server startup failed:', error.message);
    process.exit(1);
  }

  worldEventStreamService.start();

  httpServer = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`GardenQuest API server running on port ${config.PORT}`);
    console.log(`Realm runtime mode: database snapshot / queue (${config.REALM_ID})`);
    console.log(`Realtime mode: SSE stream ${config.WORLD_EVENT_STREAM_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`Notify bus: ${config.WORLD_RUNTIME_BUS_ENABLED ? 'enabled' : 'disabled'}`);
  });

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error('[SHUTDOWN] API SIGINT handler failed:', error.message);
      process.exit(1);
    });
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error('[SHUTDOWN] API SIGTERM handler failed:', error.message);
      process.exit(1);
    });
  });
}

async function shutdown(signal) {
  if (shutdownInFlight) {
    return;
  }
  shutdownInFlight = true;
  console.log(`[SHUTDOWN] API server received ${signal}. Closing stream and HTTP listener...`);

  shutdownForceHandle = setTimeout(() => {
    console.error('[SHUTDOWN] API server forced exit after timeout.');
    process.exit(1);
  }, 10_000);
  shutdownForceHandle.unref?.();

  await worldEventStreamService.stop().catch((error) => {
    console.error('[SHUTDOWN] API stream stop failed:', error.message);
  });

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      httpServer = null;
    }
  } catch (error) {
    console.error('[SHUTDOWN] API HTTP close failed:', error.message);
  }

  if (shutdownForceHandle) {
    clearTimeout(shutdownForceHandle);
    shutdownForceHandle = null;
  }
  process.exit(0);
}

startServer();
