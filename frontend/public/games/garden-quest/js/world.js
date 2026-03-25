const HOUSE_LAYOUT = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 23 }),
    width: 24,
    depth: 18,
    wallHeight: 8.2,
    wallThickness: 0.55,
    doorWidth: 3.4,
    doorHeight: 4.8,
});

const DEFAULT_SOCCER_FIELD_LAYOUT = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: -31 }),
    width: 18,
    depth: 28,
    grandstandSide: 'east',
    grandstandSidelineGap: 3.8,
    grandstandLengthPadding: 4.8,
    grandstandTiers: 4,
    grandstandTierHeight: 0.58,
    grandstandTierDepth: 1.25,
});

const TREE_POSITIONS = Object.freeze([
    Object.freeze({ x: -33, z: -8 }),
    Object.freeze({ x: -29, z: 10 }),
    Object.freeze({ x: 29, z: 8 }),
    Object.freeze({ x: 34, z: -6 }),
    Object.freeze({ x: -34, z: 24 }),
    Object.freeze({ x: 30, z: 31 }),
    Object.freeze({ x: -22, z: 36 }),
    Object.freeze({ x: 22, z: 38 }),
]);

const DEFAULT_SOCCER_GRANDSTAND_LAYOUT = Object.freeze({
    side: 'east',
    sidelineGap: 3.8,
    lengthPadding: 4.8,
    tiers: 4,
    tierHeight: 0.58,
    tierDepth: 1.25,
});

const PLAYER_COLLISION_RADIUS = 0.45;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hasOwn(objectValue, key) {
    return Boolean(objectValue) && Object.prototype.hasOwnProperty.call(objectValue, key);
}

function clonePoint(point) {
    return {
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
        z: Number(point?.z) || 0,
    };
}

function cloneRect(rect) {
    return {
        minX: Number(rect?.minX) || 0,
        maxX: Number(rect?.maxX) || 0,
        minZ: Number(rect?.minZ) || 0,
        maxZ: Number(rect?.maxZ) || 0,
    };
}

function buildHouseFootprint(layout = HOUSE_LAYOUT, padding = 0) {
    const halfWidth = layout.width / 2;
    const halfDepth = layout.depth / 2;

    return {
        minX: layout.position.x - halfWidth - padding,
        maxX: layout.position.x + halfWidth + padding,
        minZ: layout.position.z - halfDepth - padding,
        maxZ: layout.position.z + halfDepth + padding,
    };
}

function buildHouseInteriorMetrics(layout = HOUSE_LAYOUT) {
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

function buildHouseTowerElevators(layout = HOUSE_LAYOUT) {
    const halfWidth = layout.width / 2;
    const halfDepth = layout.depth / 2;
    const southEdge = layout.position.z - halfDepth;
    const towerInsetX = 3.0;
    const towerInsetZ = 3.05;
    const towerRadius = 2.7;
    const topPlatformY = layout.wallHeight + 3.6;
    const topPlatformHalfSize = 1.9;
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
            topSurface: {
                minX: (layout.position.x - halfWidth + towerInsetX) - topPlatformHalfSize,
                maxX: (layout.position.x - halfWidth + towerInsetX) + topPlatformHalfSize,
                minZ: (southEdge + towerInsetZ) - topPlatformHalfSize,
                maxZ: (southEdge + towerInsetZ) + topPlatformHalfSize,
                height: topPlatformY,
            },
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
            topSurface: {
                minX: (layout.position.x + halfWidth - towerInsetX) - topPlatformHalfSize,
                maxX: (layout.position.x + halfWidth - towerInsetX) + topPlatformHalfSize,
                minZ: (southEdge + towerInsetZ) - topPlatformHalfSize,
                maxZ: (southEdge + towerInsetZ) + topPlatformHalfSize,
                height: topPlatformY,
            },
        },
    ];
}

function buildHouseTowerStepSurfaces(layout = HOUSE_LAYOUT) {
    return buildHouseTowerElevators(layout).map((elevator) => ({
        ...elevator.topSurface,
    }));
}

function buildHouseFloorStepSurfaces(layout = HOUSE_LAYOUT) {
    const metrics = buildHouseInteriorMetrics(layout);

    return [
        {
            minX: metrics.westEdge + 0.4,
            maxX: metrics.eastEdge - 0.4,
            minZ: metrics.southEdge + 0.4,
            maxZ: metrics.northEdge - 0.4,
            height: 0.15,
        },
    ];
}

function buildHouseRoyalStepSurfaces(layout = HOUSE_LAYOUT) {
    const metrics = buildHouseInteriorMetrics(layout);
    const throneZ = metrics.northEdge - 4.2;
    const leftTableX = layout.position.x - 5.8;
    const rightTableX = layout.position.x + 5.8;

    return [
        {
            minX: layout.position.x - 6.8,
            maxX: layout.position.x + 6.8,
            minZ: throneZ - 3.25,
            maxZ: throneZ - 1.75,
            height: 0.34,
        },
        {
            minX: layout.position.x - 5.1,
            maxX: layout.position.x + 5.1,
            minZ: throneZ - 1.95,
            maxZ: throneZ + 1.7,
            height: 0.72,
        },
        {
            minX: layout.position.x - 1.38,
            maxX: layout.position.x + 1.38,
            minZ: throneZ + 0.3,
            maxZ: throneZ + 1.58,
            height: 1.22,
        },
        {
            minX: layout.position.x - 6.9,
            maxX: layout.position.x - 5.15,
            minZ: throneZ - 0.1,
            maxZ: throneZ + 1.28,
            height: 0.82,
        },
        {
            minX: layout.position.x + 5.15,
            maxX: layout.position.x + 6.9,
            minZ: throneZ - 0.1,
            maxZ: throneZ + 1.28,
            height: 0.82,
        },
        {
            minX: leftTableX - 1.05,
            maxX: leftTableX + 1.05,
            minZ: layout.position.z - 3.6,
            maxZ: layout.position.z + 3.6,
            height: 1.05,
        },
        {
            minX: rightTableX - 1.05,
            maxX: rightTableX + 1.05,
            minZ: layout.position.z - 3.6,
            maxZ: layout.position.z + 3.6,
            height: 1.05,
        },
        {
            minX: layout.position.x - 8.7,
            maxX: layout.position.x - 7.35,
            minZ: throneZ - 0.35,
            maxZ: throneZ + 0.95,
            height: 0.56,
        },
        {
            minX: layout.position.x + 7.35,
            maxX: layout.position.x + 8.7,
            minZ: throneZ - 0.35,
            maxZ: throneZ + 0.95,
            height: 0.56,
        },
        {
            minX: layout.position.x - 1.25,
            maxX: layout.position.x + 1.25,
            minZ: layout.position.z - 3.45,
            maxZ: layout.position.z - 1.95,
            height: 0.92,
        },
    ];
}

function buildHouseStepSurfaces(layout = HOUSE_LAYOUT) {
    return [
        ...buildHouseFloorStepSurfaces(layout),
        ...buildHouseRoyalStepSurfaces(layout),
        ...buildHouseTowerStepSurfaces(layout),
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

function addCollisionRect(rects, minX, maxX, minZ, maxZ, options = {}) {
    if ((maxX - minX) < 0.01 || (maxZ - minZ) < 0.01) {
        return;
    }

    rects.push({ minX, maxX, minZ, maxZ, ...options });
}

function buildHouseWallCollisionBoxes(layout = HOUSE_LAYOUT) {
    const halfDoorWidth = (Number(layout.doorWidth) || 3.4) / 2;
    const wallThickness = Number(layout.wallThickness) || 0.55;
    const metrics = buildHouseInteriorMetrics(layout);
    const rects = [];

    // --- OUTER WALLS (Rendered and Physics) ---
    // North wall
    addCollisionRect(rects, metrics.westEdge, metrics.eastEdge, metrics.northEdge - wallThickness, metrics.northEdge);
    // West wall
    addCollisionRect(rects, metrics.westEdge, metrics.westEdge + wallThickness, metrics.southEdge, metrics.northEdge);
    // East wall
    addCollisionRect(rects, metrics.eastEdge - wallThickness, metrics.eastEdge, metrics.southEdge, metrics.northEdge);
    // South wall (Outer face, near the main gate)
    addCollisionRect(rects, metrics.westEdge, layout.position.x - halfDoorWidth, metrics.southEdge, metrics.southEdge + wallThickness);
    addCollisionRect(rects, layout.position.x + halfDoorWidth, metrics.eastEdge, metrics.southEdge, metrics.southEdge + wallThickness);

    // Note: Interior dividers and partitions are omitted to maintain the open castle layout.
    // Throneroom and wing partitions can be added here if needed in the future.

    // --- TOWER COLLISION WALLS (Physics ONLY, Hidden from rendering loop) ---
    // These are already rendered as cylinders in _createHouse, so we only need physics.
    const towerIngetX = 3.0;
    const towerInsetZ = 3.05;
    const tRadius = 2.7;
    const towerHalfWidth = layout.width / 2;
    const towerSouthEdge = layout.position.z - (layout.depth / 2);
    const TowerWestX = layout.position.x - towerHalfWidth + towerIngetX;
    const TowerEastX = layout.position.x + towerHalfWidth - towerIngetX;
    const TowerZ = towerSouthEdge + towerInsetZ;

    const towers = [
        { id: 'west', x: TowerWestX, z: TowerZ, doorSide: 'east' },
        { id: 'east', x: TowerEastX, z: TowerZ, doorSide: 'west' }
    ];

    towers.forEach(t => {
        const rColl = tRadius + 0.12; 
        const tDoorWidth = 1.62; // Slightly wider for ease of entry
        const tDHalf = tDoorWidth / 2;
        const hOpt = { hidden: true };

        // North, South side wall segments
        addCollisionRect(rects, t.x - rColl, t.x + rColl, t.z + rColl - wallThickness, t.z + rColl, hOpt); // Top
        addCollisionRect(rects, t.x - rColl, t.x + rColl, t.z - rColl, t.z - rColl + wallThickness, hOpt); // Bottom
        
        if (t.doorSide === 'east') {
            addCollisionRect(rects, t.x - rColl, t.x - rColl + wallThickness, t.z - rColl, t.z + rColl, hOpt); // Outer wall
            // Wall facing hall (door side)
            addCollisionRect(rects, t.x + rColl - wallThickness, t.x + rColl, t.z - rColl, t.z - tDHalf, hOpt);
            addCollisionRect(rects, t.x + rColl - wallThickness, t.x + rColl, t.z + tDHalf, t.z + rColl, hOpt);
        } else {
            addCollisionRect(rects, t.x + rColl - wallThickness, t.x + rColl, t.z - rColl, t.z + rColl, hOpt); // Outer wall
            // Wall facing hall (door side)
            addCollisionRect(rects, t.x - rColl, t.x - rColl + wallThickness, t.z - rColl, t.z - tDHalf, hOpt);
            addCollisionRect(rects, t.x - rColl, t.x - rColl + wallThickness, t.z + tDHalf, t.z + rColl, hOpt);
        }
    });

    return rects;
}

function isPointInsideRect(point, rect, padding = 0) {
    return (
        point.x >= rect.minX - padding &&
        point.x <= rect.maxX + padding &&
        point.z >= rect.minZ - padding &&
        point.z <= rect.maxZ + padding
    );
}

function buildSoccerGrandstandLayout(fieldState = DEFAULT_SOCCER_FIELD_LAYOUT) {
    const centerX = Number(fieldState?.position?.x) || 0;
    const centerZ = Number(fieldState?.position?.z) || 0;
    const fieldWidth = Number(fieldState?.width) || DEFAULT_SOCCER_FIELD_LAYOUT.width;
    const fieldDepth = Number(fieldState?.depth) || DEFAULT_SOCCER_FIELD_LAYOUT.depth;
    const side = fieldState?.grandstandSide === 'west' ? 'west' : DEFAULT_SOCCER_GRANDSTAND_LAYOUT.side;
    const sideMultiplier = side === 'west' ? -1 : 1;
    const sidelineGap = Number(fieldState?.grandstandSidelineGap) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.sidelineGap;
    const lengthPadding = Number(fieldState?.grandstandLengthPadding) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.lengthPadding;
    const tiers = Math.max(1, Math.trunc(Number(fieldState?.grandstandTiers) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tiers));
    const tierHeight = Number(fieldState?.grandstandTierHeight) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tierHeight;
    const tierDepth = Number(fieldState?.grandstandTierDepth) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tierDepth;
    const depth = (tiers * tierDepth) + 0.6;
    const length = fieldDepth + lengthPadding;
    const frontX = centerX + sideMultiplier * ((fieldWidth / 2) + sidelineGap);
    const backX = frontX + sideMultiplier * depth;

    return {
        centerX: frontX + sideMultiplier * (depth / 2),
        centerZ,
        side,
        sidelineGap,
        lengthPadding,
        tiers,
        tierHeight,
        tierDepth,
        depth,
        length,
        frontX,
        backX,
        sideMultiplier,
        minX: Math.min(frontX, backX),
        maxX: Math.max(frontX, backX),
        minZ: centerZ - (length / 2),
        maxZ: centerZ + (length / 2),
    };
}

function buildSoccerGrandstandFootprint(fieldState = DEFAULT_SOCCER_FIELD_LAYOUT, padding = 0) {
    const layout = buildSoccerGrandstandLayout(fieldState);

    return {
        minX: Math.min(layout.frontX, layout.backX) - padding,
        maxX: Math.max(layout.frontX, layout.backX) + padding,
        minZ: layout.minZ - padding,
        maxZ: layout.maxZ + padding,
    };
}

function buildSoccerGrandstandCollisionBoxes(fieldState = DEFAULT_SOCCER_FIELD_LAYOUT) {
    const layout = buildSoccerGrandstandLayout(fieldState);
    const backWallThickness = 0.3;
    const endWallThickness = 0.22;

    return [
        {
            minX: Math.min(layout.backX + (layout.sideMultiplier * backWallThickness), layout.frontX + (layout.sideMultiplier * (layout.tiers * layout.tierDepth)) - (layout.sideMultiplier * 0.1)),
            maxX: Math.max(layout.backX + (layout.sideMultiplier * backWallThickness), layout.frontX + (layout.sideMultiplier * (layout.tiers * layout.tierDepth)) - (layout.sideMultiplier * 0.1)),
            minZ: layout.minZ - 0.08,
            maxZ: layout.maxZ + 0.08,
        },
        {
            minX: layout.minX - 0.08,
            maxX: layout.maxX + 0.08,
            minZ: layout.minZ - 0.08,
            maxZ: layout.minZ + 0.18,
        },
        {
            minX: layout.minX - 0.08,
            maxX: layout.maxX + 0.08,
            minZ: layout.maxZ - 0.18,
            maxZ: layout.maxZ + 0.08,
        },
    ];
}

function buildSoccerGrandstandStepSurfaces(fieldState = DEFAULT_SOCCER_FIELD_LAYOUT) {
    const layout = buildSoccerGrandstandLayout(fieldState);
    const surfaces = [];

    for (let tierIndex = 0; tierIndex < layout.tiers; tierIndex++) {
        const tierStartX = layout.frontX + (layout.sideMultiplier * (tierIndex * layout.tierDepth));
        const tierEndX = layout.frontX + (layout.sideMultiplier * ((tierIndex + 1) * layout.tierDepth));
        surfaces.push({
            minX: Math.min(tierStartX, tierEndX),
            maxX: Math.max(tierStartX, tierEndX),
            minZ: layout.minZ + 0.18,
            maxZ: layout.maxZ - 0.18,
            height: (tierIndex + 1) * layout.tierHeight,
        });
    }

    return surfaces;
}

class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);
        
        this.trees = [];
        this.apples = [];
        this.applesByTree = new Map();
        this.looseApples = new Map();
        this.looseSwords = new Map();
        this.looseBows = new Map();
        this.arrowProjectiles = new Map();
        this.graves = new Map();
        this.soccerFieldGroup = null;
        this.soccerBall = null;
        this.soccerBallTargetPosition = new THREE.Vector3();
        this.soccerBallInitialized = false;
        this.soccerBallPossessed = false;
        this.soccerBallCarrierState = null;
        this.soccerFieldMetrics = null;
        this.soccerFieldSignature = '';
        this.soccerGoalBanner = null;
        this.soccerGoalBannerVisibleUntil = 0;
        this.appleOffsets = Array.isArray(options?.appleLayout) && options.appleLayout.length > 0
            ? options.appleLayout.map((point) => clonePoint(point))
            : [
                { x: 1.55, y: 3.85, z: 0.75 },
                { x: -1.35, y: 4.15, z: 0.95 },
                { x: 0.95, y: 4.55, z: -1.3 },
                { x: -0.35, y: 4.85, z: -0.95 },
                { x: 0.25, y: 3.75, z: 1.45 },
                { x: -1.55, y: 4.45, z: -0.15 },
            ];
        this.treeLayout = Array.isArray(options?.trees) && options.trees.length > 0
            ? options.trees.map((treeState, index) => ({
                id: String(treeState?.id || `tree-${index}`),
                position: clonePoint(treeState?.position),
            }))
            : TREE_POSITIONS.map((position, index) => ({
                id: `tree-${index}`,
                position: { x: position.x, y: 0, z: position.z },
            }));
        this.lakePosition = new THREE.Vector3(
            Number(options?.lake?.position?.x) || 0,
            Number(options?.lake?.position?.y) || 0,
            Number(options?.lake?.position?.z) || 0
        );
        this.lakeRadius = Number(options?.lake?.radius) || 6;
        this.bounds = Number.isFinite(options?.bounds) && options.bounds > 0
            ? options.bounds
            : 45;
        this.houseLayout = {
            ...HOUSE_LAYOUT,
            ...(options?.house
                ? {
                    position: clonePoint(options.house.position),
                    width: Number(options.house.width) || HOUSE_LAYOUT.width,
                    depth: Number(options.house.depth) || HOUSE_LAYOUT.depth,
                    wallHeight: Number(options.house.wallHeight) || HOUSE_LAYOUT.wallHeight,
                    wallThickness: Number(options.house.wallThickness) || HOUSE_LAYOUT.wallThickness,
                    doorWidth: Number(options.house.doorWidth) || HOUSE_LAYOUT.doorWidth,
                    doorHeight: Number(options.house.doorHeight) || HOUSE_LAYOUT.doorHeight,
                }
                : {}),
        };
        this.houseWallCollisionBoxes = Array.isArray(options?.house?.collisionBoxes) && options.house.collisionBoxes.length > 0
            ? options.house.collisionBoxes.map((rect) => cloneRect(rect))
            : buildHouseWallCollisionBoxes(this.houseLayout);
        this.houseTowerElevators = buildHouseTowerElevators(this.houseLayout);
        this.houseStepSurfaces = buildHouseStepSurfaces(this.houseLayout);
        this.soccerFieldState = options?.soccerField
            ? {
                ...DEFAULT_SOCCER_FIELD_LAYOUT,
                ...options.soccerField,
                position: clonePoint(options.soccerField.position),
            }
            : {
                ...DEFAULT_SOCCER_FIELD_LAYOUT,
                position: clonePoint(DEFAULT_SOCCER_FIELD_LAYOUT.position),
            };
        this.soccerGrandstandCollisionBoxes = buildSoccerGrandstandCollisionBoxes(this.soccerFieldState);
        this.soccerGrandstandStepSurfaces = buildSoccerGrandstandStepSurfaces(this.soccerFieldState);

        this._createGround();
        this._createSky();
        this._createLighting();
        this._createHouse();
        this._createLake();
        this._createTrees();
        this._createDecorations();
    }

    _getSoccerFieldSignature(fieldState) {
        return [
            Number(fieldState?.position?.x) || 0,
            Number(fieldState?.position?.z) || 0,
            Number(fieldState?.width) || 0,
            Number(fieldState?.depth) || 0,
            Number(fieldState?.goalWidth) || 0,
            Number(fieldState?.goalDepth) || 0,
            Number(fieldState?.goalHeight) || 0,
            Number(fieldState?.postThickness) || 0,
            Number(fieldState?.lineWidth) || 0,
            Number(fieldState?.ballRadius) || 0,
            String(fieldState?.grandstandSide || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.side),
            Number(fieldState?.grandstandSidelineGap) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.sidelineGap,
            Number(fieldState?.grandstandLengthPadding) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.lengthPadding,
            Number(fieldState?.grandstandTiers) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tiers,
            Number(fieldState?.grandstandTierHeight) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tierHeight,
            Number(fieldState?.grandstandTierDepth) || DEFAULT_SOCCER_GRANDSTAND_LAYOUT.tierDepth,
        ].join(':');
    }

    _getSoccerFieldMetrics(fieldState, ballState) {
        const radius = Number(ballState?.radius) || Number(fieldState?.ballRadius) || 0.42;
        const centerX = Number(fieldState?.position?.x) || 0;
        const centerZ = Number(fieldState?.position?.z) || 0;
        const halfWidth = (Number(fieldState?.width) || 18) / 2;
        const halfDepth = (Number(fieldState?.depth) || 28) / 2;

        return {
            radius,
            xMin: centerX - halfWidth + radius,
            xMax: centerX + halfWidth - radius,
            zMin: centerZ - halfDepth + radius,
            zMax: centerZ + halfDepth - radius,
        };
    }

    _clampSoccerBallTargetInsideField(targetPosition) {
        if (!this.soccerFieldMetrics) {
            return targetPosition;
        }

        return {
            x: clamp(Number(targetPosition?.x) || 0, this.soccerFieldMetrics.xMin, this.soccerFieldMetrics.xMax),
            y: Number(targetPosition?.y) || this.soccerFieldMetrics.radius,
            z: clamp(Number(targetPosition?.z) || 0, this.soccerFieldMetrics.zMin, this.soccerFieldMetrics.zMax),
        };
    }

    _disposeSoccerField() {
        if (!this.soccerFieldGroup) {
            return;
        }

        this._deepDispose(this.soccerFieldGroup);

        this.scene.remove(this.soccerFieldGroup);
        this.soccerFieldGroup = null;
        this.soccerBall = null;
        this.soccerBallInitialized = false;
        this.soccerBallPossessed = false;
        this.soccerBallCarrierState = null;
        this.soccerFieldMetrics = null;
        this.soccerFieldSignature = '';
        this.soccerGoalBanner = null;
        this.soccerGoalBannerVisibleUntil = 0;
    }

    _addSoccerLine(parent, width, depth, x, z, material) {
        const line = new THREE.Mesh(
            new THREE.BoxGeometry(width, 0.02, depth),
            material
        );
        line.position.set(x, 0.05, z);
        line.receiveShadow = true;
        parent.add(line);
    }

    _createGoalFrame(fieldState, side, material) {
        const goal = new THREE.Group();
        const postThickness = Number(fieldState?.postThickness) || 0.18;
        const goalWidth = Number(fieldState?.goalWidth) || 6.8;
        const goalDepth = Number(fieldState?.goalDepth) || 2.8;
        const goalHeight = Number(fieldState?.goalHeight) || 2.5;
        const fieldZ = Number(fieldState?.position?.z) || 0;
        const fieldHalfDepth = (Number(fieldState?.depth) || 28) / 2;
        const frontZ = side === 'north'
            ? fieldZ - fieldHalfDepth
            : fieldZ + fieldHalfDepth;
        const backOffset = side === 'north'
            ? -goalDepth / 2
            : goalDepth / 2;
        const innerGoalWidth = Math.max(goalWidth - postThickness, 0.1);
        const innerGoalDepth = Math.max(goalDepth - postThickness, 0.1);
        const sideNetOffsetX = (goalWidth / 2) - (postThickness / 2);
        const backNetZ = (backOffset * 2) - (Math.sign(backOffset) * (postThickness / 2));

        const leftPost = new THREE.Mesh(
            new THREE.BoxGeometry(postThickness, goalHeight, postThickness),
            material
        );
        leftPost.position.set(-(goalWidth / 2), goalHeight / 2, 0);
        leftPost.castShadow = true;
        leftPost.receiveShadow = true;
        goal.add(leftPost);

        const rightPost = leftPost.clone();
        rightPost.position.x = goalWidth / 2;
        goal.add(rightPost);

        const crossbar = new THREE.Mesh(
            new THREE.BoxGeometry(goalWidth + postThickness, postThickness, postThickness),
            material
        );
        crossbar.position.set(0, goalHeight, 0);
        crossbar.castShadow = true;
        crossbar.receiveShadow = true;
        goal.add(crossbar);

        const backbar = crossbar.clone();
        backbar.position.z = backOffset * 2;
        goal.add(backbar);

        const leftBack = new THREE.Mesh(
            new THREE.BoxGeometry(postThickness, goalHeight, postThickness),
            material
        );
        leftBack.position.set(-(goalWidth / 2), goalHeight / 2, backOffset * 2);
        leftBack.castShadow = true;
        leftBack.receiveShadow = true;
        goal.add(leftBack);

        const rightBack = leftBack.clone();
        rightBack.position.x = goalWidth / 2;
        goal.add(rightBack);

        const netMaterial = new THREE.MeshLambertMaterial({
            color: 0xf8fafc,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide,
        });

        const backNet = new THREE.Mesh(
            new THREE.PlaneGeometry(innerGoalWidth, goalHeight),
            netMaterial
        );
        backNet.position.set(0, goalHeight / 2, backNetZ);
        goal.add(backNet);

        const sideNetGeometry = new THREE.PlaneGeometry(innerGoalDepth, goalHeight);
        const leftNet = new THREE.Mesh(sideNetGeometry, netMaterial.clone());
        leftNet.position.set(-sideNetOffsetX, goalHeight / 2, backOffset);
        leftNet.rotation.y = Math.PI / 2;
        goal.add(leftNet);

        const rightNet = new THREE.Mesh(sideNetGeometry, netMaterial.clone());
        rightNet.position.set(sideNetOffsetX, goalHeight / 2, backOffset);
        rightNet.rotation.y = Math.PI / 2;
        goal.add(rightNet);

        goal.position.set(Number(fieldState?.position?.x) || 0, 0, frontZ);
        return goal;
    }

    _createSoccerGrandstand(fieldState) {
        const layout = buildSoccerGrandstandLayout(fieldState);
        const grandstand = new THREE.Group();
        const concreteMaterial = new THREE.MeshLambertMaterial({ color: 0xc9ced6 });
        const seatMaterial = new THREE.MeshLambertMaterial({ color: 0xa16207 });
        const railMaterial = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
        const bannerMaterial = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
        const crowdPalette = [0xef4444, 0xf59e0b, 0x2563eb, 0x16a34a, 0xe11d48, 0x7c3aed, 0x0f766e];
        const topStepHeight = layout.tiers * layout.tierHeight;

        const base = new THREE.Mesh(
            new THREE.BoxGeometry(layout.depth + 0.55, 0.16, layout.length + 0.8),
            concreteMaterial
        );
        base.position.set(layout.centerX, 0.08, layout.centerZ);
        base.castShadow = true;
        base.receiveShadow = true;
        grandstand.add(base);

        for (let tier = 0; tier < layout.tiers; tier++) {
            const stepHeight = (tier + 1) * layout.tierHeight;
            const step = new THREE.Mesh(
                new THREE.BoxGeometry(layout.tierDepth, stepHeight, layout.length - 0.7),
                concreteMaterial
            );
            step.position.set(
                layout.frontX + (layout.sideMultiplier * ((tier + 0.5) * layout.tierDepth)),
                stepHeight / 2,
                layout.centerZ
            );
            step.castShadow = true;
            step.receiveShadow = true;
            grandstand.add(step);

            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(layout.tierDepth * 0.76, 0.12, layout.length - 1.5),
                seatMaterial
            );
            seat.position.set(
                layout.frontX + (layout.sideMultiplier * ((tier + 0.72) * layout.tierDepth)),
                stepHeight + 0.1,
                layout.centerZ
            );
            seat.castShadow = true;
            seat.receiveShadow = true;
            grandstand.add(seat);
        }

        const backWallHeight = topStepHeight + 1.1;
        const backWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, backWallHeight, layout.length + 0.4),
            concreteMaterial
        );
        backWall.position.set(
            layout.backX + (layout.sideMultiplier * 0.11),
            backWallHeight / 2,
            layout.centerZ
        );
        backWall.castShadow = true;
        backWall.receiveShadow = true;
        grandstand.add(backWall);

        for (let side = -1; side <= 1; side += 2) {
            const endRail = new THREE.Mesh(
                new THREE.BoxGeometry(layout.depth + 0.2, 1.05, 0.12),
                railMaterial
            );
            endRail.position.set(
                layout.centerX,
                topStepHeight + 0.55,
                layout.centerZ + side * ((layout.length / 2) - 0.06)
            );
            endRail.castShadow = true;
            grandstand.add(endRail);
        }

        const backRailX = layout.backX - (layout.sideMultiplier * 0.16);
        for (let railIndex = 0; railIndex < 12; railIndex++) {
            const t = railIndex / 11;
            const z = THREE.MathUtils.lerp(layout.minZ + 0.5, layout.maxZ - 0.5, t);

            const post = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 1.1, 0.08),
                railMaterial
            );
            post.position.set(backRailX, topStepHeight + 0.48, z);
            post.castShadow = true;
            grandstand.add(post);
        }

        const handrail = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.1, layout.length - 0.8),
            railMaterial
        );
        handrail.position.set(backRailX, topStepHeight + 0.98, layout.centerZ);
        handrail.castShadow = true;
        grandstand.add(handrail);

        const banner = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 1.05, Math.min(layout.length - 3.2, 9.2)),
            bannerMaterial
        );
        banner.position.set(
            layout.backX - (layout.sideMultiplier * 0.14),
            topStepHeight + 1.4,
            layout.centerZ
        );
        banner.castShadow = true;
        grandstand.add(banner);

        const crowdSpacing = (layout.length - 3.4) / 7;
        for (let tier = 0; tier < layout.tiers; tier++) {
            for (let seatIndex = 0; seatIndex < 8; seatIndex++) {
                const spectator = new THREE.Group();
                const paletteIndex = (tier * 3 + seatIndex) % crowdPalette.length;
                const shirtMaterial = new THREE.MeshLambertMaterial({ color: crowdPalette[paletteIndex] });
                const body = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.18, 0.2, 0.42, 8),
                    shirtMaterial
                );
                body.castShadow = true;
                spectator.add(body);

                const head = new THREE.Mesh(
                    new THREE.SphereGeometry(0.12, 12, 12),
                    new THREE.MeshLambertMaterial({ color: 0xf1c27d })
                );
                head.position.y = 0.34;
                head.castShadow = true;
                spectator.add(head);

                const stepHeight = (tier + 1) * layout.tierHeight;
                spectator.position.set(
                    layout.frontX + (layout.sideMultiplier * ((tier + 0.52) * layout.tierDepth)),
                    stepHeight + 0.34,
                    layout.minZ + 1.7 + (seatIndex * crowdSpacing)
                );
                grandstand.add(spectator);
            }
        }

        return grandstand;
    }

    _createSoccerField(soccerState) {
        const fieldState = soccerState?.field || {};
        const fieldGroup = new THREE.Group();
        const centerX = Number(fieldState?.position?.x) || 0;
        const centerZ = Number(fieldState?.position?.z) || 0;
        const fieldWidth = Number(fieldState?.width) || 18;
        const fieldDepth = Number(fieldState?.depth) || 28;
        const lineWidth = Number(fieldState?.lineWidth) || 0.18;
        const ballRadius = Number(fieldState?.ballRadius) || 0.42;

        const grass = new THREE.Mesh(
            new THREE.PlaneGeometry(fieldWidth, fieldDepth),
            new THREE.MeshLambertMaterial({ color: 0x2b7f46 })
        );
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(centerX, 0.04, centerZ);
        grass.receiveShadow = true;
        fieldGroup.add(grass);

        const lineMaterial = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
        this._addSoccerLine(fieldGroup, fieldWidth, lineWidth, centerX, centerZ - (fieldDepth / 2), lineMaterial);
        this._addSoccerLine(fieldGroup, fieldWidth, lineWidth, centerX, centerZ + (fieldDepth / 2), lineMaterial);
        this._addSoccerLine(fieldGroup, lineWidth, fieldDepth, centerX - (fieldWidth / 2), centerZ, lineMaterial);
        this._addSoccerLine(fieldGroup, lineWidth, fieldDepth, centerX + (fieldWidth / 2), centerZ, lineMaterial);
        this._addSoccerLine(fieldGroup, fieldWidth, lineWidth, centerX, centerZ, lineMaterial);

        const centerCircle = new THREE.Mesh(
            new THREE.RingGeometry(2.1, 2.3, 48),
            lineMaterial
        );
        centerCircle.rotation.x = -Math.PI / 2;
        centerCircle.position.set(centerX, 0.055, centerZ);
        fieldGroup.add(centerCircle);

        const goalMaterial = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
        fieldGroup.add(this._createGoalFrame(fieldState, 'north', goalMaterial));
        fieldGroup.add(this._createGoalFrame(fieldState, 'south', goalMaterial));
        fieldGroup.add(this._createSoccerGrandstand(fieldState));

        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(ballRadius, 20, 20),
            new THREE.MeshPhongMaterial({
                color: 0xf8fafc,
                shininess: 80,
                specular: 0xffffff,
            })
        );
        ball.castShadow = true;
        ball.receiveShadow = true;
        ball.position.set(centerX, ballRadius, centerZ);
        fieldGroup.add(ball);

        const goalBanner = this._createSoccerGoalBanner(fieldState);
        fieldGroup.add(goalBanner);

        this.soccerFieldGroup = fieldGroup;
        this.soccerBall = ball;
        this.soccerGoalBanner = goalBanner;
        this.soccerBallTargetPosition.set(centerX, ballRadius, centerZ);
        this.soccerBallInitialized = false;
        this.soccerFieldMetrics = this._getSoccerFieldMetrics(fieldState, soccerState?.ball);
        this.soccerGrandstandCollisionBoxes = buildSoccerGrandstandCollisionBoxes(fieldState);
        this.soccerGrandstandStepSurfaces = buildSoccerGrandstandStepSurfaces(fieldState);
        this.soccerFieldSignature = this._getSoccerFieldSignature(fieldState);
        this.mainGroup.add(fieldGroup);
    }

    syncSoccerState(soccerState) {
        if (!soccerState?.ball) {
            return;
        }

        const fieldState = soccerState?.field || this.soccerFieldState || DEFAULT_SOCCER_FIELD_LAYOUT;
        this.soccerFieldState = {
            ...DEFAULT_SOCCER_FIELD_LAYOUT,
            ...fieldState,
            position: clonePoint(fieldState.position || DEFAULT_SOCCER_FIELD_LAYOUT.position),
        };
        const nextSignature = this._getSoccerFieldSignature(this.soccerFieldState);
        if (!this.soccerFieldGroup || this.soccerFieldSignature !== nextSignature) {
            this._disposeSoccerField();
            this._createSoccerField({
                ...soccerState,
                field: this.soccerFieldState,
            });
        }

        this.soccerFieldMetrics = this._getSoccerFieldMetrics(this.soccerFieldState, soccerState.ball);
        this.soccerGrandstandCollisionBoxes = buildSoccerGrandstandCollisionBoxes(this.soccerFieldState);
        this.soccerGrandstandStepSurfaces = buildSoccerGrandstandStepSurfaces(this.soccerFieldState);
        const nextBallY = Number(soccerState?.ball?.position?.y) || Number(soccerState?.ball?.radius) || 0.42;
        this.soccerBallPossessed = Boolean(String(soccerState?.ball?.possessedByActorId || '').trim());
        this.soccerBallTargetPosition.set(
            Number(soccerState?.ball?.position?.x) || 0,
            nextBallY,
            Number(soccerState?.ball?.position?.z) || 0
        );

        if (this.soccerBall && !this.soccerBallInitialized) {
            this.soccerBall.position.copy(this.soccerBallTargetPosition);
            this.soccerBallInitialized = true;
        }
    }

    setSoccerBallCarrierState(carrierState) {
        this.soccerBallCarrierState = carrierState && carrierState.position
            ? {
                position: carrierState.position,
                rotationY: Number.isFinite(carrierState.rotationY) ? carrierState.rotationY : 0,
            }
            : null;
    }

    _getSoccerBallCarrierTarget(carrierState) {
        const radius = this.soccerBallTargetPosition.y || 0.42;
        const offset = PLAYER_COLLISION_RADIUS + radius + 0.12;
        const rotationY = Number.isFinite(carrierState?.rotationY) ? carrierState.rotationY : 0;
        const position = carrierState?.position || { x: 0, y: 0, z: 0 };

        return {
            x: (Number(position.x) || 0) + (Math.sin(rotationY) * offset),
            y: radius,
            z: (Number(position.z) || 0) + (Math.cos(rotationY) * offset),
        };
    }

    _buildSoccerGoalBannerTexture(playerName) {
        const scorerName = String(playerName || 'Alguem').trim().slice(0, 24) || 'Alguem';
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgba(3, 84, 63, 0.9)';
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.96)';
        ctx.lineWidth = 14;

        const radius = 44;
        ctx.beginPath();
        ctx.moveTo(radius, 14);
        ctx.lineTo(canvas.width - radius, 14);
        ctx.quadraticCurveTo(canvas.width - 14, 14, canvas.width - 14, radius);
        ctx.lineTo(canvas.width - 14, canvas.height - radius);
        ctx.quadraticCurveTo(canvas.width - 14, canvas.height - 14, canvas.width - radius, canvas.height - 14);
        ctx.lineTo(radius, canvas.height - 14);
        ctx.quadraticCurveTo(14, canvas.height - 14, 14, canvas.height - radius);
        ctx.lineTo(14, radius);
        ctx.quadraticCurveTo(14, 14, radius, 14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#fef08a';
        ctx.font = '900 188px Outfit, sans-serif';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
        ctx.shadowBlur = 18;
        ctx.fillText('GOLLL', canvas.width / 2, 190);

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ecfeff';
        ctx.font = '700 86px Outfit, sans-serif';
        ctx.fillText(scorerName, canvas.width / 2, 348);

        ctx.fillStyle = 'rgba(226, 232, 240, 0.94)';
        ctx.font = '600 42px Outfit, sans-serif';
        ctx.fillText('marcou!', canvas.width / 2, 432);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    _createSoccerGoalBanner(fieldState) {
        const texture = this._buildSoccerGoalBannerTexture('Alguem');
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(12.6, 6.3, 1);
        sprite.position.set(
            Number(fieldState?.position?.x) || 0,
            4.8,
            Number(fieldState?.position?.z) || 0
        );
        sprite.renderOrder = 18;
        sprite.visible = false;
        sprite.userData.texture = texture;
        sprite.userData.baseScale = { x: 12.6, y: 6.3 };
        return sprite;
    }

    _updateSoccerGoalBanner(playerName) {
        if (!this.soccerGoalBanner) {
            return;
        }

        const nextTexture = this._buildSoccerGoalBannerTexture(playerName);
        const previousTexture = this.soccerGoalBanner.userData.texture;
        this.soccerGoalBanner.material.map = nextTexture;
        this.soccerGoalBanner.userData.texture = nextTexture;
        this.soccerGoalBanner.material.needsUpdate = true;

        if (previousTexture) {
            previousTexture.dispose();
        }
    }

    showSoccerGoalBanner(goalEvent, durationMs = 3000) {
        if (!this.soccerGoalBanner) {
            return;
        }

        this._updateSoccerGoalBanner(goalEvent?.playerName);
        this.soccerGoalBanner.visible = true;
        this.soccerGoalBanner.material.opacity = 1;
        this.soccerGoalBannerVisibleUntil = performance.now() + Math.max(300, Number(durationMs) || 3000);
    }

    _buildNameplateTexture(name) {
        const labelText = String(name || 'Finado').trim().slice(0, 22) || 'Finado';
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 96;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgba(31, 24, 20, 0.92)';
        ctx.strokeStyle = 'rgba(214, 194, 154, 0.95)';
        ctx.lineWidth = 6;

        const radius = 18;
        ctx.beginPath();
        ctx.moveTo(radius, 6);
        ctx.lineTo(canvas.width - radius, 6);
        ctx.quadraticCurveTo(canvas.width - 6, 6, canvas.width - 6, radius);
        ctx.lineTo(canvas.width - 6, canvas.height - radius);
        ctx.quadraticCurveTo(canvas.width - 6, canvas.height - 6, canvas.width - radius, canvas.height - 6);
        ctx.lineTo(radius, canvas.height - 6);
        ctx.quadraticCurveTo(6, canvas.height - 6, 6, canvas.height - radius);
        ctx.lineTo(6, radius);
        ctx.quadraticCurveTo(6, 6, radius, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8e7c7';
        ctx.font = '700 28px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    _createGraveNameplate(graveState) {
        const texture = this._buildNameplateTexture(graveState?.actorName);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2.6, 0.78, 1);
        sprite.position.set(0, 1.92, 0);
        sprite.renderOrder = 12;
        sprite.userData.texture = texture;
        return sprite;
    }

    _updateGraveNameplate(marker, graveState) {
        if (!marker?.userData?.nameplate) {
            return;
        }

        const nextName = String(graveState?.actorName || 'Finado').trim() || 'Finado';
        if (marker.userData.actorName === nextName) {
            return;
        }

        const nextTexture = this._buildNameplateTexture(nextName);
        const previousTexture = marker.userData.nameplate.userData.texture;
        marker.userData.nameplate.material.map = nextTexture;
        marker.userData.nameplate.userData.texture = nextTexture;
        marker.userData.nameplate.material.needsUpdate = true;
        marker.userData.actorName = nextName;

        if (previousTexture) {
            previousTexture.dispose();
        }
    }

    _deepDispose(node) {
        if (!node) return;

        node.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) {
                    child.geometry.dispose();
                }

                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat) => {
                        // Dispose of all possible textures in a material
                        const textureSlots = [
                            'map', 'normalMap', 'roughnessMap', 'metalnessMap', 
                            'emissiveMap', 'envMap', 'displacementMap', 'aoMap', 
                            'lightMap', 'alphaMap', 'bumpMap'
                        ];
                        
                        textureSlots.forEach((slot) => {
                            if (mat[slot] && mat[slot].dispose) {
                                mat[slot].dispose();
                            }
                        });

                        if (typeof mat.dispose === 'function') {
                            mat.dispose();
                        }
                    });
                }
            }
        });
    }

    _disposeGraveMarker(marker) {
        if (!marker) {
            return;
        }

        this._deepDispose(marker);
    }

    _createGround() {
        const groundGeo = new THREE.PlaneGeometry(100, 100, 1, 1);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a9e4a });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.mainGroup.add(ground);

        const pathGeo = new THREE.PlaneGeometry(3.8, 24);
        const pathMat = new THREE.MeshLambertMaterial({ color: 0xb99a65 });
        const path = new THREE.Mesh(pathGeo, pathMat);
        path.rotation.x = -Math.PI / 2;
        path.position.set(0, 0.02, 10.4);
        path.receiveShadow = true;
        this.mainGroup.add(path);
    }

    _createSky() {
        const skyGeo = new THREE.SphereGeometry(80, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x5eb4f5) },
                bottomColor: { value: new THREE.Color(0xc8e6ff) },
                offset: { value: 10 },
                exponent: { value: 0.6 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide,
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        this.mainGroup.add(sky);

        for (let i = 0; i < 8; i++) {
            this._createCloud(
                (Math.random() - 0.5) * 80,
                25 + Math.random() * 15,
                (Math.random() - 0.5) * 80
            );
        }
    }

    _createCloud(x, y, z) {
        const cloudGroup = new THREE.Group();
        const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

        const sizes = [
            { s: [3, 1.5, 2], p: [0, 0, 0] },
            { s: [2, 1.2, 1.8], p: [1.8, 0.2, 0.3] },
            { s: [2.5, 1.3, 1.6], p: [-1.5, 0.1, -0.2] },
            { s: [1.5, 1, 1.5], p: [0.5, 0.5, -0.5] },
        ];

        sizes.forEach(({ s, p }) => {
            const geo = new THREE.SphereGeometry(1, 8, 6);
            const mesh = new THREE.Mesh(geo, cloudMat);
            mesh.scale.set(s[0], s[1], s[2]);
            mesh.position.set(p[0], p[1], p[2]);
            cloudGroup.add(mesh);
        });

        cloudGroup.position.set(x, y, z);
        cloudGroup.userData.speed = 0.3 + Math.random() * 0.5;
        cloudGroup.userData.isCloud = true;
        this.mainGroup.add(cloudGroup);
    }

    _createLighting() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.mainGroup.add(ambient);

        const sun = new THREE.DirectionalLight(0xfff4d6, 1.0);
        sun.position.set(20, 30, 10);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 100;
        sun.shadow.camera.left = -30;
        sun.shadow.camera.right = 30;
        sun.shadow.camera.top = 30;
        sun.shadow.camera.bottom = -30;
        this.mainGroup.add(sun);

        const hemi = new THREE.HemisphereLight(0x87CEEB, 0x4a9e4a, 0.3);
        this.mainGroup.add(hemi);
    }

    _createHouse() {
        const houseGroup = new THREE.Group();
        const { width, depth, wallHeight, wallThickness, doorWidth, doorHeight, position } = this.houseLayout;
        const localLayout = {
            ...this.houseLayout,
            position: { x: 0, y: 0, z: 0 },
        };
        const metrics = buildHouseInteriorMetrics(localLayout);
        const collisionRects = buildHouseWallCollisionBoxes(localLayout);
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        const gateZ = metrics.southEdge + (wallThickness / 2);

        const stoneMat = new THREE.MeshLambertMaterial({ color: 0x98a2ae });
        const darkStoneMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x737983 });
        const floorAltMat = new THREE.MeshLambertMaterial({ color: 0x8b919c });
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4b32 });
        const woodDarkMat = new THREE.MeshLambertMaterial({ color: 0x4b3423 });
        const ironMat = new THREE.MeshLambertMaterial({ color: 0x2d3748 });
        const bannerBlueMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
        const bannerRedMat = new THREE.MeshLambertMaterial({ color: 0x991b1b });
        const carpetMat = new THREE.MeshLambertMaterial({ color: 0x7f1d1d });
        const candleMat = new THREE.MeshLambertMaterial({ color: 0xfef3c7, emissive: 0xf59e0b, emissiveIntensity: 0.2 });
        const parchmentMat = new THREE.MeshLambertMaterial({ color: 0xe7dcc0 });
        const goldMat = new THREE.MeshLambertMaterial({ color: 0xc69214 });
        const barrelMat = new THREE.MeshLambertMaterial({ color: 0x8b6b4a });
        const glassMat = new THREE.MeshLambertMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.75 });
        const fabricMat = new THREE.MeshLambertMaterial({ color: 0x586b8c });
        const clothMat = new THREE.MeshLambertMaterial({ color: 0xd8ccb2 });
        const royalVelvetMat = new THREE.MeshLambertMaterial({ color: 0x5f1223 });
        const rubyMat = new THREE.MeshLambertMaterial({ color: 0xbe123c, emissive: 0x4c0519, emissiveIntensity: 0.12 });
        const emeraldMat = new THREE.MeshLambertMaterial({ color: 0x059669, emissive: 0x022c22, emissiveIntensity: 0.12 });

        const createMesh = (geometry, material, positionVector, options = {}) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(positionVector.x, positionVector.y, positionVector.z);
            mesh.castShadow = options.castShadow !== false;
            mesh.receiveShadow = options.receiveShadow !== false;
            if (typeof options.rotationX === 'number') mesh.rotation.x = options.rotationX;
            if (typeof options.rotationY === 'number') mesh.rotation.y = options.rotationY;
            if (typeof options.rotationZ === 'number') mesh.rotation.z = options.rotationZ;
            houseGroup.add(mesh);
            return mesh;
        };

        const createBox = (sizeX, sizeY, sizeZ, material, x, y, z, options = {}) => {
            return createMesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), material, { x, y, z }, options);
        };

        const createCylinder = (radiusTop, radiusBottom, height, radialSegments, material, x, y, z, options = {}) => {
            return createMesh(
                new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
                material,
                { x, y, z },
                options
            );
        };

        const createCone = (radius, height, radialSegments, material, x, y, z, options = {}) => {
            return createMesh(
                new THREE.ConeGeometry(radius, height, radialSegments),
                material,
                { x, y, z },
                options
            );
        };

        const createBanner = (x, y, z, material, rotationY = 0, widthSize = 1.4, heightSize = 3.2) => {
            createBox(0.12, heightSize + 0.35, 0.12, woodDarkMat, x, y + 0.1, z);
            createBox(widthSize, heightSize, 0.08, material, x, y - 0.15, z, { rotationY, castShadow: false });
            createBox(widthSize + 0.15, 0.12, 0.12, goldMat, x, y + (heightSize / 2) + 0.2, z, { rotationY });
        };

        const createTorch = (x, y, z, rotationY = 0) => {
            const bracket = createBox(0.14, 0.18, 0.34, ironMat, x, y, z, { rotationY });
            bracket.castShadow = false;
            const flame = createMesh(
                new THREE.SphereGeometry(0.16, 8, 8),
                candleMat,
                { x, y: y + 0.2, z },
                { castShadow: false, receiveShadow: false }
            );
            flame.scale.set(0.9, 1.35, 0.9);
        };

        const createShelf = (x, z, rotationY = 0) => {
            createBox(2.2, 1.8, 0.55, woodDarkMat, x, 0.92, z, { rotationY });
            createBox(2.0, 0.1, 0.48, woodMat, x, 0.55, z, { rotationY });
            createBox(2.0, 0.1, 0.48, woodMat, x, 1.0, z, { rotationY });
            createBox(2.0, 0.1, 0.48, woodMat, x, 1.45, z, { rotationY });
            createBox(0.25, 0.36, 0.18, bannerBlueMat, x - 0.55, 1.17, z - 0.03, { rotationY, castShadow: false });
            createBox(0.32, 0.42, 0.18, bannerRedMat, x, 1.2, z + 0.05, { rotationY, castShadow: false });
            createBox(0.3, 0.22, 0.18, parchmentMat, x + 0.56, 1.52, z - 0.04, { rotationY, castShadow: false });
        };

        const createBarrel = (x, z, scale = 1) => {
            createCylinder(0.36 * scale, 0.42 * scale, 0.9 * scale, 10, barrelMat, x, 0.45 * scale, z);
            createBox(0.85 * scale, 0.06 * scale, 0.85 * scale, ironMat, x, 0.22 * scale, z);
            createBox(0.85 * scale, 0.06 * scale, 0.85 * scale, ironMat, x, 0.68 * scale, z);
        };

        const createTableSet = (x, z, widthSize, depthSize, rotationY = 0) => {
            createBox(widthSize, 0.16, depthSize, woodMat, x, 1.05, z, { rotationY });
            [
                [-0.42, -0.32],
                [0.42, -0.32],
                [-0.42, 0.32],
                [0.42, 0.32],
            ].forEach(([offsetX, offsetZ]) => {
                const nextX = x + ((rotationY === Math.PI / 2) ? offsetZ * widthSize : offsetX * widthSize);
                const nextZ = z + ((rotationY === Math.PI / 2) ? offsetX * depthSize : offsetZ * depthSize);
                createBox(0.12, 0.86, 0.12, woodDarkMat, nextX, 0.55, nextZ);
            });
        };

        const createBench = (x, z, widthSize, rotationY = 0) => {
            createBox(widthSize, 0.12, 0.38, woodDarkMat, x, 0.54, z, { rotationY });
            if (rotationY === Math.PI / 2) {
                createBox(0.1, 0.42, 0.1, woodDarkMat, x, 0.27, z - ((widthSize / 2) - 0.18));
                createBox(0.1, 0.42, 0.1, woodDarkMat, x, 0.27, z + ((widthSize / 2) - 0.18));
                return;
            }

            createBox(0.1, 0.42, 0.1, woodDarkMat, x - ((widthSize / 2) - 0.18), 0.27, z);
            createBox(0.1, 0.42, 0.1, woodDarkMat, x + ((widthSize / 2) - 0.18), 0.27, z);
        };

        const createBed = (x, z, blanketColor, rotationY = 0) => {
            const blanketMat = new THREE.MeshLambertMaterial({ color: blanketColor });
            createBox(2.3, 0.3, 1.4, woodDarkMat, x, 0.18, z, { rotationY });
            createBox(2.02, 0.22, 1.16, clothMat, x, 0.42, z, { rotationY });
            createBox(1.98, 0.18, 0.74, blanketMat, x + (rotationY === 0 ? 0.12 : 0), 0.55, z + (rotationY === 0 ? 0.16 : 0), { rotationY });
            createBox(0.6, 0.14, 0.34, clothMat, x - (rotationY === 0 ? 0.68 : 0), 0.62, z, { rotationY });
            createBox(2.3, 0.72, 0.12, woodDarkMat, x, 0.55, z + 0.66, { rotationY });
        };

        const createWeaponRack = (x, z, rotationY = 0) => {
            createBox(1.7, 1.4, 0.26, woodDarkMat, x, 0.7, z, { rotationY });
            [-0.52, -0.16, 0.2, 0.54].forEach((offset, index) => {
                const spearX = x + (rotationY === Math.PI / 2 ? 0 : offset);
                const spearZ = z + (rotationY === Math.PI / 2 ? offset : 0);
                createCylinder(0.03, 0.03, 1.75, 6, woodMat, spearX, 1.05, spearZ, {
                    rotationZ: rotationY === Math.PI / 2 ? Math.PI / 24 : -Math.PI / 24,
                    rotationX: rotationY === Math.PI / 2 ? -Math.PI / 24 : 0,
                });
                createBox(0.1, 0.22, 0.04, ironMat, spearX, 1.88, spearZ + (index % 2 === 0 ? 0.05 : -0.05));
            });
        };

        const createGoblet = (x, y, z) => {
            createCylinder(0.05, 0.08, 0.1, 10, goldMat, x, y, z);
            createCylinder(0.02, 0.02, 0.12, 8, goldMat, x, y - 0.09, z);
        };

        const createTreasurePile = (x, z) => {
            [
                { x: -0.28, z: -0.08, size: 0.12 },
                { x: -0.1, z: 0.18, size: 0.1 },
                { x: 0.14, z: 0.04, size: 0.11 },
                { x: 0.32, z: 0.2, size: 0.13 },
                { x: 0.04, z: -0.22, size: 0.09 },
            ].forEach((piece) => {
                createCylinder(piece.size, piece.size, 0.035, 10, goldMat, x + piece.x, 0.02, z + piece.z, { castShadow: false });
            });
        };

        const createTreasureChest = (x, z, scale = 1) => {
            createBox(1.28 * scale, 0.32 * scale, 1.22 * scale, woodDarkMat, x, 0.16 * scale, z);
            createBox(1.34 * scale, 0.08 * scale, 1.28 * scale, goldMat, x, 0.3 * scale, z);
            createBox(1.18 * scale, 0.2 * scale, 1.1 * scale, woodMat, x, 0.46 * scale, z);
            createBox(1.24 * scale, 0.04 * scale, 1.18 * scale, goldMat, x, 0.54 * scale, z);
            createBox(0.16 * scale, 0.16 * scale, 0.08 * scale, ironMat, x, 0.34 * scale, z + (0.6 * scale));
            createTreasurePile(x - (0.5 * scale), z + (0.68 * scale));
        };

        const createCrown = (x, y, z, scale = 1) => {
            createCylinder(0.22 * scale, 0.28 * scale, 0.12 * scale, 10, goldMat, x, y, z);
            [-0.18, 0, 0.18].forEach((offsetX, index) => {
                createCone(0.055 * scale, (index === 1 ? 0.22 : 0.18) * scale, 8, goldMat, x + offsetX, y + (0.13 * scale), z);
            });
            [-0.13, 0.13].forEach((offsetZ) => {
                createCone(0.05 * scale, 0.16 * scale, 8, goldMat, x, y + (0.11 * scale), z + offsetZ);
            });
            createMesh(new THREE.SphereGeometry(0.05 * scale, 8, 8), rubyMat, { x, y: y + (0.05 * scale), z }, { castShadow: false });
        };

        const createCandelabra = (x, z, height = 1.5) => {
            createCylinder(0.18, 0.24, 0.12, 12, goldMat, x, 0.06, z);
            createCylinder(0.05, 0.07, height, 10, goldMat, x, 0.06 + (height / 2), z);
            [-0.26, 0, 0.26].forEach((offsetX) => {
                const armY = height + (offsetX === 0 ? 0.1 : -0.02);
                const armZ = z + (offsetX === 0 ? 0 : 0.06);
                createCylinder(0.03, 0.03, 0.34, 8, goldMat, x + offsetX, armY, armZ, {
                    rotationZ: offsetX === 0 ? 0 : (offsetX < 0 ? Math.PI / 5 : -Math.PI / 5),
                });
                createCone(0.07, 0.16, 8, candleMat, x + offsetX, armY + 0.2, armZ, {
                    castShadow: false,
                    receiveShadow: false,
                });
            });
        };

        const createRoyalPedestal = (x, z, ornamentBuilder) => {
            createBox(1.75, 0.72, 1.38, stoneMat, x, 0.36, z);
            createBox(1.55, 0.1, 1.18, darkStoneMat, x, 0.77, z);
            if (typeof ornamentBuilder === 'function') {
                ornamentBuilder();
            }
        };

        const createBanquetTable = (x, z, runnerMaterial) => {
            createTableSet(x, z, 2.1, 7.2);
            createBox(0.64, 0.04, 6.2, runnerMaterial, x, 1.1, z, { castShadow: false });
            [-2.5, -0.85, 0.8, 2.45].forEach((offsetZ) => {
                createBox(1.26, 0.04, 0.68, clothMat, x, 1.12, z + offsetZ, { castShadow: false });
                createGoblet(x - 0.42, 1.2, z + offsetZ - 0.08);
                createGoblet(x + 0.42, 1.2, z + offsetZ + 0.08);
                createCylinder(0.18, 0.18, 0.02, 12, goldMat, x, 1.12, z + offsetZ, { castShadow: false });
                createCone(0.05, 0.12, 8, candleMat, x, 1.22, z + offsetZ, { castShadow: false, receiveShadow: false });
            });
        };

        const createMapStand = (x, z) => {
            createBox(2.5, 0.82, 1.5, darkStoneMat, x, 0.41, z);
            createBox(2.22, 0.1, 1.22, stoneMat, x, 0.87, z);
            createBox(1.94, 0.05, 0.96, parchmentMat, x, 0.95, z, { castShadow: false });
            createBox(0.34, 0.12, 0.34, goldMat, x, 1.02, z - 0.2);
            createMesh(new THREE.SphereGeometry(0.18, 10, 10), emeraldMat, { x, y: 1.12, z: z + 0.18 }, { castShadow: false });
        };

        const createThrone = (x, z) => {
            createBox(1.7, 0.22, 1.24, goldMat, x, 1.33, z);
            createBox(1.18, 0.18, 0.92, royalVelvetMat, x, 1.48, z - 0.04);
            createBox(0.24, 0.82, 0.98, goldMat, x - 0.66, 1.62, z - 0.04);
            createBox(0.24, 0.82, 0.98, goldMat, x + 0.66, 1.62, z - 0.04);
            createBox(1.62, 1.46, 0.18, goldMat, x, 2.0, z + 0.46);
            createBox(1.16, 1.14, 0.12, royalVelvetMat, x, 1.94, z + 0.36);
            createBox(1.88, 0.14, 0.42, goldMat, x, 2.74, z + 0.5);
            [-0.72, -0.36, 0, 0.36, 0.72].forEach((offsetX, index) => {
                createCone(0.1 + (index === 2 ? 0.03 : 0), 0.36 + (index === 2 ? 0.12 : 0), 8, goldMat, x + offsetX, 2.96 + (index === 2 ? 0.05 : 0), z + 0.5);
            });
            createMesh(new THREE.SphereGeometry(0.12, 10, 10), rubyMat, { x, y: 2.8, z: z + 0.4 }, { castShadow: false });
        };

        createBox(width + 3.2, 0.52, depth + 2.8, darkStoneMat, 0, 0.26, 0);
        createBox(width + 1.8, 0.18, depth + 1.4, stoneMat, 0, 0.6, 0);
        createBox(width - 0.8, 0.14, depth - 0.8, floorMat, 0, 0.08, 0);
        createBox(width - 6.2, 0.05, depth - 5.2, floorAltMat, 0, 0.11, 0, { castShadow: false });

        collisionRects.forEach((rect) => {
            if (rect.hidden) {
                return;
            }
            createBox(
                rect.maxX - rect.minX,
                wallHeight,
                rect.maxZ - rect.minZ,
                stoneMat,
                (rect.minX + rect.maxX) / 2,
                wallHeight / 2,
                (rect.minZ + rect.maxZ) / 2
            );
        });

        createBox(doorWidth, wallHeight - doorHeight, wallThickness, stoneMat, 0, doorHeight + ((wallHeight - doorHeight) / 2), gateZ);
        createBox(doorWidth + 1.3, 0.22, wallThickness + 0.08, darkStoneMat, 0, doorHeight + 0.35, gateZ + 0.02);
        createBox(doorWidth + 0.4, 0.18, 0.24, goldMat, 0, doorHeight - 0.15, gateZ - 0.08);

        const gateDoorLeft = new THREE.Group();
        gateDoorLeft.position.set(-(doorWidth / 2), 0, metrics.southEdge - 0.02);
        gateDoorLeft.rotation.y = -1.08;
        const leftDoorMesh = new THREE.Mesh(new THREE.BoxGeometry((doorWidth / 2) - 0.08, doorHeight, 0.14), woodMat);
        leftDoorMesh.position.set(((doorWidth / 2) - 0.08) / 2, doorHeight / 2, 0);
        leftDoorMesh.castShadow = true;
        gateDoorLeft.add(leftDoorMesh);
        houseGroup.add(gateDoorLeft);

        const gateDoorRight = new THREE.Group();
        gateDoorRight.position.set(doorWidth / 2, 0, metrics.southEdge - 0.02);
        gateDoorRight.rotation.y = 1.08;
        const rightDoorMesh = new THREE.Mesh(new THREE.BoxGeometry((doorWidth / 2) - 0.08, doorHeight, 0.14), woodMat);
        rightDoorMesh.position.set(-(((doorWidth / 2) - 0.08) / 2), doorHeight / 2, 0);
        rightDoorMesh.castShadow = true;
        gateDoorRight.add(rightDoorMesh);
        houseGroup.add(gateDoorRight);

        const towerHeight = wallHeight + 4.2;
        const towerCenters = buildHouseTowerElevators(localLayout).map((tower, index) => ({
            ...tower,
            bannerMat: index === 0 ? bannerBlueMat : bannerRedMat,
        }));

        const createTowerBattlements = (centerX, centerZ, baseY) => {
            for (let index = 0; index < 12; index++) {
                const angle = (index / 12) * Math.PI * 2;
                const radius = towerCenters[0].towerRadius + 0.12;
                createBox(
                    0.48,
                    0.95,
                    0.82,
                    darkStoneMat,
                    centerX + (Math.cos(angle) * radius),
                    baseY,
                    centerZ + (Math.sin(angle) * radius),
                    { rotationY: angle }
                );
            }
        };

        const createTowerElevator = (tower) => {
            const liftMat = new THREE.MeshLambertMaterial({ color: 0x9f7a35 });
            const glowMat = new THREE.MeshLambertMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.18 });
            const shadowMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
            const buttonPedestalMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
            const innerPassageLength = Math.abs(tower.x - tower.innerDoor.x) + 0.68;
            const innerPassageCenterX = (tower.x + tower.innerDoor.x) / 2;

            createCylinder(0.86, 0.94, 0.18, 18, ironMat, tower.x, 0.09, tower.z);
            createCylinder(tower.towerRadius - 0.1, tower.towerRadius - 0.1, 0.2, 24, stoneMat, tower.x, tower.topY, tower.z);

            const elevatorCar = new THREE.Group();
            elevatorCar.position.set(tower.x, tower.topY, tower.z);
            
            const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.74, 0.08, 18), liftMat);
            padMesh.castShadow = true;
            padMesh.receiveShadow = true;
            // Pad floor must be at exactly the Y position of the car group
            elevatorCar.add(padMesh);

            const recMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.2, 18), ironMat);
            recMesh.position.y = -0.12;
            elevatorCar.add(recMesh);
            
            const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.7, 0.1, 18), glowMat);
            ringMesh.position.y = +0.04;
            elevatorCar.add(ringMesh);

            houseGroup.add(elevatorCar);
            if (!this.towerElevatorCars) this.towerElevatorCars = new Map();
            this.towerElevatorCars.set(tower.id, elevatorCar);
            createBox(innerPassageLength, 0.08, 1.72, floorAltMat, innerPassageCenterX, 0.19, tower.z + 0.08, {
                castShadow: false,
            });
            createBox(innerPassageLength - 0.26, 0.04, 1.32, glowMat, innerPassageCenterX, 0.23, tower.z + 0.08, {
                castShadow: false,
            });

            createBox(
                tower.innerDoor.width + 0.45,
                0.34,
                0.28,
                darkStoneMat,
                tower.innerDoor.x,
                tower.innerDoor.y + (tower.innerDoor.height / 2) + 0.17,
                tower.innerDoor.z,
                { rotationY: tower.innerDoor.rotationY }
            );
            createBox(
                0.225,
                tower.innerDoor.height,
                0.28,
                darkStoneMat,
                tower.innerDoor.x,
                tower.innerDoor.y,
                tower.innerDoor.z + (tower.innerDoor.width / 2) + 0.1125,
                { rotationY: tower.innerDoor.rotationY }
            );
            createBox(
                0.225,
                tower.innerDoor.height,
                0.28,
                darkStoneMat,
                tower.innerDoor.x,
                tower.innerDoor.y,
                tower.innerDoor.z - (tower.innerDoor.width / 2) - 0.1125,
                { rotationY: tower.innerDoor.rotationY }
            );
            const doorGroup = new THREE.Group();
            doorGroup.position.set(tower.innerDoor.x, tower.innerDoor.y, tower.innerDoor.z - (tower.innerDoor.width / 2));
            doorGroup.rotation.y = tower.innerSideX === 1 ? -1.4 : 1.4;
            const woodMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, tower.innerDoor.height, tower.innerDoor.width), woodMat);
            woodMesh.position.set(0, 0, tower.innerDoor.width / 2);
            woodMesh.castShadow = true;
            doorGroup.add(woodMesh);
            houseGroup.add(doorGroup);
            createBox(
                tower.innerDoor.width + 0.18,
                0.18,
                0.34,
                goldMat,
                tower.innerDoor.x,
                tower.innerDoor.y + (tower.innerDoor.height / 2) + 0.16,
                tower.innerDoor.z,
                { rotationY: tower.innerDoor.rotationY }
            );

            createCylinder(0.24, 0.3, 0.7, 10, buttonPedestalMat, tower.callButton.x, 0.35, tower.callButton.z);
            createBox(0.5, 0.08, 0.5, darkStoneMat, tower.callButton.x, 0.6, tower.callButton.z);
            createCylinder(0.14, 0.16, 0.08, 12, glowMat, tower.callButton.x, 0.74, tower.callButton.z);
            createBox(0.22, 0.04, 0.22, goldMat, tower.callButton.x, 0.84, tower.callButton.z, {
                castShadow: false,
            });

            [-0.52, 0.52].forEach((offsetX) => {
                [-0.52, 0.52].forEach((offsetZ) => {
                    createCylinder(0.05, 0.05, tower.topY - 0.18, 8, ironMat, tower.x + offsetX, (tower.topY - 0.18) / 2, tower.z + offsetZ);
                });
            });

            createBox(1.25, 0.06, 1.25, glowMat, tower.x, 0.27, tower.z, { castShadow: false });
            createBox(1.15, 0.06, 1.15, glowMat, tower.x, tower.topY + 0.08, tower.z, { castShadow: false });
        };

        towerCenters.forEach((tower) => {
            const gap = 0.65;
            const thetaStart = (tower.innerSideX === 1 ? Math.PI/2 : -Math.PI/2) + (gap/2);
            const thetaLength = (Math.PI * 2) - gap;
            
            const openStoneMat = stoneMat.clone();
            openStoneMat.side = THREE.DoubleSide;
            createMesh(new THREE.CylinderGeometry(tower.towerRadius, tower.towerRadius + 0.24, towerHeight, 20, 1, false, thetaStart, thetaLength), openStoneMat, { x: tower.x, y: towerHeight / 2, z: tower.z });
            
            const openDarkStoneMat = darkStoneMat.clone();
            openDarkStoneMat.side = THREE.DoubleSide;
            createMesh(new THREE.CylinderGeometry(tower.towerRadius + 0.35, tower.towerRadius + 0.35, 0.32, 20, 1, false, thetaStart, thetaLength), openDarkStoneMat, { x: tower.x, y: towerHeight + 0.16, z: tower.z });
            createTowerBattlements(tower.x, tower.z, towerHeight + 0.62);
            createBox(0.35, 1.4, 0.18, ironMat, tower.x, 4.2, tower.z - tower.towerRadius + 0.18);
            createBox(0.35, 1.4, 0.18, ironMat, tower.x, 7.1, tower.z - tower.towerRadius + 0.18);
            createBanner(tower.x, 6.8, tower.z - tower.towerRadius - 0.2, tower.bannerMat, 0, 1.2, 3.3);
            createTowerElevator(tower);
        });

        const createCrenellationsAlongX = (startX, endX, z, y, gapWidth = 1.15) => {
            const span = endX - startX;
            const blockCount = Math.max(2, Math.floor(span / gapWidth));
            for (let index = 0; index < blockCount; index++) {
                const x = THREE.MathUtils.lerp(startX + 0.4, endX - 0.4, blockCount === 1 ? 0.5 : index / (blockCount - 1));
                createBox(0.58, 0.92, wallThickness + 0.12, darkStoneMat, x, y, z);
            }
        };

        const createCrenellationsAlongZ = (startZ, endZ, x, y, gapWidth = 1.15) => {
            const span = endZ - startZ;
            const blockCount = Math.max(2, Math.floor(span / gapWidth));
            for (let index = 0; index < blockCount; index++) {
                const z = THREE.MathUtils.lerp(startZ + 0.4, endZ - 0.4, blockCount === 1 ? 0.5 : index / (blockCount - 1));
                createBox(wallThickness + 0.12, 0.92, 0.58, darkStoneMat, x, y, z);
            }
        };

        createBox(width, 0.26, wallThickness + 0.12, darkStoneMat, 0, wallHeight + 0.12, metrics.northEdge - (wallThickness / 2));
        createBox(wallThickness + 0.12, 0.26, depth, darkStoneMat, metrics.westEdge + (wallThickness / 2), wallHeight + 0.12, 0);
        createBox(wallThickness + 0.12, 0.26, depth, darkStoneMat, metrics.eastEdge - (wallThickness / 2), wallHeight + 0.12, 0);
        createBox((width - doorWidth) / 2, 0.26, wallThickness + 0.12, darkStoneMat, -((doorWidth / 2) + ((width - doorWidth) / 4)), wallHeight + 0.12, gateZ);
        createBox((width - doorWidth) / 2, 0.26, wallThickness + 0.12, darkStoneMat, (doorWidth / 2) + ((width - doorWidth) / 4), wallHeight + 0.12, gateZ);

        createCrenellationsAlongX(metrics.westEdge + 0.6, metrics.eastEdge - 0.6, metrics.northEdge - (wallThickness / 2), wallHeight + 0.7);
        createCrenellationsAlongX(metrics.westEdge + 0.6, -(doorWidth / 2) - 0.35, gateZ, wallHeight + 0.7);
        createCrenellationsAlongX((doorWidth / 2) + 0.35, metrics.eastEdge - 0.6, gateZ, wallHeight + 0.7);
        createCrenellationsAlongZ(metrics.southEdge + 0.6, metrics.northEdge - 0.6, metrics.westEdge + (wallThickness / 2), wallHeight + 0.7);
        createCrenellationsAlongZ(metrics.southEdge + 0.6, metrics.northEdge - 0.6, metrics.eastEdge - (wallThickness / 2), wallHeight + 0.7);

        for (let index = 0; index < 6; index++) {
            const x = THREE.MathUtils.lerp(metrics.westEdge + 2.2, metrics.eastEdge - 2.2, index / 5);
            createBox(0.35, 1.5, 0.18, ironMat, x, 4.45, metrics.northEdge - wallThickness + 0.07);
        }
        createBanner(-4.3, 5.2, metrics.northEdge - wallThickness + 0.18, bannerBlueMat, 0, 1.35, 3.1);
        createBanner(4.3, 5.2, metrics.northEdge - wallThickness + 0.18, bannerRedMat, 0, 1.35, 3.1);

        const throneZ = metrics.northEdge - 4.2;
        const carpetStartZ = metrics.southEdge + 1.45;
        const carpetEndZ = throneZ - 2.05;
        const carpetCenterZ = (carpetStartZ + carpetEndZ) / 2;
        const carpetLength = carpetEndZ - carpetStartZ;
        const leftTableX = localLayout.position.x - 5.8;
        const rightTableX = localLayout.position.x + 5.8;
        const pedestalZ = throneZ + 0.59;
        const chestZ = throneZ + 0.3;

        createBox(4.25, 0.04, carpetLength + 0.55, goldMat, 0, 0.1, carpetCenterZ, { castShadow: false });
        createBox(3.8, 0.05, carpetLength, carpetMat, 0, 0.12, carpetCenterZ, { castShadow: false });
        createBox(6.2, 0.05, 2.35, carpetMat, 0, 0.76, throneZ - 0.15, { castShadow: false });

        createBox(13.6, 0.34, 1.5, darkStoneMat, 0, 0.17, throneZ - 2.5);
        createBox(11.6, 0.14, 1.18, stoneMat, 0, 0.29, throneZ - 2.5);
        createBox(10.2, 0.38, 3.65, stoneMat, 0, 0.53, throneZ - 0.12);
        createBox(9.1, 0.1, 2.95, darkStoneMat, 0, 0.77, throneZ - 0.05);
        createBox(2.76, 0.5, 1.28, darkStoneMat, 0, 0.97, throneZ + 0.94);
        createBox(2.18, 0.12, 0.98, goldMat, 0, 1.16, throneZ + 0.92);
        createThrone(0, throneZ + 0.92);

        createRoyalPedestal(-6.025, pedestalZ, () => {
            createCrown(-6.025, 0.92, pedestalZ, 1.08);
            createMesh(new THREE.SphereGeometry(0.12, 10, 10), emeraldMat, { x: -6.025, y: 1.08, z: pedestalZ + 0.22 }, { castShadow: false });
        });
        createRoyalPedestal(6.025, pedestalZ, () => {
            createMesh(new THREE.SphereGeometry(0.2, 10, 10), rubyMat, { x: 6.025, y: 1.04, z: pedestalZ }, { castShadow: false });
            createCylinder(0.03, 0.03, 0.42, 8, goldMat, 6.025, 0.96, pedestalZ);
            createBox(0.18, 0.04, 0.18, goldMat, 6.025, 1.18, pedestalZ);
        });

        createTreasureChest(-8.025, chestZ, 1);
        createTreasureChest(8.025, chestZ, 1);

        createBanquetTable(leftTableX, localLayout.position.z, bannerBlueMat);
        createBanquetTable(rightTableX, localLayout.position.z, bannerRedMat);
        createMapStand(0, localLayout.position.z - 2.7);

        createBanner(metrics.westEdge + 0.18, 4.7, -4.8, bannerBlueMat, Math.PI / 2, 1.15, 2.9);
        createBanner(metrics.eastEdge - 0.18, 4.7, -4.8, bannerRedMat, -Math.PI / 2, 1.15, 2.9);
        createBanner(metrics.westEdge + 0.18, 4.7, 1.8, bannerRedMat, Math.PI / 2, 1.15, 2.9);
        createBanner(metrics.eastEdge - 0.18, 4.7, 1.8, bannerBlueMat, -Math.PI / 2, 1.15, 2.9);

        [-5.4, -1.8, 1.5].forEach((hallZ) => {
            createCandelabra(-2.75, hallZ);
            createCandelabra(2.75, hallZ);
        });
        createCandelabra(-3.35, throneZ - 0.95, 1.72);
        createCandelabra(3.35, throneZ - 0.95, 1.72);

        createTorch(-(doorWidth / 2) - 1.15, 3.0, metrics.southEdge + 0.4);
        createTorch((doorWidth / 2) + 1.15, 3.0, metrics.southEdge + 0.4);
        createTorch(metrics.westEdge + 0.5, 3.2, -2.4, Math.PI / 2);
        createTorch(metrics.eastEdge - 0.5, 3.2, -2.4, -Math.PI / 2);
        createTorch(metrics.westEdge + 0.5, 3.2, 3.8, Math.PI / 2);
        createTorch(metrics.eastEdge - 0.5, 3.2, 3.8, -Math.PI / 2);

        createBox(5.2, 0.22, 1.8, darkStoneMat, 0, 0.15, metrics.southEdge - 1.0);
        createBox(4.3, 0.22, 1.5, stoneMat, 0, 0.38, metrics.southEdge - 0.34);
        createBox(3.6, 0.18, 1.1, stoneMat, 0, 0.6, metrics.southEdge + 0.22);

        for (let index = 0; index < 4; index++) {
            const slitX = THREE.MathUtils.lerp(metrics.westEdge + 2.2, metrics.eastEdge - 2.2, index / 3);
            createBox(0.28, 1.6, 0.16, ironMat, slitX, 4.8, metrics.northEdge - 0.05);
        }
        for (let index = 0; index < 3; index++) {
            const slitZ = THREE.MathUtils.lerp(metrics.southEdge + 4.0, metrics.northEdge - 2.8, index / 2);
            createBox(0.16, 1.55, 0.26, ironMat, metrics.westEdge + 0.05, 4.6, slitZ);
            createBox(0.16, 1.55, 0.26, ironMat, metrics.eastEdge - 0.05, 4.6, slitZ);
        }

        houseGroup.position.set(position.x, position.y, position.z);
        this.mainGroup.add(houseGroup);
    }

    _createLake() {
        const lakeGeo = new THREE.CircleGeometry(this.lakeRadius, 32);
        const lakeMat = new THREE.MeshPhongMaterial({
            color: 0x2288cc,
            transparent: true,
            opacity: 0.7,
            shininess: 100,
            specular: 0x88ccff,
        });
        this.lake = new THREE.Mesh(lakeGeo, lakeMat);
        this.lake.rotation.x = -Math.PI / 2;
        this.lake.position.set(this.lakePosition.x, this.lakePosition.y + 0.05, this.lakePosition.z);
        this.lake.receiveShadow = true;
        this.mainGroup.add(this.lake);

        const edgeGeo = new THREE.RingGeometry(this.lakeRadius, this.lakeRadius + 0.8, 32);
        const edgeMat = new THREE.MeshLambertMaterial({ color: 0x3a7a3a });
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(this.lakePosition.x, this.lakePosition.y + 0.03, this.lakePosition.z);
        this.mainGroup.add(edge);

        const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
            const r = this.lakeRadius + 0.5 + Math.random() * 0.5;
            const rockGeo = new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.3, 0);
            const rock = new THREE.Mesh(rockGeo, rockMat);
            rock.position.set(
                this.lakePosition.x + (Math.cos(angle) * r),
                this.lakePosition.y + 0.1 + Math.random() * 0.15,
                this.lakePosition.z + (Math.sin(angle) * r)
            );
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            rock.castShadow = true;
            this.mainGroup.add(rock);
        }
    }

    _createTrees() {
        this.treeLayout.forEach((treeState, index) => {
            this._createTree(treeState.position.x, treeState.position.z, index, treeState.id);
        });
    }

    _createTree(x, z, index, treeId = `tree-${index}`) {
        const treeGroup = new THREE.Group();

        const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 8);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        const canopyMat = new THREE.MeshLambertMaterial({ color: 0x2d8a4e });

        const c1 = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), canopyMat);
        c1.position.set(0, 4, 0);
        c1.castShadow = true;
        treeGroup.add(c1);

        const c2 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), canopyMat);
        c2.position.set(0.8, 4.8, 0.5);
        c2.castShadow = true;
        treeGroup.add(c2);

        const c3 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), canopyMat);
        c3.position.set(-0.6, 4.5, -0.4);
        c3.castShadow = true;
        treeGroup.add(c3);

        const treeApples = [];
        const appleMat = new THREE.MeshPhongMaterial({
            color: 0xff4f4f,
            shininess: 90,
            specular: 0xffffff,
        });
        const stemMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
        const leafMat = new THREE.MeshLambertMaterial({ color: 0x4da85f });
        for (let i = 0; i < this.appleOffsets.length; i++) {
            const appleGroup = new THREE.Group();
            const apple = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), appleMat);
            apple.castShadow = true;
            apple.receiveShadow = true;
            appleGroup.add(apple);

            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.16, 6), stemMat);
            stem.position.y = 0.2;
            stem.castShadow = true;
            appleGroup.add(stem);

            const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), leafMat);
            leaf.scale.set(1.4, 0.45, 0.9);
            leaf.position.set(0.1, 0.22, 0.03);
            leaf.rotation.z = -0.65;
            appleGroup.add(leaf);

            const offset = this.appleOffsets[i];
            appleGroup.position.set(offset.x, offset.y, offset.z);
            treeGroup.add(appleGroup);

            const appleData = {
                mesh: appleGroup,
                treeGroup: treeGroup,
                treeIndex: index,
                slotIndex: i,
                collected: false,
            };

            treeApples.push(appleData);
            this.apples.push(appleData);
        }

        treeGroup.position.set(x, 0, z);
        treeGroup.userData.isTree = true;
        treeGroup.userData.treeIndex = index;
        treeGroup.userData.treeId = treeId;
        this.trees.push(treeGroup);
        this.applesByTree.set(index, treeApples);
        this.mainGroup.add(treeGroup);
    }

    _createDecorations() {
        const grandstandFootprint = buildSoccerGrandstandFootprint(this.soccerFieldState, 1.2);
        const castleFootprint = buildHouseFootprint(this.houseLayout, 2.4);
        const flowerColors = [0xff69b4, 0xffd700, 0xff6347, 0xda70d6, 0xffa500];
        for (let i = 0; i < 60; i++) {
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;

            const dx = x - this.lakePosition.x;
            const dz = z - this.lakePosition.z;
            const distToLake = Math.sqrt((dx * dx) + (dz * dz));
            const isInsideSoccerField =
                Math.abs(x - this.soccerFieldState.position.x) < (this.soccerFieldState.width / 2) + 1.5
                && Math.abs(z - this.soccerFieldState.position.z) < (this.soccerFieldState.depth / 2) + 1.5;
            const isInsideGrandstand = isPointInsideRect({ x, z }, grandstandFootprint);
            const isInsideCastle = isPointInsideRect({ x, z }, castleFootprint);
            if (distToLake < this.lakeRadius + 2 || isInsideCastle || isInsideSoccerField || isInsideGrandstand) continue;

            const flowerGeo = new THREE.SphereGeometry(0.12, 6, 6);
            const flowerMat = new THREE.MeshLambertMaterial({
                color: flowerColors[Math.floor(Math.random() * flowerColors.length)]
            });
            const flower = new THREE.Mesh(flowerGeo, flowerMat);
            flower.position.set(x, 0.15, z);
            this.mainGroup.add(flower);

            const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.2);
            const stemMat = new THREE.MeshLambertMaterial({ color: 0x2d6b2d });
            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.set(x, 0.08, z);
            this.mainGroup.add(stem);
        }
    }

    update(time) {
        if (this.lake) {
            this.lake.material.opacity = 0.65 + Math.sin(time * 1.5) * 0.05;
        }

        if (this.soccerBall && this.soccerBallInitialized) {
            if (this.soccerBallPossessed && this.soccerBallCarrierState) {
                const carrierTarget = this._clampSoccerBallTargetInsideField(
                    this._getSoccerBallCarrierTarget(this.soccerBallCarrierState)
                );
                this.soccerBallTargetPosition.set(carrierTarget.x, carrierTarget.y, carrierTarget.z);
            }

            const previousPosition = this.soccerBall.position.clone();
            const targetDistance = previousPosition.distanceTo(this.soccerBallTargetPosition);
            if (this.soccerBallPossessed) {
                if (targetDistance > 0.75) {
                    this.soccerBall.position.copy(this.soccerBallTargetPosition);
                } else {
                    this.soccerBall.position.lerp(this.soccerBallTargetPosition, 0.82);
                }
            } else if (targetDistance > 2.6) {
                this.soccerBall.position.copy(this.soccerBallTargetPosition);
            } else {
                const followStrength = targetDistance > 1.2 ? 0.46 : 0.18;
                this.soccerBall.position.lerp(this.soccerBallTargetPosition, followStrength);
            }
            const movement = this.soccerBall.position.clone().sub(previousPosition);
            const movementLength = movement.length();
            if (movementLength > 0.0005) {
                this.soccerBall.rotation.z += movement.x * 1.9;
                this.soccerBall.rotation.x -= movement.z * 1.9;
            }
        }

        if (this.soccerGoalBanner) {
            const remainingMs = this.soccerGoalBannerVisibleUntil - performance.now();
            if (remainingMs > 0) {
                const pulse = 1 + (Math.sin(time * 7.5) * 0.035);
                const baseScale = this.soccerGoalBanner.userData.baseScale || { x: 12.6, y: 6.3 };
                this.soccerGoalBanner.visible = true;
                this.soccerGoalBanner.scale.set(baseScale.x * pulse, baseScale.y * pulse, 1);
                this.soccerGoalBanner.material.opacity = remainingMs < 420 ? remainingMs / 420 : 1;
            } else if (this.soccerGoalBanner.visible) {
                this.soccerGoalBanner.visible = false;
                this.soccerGoalBanner.material.opacity = 0;
            }
        }

        this.scene.traverse((obj) => {
            if (obj.userData.isCloud) {
                obj.position.x += obj.userData.speed * 0.016;
                if (obj.position.x > 50) obj.position.x = -50;
            }
        });

        this.apples.forEach((appleData, index) => {
            if (!appleData.collected) {
                const offset = this.appleOffsets[appleData.slotIndex];
                appleData.mesh.position.y = offset.y + Math.sin(time * 2 + index) * 0.08;
                const pulseScale = 1 + (Math.sin((time * 3.2) + index) * 0.06);
                appleData.mesh.scale.setScalar(pulseScale);
            }
        });

        Array.from(this.looseApples.values()).forEach((marker, index) => {
            const baseY = Number(marker.userData.baseY) || 0.22;
            const floatSeed = Number(marker.userData.floatSeed) || 0;
            marker.position.y = baseY + (Math.sin((time * 2.6) + floatSeed + index) * 0.045);
            const pulseScale = 1 + (Math.sin((time * 3.4) + floatSeed + index) * 0.04);
            marker.scale.setScalar(pulseScale);
        });

        Array.from(this.looseSwords.values()).forEach((marker, index) => {
            const baseY = Number(marker.userData.baseY) || 0.28;
            const floatSeed = Number(marker.userData.floatSeed) || 0;
            marker.position.y = baseY + (Math.sin((time * 2.3) + floatSeed + index) * 0.048);
            marker.rotation.y += 0.012;
            const pulseScale = 1 + (Math.sin((time * 3.1) + floatSeed + index) * 0.032);
            marker.scale.setScalar(pulseScale);
        });

        Array.from(this.looseBows.values()).forEach((marker, index) => {
            const baseY = Number(marker.userData.baseY) || 0.28;
            const floatSeed = Number(marker.userData.floatSeed) || 0;
            marker.position.y = baseY + (Math.sin((time * 2.1) + floatSeed + index) * 0.05);
            marker.rotation.y += 0.008;
            const pulseScale = 1 + (Math.sin((time * 2.9) + floatSeed + index) * 0.035);
            marker.scale.setScalar(pulseScale);
        });

        Array.from(this.arrowProjectiles.values()).forEach((marker) => {
            const targetPosition = marker.userData.targetPosition;
            if (targetPosition instanceof THREE.Vector3) {
                marker.position.lerp(targetPosition, 0.72);
            }

            if (typeof marker.userData.targetRotationY === 'number') {
                marker.rotation.y = marker.userData.targetRotationY;
            }
        });

        if (this.towerElevatorCars) {
            this.towerElevatorCars.forEach((car) => {
                if (typeof car.targetY === 'number') {
                    car.position.y += (car.targetY - car.position.y) * 0.35;
                }
            });
        }
    }

    setWorldBounds(bounds) {
        if (Number.isFinite(bounds) && bounds > 0) {
            this.bounds = bounds;
        }
    }

    applyWorldPatch(worldPatch = {}) {
        if (!worldPatch || typeof worldPatch !== 'object') {
            return;
        }

        if (hasOwn(worldPatch, 'trees')) {
            this.syncTreeState(worldPatch.trees);
        }

        if (hasOwn(worldPatch, 'droppedApples')) {
            this.syncDroppedApples(worldPatch.droppedApples);
        }

        if (hasOwn(worldPatch, 'swords')) {
            this.syncSwordPickups(worldPatch.swords);
        }

        if (hasOwn(worldPatch, 'bows')) {
            this.syncBowPickups(worldPatch.bows);
        }

        if (hasOwn(worldPatch, 'arrows')) {
            this.syncArrowProjectiles(worldPatch.arrows);
        }

        if (hasOwn(worldPatch, 'elevators')) {
            this.syncElevators(worldPatch.elevators);
        }

        if (hasOwn(worldPatch, 'graves')) {
            this.syncGraves(worldPatch.graves);
        }

        if (hasOwn(worldPatch, 'soccer')) {
            this.syncSoccerState(worldPatch.soccer);
        }

        if (hasOwn(worldPatch, 'bounds')) {
            this.setWorldBounds(worldPatch.bounds);
        }
    }

    _getActorGroundHeight(position) {
        let h = 0;
        for (let index = this.houseStepSurfaces.length - 1; index >= 0; index -= 1) {
            const surface = this.houseStepSurfaces[index];
            if (isPointInsideRect(position, surface, 0)) {
                h = Math.max(h, Number(surface.height) || 0);
            }
        }

        for (let index = this.soccerGrandstandStepSurfaces.length - 1; index >= 0; index -= 1) {
            const surface = this.soccerGrandstandStepSurfaces[index];
            if (isPointInsideRect(position, surface, 0)) {
                h = Math.max(h, Number(surface.height) || 0);
            }
        }

        if (this.towerElevatorsState && this.houseTowerElevators) {
            for (let i = 0; i < this.houseTowerElevators.length; i++) {
                const layout = this.houseTowerElevators[i];
                if (isPointInsideRect(position, layout.topSurface, 0)) {
                    const state = this.towerElevatorsState.find(e => e.id === layout.id);
                    if (state) {
                        h = Math.max(h, Number(state.y) || 0);
                    }
                }
            }
        }

        return h;
    }

    isBlockedPosition(position, padding = PLAYER_COLLISION_RADIUS) {
        const collisionBoxes = [...this.houseWallCollisionBoxes, ...this.soccerGrandstandCollisionBoxes];
        return collisionBoxes.some((rect) => isPointInsideRect(position, rect, padding));
    }

    resolveActorMovement(currentPosition, nextPosition, padding = PLAYER_COLLISION_RADIUS) {
        const current = clonePoint(currentPosition);
        const candidate = {
            x: clamp(Number(nextPosition?.x) || 0, -this.bounds, this.bounds),
            y: Number(nextPosition?.y) || current.y,
            z: clamp(Number(nextPosition?.z) || 0, -this.bounds, this.bounds),
        };
        const resolved = {
            x: current.x,
            y: 0,
            z: current.z,
        };

        if (!this.isBlockedPosition({ x: candidate.x, y: candidate.y, z: current.z }, padding)) {
            resolved.x = candidate.x;
        }

        if (!this.isBlockedPosition({ x: resolved.x, y: candidate.y, z: candidate.z }, padding)) {
            resolved.z = candidate.z;
        }

        resolved.y = this._getActorGroundHeight(resolved);
        return resolved;
    }

    getTreePosition(index) {
        if (this.trees[index]) {
            return this.trees[index].position;
        }
        return null;
    }

    _createGraveMarker(graveState) {
        const marker = new THREE.Group();
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x8b6b4a });
        const stoneMat = new THREE.MeshLambertMaterial({ color: 0x9aa3af });
        const flowerMat = new THREE.MeshLambertMaterial({ color: 0xe11d48 });
        const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f855a });

        const mound = new THREE.Mesh(
            new THREE.CylinderGeometry(0.72, 0.96, 0.18, 18),
            stoneMat
        );
        mound.position.y = 0.09;
        mound.receiveShadow = true;
        marker.add(mound);

        const post = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 1.55, 0.16),
            woodMat
        );
        post.position.y = 0.9;
        post.castShadow = true;
        post.receiveShadow = true;
        marker.add(post);

        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(0.72, 0.14, 0.14),
            woodMat
        );
        arm.position.set(0, 1.15, 0);
        arm.castShadow = true;
        arm.receiveShadow = true;
        marker.add(arm);

        const flower = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 10, 10),
            flowerMat
        );
        flower.position.set(0.2, 0.24, 0.12);
        marker.add(flower);

        const leaf = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 8),
            leafMat
        );
        leaf.scale.set(1.2, 0.45, 0.8);
        leaf.position.set(0.28, 0.28, 0.12);
        leaf.rotation.z = -0.55;
        marker.add(leaf);

        const nameplate = this._createGraveNameplate(graveState);
        marker.add(nameplate);
        marker.userData.nameplate = nameplate;
        marker.userData.actorName = String(graveState?.actorName || 'Finado').trim() || 'Finado';

        marker.position.set(
            Number(graveState?.position?.x) || 0,
            Number(graveState?.position?.y) || 0,
            Number(graveState?.position?.z) || 0
        );
        marker.rotation.y = ((Number(graveState?.position?.x) || 0) * 0.11) % (Math.PI * 2);
        this.mainGroup.add(marker);
        return marker;
    }

    removeApple(appleData) {
        appleData.collected = true;
        appleData.mesh.visible = false;
        // Also ensure it's removed from its parent group if it was attached
        if (appleData.mesh.parent) {
            appleData.mesh.parent.remove(appleData.mesh);
        }
    }

    _createLooseAppleMarker(appleState) {
        const appleGroup = new THREE.Group();
        const appleMat = new THREE.MeshPhongMaterial({
            color: 0xff4f4f,
            shininess: 90,
            specular: 0xffffff,
        });
        const stemMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
        const leafMat = new THREE.MeshLambertMaterial({ color: 0x4da85f });

        const apple = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), appleMat);
        apple.castShadow = true;
        apple.receiveShadow = true;
        appleGroup.add(apple);

        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.16, 6), stemMat);
        stem.position.y = 0.2;
        stem.castShadow = true;
        appleGroup.add(stem);

        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), leafMat);
        leaf.scale.set(1.4, 0.45, 0.9);
        leaf.position.set(0.1, 0.22, 0.03);
        leaf.rotation.z = -0.65;
        appleGroup.add(leaf);

        appleGroup.position.set(
            Number(appleState?.position?.x) || 0,
            Number(appleState?.position?.y) || 0.22,
            Number(appleState?.position?.z) || 0
        );
        appleGroup.rotation.y = Math.random() * Math.PI * 2;
        appleGroup.userData.baseY = appleGroup.position.y;
        appleGroup.userData.floatSeed = Math.random() * Math.PI * 2;
        this.mainGroup.add(appleGroup);
        return appleGroup;
    }

    _disposeLooseAppleMarker(marker) {
        if (!marker) {
            return;
        }

        marker.traverse((child) => {
            if (child.material) {
                child.material.dispose();
            }

            if (child.geometry) {
                child.geometry.dispose();
            }
        });
    }

    _createSwordPickupMarker(swordState) {
        const swordGroup = new THREE.Group();
        const bladeMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1 });
        const guardMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
        const gripMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
        const pommelMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 1.08, 0.18),
            bladeMat
        );
        blade.position.y = 0.56;
        blade.castShadow = true;
        blade.receiveShadow = true;
        swordGroup.add(blade);

        const fuller = new THREE.Mesh(
            new THREE.BoxGeometry(0.018, 0.82, 0.05),
            pommelMat
        );
        fuller.position.set(0, 0.6, 0);
        swordGroup.add(fuller);

        const guard = new THREE.Mesh(
            new THREE.BoxGeometry(0.52, 0.08, 0.12),
            guardMat
        );
        guard.position.y = 0.06;
        guard.castShadow = true;
        guard.receiveShadow = true;
        swordGroup.add(guard);

        const grip = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.38, 8),
            gripMat
        );
        grip.position.y = -0.16;
        grip.castShadow = true;
        grip.receiveShadow = true;
        swordGroup.add(grip);

        const pommel = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 8),
            pommelMat
        );
        pommel.position.y = -0.38;
        swordGroup.add(pommel);

        swordGroup.position.set(
            Number(swordState?.position?.x) || 0,
            Number(swordState?.position?.y) || 0.28,
            Number(swordState?.position?.z) || 0
        );
        swordGroup.rotation.z = -0.3;
        swordGroup.rotation.y = Math.random() * Math.PI * 2;
        swordGroup.userData.baseY = swordGroup.position.y;
        swordGroup.userData.floatSeed = Math.random() * Math.PI * 2;
        this.mainGroup.add(swordGroup);
        return swordGroup;
    }

    _disposeSwordPickupMarker(marker) {
        if (!marker) {
            return;
        }

        marker.traverse((child) => {
            if (child.material) {
                child.material.dispose();
            }

            if (child.geometry) {
                child.geometry.dispose();
            }
        });
    }

    syncSwordPickups(swordStates) {
        const activeIds = new Set();
        const nextSwordStates = Array.isArray(swordStates) ? swordStates : [];

        nextSwordStates.forEach((swordState) => {
            if (!swordState?.id) {
                return;
            }

            activeIds.add(swordState.id);

            if (!this.looseSwords.has(swordState.id)) {
                this.looseSwords.set(swordState.id, this._createSwordPickupMarker(swordState));
                return;
            }

            const marker = this.looseSwords.get(swordState.id);
            marker.position.set(
                Number(swordState?.position?.x) || 0,
                Number(swordState?.position?.y) || 0.28,
                Number(swordState?.position?.z) || 0
            );
            marker.userData.baseY = marker.position.y;
        });

        Array.from(this.looseSwords.entries()).forEach(([swordId, marker]) => {
            if (activeIds.has(swordId)) {
                return;
            }

            this.mainGroup.remove(marker);
            this._disposeSwordPickupMarker(marker);
            this.looseSwords.delete(swordId);
        });
    }

    _createBowPickupMarker(bowState) {
        const bowGroup = new THREE.Group();
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x7c4a21 });
        const gripMat = new THREE.MeshLambertMaterial({ color: 0x5b3420 });
        const stringMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9 });
        const arrowShaftMat = new THREE.MeshLambertMaterial({ color: 0xc08457 });
        const arrowTipMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
        const arrowFeatherMat = new THREE.MeshLambertMaterial({ color: 0xef4444 });

        const bowArc = new THREE.Mesh(
            new THREE.TorusGeometry(0.42, 0.04, 6, 20, Math.PI),
            woodMat
        );
        bowArc.rotation.set(Math.PI / 2, Math.PI / 2, 0);
        bowArc.castShadow = true;
        bowArc.receiveShadow = true;
        bowGroup.add(bowArc);

        const grip = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.42, 0.12),
            gripMat
        );
        grip.rotation.z = Math.PI / 2;
        grip.castShadow = true;
        grip.receiveShadow = true;
        bowGroup.add(grip);

        const string = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.86, 0.02),
            stringMat
        );
        string.rotation.z = Math.PI / 2;
        string.position.x = -0.01;
        bowGroup.add(string);

        const arrowMeshes = [-0.12, 0.12].map((offsetZ) => {
            const arrowGroup = new THREE.Group();
            const shaft = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.06, 0.84),
                arrowShaftMat
            );
            shaft.castShadow = true;
            shaft.receiveShadow = true;
            arrowGroup.add(shaft);

            const tip = new THREE.Mesh(
                new THREE.ConeGeometry(0.06, 0.16, 6),
                arrowTipMat
            );
            tip.rotation.x = Math.PI / 2;
            tip.position.z = 0.48;
            arrowGroup.add(tip);

            const feather = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.02, 0.14),
                arrowFeatherMat
            );
            feather.position.z = -0.36;
            arrowGroup.add(feather);

            arrowGroup.rotation.x = Math.PI / 2;
            arrowGroup.position.set(0.22, -0.05, offsetZ);
            bowGroup.add(arrowGroup);
            return arrowGroup;
        });

        bowGroup.position.set(
            Number(bowState?.position?.x) || 0,
            Number(bowState?.position?.y) || 0.28,
            Number(bowState?.position?.z) || 0
        );
        bowGroup.rotation.y = Math.random() * Math.PI * 2;
        bowGroup.userData.baseY = bowGroup.position.y;
        bowGroup.userData.floatSeed = Math.random() * Math.PI * 2;
        bowGroup.userData.arrowMeshes = arrowMeshes;
        this.mainGroup.add(bowGroup);
        this._updateBowPickupMarker(bowGroup, bowState);
        return bowGroup;
    }

    _updateBowPickupMarker(marker, bowState) {
        if (!marker) {
            return;
        }

        marker.position.set(
            Number(bowState?.position?.x) || 0,
            Number(bowState?.position?.y) || 0.28,
            Number(bowState?.position?.z) || 0
        );
        marker.userData.baseY = marker.position.y;

        const arrowsRemaining = Math.max(0, Math.trunc(Number(bowState?.arrowsRemaining) || 0));
        const arrowMeshes = Array.isArray(marker.userData.arrowMeshes) ? marker.userData.arrowMeshes : [];
        arrowMeshes.forEach((arrowMesh, index) => {
            arrowMesh.visible = index < arrowsRemaining;
        });
    }

    _disposeBowPickupMarker(marker) {
        if (!marker) {
            return;
        }

        marker.traverse((child) => {
            if (child.material) {
                child.material.dispose();
            }

            if (child.geometry) {
                child.geometry.dispose();
            }
        });
    }

    syncBowPickups(bowStates) {
        const activeIds = new Set();
        const nextBowStates = Array.isArray(bowStates) ? bowStates : [];

        nextBowStates.forEach((bowState) => {
            if (!bowState?.id) {
                return;
            }

            activeIds.add(bowState.id);

            if (!this.looseBows.has(bowState.id)) {
                this.looseBows.set(bowState.id, this._createBowPickupMarker(bowState));
                return;
            }

            this._updateBowPickupMarker(this.looseBows.get(bowState.id), bowState);
        });

        Array.from(this.looseBows.entries()).forEach(([bowId, marker]) => {
            if (activeIds.has(bowId)) {
                return;
            }

            this.mainGroup.remove(marker);
            this._disposeBowPickupMarker(marker);
            this.looseBows.delete(bowId);
        });
    }

    syncElevators(elevatorsStates) {
        this.towerElevatorsState = Array.isArray(elevatorsStates) ? elevatorsStates : [];
        this.towerElevatorsState.forEach((eState) => {
            if (this.towerElevatorCars && this.towerElevatorCars.has(eState.id)) {
                const car = this.towerElevatorCars.get(eState.id);
                // The logical elevator floor y matches the car group position y
                car.targetY = Number(eState.y) || 0;
            }
        });
    }

    _createArrowProjectileMarker(arrowState) {
        const arrowGroup = new THREE.Group();
        const shaftMat = new THREE.MeshLambertMaterial({ color: 0xd6a56c });
        const tipMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
        const featherMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });

        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.028, 0.94, 6),
            shaftMat
        );
        shaft.rotation.x = Math.PI / 2;
        shaft.castShadow = true;
        shaft.receiveShadow = true;
        arrowGroup.add(shaft);

        const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.07, 0.18, 6),
            tipMat
        );
        tip.rotation.x = -Math.PI / 2;
        tip.position.z = 0.53;
        arrowGroup.add(tip);

        const leftFeather = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.02, 0.12),
            featherMat
        );
        leftFeather.position.set(-0.05, 0.04, -0.35);
        leftFeather.rotation.z = Math.PI / 5;
        arrowGroup.add(leftFeather);

        const rightFeather = leftFeather.clone();
        rightFeather.position.x = 0.05;
        rightFeather.rotation.z = -Math.PI / 5;
        arrowGroup.add(rightFeather);

        arrowGroup.position.set(
            Number(arrowState?.position?.x) || 0,
            Number(arrowState?.position?.y) || 0,
            Number(arrowState?.position?.z) || 0
        );
        arrowGroup.rotation.y = Number(arrowState?.rotationY) || 0;
        arrowGroup.userData.targetPosition = new THREE.Vector3(
            Number(arrowState?.position?.x) || 0,
            Number(arrowState?.position?.y) || 0,
            Number(arrowState?.position?.z) || 0
        );
        arrowGroup.userData.targetRotationY = Number(arrowState?.rotationY) || 0;
        this.mainGroup.add(arrowGroup);
        return arrowGroup;
    }

    _disposeArrowProjectileMarker(marker) {
        if (!marker) {
            return;
        }

        marker.traverse((child) => {
            if (child.material) {
                child.material.dispose();
            }

            if (child.geometry) {
                child.geometry.dispose();
            }
        });
    }

    syncArrowProjectiles(arrowStates) {
        const activeIds = new Set();
        const nextArrowStates = Array.isArray(arrowStates) ? arrowStates : [];

        nextArrowStates.forEach((arrowState) => {
            if (!arrowState?.id) {
                return;
            }

            activeIds.add(arrowState.id);

            if (!this.arrowProjectiles.has(arrowState.id)) {
                this.arrowProjectiles.set(arrowState.id, this._createArrowProjectileMarker(arrowState));
                return;
            }

            const marker = this.arrowProjectiles.get(arrowState.id);
            marker.userData.targetPosition.set(
                Number(arrowState?.position?.x) || 0,
                Number(arrowState?.position?.y) || 0,
                Number(arrowState?.position?.z) || 0
            );
            marker.userData.targetRotationY = Number(arrowState?.rotationY) || 0;
        });

        Array.from(this.arrowProjectiles.entries()).forEach(([arrowId, marker]) => {
            if (activeIds.has(arrowId)) {
                return;
            }

            this.mainGroup.remove(marker);
            this._disposeArrowProjectileMarker(marker);
            this.arrowProjectiles.delete(arrowId);
        });
    }

    syncDroppedApples(appleStates) {
        const activeIds = new Set();
        const nextAppleStates = Array.isArray(appleStates) ? appleStates : [];

        nextAppleStates.forEach((appleState) => {
            if (!appleState?.id) {
                return;
            }

            activeIds.add(appleState.id);

            if (!this.looseApples.has(appleState.id)) {
                this.looseApples.set(appleState.id, this._createLooseAppleMarker(appleState));
                return;
            }

            const marker = this.looseApples.get(appleState.id);
            marker.position.set(
                Number(appleState?.position?.x) || 0,
                Number(appleState?.position?.y) || 0.22,
                Number(appleState?.position?.z) || 0
            );
            marker.userData.baseY = marker.position.y;
        });

        Array.from(this.looseApples.entries()).forEach(([appleId, marker]) => {
            if (activeIds.has(appleId)) {
                return;
            }

            this.mainGroup.remove(marker);
            this._disposeLooseAppleMarker(marker);
            this.looseApples.delete(appleId);
        });
    }

    syncTreeState(treeStates) {
        if (!Array.isArray(treeStates)) return;

        const remainingByTree = new Map(
            treeStates.map((treeState) => [
                treeState.id,
                Number.isFinite(treeState.applesRemaining) ? treeState.applesRemaining : 0,
            ])
        );

        this.trees.forEach((treeGroup, treeIndex) => {
            const treeId = treeGroup.userData.treeId;
            const applesRemaining = remainingByTree.get(treeId);
            if (!Number.isFinite(applesRemaining)) return;

            const treeApples = this.applesByTree.get(treeIndex) || [];
            treeApples.forEach((appleData, appleIndex) => {
                const isVisible = appleIndex < applesRemaining;
                appleData.collected = !isVisible;
                appleData.mesh.visible = isVisible;
                if (isVisible) {
                    appleData.mesh.scale.setScalar(1);
                }
            });
        });
    }

    syncGraves(graveStates) {
        if (!Array.isArray(graveStates)) return;

        const activeIds = new Set();

        graveStates.forEach((graveState) => {
            if (!graveState?.id) {
                return;
            }

            activeIds.add(graveState.id);

            if (!this.graves.has(graveState.id)) {
                this.graves.set(graveState.id, this._createGraveMarker(graveState));
                return;
            }

            const marker = this.graves.get(graveState.id);
            marker.position.set(
                Number(graveState?.position?.x) || 0,
                Number(graveState?.position?.y) || 0,
                Number(graveState?.position?.z) || 0
            );
            this._updateGraveNameplate(marker, graveState);
        });

        Array.from(this.graves.entries()).forEach(([graveId, marker]) => {
            if (activeIds.has(graveId)) {
                return;
            }

            this.mainGroup.remove(marker);
            this._disposeGraveMarker(marker);
            this.looseGraves?.delete(graveId); // Using optional chaining for safety
            this.graves.delete(graveId);
        });
    }

    getAvailableApplesNearPosition(pos, radius) {
        return this.apples.filter((appleData) => {
            if (appleData.collected) return false;
            const treePos = this.trees[appleData.treeIndex].position;
            const dist = pos.distanceTo(treePos);
            return dist < radius;
        });
    }

    destroy() {
        console.info('[World] Destroying game world via Main Group deep disposal...');
        
        // 1. Dispose Soccer Field explicitly if needed (though _deepDispose covers it)
        this._disposeSoccerField();

        // 2. Deep Dispose the entire Main Group (Ground, Sky, Trees, Apples, Graves, etc.)
        if (this.mainGroup) {
            this._deepDispose(this.mainGroup);
            if (this.scene) this.scene.remove(this.mainGroup);
        }

        // 3. Clear data collections
        this.trees = [];
        this.apples = [];
        this.applesByTree.clear();
        this.looseApples.clear();
        this.looseSwords.clear();
        this.looseBows.clear();
        this.arrowProjectiles.clear();
        this.graves.clear();

        this.mainGroup = null;
        this.scene = null;
    }
}
