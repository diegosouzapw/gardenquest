const { getPool } = require('./postgres');

const WORLD_RUNTIME_BUS_CHANNEL = 'world_runtime_bus';
const WORLD_COMMAND_BUS_CHANNEL = 'world_command_bus';
const ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES = Object.freeze(['dead_letter', 'error']);

function normalizeCommandType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'unknown';
}

function normalizeActorType(value) {
  return value === 'agent' || value === 'ai' ? value : 'player';
}

function normalizeVisibility(value) {
  return value === 'private' ? 'private' : 'public';
}

function normalizePriority(value, commandType = 'unknown', actorType = 'player') {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return Math.max(1, Math.min(1000, parsed));
  }
  if (commandType === 'disconnect_player') return 160;
  if (commandType === 'player_command') return actorType === 'player' ? 120 : 90;
  if (commandType === 'touch_session') return 40;
  return 100;
}

function normalizeMaxAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.max(1, Math.min(25, parsed));
}

function mapRuntimeEventRow(row) {
  return {
    seq: Number(row.seq) || 0,
    realmId: row.realmId,
    eventType: row.eventType,
    visibility: row.visibility,
    actorId: row.actorId,
    actorType: row.actorType,
    snapshotVersion: Number(row.snapshotVersion) || 0,
    payloadJson: row.payloadJson || {},
    createdAt: row.createdAt,
  };
}


async function publishNotification(client, channel, payload = {}) {
  await client.query(
    `SELECT pg_notify($1, $2)`,
    [
      channel,
      JSON.stringify({
        ...(payload || {}),
        channel,
        emittedAt: new Date().toISOString(),
      }),
    ]
  );
}

async function ensureWorldRuntimeTables() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.world_runtime_snapshots (
      realm_id text PRIMARY KEY,
      snapshot_version bigint NOT NULL DEFAULT 0,
      snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.world_actor_runtime_snapshots (
      realm_id text NOT NULL,
      actor_id text NOT NULL,
      actor_type text NOT NULL,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      PRIMARY KEY (realm_id, actor_id)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_world_actor_runtime_snapshots_actor_type
    ON public.world_actor_runtime_snapshots (realm_id, actor_type, updated_at DESC)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.world_command_queue (
      id bigserial PRIMARY KEY,
      realm_id text NOT NULL,
      command_type text NOT NULL,
      actor_id text,
      actor_type text NOT NULL DEFAULT 'player',
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key text,
      priority integer NOT NULL DEFAULT 100,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      last_error_code text,
      status text NOT NULL DEFAULT 'pending',
      available_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      claimed_at timestamptz,
      claimed_by text,
      completed_at timestamptz,
      result_json jsonb
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_world_command_queue_pending
    ON public.world_command_queue (realm_id, status, available_at, created_at)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_world_command_queue_actor
    ON public.world_command_queue (realm_id, actor_id, created_at DESC)
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_world_command_queue_dedupe_pending
    ON public.world_command_queue (realm_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing')
  `);

  await db.query(`
    ALTER TABLE public.world_command_queue
    ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100
  `);

  await db.query(`
    ALTER TABLE public.world_command_queue
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0
  `);

  await db.query(`
    ALTER TABLE public.world_command_queue
    ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5
  `);

  await db.query(`
    ALTER TABLE public.world_command_queue
    ADD COLUMN IF NOT EXISTS last_error_code text
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.world_runtime_events (
      seq bigserial PRIMARY KEY,
      realm_id text NOT NULL,
      event_type text NOT NULL,
      visibility text NOT NULL DEFAULT 'public',
      actor_id text,
      actor_type text,
      snapshot_version bigint NOT NULL DEFAULT 0,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_world_runtime_events_realm_seq
    ON public.world_runtime_events (realm_id, seq DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_world_runtime_events_realm_created
    ON public.world_runtime_events (realm_id, created_at DESC)
  `);
}

async function upsertWorldRuntimeSnapshot({
  realmId,
  snapshotVersion = 0,
  snapshotJson = {},
  actorSnapshots = [],
  runtimeEvents = [],
}) {
  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO public.world_runtime_snapshots (
          realm_id,
          snapshot_version,
          snapshot_json,
          updated_at
        )
        VALUES ($1, $2, $3::jsonb, timezone('utc', now()))
        ON CONFLICT (realm_id)
        DO UPDATE SET
          snapshot_version = EXCLUDED.snapshot_version,
          snapshot_json = EXCLUDED.snapshot_json,
          updated_at = timezone('utc', now())
      `,
      [realmId, Math.max(0, Math.trunc(snapshotVersion) || 0), JSON.stringify(snapshotJson || {})]
    );

    if (Array.isArray(actorSnapshots) && actorSnapshots.length > 0) {
      for (const snapshot of actorSnapshots) {
        await client.query(
          `
            INSERT INTO public.world_actor_runtime_snapshots (
              realm_id,
              actor_id,
              actor_type,
              payload_json,
              updated_at
            )
            VALUES ($1, $2, $3, $4::jsonb, timezone('utc', now()))
            ON CONFLICT (realm_id, actor_id)
            DO UPDATE SET
              actor_type = EXCLUDED.actor_type,
              payload_json = EXCLUDED.payload_json,
              updated_at = timezone('utc', now())
          `,
          [
            realmId,
            String(snapshot.actorId || ''),
            normalizeActorType(snapshot.actorType),
            JSON.stringify(snapshot.payload || {}),
          ]
        );
      }
    }

    let latestEventSeq = 0;

    if (Array.isArray(runtimeEvents) && runtimeEvents.length > 0) {
      for (const runtimeEvent of runtimeEvents) {
        const insertedEvent = await client.query(
          `
            INSERT INTO public.world_runtime_events (
              realm_id,
              event_type,
              visibility,
              actor_id,
              actor_type,
              snapshot_version,
              payload_json,
              created_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7::jsonb,
              timezone('utc', now())
            )
            RETURNING seq
          `,
          [
            realmId,
            String(runtimeEvent.eventType || 'world_event').trim().toLowerCase(),
            normalizeVisibility(runtimeEvent.visibility),
            runtimeEvent.actorId || null,
            runtimeEvent.actorType ? normalizeActorType(runtimeEvent.actorType) : null,
            Math.max(0, Math.trunc(runtimeEvent.snapshotVersion || snapshotVersion) || 0),
            JSON.stringify(runtimeEvent.payloadJson || {}),
          ]
        );

        latestEventSeq = Math.max(latestEventSeq, Number(insertedEvent.rows[0]?.seq) || 0);
      }
    }

    await client.query(
      `
        DELETE FROM public.world_actor_runtime_snapshots
        WHERE realm_id = $1
          AND actor_type = 'player'
          AND updated_at < timezone('utc', now()) - interval '15 minutes'
      `,
      [realmId]
    );

    await client.query(
      `
        DELETE FROM public.world_runtime_events
        WHERE realm_id = $1
          AND created_at < timezone('utc', now()) - interval '2 hours'
      `,
      [realmId]
    );

    await publishNotification(client, WORLD_RUNTIME_BUS_CHANNEL, {
      kind: 'snapshot_flush',
      realmId,
      snapshotVersion: Math.max(0, Math.trunc(snapshotVersion) || 0),
      latestEventSeq,
      runtimeEventCount: Array.isArray(runtimeEvents) ? runtimeEvents.length : 0,
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getLatestWorldRuntimeSnapshot(realmId) {
  const result = await getPool().query(
    `
      SELECT
        realm_id AS "realmId",
        snapshot_version AS "snapshotVersion",
        snapshot_json AS "snapshotJson",
        updated_at AS "updatedAt"
      FROM public.world_runtime_snapshots
      WHERE realm_id = $1
      LIMIT 1
    `,
    [realmId]
  );

  if (result.rowCount < 1) {
    return null;
  }

  return result.rows[0];
}

async function getActorRuntimeSnapshot(realmId, actorId) {
  const result = await getPool().query(
    `
      SELECT
        realm_id AS "realmId",
        actor_id AS "actorId",
        actor_type AS "actorType",
        payload_json AS "payloadJson",
        updated_at AS "updatedAt"
      FROM public.world_actor_runtime_snapshots
      WHERE realm_id = $1 AND actor_id = $2
      LIMIT 1
    `,
    [realmId, String(actorId || '')]
  );

  if (result.rowCount < 1) {
    return null;
  }

  return result.rows[0];
}

async function listWorldRuntimeEvents({ realmId, sinceSeq = 0, limit = 100, visibility = 'public' }) {
  const normalizedLimit = Math.max(1, Math.min(250, Math.trunc(limit) || 100));
  const result = await getPool().query(
    `
      SELECT
        seq,
        realm_id AS "realmId",
        event_type AS "eventType",
        visibility,
        actor_id AS "actorId",
        actor_type AS "actorType",
        snapshot_version AS "snapshotVersion",
        payload_json AS "payloadJson",
        created_at AS "createdAt"
      FROM public.world_runtime_events
      WHERE realm_id = $1
        AND seq > $2
        AND ($3 = 'all' OR visibility = $3)
      ORDER BY seq ASC
      LIMIT $4
    `,
    [realmId, Math.max(0, Math.trunc(sinceSeq) || 0), visibility === 'all' ? 'all' : normalizeVisibility(visibility), normalizedLimit]
  );

  return result.rows.map(mapRuntimeEventRow);
}

async function getLatestWorldRuntimeEventSeq(realmId) {
  const result = await getPool().query(
    `
      SELECT COALESCE(MAX(seq), 0) AS seq
      FROM public.world_runtime_events
      WHERE realm_id = $1
    `,
    [realmId]
  );

  return Number(result.rows[0]?.seq) || 0;
}

async function enqueueWorldCommand({
  realmId,
  commandType,
  actorId = null,
  actorType = 'player',
  payloadJson = {},
  availableAt = null,
  dedupeKey = null,
  priority = null,
  maxAttempts = 5,
}) {
  const result = await getPool().query(
    `
      INSERT INTO public.world_command_queue (
        realm_id,
        command_type,
        actor_id,
        actor_type,
        payload_json,
        dedupe_key,
        priority,
        max_attempts,
        available_at,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6,
        $7,
        $8,
        COALESCE($9::timestamptz, timezone('utc', now())),
        'pending'
      )
      ON CONFLICT DO NOTHING
      RETURNING
        id,
        realm_id AS "realmId",
        command_type AS "commandType",
        actor_id AS "actorId",
        actor_type AS "actorType",
        payload_json AS "payloadJson",
        dedupe_key AS "dedupeKey",
        priority,
        attempts,
        max_attempts AS "maxAttempts",
        last_error_code AS "lastErrorCode",
        status,
        available_at AS "availableAt",
        created_at AS "createdAt"
    `,
    [
      realmId,
      normalizeCommandType(commandType),
      actorId,
      normalizeActorType(actorType),
      JSON.stringify(payloadJson || {}),
      dedupeKey,
      normalizePriority(priority, commandType, actorType),
      normalizeMaxAttempts(maxAttempts),
      availableAt,
    ]
  );

  const inserted = result.rows[0] || null;

  if (inserted) {
    await publishNotification(getPool(), WORLD_COMMAND_BUS_CHANNEL, {
      kind: 'command_enqueued',
      realmId,
      commandId: inserted.id,
      commandType: inserted.commandType,
      actorId: inserted.actorId,
      actorType: inserted.actorType,
      priority: inserted.priority,
    });
  }

  return inserted;
}

async function claimPendingWorldCommands({ realmId, claimedBy, limit = 50, staleAfterSeconds = 30 }) {
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const result = await getPool().query(
    `
      WITH claimable AS (
        SELECT id
        FROM public.world_command_queue
        WHERE realm_id = $1
          AND available_at <= timezone('utc', now())
          AND attempts < max_attempts
          AND (
            status = 'pending'
            OR (status = 'processing' AND claimed_at < timezone('utc', now()) - ($4::text || ' seconds')::interval)
          )
        ORDER BY priority DESC, available_at ASC, created_at ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.world_command_queue queue
      SET
        status = 'processing',
        claimed_by = $2,
        claimed_at = timezone('utc', now()),
        attempts = COALESCE(queue.attempts, 0) + 1
      WHERE queue.id IN (SELECT id FROM claimable)
      RETURNING
        queue.id,
        queue.realm_id AS "realmId",
        queue.command_type AS "commandType",
        queue.actor_id AS "actorId",
        queue.actor_type AS "actorType",
        queue.payload_json AS "payloadJson",
        queue.dedupe_key AS "dedupeKey",
        queue.priority,
        queue.attempts,
        queue.max_attempts AS "maxAttempts",
        queue.last_error_code AS "lastErrorCode",
        queue.status,
        queue.available_at AS "availableAt",
        queue.created_at AS "createdAt",
        queue.claimed_at AS "claimedAt",
        queue.claimed_by AS "claimedBy"
    `,
    [realmId, claimedBy, normalizedLimit, Math.max(5, Math.trunc(staleAfterSeconds) || 30)]
  );

  return result.rows;
}

async function completeWorldCommand({ id, claimedBy, status = 'done', resultJson = {} }) {
  await getPool().query(
    `
      UPDATE public.world_command_queue
      SET
        status = $3,
        completed_at = timezone('utc', now()),
        result_json = $4::jsonb
      WHERE id = $1
        AND claimed_by = $2
    `,
    [id, claimedBy, status === 'error' ? 'error' : 'done', JSON.stringify(resultJson || {})]
  );
}

async function requeueWorldCommand({ id, claimedBy, errorMessage = 'worker_error', errorCode = 'worker_error', delayMs = 1500 }) {
  const normalizedDelayMs = Math.max(250, Math.min(30000, Math.trunc(delayMs) || 1500));
  await getPool().query(
    `
      UPDATE public.world_command_queue
      SET
        status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
        available_at = timezone('utc', now()) + ($3::text || ' milliseconds')::interval,
        result_json = jsonb_build_object('error', $4, 'errorCode', $5, 'attempts', attempts, 'maxAttempts', max_attempts),
        last_error_code = $5,
        completed_at = CASE WHEN attempts >= max_attempts THEN timezone('utc', now()) ELSE NULL END,
        claimed_by = NULL,
        claimed_at = NULL
      WHERE id = $1
        AND claimed_by = $2
    `,
    [id, claimedBy, normalizedDelayMs, String(errorMessage || 'worker_error'), String(errorCode || 'worker_error')]
  );
}


async function listWorldCommandDeadLetters({ realmId, limit = 100 }) {
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 100));
  const result = await getPool().query(
    `
      SELECT
        id,
        realm_id AS "realmId",
        command_type AS "commandType",
        actor_id AS "actorId",
        actor_type AS "actorType",
        payload_json AS "payloadJson",
        dedupe_key AS "dedupeKey",
        priority,
        attempts,
        max_attempts AS "maxAttempts",
        last_error_code AS "lastErrorCode",
        status,
        available_at AS "availableAt",
        created_at AS "createdAt",
        claimed_at AS "claimedAt",
        claimed_by AS "claimedBy",
        completed_at AS "completedAt",
        result_json AS "resultJson"
      FROM public.world_command_queue
      WHERE realm_id = $1
        AND status IN ('dead_letter', 'error')
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT $2
    `,
    [realmId, normalizedLimit]
  );

  return result.rows;
}

async function retryWorldCommandAdmin({ id, realmId = null, delayMs = 0, resetAttempts = false }) {
  const normalizedDelayMs = Math.max(0, Math.min(30000, Math.trunc(delayMs) || 0));
  const result = await getPool().query(
    `
      UPDATE public.world_command_queue
      SET
        status = 'pending',
        available_at = timezone('utc', now()) + ($3::text || ' milliseconds')::interval,
        claimed_by = NULL,
        claimed_at = NULL,
        completed_at = NULL,
        result_json = NULL,
        last_error_code = NULL,
        attempts = CASE WHEN $4::boolean THEN 0 ELSE attempts END
      WHERE id = $1
        AND ($2::text IS NULL OR realm_id = $2)
        AND status = ANY($5::text[])
      RETURNING id, realm_id AS "realmId", status, attempts, max_attempts AS "maxAttempts"
    `,
    [id, realmId, normalizedDelayMs, Boolean(resetAttempts), ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES]
  );

  const row = result.rows[0] || null;
  if (row) {
    await publishNotification(getPool(), WORLD_COMMAND_BUS_CHANNEL, {
      kind: 'command_retried_admin',
      realmId: row.realmId,
      commandId: row.id,
    });
  }
  return row;
}

async function markWorldCommandDeadLetter({ id, realmId = null, reason = 'admin_dead_letter' }) {
  const result = await getPool().query(
    `
      UPDATE public.world_command_queue
      SET
        status = 'dead_letter',
        completed_at = timezone('utc', now()),
        claimed_by = NULL,
        claimed_at = NULL,
        last_error_code = COALESCE($3, last_error_code),
        result_json = COALESCE(result_json, '{}'::jsonb) || jsonb_build_object('forcedDeadLetter', true, 'reason', $3)
      WHERE id = $1
        AND ($2::text IS NULL OR realm_id = $2)
        AND status IN ('pending', 'processing', 'error')
      RETURNING id, realm_id AS "realmId", status, last_error_code AS "lastErrorCode"
    `,
    [id, realmId, String(reason || 'admin_dead_letter').slice(0, 120)]
  );
  return result.rows[0] || null;
}

async function getWorldCommandQueueOverview(realmId) {
  const result = await getPool().query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
        COUNT(*) FILTER (WHERE status = 'error') AS error_count,
        COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_count,
        COUNT(*) FILTER (WHERE status = 'done') AS done_count,
        COALESCE(MAX(priority), 0) AS max_priority,
        COALESCE(MAX(attempts), 0) AS max_attempts_seen
      FROM public.world_command_queue
      WHERE realm_id = $1
        AND created_at > timezone('utc', now()) - interval '24 hours'
    `,
    [realmId]
  );

  return {
    pendingCount: Number(result.rows[0]?.pending_count) || 0,
    processingCount: Number(result.rows[0]?.processing_count) || 0,
    errorCount: Number(result.rows[0]?.error_count) || 0,
    deadLetterCount: Number(result.rows[0]?.dead_letter_count) || 0,
    doneCount: Number(result.rows[0]?.done_count) || 0,
    maxPriority: Number(result.rows[0]?.max_priority) || 0,
    maxAttemptsSeen: Number(result.rows[0]?.max_attempts_seen) || 0,
  };
}

module.exports = {
  ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES,
  WORLD_COMMAND_BUS_CHANNEL,
  WORLD_RUNTIME_BUS_CHANNEL,
  claimPendingWorldCommands,
  completeWorldCommand,
  enqueueWorldCommand,
  ensureWorldRuntimeTables,
  getActorRuntimeSnapshot,
  getLatestWorldRuntimeEventSeq,
  getLatestWorldRuntimeSnapshot,
  getWorldCommandQueueOverview,
  listWorldCommandDeadLetters,
  listWorldRuntimeEvents,
  markWorldCommandDeadLetter,
  requeueWorldCommand,
  retryWorldCommandAdmin,
  upsertWorldRuntimeSnapshot,
};
