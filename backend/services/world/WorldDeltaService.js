function stableSerialize(value) { return JSON.stringify(value == null ? null : value); }
function cloneJson(value, fallback = null) { return value == null ? fallback : JSON.parse(JSON.stringify(value)); }

function indexActors(list) {
  const map = new Map();
  for (const actor of Array.isArray(list) ? list : []) { if (actor?.id) map.set(String(actor.id), actor); }
  return map;
}

function computeActorDelta(previousActors, nextActors) {
  const previousMap = indexActors(previousActors);
  const nextMap = indexActors(nextActors);
  const upsert = [], removeIds = [];
  for (const [actorId, nextActor] of nextMap.entries()) {
    const prev = previousMap.get(actorId);
    if (!prev || stableSerialize(prev) !== stableSerialize(nextActor)) upsert.push(cloneJson(nextActor, {}));
  }
  for (const actorId of previousMap.keys()) { if (!nextMap.has(actorId)) removeIds.push(actorId); }
  return { upsert, removeIds };
}

function computeChatDelta(previousChat, nextChat) {
  const prev = Array.isArray(previousChat?.entries) ? previousChat.entries : [];
  const next = Array.isArray(nextChat?.entries) ? nextChat.entries : [];
  const prevIds = new Set(prev.map((e) => Number(e?.id) || 0));
  const appended = next.filter((e) => !prevIds.has(Number(e?.id) || 0));
  const reset = appended.length > next.length || next.length < prev.length;
  return { reset, entries: cloneJson(reset ? next : appended, []) };
}

function buildSnapshotDelta(previousSnapshot, nextSnapshot, { selfPayload = undefined, runtimeMeta = undefined } = {}) {
  const prev = previousSnapshot || {}, next = nextSnapshot || {};
  const delta = { serverTime: next.serverTime || new Date().toISOString(), tick: Number(next.tick) || 0 };
  if (selfPayload !== undefined) delta.self = cloneJson(selfPayload, null);
  if (runtimeMeta !== undefined) delta.runtime = cloneJson(runtimeMeta, {});
  if (stableSerialize(prev.settings) !== stableSerialize(next.settings)) delta.settings = cloneJson(next.settings, null);
  const actorDelta = computeActorDelta(prev.players, next.players);
  if (actorDelta.upsert.length > 0 || actorDelta.removeIds.length > 0) delta.players = actorDelta;
  if (stableSerialize(prev.ai) !== stableSerialize(next.ai)) delta.ai = cloneJson(next.ai, null);
  const prevW = prev.world || null, nextW = next.world || null;
  if (stableSerialize(prevW) !== stableSerialize(nextW)) {
    delta.world = {};
    if (stableSerialize(prevW?.trees) !== stableSerialize(nextW?.trees)) delta.world.trees = cloneJson(nextW?.trees, []);
    if (stableSerialize(prevW?.droppedApples) !== stableSerialize(nextW?.droppedApples)) delta.world.droppedApples = cloneJson(nextW?.droppedApples, []);
    if (stableSerialize(prevW?.graves) !== stableSerialize(nextW?.graves)) delta.world.graves = cloneJson(nextW?.graves, []);
    if (stableSerialize(prevW?.soccer) !== stableSerialize(nextW?.soccer)) delta.world.soccer = cloneJson(nextW?.soccer, null);
    if (prevW?.bounds !== nextW?.bounds) delta.world.bounds = Number(nextW?.bounds) || 0;
  }
  if (stableSerialize(prev.leaderboard) !== stableSerialize(next.leaderboard)) delta.leaderboard = cloneJson(next.leaderboard, null);
  if (stableSerialize(prev.soccerLeaderboard) !== stableSerialize(next.soccerLeaderboard)) delta.soccerLeaderboard = cloneJson(next.soccerLeaderboard, null);
  const chatDelta = computeChatDelta(prev.playerChat, next.playerChat);
  if (chatDelta.entries.length > 0 || chatDelta.reset) delta.playerChat = chatDelta;
  return delta;
}

function actorLabel(actor) { return actor?.actorType === 'agent' ? `🤖 ${actor.name || 'Agente'}` : actor?.name || 'Jogador'; }

function buildRuntimeEvents(previousSnapshot, nextSnapshot, snapshotVersion) {
  const prev = previousSnapshot || {}, next = nextSnapshot || {};
  const events = [];
  if (!previousSnapshot || Object.keys(previousSnapshot).length === 0) return events;
  const prevActors = indexActors(prev.players), nextActors = indexActors(next.players);
  for (const [actorId, actor] of nextActors.entries()) {
    if (!prevActors.has(actorId)) events.push({ eventType: 'actor_joined', visibility: 'public', actorId, actorType: actor.actorType || 'player', snapshotVersion, payloadJson: { actorId, actorType: actor.actorType || 'player', actorName: actor.name || 'Jogador', label: actorLabel(actor), joinedAt: next.serverTime || new Date().toISOString() } });
  }
  for (const [actorId, actor] of prevActors.entries()) {
    if (!nextActors.has(actorId)) events.push({ eventType: 'actor_left', visibility: 'public', actorId, actorType: actor.actorType || 'player', snapshotVersion, payloadJson: { actorId, actorType: actor.actorType || 'player', actorName: actor.name || 'Jogador', label: actorLabel(actor), leftAt: next.serverTime || new Date().toISOString() } });
  }
  const prevChat = Array.isArray(prev.playerChat?.entries) ? prev.playerChat.entries : [];
  const prevChatIds = new Set(prevChat.map((e) => Number(e?.id) || 0));
  (Array.isArray(next.playerChat?.entries) ? next.playerChat.entries : [])
    .filter((e) => !prevChatIds.has(Number(e?.id) || 0))
    .forEach((e) => events.push({ eventType: 'chat_message', visibility: 'public', actorId: e.playerId || null, actorType: 'player', snapshotVersion, payloadJson: cloneJson(e, {}) }));
  const prevGoalSeq = Number(prev.world?.soccer?.lastGoalEvent?.sequence) || 0;
  const nextGoalEvent = next.world?.soccer?.lastGoalEvent || null;
  if ((Number(nextGoalEvent?.sequence) || 0) > prevGoalSeq) events.push({ eventType: 'soccer_goal', visibility: 'public', actorId: nextGoalEvent?.scorerActorId || null, actorType: nextGoalEvent?.scorerActorType || 'player', snapshotVersion, payloadJson: cloneJson(nextGoalEvent, {}) });
  if (stableSerialize(prev.leaderboard) !== stableSerialize(next.leaderboard)) events.push({ eventType: 'leaderboard_updated', visibility: 'public', snapshotVersion, payloadJson: { updatedAt: next.leaderboard?.updatedAt || null, entries: cloneJson(next.leaderboard?.entries, []).slice(0, 5) } });
  return events;
}

module.exports = { buildRuntimeEvents, buildSnapshotDelta, cloneJson, stableSerialize };
