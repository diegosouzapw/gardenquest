const express = require('express');
const { requireAuth } = require('../middleware/authenticate');
const config = require('../config');
const { insertLog } = require('../database/postgres');
const { getRequestIp, getRequestUserAgent } = require('../shared/request');
const { formatSuspicionDetails, validatePlayerCommandBody } = require('../games/garden-quest/command-security');

function parseSinceSeq(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function handleSseSubscriptionError(error, res, next) {
  if (error?.code === 'sse_capacity_exceeded') {
    return res.status(429).json({
      error: 'Realtime stream capacity reached. Try again in a few seconds.',
      code: error.code,
      details: error.details || null,
    });
  }

  return next(error);
}

async function logSuspiciousCommand(req, user, issues) {
  const details = formatSuspicionDetails(issues);
  const ip = getRequestIp(req);
  const userAgent = getRequestUserAgent(req);

  console.warn(`Suspicious player command blocked for user ${user?.id || 'unknown'}: ${details}`);

  try {
    await insertLog({
      event: 'suspicious_player_command',
      ip,
      userAgent,
      userId: user?.id || null,
      userName: user?.name || null,
      details,
      category: 'game',
    });
  } catch (error) {
    console.error('Suspicious command log failed:', error.message);
  }
}

function createAiGameRoutes({
  gameEngine = null,
  worldGateway = null,
  worldEventStreamService = null,
  worldRuntimeRepository = null,
} = {}) {
  const router = express.Router();

  router.get('/public-state-live', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      if (worldGateway) {
        return res.json(await worldGateway.getSpectatorState());
      }

      if (!gameEngine) {
        throw new Error('World runtime is not configured');
      }

      return res.json(await gameEngine.getPublicState(null));
    } catch (error) {
      next(error);
    }
  });

  router.get('/public-events', async (req, res, next) => {
    try {
      if (!worldRuntimeRepository) {
        return res.status(503).json({ error: 'World event feed is not configured.' });
      }

      const sinceSeq = parseSinceSeq(req.query.sinceSeq);
      const events = await worldRuntimeRepository.listWorldRuntimeEvents({
        realmId: config.REALM_ID,
        sinceSeq,
        limit: Math.min(200, Number.parseInt(req.query.limit || '100', 10) || 100),
        visibility: 'public',
      });

      return res.json({
        realmId: config.REALM_ID,
        sinceSeq,
        untilSeq: Number(events[events.length - 1]?.seq) || sinceSeq,
        entries: events,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/public-stream', async (req, res, next) => {
    try {
      if (!worldEventStreamService) {
        return res.status(503).json({ error: 'Realtime stream is not configured.' });
      }

      await worldEventStreamService.subscribePublic(req, res);
      return undefined;
    } catch (error) {
      return handleSseSubscriptionError(error, res, next);
    }
  });

  router.use(requireAuth);

  router.get('/stream', async (req, res, next) => {
    try {
      if (!worldEventStreamService) {
        return res.status(503).json({ error: 'Realtime stream is not configured.' });
      }

      await worldEventStreamService.subscribePlayer(req, res, req.authUser);
      return undefined;
    } catch (error) {
      return handleSseSubscriptionError(error, res, next);
    }
  });

  router.get('/events', async (req, res, next) => {
    try {
      if (!worldRuntimeRepository) {
        return res.status(503).json({ error: 'World event feed is not configured.' });
      }

      const sinceSeq = parseSinceSeq(req.query.sinceSeq);
      const events = await worldRuntimeRepository.listWorldRuntimeEvents({
        realmId: config.REALM_ID,
        sinceSeq,
        limit: Math.min(200, Number.parseInt(req.query.limit || '100', 10) || 100),
        visibility: 'public',
      });

      return res.json({
        realmId: config.REALM_ID,
        sinceSeq,
        untilSeq: Number(events[events.length - 1]?.seq) || sinceSeq,
        entries: events,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/public-state', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      if (worldGateway) {
        return res.json(await worldGateway.getPublicState(req.authUser));
      }

      if (!gameEngine) {
        throw new Error('World runtime is not configured');
      }

      return res.json(await gameEngine.getPublicState(req.authUser));
    } catch (error) {
      next(error);
    }
  });

  router.get('/bootstrap-state', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      if (!gameEngine) {
        return res.json({
          serverTime: new Date().toISOString(),
          worldVersion: 0,
          settings: {},
          world: null,
        });
      }
      return res.json(await gameEngine.getBootstrapState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/command', async (req, res) => {
    const validation = validatePlayerCommandBody(req.body, {
      chatMaxChars: config.PLAYER_CHAT_MAX_CHARS,
    });

    if (validation.suspiciousIssues.length > 0) {
      await logSuspiciousCommand(req, req.authUser, validation.suspiciousIssues);
      return res.status(400).json({ error: 'Seu comando nao pode ser processado com seguranca.' });
    }

    if (!validation.ok || !validation.normalizedCommand) {
      return res.status(400).json({ error: 'Comando invalido.' });
    }

    const result = worldGateway
      ? { ok: true, queued: true, queueAccepted: Boolean(await worldGateway.enqueuePlayerCommand(req.authUser, validation.normalizedCommand)) }
      : await gameEngine.applyPlayerCommand(req.authUser, validation.normalizedCommand);

    if (!result?.ok) {
      return res.status(result?.statusCode || 400).json({
        error: result?.publicError || 'Nao foi possivel executar o comando.',
      });
    }

    return res.json(result);
  });

  return router;
}

module.exports = createAiGameRoutes;
