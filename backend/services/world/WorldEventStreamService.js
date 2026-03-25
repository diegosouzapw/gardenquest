const config = require('../../config');
const { buildSnapshotDelta } = require('./WorldDeltaService');

function writeSseEvent(res, { event = 'message', data = null, id = null, retry = null } = {}) {
  if (res.writableEnded || res.destroyed) {
    return false;
  }

  let buffer = '';
  if (retry != null) {
    buffer += `retry: ${Math.max(1000, Math.trunc(retry) || 1000)}\n`;
  }
  if (id != null) {
    buffer += `id: ${String(id)}\n`;
  }
  if (event) {
    buffer += `event: ${event}\n`;
  }

  const serialized = JSON.stringify(data == null ? {} : data);
  serialized.split(/\r?\n/).forEach((line) => {
    buffer += `data: ${line}\n`;
  });
  buffer += '\n';

  res.write(buffer);
  return true;
}

function writeSseComment(res, comment = 'ping') {
  if (res.writableEnded || res.destroyed) {
    return false;
  }

  res.write(`: ${comment}\n\n`);
  return true;
}

function parseLastEventSeq(value) {
  const text = String(Array.isArray(value) ? value[0] : value || '').trim();
  if (!text) {
    return 0;
  }

  const normalized = text.includes(':')
    ? text.split(':').pop()
    : text;
  const match = normalized.match(/^(\d+)$/);
  return match ? (Number.parseInt(match[1], 10) || 0) : 0;
}

/**
 * Manages SSE subscriptions for realtime world updates and event batches.
 */
class WorldEventStreamService {
  constructor({
    worldRuntimeRepository,
    worldGateway,
    realmId = config.REALM_ID,
    pollMs = config.WORLD_EVENT_STREAM_POLL_MS,
    heartbeatMs = config.WORLD_EVENT_STREAM_HEARTBEAT_MS,
    touchSessionMs = config.WORLD_EVENT_STREAM_TOUCH_MS,
    reconnectMs = 3000,
    snapshotEveryVersions = config.WORLD_EVENT_STREAM_SNAPSHOT_EVERY,
    maxSubscribers = config.WORLD_EVENT_STREAM_MAX_SUBSCRIBERS,
    maxPublicSubscribers = config.WORLD_EVENT_STREAM_MAX_PUBLIC_SUBSCRIBERS,
    maxPlayerSubscribers = config.WORLD_EVENT_STREAM_MAX_PLAYER_SUBSCRIBERS,
    notificationBus = null,
    fallbackPollMs = config.WORLD_EVENT_STREAM_FALLBACK_POLL_MS,
    logger = console,
  } = {}) {
    this.worldRuntimeRepository = worldRuntimeRepository;
    this.worldGateway = worldGateway;
    this.realmId = realmId;
    this.pollMs = Math.max(200, Number(pollMs) || 500);
    this.heartbeatMs = Math.max(5000, Number(heartbeatMs) || 15000);
    this.touchSessionMs = Math.max(5000, Number(touchSessionMs) || 10000);
    this.reconnectMs = Math.max(1000, Number(reconnectMs) || 3000);
    this.snapshotEveryVersions = Math.max(1, Number(snapshotEveryVersions) || 8);
    this.maxSubscribers = Math.max(1, Number(maxSubscribers) || 300);
    this.maxPublicSubscribers = Math.max(
      1,
      Math.min(this.maxSubscribers, Number(maxPublicSubscribers) || this.maxSubscribers)
    );
    this.maxPlayerSubscribers = Math.max(
      1,
      Math.min(this.maxSubscribers, Number(maxPlayerSubscribers) || this.maxSubscribers)
    );
    this.logger = logger;
    this.notificationBus = notificationBus;
    this.fallbackPollMs = Math.max(1000, Number(fallbackPollMs) || 5000);
    this.subscribers = new Map();
    this.nextSubscriberId = 1;
    this.lastBroadcastCursor = '';
    this.lastBroadcastSnapshotRow = null;
    this.lastBroadcastEventSeq = 0;
    this.pollHandle = null;
    this.heartbeatHandle = null;
    this.pollInFlight = false;
    this.busUnsubscribe = null;
    this.busNotifications = 0;
    this.busWakeups = 0;
    this.handleRuntimeNotification = this.handleRuntimeNotification.bind(this);
  }

  /**
   * Starts polling, heartbeat loops and optional notification bus subscription.
   * Idempotent when already started or when stream feature is disabled.
   * @returns {void}
   */
  start() {
    if (!config.WORLD_EVENT_STREAM_ENABLED || this.pollHandle || this.heartbeatHandle) {
      return;
    }

    if (this.notificationBus && !this.busUnsubscribe) {
      this.busUnsubscribe = this.notificationBus.subscribe(this.handleRuntimeNotification);
      this.notificationBus.start().catch((error) => {
        this.logger.error('World event stream bus start failed:', error.message);
      });
    }

    this.pollHandle = setInterval(() => {
      this.poll().catch((error) => {
        this.logger.error('World event stream poll failed:', error.message);
      });
    }, this.notificationBus ? this.fallbackPollMs : this.pollMs);

    this.heartbeatHandle = setInterval(() => {
      this.sendHeartbeats().catch((error) => {
        this.logger.error('World event stream heartbeat failed:', error.message);
      });
    }, this.heartbeatMs);

    this.pollHandle.unref?.();
    this.heartbeatHandle.unref?.();
  }

  /**
   * Stops loops/bus and closes all active SSE subscribers.
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }

    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }

    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }

    if (this.notificationBus) {
      await this.notificationBus.stop().catch(() => {});
    }

    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.res.end();
      } catch (_error) {
        // ignore
      }
    }

    this.subscribers.clear();
  }

  /**
   * Returns runtime stats for health and observability endpoints.
   * @returns {{
   *   enabled: boolean,
   *   totalSubscribers: number,
   *   publicSubscribers: number,
   *   playerSubscribers: number,
   *   lastBroadcastCursor: string | null,
   *   lastBroadcastEventSeq: number,
   *   snapshotEveryVersions: number,
   *   realmId: string,
   *   busEnabled: boolean,
   *   busNotifications: number,
   *   busWakeups: number,
   *   bus: object | null
   * }}
   */
  getStats() {
    let publicSubscribers = 0;
    let playerSubscribers = 0;

    for (const subscriber of this.subscribers.values()) {
      if (subscriber.kind === 'public') {
        publicSubscribers += 1;
      } else {
        playerSubscribers += 1;
      }
    }

    return {
      enabled: Boolean(config.WORLD_EVENT_STREAM_ENABLED),
      totalSubscribers: this.subscribers.size,
      publicSubscribers,
      playerSubscribers,
      lastBroadcastCursor: this.lastBroadcastCursor || null,
      lastBroadcastEventSeq: this.lastBroadcastEventSeq || 0,
      snapshotEveryVersions: this.snapshotEveryVersions,
      maxSubscribers: this.maxSubscribers,
      maxPublicSubscribers: this.maxPublicSubscribers,
      maxPlayerSubscribers: this.maxPlayerSubscribers,
      realmId: this.realmId,
      busEnabled: Boolean(this.notificationBus),
      busNotifications: this.busNotifications,
      busWakeups: this.busWakeups,
      bus: this.notificationBus?.getStats?.() || null,
    };
  }

  /**
   * Registers a public/spectator SSE stream.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @returns {Promise<string|null>}
   */
  async subscribePublic(req, res) {
    return this.subscribe(req, res, { kind: 'public', user: null });
  }

  /**
   * Registers a player SSE stream tied to an authenticated user.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {{ id?: string } | null} user
   * @returns {Promise<string|null>}
   */
  async subscribePlayer(req, res, user) {
    return this.subscribe(req, res, { kind: 'player', user });
  }

  async subscribe(req, res, { kind = 'public', user = null } = {}) {
    if (!config.WORLD_EVENT_STREAM_ENABLED) {
      res.status(503).json({ error: 'Realtime stream is disabled.' });
      return null;
    }

    this.assertCapacity(kind);
    this.start();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const id = `sse-${this.nextSubscriberId++}`;
    const subscriber = {
      id,
      kind,
      user,
      res,
      connectedAt: Date.now(),
      lastTouchAt: 0,
      lastSentCursor: '',
      lastSeenEventSeq: parseLastEventSeq(req.headers['last-event-id']),
    };

    this.subscribers.set(id, subscriber);

    const cleanup = () => {
      this.subscribers.delete(id);
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
    res.on('close', cleanup);

    writeSseEvent(res, {
      event: 'connected',
      retry: this.reconnectMs,
      data: {
        connectionId: id,
        streamKind: kind,
        realmId: this.realmId,
        connectedAt: new Date().toISOString(),
      },
    });

    await this.touchSubscriber(subscriber, true);
    await this.sendInitialSnapshot(subscriber);
    if (subscriber.lastSeenEventSeq > 0) {
      await this.sendEventBatch(subscriber, subscriber.lastSeenEventSeq);
    }

    return id;
  }

  countSubscribersByKind(kind) {
    let count = 0;
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.kind === kind) {
        count += 1;
      }
    }
    return count;
  }

  assertCapacity(kind) {
    const totalSubscribers = this.subscribers.size;
    if (totalSubscribers >= this.maxSubscribers) {
      const error = new Error('Realtime stream capacity reached.');
      error.code = 'sse_capacity_exceeded';
      error.statusCode = 429;
      error.details = {
        scope: 'total',
        totalSubscribers,
        maxSubscribers: this.maxSubscribers,
      };
      throw error;
    }

    if (kind === 'public') {
      const publicSubscribers = this.countSubscribersByKind('public');
      if (publicSubscribers >= this.maxPublicSubscribers) {
        const error = new Error('Realtime public stream capacity reached.');
        error.code = 'sse_capacity_exceeded';
        error.statusCode = 429;
        error.details = {
          scope: 'public',
          publicSubscribers,
          maxPublicSubscribers: this.maxPublicSubscribers,
        };
        throw error;
      }
      return;
    }

    const playerSubscribers = this.countSubscribersByKind('player');
    if (playerSubscribers >= this.maxPlayerSubscribers) {
      const error = new Error('Realtime player stream capacity reached.');
      error.code = 'sse_capacity_exceeded';
      error.statusCode = 429;
      error.details = {
        scope: 'player',
        playerSubscribers,
        maxPlayerSubscribers: this.maxPlayerSubscribers,
      };
      throw error;
    }
  }

  buildCursor(snapshotRow) {
    if (!snapshotRow) {
      return '';
    }

    const version = Number(snapshotRow.snapshotVersion) || 0;
    const updatedAt = snapshotRow.updatedAt ? new Date(snapshotRow.updatedAt).toISOString() : '';
    return `${version}:${updatedAt}`;
  }

  async sendInitialSnapshot(subscriber) {
    const snapshotRow = this.lastBroadcastSnapshotRow
      || await this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId);
    const payload = await this.buildPayloadForSubscriber(subscriber, snapshotRow);
    const cursor = this.buildCursor(snapshotRow) || 'bootstrap';
    subscriber.lastSentCursor = cursor;

    writeSseEvent(subscriber.res, {
      event: 'snapshot',
      id: `snapshot:${cursor}`,
      data: payload,
    });
  }

  async buildPayloadForSubscriber(subscriber, snapshotRow) {
    if (subscriber.kind === 'public') {
      return this.worldGateway.hydrateSnapshotState({
        snapshotRow,
        user: null,
        snapshotMode: 'sse',
      });
    }

    const actorRow = subscriber.user?.id
      ? await this.worldRuntimeRepository.getActorRuntimeSnapshot(this.realmId, subscriber.user.id)
      : null;

    return this.worldGateway.hydrateSnapshotState({
      snapshotRow,
      actorRow,
      user: subscriber.user || null,
      snapshotMode: 'sse',
    });
  }

  async buildDeltaForSubscriber(subscriber, snapshotRow, previousSnapshotRow) {
    const fullPayload = await this.buildPayloadForSubscriber(subscriber, snapshotRow);
    return buildSnapshotDelta(previousSnapshotRow?.snapshotJson || null, snapshotRow?.snapshotJson || null, {
      selfPayload: subscriber.kind === 'player' ? fullPayload.self : undefined,
      runtimeMeta: fullPayload.runtime,
    });
  }

  async touchSubscriber(subscriber, force = false) {
    if (subscriber.kind !== 'player' || !subscriber.user?.id) {
      return;
    }

    const now = Date.now();
    if (!force && (now - subscriber.lastTouchAt) < this.touchSessionMs) {
      return;
    }

    subscriber.lastTouchAt = now;
    await this.worldGateway.touchPlayerSession(subscriber.user).catch((error) => {
      this.logger.warn(`Failed to touch player session for stream ${subscriber.id}:`, error.message);
    });
  }

  async listEventsSince(sinceSeq = 0) {
    return this.worldRuntimeRepository.listWorldRuntimeEvents({
      realmId: this.realmId,
      sinceSeq,
      limit: 200,
      visibility: 'public',
    });
  }

  async sendEventBatch(subscriber, sinceSeq = 0) {
    const events = await this.listEventsSince(sinceSeq);
    if (!events.length) {
      return 0;
    }

    const latestSeq = Number(events[events.length - 1]?.seq) || 0;
    subscriber.lastSeenEventSeq = latestSeq;

    writeSseEvent(subscriber.res, {
      event: 'world_event_batch',
      id: latestSeq,
      data: {
        realmId: this.realmId,
        sinceSeq: Math.max(0, Math.trunc(sinceSeq) || 0),
        untilSeq: latestSeq,
        entries: events,
      },
    });

    return latestSeq;
  }

  /**
   * Handles runtime bus notifications and triggers an immediate poll when applicable.
   * @param {{ realmId?: string }} [payload={}]
   * @returns {Promise<void>}
   */
  async handleRuntimeNotification(payload = {}) {
    if (this.subscribers.size < 1) {
      return;
    }

    if (payload.realmId && payload.realmId !== this.realmId) {
      return;
    }

    this.busNotifications += 1;
    this.busWakeups += 1;
    await this.poll();
  }

  async poll() {
    if (this.pollInFlight || this.subscribers.size < 1) {
      return;
    }

    this.pollInFlight = true;

    try {
      const snapshotRow = await this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId);
      const cursor = this.buildCursor(snapshotRow);
      const changed = cursor && cursor !== this.lastBroadcastCursor;

      if (changed) {
        const previousSnapshotRow = this.lastBroadcastSnapshotRow;
        const events = await this.listEventsSince(this.lastBroadcastEventSeq);
        if (events.length > 0) {
          this.lastBroadcastEventSeq = Number(events[events.length - 1].seq) || this.lastBroadcastEventSeq;
        }

        this.lastBroadcastCursor = cursor;
        this.lastBroadcastSnapshotRow = snapshotRow;
        await this.broadcastUpdate(snapshotRow, previousSnapshotRow, cursor, events);
      } else {
        await Promise.all(Array.from(this.subscribers.values()).map((subscriber) => this.touchSubscriber(subscriber, false)));
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  shouldSendFullSnapshot(snapshotRow, previousSnapshotRow) {
    if (!previousSnapshotRow) {
      return true;
    }

    const snapshotVersion = Number(snapshotRow?.snapshotVersion) || 0;
    return snapshotVersion < 1 || (snapshotVersion % this.snapshotEveryVersions) === 0;
  }

  async broadcastUpdate(snapshotRow, previousSnapshotRow, cursor, events) {
    const subscribers = Array.from(this.subscribers.values());
    const sendFullSnapshot = this.shouldSendFullSnapshot(snapshotRow, previousSnapshotRow);
    const publicPayload = sendFullSnapshot
      ? await this.buildPayloadForSubscriber({ kind: 'public' }, snapshotRow)
      : await this.buildDeltaForSubscriber({ kind: 'public' }, snapshotRow, previousSnapshotRow);
    const eventBatch = events.length > 0
      ? {
        realmId: this.realmId,
        sinceSeq: Math.max(0, (Number(events[0]?.seq) || 1) - 1),
        untilSeq: Number(events[events.length - 1]?.seq) || this.lastBroadcastEventSeq,
        entries: events,
      }
      : null;

    await Promise.all(subscribers.map(async (subscriber) => {
      await this.touchSubscriber(subscriber, false);

      const payload = subscriber.kind === 'public'
        ? publicPayload
        : (sendFullSnapshot
          ? await this.buildPayloadForSubscriber(subscriber, snapshotRow)
          : await this.buildDeltaForSubscriber(subscriber, snapshotRow, previousSnapshotRow));

      subscriber.lastSentCursor = cursor;
      writeSseEvent(subscriber.res, {
        event: sendFullSnapshot ? 'snapshot' : 'delta',
        id: sendFullSnapshot ? `snapshot:${cursor}` : `delta:${cursor}`,
        data: payload,
      });

      if (eventBatch) {
        subscriber.lastSeenEventSeq = eventBatch.untilSeq;
        writeSseEvent(subscriber.res, {
          event: 'world_event_batch',
          id: eventBatch.untilSeq,
          data: eventBatch,
        });
      }
    }));
  }

  async sendHeartbeats() {
    const subscribers = Array.from(this.subscribers.values());

    await Promise.all(subscribers.map(async (subscriber) => {
      await this.touchSubscriber(subscriber, false);
      writeSseComment(subscriber.res, `heartbeat ${new Date().toISOString()}`);
    }));
  }
}

module.exports = { WorldEventStreamService };
