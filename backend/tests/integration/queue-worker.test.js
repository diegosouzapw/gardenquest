const test = require('node:test');
const assert = require('node:assert/strict');

const { WorldRuntimeWorker } = require('../../services/world/WorldRuntimeWorker');

function createBaseRuntimeEngine(overrides = {}) {
  return {
    start() {},
    async stop() {},
    getRuntimeStatus() {
      return {
        realmLease: {
          isLeader: true,
          localInstanceId: 'worker-test-instance',
        },
      };
    },
    async touchPlayerSession() {
      return { ok: true };
    },
    async applyPlayerCommand() {
      return { ok: true };
    },
    disconnectPlayer() {},
    async exportRuntimeSnapshot() {
      return {
        tick: 1,
        publicState: {
          serverTime: new Date().toISOString(),
          tick: 1,
          players: [],
          playerChat: { entries: [] },
          world: {
            soccer: {
              lastGoalEvent: null,
            },
          },
          leaderboard: { updatedAt: null, entries: [] },
        },
        actorSnapshots: [],
      };
    },
    ...overrides,
  };
}

function createBaseRepository(overrides = {}) {
  return {
    async claimPendingWorldCommands() {
      return [];
    },
    async completeWorldCommand() {},
    async requeueWorldCommand() {},
    async getLatestWorldRuntimeSnapshot() {
      return null;
    },
    async upsertWorldRuntimeSnapshot() {},
    ...overrides,
  };
}

test('queue worker marks command as done when command execution succeeds', async () => {
  const completed = [];
  const repository = createBaseRepository({
    async claimPendingWorldCommands() {
      return [
        {
          id: 501,
          commandType: 'touch_session',
          attempts: 1,
          maxAttempts: 3,
          payloadJson: {
            user: {
              id: 'player-1',
              name: 'Jogador 1',
            },
          },
        },
      ];
    },
    async completeWorldCommand(payload) {
      completed.push(payload);
    },
  });

  const worker = new WorldRuntimeWorker({
    aiGameEngine: createBaseRuntimeEngine(),
    worldRuntimeRepository: repository,
    realmId: 'realm-test',
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.processCommandQueue();

  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, 501);
  assert.equal(completed[0].status, 'done');
  assert.equal(completed[0].resultJson.ok, true);
});

test('queue worker requeues retryable command errors with delay', async () => {
  const requeued = [];
  const completed = [];
  const repository = createBaseRepository({
    async claimPendingWorldCommands() {
      return [
        {
          id: 777,
          commandType: 'player_command',
          attempts: 1,
          maxAttempts: 4,
          payloadJson: {
            user: { id: 'player-2' },
            command: { type: 'set_input', payload: { moveX: 1, moveZ: 0 } },
          },
        },
      ];
    },
    async completeWorldCommand(payload) {
      completed.push(payload);
    },
    async requeueWorldCommand(payload) {
      requeued.push(payload);
    },
  });

  const worker = new WorldRuntimeWorker({
    aiGameEngine: createBaseRuntimeEngine({
      async applyPlayerCommand() {
        const error = new Error('upstream temporary rate limit');
        error.code = 'rate_limited';
        throw error;
      },
    }),
    worldRuntimeRepository: repository,
    realmId: 'realm-test',
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.processCommandQueue();

  assert.equal(completed.length, 0);
  assert.equal(requeued.length, 1);
  assert.equal(requeued[0].id, 777);
  assert.equal(requeued[0].errorCode, 'rate_limited');
  assert.ok((requeued[0].delayMs || 0) >= 1200);
});

test('queue worker flushes snapshot and persists derived runtime events', async () => {
  const upserts = [];
  const repository = createBaseRepository({
    async getLatestWorldRuntimeSnapshot() {
      return {
        snapshotVersion: 10,
        snapshotJson: {
          serverTime: '2026-01-01T00:00:00.000Z',
          tick: 10,
          players: [],
          playerChat: { entries: [] },
          world: {
            soccer: {
              lastGoalEvent: {
                sequence: 0,
              },
            },
          },
          leaderboard: { updatedAt: null, entries: [] },
        },
      };
    },
    async upsertWorldRuntimeSnapshot(payload) {
      upserts.push(payload);
    },
  });

  const worker = new WorldRuntimeWorker({
    aiGameEngine: createBaseRuntimeEngine({
      async exportRuntimeSnapshot() {
        return {
          tick: 11,
          publicState: {
            serverTime: '2026-01-01T00:00:10.000Z',
            tick: 11,
            players: [
              { id: 'player-7', actorType: 'player', name: 'Jogador Sete' },
            ],
            playerChat: {
              entries: [
                { id: 1, playerId: 'player-7', playerName: 'Jogador Sete', message: 'oi' },
              ],
            },
            world: {
              soccer: {
                lastGoalEvent: {
                  sequence: 1,
                  playerName: 'Jogador Sete',
                  scorerActorId: 'player-7',
                },
              },
            },
            leaderboard: {
              updatedAt: '2026-01-01T00:00:10.000Z',
              entries: [
                { rank: 1, actorType: 'player', actorName: 'Jogador Sete', bestScore: 12 },
              ],
            },
          },
          actorSnapshots: [],
        };
      },
    }),
    worldRuntimeRepository: repository,
    realmId: 'realm-test',
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.flushSnapshots();

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].snapshotVersion, 11);
  assert.ok(Array.isArray(upserts[0].runtimeEvents));
  assert.ok(upserts[0].runtimeEvents.some((event) => event.eventType === 'actor_joined'));
  assert.ok(upserts[0].runtimeEvents.some((event) => event.eventType === 'chat_message'));
  assert.ok(upserts[0].runtimeEvents.some((event) => event.eventType === 'soccer_goal'));
});
