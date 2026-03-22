const LAKE = Object.freeze({
  id: 'lake',
  type: 'lake',
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  radius: 6,
});

const HOUSE = Object.freeze({
  id: 'house',
  type: 'house',
  position: Object.freeze({ x: 0, y: 0, z: 23 }),
  width: 24,
  depth: 18,
  wallHeight: 8.2,
  wallThickness: 0.55,
  doorWidth: 3.4,
  doorHeight: 4.8,
});

const SOCCER_FIELD = Object.freeze({
  id: 'soccer-field',
  type: 'soccer_field',
  position: Object.freeze({ x: 0, y: 0, z: -31 }),
  width: 18,
  depth: 28,
  goalWidth: 6.8,
  goalDepth: 2.8,
  goalHeight: 2.5,
  postThickness: 0.18,
  lineWidth: 0.18,
  ballRadius: 0.42,
  grandstandSide: 'east',
  grandstandSidelineGap: 3.8,
  grandstandLengthPadding: 4.8,
  grandstandTiers: 4,
  grandstandTierHeight: 0.58,
  grandstandTierDepth: 1.25,
});

const TREE_POSITIONS = Object.freeze([
  Object.freeze({ x: -33, y: 0, z: -8 }),
  Object.freeze({ x: -29, y: 0, z: 10 }),
  Object.freeze({ x: 29, y: 0, z: 8 }),
  Object.freeze({ x: 34, y: 0, z: -6 }),
  Object.freeze({ x: -34, y: 0, z: 24 }),
  Object.freeze({ x: 30, y: 0, z: 31 }),
  Object.freeze({ x: -22, y: 0, z: 36 }),
  Object.freeze({ x: 22, y: 0, z: 38 }),
]);

const APPLE_OFFSETS = Object.freeze([
  Object.freeze({ x: 1.55, y: 3.85, z: 0.75 }),
  Object.freeze({ x: -1.35, y: 4.15, z: 0.95 }),
  Object.freeze({ x: 0.95, y: 4.55, z: -1.3 }),
  Object.freeze({ x: -0.35, y: 4.85, z: -0.95 }),
  Object.freeze({ x: 0.25, y: 3.75, z: 1.45 }),
  Object.freeze({ x: -1.55, y: 4.45, z: -0.15 }),
]);

const BOW_SPAWNS = Object.freeze([
  Object.freeze({
    id: 'castle-bow-west',
    position: Object.freeze({ x: -7.2, y: 0.43, z: 19.3 }),
    arrowsRemaining: 2,
  }),
  Object.freeze({
    id: 'castle-bow-east',
    position: Object.freeze({ x: 7.2, y: 0.43, z: 19.3 }),
    arrowsRemaining: 2,
  }),
]);

const SWORD_SPAWNS = Object.freeze([
  Object.freeze({
    id: 'castle-sword-west',
    position: Object.freeze({ x: -3.4, y: 0.43, z: 27.4 }),
  }),
  Object.freeze({
    id: 'castle-sword-east',
    position: Object.freeze({ x: 3.4, y: 0.43, z: 27.4 }),
  }),
]);

const WORLD_BOUNDS = 45;
const PLAYER_COLLISION_RADIUS = 0.45;

function clonePoint(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
    z: Number(point?.z) || 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRect(minX, maxX, minZ, maxZ) {
  return Object.freeze({
    minX,
    maxX,
    minZ,
    maxZ,
  });
}

function cloneRect(rect) {
  return {
    minX: Number(rect?.minX) || 0,
    maxX: Number(rect?.maxX) || 0,
    minZ: Number(rect?.minZ) || 0,
    maxZ: Number(rect?.maxZ) || 0,
  };
}

function buildHouseInteriorMetrics(layout = HOUSE) {
  const halfWidth = layout.width / 2;
  const halfDepth = layout.depth / 2;
  const wallThickness = layout.wallThickness;
  const hallHalfWidth = Math.min(layout.width * 0.16, 4.1);
  const dividerHalfThickness = wallThickness / 2;
  const dividerLeftX = layout.position.x - hallHalfWidth - dividerHalfThickness;
  const dividerRightX = layout.position.x + hallHalfWidth + dividerHalfThickness;
  const southEdge = layout.position.z - halfDepth;
  const northEdge = layout.position.z + halfDepth;
  const westEdge = layout.position.x - halfWidth;
  const eastEdge = layout.position.x + halfWidth;
  const leftWingDoorCenterX = (westEdge + dividerLeftX) / 2;
  const rightWingDoorCenterX = (eastEdge + dividerRightX) / 2;

  return {
    southEdge,
    northEdge,
    westEdge,
    eastEdge,
    dividerLeftX,
    dividerRightX,
    dividerDoorWidth: 2.2,
    dividerDoorCenters: [
      southEdge + 2.8,
      layout.position.z + 0.15,
      northEdge - 3.6,
    ],
    wingPartitionZs: [
      layout.position.z - 1.9,
      layout.position.z + 3.2,
    ],
    wingDoorWidth: 1.9,
    leftWingDoorCenterX,
    rightWingDoorCenterX,
    throneWallZ: northEdge - 2.7,
    throneDoorWidth: 4.8,
  };
}

function buildHouseTowerElevators(layout = HOUSE) {
  const halfWidth = layout.width / 2;
  const halfDepth = layout.depth / 2;
  const southEdge = layout.position.z - halfDepth;
  const towerInsetX = 3.0;
  const towerInsetZ = 3.05;
  const towerRadius = 2.7;
  const topPlatformY = layout.wallHeight + 3.6;
  const topPlatformHalfSize = 1.28;
  const doorwayOffset = towerRadius - 0.18;
  const callButtonOffset = towerRadius + 0.72;

  return [
    {
      id: 'tower-west',
      x: layout.position.x - halfWidth + towerInsetX,
      z: southEdge + towerInsetZ,
      towerRadius,
      bottomY: 0,
      topY: topPlatformY,
      innerSideX: 1,
      innerDoor: {
        x: (layout.position.x - halfWidth + towerInsetX) + doorwayOffset,
        y: 1.8,
        z: southEdge + towerInsetZ,
        width: 1.5,
        height: 3.6,
        depth: 0.22,
        rotationY: Math.PI / 2,
      },
      callButton: {
        x: (layout.position.x - halfWidth + towerInsetX) + callButtonOffset,
        y: 0.78,
        z: southEdge + towerInsetZ + 0.16,
      },
      topSurface: createRect(
        (layout.position.x - halfWidth + towerInsetX) - topPlatformHalfSize,
        (layout.position.x - halfWidth + towerInsetX) + topPlatformHalfSize,
        (southEdge + towerInsetZ) - topPlatformHalfSize,
        (southEdge + towerInsetZ) + topPlatformHalfSize
      ),
    },
    {
      id: 'tower-east',
      x: layout.position.x + halfWidth - towerInsetX,
      z: southEdge + towerInsetZ,
      towerRadius,
      bottomY: 0,
      topY: topPlatformY,
      innerSideX: -1,
      innerDoor: {
        x: (layout.position.x + halfWidth - towerInsetX) - doorwayOffset,
        y: 1.8,
        z: southEdge + towerInsetZ,
        width: 1.5,
        height: 3.6,
        depth: 0.22,
        rotationY: Math.PI / 2,
      },
      callButton: {
        x: (layout.position.x + halfWidth - towerInsetX) - callButtonOffset,
        y: 0.78,
        z: southEdge + towerInsetZ + 0.16,
      },
      topSurface: createRect(
        (layout.position.x + halfWidth - towerInsetX) - topPlatformHalfSize,
        (layout.position.x + halfWidth - towerInsetX) + topPlatformHalfSize,
        (southEdge + towerInsetZ) - topPlatformHalfSize,
        (southEdge + towerInsetZ) + topPlatformHalfSize
      ),
    },
  ];
}

function buildHouseFloorStepSurfaces(layout = HOUSE) {
  const metrics = buildHouseInteriorMetrics(layout);

  return [
    {
      ...createRect(
        metrics.westEdge + 0.4,
        metrics.eastEdge - 0.4,
        metrics.southEdge + 0.4,
        metrics.northEdge - 0.4
      ),
      height: 0.15,
    },
  ];
}

function buildHouseRoyalStepSurfaces(layout = HOUSE) {
  const metrics = buildHouseInteriorMetrics(layout);
  const throneZ = metrics.northEdge - 4.2;
  const leftTableX = layout.position.x - 5.8;
  const rightTableX = layout.position.x + 5.8;

  return [
    {
      ...createRect(layout.position.x - 6.8, layout.position.x + 6.8, throneZ - 3.25, throneZ - 1.75),
      height: 0.34,
    },
    {
      ...createRect(layout.position.x - 5.1, layout.position.x + 5.1, throneZ - 1.95, throneZ + 1.7),
      height: 0.72,
    },
    {
      ...createRect(layout.position.x - 1.38, layout.position.x + 1.38, throneZ + 0.3, throneZ + 1.58),
      height: 1.22,
    },
    {
      ...createRect(layout.position.x - 6.9, layout.position.x - 5.15, throneZ - 0.1, throneZ + 1.28),
      height: 0.82,
    },
    {
      ...createRect(layout.position.x + 5.15, layout.position.x + 6.9, throneZ - 0.1, throneZ + 1.28),
      height: 0.82,
    },
    {
      ...createRect(leftTableX - 1.05, leftTableX + 1.05, layout.position.z - 3.6, layout.position.z + 3.6),
      height: 1.05,
    },
    {
      ...createRect(rightTableX - 1.05, rightTableX + 1.05, layout.position.z - 3.6, layout.position.z + 3.6),
      height: 1.05,
    },
    {
      ...createRect(layout.position.x - 8.7, layout.position.x - 7.35, throneZ - 0.35, throneZ + 0.95),
      height: 0.56,
    },
    {
      ...createRect(layout.position.x + 7.35, layout.position.x + 8.7, throneZ - 0.35, throneZ + 0.95),
      height: 0.56,
    },
    {
      ...createRect(layout.position.x - 1.25, layout.position.x + 1.25, layout.position.z - 3.45, layout.position.z - 1.95),
      height: 0.92,
    },
  ];
}

function buildHouseStepSurfaces(layout = HOUSE) {
  return [
    ...buildHouseFloorStepSurfaces(layout),
    ...buildHouseRoyalStepSurfaces(layout),
  ];
}

function buildWallSpans(rangeStart, rangeEnd, gaps = []) {
  const spans = [];
  const normalizedGaps = gaps
    .map((gap) => ({
      start: Math.max(rangeStart, Number(gap?.center) - ((Number(gap?.width) || 0) / 2)),
      end: Math.min(rangeEnd, Number(gap?.center) + ((Number(gap?.width) || 0) / 2)),
    }))
    .filter((gap) => gap.end > gap.start)
    .sort((left, right) => left.start - right.start);

  let cursor = rangeStart;
  normalizedGaps.forEach((gap) => {
    if (gap.start > cursor) {
      spans.push([cursor, gap.start]);
    }
    cursor = Math.max(cursor, gap.end);
  });

  if (rangeEnd > cursor) {
    spans.push([cursor, rangeEnd]);
  }

  return spans;
}

function addRectIfValid(rects, minX, maxX, minZ, maxZ) {
  if ((maxX - minX) < 0.01 || (maxZ - minZ) < 0.01) {
    return;
  }

  rects.push(createRect(minX, maxX, minZ, maxZ));
}

function cloneGrave(grave) {
  return {
    id: typeof grave?.id === 'string' ? grave.id : '',
    actorId: typeof grave?.actorId === 'string' ? grave.actorId : '',
    actorType: grave?.actorType === 'ai' ? 'ai' : 'player',
    actorName: typeof grave?.actorName === 'string' ? grave.actorName : '',
    position: clonePoint(grave?.position),
  };
}

function cloneDroppedApple(apple) {
  return {
    id: typeof apple?.id === 'string' ? apple.id : '',
    position: clonePoint(apple?.position),
  };
}

function cloneBowPickup(bow) {
  return {
    id: typeof bow?.id === 'string' ? bow.id : '',
    position: clonePoint(bow?.position),
    arrowsRemaining: Math.max(0, Math.trunc(Number(bow?.arrowsRemaining) || 0)),
  };
}

function cloneSwordPickup(sword) {
  return {
    id: typeof sword?.id === 'string' ? sword.id : '',
    position: clonePoint(sword?.position),
  };
}

function cloneArrowProjectile(arrow) {
  return {
    id: typeof arrow?.id === 'string' ? arrow.id : '',
    position: clonePoint(arrow?.position),
    rotationY: Number(arrow?.rotationY) || 0,
  };
}

function cloneSoccerGoalEvent(goalEvent) {
  if (!goalEvent || typeof goalEvent !== 'object') {
    return null;
  }

  return {
    sequence: Number(goalEvent.sequence) || 0,
    side: goalEvent.side === 'north' ? 'north' : 'south',
    playerId: typeof goalEvent.playerId === 'string' ? goalEvent.playerId : '',
    playerName: typeof goalEvent.playerName === 'string' ? goalEvent.playerName : '',
    createdAt: Number(goalEvent.createdAt) || 0,
  };
}

function cloneSoccerState(soccer) {
  return {
    field: {
      id: SOCCER_FIELD.id,
      type: SOCCER_FIELD.type,
      position: clonePoint(soccer?.field?.position || SOCCER_FIELD.position),
      width: SOCCER_FIELD.width,
      depth: SOCCER_FIELD.depth,
      goalWidth: SOCCER_FIELD.goalWidth,
      goalDepth: SOCCER_FIELD.goalDepth,
      goalHeight: SOCCER_FIELD.goalHeight,
      postThickness: SOCCER_FIELD.postThickness,
      lineWidth: SOCCER_FIELD.lineWidth,
      ballRadius: SOCCER_FIELD.ballRadius,
      grandstandSide: soccer?.field?.grandstandSide === 'west' ? 'west' : SOCCER_FIELD.grandstandSide,
      grandstandSidelineGap: Number(soccer?.field?.grandstandSidelineGap) || SOCCER_FIELD.grandstandSidelineGap,
      grandstandLengthPadding: Number(soccer?.field?.grandstandLengthPadding) || SOCCER_FIELD.grandstandLengthPadding,
      grandstandTiers: Math.max(1, Math.trunc(Number(soccer?.field?.grandstandTiers) || SOCCER_FIELD.grandstandTiers)),
      grandstandTierHeight: Number(soccer?.field?.grandstandTierHeight) || SOCCER_FIELD.grandstandTierHeight,
      grandstandTierDepth: Number(soccer?.field?.grandstandTierDepth) || SOCCER_FIELD.grandstandTierDepth,
    },
    ball: {
      position: clonePoint(soccer?.ball?.position),
      velocity: clonePoint(soccer?.ball?.velocity),
      radius: Number(soccer?.ball?.radius) || SOCCER_FIELD.ballRadius,
      inGoal: soccer?.ball?.inGoal === 'north' || soccer?.ball?.inGoal === 'south'
        ? soccer.ball.inGoal
        : null,
      lastTouchedByActorId: typeof soccer?.ball?.lastTouchedByActorId === 'string'
        ? soccer.ball.lastTouchedByActorId
        : '',
      lastTouchedByActorName: typeof soccer?.ball?.lastTouchedByActorName === 'string'
        ? soccer.ball.lastTouchedByActorName
        : '',
      possessedByActorId: typeof soccer?.ball?.possessedByActorId === 'string'
        ? soccer.ball.possessedByActorId
        : '',
      possessedByActorName: typeof soccer?.ball?.possessedByActorName === 'string'
        ? soccer.ball.possessedByActorName
        : '',
    },
    restartAt: Number(soccer?.restartAt) || 0,
    lastGoalEvent: cloneSoccerGoalEvent(soccer?.lastGoalEvent),
  };
}

function createHouseWallCollisionBoxes(layout) {
  const halfDoorWidth = layout.doorWidth / 2;
  const wallThickness = layout.wallThickness;
  const metrics = buildHouseInteriorMetrics(layout);
  const rects = [];

  addRectIfValid(rects, metrics.westEdge, metrics.eastEdge, metrics.northEdge - wallThickness, metrics.northEdge);
  addRectIfValid(rects, metrics.westEdge, metrics.westEdge + wallThickness, metrics.southEdge, metrics.northEdge);
  addRectIfValid(rects, metrics.eastEdge - wallThickness, metrics.eastEdge, metrics.southEdge, metrics.northEdge);
  addRectIfValid(rects, metrics.westEdge, layout.position.x - halfDoorWidth, metrics.southEdge, metrics.southEdge + wallThickness);
  addRectIfValid(rects, layout.position.x + halfDoorWidth, metrics.eastEdge, metrics.southEdge, metrics.southEdge + wallThickness);

  return rects;
}

const HOUSE_WALL_COLLISION_BOXES = Object.freeze(createHouseWallCollisionBoxes(HOUSE));
const HOUSE_TOWER_ELEVATORS = Object.freeze(buildHouseTowerElevators(HOUSE));
const HOUSE_STEP_SURFACES = Object.freeze(buildHouseStepSurfaces(HOUSE).map((surface) => Object.freeze({
  ...cloneRect(surface),
  height: Number(surface?.height) || 0,
})));

function getSoccerGrandstandLayout(fieldState = SOCCER_FIELD) {
  const centerX = Number(fieldState?.position?.x) || 0;
  const centerZ = Number(fieldState?.position?.z) || 0;
  const fieldWidth = Number(fieldState?.width) || SOCCER_FIELD.width;
  const fieldDepth = Number(fieldState?.depth) || SOCCER_FIELD.depth;
  const side = fieldState?.grandstandSide === 'west' ? 'west' : SOCCER_FIELD.grandstandSide;
  const sideMultiplier = side === 'west' ? -1 : 1;
  const sidelineGap = Number(fieldState?.grandstandSidelineGap) || SOCCER_FIELD.grandstandSidelineGap;
  const lengthPadding = Number(fieldState?.grandstandLengthPadding) || SOCCER_FIELD.grandstandLengthPadding;
  const tiers = Math.max(1, Math.trunc(Number(fieldState?.grandstandTiers) || SOCCER_FIELD.grandstandTiers));
  const tierHeight = Number(fieldState?.grandstandTierHeight) || SOCCER_FIELD.grandstandTierHeight;
  const tierDepth = Number(fieldState?.grandstandTierDepth) || SOCCER_FIELD.grandstandTierDepth;
  const depth = (tiers * tierDepth) + 0.6;
  const length = fieldDepth + lengthPadding;
  const frontX = centerX + sideMultiplier * ((fieldWidth / 2) + sidelineGap);
  const backX = frontX + sideMultiplier * depth;

  return {
    centerX: frontX + (sideMultiplier * (depth / 2)),
    centerZ,
    depth,
    length,
    frontX,
    backX,
    minX: Math.min(frontX, backX),
    maxX: Math.max(frontX, backX),
    minZ: centerZ - (length / 2),
    maxZ: centerZ + (length / 2),
    side,
    sideMultiplier,
    sidelineGap,
    tiers,
    tierHeight,
    tierDepth,
  };
}

function createSoccerGrandstandCollisionBoxes(fieldState = SOCCER_FIELD) {
  const layout = getSoccerGrandstandLayout(fieldState);
  const backWallThickness = 0.3;
  const endWallThickness = 0.22;

  return [
    createRect(
      Math.min(layout.backX, layout.backX + (layout.sideMultiplier * backWallThickness)),
      Math.max(layout.backX, layout.backX + (layout.sideMultiplier * backWallThickness)),
      layout.minZ - 0.08,
      layout.maxZ + 0.08
    ),
    createRect(
      layout.minX - 0.08,
      layout.maxX + 0.08,
      layout.minZ - endWallThickness,
      layout.minZ
    ),
    createRect(
      layout.minX - 0.08,
      layout.maxX + 0.08,
      layout.maxZ,
      layout.maxZ + endWallThickness
    ),
  ];
}

function getSoccerGrandstandSurfaceHeight(fieldState = SOCCER_FIELD, position) {
  const layout = getSoccerGrandstandLayout(fieldState);

  for (let tierIndex = layout.tiers - 1; tierIndex >= 0; tierIndex -= 1) {
    const tierStartX = layout.frontX + (layout.sideMultiplier * (tierIndex * layout.tierDepth));
    const tierEndX = layout.frontX + (layout.sideMultiplier * ((tierIndex + 1) * layout.tierDepth));
    const tierRect = createRect(
      Math.min(tierStartX, tierEndX),
      Math.max(tierStartX, tierEndX),
      layout.minZ + 0.18,
      layout.maxZ - 0.18
    );

    if (isPositionInsideRect(position, tierRect, 0)) {
      return (tierIndex + 1) * layout.tierHeight;
    }
  }

  return 0;
}

function getHouseStructureSurfaceHeight(houseState = HOUSE, position) {
  const surfaces = houseState === HOUSE
    ? HOUSE_STEP_SURFACES
    : buildHouseStepSurfaces(houseState);

  let resolvedHeight = 0;
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index];
    if (isPositionInsideRect(position, surface, 0)) {
      resolvedHeight = Math.max(resolvedHeight, Number(surface?.height) || 0);
    }
  }

  return resolvedHeight;
}

function getWorldCollisionBoxes(worldState) {
  const houseCollisionBoxes = worldState?.house?.walls || HOUSE_WALL_COLLISION_BOXES;
  const grandstandCollisionBoxes = createSoccerGrandstandCollisionBoxes(worldState?.soccer?.field || SOCCER_FIELD);
  return [...houseCollisionBoxes, ...grandstandCollisionBoxes];
}

function getWorldSurfaceHeight(worldState, position) {
  let resolvedHeight = Math.max(
    0,
    getHouseStructureSurfaceHeight(worldState?.house || HOUSE, position),
    getSoccerGrandstandSurfaceHeight(worldState?.soccer?.field || SOCCER_FIELD, position)
  );

  const elevatorsState = Array.isArray(worldState?.elevators) ? worldState.elevators : [];
  if (elevatorsState.length > 0) {
    const layout = getHouseTowerElevators(worldState?.house || HOUSE);
    for (let index = 0; index < layout.length; index += 1) {
      const eLayout = layout[index];
      const eState = elevatorsState.find((e) => e.id === eLayout.id);
      if (eState && isPositionInsideRect(position, eLayout.topSurface, 0)) {
        resolvedHeight = Math.max(resolvedHeight, Number(eState.y) || 0);
      }
    }
  }

  return resolvedHeight;
}

function getHouseTowerElevators(houseState = HOUSE) {
  return houseState === HOUSE
    ? HOUSE_TOWER_ELEVATORS.map((elevator) => ({
      ...elevator,
      innerDoor: {
        ...elevator.innerDoor,
      },
      callButton: clonePoint(elevator.callButton),
      topSurface: cloneRect(elevator.topSurface),
    }))
    : buildHouseTowerElevators(houseState).map((elevator) => ({
      ...elevator,
      innerDoor: {
        ...elevator.innerDoor,
      },
      callButton: clonePoint(elevator.callButton),
      topSurface: cloneRect(elevator.topSurface),
    }));
}

function isPositionInsideRect(position, rect, padding = 0) {
  return (
    position.x >= rect.minX - padding &&
    position.x <= rect.maxX + padding &&
    position.z >= rect.minZ - padding &&
    position.z <= rect.maxZ + padding
  );
}

function isPositionBlocked(worldState, position, padding = 0) {
  const collisionBoxes = getWorldCollisionBoxes(worldState);
  return collisionBoxes.some((rect) => isPositionInsideRect(position, rect, padding));
}

function resolveWalkablePosition(worldState, currentPosition, nextPosition, padding = 0) {
  const bounds = Number.isFinite(worldState?.bounds) ? worldState.bounds : WORLD_BOUNDS;
  const current = clonePoint(currentPosition);
  const candidate = {
    x: clamp(Number(nextPosition?.x) || 0, -bounds, bounds),
    y: Number(nextPosition?.y) || current.y,
    z: clamp(Number(nextPosition?.z) || 0, -bounds, bounds),
  };
  const resolved = {
    x: current.x,
    y: candidate.y,
    z: current.z,
  };

  if (!isPositionBlocked(worldState, { x: candidate.x, y: candidate.y, z: current.z }, padding)) {
    resolved.x = candidate.x;
  }

  if (!isPositionBlocked(worldState, { x: resolved.x, y: candidate.y, z: candidate.z }, padding)) {
    resolved.z = candidate.z;
  }

  resolved.y = getWorldSurfaceHeight(worldState, resolved);
  return resolved;
}

function createWorldState() {
  return {
    bounds: WORLD_BOUNDS,
    lake: {
      ...LAKE,
      position: clonePoint(LAKE.position),
    },
    house: {
      ...HOUSE,
      position: clonePoint(HOUSE.position),
      walls: HOUSE_WALL_COLLISION_BOXES.map(cloneRect),
    },
    trees: TREE_POSITIONS.map((position, index) => ({
      id: `tree-${index}`,
      type: 'tree',
      position: clonePoint(position),
      applesRemaining: APPLE_OFFSETS.length,
      maxApples: APPLE_OFFSETS.length,
      nextAppleRegrowAt: null,
    })),
    droppedApples: [],
    bows: BOW_SPAWNS.map((bow) => ({
      id: bow.id,
      position: clonePoint(bow.position),
      arrowsRemaining: bow.arrowsRemaining,
    })),
    swords: SWORD_SPAWNS.map((sword) => ({
      id: sword.id,
      position: clonePoint(sword.position),
    })),
    arrows: [],
    soccer: cloneSoccerState({
      field: SOCCER_FIELD,
      ball: {
        position: {
          x: SOCCER_FIELD.position.x,
          y: SOCCER_FIELD.ballRadius,
          z: SOCCER_FIELD.position.z,
        },
        velocity: { x: 0, y: 0, z: 0 },
        radius: SOCCER_FIELD.ballRadius,
        inGoal: null,
        lastTouchedByActorId: '',
        lastTouchedByActorName: '',
        possessedByActorId: '',
        possessedByActorName: '',
      },
      restartAt: 0,
      lastGoalEvent: null,
    }),
    elevators: getHouseTowerElevators(HOUSE).map((e) => ({
      id: e.id,
      y: e.topY,
      state: 'idle_top',
      timer: 0,
    })),
    graves: [],
  };
}

function getTargetById(worldState, targetId) {
  if (targetId === LAKE.id) {
    return {
      id: LAKE.id,
      type: LAKE.type,
      position: clonePoint(LAKE.position),
      radius: LAKE.radius,
    };
  }

  const tree = worldState.trees.find((candidate) => candidate.id === targetId);
  if (!tree) {
    return null;
  }

  return {
    id: tree.id,
    type: tree.type,
    position: clonePoint(tree.position),
    applesRemaining: tree.applesRemaining,
  };
}

function getPublicWorldState(worldState) {
  return {
    bounds: worldState.bounds,
    lake: {
      id: worldState.lake.id,
      type: worldState.lake.type,
      position: clonePoint(worldState.lake.position),
      radius: worldState.lake.radius,
    },
    house: {
      id: worldState.house.id,
      type: worldState.house.type,
      position: clonePoint(worldState.house.position),
      width: worldState.house.width,
      depth: worldState.house.depth,
      wallHeight: worldState.house.wallHeight,
      wallThickness: worldState.house.wallThickness,
      doorWidth: worldState.house.doorWidth,
      doorHeight: worldState.house.doorHeight,
      collisionBoxes: worldState.house.walls.map(cloneRect),
    },
    trees: worldState.trees.map((tree) => ({
      id: tree.id,
      type: tree.type,
      position: clonePoint(tree.position),
      applesRemaining: tree.applesRemaining,
    })),
    droppedApples: Array.isArray(worldState.droppedApples)
      ? worldState.droppedApples.map(cloneDroppedApple)
      : [],
    bows: Array.isArray(worldState.bows)
      ? worldState.bows.map(cloneBowPickup)
      : [],
    swords: Array.isArray(worldState.swords)
      ? worldState.swords.map(cloneSwordPickup)
      : [],
    arrows: Array.isArray(worldState.arrows)
      ? worldState.arrows.map(cloneArrowProjectile)
      : [],
    soccer: cloneSoccerState(worldState.soccer),
    elevators: Array.isArray(worldState.elevators) 
      ? worldState.elevators.map(e => ({ id: e.id, y: e.y, state: e.state })) 
      : [],
    graves: Array.isArray(worldState.graves)
      ? worldState.graves.map(cloneGrave)
      : [],
    appleLayout: APPLE_OFFSETS.map(clonePoint),
  };
}

module.exports = {
  APPLE_OFFSETS,
  HOUSE,
  LAKE,
  PLAYER_COLLISION_RADIUS,
  SOCCER_FIELD,
  WORLD_BOUNDS,
  TREE_POSITIONS,
  createWorldState,
  getHouseTowerElevators,
  getPublicWorldState,
  getTargetById,
  getWorldCollisionBoxes,
  isPositionBlocked,
  resolveWalkablePosition,
};
