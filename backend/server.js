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
const { AgentManagementService } = require('./services/agents/AgentManagementService');
const { requireAuth } = require('./middleware/authenticate');
const realmRepository = require('./database/realm-leases');
const worldRuntimeRepository = require('./database/world-runtime');
const { RealmLeaseService } = require('./services/realm/RealmLeaseService');
const { WorldRuntimeGateway } = require('./services/world/WorldRuntimeGateway');
const { AiGameEngine } = require('./games/garden-quest/engine');
const { createRuntimeSecretVault, initializeRuntimeDatabase } = require('./bootstrap/runtime-bootstrap');

const app = express();

// SecretVault initialization (optional in local, required in production)
const secretVault = createRuntimeSecretVault({
  agentRepository,
  appEnv: config.APP_ENV,
});
const agentService = new AgentManagementService({
  agentRepository,
  secretVault,
});
const aiGameEngine = new AiGameEngine({ agentRepository, secretVault });
const worldGateway = new WorldRuntimeGateway({
  worldRuntimeRepository,
  realmId: config.REALM_ID,
  snapshotTtlMs: config.WORLD_RUNTIME_SNAPSHOT_TTL_MS,
});
let serverHeartbeatHandle = null;
let realmLeaseHeartbeatHandle = null;
let httpServer = null;
let shutdownForceHandle = null;
let shutdownInFlight = false;

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

// Trust Cloud Run proxy for secure cookies
app.set('trust proxy', 1);
app.use(requestContext);

// Server-side Heartbeat to confirm process is alive
if (config.NODE_ENV === 'development' || config.APP_ENV === 'local') {
    serverHeartbeatHandle = setInterval(() => {
        console.log(`[SERVER-HEARTBEAT] ⚙️ Alive at ${new Date().toLocaleTimeString()} (RAM: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB)`);
    }, 60000);
    serverHeartbeatHandle.unref?.();
}

// Enhanced Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const referer = req.headers.referer || 'unknown';
  
  const isQuietPath = req.url === '/' || req.url === '/health';
  const shouldLog = config.NODE_ENV === 'development' && (!isQuietPath || process.env.VERBOSE_LOGS === 'true');

  if (shouldLog) {
    console.log(`>>> [REQUISICAO] [${req.correlationId}] ${req.method} ${req.url} [Referer: ${referer}]`);
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (shouldLog || res.statusCode >= 400) {
        console.log(`<<< [RESPOSTA] [${req.correlationId}] ${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms)`);
    }
  });

  next();
});

// Root handler to avoid 404 in logs
app.get('/', (req, res) => {
    res.json({ message: 'IMG Backend Root', status: 'ready' });
});

// Security middleware
setupSecurity(app);

// Body parser
app.use(express.json({ limit: '16kb' }));

// Routes
const systemRoutes = require('./routes/logs');
const aiGameRoutes = createAiGameRoutes({ gameEngine: aiGameEngine });
app.use('/auth', createAuthRoutes({ gameEngine: aiGameEngine }));
app.use('/api/v1/platform', createPlatformRoutes());
app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/ai-game', aiGameRoutes);
app.use('/api/v1/games/garden-quest', aiGameRoutes);
app.use('/api/v1/agents', createAgentRoutes({ agentService, authMiddleware: requireAuth }));


// Health check (Cloud Run requirement)
app.get('/health', async (req, res) => {
  const runtimeStatus = aiGameEngine.getRuntimeStatus?.() || {};
  const leaseSnapshot = realmLeaseService.getSnapshot?.() || {};
  const runtimeHealth = await worldGateway.getRuntimeHealth();

  res.json({
    status: runtimeHealth.status,
    timestamp: new Date().toISOString(),
    runtime: {
      mode: 'legacy-monolith',
      tick: runtimeStatus.tick || 0,
      playersOnline: runtimeStatus.playersOnline || 0,
      userAgentsOnline: runtimeStatus.userAgentsOnline || 0,
      pendingAgentDecisions: runtimeStatus.pendingAgentDecisions || 0,
      snapshot: runtimeHealth.snapshot,
      realmLease: {
        realmId: leaseSnapshot.realmId || config.REALM_ID,
        required: config.AGENT_WORLD_REQUIRE_LEASE,
        localInstanceId: leaseSnapshot.localInstanceId || runtimeStatus.realmLease?.localInstanceId || null,
        ownerInstanceId: leaseSnapshot.ownerInstanceId || runtimeStatus.realmLease?.ownerInstanceId || null,
        isLeader: Boolean(leaseSnapshot.isLeader),
        expiresAt: leaseSnapshot.expiresAt || null,
        lastHeartbeatAt: leaseSnapshot.checkedAt || leaseSnapshot.lastHeartbeatAt || null,
        lastError: leaseSnapshot.lastError || runtimeStatus.realmLease?.lastError || null,
      },
    },
    dependencies: {
      database: runtimeHealth.database,
      queue: runtimeHealth.queue,
    },
  });
});

// 404 handler
app.use((req, res) => {
  const { statusCode, payload } = buildErrorResponse(
    { statusCode: 404, publicMessage: 'Not found' },
    {
      fallbackCode: 'not_found',
      correlationId: req.correlationId,
    }
  );
  console.warn(`[404] [${req.correlationId}] Resource not found: ${req.method} ${req.originalUrl}`);
  res.status(statusCode).json({
    ...payload,
    path: req.originalUrl,
  });
});

// Error handler
app.use((err, req, res, _next) => {
  const { statusCode, payload, appError } = buildErrorResponse(err, {
    fallbackCode: 'internal_error',
    correlationId: req.correlationId,
  });

  console.error('Server error', {
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
    console.log('Database connection established.');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }

  httpServer = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`Backend running on port ${config.PORT}`);
    console.log(`Runtime mode: ${config.NODE_ENV}`);
    console.log(`App environment: ${config.APP_ENV}`);
    if (config.LOADED_ENV_FILES.length > 0) {
      console.log(`Loaded env files: ${config.LOADED_ENV_FILES.join(', ')}`);
    }
    console.log(`Frontend URL: ${config.FRONTEND_URL || '(unset)'}`);
    console.log(`AI player: ${config.AI_GAME_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`SecretVault: ${secretVault ? 'enabled' : 'disabled'}`);

    if (!config.GOOGLE_CLIENT_ID) {
      console.error('WARNING: GOOGLE_CLIENT_ID is not set. Google Login will not work.');
    } else {
      console.log(`GOOGLE_CLIENT_ID loaded (ends with ${config.GOOGLE_CLIENT_ID.slice(-10)})`);
    }

    aiGameEngine.start();
    applyRuntimeLeaseSnapshot(realmLeaseService.getSnapshot?.(), { evacuateOnLoss: false });

    // Realm lease heartbeat (leader election)
    realmLeaseHeartbeatHandle = setInterval(() => {
      realmLeaseService.heartbeat()
        .then((snapshot) => {
          applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: true });
        })
        .catch((error) => {
          console.error('Realm lease heartbeat failed:', error.message);
        });
    }, Math.round(realmLeaseService.leaseTtlMs / 2));
    realmLeaseHeartbeatHandle.unref?.();
    realmLeaseService.heartbeat()
      .then((snapshot) => {
        applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: true });
      })
      .catch((error) => {
        console.error('Initial realm lease heartbeat failed:', error.message);
      });
  });
}

function clearRuntimeIntervals() {
  if (serverHeartbeatHandle) {
    clearInterval(serverHeartbeatHandle);
    serverHeartbeatHandle = null;
  }

  if (realmLeaseHeartbeatHandle) {
    clearInterval(realmLeaseHeartbeatHandle);
    realmLeaseHeartbeatHandle = null;
  }
}

async function shutdown(signal) {
  if (shutdownInFlight) {
    return;
  }
  shutdownInFlight = true;
  console.log(`[SHUTDOWN] Legacy server received ${signal}. Draining active work...`);
  clearRuntimeIntervals();

  shutdownForceHandle = setTimeout(() => {
    console.error('[SHUTDOWN] Legacy server forced exit after timeout.');
    process.exit(1);
  }, 10_000);
  shutdownForceHandle.unref?.();

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
    console.error('[SHUTDOWN] Legacy HTTP close failed:', error.message);
  }

  await aiGameEngine.stop().catch((error) => {
    console.error('[SHUTDOWN] Legacy runtime stop failed:', error.message);
  });
  await realmLeaseService.release().catch((error) => {
    console.error('[SHUTDOWN] Legacy realm lease release failed:', error.message);
  });

  if (shutdownForceHandle) {
    clearTimeout(shutdownForceHandle);
    shutdownForceHandle = null;
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('[SHUTDOWN] Legacy SIGINT handler failed:', error.message);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('[SHUTDOWN] Legacy SIGTERM handler failed:', error.message);
    process.exit(1);
  });
});

startServer();
