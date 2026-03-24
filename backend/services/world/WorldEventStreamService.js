const config = require('../../config');

function writeSseEvent(res, { event = 'message', data = null, id = null, retry = null } = {}) {
  if (res.writableEnded || res.destroyed) return false;
  let buffer = '';
  if (retry != null) buffer += `retry: ${Math.max(1000, Math.trunc(retry) || 1000)}\n`;
  if (id != null) buffer += `id: ${String(id)}\n`;
  if (event) buffer += `event: ${event}\n`;
  const serialized = JSON.stringify(data == null ? {} : data);
  serialized.split(/\r?\n/).forEach((line) => { buffer += `data: ${line}\n`; });
  buffer += '\n';
  res.write(buffer);
  return true;
}

function writeSseComment(res, comment = 'ping') {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`: ${comment}\n\n`);
  return true;
}

class WorldEventStreamService {
  constructor({
    worldRuntimeRepository, worldGateway, realmId = config.REALM_ID,
    pollMs = config.WORLD_EVENT_STREAM_POLL_MS, heartbeatMs = config.WORLD_EVENT_STREAM_HEARTBEAT_MS,
    touchSessionMs = config.WORLD_EVENT_STREAM_TOUCH_MS, reconnectMs = 3000, logger = console,
  } = {}) {
    this.worldRuntimeRepository = worldRuntimeRepository;
    this.worldGateway = worldGateway;
    this.realmId = realmId;
    this.pollMs = Math.max(200, Number(pollMs) || 500);
    this.heartbeatMs = Math.max(5000, Number(heartbeatMs) || 15000);
    this.touchSessionMs = Math.max(5000, Number(touchSessionMs) || 10000);
    this.reconnectMs = Math.max(1000, Number(reconnectMs) || 3000);
    this.logger = logger;
    this.subscribers = new Map();
    this.nextSubscriberId = 1;
    this.lastBroadcastCursor = '';
    this.lastBroadcastSnapshotRow = null;
    this.pollHandle = null;
    this.heartbeatHandle = null;
    this.pollInFlight = false;
  }

  start() {
    if (!config.WORLD_EVENT_STREAM_ENABLED || this.pollHandle || this.heartbeatHandle) return;
    this.pollHandle = setInterval(() => { this.poll().catch((e) => this.logger.error('SSE poll failed:', e.message)); }, this.pollMs);
    this.heartbeatHandle = setInterval(() => { this.sendHeartbeats().catch((e) => this.logger.error('SSE heartbeat failed:', e.message)); }, this.heartbeatMs);
    this.pollHandle.unref?.();
    this.heartbeatHandle.unref?.();
  }

  stop() {
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
    if (this.heartbeatHandle) { clearInterval(this.heartbeatHandle); this.heartbeatHandle = null; }
    for (const subscriber of this.subscribers.values()) { try { subscriber.res.end(); } catch (e) { /* ignore */ } }
    this.subscribers.clear();
  }

  getStats() {
    let publicSubscribers = 0, playerSubscribers = 0;
    for (const subscriber of this.subscribers.values()) { subscriber.kind === 'public' ? publicSubscribers++ : playerSubscribers++; }
    return { enabled: Boolean(config.WORLD_EVENT_STREAM_ENABLED), totalSubscribers: this.subscribers.size, publicSubscribers, playerSubscribers, lastBroadcastCursor: this.lastBroadcastCursor || null, realmId: this.realmId };
  }

  async subscribePublic(req, res) { return this.subscribe(req, res, { kind: 'public', user: null }); }
  async subscribePlayer(req, res, user) { return this.subscribe(req, res, { kind: 'player', user }); }

  async subscribe(req, res, { kind = 'public', user = null } = {}) {
    if (!config.WORLD_EVENT_STREAM_ENABLED) { res.status(503).json({ error: 'Realtime stream is disabled.' }); return null; }
    this.start();
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const id = `sse-${this.nextSubscriberId++}`;
    const subscriber = { id, kind, user, res, connectedAt: Date.now(), lastTouchAt: 0, lastSentCursor: '' };
    this.subscribers.set(id, subscriber);
    const cleanup = () => { this.subscribers.delete(id); };
    req.on('close', cleanup); req.on('end', cleanup); res.on('close', cleanup);
    writeSseEvent(res, { event: 'connected', retry: this.reconnectMs, data: { connectionId: id, streamKind: kind, realmId: this.realmId, connectedAt: new Date().toISOString() } });
    await this.touchSubscriber(subscriber, true);
    await this.sendInitialSnapshot(subscriber);
    return id;
  }

  buildCursor(snapshotRow) {
    if (!snapshotRow) return '';
    return `${Number(snapshotRow.snapshotVersion) || 0}:${snapshotRow.updatedAt ? new Date(snapshotRow.updatedAt).toISOString() : ''}`;
  }

  async sendInitialSnapshot(subscriber) {
    const snapshotRow = this.lastBroadcastSnapshotRow || await this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId);
    const payload = await this.buildPayloadForSubscriber(subscriber, snapshotRow);
    const cursor = this.buildCursor(snapshotRow) || 'bootstrap';
    subscriber.lastSentCursor = cursor;
    writeSseEvent(subscriber.res, { event: 'snapshot', id: cursor, data: payload });
  }

  async buildPayloadForSubscriber(subscriber, snapshotRow) {
    if (subscriber.kind === 'public') return this.worldGateway.hydrateSnapshotState({ snapshotRow, user: null, snapshotMode: 'sse' });
    const actorRow = subscriber.user?.id ? await this.worldRuntimeRepository.getActorRuntimeSnapshot(this.realmId, subscriber.user.id) : null;
    return this.worldGateway.hydrateSnapshotState({ snapshotRow, actorRow, user: subscriber.user || null, snapshotMode: 'sse' });
  }

  async touchSubscriber(subscriber, force = false) {
    if (subscriber.kind !== 'player' || !subscriber.user?.id) return;
    const now = Date.now();
    if (!force && (now - subscriber.lastTouchAt) < this.touchSessionMs) return;
    subscriber.lastTouchAt = now;
    await this.worldGateway.touchPlayerSession(subscriber.user).catch((e) => this.logger.warn(`Failed to touch player for stream ${subscriber.id}:`, e.message));
  }

  async poll() {
    if (this.pollInFlight || this.subscribers.size < 1) return;
    this.pollInFlight = true;
    try {
      const snapshotRow = await this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId);
      const cursor = this.buildCursor(snapshotRow);
      const changed = cursor && cursor !== this.lastBroadcastCursor;
      if (changed) {
        this.lastBroadcastCursor = cursor;
        this.lastBroadcastSnapshotRow = snapshotRow;
        await this.broadcastSnapshot(snapshotRow, cursor);
      } else {
        await Promise.all(Array.from(this.subscribers.values()).map((s) => this.touchSubscriber(s, false)));
      }
    } finally { this.pollInFlight = false; }
  }

  async broadcastSnapshot(snapshotRow, cursor) {
    const subscribers = Array.from(this.subscribers.values());
    const publicPayload = await this.buildPayloadForSubscriber({ kind: 'public' }, snapshotRow);
    await Promise.all(subscribers.map(async (subscriber) => {
      if (subscriber.kind === 'public') { subscriber.lastSentCursor = cursor; writeSseEvent(subscriber.res, { event: 'snapshot', id: cursor, data: publicPayload }); return; }
      await this.touchSubscriber(subscriber, false);
      const payload = await this.buildPayloadForSubscriber(subscriber, snapshotRow);
      subscriber.lastSentCursor = cursor;
      writeSseEvent(subscriber.res, { event: 'snapshot', id: cursor, data: payload });
    }));
  }

  async sendHeartbeats() {
    await Promise.all(Array.from(this.subscribers.values()).map(async (subscriber) => {
      await this.touchSubscriber(subscriber, false);
      writeSseComment(subscriber.res, `heartbeat ${new Date().toISOString()}`);
    }));
  }
}

module.exports = { WorldEventStreamService };
