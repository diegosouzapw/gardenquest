function createPhysicsSystem({
  constants,
  helpers,
}) {
  const {
    ACTION_RADIUS,
    APPLE_REGROW_INTERVAL_MS,
    ARROW_PROJECTILE_RADIUS,
    PLAYER_COLLISION_RADIUS,
    SOCCER_BALL_ACTION_RADIUS,
    SOCCER_BALL_DRAG_PER_SECOND,
    SOCCER_BALL_MIN_SPEED,
    SOCCER_FIELD,
    SOCCER_GOAL_CELEBRATION_MS,
  } = constants;

  const {
    clamp,
    clonePoint,
    distanceBetween,
    getClosestPointOnSegment,
    getSoccerBallGroundPosition,
    getSoccerFieldMetrics,
    getSoccerGoalSideFromSegment,
    isRouteSegmentClear,
    roundNumber,
    sanitizeText,
  } = helpers;

  function isNearSoccerBall(engine, position) {
    const ballPosition = getSoccerBallGroundPosition(engine.state.world);
    return distanceBetween(position, ballPosition) <= SOCCER_BALL_ACTION_RADIUS;
  }

  function isSoccerRestartPaused(engine, now = Date.now()) {
    const restartAt = Number(engine.state.world?.soccer?.restartAt) || 0;
    return restartAt > now;
  }

  function clearSoccerBallPossession(engine) {
    const ball = engine.state.world?.soccer?.ball;
    if (!ball) {
      return;
    }

    ball.possessedByActorId = '';
    ball.possessedByActorName = '';
  }

  function clearSoccerBallPossessionIfHeldByActor(engine, actorId) {
    const normalizedActorId = sanitizeText(actorId, 128);
    const ball = engine.state.world?.soccer?.ball;
    if (!normalizedActorId || !ball) {
      return;
    }

    if (ball.possessedByActorId === normalizedActorId) {
      clearSoccerBallPossession(engine);
    }
  }

  function getActorById(engine, actorId) {
    const normalizedActorId = sanitizeText(actorId, 128);
    if (!normalizedActorId) {
      return null;
    }

    if (engine.state.ai?.id === normalizedActorId) {
      return engine.state.ai;
    }

    return engine.state.players.get(normalizedActorId) || null;
  }

  function getSoccerBallMagnetDistance(engine) {
    const radius = Number(engine.state.world?.soccer?.ball?.radius) || SOCCER_FIELD.ballRadius;
    return PLAYER_COLLISION_RADIUS + radius + 0.14;
  }

  function getSoccerBallAnchorPosition(engine, actor) {
    const radius = Number(engine.state.world?.soccer?.ball?.radius) || SOCCER_FIELD.ballRadius;
    const forwardOffset = PLAYER_COLLISION_RADIUS + radius + 0.12;
    const rotationY = Number(actor?.rotationY) || 0;

    return {
      x: (Number(actor?.position?.x) || 0) + (Math.sin(rotationY) * forwardOffset),
      y: radius,
      z: (Number(actor?.position?.z) || 0) + (Math.cos(rotationY) * forwardOffset),
    };
  }

  function setSoccerBallPossession(engine, actor) {
    if (!actor || actor.status === 'dead' || isSoccerRestartPaused(engine)) {
      return false;
    }

    const ball = engine.state.world?.soccer?.ball;
    if (!ball || ball.inGoal) {
      return false;
    }

    const anchorPosition = getSoccerBallAnchorPosition(engine, actor);
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

  function syncSoccerBallPossession(engine) {
    const ball = engine.state.world?.soccer?.ball;
    if (!ball?.possessedByActorId) {
      return false;
    }

    const holder = getActorById(engine, ball.possessedByActorId);
    if (!holder || holder.status === 'dead') {
      clearSoccerBallPossession(engine);
      return false;
    }

    const anchorPosition = getSoccerBallAnchorPosition(engine, holder);
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    ball.position.x = anchorPosition.x;
    ball.position.y = anchorPosition.y;
    ball.position.z = anchorPosition.z;
    ball.lastTouchedByActorId = holder.id;
    ball.lastTouchedByActorName = holder.name;
    clampPossessedSoccerBallInsideField(engine);
    return true;
  }

  function clampPossessedSoccerBallInsideField(engine) {
    const soccer = engine.state.world?.soccer;
    const ball = soccer?.ball;
    if (!soccer?.field || !ball?.possessedByActorId) {
      return false;
    }

    const metrics = getSoccerFieldMetrics(engine.state.world);
    ball.position.x = clamp(Number(ball.position.x) || 0, metrics.xMin, metrics.xMax);
    ball.position.y = ball.radius || metrics.radius;
    ball.position.z = clamp(Number(ball.position.z) || 0, metrics.zMin, metrics.zMax);
    ball.velocity.x = 0;
    ball.velocity.z = 0;
    return true;
  }

  function maybeRegisterSoccerGoalFromCarrierMovement(engine, actor, previousPosition, now) {
    if (!actor || actor.status === 'dead' || isSoccerRestartPaused(engine, now)) {
      return false;
    }

    const soccer = engine.state.world?.soccer;
    const ball = soccer?.ball;
    if (!soccer?.field || !ball || ball.possessedByActorId !== actor.id) {
      return false;
    }

    const metrics = getSoccerFieldMetrics(engine.state.world);
    const goalSide = getSoccerGoalSideFromSegment(previousPosition, actor.position, metrics);
    if (!goalSide) {
      return false;
    }

    const anchorPosition = getSoccerBallAnchorPosition(engine, actor);
    ball.position.x = anchorPosition.x;
    ball.position.y = anchorPosition.y;
    ball.position.z = anchorPosition.z;
    ball.lastTouchedByActorId = actor.id;
    ball.lastTouchedByActorName = actor.name;
    return registerSoccerGoal(engine, goalSide, now);
  }

  function tryMagnetizeSoccerBallToNearbyPlayer(engine) {
    const ball = engine.state.world?.soccer?.ball;
    if (!ball || ball.possessedByActorId) {
      return false;
    }

    const magnetDistance = getSoccerBallMagnetDistance(engine);
    let candidate = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const player of engine.state.players.values()) {
      if (!player || player.status === 'dead') {
        continue;
      }

      const distance = distanceBetween(player.position, ball.position);
      if (distance <= magnetDistance && distance < closestDistance) {
        candidate = player;
        closestDistance = distance;
      }
    }

    return candidate ? setSoccerBallPossession(engine, candidate) : false;
  }

  function bumpSoccerBallFromPlayer(engine, player, previousPosition) {
    if (!player || player.status === 'dead') {
      return;
    }

    const soccer = engine.state.world?.soccer;
    const ball = soccer?.ball;

    if (!soccer?.field || !ball || ball.inGoal || isSoccerRestartPaused(engine)) {
      return;
    }

    const moveDeltaX = player.position.x - (Number(previousPosition?.x) || 0);
    const moveDeltaZ = player.position.z - (Number(previousPosition?.z) || 0);
    const moveDistance = Math.sqrt((moveDeltaX * moveDeltaX) + (moveDeltaZ * moveDeltaZ));
    if (moveDistance <= 0.001) {
      return;
    }

    const touchDistance = getSoccerBallMagnetDistance(engine);
    const playerStart = {
      x: Number(previousPosition?.x) || 0,
      y: Number(previousPosition?.y) || Number(player.position?.y) || 0,
      z: Number(previousPosition?.z) || 0,
    };
    const closestPoint = getClosestPointOnSegment(playerStart, player.position, ball.position);
    const ballDeltaX = (Number(ball.position?.x) || 0) - closestPoint.x;
    const ballDeltaZ = (Number(ball.position?.z) || 0) - closestPoint.z;
    const distanceToBall = Math.sqrt((ballDeltaX * ballDeltaX) + (ballDeltaZ * ballDeltaZ));
    if (distanceToBall > touchDistance) {
      return;
    }

    setSoccerBallPossession(engine, player);
  }

  function isNearLake(engine, position) {
    const lakeEdgeDistance = distanceBetween(position, engine.state.world.lake.position);
    return lakeEdgeDistance < engine.state.world.lake.radius + ACTION_RADIUS;
  }

  function resetSoccerBall(engine) {
    const soccer = engine.state.world?.soccer;
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
    clearSoccerBallPossession(engine);
  }

  function registerSoccerGoal(engine, side, now) {
    const soccer = engine.state.world?.soccer;
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

    engine.logEvent('soccer_goal_scored', {
      userId: ball.lastTouchedByActorId || null,
      userName: ball.lastTouchedByActorName || 'Jogador',
      userAgent: 'backend-game',
      details: `side=${side}; x=${roundNumber(ball.position.x, 2)}; z=${roundNumber(ball.position.z, 2)}`,
    });

    soccer.restartAt = now + SOCCER_GOAL_CELEBRATION_MS;
    engine.persistSoccerGoalRecord(ball.lastTouchedByActorId, ball.lastTouchedByActorName);
    resetSoccerBall(engine);
    return true;
  }

  function advanceSoccerBall(engine, deltaSeconds, now) {
    const soccer = engine.state.world?.soccer;
    const ball = soccer?.ball;

    if (!soccer?.field || !ball) {
      return;
    }

    if (isSoccerRestartPaused(engine, now)) {
      resetSoccerBall(engine);
      return;
    }

    if ((Number(soccer.restartAt) || 0) > 0) {
      soccer.restartAt = 0;
    }

    if (syncSoccerBallPossession(engine)) {
      return;
    }

    const metrics = getSoccerFieldMetrics(engine.state.world);
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
        if (registerSoccerGoal(engine, 'north', now)) {
          return;
        }
      } else {
        ball.position.z = metrics.zMin;
        ball.velocity.z = Math.abs(ball.velocity.z || 0);
      }
    } else if (ball.position.z > metrics.zMax) {
      if (isInsideGoalMouth) {
        if (registerSoccerGoal(engine, 'south', now)) {
          return;
        }
      } else {
        ball.position.z = metrics.zMax;
        ball.velocity.z = -Math.abs(ball.velocity.z || 0);
      }
    }

    tryMagnetizeSoccerBallToNearbyPlayer(engine);
  }

  function advanceArrowProjectiles(engine, deltaSeconds, now) {
    if (!Array.isArray(engine.state.world?.arrows) || engine.state.world.arrows.length === 0) {
      return;
    }

    const nextArrows = [];

    engine.state.world.arrows.forEach((arrow) => {
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

      if (!isRouteSegmentClear(engine.state.world, arrow.position, nextPosition, ARROW_PROJECTILE_RADIUS)) {
        return;
      }

      const hitTarget = engine.getArrowHitTarget(arrow.ownerActorId, previousPosition, nextPosition);
      if (hitTarget) {
        engine.applyArrowHit(hitTarget, arrow, now);
        return;
      }

      arrow.position.x = nextPosition.x;
      arrow.position.y = nextPosition.y;
      arrow.position.z = nextPosition.z;
      arrow.rotationY = Math.atan2(velocityX, velocityZ);
      nextArrows.push(arrow);
    });

    engine.state.world.arrows = nextArrows;
  }

  function advanceTreeRegrowth(engine, now) {
    engine.state.world.trees.forEach((tree) => {
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

  return Object.freeze({
    isNearSoccerBall,
    isSoccerRestartPaused,
    clearSoccerBallPossession,
    clearSoccerBallPossessionIfHeldByActor,
    getActorById,
    getSoccerBallMagnetDistance,
    getSoccerBallAnchorPosition,
    setSoccerBallPossession,
    syncSoccerBallPossession,
    clampPossessedSoccerBallInsideField,
    maybeRegisterSoccerGoalFromCarrierMovement,
    tryMagnetizeSoccerBallToNearbyPlayer,
    bumpSoccerBallFromPlayer,
    isNearLake,
    resetSoccerBall,
    registerSoccerGoal,
    advanceSoccerBall,
    advanceArrowProjectiles,
    advanceTreeRegrowth,
  });
}

module.exports = {
  createPhysicsSystem,
};
