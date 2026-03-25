function createCombatSystem({
  constants,
  helpers,
}) {
  const {
    ACTION_COOLDOWN_MS,
    ACTOR_HIT_FLASH_DURATION_MS,
    ARROW_APPLE_DAMAGE,
    ARROW_FORWARD_OFFSET,
    ARROW_HIT_MAX_Y_OFFSET,
    ARROW_HIT_MIN_Y_OFFSET,
    ARROW_HIT_RADIUS,
    ARROW_PROJECTILE_LIFETIME_MS,
    ARROW_PROJECTILE_SPEED,
    ARROW_START_HEIGHT,
    ARROW_WATER_DAMAGE,
    MAX_WATER,
    PLAYER_COLLISION_RADIUS,
    SWORD_ATTACK_ARC_DOT_THRESHOLD,
    SWORD_ATTACK_LINE_PADDING,
    SWORD_ATTACK_RADIUS,
    SWORD_ATTACK_VERTICAL_TOLERANCE,
    SWORD_HIT_APPLE_DAMAGE,
    SWORD_HIT_WATER_DAMAGE,
    SWORD_KNOCKBACK_DISTANCE,
    SWORD_KNOCKBACK_STEP_DISTANCE,
  } = constants;

  const {
    buildPlayerLogContext,
    clamp,
    clonePoint,
    distanceBetween,
    formatLogDetailValue,
    getClosestPointOnSegment,
    isRouteSegmentClear,
    resolveWalkablePosition,
    roundNumber,
    sanitizeText,
  } = helpers;

  function getSwordAttackTarget(engine, actor) {
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

      if (!isRouteSegmentClear(engine.state.world, actor.position, target.position, SWORD_ATTACK_LINE_PADDING)) {
        return;
      }

      candidates.push({ target, distance, facingDot });
    };

    pushCandidate(engine.state.ai);
    engine.state.players.forEach((player) => {
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

  function applyHitResourceLoss(engine, target, {
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

  function applyActorKnockback(engine, target, sourceRotationY, distance = SWORD_KNOCKBACK_DISTANCE) {
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
        engine.state.world,
        currentPosition,
        {
          x: currentPosition.x + (directionX * currentStepDistance),
          y: currentPosition.y,
          z: currentPosition.z + (directionZ * currentStepDistance),
        },
        PLAYER_COLLISION_RADIUS,
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

  function performSwordAttack(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasSword) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const now = Date.now();
    const target = getSwordAttackTarget(engine, actor);
    actor.status = 'acting';
    actor.currentAction = 'attack_sword';
    actor.actionCooldownUntil = now + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    if (!target) {
      engine.logEvent(eventName, buildPlayerLogContext(actor, {
        userAgent: logContext?.userAgent || 'backend-game',
        details: 'result="miss"; target_id="-"; target_name="-"',
      }));
      return true;
    }

    const { applesLost, waterLost } = applyHitResourceLoss(engine, target, {
      hitType: 'sword',
      appleDamage: SWORD_HIT_APPLE_DAMAGE,
      waterDamage: SWORD_HIT_WATER_DAMAGE,
      now,
    });
    applyActorKnockback(engine, target, actor.rotationY, SWORD_KNOCKBACK_DISTANCE);

    if (target === engine.state.ai) {
      engine.clearMovement();
      engine.state.ai.status = 'idle';
      engine.state.ai.currentAction = 'wait';
      engine.state.nextDecisionAt = Math.max(engine.state.nextDecisionAt, now + 500);
    }

    if (target.actorType === 'ai') {
      engine.logEvent('ai_hit_by_sword', {
        userId: target.id,
        userName: target.name,
        userAgent: 'backend-ai',
        details: `attacker_id=${formatLogDetailValue(actor.id)}; attacker_name=${formatLogDetailValue(actor.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      });
    } else {
      engine.logEvent('player_hit_by_sword', buildPlayerLogContext(target, {
        details: `attacker_id=${formatLogDetailValue(actor.id)}; attacker_name=${formatLogDetailValue(actor.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      }));
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `target_id=${formatLogDetailValue(target.id)}; target_name=${formatLogDetailValue(target.name || 'Jogador')}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
    }));
    return true;
  }

  function performShootArrow(engine, actor, eventName, logContext, { clearMovement = false } = {}) {
    if (!actor || actor.status === 'dead') {
      return false;
    }

    if (!actor.inventory?.hasBow || (Number(actor.inventory?.arrows) || 0) <= 0) {
      if (actor === engine.state.ai) {
        engine.state.nextDecisionAt = Date.now() + 500;
      }
      return false;
    }

    const rotationY = Number(actor.rotationY) || 0;
    const directionX = Math.sin(rotationY);
    const directionZ = Math.cos(rotationY);
    const now = Date.now();

    engine.state.world.arrows.push({
      id: `arrow-${engine.state.nextArrowProjectileId}`,
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
    engine.state.nextArrowProjectileId += 1;
    actor.inventory.arrows = Math.max(0, Math.trunc(Number(actor.inventory.arrows) || 0) - 1);
    actor.status = 'acting';
    actor.currentAction = 'shoot_arrow';
    actor.actionCooldownUntil = now + ACTION_COOLDOWN_MS;

    if (clearMovement) {
      engine.clearMovement();
    }

    engine.logEvent(eventName, buildPlayerLogContext(actor, {
      userAgent: logContext?.userAgent || 'backend-game',
      details: `arrows_remaining=${actor.inventory.arrows}; rotation_y=${roundNumber(rotationY, 3)}`,
    }));
    return true;
  }

  function getArrowHitTarget(engine, ownerActorId, startPosition, endPosition) {
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

    considerActor(engine.state.ai);
    engine.state.players.forEach((player) => {
      considerActor(player);
    });

    return bestCandidate?.actor || null;
  }

  function applyArrowHit(engine, target, arrow, now) {
    if (!target || target.status === 'dead') {
      return false;
    }

    const { applesLost, waterLost } = applyHitResourceLoss(engine, target, {
      hitType: 'arrow',
      appleDamage: ARROW_APPLE_DAMAGE,
      waterDamage: ARROW_WATER_DAMAGE,
      now,
    });

    const shooter = engine.getActorById(arrow?.ownerActorId);
    const shooterName = shooter?.name || 'Alguem';
    const shooterId = shooter?.id || sanitizeText(arrow?.ownerActorId, 128) || 'unknown';

    if (target.actorType === 'ai') {
      engine.logEvent('ai_hit_by_arrow', {
        userId: target.id,
        userName: target.name,
        userAgent: 'backend-ai',
        details: `shooter_id=${formatLogDetailValue(shooterId)}; shooter_name=${formatLogDetailValue(shooterName)}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      });
    } else {
      engine.logEvent('player_hit_by_arrow', buildPlayerLogContext(target, {
        details: `shooter_id=${formatLogDetailValue(shooterId)}; shooter_name=${formatLogDetailValue(shooterName)}; apples_lost=${applesLost}; water_lost=${roundNumber(waterLost, 1)}`,
      }));
    }

    return true;
  }

  return Object.freeze({
    getSwordAttackTarget,
    applyHitResourceLoss,
    applyActorKnockback,
    performSwordAttack,
    performShootArrow,
    getArrowHitTarget,
    applyArrowHit,
  });
}

module.exports = {
  createCombatSystem,
};
