function createInventorySystem({
  constants,
  helpers,
}) {
  const {
    ACTION_COOLDOWN_MS,
    ACTION_RADIUS,
    APPLE_REGROW_INTERVAL_MS,
    BOW_DEFAULT_ARROW_COUNT,
    BOW_DROP_DISTANCE,
    BOW_GROUND_OFFSET_Y,
    BOW_PICKUP_RADIUS,
    DRINK_AMOUNT,
    DRINK_SCORE_POINTS,
    DROPPED_APPLE_DROP_DISTANCE,
    DROPPED_APPLE_GROUND_Y,
    DROPPED_APPLE_PICKUP_RADIUS,
    EAT_FRUIT_SCORE_POINTS,
    FOOD_FROM_APPLE,
    MAX_FOOD,
    MAX_WATER,
    SWORD_DROP_DISTANCE,
    SWORD_GROUND_OFFSET_Y,
    SWORD_PICKUP_RADIUS,
    TOWER_ELEVATOR_COOLDOWN_MS,
  } = constants;

  const {
    buildPlayerLogContext,
    clamp,
    distanceBetween,
    getNearbyTowerElevator,
    resolveWalkablePosition,
  } = helpers;

  function performDrink(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!engine.isNearLake(actor.position)) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    actor.inventory.water = clamp(actor.inventory.water + DRINK_AMOUNT, 0, MAX_WATER);
    actor.status = 'acting';
    actor.currentAction = 'drink_water';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.awardActorScore(actor, DRINK_SCORE_POINTS);
    return true;
  }

  function performTowerElevatorRide(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    const nearbyElevator = getNearbyTowerElevator(engine.state.world, actor.position);
    if (!nearbyElevator) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const elevator = engine.state.world.elevators.find((e) => e.id === nearbyElevator.id);
    if (elevator && elevator.state === 'idle_top') {
      elevator.state = 'going_down';
    }

    actor.status = 'acting';
    actor.currentAction = 'ride_elevator';
    actor.actionCooldownUntil = Date.now() + TOWER_ELEVATOR_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `tower=${nearbyElevator.id}; triggered=true`,
    }));
    return true;
  }

  function getNearbyBowPickup(engine, position, maxDistance = BOW_PICKUP_RADIUS) {
    const bows = Array.isArray(engine.state.world?.bows)
      ? engine.state.world.bows
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

  function getNearbySwordPickup(engine, position, maxDistance = SWORD_PICKUP_RADIUS) {
    const swords = Array.isArray(engine.state.world?.swords)
      ? engine.state.world.swords
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

  function getNearbyDroppedApple(engine, position, maxDistance = DROPPED_APPLE_PICKUP_RADIUS) {
    const droppedApples = Array.isArray(engine.state.world?.droppedApples)
      ? engine.state.world.droppedApples
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

  function getNearbyFruitTree(engine, position) {
    let closestTree = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    engine.state.world.trees.forEach((tree) => {
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

  function getNearbyFruitPickupSource(engine, position) {
    const nearbyTree = getNearbyFruitTree(engine, position);
    const nearbyDroppedApple = getNearbyDroppedApple(engine, position);

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

  function buildDroppedApplePosition(engine, actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * DROPPED_APPLE_DROP_DISTANCE),
      y: DROPPED_APPLE_GROUND_Y,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * DROPPED_APPLE_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      engine.state.world,
      actor.position,
      desiredPosition,
      0.18,
    );

    return {
      x: resolvedPosition.x,
      y: DROPPED_APPLE_GROUND_Y,
      z: resolvedPosition.z,
    };
  }

  function buildDroppedBowPosition(engine, actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * BOW_DROP_DISTANCE),
      y: Number(actor?.position?.y) || 0,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * BOW_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      engine.state.world,
      actor.position,
      desiredPosition,
      0.2,
    );

    return {
      x: resolvedPosition.x,
      y: resolvedPosition.y + BOW_GROUND_OFFSET_Y,
      z: resolvedPosition.z,
    };
  }

  function buildDroppedSwordPosition(engine, actor) {
    const rotationY = Number(actor?.rotationY) || 0;
    const desiredPosition = {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * SWORD_DROP_DISTANCE),
      y: Number(actor?.position?.y) || 0,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * SWORD_DROP_DISTANCE),
    };
    const resolvedPosition = resolveWalkablePosition(
      engine.state.world,
      actor.position,
      desiredPosition,
      0.2,
    );

    return {
      x: resolvedPosition.x,
      y: resolvedPosition.y + SWORD_GROUND_OFFSET_Y,
      z: resolvedPosition.z,
    };
  }

  function dropSwordInventory(engine, actor) {
    if (!actor?.inventory?.hasSword) {
      return null;
    }

    const droppedSword = {
      id: `dropped-sword-${engine.state.nextDroppedSwordId}`,
      position: buildDroppedSwordPosition(engine, actor),
    };

    engine.state.nextDroppedSwordId += 1;
    engine.state.world.swords.push(droppedSword);
    actor.inventory.hasSword = false;
    return droppedSword;
  }

  function dropBowInventory(engine, actor) {
    if (!actor?.inventory?.hasBow) {
      return null;
    }

    const storedArrows = Math.max(0, Math.trunc(Number(actor.inventory.arrows) || 0));
    const droppedBow = {
      id: `dropped-bow-${engine.state.nextDroppedBowId}`,
      position: buildDroppedBowPosition(engine, actor),
      arrowsRemaining: storedArrows > 0 ? storedArrows : BOW_DEFAULT_ARROW_COUNT,
    };

    engine.state.nextDroppedBowId += 1;
    engine.state.world.bows.push(droppedBow);
    actor.inventory.hasBow = false;
    actor.inventory.arrows = 0;
    return droppedBow;
  }

  function performPickSword(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory?.hasSword || actor.inventory?.hasBow || (Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const nearbySword = getNearbySwordPickup(engine, actor.position);
    if (!nearbySword) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    engine.state.world.swords = (engine.state.world.swords || [])
      .filter((sword) => sword.id !== nearbySword.id);
    actor.inventory.hasSword = true;
    actor.status = 'acting';
    actor.currentAction = 'pick_sword';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `sword=${nearbySword.id}`,
    }));
    return true;
  }

  function performDropSword(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasSword) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedSword = dropSwordInventory(engine, actor);
    if (!droppedSword) {
      return false;
    }

    actor.status = 'acting';
    actor.currentAction = 'drop_sword';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `sword=${droppedSword.id}`,
    }));
    return true;
  }

  function performPickBow(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory?.hasBow || actor.inventory?.hasSword || (Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const nearbyBow = getNearbyBowPickup(engine, actor.position);
    if (!nearbyBow) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    engine.state.world.bows = (engine.state.world.bows || [])
      .filter((bow) => bow.id !== nearbyBow.id);
    actor.inventory.hasBow = true;
    actor.inventory.arrows = Math.max(1, Math.trunc(Number(nearbyBow.arrowsRemaining) || BOW_DEFAULT_ARROW_COUNT));
    actor.status = 'acting';
    actor.currentAction = 'pick_bow';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `bow=${nearbyBow.id}; arrows=${actor.inventory.arrows}`,
    }));
    return true;
  }

  function performDropBow(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasBow) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedBow = dropBowInventory(engine, actor);
    if (!droppedBow) {
      return false;
    }

    actor.status = 'acting';
    actor.currentAction = 'drop_bow';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `bow=${droppedBow.id}; arrows=${droppedBow.arrowsRemaining}`,
    }));
    return true;
  }

  function performPickFruit(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if ((Number(actor.inventory?.apples) || 0) > 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const pickupSource = getNearbyFruitPickupSource(engine, actor.position);

    if (!pickupSource) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
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
      engine.state.world.droppedApples = (engine.state.world.droppedApples || [])
        .filter((apple) => apple.id !== pickupSource.apple.id);
    }

    actor.inventory.apples += 1;
    actor.status = 'acting';
    actor.currentAction = 'pick_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    if (actor === engine.state.ai) {
      engine.rememberAiAction('pick_fruit');
    }

    return true;
  }

  function performDropFruit(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if ((Number(actor.inventory?.apples) || 0) <= 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const droppedApple = {
      id: `dropped-apple-${engine.state.nextDroppedAppleId}`,
      position: buildDroppedApplePosition(engine, actor),
    };
    engine.state.nextDroppedAppleId += 1;
    engine.state.world.droppedApples.push(droppedApple);
    actor.inventory.apples -= 1;
    actor.status = 'acting';
    actor.currentAction = 'drop_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, logContext);
    return true;
  }

  function performEatFruit(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (actor.inventory.apples <= 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    actor.inventory.apples -= 1;
    actor.inventory.food = clamp(actor.inventory.food + FOOD_FROM_APPLE, 0, MAX_FOOD);
    actor.status = 'acting';
    actor.currentAction = 'eat_fruit';
    actor.actionCooldownUntil = Date.now() + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    if (actor === engine.state.ai) {
      engine.rememberAiAction('eat_fruit');
    }

    engine.awardActorScore(actor, EAT_FRUIT_SCORE_POINTS);
    return true;
  }

  function getAvailableActions(engine, actor, now, { includeDrop = false } = {}) {
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
      && Boolean(getNearbySwordPickup(engine, actor.position));
    const canPickBow = weaponInteractionsEnabled
      && !hasHeldSword
      && !hasHeldBow
      && !hasHeldFruit
      && Boolean(getNearbyBowPickup(engine, actor.position));
    const canPickFruit = !hasHeldFruit
      && !hasHeldSword
      && !hasHeldBow
      && Boolean(getNearbyFruitPickupSource(engine, actor.position));
    const nearbyElevator = getNearbyTowerElevator(engine.state.world, actor.position);

    return {
      elevator_up: nearbyElevator?.direction === 'up' && canActNow,
      elevator_down: nearbyElevator?.direction === 'down' && canActNow,
      attack_sword: weaponInteractionsEnabled && hasHeldSword && canActNow,
      shoot_arrow: weaponInteractionsEnabled && hasHeldBow && heldArrows > 0 && canActNow,
      kick_ball: !hasHeldSword
        && !hasHeldBow
        && !engine.isSoccerRestartPaused(now)
        && engine.isNearSoccerBall(actor.position)
        && canActNow,
      drink_water: !hasHeldSword && !hasHeldBow && engine.isNearLake(actor.position) && canActNow,
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

  return Object.freeze({
    performDrink,
    performTowerElevatorRide,
    getNearbyBowPickup,
    getNearbySwordPickup,
    getNearbyDroppedApple,
    getNearbyFruitPickupSource,
    getNearbyFruitTree,
    buildDroppedApplePosition,
    buildDroppedBowPosition,
    buildDroppedSwordPosition,
    dropSwordInventory,
    dropBowInventory,
    performPickSword,
    performDropSword,
    performPickBow,
    performDropBow,
    performPickFruit,
    performDropFruit,
    performEatFruit,
    getAvailableActions,
  });
}

module.exports = {
  createInventorySystem,
};
