const config = require('../../config');

function buildEmptySnapshot(user = null) {
  return {
    serverTime: new Date().toISOString(),
    tick: 0,
    settings: {
      playerMoveSpeed: config.PLAYER_MOVE_SPEED,
      playerRunSpeed: config.PLAYER_RUN_SPEED,
      chatMaxChars: config.PLAYER_CHAT_MAX_CHARS,
      nicknameMaxChars: 24,
    },
    self: user ? {
      id: user.id, actorType: 'player', name: user.name || 'Jogador',
      status: 'loading', currentAction: 'wait',
      position: { x: 0, y: 0, z: 0 }, rotationY: 0,
      appearance: { outfitColor: '#2563eb' },
      inventory: { apples: 0, food: 100, water: 100, score: 0, bestScore: 0 },
      availableActions: {}, speech: null, speechVisible: false,
      vitals: { food: 100, water: 100 },
      score: 0, bestScore: 0, deaths: 0, respawns: 0, respawnCountdownMs: 0,
    } : null,
    players: [], agents: [], ai: null, world: null,
    leaderboard: { updatedAt: null, entries: [] },
    soccerLeaderboard: { updatedAt: null, entries: [] },
    playerChat: { entries: [] },
    runtime: { snapshotMode: 'database', snapshotUpdatedAt: null, snapshotVersion: 0, stale: true, realmId: config.REALM_ID },
  };
}

class WorldRuntimeGateway {
  constructor({ worldRuntimeRepository, realmId = config.REALM_ID, snapshotTtlMs = 15000, logger = console } = {}) {
    this.worldRuntimeRepository = worldRuntimeRepository;
    this.realmId = realmId;
    this.snapshotTtlMs = Math.max(1000, Number(snapshotTtlMs) || 15000);
    this.logger = logger;
  }

  async touchPlayerSession(user) {
    if (!user?.id) return null;
    return this.worldRuntimeRepository.enqueueWorldCommand({
      realmId: this.realmId, commandType: 'touch_session', actorId: user.id, actorType: 'player',
      payloadJson: { user }, dedupeKey: `touch_session:${user.id}`,
    });
  }

  async enqueuePlayerCommand(user, command) {
    if (!user?.id) throw new Error('User session is required');
    return this.worldRuntimeRepository.enqueueWorldCommand({
      realmId: this.realmId, commandType: 'player_command', actorId: user.id, actorType: 'player',
      payloadJson: { user, command },
    });
  }

  async disconnectPlayer(userId, reason = 'disconnect') {
    if (!userId) return null;
    return this.worldRuntimeRepository.enqueueWorldCommand({
      realmId: this.realmId, commandType: 'disconnect_player', actorId: userId, actorType: 'player',
      payloadJson: { userId, reason }, dedupeKey: `disconnect_player:${userId}`,
    });
  }

  async hydrateSnapshotState({ snapshotRow = null, actorRow = null, user = null, snapshotMode = 'database' } = {}) {
    if (!snapshotRow?.snapshotJson) return buildEmptySnapshot(user);
    const snapshotJson = snapshotRow.snapshotJson || {};
    const snapshotUpdatedAt = snapshotRow.updatedAt ? new Date(snapshotRow.updatedAt).getTime() : 0;
    const stale = !snapshotUpdatedAt || (Date.now() - snapshotUpdatedAt) > this.snapshotTtlMs;
    return {
      ...snapshotJson,
      self: actorRow?.payloadJson || snapshotJson.self || (user ? buildEmptySnapshot(user).self : null),
      runtime: {
        snapshotMode, snapshotUpdatedAt: snapshotRow.updatedAt ? new Date(snapshotRow.updatedAt).toISOString() : null,
        snapshotVersion: Number(snapshotRow.snapshotVersion) || 0, stale, realmId: this.realmId,
      },
    };
  }

  async getPublicState(user) {
    if (user?.id) await this.touchPlayerSession(user);
    const [snapshotRow, actorRow] = await Promise.all([
      this.worldRuntimeRepository.getLatestWorldRuntimeSnapshot(this.realmId),
      user?.id ? this.worldRuntimeRepository.getActorRuntimeSnapshot(this.realmId, user.id) : Promise.resolve(null),
    ]);
    return this.hydrateSnapshotState({ snapshotRow, actorRow, user });
  }
}

module.exports = { WorldRuntimeGateway };
