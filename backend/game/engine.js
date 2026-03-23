const config = require('../config');
const {
  getGameActorProfile,
  getRecentVisibleChatMessages,
  getTopGameScores,
  getTopSoccerScorers,
  incrementGameActorSoccerGoals,
  insertChatMessage,
  insertLog,
  upsertPlayerProfile,
  upsertGameScore,
} = require('../database/postgres');
const { createOpenAiDecisionClient } = require('../services/openai-client');
const {
  createWorldState,
  getHouseTowerElevators,
  getPublicDynamicWorldState,
  getPublicStaticWorldState,
  STATIC_WORLD_VERSION,
  getTargetById,
  getWorldCollisionBoxes,
  isPositionBlocked,
  LAKE,
  PLAYER_COLLISION_RADIUS,
  SOCCER_FIELD,
  resolveWalkablePosition,
} = require('./world-definition');

const ACTION_RADIUS = 5;
const ARRIVAL_RADIUS = 1.6;
const ACTION_COOLDOWN_MS = 750;
const WATER_DECAY_PER_SECOND = 0.8;
const FOOD_DECAY_PER_SECOND = 0.8;
const SCORE_HEALTHY_THRESHOLD = 70;
const APPLE_REGROW_INTERVAL_MS = 12000;
const DRINK_AMOUNT = 30;
const FOOD_FROM_APPLE = 24;
const DRINK_SCORE_POINTS = 1;
const EAT_FRUIT_SCORE_POINTS = 1;
const MAX_WATER = 100;
const MAX_FOOD = 100;
const AI_ACTION_MEMORY_SIZE = 3;
const SOCCER_BALL_ACTION_RADIUS = 3.1;
const SOCCER_BALL_KICK_SPEED = 11;
const SOCCER_BALL_DRAG_PER_SECOND = 8;
const SOCCER_BALL_MIN_SPEED = 0.18;
const SOCCER_GOAL_CELEBRATION_MS = 3000;
const DROPPED_APPLE_PICKUP_RADIUS = 2.25;
const DROPPED_APPLE_DROP_DISTANCE = 0.95;
const DROPPED_APPLE_GROUND_Y = 0.22;
const TOWER_ELEVATOR_ACTION_RADIUS = 1.45;
const TOWER_ELEVATOR_BUTTON_ACTION_RADIUS = 1.9;
const TOWER_ELEVATOR_VERTICAL_TOLERANCE = 1.35;
const TOWER_ELEVATOR_COOLDOWN_MS = 900;
const BOW_PICKUP_RADIUS = 2.15;
const BOW_DROP_DISTANCE = 1.08;
const BOW_GROUND_OFFSET_Y = 0.28;
const BOW_DEFAULT_ARROW_COUNT = 2;
const SWORD_PICKUP_RADIUS = 2.05;
const SWORD_DROP_DISTANCE = 1.02;
const SWORD_GROUND_OFFSET_Y = 0.28;
const SWORD_ATTACK_RADIUS = 2.3;
const SWORD_ATTACK_VERTICAL_TOLERANCE = 1.8;
const SWORD_ATTACK_ARC_DOT_THRESHOLD = 0.2;
const SWORD_ATTACK_LINE_PADDING = 0.2;
const SWORD_HIT_WATER_DAMAGE = 30;
const SWORD_HIT_APPLE_DAMAGE = 1;
const SWORD_KNOCKBACK_DISTANCE = 2.7;
const SWORD_KNOCKBACK_STEP_DISTANCE = 0.45;
const ARROW_PROJECTILE_SPEED = 26;
const ARROW_PROJECTILE_RADIUS = 0.08;
const ARROW_PROJECTILE_LIFETIME_MS = 1300;
const ARROW_FORWARD_OFFSET = 0.82;
const ARROW_START_HEIGHT = 1.46;
const ARROW_HIT_RADIUS = PLAYER_COLLISION_RADIUS + 0.22;
const ARROW_HIT_MIN_Y_OFFSET = 0.25;
const ARROW_HIT_MAX_Y_OFFSET = 2.45;
const ARROW_WATER_DAMAGE = 24;
const ARROW_APPLE_DAMAGE = 1;
const ACTOR_HIT_FLASH_DURATION_MS = 650;
const PLAYER_SPEECH_DURATION_MS = 5000;
const RESPAWN_DELAY_MS = 5000;
const GRAVE_DURATION_MS = 60000;
const LEADERBOARD_LIMIT = 10;
const LEADERBOARD_REFRESH_MS = 10000;
const PLAYER_NICKNAME_MAX_LENGTH = 24;
const DEFAULT_PLAYER_OUTFIT_COLOR = '#2563eb';
const PLAYER_CHAT_HISTORY_LIMIT = 20;
const DEFAULT_CHAT_BLOCKED_WORDS = Object.freeze([
  'merda',
  'porra',
  'caralho',
  'pqp',
  'fdp',
  'otario',
]);
const AI_ROUTE_CORNER_MARGIN = 0.35;
const AI_ROUTE_SAMPLE_STEP = 0.45;
const AI_ROUTE_WAYPOINT_RADIUS = 0.9;
const AI_ROUTE_STUCK_DISTANCE = 0.05;
const AI_ROUTE_REPLAN_TICKS = 4;
const AI_ROUTE_REPLAN_LIMIT = 3;

const AI_SPAWN_POINT = Object.freeze({ x: -3.6, y: 0, z: 18 });
const PLAYER_SPAWN_POINTS = Object.freeze([
  Object.freeze({ x: -16, y: 0, z: 23 }),
  Object.freeze({ x: 16, y: 0, z: 23 }),
  Object.freeze({ x: -8, y: 0, z: 10 }),
  Object.freeze({ x: 8, y: 0, z: 10 }),
  Object.freeze({ x: 0, y: 0, z: 10 }),
  Object.freeze({ x: -14, y: 0, z: 32 }),
  Object.freeze({ x: 14, y: 0, z: 32 }),
  Object.freeze({ x: 0, y: 0, z: 38 }),
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clonePoint(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
    z: Number(point?.z) || 0,
  };
}

function buildRespawnCountdownMs(actor, now) {
  if (!actor || actor.status !== 'dead') {
    return 0;
  }

  return Math.max(0, (Number(actor.respawnAt) || 0) - now);
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function sanitizeNickname(value) {
  return sanitizeText(value, PLAYER_NICKNAME_MAX_LENGTH);
}

function sanitizeHexColor(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}

function normalizeComparableName(value) {
  const normalized = sanitizeText(value, 255);
  if (!normalized) {
    return '';
  }

  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeModerationText(value) {
  const normalized = sanitizeText(value, 255);
  if (!normalized) {
    return '';
  }

  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getBlockedChatWords() {
  return (config.PLAYER_CHAT_BLOCKED_WORDS.length > 0
    ? config.PLAYER_CHAT_BLOCKED_WORDS
    : DEFAULT_CHAT_BLOCKED_WORDS)
    .map((word) => normalizeModerationText(word))
    .filter(Boolean);
}

function findBlockedChatWord(message) {
  const normalizedMessage = normalizeModerationText(message);
  if (!normalizedMessage) {
    return null;
  }

  for (const blockedWord of getBlockedChatWords()) {
    if (!blockedWord) {
      continue;
    }

    if (blockedWord.includes(' ')) {
      if (normalizedMessage.includes(blockedWord)) {
        return blockedWord;
      }
      continue;
    }

    const pattern = new RegExp(`(^|\\s)${escapeRegex(blockedWord)}(\\s|$)`, 'u');
    if (pattern.test(normalizedMessage)) {
      return blockedWord;
    }
  }

  return null;
}

function areNamesEquivalent(left, right) {
  const normalizedLeft = normalizeComparableName(left);
  const normalizedRight = normalizeComparableName(right);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
}

function hashString(value) {
  let hash = 0;
  const text = String(value || '');

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildDefaultPlayerNickname(userId) {
  return `Jardineiro ${1000 + (hashString(userId) % 9000)}`;
}

function buildPlayerAppearance(appearance = {}) {
  return {
    outfitColor: sanitizeHexColor(appearance?.outfitColor) || DEFAULT_PLAYER_OUTFIT_COLOR,
  };
}

function formatLogDetailValue(value) {
  const normalized = sanitizeText(String(value ?? ''), 255) || '-';
  return `"${normalized.replace(/"/g, '\'')}"`;
}

function buildPlayerLogDetails(player, details = null) {
  const detailParts = [];
  const normalizedDetails = sanitizeText(details, 1024);

  if (normalizedDetails) {
    detailParts.push(normalizedDetails);
  }

  detailParts.push(`game_nickname=${formatLogDetailValue(player?.name || 'Jogador')}`);
  detailParts.push(`nickname_owner_user_id=${formatLogDetailValue(player?.id || 'unknown')}`);

  if (player?.appearance?.outfitColor) {
    detailParts.push(`outfit_color=${formatLogDetailValue(player.appearance.outfitColor)}`);
  }

  return detailParts.join('; ');
}

function buildPlayerLogContext(player, { userAgent = 'backend-game', details = null } = {}) {
  return {
    userId: player?.id || null,
    userName: player?.name || 'Jogador',
    userAgent,
    details: buildPlayerLogDetails(player, details),
  };
}

function distanceBetween(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0);
  const dz = (a?.z || 0) - (b?.z || 0);
  return Math.sqrt((dx * dx) + (dz * dz));
}

function buildRoutePointKey(point) {
  return `${roundNumber(point?.x || 0, 2)}:${roundNumber(point?.z || 0, 2)}`;
}

function isPointWithinWorldBounds(worldState, point, margin = 0) {
  const bounds = Number.isFinite(worldState?.bounds) ? worldState.bounds : 45;
  return (
    (Number(point?.x) || 0) >= (-bounds + margin)
    && (Number(point?.x) || 0) <= (bounds - margin)
    && (Number(point?.z) || 0) >= (-bounds + margin)
    && (Number(point?.z) || 0) <= (bounds - margin)
  );
}

function isRoutePointWalkable(worldState, point, padding = PLAYER_COLLISION_RADIUS) {
  return isPointWithinWorldBounds(worldState, point, 0.05)
    && !isPositionBlocked(worldState, point, padding);
}

function isRouteSegmentClear(worldState, start, end, padding = PLAYER_COLLISION_RADIUS) {
  if (!start || !end) {
    return false;
  }

  if (!isPointWithinWorldBounds(worldState, start, 0.05) || !isRoutePointWalkable(worldState, end, padding)) {
    return false;
  }

  const distance = distanceBetween(start, end);
  if (distance <= 0.0001) {
    return true;
  }

  const sampleCount = Math.max(1, Math.ceil(distance / AI_ROUTE_SAMPLE_STEP));

  for (let index = 1; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    const samplePoint = {
      x: start.x + ((end.x - start.x) * progress),
      y: start.y + ((end.y || start.y || 0) - (start.y || 0)) * progress,
      z: start.z + ((end.z - start.z) * progress),
    };

    if (!isPointWithinWorldBounds(worldState, samplePoint, 0.05) || isPositionBlocked(worldState, samplePoint, padding)) {
      return false;
    }
  }

  return true;
}

function buildAiRouteGraphNodes(worldState, start, target, padding = PLAYER_COLLISION_RADIUS) {
  const nodes = [];
  const seenKeys = new Set();
  const cornerOffset = padding + AI_ROUTE_CORNER_MARGIN;
  const collisionBoxes = getWorldCollisionBoxes(worldState);

  const addNode = (point, { force = false } = {}) => {
    if (!point) {
      return;
    }

    const node = {
      x: Number(point.x) || 0,
      y: Number(point.y) || 0,
      z: Number(point.z) || 0,
    };
    const key = buildRoutePointKey(node);
    if (seenKeys.has(key)) {
      return;
    }

    if (!force && !isRoutePointWalkable(worldState, node, padding)) {
      return;
    }

    seenKeys.add(key);
    nodes.push(node);
  };

  addNode(start, { force: true });
  addNode(target);

  collisionBoxes.forEach((rect) => {
    addNode({ x: rect.minX - cornerOffset, y: start.y, z: rect.minZ - cornerOffset });
    addNode({ x: rect.minX - cornerOffset, y: start.y, z: rect.maxZ + cornerOffset });
    addNode({ x: rect.maxX + cornerOffset, y: start.y, z: rect.minZ - cornerOffset });
    addNode({ x: rect.maxX + cornerOffset, y: start.y, z: rect.maxZ + cornerOffset });
  });

  return nodes;
}

function compressAiRoute(worldState, start, routePoints, padding = PLAYER_COLLISION_RADIUS) {
  if (!Array.isArray(routePoints) || routePoints.length === 0) {
    return [];
  }

  const compressedRoute = [];
  let anchor = clonePoint(start);
  let index = 0;

  while (index < routePoints.length) {
    let furthestReachableIndex = index;

    for (let candidateIndex = routePoints.length - 1; candidateIndex > index; candidateIndex -= 1) {
      if (isRouteSegmentClear(worldState, anchor, routePoints[candidateIndex], padding)) {
        furthestReachableIndex = candidateIndex;
        break;
      }
    }

    const nextPoint = routePoints[furthestReachableIndex];
    compressedRoute.push({
      x: Number(nextPoint.x) || 0,
      y: Number(nextPoint.y) || 0,
      z: Number(nextPoint.z) || 0,
    });
    anchor = nextPoint;
    index = furthestReachableIndex + 1;
  }

  return compressedRoute;
}

function computeAiRoute(worldState, start, target, padding = PLAYER_COLLISION_RADIUS) {
  if (!start || !target || !isPointWithinWorldBounds(worldState, start, 0.05) || !isRoutePointWalkable(worldState, target, padding)) {
    return [];
  }

  if (isRouteSegmentClear(worldState, start, target, padding)) {
    return [clonePoint(target)];
  }

  const nodes = buildAiRouteGraphNodes(worldState, start, target, padding);
  if (nodes.length < 2) {
    return [];
  }

  const targetIndex = nodes.findIndex((node) => buildRoutePointKey(node) === buildRoutePointKey(target));
  if (targetIndex <= 0) {
    return [];
  }

  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      if (!isRouteSegmentClear(worldState, nodes[leftIndex], nodes[rightIndex], padding)) {
        continue;
      }

      const cost = distanceBetween(nodes[leftIndex], nodes[rightIndex]);
      adjacency[leftIndex].push({ index: rightIndex, cost });
      adjacency[rightIndex].push({ index: leftIndex, cost });
    }
  }

  const startIndex = 0;
  const openSet = new Set([startIndex]);
  const cameFrom = new Map();
  const gScore = new Map([[startIndex, 0]]);
  const fScore = new Map([[startIndex, distanceBetween(nodes[startIndex], nodes[targetIndex])]]);

  while (openSet.size > 0) {
    let currentIndex = null;
    let currentBestScore = Number.POSITIVE_INFINITY;

    openSet.forEach((nodeIndex) => {
      const nodeScore = fScore.get(nodeIndex) ?? Number.POSITIVE_INFINITY;
      if (nodeScore < currentBestScore) {
        currentBestScore = nodeScore;
        currentIndex = nodeIndex;
      }
    });

    if (currentIndex == null) {
      break;
    }

    if (currentIndex === targetIndex) {
      const path = [];
      let walkIndex = currentIndex;

      while (cameFrom.has(walkIndex)) {
        path.unshift(nodes[walkIndex]);
        walkIndex = cameFrom.get(walkIndex);
      }

      return compressAiRoute(worldState, start, path, padding);
    }

    openSet.delete(currentIndex);
    const currentPathCost = gScore.get(currentIndex) ?? Number.POSITIVE_INFINITY;

    adjacency[currentIndex].forEach((neighbor) => {
      const tentativeScore = currentPathCost + neighbor.cost;
      if (tentativeScore >= (gScore.get(neighbor.index) ?? Number.POSITIVE_INFINITY)) {
        return;
      }

      cameFrom.set(neighbor.index, currentIndex);
      gScore.set(neighbor.index, tentativeScore);
      fScore.set(neighbor.index, tentativeScore + distanceBetween(nodes[neighbor.index], nodes[targetIndex]));
      openSet.add(neighbor.index);
    });
  }

  return [];
}

function getNearbyTowerElevator(worldState, position, maxDistance = TOWER_ELEVATOR_ACTION_RADIUS) {
  const elevators = getHouseTowerElevators(worldState?.house);
  const actorY = Number(position?.y) || 0;

  for (let index = 0; index < elevators.length; index += 1) {
    const elevator = elevators[index];
    const planarDistance = distanceBetween(position, elevator);
    const buttonDistance = distanceBetween(position, elevator.callButton);
    const isNearLiftPlatform = planarDistance <= maxDistance;
    const isNearCallButton = buttonDistance <= TOWER_ELEVATOR_BUTTON_ACTION_RADIUS;

    if (Math.abs(actorY - elevator.bottomY) <= TOWER_ELEVATOR_VERTICAL_TOLERANCE && (isNearLiftPlatform || isNearCallButton)) {
      return {
        id: elevator.id,
        direction: 'up',
        source: isNearCallButton && !isNearLiftPlatform ? 'button' : 'platform',
        position: {
          x: elevator.x,
          y: elevator.topY,
          z: elevator.z,
        },
      };
    }

    if (Math.abs(actorY - elevator.topY) <= TOWER_ELEVATOR_VERTICAL_TOLERANCE && isNearLiftPlatform) {
      return {
        id: elevator.id,
        direction: 'down',
        source: 'platform',
        position: {
          x: elevator.x,
          y: elevator.bottomY,
          z: elevator.z,
        },
      };
    }
  }

  return null;
}

function getClosestPointOnSegment(start, end, target) {
  const startX = Number(start?.x) || 0;
  const startZ = Number(start?.z) || 0;
  const endX = Number(end?.x) || 0;
  const endZ = Number(end?.z) || 0;
  const targetX = Number(target?.x) || 0;
  const targetZ = Number(target?.z) || 0;
  const segmentDeltaX = endX - startX;
  const segmentDeltaZ = endZ - startZ;
  const segmentLengthSquared = (segmentDeltaX * segmentDeltaX) + (segmentDeltaZ * segmentDeltaZ);

  if (segmentLengthSquared <= 0.000001) {
    return {
      x: endX,
      z: endZ,
      progress: 1,
    };
  }

  const projectedProgress = (
    ((targetX - startX) * segmentDeltaX)
    + ((targetZ - startZ) * segmentDeltaZ)
  ) / segmentLengthSquared;
  const progress = clamp(projectedProgress, 0, 1);

  return {
    x: startX + (segmentDeltaX * progress),
    z: startZ + (segmentDeltaZ * progress),
    progress,
  };
}

function getSoccerBallGroundPosition(worldState) {
  const soccer = worldState?.soccer;
  const ball = soccer?.ball;
  const radius = Number(ball?.radius) || SOCCER_FIELD.ballRadius;

  return {
    x: Number(ball?.position?.x) || 0,
    y: radius,
    z: Number(ball?.position?.z) || 0,
  };
}

function getSoccerFieldMetrics(worldState) {
  const field = worldState?.soccer?.field || SOCCER_FIELD;
  const ball = worldState?.soccer?.ball;
  const radius = Number(ball?.radius) || Number(field?.ballRadius) || SOCCER_FIELD.ballRadius;
  const centerX = Number(field?.position?.x) || 0;
  const centerZ = Number(field?.position?.z) || 0;
  const halfWidth = (Number(field?.width) || SOCCER_FIELD.width) / 2;
  const halfDepth = (Number(field?.depth) || SOCCER_FIELD.depth) / 2;
  const goalHalfWidth = (Number(field?.goalWidth) || SOCCER_FIELD.goalWidth) / 2;
  const goalDepth = Number(field?.goalDepth) || SOCCER_FIELD.goalDepth;

  return {
    radius,
    centerX,
    centerZ,
    xMin: centerX - halfWidth + radius,
    xMax: centerX + halfWidth - radius,
    zMin: centerZ - halfDepth + radius,
    zMax: centerZ + halfDepth - radius,
    goalXMin: centerX - goalHalfWidth + radius,
    goalXMax: centerX + goalHalfWidth - radius,
    northGoalMinZ: centerZ - halfDepth - goalDepth + radius,
    northGoalMaxZ: centerZ - halfDepth - radius,
    southGoalMinZ: centerZ + halfDepth + radius,
    southGoalMaxZ: centerZ + halfDepth + goalDepth - radius,
  };
}

function getSoccerGoalSideFromSegment(startPosition, endPosition, metrics) {
  const startX = Number(startPosition?.x) || 0;
  const startZ = Number(startPosition?.z) || 0;
  const endX = Number(endPosition?.x) || 0;
  const endZ = Number(endPosition?.z) || 0;

  if (endZ < metrics.zMin && startZ >= metrics.zMin && Math.abs(endZ - startZ) > 0.000001) {
    const progress = (metrics.zMin - startZ) / (endZ - startZ);
    const crossingX = startX + ((endX - startX) * progress);
    if (crossingX >= metrics.goalXMin && crossingX <= metrics.goalXMax) {
      return 'north';
    }
  }

  if (endZ > metrics.zMax && startZ <= metrics.zMax && Math.abs(endZ - startZ) > 0.000001) {
    const progress = (metrics.zMax - startZ) / (endZ - startZ);
    const crossingX = startX + ((endX - startX) * progress);
    if (crossingX >= metrics.goalXMin && crossingX <= metrics.goalXMax) {
      return 'south';
    }
  }

  return null;
}

function normalizeDecision(decision, observation) {
  if (!decision || typeof decision !== 'object') {
    return null;
  }

  const action = typeof decision.action === 'string' ? decision.action.trim() : '';
  const allowedActions = new Set(['wait', 'move_to', 'drink_water', 'pick_fruit', 'eat_fruit']);

  if (!allowedActions.has(action)) {
    return null;
  }

  const targetId =
    typeof decision.target_id === 'string' && decision.target_id.trim()
      ? decision.target_id.trim()
      : null;

  if (action === 'move_to') {
    const validTargetIds = new Set(observation.targets.map((target) => target.id));
    if (!targetId || !validTargetIds.has(targetId)) {
      return null;
    }
  }

  if (action !== 'move_to' && targetId) {
    return null;
  }

  if (
    action !== 'wait'
    && action !== 'move_to'
    && observation?.available_actions?.[action] !== true
  ) {
    return null;
  }

  return {
    action,
    targetId,
    speech: sanitizeText(decision.speech, config.AI_SPEECH_MAX_CHARS),
  };
}

function buildModelErrorDetails(error) {
  if (!error) {
    return null;
  }

  const parts = [];

  if (Number.isFinite(error.statusCode)) {
    parts.push(`status=${error.statusCode}`);
  }

  if (Number.isFinite(error.retryAfterSeconds)) {
    parts.push(`retry_after=${error.retryAfterSeconds}s`);
  }

  if (typeof error.requestId === 'string' && error.requestId.trim()) {
    parts.push(`request_id=${error.requestId.trim()}`);
  }

  const message = sanitizeText(error.message, 240);
  if (message) {
    parts.push(`message=${message}`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function getDecisionRetryDelayMs(error) {
  if (Number(error?.statusCode) === 429) {
    if (Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
      return Math.max(error.retryAfterSeconds * 1000, config.AI_DECISION_INTERVAL_MS);
    }

    return Math.max(config.AI_DECISION_INTERVAL_MS * 3, 15000);
  }

  return config.AI_DECISION_INTERVAL_MS;
}

function chooseFallbackDecision(observation) {
  const explorationTarget = chooseExplorationTarget(observation, {
    excludeTargetIds: [observation.current_target_id],
  });

  if (observation.available_actions.drink_water && observation.self.water <= SCORE_HEALTHY_THRESHOLD + 2) {
    return {
      action: 'drink_water',
      targetId: null,
      speech: observation.self.water < 35 ? 'Preciso beber agua.' : null,
    };
  }

  if (observation.self.water < 55) {
    return {
      action: 'move_to',
      targetId: LAKE.id,
      speech: 'Vou ate o lago.',
    };
  }

  if (observation.available_actions.eat_fruit && observation.self.food <= SCORE_HEALTHY_THRESHOLD + 2) {
    return {
      action: 'eat_fruit',
      targetId: null,
      speech: observation.self.food < 35 ? 'Preciso comer.' : 'Vou fazer um lanche.',
    };
  }

  if (observation.self.food < 55 && observation.self.apples === 0 && explorationTarget?.type === 'tree') {
    return {
      action: 'move_to',
      targetId: explorationTarget.id,
      speech: 'Preciso arrumar comida.',
    };
  }

  if (observation.available_actions.pick_fruit) {
    return {
      action: 'pick_fruit',
      targetId: null,
      speech: observation.self.apples === 0 || observation.self.food < 75 ? 'Achei fruta.' : null,
    };
  }

  if (observation.self.apples > 0 && observation.available_actions.eat_fruit && observation.self.food < 88) {
    return {
      action: 'eat_fruit',
      targetId: null,
      speech: 'Hora de lanchar.',
    };
  }

  if (explorationTarget && explorationTarget.type === 'tree') {
    return {
      action: 'move_to',
      targetId: explorationTarget.id,
      speech: observation.self.apples === 0 ? 'Vou explorar outra arvore.' : 'Vou andar mais um pouco.',
    };
  }

  if (observation.available_actions.drink_water) {
    return {
      action: 'drink_water',
      targetId: null,
      speech: null,
    };
  }

  return {
    action: 'wait',
    targetId: null,
    speech: observation.self.water < 50 || observation.self.food < 50 ? 'Pensando no proximo passo.' : null,
  };
}

function createActionMemoryEntry(action, targetId = null) {
  return {
    action,
    target_id: targetId || null,
    recorded_at: new Date().toISOString(),
  };
}

function chooseExplorationTarget(observation, { excludeTargetIds = [] } = {}) {
  if (!observation || !Array.isArray(observation.targets)) {
    return null;
  }

  const excludedTargetIds = new Set((excludeTargetIds || []).filter(Boolean));
  const recentMoveTargets = new Map();

  (observation.recent_actions || []).forEach((entry, index) => {
    if (entry.action === 'move_to' && entry.target_id) {
      recentMoveTargets.set(entry.target_id, index);
    }
  });

  const treeTargets = observation.targets
    .filter((target) => target.type === 'tree' && !excludedTargetIds.has(target.id))
    .sort((left, right) => {
      const leftRecentRank = recentMoveTargets.has(left.id) ? recentMoveTargets.get(left.id) : -1;
      const rightRecentRank = recentMoveTargets.has(right.id) ? recentMoveTargets.get(right.id) : -1;

      if (leftRecentRank !== rightRecentRank) {
        return leftRecentRank - rightRecentRank;
      }

      if (left.applesRemaining !== right.applesRemaining) {
        return (right.applesRemaining || 0) - (left.applesRemaining || 0);
      }

      return left.distance - right.distance;
    });

  if (treeTargets.length > 0) {
    return treeTargets[0];
  }

  return observation.targets.find((target) => !excludedTargetIds.has(target.id)) || null;
}

function buildInventory(actor) {
  return {
    apples: Math.max(0, Math.trunc(actor.inventory?.apples || 0)),
    arrows: Math.max(0, Math.trunc(actor.inventory?.arrows || 0)),
    bowEquipped: Boolean(actor.inventory?.hasBow),
    swordEquipped: Boolean(actor.inventory?.hasSword),
    food: roundNumber(Number(actor.inventory?.food) || 0, 1),
    water: roundNumber(Number(actor.inventory?.water) || 0, 1),
  };
}

function buildRoundedPosition(position) {
  return {
    x: roundNumber(position.x),
    y: roundNumber(position.y),
    z: roundNumber(position.z),
  };
}

function createPlayerState(user, spawnPoint) {
  const now = Date.now();
  const realName = sanitizeText(user.realName || user.name, 255) || 'Jogador';
  const nickname = sanitizeNickname(user.nickname || user.name);

  return {
    id: user.id,
    actorType: 'player',
    name: nickname && !areNamesEquivalent(nickname, realName)
      ? nickname
      : buildDefaultPlayerNickname(user.id),
    realName,
    appearance: buildPlayerAppearance(user.appearance),
    position: clonePoint(spawnPoint),
    rotationY: Math.PI,
    status: 'idle',
    currentAction: 'wait',
    inventory: {
      apples: 0,
      hasBow: false,
      hasSword: false,
      arrows: 0,
      food: MAX_FOOD,
      water: MAX_WATER,
    },
    input: {
      moveX: 0,
      moveZ: 0,
      isRunning: false,
    },
    speech: null,
    speechExpiresAt: 0,
    hitFlashUntil: 0,
    lastHitAt: 0,
    lastHitType: null,
    actionCooldownUntil: 0,
    connectedAt: now,
    lastSeenAt: now,
    score: 0,
    bestScore: 0,
    scoreProgress: 0,
    scoreDirection: 0,
    deaths: 0,
    respawns: 0,
    respawnAt: 0,
    lastDeathReason: null,
  };
}

class AiGameEngine {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.decisionClient = createOpenAiDecisionClient();
    this.simulationHandle = null;
    this.decisionHandle = null;
    this.pendingDecision = false;
    this.playerSessionLoads = new Map();
    this.state = this.createInitialState();
  }

  createInitialState() {
    const world = createWorldState();
    const now = Date.now();

    return {
      world,
      players: new Map(),
      startedAt: now,
      tick: 0,
      nextDecisionAt: now + 500,
      lastDecisionAt: null,
      lastDecisionSource: 'boot',
      lastError: null,
      leaderboard: [],
      leaderboardLastUpdatedAt: 0,
      leaderboardRefreshInFlight: false,
      soccerLeaderboard: [],
      soccerLeaderboardLastUpdatedAt: 0,
      soccerLeaderboardRefreshInFlight: false,
      playerChat: [],
      nextDroppedAppleId: 1,
      nextDroppedSwordId: 1,
      nextDroppedBowId: 1,
      nextArrowProjectileId: 1,
      ai: {
        id: 'npc-gardener-01',
        actorType: 'ai',
        name: config.AI_AGENT_NAME,
        provider: config.OPENAI_API_KEY ? 'openai' : 'fallback',
        position: clonePoint(AI_SPAWN_POINT),
        rotationY: Math.PI,
        status: 'idle',
        currentAction: 'wait',
        movementTargetId: null,
        movementRoute: [],
        movementRouteIndex: 0,
        movementStuckTicks: 0,
        movementReplanCount: 0,
        actionCooldownUntil: 0,
        inventory: {
          apples: 0,
          hasBow: false,
          hasSword: false,
          arrows: 0,
          food: MAX_FOOD,
          water: MAX_WATER,
        },
        recentActions: [],
        speech: null,
        speechExpiresAt: 0,
        hitFlashUntil: 0,
        lastHitAt: 0,
        lastHitType: null,
        score: 0,
        bestScore: 0,
        scoreProgress: 0,
        scoreDirection: 0,
        deaths: 0,
        respawns: 0,
        respawnAt: 0,
        lastDeathReason: null,
      },
    };
  }

  start() {
    if (this.simulationHandle || this.decisionHandle) {
      return;
    }

    this.logEvent('ai_game_started');
    this.persistActorStats(this.state.ai);
    this.refreshLeaderboard().catch((error) => {
      this.logger.error('Initial leaderboard refresh failed:', error.message);
    });
    this.refreshSoccerLeaderboard().catch((error) => {
      this.logger.error('Initial soccer leaderboard refresh failed:', error.message);
    });
    this.loadRecentChatMessages().catch((error) => {
      this.logger.error('Initial chat history load failed:', error.message);
    });

    this.simulationHandle = setInterval(() => {
      this.advanceSimulation(config.AI_SIMULATION_TICK_MS);
    }, config.AI_SIMULATION_TICK_MS);

    if (config.AI_GAME_ENABLED) {
      this.decisionHandle = setInterval(() => {
        this.maybeRequestDecision().catch((error) => {
          this.logger.error('AI decision loop error:', error.message);
        });
      }, 500);
    }
  }

  stop() {
    if (this.simulationHandle) {
      clearInterval(this.simulationHandle);
      this.simulationHandle = null;
    }

    if (this.decisionHandle) {
      clearInterval(this.decisionHandle);
      this.decisionHandle = null;
    }
  }

  buildPublicSettings() {
    return {
      simulationTickMs: config.AI_SIMULATION_TICK_MS,
      playerMoveSpeed: config.PLAYER_MOVE_SPEED,
      playerRunSpeed: config.PLAYER_RUN_SPEED,
      chatMaxChars: config.PLAYER_CHAT_MAX_CHARS,
      nicknameMaxChars: PLAYER_NICKNAME_MAX_LENGTH,
    };
  }

  async getBootstrapState() {
    return {
      serverTime: new Date().toISOString(),
      worldVersion: STATIC_WORLD_VERSION,
      settings: this.buildPublicSettings(),
      world: getPublicStaticWorldState(this.state.world),
    };
  }

  async getPublicState(user) {
    const player = await this.touchPlayerSession(user);
    const now = Date.now();

    this.maybeRefreshLeaderboards(now);

    return {
      serverTime: new Date(now).toISOString(),
      tick: this.state.tick,
      worldVersion: STATIC_WORLD_VERSION,
      settings: this.buildPublicSettings(),
      self: player ? this.buildSelfState(player, now) : null,
      players: Array.from(this.state.players.values())
        .map((candidate) => this.buildPublicPlayerState(candidate, now))
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
      ai: this.buildAiPublicState(now),
      world: getPublicDynamicWorldState(this.state.world),
      leaderboard: {
        updatedAt: this.state.leaderboardLastUpdatedAt
          ? new Date(this.state.leaderboardLastUpdatedAt).toISOString()
          : null,
        entries: this.state.leaderboard.map((entry) => ({
          rank: entry.rank,
          actorType: entry.actorType,
          actorName: entry.actorName,
          currentScore: entry.currentScore,
          bestScore: entry.bestScore,
          deaths: entry.deaths,
          respawns: entry.respawns,
        })),
      },
      soccerLeaderboard: {
        updatedAt: this.state.soccerLeaderboardLastUpdatedAt
          ? new Date(this.state.soccerLeaderboardLastUpdatedAt).toISOString()
          : null,
        entries: this.state.soccerLeaderboard.map((entry) => ({
          rank: entry.rank,
          actorType: entry.actorType,
          actorName: entry.actorName,
          soccerGoals: entry.soccerGoals,
        })),
      },
      playerChat: {
        entries: this.state.playerChat.map((entry) => ({
          id: entry.id,
          isSelf: entry.playerId === player?.id,
          playerName: entry.playerName,
          message: entry.message,
          createdAt: new Date(entry.createdAt).toISOString(),
        })),
      },
    };
  }

  buildAiPublicState(now) {
    return {
      ...this.buildActorPublicState(this.state.ai, now),
      provider: this.state.ai.provider,
      movementTargetId: this.state.ai.movementTargetId,
      inventory: buildInventory(this.state.ai),
      lastDecisionAt: this.state.lastDecisionAt ? new Date(this.state.lastDecisionAt).toISOString() : null,
    };
  }

  buildActorPublicState(actor, now) {
    return {
      id: actor.id,
      actorType: actor.actorType,
      name: actor.name,
      status: actor.status,
      currentAction: actor.currentAction,
      position: buildRoundedPosition(actor.position),
      rotationY: roundNumber(actor.rotationY, 3),
      speech: actor.speech,
      speechVisible: Boolean(actor.speech && actor.speechExpiresAt > now),
      vitals: {
        food: roundNumber(actor.inventory.food, 1),
        water: roundNumber(actor.inventory.water, 1),
      },
      hitFlashRemainingMs: Math.max(0, (Number(actor.hitFlashUntil) || 0) - now),
      lastHitAt: Number(actor.lastHitAt) > 0 ? new Date(actor.lastHitAt).toISOString() : null,
      lastHitType: typeof actor.lastHitType === 'string' ? actor.lastHitType : null,
      equipment: {
        bow: Boolean(actor.inventory?.hasBow),
        sword: Boolean(actor.inventory?.hasSword),
      },
      score: Math.max(0, Math.trunc(actor.score || 0)),
      bestScore: Math.max(0, Math.trunc(actor.bestScore || 0)),
      deaths: Math.max(0, Math.trunc(actor.deaths || 0)),
      respawns: Math.max(0, Math.trunc(actor.respawns || 0)),
      respawnCountdownMs: buildRespawnCountdownMs(actor, now),
    };
  }

  buildPublicPlayerState(player, now) {
    return {
      ...this.buildActorPublicState(player, now),
      appearance: buildPlayerAppearance(player.appearance),
    };
  }

  buildSelfState(player, now) {
    return {
      ...this.buildPublicPlayerState(player, now),
      inventory: buildInventory(player),
      actionCooldownMs: Math.max(0, player.actionCooldownUntil - now),
      availableActions: this.getAvailableActions(player, now, { includeDrop: true }),
    };
  }

  pickSpawnPoint() {
    const occupiedPositions = Array.from(this.state.players.values()).map((player) => player.position);

    if (occupiedPositions.length === 0) {
      return clonePoint(PLAYER_SPAWN_POINTS[0]);
    }

    let bestPoint = PLAYER_SPAWN_POINTS[0];
    let bestDistance = -1;

    PLAYER_SPAWN_POINTS.forEach((spawnPoint) => {
      const minDistance = occupiedPositions.reduce((closest, position) => {
        return Math.min(closest, distanceBetween(spawnPoint, position));
      }, Number.POSITIVE_INFINITY);

      if (minDistance > bestDistance) {
        bestDistance = minDistance;
        bestPoint = spawnPoint;
      }
    });

    return clonePoint(bestPoint);
  }

  syncKnownPlayerIdentity(player, userId, userName) {
    const previousNickname = player.name;
    const previousOutfitColor = player.appearance?.outfitColor || null;

    player.realName = userName;
    player.appearance = buildPlayerAppearance(player.appearance);

    if (!player.name || areNamesEquivalent(player.name, player.realName)) {
      player.name = buildDefaultPlayerNickname(userId);
    }

    if (player.name !== previousNickname || player.appearance.outfitColor !== previousOutfitColor) {
      this.persistActorStats(player);
    }

    player.lastSeenAt = Date.now();
    return player;
  }

  async touchPlayerSession(user) {
    const userId = sanitizeText(user?.id, 128);
    if (!userId) {
      return null;
    }

    const userName = sanitizeText(user?.name, 255) || 'Jogador';
    const activePlayer = this.state.players.get(userId);
    if (activePlayer) {
      return this.syncKnownPlayerIdentity(activePlayer, userId, userName);
    }

    if (this.playerSessionLoads.has(userId)) {
      return this.playerSessionLoads.get(userId);
    }

    const loadPromise = (async () => {
      let persistedProfile = null;

      try {
        persistedProfile = await getGameActorProfile(userId, 'player');
      } catch (error) {
        this.logger.error(`Player profile load failed for ${userId}:`, error.message);
      }

      let player = this.state.players.get(userId);

      if (!player) {
        player = createPlayerState({
          id: userId,
          realName: userName,
          nickname: persistedProfile?.actorName || null,
          appearance: {
            outfitColor: persistedProfile?.outfitColor || null,
          },
        }, this.pickSpawnPoint());
        this.state.players.set(userId, player);
        this.persistActorStats(player);
        this.logEvent('player_joined', buildPlayerLogContext(player));
      }

      return this.syncKnownPlayerIdentity(player, userId, userName);
    })().finally(() => {
      this.playerSessionLoads.delete(userId);
    });

    this.playerSessionLoads.set(userId, loadPromise);
    return loadPromise;
  }

  disconnectPlayer(userId, reason = 'disconnect') {
    const normalizedUserId = sanitizeText(userId, 128);
    if (!normalizedUserId) {
      return;
    }

    const player = this.state.players.get(normalizedUserId);
    if (!player) {
      return;
    }

    this.clearSoccerBallPossessionIfHeldByActor(normalizedUserId);
    this.dropSwordInventory(player);
    this.dropBowInventory(player);
    this.state.players.delete(normalizedUserId);
    this.persistActorStats(player);
    this.logEvent(
      reason === 'timeout' ? 'player_timed_out' : 'player_left',
      buildPlayerLogContext(player, {
        details: `reason=${formatLogDetailValue(reason)}`,
      })
    );
  }

  async applyPlayerCommand(user, command) {
    const player = await this.touchPlayerSession(user);

    if (!player) {
      return {
        ok: false,
        statusCode: 401,
        publicError: 'Sessao invalida.',
      };
    }

    switch (command.type) {
      case 'set_input':
        if (player.status === 'dead') {
          player.input.moveX = 0;
          player.input.moveZ = 0;
          player.input.isRunning = false;
          return { ok: true };
        }

        player.input.moveX = clamp(command.payload.moveX, -1, 1);
        player.input.moveZ = clamp(command.payload.moveZ, -1, 1);
        player.input.isRunning = Boolean(command.payload.isRunning);
        return { ok: true };
      case 'use_action':
      case 'perform_action':
        return this.performPlayerUseAction(player);
      case 'toggle_fruit':
        return this.performPlayerFruitToggle(player);
      case 'chat':
        return this.performPlayerChat(player, command.payload.message);
      case 'update_profile':
        return this.updatePlayerProfile(player, command.payload);
      default:
        return {
          ok: false,
          statusCode: 400,
          publicError: 'Comando invalido.',
        };
    }
  }

  performPlayerUseAction(player) {
    const now = Date.now();

    if (player.status === 'dead') {
      return {
        ok: false,
        statusCode: 400,
        publicError: 'Voce morreu. Aguarde o respawn.',
      };
    }

    if (now < player.actionCooldownUntil) {
      return {
        ok: true,
        ignored: true,
        ignoredReason: 'cooldown',
      };
    }

    const availableActions = this.getAvailableActions(player, now);
    const selectedAction = availableActions.elevator_up || availableActions.elevator_down
      ? 'ride_elevator'
      : availableActions.attack_sword
        ? 'attack_sword'
      : availableActions.shoot_arrow
        ? 'shoot_arrow'
      : availableActions.kick_ball
        ? 'kick_ball'
        : availableActions.drink_water
        ? 'drink_water'
        : availableActions.eat_fruit
          ? 'eat_fruit'
          : null;

    if (!selectedAction) {
      return {
        ok: true,
        ignored: true,
        ignoredReason: 'no_action_available',
      };
    }

    const logContext = buildPlayerLogContext(player);

    if (selectedAction === 'ride_elevator') {
      this.performTowerElevatorRide(player, 'player_use_tower_elevator', logContext);
    } else if (selectedAction === 'attack_sword') {
      this.performSwordAttack(player, 'player_attack_sword', logContext);
    } else if (selectedAction === 'shoot_arrow') {
      this.performShootArrow(player, 'player_shoot_arrow', logContext);
    } else if (selectedAction === 'kick_ball') {
      this.performKickBall(player, 'player_kick_ball', logContext);
    } else if (selectedAction === 'drink_water') {
      this.performDrink(player, 'player_drink_water', logContext);
    } else {
      this.performEatFruit(player, 'player_eat_fruit', logContext);
    }

    return {
      ok: true,
      action: selectedAction,
      position: buildRoundedPosition(player.position),
      rotationY: roundNumber(player.rotationY, 3),
    };
  }

  performPlayerFruitToggle(player) {
    const now = Date.now();

    if (player.status === 'dead') {
      return {
        ok: false,
        statusCode: 400,
        publicError: 'Voce morreu. Aguarde o respawn.',
      };
    }

    if (now < player.actionCooldownUntil) {
      return {
        ok: true,
        ignored: true,
        ignoredReason: 'cooldown',
      };
    }

    const availableActions = this.getAvailableActions(player, now, { includeDrop: true });
    const selectedAction = availableActions.drop_sword
      ? 'drop_sword'
      : availableActions.drop_bow
      ? 'drop_bow'
      : availableActions.drop_fruit
      ? 'drop_fruit'
      : availableActions.pick_sword
        ? 'pick_sword'
      : availableActions.pick_bow
        ? 'pick_bow'
      : availableActions.pick_fruit
        ? 'pick_fruit'
        : null;

    if (!selectedAction) {
      return {
        ok: true,
        ignored: true,
        ignoredReason: 'no_toggle_action_available',
      };
    }

    const logContext = buildPlayerLogContext(player);

    if (selectedAction === 'drop_sword') {
      this.performDropSword(player, 'player_drop_sword', logContext);
    } else if (selectedAction === 'drop_bow') {
      this.performDropBow(player, 'player_drop_bow', logContext);
    } else if (selectedAction === 'drop_fruit') {
      this.performDropFruit(player, 'player_drop_fruit', logContext);
    } else if (selectedAction === 'pick_sword') {
      this.performPickSword(player, 'player_pick_sword', logContext);
    } else if (selectedAction === 'pick_bow') {
      this.performPickBow(player, 'player_pick_bow', logContext);
    } else {
      this.performPickFruit(player, 'player_pick_fruit', logContext);
    }

    return {
      ok: true,
      action: selectedAction,
    };
  }

  performPlayerChat(player, message) {
    const sanitizedMessage = sanitizeText(message, config.PLAYER_CHAT_MAX_CHARS);

    if (!sanitizedMessage) {
      return {
        ok: false,
        statusCode: 400,
        publicError: 'Mensagem invalida.',
      };
    }

    const blockedWord = findBlockedChatWord(sanitizedMessage);
    if (blockedWord) {
      this.logEvent('player_chat_blocked', buildPlayerLogContext(player, {
        details: `reason=${formatLogDetailValue(`blocked_word:${blockedWord}`)}`,
      }));

      return {
        ok: false,
        statusCode: 400,
        publicError: 'Sua mensagem nao pode ser enviada por causa das regras de moderacao.',
      };
    }

    player.speech = sanitizedMessage;
    player.speechExpiresAt = Date.now() + PLAYER_SPEECH_DURATION_MS;
    return this.appendPlayerChatEntry(player, sanitizedMessage);
  }

  performKickBall(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (this.isSoccerRestartPaused()) {
      return false;
    }

    const soccerBall = this.state.world?.soccer?.ball;
    if (!soccerBall) {
      return false;
    }

    const ballPosition = getSoccerBallGroundPosition(this.state.world);
    const distanceToBall = distanceBetween(actor.position, ballPosition);
    if (distanceToBall > SOCCER_BALL_ACTION_RADIUS) {
      return false;
    }

    let directionX = ballPosition.x - actor.position.x;
    let directionZ = ballPosition.z - actor.position.z;
    const directionMagnitude = Math.sqrt((directionX * directionX) + (directionZ * directionZ));

    if (directionMagnitude > 0.001) {
      directionX /= directionMagnitude;
      directionZ /= directionMagnitude;
    } else {
      directionX = Math.sin(actor.rotationY || 0);
      directionZ = Math.cos(actor.rotationY || 0);
    }

    this.clearSoccerBallPossession();
    soccerBall.velocity.x = directionX * SOCCER_BALL_KICK_SPEED;
    soccerBall.velocity.z = directionZ * SOCCER_BALL_KICK_SPEED;
    soccerBall.position.y = soccerBall.radius || SOCCER_FIELD.ballRadius;
    soccerBall.lastTouchedByActorId = actor.id;
    soccerBall.lastTouchedByActorName = actor.name;

    actor.status = 'acting';
    actor.currentAction = 'kick_ball';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, logContext);
    return true;
  }

  async appendPlayerChatEntry(player, message) {
    const persistedEntry = await insertChatMessage({
      userId: player?.id || null,
      playerName: player?.name || 'Jogador',
      message,
      moderationStatus: 'visible',
    });

    if (!persistedEntry) {
      return {
        ok: false,
        statusCode: 500,
        publicError: 'Nao foi possivel salvar a mensagem agora.',
      };
    }

    this.state.playerChat.push({
      id: persistedEntry.id,
      playerId: persistedEntry.userId,
      playerName: persistedEntry.playerName,
      message: persistedEntry.message,
      createdAt: new Date(persistedEntry.createdAt).getTime(),
    });

    if (this.state.playerChat.length > PLAYER_CHAT_HISTORY_LIMIT) {
      this.state.playerChat.splice(0, this.state.playerChat.length - PLAYER_CHAT_HISTORY_LIMIT);
    }

    return { ok: true };
  }

  updatePlayerProfile(player, profile) {
    const nextNickname = sanitizeNickname(profile?.nickname);
    const nextAppearance = buildPlayerAppearance(profile);
    const realName = sanitizeText(player?.realName, 255) || 'Jogador';

    if (!nextNickname) {
      return {
        ok: false,
        statusCode: 400,
        publicError: 'Informe um apelido valido para o jogo.',
      };
    }

    if (areNamesEquivalent(nextNickname, realName)) {
      return {
        ok: false,
        statusCode: 400,
        publicError: 'Por privacidade, use um apelido diferente do seu nome real.',
      };
    }

    const previousNickname = player.name;
    const previousOutfitColor = player.appearance?.outfitColor || null;
    const hasChanged = previousNickname !== nextNickname || previousOutfitColor !== nextAppearance.outfitColor;

    player.name = nextNickname;
    player.appearance = nextAppearance;

    if (hasChanged) {
      const detailParts = [];

      if (previousNickname && previousNickname !== nextNickname) {
        detailParts.push(`previous_game_nickname=${formatLogDetailValue(previousNickname)}`);
      }

      if (previousOutfitColor && previousOutfitColor !== nextAppearance.outfitColor) {
        detailParts.push(`previous_outfit_color=${formatLogDetailValue(previousOutfitColor)}`);
      }

      this.persistActorStats(player);
      this.logEvent('player_profile_updated', buildPlayerLogContext(player, {
        details: detailParts.join('; '),
      }));
    }

    return {
      ok: true,
      profile: {
        name: player.name,
        appearance: buildPlayerAppearance(player.appearance),
      },
    };
  }

  advanceSimulation(deltaMs) {
    const deltaSeconds = deltaMs / 1000;
    const now = Date.now();

    this.state.tick += 1;

    if (config.AI_GAME_ENABLED) {
      this.advanceActorVitals(this.state.ai, deltaSeconds, now);
      this.advanceActorRespawn(this.state.ai, now);
      if (this.state.ai.status !== 'dead') {
        this.advanceAiMovement(deltaSeconds, now);
      }
    }

    for (const player of this.state.players.values()) {
      this.advancePlayer(player, deltaSeconds, now);
    }

    this.advanceSoccerBall(deltaSeconds, now);
    this.advanceArrowProjectiles(deltaSeconds, now);
    this.advanceTreeRegrowth(now);
    this.cleanupExpiredGraves(now);
    this.cleanupInactivePlayers(now);
    this.advanceElevators(deltaSeconds, now);
  }

  advanceElevators(deltaSeconds, now) {
    if (!Array.isArray(this.state.world.elevators)) return;

    const elevators = this.state.world.elevators;
    const layout = getHouseTowerElevators(this.state.world.house);
    const speed = 10.0;

    for (let index = 0; index < elevators.length; index += 1) {
      const e = elevators[index];
      const eLayout = layout.find((l) => l.id === e.id);
      if (!eLayout) continue;

      let targetY = e.y;
      let diffY = 0;

      if (e.state === 'going_down') {
        e.y -= speed * deltaSeconds;
        if (e.y <= eLayout.bottomY) {
          e.y = eLayout.bottomY;
          e.state = 'idle_bottom';
          e.timer = now + 2000;
        }
        diffY = e.y - targetY;
      } else if (e.state === 'idle_bottom') {
        if (now >= e.timer) {
          e.state = 'going_up';
        }
      } else if (e.state === 'going_up') {
        e.y += speed * deltaSeconds;
        if (e.y >= eLayout.topY) {
          e.y = eLayout.topY;
          e.state = 'idle_top';
        }
        diffY = e.y - targetY;
      }

      if (diffY !== 0) {
        const moveActor = (actor) => {
          if (!actor || actor.status === 'dead') return;
          // Check if they are standing on the elevator top surface
          if (
            actor.position.x >= eLayout.topSurface.minX - 0.1 &&
            actor.position.x <= eLayout.topSurface.maxX + 0.1 &&
            actor.position.z >= eLayout.topSurface.minZ - 0.1 &&
            actor.position.z <= eLayout.topSurface.maxZ + 0.1
          ) {
            // Check if they are physically near the platform height
            if (Math.abs(actor.position.y - targetY) < 1.0) {
              actor.position.y = Math.max(0, actor.position.y + diffY);
              // Also sync their walkable position just in case
              const resolved = resolveWalkablePosition(this.state.world, actor.position, actor.position);
              actor.position.y = resolved.y;
            }
          }
        };

        moveActor(this.state.ai);
        for (const player of this.state.players.values()) {
          moveActor(player);
        }
      }
    }
  }

  advanceActorVitals(actor, deltaSeconds, now) {
    if (actor.speech && actor.speechExpiresAt <= now) {
      actor.speech = null;
      actor.speechExpiresAt = 0;
    }

    if (actor.status === 'dead') {
      return;
    }

    actor.inventory.food = clamp(
      actor.inventory.food - (FOOD_DECAY_PER_SECOND * deltaSeconds),
      0,
      MAX_FOOD
    );
    actor.inventory.water = clamp(
      actor.inventory.water - (WATER_DECAY_PER_SECOND * deltaSeconds),
      0,
      MAX_WATER
    );

    let deathReason = null;
    if (actor.inventory.food <= 0 && actor.inventory.water <= 0) {
      deathReason = 'food_and_water_depleted';
    } else if (actor.inventory.food <= 0) {
      deathReason = 'food_depleted';
    } else if (actor.inventory.water <= 0) {
      deathReason = 'water_depleted';
    }

    if (deathReason) {
      this.handleActorDeath(actor, deathReason, now);
      return;
    }
  }

  awardActorScore(actor, points) {
    if (!actor || actor.status === 'dead') {
      return;
    }

    const normalizedPoints = Math.max(0, Math.trunc(points || 0));
    if (normalizedPoints <= 0) {
      return;
    }

    const previousScore = Math.max(0, Math.trunc(actor.score || 0));
    const nextScore = previousScore + normalizedPoints;
    actor.score = nextScore;
    actor.bestScore = Math.max(Math.max(0, Math.trunc(actor.bestScore || 0)), nextScore);
    actor.scoreProgress = 0;
    actor.scoreDirection = 0;
    this.persistActorStats(actor);
  }

  handleActorDeath(actor, reason, now = Date.now()) {
    if (!actor || actor.status === 'dead') {
      return;
    }

    this.clearSoccerBallPossessionIfHeldByActor(actor.id);
    actor.status = 'dead';
    actor.currentAction = 'respawning';
    actor.actionCooldownUntil = now + RESPAWN_DELAY_MS;
    actor.respawnAt = now + RESPAWN_DELAY_MS;
    actor.speech = null;
    actor.speechExpiresAt = 0;
    actor.score = 0;
    actor.scoreProgress = 0;
    actor.scoreDirection = 0;
    actor.deaths = Math.max(0, Math.trunc(actor.deaths || 0)) + 1;
    actor.lastDeathReason = reason;

    if (actor.input) {
      actor.input.moveX = 0;
      actor.input.moveZ = 0;
      actor.input.isRunning = false;
    }

    if (actor.actorType === 'ai') {
      this.clearMovement();
      this.state.nextDecisionAt = actor.respawnAt;
    }

    this.dropSwordInventory(actor);
    this.dropBowInventory(actor);

    this.state.world.graves.push({
      id: `grave-${actor.actorType}-${actor.id}-${now}`,
      actorId: actor.id,
      actorType: actor.actorType,
      actorName: actor.name,
      position: clonePoint(actor.position),
      expiresAt: now + GRAVE_DURATION_MS,
    });

    if (actor.actorType === 'ai') {
      this.logEvent('ai_died', {
        userId: actor.id,
        userName: actor.name,
        userAgent: 'backend-ai',
        details: `reason=${reason}; x=${roundNumber(actor.position.x, 2)}; z=${roundNumber(actor.position.z, 2)}`,
      });
    } else {
      this.logEvent('player_died', buildPlayerLogContext(actor, {
        details: `reason=${formatLogDetailValue(reason)}; x=${roundNumber(actor.position.x, 2)}; z=${roundNumber(actor.position.z, 2)}`,
      }));
    }
    this.persistActorStats(actor);
  }

  advanceActorRespawn(actor, now) {
    if (!actor || actor.status !== 'dead' || now < actor.respawnAt) {
      return false;
    }

    const spawnPoint = actor.actorType === 'ai'
      ? clonePoint(AI_SPAWN_POINT)
      : this.pickSpawnPoint();

    actor.position.x = spawnPoint.x;
    actor.position.y = spawnPoint.y;
    actor.position.z = spawnPoint.z;
    actor.rotationY = Math.PI;
    actor.status = 'idle';
    actor.currentAction = 'wait';
    actor.actionCooldownUntil = 0;
    actor.respawnAt = 0;
    actor.inventory.apples = 0;
    actor.inventory.hasSword = false;
    actor.inventory.hasBow = false;
    actor.inventory.arrows = 0;
    actor.inventory.food = MAX_FOOD;
    actor.inventory.water = MAX_WATER;
    actor.speech = null;
    actor.speechExpiresAt = 0;
    actor.hitFlashUntil = 0;
    actor.lastHitAt = 0;
    actor.lastHitType = null;
    actor.scoreProgress = 0;
    actor.scoreDirection = 0;
    actor.lastDeathReason = null;
    actor.respawns = Math.max(0, Math.trunc(actor.respawns || 0)) + 1;

    if (actor.input) {
      actor.input.moveX = 0;
      actor.input.moveZ = 0;
      actor.input.isRunning = false;
    }

    if (actor.actorType === 'ai') {
      this.clearMovement();
      this.state.nextDecisionAt = now + 400;
    }

    if (actor.actorType === 'ai') {
      this.logEvent('ai_respawned', {
        userId: actor.id,
        userName: actor.name,
        userAgent: 'backend-ai',
        details: `x=${roundNumber(actor.position.x, 2)}; z=${roundNumber(actor.position.z, 2)}`,
      });
    } else {
      this.logEvent('player_respawned', buildPlayerLogContext(actor, {
        details: `x=${roundNumber(actor.position.x, 2)}; z=${roundNumber(actor.position.z, 2)}`,
      }));
    }
    this.persistActorStats(actor);
    return true;
  }

  advancePlayer(player, deltaSeconds, now) {
    this.advanceActorVitals(player, deltaSeconds, now);

    if (this.advanceActorRespawn(player, now)) {
      return;
    }

    if (player.status === 'dead') {
      return;
    }

    const moveX = Number(player.input.moveX) || 0;
    const moveZ = Number(player.input.moveZ) || 0;
    const isRunning = Boolean(player.input.isRunning);
    const magnitude = Math.sqrt((moveX * moveX) + (moveZ * moveZ));

    if (magnitude > 0.001) {
      const previousPosition = {
        x: player.position.x,
        z: player.position.z,
      };
      const directionX = moveX / magnitude;
      const directionZ = moveZ / magnitude;
      const moveSpeed = isRunning ? config.PLAYER_RUN_SPEED : config.PLAYER_MOVE_SPEED;
      const step = moveSpeed * deltaSeconds;

      if (player.currentAction !== 'move') {
        this.logEvent('player_started_moving', buildPlayerLogContext(player));
      }

      const nextPosition = resolveWalkablePosition(
        this.state.world,
        player.position,
        {
          x: player.position.x + (directionX * step),
          y: player.position.y,
          z: player.position.z + (directionZ * step),
        },
        PLAYER_COLLISION_RADIUS
      );
      player.position.x = nextPosition.x;
      player.position.y = nextPosition.y;
      player.position.z = nextPosition.z;
      player.rotationY = Math.atan2(directionX, directionZ);
      player.status = 'moving';
      player.currentAction = 'move';
      if (this.maybeRegisterSoccerGoalFromCarrierMovement(player, previousPosition, now)) {
        return;
      }
      this.bumpSoccerBallFromPlayer(player, previousPosition);
      return;
    }

    if (player.actionCooldownUntil > now) {
      player.status = 'acting';
      return;
    }

    player.status = 'idle';
    if (player.currentAction === 'move') {
      player.currentAction = 'wait';
    } else if (player.currentAction !== 'drink_water' && player.currentAction !== 'pick_fruit' && player.currentAction !== 'eat_fruit') {
      player.currentAction = 'wait';
    } else if (player.actionCooldownUntil <= now) {
      player.currentAction = 'wait';
    }
  }

  cleanupInactivePlayers(now) {
    for (const [playerId, player] of this.state.players.entries()) {
      if ((now - player.lastSeenAt) > config.PLAYER_IDLE_TIMEOUT_MS) {
        this.disconnectPlayer(playerId, 'timeout');
      }
    }
  }

  cleanupExpiredGraves(now) {
    if (!Array.isArray(this.state.world.graves) || this.state.world.graves.length === 0) {
      return;
    }

    this.state.world.graves = this.state.world.graves.filter((grave) => {
      return Number.isFinite(grave.expiresAt) && grave.expiresAt > now;
    });
  }

  planAiRoute(target, { resetReplanCount = false } = {}) {
    if (!target?.position) {
      return false;
    }

    const route = computeAiRoute(
      this.state.world,
      this.state.ai.position,
      target.position,
      PLAYER_COLLISION_RADIUS
    );

    this.state.ai.movementRoute = route;
    this.state.ai.movementRouteIndex = 0;
    this.state.ai.movementStuckTicks = 0;

    if (resetReplanCount) {
      this.state.ai.movementReplanCount = 0;
    }

    return route.length > 0;
  }

  replanAiRoute(target, now) {
    if (!target?.position) {
      return false;
    }

    this.state.ai.movementReplanCount += 1;
    if (this.state.ai.movementReplanCount > AI_ROUTE_REPLAN_LIMIT) {
      this.logEvent('ai_route_failed', {
        details: `target=${target.id}; reason=max_replans`,
      });
      this.state.ai.status = 'idle';
      this.state.ai.currentAction = 'wait';
      this.state.nextDecisionAt = now + 350;
      this.clearMovement();
      return false;
    }

    const planned = this.planAiRoute(target);
    if (!planned) {
      this.logEvent('ai_route_failed', {
        details: `target=${target.id}; reason=no_path; attempt=${this.state.ai.movementReplanCount}`,
      });
      this.state.ai.status = 'idle';
      this.state.ai.currentAction = 'wait';
      this.state.nextDecisionAt = now + 350;
      this.clearMovement();
      return false;
    }

    this.logEvent('ai_route_replanned', {
      details: `target=${target.id}; attempt=${this.state.ai.movementReplanCount}; waypoints=${this.state.ai.movementRoute.length}`,
    });
    return true;
  }

  advanceAiMovement(deltaSeconds, now) {
    if (this.state.ai.status === 'dead') {
      return;
    }

    if (!this.state.ai.movementTargetId) {
      if (this.state.ai.actionCooldownUntil <= now && this.state.ai.currentAction !== 'wait') {
        this.state.ai.status = 'idle';
        if (this.state.ai.currentAction !== 'move_to') {
          this.state.ai.currentAction = 'wait';
        }
      }
      return;
    }

    const target = getTargetById(this.state.world, this.state.ai.movementTargetId);
    if (!target) {
      this.clearMovement();
      return;
    }

    const distance = distanceBetween(this.state.ai.position, target.position);
    if (distance <= ARRIVAL_RADIUS) {
      const resolvedTargetPosition = resolveWalkablePosition(
        this.state.world,
        this.state.ai.position,
        target.position,
        PLAYER_COLLISION_RADIUS
      );
      this.state.ai.position.x = resolvedTargetPosition.x;
      this.state.ai.position.y = resolvedTargetPosition.y;
      this.state.ai.position.z = resolvedTargetPosition.z;
      this.state.ai.status = 'idle';
      this.state.ai.currentAction = 'wait';
      this.state.nextDecisionAt = now + 200;
      this.clearMovement();
      this.logEvent('ai_target_reached');
      return;
    }

    if (
      !Array.isArray(this.state.ai.movementRoute)
      || this.state.ai.movementRoute.length === 0
      || this.state.ai.movementRouteIndex >= this.state.ai.movementRoute.length
    ) {
      const planned = this.planAiRoute(target, { resetReplanCount: false });
      if (!planned) {
        this.logEvent('ai_route_failed', {
          details: `target=${target.id}; reason=no_initial_path`,
        });
        this.state.ai.status = 'idle';
        this.state.ai.currentAction = 'wait';
        this.state.nextDecisionAt = now + 350;
        this.clearMovement();
        return;
      }
    }

    while (this.state.ai.movementRouteIndex < this.state.ai.movementRoute.length) {
      const waypoint = this.state.ai.movementRoute[this.state.ai.movementRouteIndex];
      if (distanceBetween(this.state.ai.position, waypoint) > AI_ROUTE_WAYPOINT_RADIUS) {
        break;
      }

      this.state.ai.movementRouteIndex += 1;
    }

    const movementGoal = this.state.ai.movementRoute[this.state.ai.movementRouteIndex] || target.position;
    const goalDistance = distanceBetween(this.state.ai.position, movementGoal);
    if (goalDistance <= 0.0001) {
      this.state.ai.movementRouteIndex += 1;
      return;
    }

    const step = Math.min(config.AI_MOVE_SPEED * deltaSeconds, goalDistance);
    const directionX = (movementGoal.x - this.state.ai.position.x) / goalDistance;
    const directionZ = (movementGoal.z - this.state.ai.position.z) / goalDistance;
    const previousPosition = clonePoint(this.state.ai.position);
    const nextPosition = resolveWalkablePosition(
      this.state.world,
      this.state.ai.position,
      {
        x: this.state.ai.position.x + (directionX * step),
        y: this.state.ai.position.y,
        z: this.state.ai.position.z + (directionZ * step),
      },
      PLAYER_COLLISION_RADIUS
    );

    const movedDistance = distanceBetween(previousPosition, nextPosition);
    if (movedDistance <= AI_ROUTE_STUCK_DISTANCE) {
      this.state.ai.movementStuckTicks += 1;

      if (this.state.ai.movementStuckTicks >= AI_ROUTE_REPLAN_TICKS) {
        this.replanAiRoute(target, now);
      }
      return;
    }

    this.state.ai.movementStuckTicks = 0;
    this.state.ai.position.x = nextPosition.x;
    this.state.ai.position.y = nextPosition.y;
    this.state.ai.position.z = nextPosition.z;
    this.state.ai.rotationY = Math.atan2(directionX, directionZ);
    this.state.ai.status = 'moving';
    this.state.ai.currentAction = 'move_to';

    if (distanceBetween(this.state.ai.position, movementGoal) <= AI_ROUTE_WAYPOINT_RADIUS) {
      this.state.ai.movementRouteIndex += 1;
    }
  }

  isAiCompletingDecision(now) {
    if (this.state.ai.currentAction === 'move_to' && this.state.ai.movementTargetId) {
      return true;
    }

    const actionRequiresCooldownCompletion =
      this.state.ai.currentAction === 'drink_water'
      || this.state.ai.currentAction === 'pick_fruit'
      || this.state.ai.currentAction === 'eat_fruit';

    return actionRequiresCooldownCompletion && now < this.state.ai.actionCooldownUntil;
  }

  async maybeRequestDecision() {
    if (!config.AI_GAME_ENABLED || this.pendingDecision) {
      return;
    }

    const now = Date.now();
    if (this.state.ai.status === 'dead') {
      this.state.nextDecisionAt = Math.max(this.state.nextDecisionAt, this.state.ai.respawnAt || (now + 500));
      return;
    }

    if (this.isAiCompletingDecision(now)) {
      return;
    }

    if (now < this.state.nextDecisionAt) {
      return;
    }

    const observation = this.buildObservation();
    this.pendingDecision = true;

    try {
      const modelDecision = await this.decisionClient.decideNextAction(observation);
      const normalizedDecision = normalizeDecision(modelDecision, observation);
      if (modelDecision && !normalizedDecision) {
        this.logEvent('ai_invalid_model_decision');
      }

      const decision = normalizedDecision || chooseFallbackDecision(observation);
      this.applyDecision(decision, normalizedDecision ? 'openai' : 'fallback');
    } catch (error) {
      this.state.lastError = error.message;
      const retryDelayMs = getDecisionRetryDelayMs(error);
      const errorDetails = buildModelErrorDetails(error);

      if (Number(error?.statusCode) === 429) {
        this.logEvent('ai_model_rate_limited', {
          details: errorDetails,
        });
        this.logger.warn('AI model request rate limited:', error.message);
      } else {
        this.logEvent('ai_model_error', {
          details: errorDetails,
        });
        this.logger.error('AI model request failed:', error.message);
      }

      const fallbackDecision = chooseFallbackDecision(observation);
      this.applyDecision(fallbackDecision, 'fallback', {
        clearLastError: false,
        nextDecisionDelayMs: retryDelayMs,
      });
    } finally {
      this.pendingDecision = false;
    }
  }

  buildObservation() {
    const now = Date.now();
    const availableActions = this.getAvailableActions(this.state.ai, now);
    const targets = [
      {
        id: LAKE.id,
        type: 'lake',
        distance: roundNumber(distanceBetween(this.state.ai.position, this.state.world.lake.position), 1),
        applesRemaining: null,
      },
      ...this.state.world.trees
        .filter((tree) => tree.applesRemaining > 0)
        .map((tree) => ({
          id: tree.id,
          type: 'tree',
          distance: roundNumber(distanceBetween(this.state.ai.position, tree.position), 1),
          applesRemaining: tree.applesRemaining,
        }))
        .sort((left, right) => left.distance - right.distance),
    ];

    return {
      self: {
        position: buildRoundedPosition(this.state.ai.position),
        food: roundNumber(this.state.ai.inventory.food, 1),
        water: roundNumber(this.state.ai.inventory.water, 1),
        apples: this.state.ai.inventory.apples,
        score: Math.max(0, Math.trunc(this.state.ai.score || 0)),
        status: this.state.ai.status,
        cooldown_ms: Math.max(0, this.state.ai.actionCooldownUntil - now),
      },
      recent_actions: this.state.ai.recentActions.map((entry) => ({
        action: entry.action,
        target_id: entry.target_id,
      })),
      available_actions: availableActions,
      current_target_id: this.state.ai.movementTargetId,
      world: {
        bounds: this.state.world.bounds,
        lake_radius: this.state.world.lake.radius,
        healthy_threshold: SCORE_HEALTHY_THRESHOLD,
        death_at_zero: true,
        respawn_delay_ms: RESPAWN_DELAY_MS,
      },
      targets,
    };
  }

  applyDecision(decision, source, {
    clearLastError = true,
    nextDecisionDelayMs = config.AI_DECISION_INTERVAL_MS,
  } = {}) {
    const now = Date.now();
    const effectiveDelayMs = Number.isFinite(nextDecisionDelayMs)
      ? nextDecisionDelayMs
      : config.AI_DECISION_INTERVAL_MS;

    this.state.lastDecisionAt = now;
    this.state.lastDecisionSource = source;
    this.state.ai.provider = source;
    this.state.nextDecisionAt = now + effectiveDelayMs;

    if (this.state.ai.status === 'dead') {
      this.state.nextDecisionAt = Math.max(this.state.nextDecisionAt, this.state.ai.respawnAt || (now + effectiveDelayMs));
      return;
    }

    if (clearLastError) {
      this.state.lastError = null;
    }

    if (decision.speech) {
      this.state.ai.speech = decision.speech;
      this.state.ai.speechExpiresAt = now + 4000;
    }

    switch (decision.action) {
      case 'move_to': {
        const target = getTargetById(this.state.world, decision.targetId);
        if (!target) {
          this.state.ai.status = 'idle';
          this.state.ai.currentAction = 'wait';
          this.clearMovement();
          return;
        }

        this.state.ai.movementTargetId = decision.targetId;
        this.state.ai.movementReplanCount = 0;
        const planned = this.planAiRoute(target, { resetReplanCount: true });
        if (!planned) {
          this.logEvent('ai_route_failed', {
            details: `target=${decision.targetId}; reason=no_path_on_decision`,
          });
          this.state.ai.status = 'idle';
          this.state.ai.currentAction = 'wait';
          this.state.nextDecisionAt = now + 350;
          this.clearMovement();
          return;
        }

        this.state.ai.status = 'moving';
        this.state.ai.currentAction = 'move_to';
        this.rememberAiAction('move_to', decision.targetId);
        this.logEvent('ai_move_to_target');
        return;
      }
      case 'drink_water':
        this.performDrink(this.state.ai, 'ai_drink_water', {
          userId: this.state.ai.id,
          userName: this.state.ai.name,
          userAgent: 'backend-ai',
        }, { clearMovement: true });
        return;
      case 'pick_fruit':
        this.performPickFruit(this.state.ai, 'ai_pick_fruit', {
          userId: this.state.ai.id,
          userName: this.state.ai.name,
          userAgent: 'backend-ai',
        }, { clearMovement: true });
        return;
      case 'eat_fruit':
        this.performEatFruit(this.state.ai, 'ai_eat_fruit', {
          userId: this.state.ai.id,
          userName: this.state.ai.name,
          userAgent: 'backend-ai',
        }, { clearMovement: true });
        return;
      default:
        this.state.ai.status = 'idle';
        this.state.ai.currentAction = 'wait';
        this.clearMovement();
        this.rememberAiAction('wait');
    }
  }

  performDrink(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!this.isNearLake(actor.position)) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    actor.inventory.water = clamp(actor.inventory.water + DRINK_AMOUNT, 0, MAX_WATER);
    actor.status = 'acting';
    actor.currentAction = 'drink_water';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    if (actor === this.state.ai) {
      this.rememberAiAction('drink_water');
    }

    this.awardActorScore(actor, DRINK_SCORE_POINTS);
    this.logEvent(eventName, logContext);
    return true;
  }

  performTowerElevatorRide(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    const nearbyElevator = getNearbyTowerElevator(this.state.world, actor.position);
    if (!nearbyElevator) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const e = this.state.world.elevators.find((e) => e.id === nearbyElevator.id);
    if (e && e.state === 'idle_top') {
      e.state = 'going_down';
    }

    actor.status = 'acting';
    actor.currentAction = 'ride_elevator';
    actor.actionCooldownUntil = Date.now() + TOWER_ELEVATOR_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `tower=${nearbyElevator.id}; triggered=true`,
    }));
    return true;
  }

  getNearbyBowPickup(position, maxDistance = BOW_PICKUP_RADIUS) {
    const bows = Array.isArray(this.state.world?.bows)
      ? this.state.world.bows
      : [];
    let closestBow = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    bows.forEach((bow) => {
      const distance = distanceBetween(position, bow.position);
      if (distance < maxDistance && distance < closestDistance) {
        closestBow = bow;
        closestDistance = distance;
      }
    });

    return closestBow;
  }

  getNearbySwordPickup(position, maxDistance = SWORD_PICKUP_RADIUS) {
    const swords = Array.isArray(this.state.world?.swords)
      ? this.state.world.swords
      : [];
    let closestSword = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    swords.forEach((sword) => {
      const distance = distanceBetween(position, sword.position);
      if (distance < maxDistance && distance < closestDistance) {
        closestSword = sword;
        closestDistance = distance;
      }
    });

    return closestSword;
  }

  getNearbyDroppedApple(position, maxDistance = DROPPED_APPLE_PICKUP_RADIUS) {
    const droppedApples = Array.isArray(this.state.world?.droppedApples)
      ? this.state.world.droppedApples
      : [];
    let closestApple = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    droppedApples.forEach((apple) => {
      const distance = distanceBetween(position, apple.position);
      if (distance < maxDistance && distance < closestDistance) {
        closestApple = apple;
        closestDistance = distance;
      }
    });

    return closestApple;
  }

  getNearbyFruitPickupSource(position) {
    const nearbyTree = this.getNearbyFruitTree(position);
    const nearbyDroppedApple = this.getNearbyDroppedApple(position);

    if (nearbyTree && nearbyDroppedApple) {
      const treeDistance = distanceBetween(position, nearbyTree.position);
      const droppedDistance = distanceBetween(position, nearbyDroppedApple.position);
      return droppedDistance <= treeDistance
        ? { type: 'ground', apple: nearbyDroppedApple }
        : { type: 'tree', tree: nearbyTree };
    }

    if (nearbyDroppedApple) {
      return { type: 'ground', apple: nearbyDroppedApple };
    }

    if (nearbyTree) {
      return { type: 'tree', tree: nearbyTree };
    }

    return null;
  }

  buildDroppedApplePosition(actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * DROPPED_APPLE_DROP_DISTANCE),
      y: DROPPED_APPLE_GROUND_Y,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * DROPPED_APPLE_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      this.state.world,
      actor.position,
      desiredPosition,
      0.18
    );

    return {
      x: resolvedPosition.x,
      y: DROPPED_APPLE_GROUND_Y,
      z: resolvedPosition.z,
    };
  }

  buildDroppedBowPosition(actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * BOW_DROP_DISTANCE),
      y: Number(actor?.position?.y) || 0,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * BOW_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      this.state.world,
      actor.position,
      desiredPosition,
      0.2
    );

    return {
      x: resolvedPosition.x,
      y: resolvedPosition.y + BOW_GROUND_OFFSET_Y,
      z: resolvedPosition.z,
    };
  }

  buildDroppedSwordPosition(actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * SWORD_DROP_DISTANCE),
      y: Number(actor?.position?.y) || 0,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * SWORD_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      this.state.world,
      actor.position,
      desiredPosition,
      0.2
    );

    return {
      x: resolvedPosition.x,
      y: resolvedPosition.y + SWORD_GROUND_OFFSET_Y,
      z: resolvedPosition.z,
    };
  }

  dropSwordInventory(actor) {
    if (!actor?.inventory?.hasSword) {
      return null;
    }

    const droppedSword = {
      id: `dropped-sword-${this.state.nextDroppedSwordId}`,
      position: this.buildDroppedSwordPosition(actor),
    };

    this.state.nextDroppedSwordId += 1;
    this.state.world.swords.push(droppedSword);
    actor.inventory.hasSword = false;
    return droppedSword;
  }

  dropBowInventory(actor) {
    if (!actor?.inventory?.hasBow) {
      return null;
    }

    const storedArrows = Math.max(0, Math.trunc(Number(actor.inventory.arrows) || 0));
    const droppedBow = {
      id: `dropped-bow-${this.state.nextDroppedBowId}`,
      position: this.buildDroppedBowPosition(actor),
      arrowsRemaining: storedArrows > 0 ? storedArrows : BOW_DEFAULT_ARROW_COUNT,
    };

    this.state.nextDroppedBowId += 1;
    this.state.world.bows.push(droppedBow);
    actor.inventory.hasBow = false;
    actor.inventory.arrows = 0;
    return droppedBow;
  }

  performPickSword(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory?.hasSword || actor.inventory?.hasBow || (Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const nearbySword = this.getNearbySwordPickup(actor.position);
    if (!nearbySword) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    this.state.world.swords = (this.state.world.swords || [])
      .filter((sword) => sword.id !== nearbySword.id);
    actor.inventory.hasSword = true;
    actor.status = 'acting';
    actor.currentAction = 'pick_sword';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `sword=${nearbySword.id}`,
    }));
    return true;
  }

  performDropSword(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasSword) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedSword = this.dropSwordInventory(actor);
    if (!droppedSword) {
      return false;
    }

    actor.status = 'acting';
    actor.currentAction = 'drop_sword';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `sword=${droppedSword.id}`,
    }));
    return true;
  }

  getSwordAttackTarget(actor) {
    if (!actor || actor.status === 'dead' || !actor.inventory?.hasSword) {
      return null;
    }

    const forwardX = Math.sin(Number(actor.rotationY) || 0);
    const forwardZ = Math.cos(Number(actor.rotationY) || 0);
    const candidates = [];
    const pushCandidate = (target) => {
      if (!target || target.id === actor.id || target.status === 'dead') {
        return;
      }

      const verticalDelta = Math.abs((Number(target.position?.y) || 0) - (Number(actor.position?.y) || 0));
      if (verticalDelta > SWORD_ATTACK_VERTICAL_TOLERANCE) {
        return;
      }

      const deltaX = (Number(target.position?.x) || 0) - (Number(actor.position?.x) || 0);
      const deltaZ = (Number(target.position?.z) || 0) - (Number(actor.position?.z) || 0);
      const distance = Math.sqrt((deltaX * deltaX) + (deltaZ * deltaZ));
      if (distance <= 0.001 || distance > SWORD_ATTACK_RADIUS) {
        return;
      }

      const directionX = deltaX / distance;
      const directionZ = deltaZ / distance;
      const facingDot = (forwardX * directionX) + (forwardZ * directionZ);
      if (facingDot < SWORD_ATTACK_ARC_DOT_THRESHOLD) {
        return;
      }

      if (!isRouteSegmentClear(this.state.world, actor.position, target.position, SWORD_ATTACK_LINE_PADDING)) {
        return;
      }

      candidates.push({ target, distance, facingDot });
    };

    pushCandidate(this.state.ai);
    this.state.players.forEach((player) => {
      pushCandidate(player);
    });

    candidates.sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return right.facingDot - left.facingDot;
    });

    return candidates[0]?.target || null;
  }

  applyHitResourceLoss(target, {
    hitType = 'impact',
    appleDamage = 0,
    waterDamage = 0,
    now = Date.now(),
  } = {}) {
    if (!target || target.status === 'dead') {
      return {
        applesLost: 0,
        waterLost: 0,
      };
    }

    const previousApples = Math.max(0, Math.trunc(Number(target.inventory?.apples) || 0));
    const previousWater = clamp(Number(target.inventory?.water) || 0, 0, MAX_WATER);
    const applesLost = Math.min(previousApples, Math.max(0, Math.trunc(Number(appleDamage) || 0)));
    const waterLost = Math.min(previousWater, Math.max(0, Number(waterDamage) || 0));

    target.inventory.apples = previousApples - applesLost;
    target.inventory.water = clamp(previousWater - waterLost, 0, MAX_WATER);
    target.hitFlashUntil = now + ACTOR_HIT_FLASH_DURATION_MS;
    target.lastHitAt = now;
    target.lastHitType = hitType;

    return {
      applesLost,
      waterLost,
    };
  }

  applyActorKnockback(target, sourceRotationY, distance = SWORD_KNOCKBACK_DISTANCE) {
    if (!target || target.status === 'dead') {
      return false;
    }

    const totalDistance = Math.max(0, Number(distance) || 0);
    if (totalDistance <= 0.001) {
      return false;
    }

    const directionX = Math.sin(Number(sourceRotationY) || 0);
    const directionZ = Math.cos(Number(sourceRotationY) || 0);
    const stepDistance = Math.max(0.12, Number(SWORD_KNOCKBACK_STEP_DISTANCE) || 0.45);
    const steps = Math.max(1, Math.ceil(totalDistance / stepDistance));
    let currentPosition = clonePoint(target.position);
    let movedAny = false;

    for (let index = 0; index < steps; index += 1) {
      const remainingDistance = totalDistance - (index * stepDistance);
      const currentStepDistance = Math.min(stepDistance, remainingDistance);
      if (currentStepDistance <= 0.0001) {
        break;
      }

      const resolvedPosition = resolveWalkablePosition(
        this.state.world,
        currentPosition,
        {
          x: currentPosition.x + (directionX * currentStepDistance),
          y: currentPosition.y,
          z: currentPosition.z + (directionZ * currentStepDistance),
        },
        PLAYER_COLLISION_RADIUS
      );

      if (distanceBetween(currentPosition, resolvedPosition) <= 0.01) {
        break;
      }

      currentPosition = resolvedPosition;
      movedAny = true;
    }

    target.position.x = currentPosition.x;
    target.position.y = currentPosition.y;
    target.position.z = currentPosition.z;
    return movedAny;
  }

  performSwordAttack(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasSword) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const now = Date.now();
    const target = this.getSwordAttackTarget(actor);
    actor.status = 'acting';
    actor.currentAction = 'attack_sword';
    actor.actionCooldownUntil = now + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    if (!target) {
      this.logEvent(eventName, buildPlayerLogContext(actor, {
        userAgent: logContext?.userAgent || 'backend-game',
        details: 'result="miss"; target_id="-"; target_name="-"',
      }));
      return true;
    }

    const { applesLost, waterLost } = this.applyHitResourceLoss(target, {
      hitType: 'sword',
      appleDamage: SWORD_HIT_APPLE_DAMAGE,
      waterDamage: SWORD_HIT_WATER_DAMAGE,
      now,
    });
    this.applyActorKnockback(target, actor.rotationY, SWORD_KNOCKBACK_DISTANCE);

    if (target === this.state.ai) {
      this.clearMovement();
      this.state.ai.status = 'idle';
      this.state.ai.currentAction = 'wait';
      this.state.nextDecisionAt = Math.max(this.state.nextDecisionAt, now + 500);
    }

    if (target.actorType === 'ai') {
      this.logEvent('ai_hit_by_sword', {
        userId: target.id,
        userName: target.name,
        userAgent: 'backend-ai',
        details: `attacker_id=${formatLogDetailValue(actor.id)}; attacker_name=${formatLogDetailValue(actor.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      });
    } else {
      this.logEvent('player_hit_by_sword', buildPlayerLogContext(target, {
        details: `attacker_id=${formatLogDetailValue(actor.id)}; attacker_name=${formatLogDetailValue(actor.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      }));
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `target_id=${formatLogDetailValue(target.id)}; target_name=${formatLogDetailValue(target.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
    }));
    return true;
  }

  performPickBow(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory?.hasBow || actor.inventory?.hasSword || (Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const nearbyBow = this.getNearbyBowPickup(actor.position);
    if (!nearbyBow) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    this.state.world.bows = (this.state.world.bows || [])
      .filter((bow) => bow.id !== nearbyBow.id);
    actor.inventory.hasBow = true;
    actor.inventory.arrows = Math.max(1, Math.trunc(Number(nearbyBow.arrowsRemaining) || BOW_DEFAULT_ARROW_COUNT));
    actor.status = 'acting';
    actor.currentAction = 'pick_bow';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `bow=${nearbyBow.id}; arrows=${actor.inventory.arrows}`,
    }));
    return true;
  }

  performDropBow(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasBow) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedBow = this.dropBowInventory(actor);
    if (!droppedBow) {
      return false;
    }

    actor.status = 'acting';
    actor.currentAction = 'drop_bow';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `bow=${droppedBow.id}; arrows=${droppedBow.arrowsRemaining}`,
    }));
    return true;
  }

  performShootArrow(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasBow || (Number(actor.inventory?.arrows) || 0) <= 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const rotationY = Number(actor.rotationY) || 0;
    const directionX = Math.sin(rotationY);
    const directionZ = Math.cos(rotationY);
    const now = Date.now();

    this.state.world.arrows.push({
      id: `arrow-${this.state.nextArrowProjectileId}`,
      ownerActorId: actor.id,
      position: {
        x: (Number(actor.position?.x) || 0) + (directionX * ARROW_FORWARD_OFFSET),
        y: (Number(actor.position?.y) || 0) + ARROW_START_HEIGHT,
        z: (Number(actor.position?.z) || 0) + (directionZ * ARROW_FORWARD_OFFSET),
      },
      velocity: {
        x: directionX * ARROW_PROJECTILE_SPEED,
        y: 0,
        z: directionZ * ARROW_PROJECTILE_SPEED,
      },
      rotationY,
      expiresAt: now + ARROW_PROJECTILE_LIFETIME_MS,
    });
    this.state.nextArrowProjectileId += 1;
    actor.inventory.arrows = Math.max(0, Math.trunc(Number(actor.inventory.arrows) || 0) - 1);
    actor.status = 'acting';
    actor.currentAction = 'shoot_arrow';
    actor.actionCooldownUntil = now + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `arrows_remaining=${actor.inventory.arrows}; rotation_y=${roundNumber(rotationY, 3)}`,
    }));
    return true;
  }

  getArrowHitTarget(ownerActorId, startPosition, endPosition) {
    const normalizedOwnerActorId = sanitizeText(ownerActorId, 128);
    const hitRadiusSquared = ARROW_HIT_RADIUS * ARROW_HIT_RADIUS;
    const startY = Number(startPosition?.y) || 0;
    const endY = Number(endPosition?.y) || 0;
    let bestCandidate = null;

    const considerActor = (actor) => {
      if (!actor || actor.status === 'dead' || actor.id === normalizedOwnerActorId) {
        return;
      }

      const closestPoint = getClosestPointOnSegment(startPosition, endPosition, actor.position);
      const actorPositionX = Number(actor.position?.x) || 0;
      const actorPositionZ = Number(actor.position?.z) || 0;
      const deltaX = actorPositionX - closestPoint.x;
      const deltaZ = actorPositionZ - closestPoint.z;
      const planarDistanceSquared = (deltaX * deltaX) + (deltaZ * deltaZ);
      if (planarDistanceSquared > hitRadiusSquared) {
        return;
      }

      const arrowY = startY + ((endY - startY) * closestPoint.progress);
      const actorBaseY = Number(actor.position?.y) || 0;
      if (
        arrowY < (actorBaseY + ARROW_HIT_MIN_Y_OFFSET)
        || arrowY > (actorBaseY + ARROW_HIT_MAX_Y_OFFSET)
      ) {
        return;
      }

      if (
        bestCandidate
        && closestPoint.progress > bestCandidate.progress + 0.0001
      ) {
        return;
      }

      if (
        bestCandidate
        && Math.abs(closestPoint.progress - bestCandidate.progress) <= 0.0001
        && planarDistanceSquared >= bestCandidate.planarDistanceSquared
      ) {
        return;
      }

      bestCandidate = {
        actor,
        progress: closestPoint.progress,
        planarDistanceSquared,
      };
    };

    considerActor(this.state.ai);
    this.state.players.forEach((player) => {
      considerActor(player);
    });

    return bestCandidate?.actor || null;
  }

  applyArrowHit(target, arrow, now) {
    if (!target || target.status === 'dead') {
      return false;
    }

    const { applesLost, waterLost } = this.applyHitResourceLoss(target, {
      hitType: 'arrow',
      appleDamage: ARROW_APPLE_DAMAGE,
      waterDamage: ARROW_WATER_DAMAGE,
      now,
    });

    const shooter = this.getActorById(arrow?.ownerActorId);
    const shooterName = shooter?.name || 'Alguem';
    const shooterId = shooter?.id || sanitizeText(arrow?.ownerActorId, 128) || 'unknown';

    if (target.actorType === 'ai') {
      this.logEvent('ai_hit_by_arrow', {
        userId: target.id,
        userName: target.name,
        userAgent: 'backend-ai',
        details: `shooter_id=${formatLogDetailValue(shooterId)}; shooter_name=${formatLogDetailValue(shooterName)}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      });
    } else {
      this.logEvent('player_hit_by_arrow', buildPlayerLogContext(target, {
        details: `shooter_id=${formatLogDetailValue(shooterId)}; shooter_name=${formatLogDetailValue(shooterName)}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      }));
    }

    return true;
  }

  performPickFruit(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if ((Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const pickupSource = this.getNearbyFruitPickupSource(actor.position);

    if (!pickupSource) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    if (pickupSource.type === 'tree') {
      const nearbyTree = pickupSource.tree;
      nearbyTree.applesRemaining = Math.max(0, nearbyTree.applesRemaining - 1);
      if (!Number.isFinite(nearbyTree.nextAppleRegrowAt) || nearbyTree.nextAppleRegrowAt <= 0) {
        nearbyTree.nextAppleRegrowAt = Date.now() + APPLE_REGROW_INTERVAL_MS;
      }
    } else {
      this.state.world.droppedApples = (this.state.world.droppedApples || [])
        .filter((apple) => apple.id !== pickupSource.apple.id);
    }

    actor.inventory.apples += 1;
    actor.status = 'acting';
    actor.currentAction = 'pick_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    if (actor === this.state.ai) {
      this.rememberAiAction('pick_fruit');
    }

    this.logEvent(eventName, logContext);
    return true;
  }

  performDropFruit(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if ((Number(actor.inventory?.apples) || 0) <= 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedApple = {
      id: `dropped-apple-${this.state.nextDroppedAppleId}`,
      position: this.buildDroppedApplePosition(actor),
    };
    this.state.nextDroppedAppleId += 1;
    this.state.world.droppedApples.push(droppedApple);
    actor.inventory.apples -= 1;
    actor.status = 'acting';
    actor.currentAction = 'drop_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    this.logEvent(eventName, logContext);
    return true;
  }

  performEatFruit(actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory.apples <= 0) {
      if (actor === this.state.ai) {
        this.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    actor.inventory.apples -= 1;
    actor.inventory.food = clamp(actor.inventory.food + FOOD_FROM_APPLE, 0, MAX_FOOD);
    actor.status = 'acting';
    actor.currentAction = 'eat_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      this.clearMovement();
    }

    if (actor === this.state.ai) {
      this.rememberAiAction('eat_fruit');
    }

    this.awardActorScore(actor, EAT_FRUIT_SCORE_POINTS);
    this.logEvent(eventName, logContext);
    return true;
  }

  getAvailableActions(actor, now, { includeDrop = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return {
        elevator_up: false,
        elevator_down: false,
        attack_sword: false,
        shoot_arrow: false,
        kick_ball: false,
        drink_water: false,
        pick_sword: false,
        pick_bow: false,
        pick_fruit: false,
        eat_fruit: false,
        ...(includeDrop ? { drop_sword: false, drop_bow: false, drop_fruit: false } : {}),
      };
    }

    const hasHeldFruit = (Number(actor.inventory?.apples) || 0) > 0;
    const hasHeldSword = Boolean(actor.inventory?.hasSword);
    const hasHeldBow = Boolean(actor.inventory?.hasBow);
    const heldArrows = Math.max(0, Math.trunc(Number(actor.inventory?.arrows) || 0));
    const canActNow = now >= actor.actionCooldownUntil;
    const weaponInteractionsEnabled = actor.actorType !== 'ai';
    const canPickSword = weaponInteractionsEnabled
      && !hasHeldSword
      && !hasHeldBow
      && !hasHeldFruit
      && Boolean(this.getNearbySwordPickup(actor.position));
    const canPickBow = weaponInteractionsEnabled
      && !hasHeldSword
      && !hasHeldBow
      && !hasHeldFruit
      && Boolean(this.getNearbyBowPickup(actor.position));
    const canPickFruit = !hasHeldFruit
      && !hasHeldSword
      && !hasHeldBow
      && Boolean(this.getNearbyFruitPickupSource(actor.position));
    const nearbyElevator = getNearbyTowerElevator(this.state.world, actor.position);
    return {
      elevator_up: nearbyElevator?.direction === 'up' && canActNow,
      elevator_down: nearbyElevator?.direction === 'down' && canActNow,
      attack_sword: weaponInteractionsEnabled && hasHeldSword && canActNow,
      shoot_arrow: weaponInteractionsEnabled && hasHeldBow && heldArrows > 0 && canActNow,
      kick_ball: !hasHeldSword
        && !hasHeldBow
        && !this.isSoccerRestartPaused(now)
        && this.isNearSoccerBall(actor.position)
        && canActNow,
      drink_water: !hasHeldSword && !hasHeldBow && this.isNearLake(actor.position) && canActNow,
      pick_sword: canPickSword && canActNow,
      pick_bow: canPickBow && canActNow,
      pick_fruit: canPickFruit && canActNow,
      eat_fruit: !hasHeldSword && !hasHeldBow && hasHeldFruit && canActNow,
      ...(includeDrop ? {
        drop_sword: weaponInteractionsEnabled && hasHeldSword && canActNow,
        drop_bow: weaponInteractionsEnabled && hasHeldBow && canActNow,
        drop_fruit: hasHeldFruit && canActNow,
      } : {}),
    };
  }

  isNearSoccerBall(position) {
    const ballPosition = getSoccerBallGroundPosition(this.state.world);
    return distanceBetween(position, ballPosition) <= SOCCER_BALL_ACTION_RADIUS;
  }

  isSoccerRestartPaused(now = Date.now()) {
    const restartAt = Number(this.state.world?.soccer?.restartAt) || 0;
    return restartAt > now;
  }

  clearSoccerBallPossession() {
    const ball = this.state.world?.soccer?.ball;
    if (!ball) {
      return;
    }

    ball.possessedByActorId = '';
    ball.possessedByActorName = '';
  }

  clearSoccerBallPossessionIfHeldByActor(actorId) {
    const normalizedActorId = sanitizeText(actorId, 128);
    const ball = this.state.world?.soccer?.ball;
    if (!normalizedActorId || !ball) {
      return;
    }

    if (ball.possessedByActorId === normalizedActorId) {
      this.clearSoccerBallPossession();
    }
  }

  getActorById(actorId) {
    const normalizedActorId = sanitizeText(actorId, 128);
    if (!normalizedActorId) {
      return null;
    }

    if (this.state.ai?.id === normalizedActorId) {
      return this.state.ai;
    }

    return this.state.players.get(normalizedActorId) || null;
  }

  getSoccerBallMagnetDistance() {
    const radius = Number(this.state.world?.soccer?.ball?.radius) || SOCCER_FIELD.ballRadius;
    return PLAYER_COLLISION_RADIUS + radius + 0.14;
  }

  getSoccerBallAnchorPosition(actor) {
    const radius = Number(this.state.world?.soccer?.ball?.radius) || SOCCER_FIELD.ballRadius;
    const forwardOffset = PLAYER_COLLISION_RADIUS + radius + 0.12;
    const rotationY = Number(actor?.rotationY) || 0;

    return {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * forwardOffset),
      y: radius,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * forwardOffset),
    };
  }

  setSoccerBallPossession(actor) {
    if (!actor || actor.status === 'dead' || this.isSoccerRestartPaused()) {
      return false;
    }

    const ball = this.state.world?.soccer?.ball;
    if (!ball || ball.inGoal) {
      return false;
    }

    const anchorPosition = this.getSoccerBallAnchorPosition(actor);
    ball.possessedByActorId = actor.id;
    ball.possessedByActorName = actor.name;
    ball.lastTouchedByActorId = actor.id;
    ball.lastTouchedByActorName = actor.name;
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    ball.position.x = anchorPosition.x;
    ball.position.y = anchorPosition.y;
    ball.position.z = anchorPosition.z;
    return true;
  }

  syncSoccerBallPossession() {
    const ball = this.state.world?.soccer?.ball;
    if (!ball?.possessedByActorId) {
      return false;
    }

    const holder = this.getActorById(ball.possessedByActorId);
    if (!holder || holder.status === 'dead') {
      this.clearSoccerBallPossession();
      return false;
    }

    const anchorPosition = this.getSoccerBallAnchorPosition(holder);
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    ball.position.x = anchorPosition.x;
    ball.position.y = anchorPosition.y;
    ball.position.z = anchorPosition.z;
    ball.lastTouchedByActorId = holder.id;
    ball.lastTouchedByActorName = holder.name;
    this.clampPossessedSoccerBallInsideField();
    return true;
  }

  clampPossessedSoccerBallInsideField() {
    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;
    if (!soccer?.field || !ball?.possessedByActorId) {
      return false;
    }

    const metrics = getSoccerFieldMetrics(this.state.world);
    ball.position.x = clamp(Number(ball.position.x) || 0, metrics.xMin, metrics.xMax);
    ball.position.y = ball.radius || metrics.radius;
    ball.position.z = clamp(Number(ball.position.z) || 0, metrics.zMin, metrics.zMax);
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    return true;
  }

  maybeRegisterSoccerGoalFromCarrierMovement(actor, previousPosition, now) {
    if (!actor || actor.status === 'dead' || this.isSoccerRestartPaused(now)) {
      return false;
    }

    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;
    if (!soccer?.field || !ball || ball.possessedByActorId !== actor.id) {
      return false;
    }

    const metrics = getSoccerFieldMetrics(this.state.world);
    const goalSide = getSoccerGoalSideFromSegment(previousPosition, actor.position, metrics);
    if (!goalSide) {
      return false;
    }

    const anchorPosition = this.getSoccerBallAnchorPosition(actor);
    ball.position.x = anchorPosition.x;
    ball.position.y = anchorPosition.y;
    ball.position.z = anchorPosition.z;
    ball.lastTouchedByActorId = actor.id;
    ball.lastTouchedByActorName = actor.name;
    return this.registerSoccerGoal(goalSide, now);
  }

  tryMagnetizeSoccerBallToNearbyPlayer() {
    const ball = this.state.world?.soccer?.ball;
    if (!ball || ball.possessedByActorId) {
      return false;
    }

    const magnetDistance = this.getSoccerBallMagnetDistance();
    let candidate = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const player of this.state.players.values()) {
      if (!player || player.status === 'dead') {
        continue;
      }

      const distance = distanceBetween(player.position, ball.position);
      if (distance <= magnetDistance && distance < closestDistance) {
        candidate = player;
        closestDistance = distance;
      }
    }

    return candidate ? this.setSoccerBallPossession(candidate) : false;
  }

  bumpSoccerBallFromPlayer(player, previousPosition) {
    if (!player || player.status === 'dead') {
      return;
    }

    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;

    if (!soccer?.field || !ball || ball.inGoal || this.isSoccerRestartPaused()) {
      return;
    }

    const moveDeltaX = player.position.x - (Number(previousPosition?.x) || 0);
    const moveDeltaZ = player.position.z - (Number(previousPosition?.z) || 0);
    const moveDistance = Math.sqrt((moveDeltaX * moveDeltaX) + (moveDeltaZ * moveDeltaZ));
    if (moveDistance <= 0.001) {
      return;
    }

    const touchDistance = this.getSoccerBallMagnetDistance();
    const closestPoint = getClosestPointOnSegment(previousPosition, player.position, ball.position);
    const ballDeltaX = (Number(ball.position?.x) || 0) - closestPoint.x;
    const ballDeltaZ = (Number(ball.position?.z) || 0) - closestPoint.z;
    const distanceToBall = Math.sqrt((ballDeltaX * ballDeltaX) + (ballDeltaZ * ballDeltaZ));
    if (distanceToBall > touchDistance) {
      return;
    }

    this.setSoccerBallPossession(player);
  }

  isNearLake(position) {
    const lakeEdgeDistance = distanceBetween(position, this.state.world.lake.position);
    return lakeEdgeDistance < this.state.world.lake.radius + ACTION_RADIUS;
  }

  resetSoccerBall() {
    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;

    if (!soccer?.field || !ball) {
      return;
    }

    ball.position.x = Number(soccer.field.position?.x) || 0;
    ball.position.y = ball.radius || SOCCER_FIELD.ballRadius;
    ball.position.z = Number(soccer.field.position?.z) || 0;
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    ball.inGoal = null;
    this.clearSoccerBallPossession();
  }

  persistSoccerGoalRecord(actorId, fallbackActorName = '') {
    const normalizedActorId = sanitizeText(actorId, 128);
    if (!normalizedActorId) {
      return;
    }

    const actor = normalizedActorId === this.state.ai.id
      ? this.state.ai
      : this.state.players.get(normalizedActorId);

    incrementGameActorSoccerGoals({
      actorId: normalizedActorId,
      actorType: actor?.actorType || (normalizedActorId === this.state.ai.id ? 'ai' : 'player'),
      actorName: actor?.name || sanitizeText(fallbackActorName, 255) || 'Jogador',
      outfitColor: actor?.actorType === 'player' ? actor.appearance?.outfitColor || null : null,
    }).then(() => {
      this.state.soccerLeaderboardLastUpdatedAt = 0;
      return this.refreshSoccerLeaderboard();
    }).catch((error) => {
      this.logger.error('Soccer goal persist failed:', error.message);
    });
  }

  registerSoccerGoal(side, now) {
    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;
    if (!soccer || !ball) {
      return false;
    }

    soccer.lastGoalSequence = Math.max(0, Math.trunc(soccer.lastGoalSequence || 0)) + 1;
    soccer.lastGoalEvent = {
      sequence: soccer.lastGoalSequence,
      side,
      playerId: ball.lastTouchedByActorId || '',
      playerName: ball.lastTouchedByActorName || 'Alguem',
      createdAt: now,
    };

    this.logEvent('soccer_goal_scored', {
      userId: ball.lastTouchedByActorId || null,
      userName: ball.lastTouchedByActorName || 'Jogador',
      userAgent: 'backend-game',
      details: `side=${side}; x=${roundNumber(ball.position.x, 2)}; z=${roundNumber(ball.position.z, 2)}`,
    });

    soccer.restartAt = now + SOCCER_GOAL_CELEBRATION_MS;
    this.persistSoccerGoalRecord(ball.lastTouchedByActorId, ball.lastTouchedByActorName);
    this.resetSoccerBall();
    return true;
  }

  advanceSoccerBall(deltaSeconds, now) {
    const soccer = this.state.world?.soccer;
    const ball = soccer?.ball;

    if (!soccer?.field || !ball) {
      return;
    }

    if (this.isSoccerRestartPaused(now)) {
      this.resetSoccerBall();
      return;
    }

    if ((Number(soccer.restartAt) || 0) > 0) {
      soccer.restartAt = 0;
    }

    if (this.syncSoccerBallPossession()) {
      return;
    }

    const metrics = getSoccerFieldMetrics(this.state.world);
    const velocityX = Number(ball.velocity?.x) || 0;
    const velocityZ = Number(ball.velocity?.z) || 0;
    const speed = Math.sqrt((velocityX * velocityX) + (velocityZ * velocityZ));

    if (speed < SOCCER_BALL_MIN_SPEED) {
      ball.velocity.x = 0;
      ball.velocity.z = 0;
    } else {
      const nextSpeed = Math.max(0, speed - (SOCCER_BALL_DRAG_PER_SECOND * deltaSeconds));
      const speedScale = nextSpeed > 0 ? nextSpeed / speed : 0;
      ball.velocity.x = velocityX * speedScale;
      ball.velocity.z = velocityZ * speedScale;
    }

    ball.position.x += (Number(ball.velocity.x) || 0) * deltaSeconds;
    ball.position.z += (Number(ball.velocity.z) || 0) * deltaSeconds;
    ball.position.y = ball.radius || metrics.radius;

    const isInsideGoalMouth = ball.position.x >= metrics.goalXMin && ball.position.x <= metrics.goalXMax;

    if (ball.inGoal === 'north') {
      if (ball.position.x < metrics.goalXMin) {
        ball.position.x = metrics.goalXMin;
        ball.velocity.x = Math.abs(ball.velocity.x || 0);
      } else if (ball.position.x > metrics.goalXMax) {
        ball.position.x = metrics.goalXMax;
        ball.velocity.x = -Math.abs(ball.velocity.x || 0);
      }

      if (ball.position.z < metrics.northGoalMinZ) {
        ball.position.z = metrics.northGoalMinZ;
        ball.velocity.z = Math.abs(ball.velocity.z || 0);
      } else if (ball.position.z > metrics.northGoalMaxZ) {
        ball.position.z = metrics.northGoalMaxZ;
        ball.velocity.z = -Math.abs(ball.velocity.z || 0);
      }
      return;
    }

    if (ball.inGoal === 'south') {
      if (ball.position.x < metrics.goalXMin) {
        ball.position.x = metrics.goalXMin;
        ball.velocity.x = Math.abs(ball.velocity.x || 0);
      } else if (ball.position.x > metrics.goalXMax) {
        ball.position.x = metrics.goalXMax;
        ball.velocity.x = -Math.abs(ball.velocity.x || 0);
      }

      if (ball.position.z < metrics.southGoalMinZ) {
        ball.position.z = metrics.southGoalMinZ;
        ball.velocity.z = Math.abs(ball.velocity.z || 0);
      } else if (ball.position.z > metrics.southGoalMaxZ) {
        ball.position.z = metrics.southGoalMaxZ;
        ball.velocity.z = -Math.abs(ball.velocity.z || 0);
      }
      return;
    }

    if (ball.position.x < metrics.xMin) {
      ball.position.x = metrics.xMin;
      ball.velocity.x = Math.abs(ball.velocity.x || 0);
    } else if (ball.position.x > metrics.xMax) {
      ball.position.x = metrics.xMax;
      ball.velocity.x = -Math.abs(ball.velocity.x || 0);
    }

    if (ball.position.z < metrics.zMin) {
      if (isInsideGoalMouth) {
        if (this.registerSoccerGoal('north', now)) {
          return;
        }
      } else {
        ball.position.z = metrics.zMin;
        ball.velocity.z = Math.abs(ball.velocity.z || 0);
      }
    } else if (ball.position.z > metrics.zMax) {
      if (isInsideGoalMouth) {
        if (this.registerSoccerGoal('south', now)) {
          return;
        }
      } else {
        ball.position.z = metrics.zMax;
        ball.velocity.z = -Math.abs(ball.velocity.z || 0);
      }
    }

    this.tryMagnetizeSoccerBallToNearbyPlayer();
  }

  advanceArrowProjectiles(deltaSeconds, now) {
    if (!Array.isArray(this.state.world?.arrows) || this.state.world.arrows.length === 0) {
      return;
    }

    const nextArrows = [];

    this.state.world.arrows.forEach((arrow) => {
      if (!arrow || now >= (Number(arrow.expiresAt) || 0)) {
        return;
      }

      const previousPosition = clonePoint(arrow.position);
      const velocityX = Number(arrow.velocity?.x) || 0;
      const velocityY = Number(arrow.velocity?.y) || 0;
      const velocityZ = Number(arrow.velocity?.z) || 0;
      const nextPosition = {
        x: (Number(arrow.position?.x) || 0) + (velocityX * deltaSeconds),
        y: (Number(arrow.position?.y) || 0) + (velocityY * deltaSeconds),
        z: (Number(arrow.position?.z) || 0) + (velocityZ * deltaSeconds),
      };

      if (!isRouteSegmentClear(this.state.world, arrow.position, nextPosition, ARROW_PROJECTILE_RADIUS)) {
        return;
      }

      const hitTarget = this.getArrowHitTarget(arrow.ownerActorId, previousPosition, nextPosition);
      if (hitTarget) {
        this.applyArrowHit(hitTarget, arrow, now);
        return;
      }

      arrow.position.x = nextPosition.x;
      arrow.position.y = nextPosition.y;
      arrow.position.z = nextPosition.z;
      arrow.rotationY = Math.atan2(velocityX, velocityZ);
      nextArrows.push(arrow);
    });

    this.state.world.arrows = nextArrows;
  }

  advanceTreeRegrowth(now) {
    this.state.world.trees.forEach((tree) => {
      const maxApples = Number.isFinite(tree.maxApples) ? tree.maxApples : 0;
      if (maxApples <= 0) {
        return;
      }

      if (tree.applesRemaining >= maxApples) {
        tree.applesRemaining = maxApples;
        tree.nextAppleRegrowAt = null;
        return;
      }

      if (!Number.isFinite(tree.nextAppleRegrowAt) || tree.nextAppleRegrowAt <= 0) {
        tree.nextAppleRegrowAt = now + APPLE_REGROW_INTERVAL_MS;
        return;
      }

      if (now < tree.nextAppleRegrowAt) {
        return;
      }

      tree.applesRemaining = Math.min(maxApples, tree.applesRemaining + 1);
      tree.nextAppleRegrowAt = tree.applesRemaining < maxApples
        ? now + APPLE_REGROW_INTERVAL_MS
        : null;
    });
  }

  getNearbyFruitTree(position) {
    let closestTree = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    this.state.world.trees.forEach((tree) => {
      if (tree.applesRemaining <= 0) {
        return;
      }

      const distance = distanceBetween(position, tree.position);
      if (distance < ACTION_RADIUS && distance < closestDistance) {
        closestTree = tree;
        closestDistance = distance;
      }
    });

    return closestTree;
  }

  clearMovement() {
    this.state.ai.movementTargetId = null;
    this.state.ai.movementRoute = [];
    this.state.ai.movementRouteIndex = 0;
    this.state.ai.movementStuckTicks = 0;
    this.state.ai.movementReplanCount = 0;
  }

  maybeRefreshLeaderboards(now = Date.now()) {
    if ((now - this.state.leaderboardLastUpdatedAt) >= LEADERBOARD_REFRESH_MS) {
      this.refreshLeaderboard().catch((error) => {
        this.logger.error('Leaderboard refresh failed:', error.message);
      });
    }

    if ((now - this.state.soccerLeaderboardLastUpdatedAt) >= LEADERBOARD_REFRESH_MS) {
      this.refreshSoccerLeaderboard().catch((error) => {
        this.logger.error('Soccer leaderboard refresh failed:', error.message);
      });
    }
  }

  async refreshLeaderboard() {
    if (this.state.leaderboardRefreshInFlight) {
      return;
    }

    this.state.leaderboardRefreshInFlight = true;

    try {
      this.state.leaderboard = await getTopGameScores(LEADERBOARD_LIMIT);
      this.state.leaderboardLastUpdatedAt = Date.now();
    } finally {
      this.state.leaderboardRefreshInFlight = false;
    }
  }

  async refreshSoccerLeaderboard() {
    if (this.state.soccerLeaderboardRefreshInFlight) {
      return;
    }

    this.state.soccerLeaderboardRefreshInFlight = true;

    try {
      this.state.soccerLeaderboard = await getTopSoccerScorers(LEADERBOARD_LIMIT);
      this.state.soccerLeaderboardLastUpdatedAt = Date.now();
    } finally {
      this.state.soccerLeaderboardRefreshInFlight = false;
    }
  }

  async loadRecentChatMessages() {
    const recentMessages = await getRecentVisibleChatMessages(PLAYER_CHAT_HISTORY_LIMIT);
    this.state.playerChat = recentMessages.map((entry) => ({
      id: entry.id,
      playerId: entry.userId,
      playerName: entry.playerName || 'Jogador',
      message: entry.message,
      createdAt: new Date(entry.createdAt).getTime(),
    }));
  }

  persistActorStats(actor) {
    if (!actor?.id) {
      return;
    }

    if (actor.actorType === 'player') {
      upsertPlayerProfile({
        userId: actor.id,
        nickname: actor.name || buildDefaultPlayerNickname(actor.id),
        outfitColor: actor.appearance?.outfitColor || DEFAULT_PLAYER_OUTFIT_COLOR,
      }).catch((error) => {
        this.logger.error('Player profile persist failed:', error.message);
      });
    }

    upsertGameScore({
      actorId: actor.id,
      actorType: actor.actorType,
      actorName: actor.name,
      outfitColor: actor.actorType === 'player' ? actor.appearance?.outfitColor || null : null,
      score: actor.score,
      bestScore: actor.bestScore,
      deaths: actor.deaths,
      respawns: actor.respawns,
      lastDeathReason: actor.lastDeathReason,
    }).catch((error) => {
      this.logger.error('Game score persist failed:', error.message);
    });

    this.state.leaderboardLastUpdatedAt = 0;
  }

  rememberAiAction(action, targetId = null) {
    this.state.ai.recentActions.push(createActionMemoryEntry(action, targetId));
    if (this.state.ai.recentActions.length > AI_ACTION_MEMORY_SIZE) {
      this.state.ai.recentActions.shift();
    }
  }

  logEvent(event, {
    userId = null,
    userName = null,
    userAgent = 'backend-ai',
    details = null,
  } = {}) {
    insertLog({
      event,
      userAgent,
      userId: userId || this.state.ai?.id || 'npc-gardener-01',
      userName: userName || this.state.ai?.name || config.AI_AGENT_NAME,
      details,
      category: 'game',
    }).catch((error) => {
      this.logger.error('AI event log failed:', error.message);
    });
  }
}

module.exports = {
  AiGameEngine,
};
