const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDashboardData, insertLog } = require('../database/postgres');
const { getAuthenticatedUser } = require('../middleware/authenticate');
const { buildErrorResponse } = require('../shared/errors');
const { normalizeEmail, normalizeInteger, normalizeText } = require('../shared/normalize');
const { getRequestIp, getRequestUserAgent } = require('../shared/request');
const authSessionRepository = require('../database/auth-sessions');
const agentRepository = require('../database/agents');
const worldRuntimeRepository = require('../database/world-runtime');

function normalizeLogCategory(value) {
  return value === 'game' ? 'game' : 'site';
}

function isAuthorizedDashboardUser(user) {
  const email = normalizeEmail(user?.email);
  return Boolean(email) && config.ADMIN_GOOGLE_EMAILS.includes(email);
}

function respondInternalError(req, res, logLabel, publicMessage, error) {
  const { statusCode, payload } = buildErrorResponse(
    {
      statusCode: 500,
      publicMessage,
    },
    {
      fallbackCode: 'internal_error',
      correlationId: req.correlationId,
    }
  );

  console.error(logLabel, {
    correlationId: req.correlationId,
    method: req.method,
    path: req.originalUrl,
    message: error?.message || 'Unknown error',
  });
  res.status(statusCode).json(payload);
}

function respondKnownError(req, res, {
  statusCode,
  publicMessage,
  fallbackCode,
  extraPayload = null,
}) {
  const { statusCode: resolvedStatusCode, payload } = buildErrorResponse(
    {
      statusCode,
      publicMessage,
    },
    {
      fallbackCode,
      correlationId: req.correlationId,
    }
  );

  res.status(resolvedStatusCode).json(extraPayload ? { ...payload, ...extraPayload } : payload);
}

async function requireAdminUser(req, res) {
  const authenticatedUser = await getAuthenticatedUser(req, { requireActiveSession: true, touchSession: true });

  if (!authenticatedUser) {
    respondKnownError(req, res, {
      statusCode: 401,
      publicMessage: 'Invalid, expired, or revoked session',
      fallbackCode: 'invalid_session',
    });
    return null;
  }

  if (!isAuthorizedDashboardUser(authenticatedUser)) {
    respondKnownError(req, res, {
      statusCode: 403,
      publicMessage: 'Acesso negado para este email.',
      fallbackCode: 'forbidden',
      extraPayload: {
        email: authenticatedUser.email || null,
      },
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
      userAgent: getRequestUserAgent(req),
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
    return respondKnownError(req, res, {
      statusCode: 400,
      publicMessage: 'Config type is required',
      fallbackCode: 'validation_failed',
    });
  }

  if (!authenticatedUser) {
    return respondKnownError(req, res, {
      statusCode: 401,
      publicMessage: 'Invalid, expired, or revoked session',
      fallbackCode: 'invalid_session',
    });
  }

  const ip = getRequestIp(req);
  const userAgent = getRequestUserAgent(req);

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
    respondInternalError(req, res, 'Sync error', 'System error', error);
  }
});

router.get('/dashboard', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const finalData = await getDashboardData();
    res.json(finalData);
  } catch (error) {
    respondInternalError(req, res, 'Dashboard error', 'Internal dashboard error', error);
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
    respondInternalError(req, res, 'Ops dashboard error', 'Internal ops dashboard error', error);
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
    respondInternalError(req, res, 'Dead letter list error', 'Internal dead letter list error', error);
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
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Command not found or not retryable',
        fallbackCode: 'not_found',
      });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_queue_retry', {
      queueCommandId: result.id,
      realmId: result.realmId,
      resetAttempts: Boolean(req.body?.resetAttempts),
    });

    res.json({ ok: true, item: result });
  } catch (error) {
    respondInternalError(req, res, 'Queue retry error', 'Internal queue retry error', error);
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
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Command not found or not dead-letterable',
        fallbackCode: 'not_found',
      });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_queue_dead_letter', {
      queueCommandId: result.id,
      realmId: result.realmId,
      reason: result.lastErrorCode,
    });

    res.json({ ok: true, item: result });
  } catch (error) {
    respondInternalError(req, res, 'Queue dead-letter error', 'Internal queue dead-letter error', error);
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
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Session not found or already revoked',
        fallbackCode: 'not_found',
      });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_revoke_session', {
      sessionId: revoked.id,
      targetUserId: revoked.userId,
      reason: revoked.revokeReason,
    });

    res.json({ ok: true, session: revoked });
  } catch (error) {
    respondInternalError(req, res, 'Admin revoke session error', 'Internal revoke session error', error);
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
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Agent not found',
        fallbackCode: 'not_found',
      });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_pause_agent', { agentId: agent.id });
    res.json({ ok: true, agent });
  } catch (error) {
    respondInternalError(req, res, 'Admin pause agent error', 'Internal pause agent error', error);
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
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Agent not found',
        fallbackCode: 'not_found',
      });
    }

    await appendAdminAuditLog(req, adminUser, 'admin_resume_agent', { agentId: agent.id });
    res.json({ ok: true, agent });
  } catch (error) {
    respondInternalError(req, res, 'Admin resume agent error', 'Internal resume agent error', error);
  }
});

router.post('/agents/:agentId/clear-quarantine', async (req, res) => {
  const adminUser = await requireAdminUser(req, res);
  if (!adminUser) return;

  try {
    const agent = await agentRepository.getAgentById(req.params.agentId);
    if (!agent) {
      return respondKnownError(req, res, {
        statusCode: 404,
        publicMessage: 'Agent not found',
        fallbackCode: 'not_found',
      });
    }

    await agentRepository.resetAgentEndpointHealth(req.params.agentId);
    const updatedAgent = await agentRepository.updateAgentStatusAdmin({
      agentId: req.params.agentId,
      status: ['paused', 'revoked'].includes(agent.status) ? agent.status : 'active',
    });

    await appendAdminAuditLog(req, adminUser, 'admin_clear_agent_quarantine', { agentId: req.params.agentId });
    res.json({ ok: true, agent: updatedAgent || agent });
  } catch (error) {
    respondInternalError(req, res, 'Admin clear quarantine error', 'Internal clear quarantine error', error);
  }
});

module.exports = router;
