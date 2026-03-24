const { Client } = require('pg');
const config = require('../../config');
const { getStandaloneClientConfig } = require('../../database/postgres');

function normalizeChannel(channel) {
  const value = String(channel || '').trim();
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Invalid Postgres notification channel: ${value || '<empty>'}`);
  return value;
}

class PostgresNotificationBus {
  constructor({ channel, name = null, reconnectMs = config.WORLD_RUNTIME_BUS_RECONNECT_MS, logger = console } = {}) {
    this.channel = normalizeChannel(channel);
    this.name = name || this.channel;
    this.reconnectMs = Math.max(500, Number(reconnectMs) || 2000);
    this.logger = logger;
    this.handlers = new Set();
    this.client = null;
    this.started = false;
    this.connecting = false;
    this.reconnectHandle = null;
    this.stats = { connected: false, connects: 0, disconnects: 0, notifications: 0, parseErrors: 0, lastPayloadAt: null, lastError: null, lastConnectedAt: null };
    this._handleNotification = this._handleNotification.bind(this);
    this._handleError = this._handleError.bind(this);
    this._handleEnd = this._handleEnd.bind(this);
  }

  subscribe(handler) {
    if (typeof handler !== 'function') return () => {};
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  getStats() { return { channel: this.channel, name: this.name, started: this.started, handlerCount: this.handlers.size, ...this.stats }; }

  async start() { if (this.started) return; this.started = true; await this._connect(); }

  async stop() {
    this.started = false;
    this._clearReconnect();
    if (!this.client) { this.stats.connected = false; return; }
    const client = this.client; this.client = null;
    client.removeListener('notification', this._handleNotification);
    client.removeListener('error', this._handleError);
    client.removeListener('end', this._handleEnd);
    try { await client.end(); } catch (e) { /* ignore */ } finally { this.stats.connected = false; }
  }

  _clearReconnect() { if (this.reconnectHandle) { clearTimeout(this.reconnectHandle); this.reconnectHandle = null; } }

  async _connect() {
    if (!this.started || this.connecting || this.client) return;
    this.connecting = true;
    const client = new Client(getStandaloneClientConfig());
    try {
      client.on('notification', this._handleNotification);
      client.on('error', this._handleError);
      client.on('end', this._handleEnd);
      await client.connect();
      await client.query(`LISTEN ${this.channel}`);
      this.client = client;
      this.stats.connected = true; this.stats.connects += 1; this.stats.lastError = null; this.stats.lastConnectedAt = new Date().toISOString();
    } catch (error) {
      this.stats.lastError = error.message;
      this.logger.error(`PG notify bus (${this.name}) connect failed:`, error.message);
      try { await client.end(); } catch (e) { /* ignore */ }
      this._scheduleReconnect();
    } finally { this.connecting = false; }
  }

  _scheduleReconnect() {
    if (!this.started || this.reconnectHandle) return;
    this.reconnectHandle = setTimeout(() => { this.reconnectHandle = null; this._connect().catch((e) => this.logger.error(`PG notify bus (${this.name}) reconnect failed:`, e.message)); }, this.reconnectMs);
    this.reconnectHandle.unref?.();
  }

  _handleEnd() {
    if (this.client) { this.client.removeListener('notification', this._handleNotification); this.client.removeListener('error', this._handleError); this.client.removeListener('end', this._handleEnd); this.client = null; }
    this.stats.connected = false; this.stats.disconnects += 1;
    this._scheduleReconnect();
  }

  _handleError(error) { this.stats.lastError = error.message; this.logger.error(`PG notify bus (${this.name}) error:`, error.message); }

  _handleNotification(message) {
    if (!message || message.channel !== this.channel) return;
    let payload = {};
    if (message.payload) { try { payload = JSON.parse(message.payload); } catch (e) { this.stats.parseErrors += 1; payload = { raw: message.payload }; } }
    this.stats.notifications += 1; this.stats.lastPayloadAt = new Date().toISOString();
    for (const handler of this.handlers) { Promise.resolve().then(() => handler(payload, message)).catch((e) => this.logger.error(`PG notify bus (${this.name}) handler failed:`, e.message)); }
  }
}

module.exports = { PostgresNotificationBus };
