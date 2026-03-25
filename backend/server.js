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
const { SecretVault } = require('./services/crypto/SecretVault');
const { AgentManagementService } = require('./services/agents/AgentManagementService');
const { requireAuth } = require('./middleware/authenticate');
const realmRepository = require('./database/realm-leases');
const { RealmLeaseService } = require('./services/realm/RealmLeaseService');
const { AiGameEngine } = require('./games/garden-quest/engine');

const app = express();

// SecretVault initialization (optional in local, required in production)
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
const aiGameEngine = new AiGameEngine({ agentRepository, secretVault });

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

// Server-side Heartbeat to confirm process is alive
if (config.NODE_ENV === 'development' || config.APP_ENV === 'local') {
    setInterval(() => {
        console.log(`[SERVER-HEARTBEAT] ⚙️ Alive at ${new Date().toLocaleTimeString()} (RAM: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB)`);
    }, 60000);
}

// Enhanced Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const referer = req.headers.referer || 'unknown';
  
  const isQuietPath = req.url === '/' || req.url === '/health';
  const shouldLog = config.NODE_ENV === 'development' && (!isQuietPath || process.env.VERBOSE_LOGS === 'true');

  if (shouldLog) {
    console.log(`>>> [REQUISICAO] ${req.method} ${req.url} [Referer: ${referer}]`);
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (shouldLog || res.statusCode >= 400) {
        console.log(`<<< [RESPOSTA] ${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms)`);
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
app.get('/health', (req, res) => {
  const runtimeStatus = aiGameEngine.getRuntimeStatus?.() || {};
  const leaseSnapshot = realmLeaseService.getSnapshot?.() || {};
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: {
      mode: 'legacy-monolith',
      tick: runtimeStatus.tick || 0,
      playersOnline: runtimeStatus.playersOnline || 0,
      userAgentsOnline: runtimeStatus.userAgentsOnline || 0,
      pendingAgentDecisions: runtimeStatus.pendingAgentDecisions || 0,
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
  });
});

// 404 handler
app.use((req, res) => {
  console.warn(`[404] Resource not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(err.statusCode || 500).json({ error: err.publicMessage || err.message || 'Internal server error' });
});

async function startServer() {
  try {
    await verifyDatabaseConnection();
    await agentRepository.ensureAgentTables();
    await authSessionRepository.ensureAuthSessionTable();
    await realmRepository.ensureRealmLeaseTable();
    console.log('Database connection established.');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }

  app.listen(config.PORT, '0.0.0.0', () => {
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
    setInterval(() => {
      realmLeaseService.heartbeat()
        .then((snapshot) => {
          applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: true });
        })
        .catch((error) => {
          console.error('Realm lease heartbeat failed:', error.message);
        });
    }, Math.round(realmLeaseService.leaseTtlMs / 2));
    realmLeaseService.heartbeat()
      .then((snapshot) => {
        applyRuntimeLeaseSnapshot(snapshot, { evacuateOnLoss: true });
      })
      .catch((error) => {
        console.error('Initial realm lease heartbeat failed:', error.message);
      });
  });
}

process.on('SIGINT', () => {
  aiGameEngine.stop();
  realmLeaseService.release().catch(() => {});
});

process.on('SIGTERM', () => {
  aiGameEngine.stop();
  realmLeaseService.release().catch(() => {});
});

startServer();
