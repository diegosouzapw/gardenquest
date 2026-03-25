const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDashboardData, insertLog } = require('../database/postgres');
const { getAuthenticatedUser } = require('../middleware/authenticate');
const authSessionRepository = require('../database/auth-sessions');
const agentRepository = require('../database/agents');
const worldRuntimeRepository = require('../database/world-runtime');

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress || '';
  return rawIp.split(',')[0].trim();
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeInteger(value, fallback, min = 1, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeLogCategory(value) {
  return value === 'game' ? 'game' : 'site';
}

function isAuthorizedDashboardUser(user) {
  return Boolean(user?.email) && config.ADMIN_GOOGLE_EMAILS.includes(String(user.email).trim().toLowerCase());
}

async function requireAdminUser(req, res) {
  const authenticatedUser = await getAuthenticatedUser(req, { requireActiveSession: true, touchSession: true });

  if (!authenticatedUser) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  if (!isAuthorizedDashboardUser(authenticatedUser)) {
    res.status(403).json({
      error: 'Acesso negado para este email.',
      email: authenticatedUser.email || null,
    });
    return null;
  }

  return authenticatedUser;
}

async function appendAdminAuditLog(req, adminUser, event, details = {}) {
  try {
    await insertLog({
      event,
      ip: getRequestIp(req),
      userAgent: normalizeText(req.headers['user-agent'], 512) || '',
      userId: adminUser?.id || null,
      userName: adminUser?.name || null,
      category: 'site',
      details: JSON.stringify(details).slice(0, 1000),
    });
  } catch (error) {
    console.error('Admin audit log error:', error.message);
  }
}

router.post('/sync', async (req, res) => {
  const type = normalizeText(req.body?.type, 64);
  const category = normalizeLogCategory(req.body?.category);
  const authenticatedUser = await getAuthenticatedUser(req, { requireActiveSession: true, touchSession: true });

  if (!type) {
    return res.status(400).json({ error: 'Config type is required' });
  }

  if (!authenticatedUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const ip = getRequestIp(req);
  const userAgent = normalizeText(req.headers['user-agent'], 512) || '';

  try {
    await insertLog({
      event: type,
      ip,
      userAgent,
      userId: authenticatedUser.id,
      userName: authenticatedUser.name,
      category,
    });

    res.status(201).json({ synced: true });
  } catch (error) {
    console.error('Sync error:', error.message);
    res.status(500).json({ error: 'System error' });
  }
});

router.get('/dashboard', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const finalData = await getDashboardData();
    res.json(finalData);
  } catch (error) {
    console.error('Dashboard error:', error.message);
    res.status(500).json({ error: 'Internal dashboard error' });
  }
});

router.get('/ops-dashboard', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const [sessionOverview, recentSessions, agentHealth, queueOverview, deadLetters] = await Promise.all([
      authSessionRepository.getAuthSessionOverview().catch(() => ({ activeCount: 0, revokedCount: 0, activeUsers: 0 })),
      authSessionRepository.listRecentActiveAuthSessions(30).catch(() => []),
      agentRepository.listAgentHealthOverview(50).catch(() => []),
      worldRuntimeRepository.getWorldCommandQueueOverview(config.REALM_ID).catch(() => ({ pendingCount: 0, processingCount: 0, errorCount: 0, deadLetterCount: 0, doneCount: 0, maxPriority: 0, maxAttemptsSeen: 0 })),
      worldRuntimeRepository.listWorldCommandDeadLetters({ realmId: config.REALM_ID, limit: 25 }).catch(() => []),
    ]);

    res.json({
      sessionOverview,
      recentSessions,
      agentHealth,
      queueOverview,
      deadLetters,
    });
  } catch (error) {
    console.error('Ops dashboard error:', error.message);
    res.status(500).json({ error: 'Internal ops dashboard error' });
  }
});

router.get('/queue/dead-letters', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const items = await worldRuntimeRepository.listWorldCommandDeadLetters({
      realmId: config.REALM_ID,
      limit: normalizeInteger(req.query?.limit, 100, 1, 200),
    });
    res.json({ items });
  } catch (error) {
    console.error('Dead letter list error:', error.message);
    res.status(500).json({ error: 'Internal dead letter list error' });
  }
});

router.post('/queue/:id/retry', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const result = await worldRuntimeRepository.retryWorldCommandAdmin({
      id: req.params.id,
      realmId: config.REALM_ID,
      delayMs: normalizeInteger(req.body?.delayMs, 0, 0, 30000),
      resetAttempts: Boolean(req.body?.resetAttempts),
    });

    if (!result) {
      return res.status(404).json({ error: 'Command not found or not retryable' });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_queue_retry', {
      queueCommandId: result.id,
      realmId: result.realmId,
      resetAttempts: Boolean(req.body?.resetAttempts),
    });

    res.json({ ok: true, item: result });
  } catch (error) {
    console.error('Queue retry error:', error.message);
    res.status(500).json({ error: 'Internal queue retry error' });
  }
});

router.post('/queue/:id/dead-letter', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const result = await worldRuntimeRepository.markWorldCommandDeadLetter({
      id: req.params.id,
      realmId: config.REALM_ID,
      reason: normalizeText(req.body?.reason, 120) || 'admin_dead_letter',
    });

    if (!result) {
      return res.status(404).json({ error: 'Command not found or not dead-letterable' });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_queue_dead_letter', {
      queueCommandId: result.id,
      realmId: result.realmId,
      reason: result.lastErrorCode,
    });

    res.json({ ok: true, item: result });
  } catch (error) {
    console.error('Queue dead-letter error:', error.message);
    res.status(500).json({ error: 'Internal queue dead-letter error' });
  }
});

router.post('/sessions/:sessionId/revoke', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const revoked = await authSessionRepository.revokeAuthSession(
      req.params.sessionId,
      normalizeText(req.body?.reason, 64) || 'admin_revoke'
    );

    if (!revoked) {
      return res.status(404).json({ error: 'Session not found or already revoked' });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_revoke_session', {
      sessionId: revoked.id,
      targetUserId: revoked.userId,
      reason: revoked.revokeReason,
    });

    res.json({ ok: true, session: revoked });
  } catch (error) {
    console.error('Admin revoke session error:', error.message);
    res.status(500).json({ error: 'Internal revoke session error' });
  }
});

router.post('/agents/:agentId/pause', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const agent = await agentRepository.updateAgentStatusAdmin({
      agentId: req.params.agentId,
      status: 'paused',
    });

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_pause_agent', { agentId: agent.id });
    res.json({ ok: true, agent });
  } catch (error) {
    console.error('Admin pause agent error:', error.message);
    res.status(500).json({ error: 'Internal pause agent error' });
  }
});

router.post('/agents/:agentId/resume', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const agent = await agentRepository.updateAgentStatusAdmin({
      agentId: req.params.agentId,
      status: 'active',
    });

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_resume_agent', { agentId: agent.id });
    res.json({ ok: true, agent });
  } catch (error) {
    console.error('Admin resume agent error:', error.message);
    res.status(500).json({ error: 'Internal resume agent error' });
  }
});

router.post('/agents/:agentId/clear-quarantine', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const agent = await agentRepository.getAgentById(req.params.agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await agentRepository.resetAgentEndpointHealth(req.params.agentId);
    const updatedAgent = await agentRepository.updateAgentStatusAdmin({
      agentId: req.params.agentId,
      status: ['paused', 'revoked'].includes(agent.status) ? agent.status : 'active',
    });

    await appendAdminAuditLog(req, adminUser, 'admin_clear_agent_quarantine', { agentId: req.params.agentId });
    res.json({ ok: true, agent: updatedAgent || agent });
  } catch (error) {
    console.error('Admin clear quarantine error:', error.message);
    res.status(500).json({ error: 'Internal clear quarantine error' });
  }
});

module.exports = router;
