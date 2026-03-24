const { getPool } = require('./postgres');

function normalizeCommandType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'unknown';
}

function normalizeActorType(value) {
  return value === 'agent' || value === 'ai' ? value : 'player';
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
}

async function upsertWorldRuntimeSnapshot({ realmId, snapshotVersion = 0, snapshotJson = {}, actorSnapshots = [] }) {
  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.world_runtime_snapshots (realm_id, snapshot_version, snapshot_json, updated_at)
       VALUES ($1, $2, $3::jsonb, timezone('utc', now()))
       ON CONFLICT (realm_id) DO UPDATE SET
         snapshot_version = EXCLUDED.snapshot_version,
         snapshot_json = EXCLUDED.snapshot_json,
         updated_at = timezone('utc', now())`,
      [realmId, Math.max(0, Math.trunc(snapshotVersion) || 0), JSON.stringify(snapshotJson || {})]
    );

    if (Array.isArray(actorSnapshots) && actorSnapshots.length > 0) {
      for (const snapshot of actorSnapshots) {
        await client.query(
          `INSERT INTO public.world_actor_runtime_snapshots (realm_id, actor_id, actor_type, payload_json, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, timezone('utc', now()))
           ON CONFLICT (realm_id, actor_id) DO UPDATE SET
             actor_type = EXCLUDED.actor_type,
             payload_json = EXCLUDED.payload_json,
             updated_at = timezone('utc', now())`,
          [realmId, String(snapshot.actorId || ''), normalizeActorType(snapshot.actorType), JSON.stringify(snapshot.payload || {})]
        );
      }
    }

    await client.query(
      `DELETE FROM public.world_actor_runtime_snapshots WHERE realm_id = $1 AND actor_type = 'player' AND updated_at < timezone('utc', now()) - interval '15 minutes'`,
      [realmId]
    );
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
    `SELECT realm_id AS "realmId", snapshot_version AS "snapshotVersion", snapshot_json AS "snapshotJson", updated_at AS "updatedAt"
     FROM public.world_runtime_snapshots WHERE realm_id = $1 LIMIT 1`,
    [realmId]
  );
  return result.rows[0] || null;
}

async function getActorRuntimeSnapshot(realmId, actorId) {
  const result = await getPool().query(
    `SELECT realm_id AS "realmId", actor_id AS "actorId", actor_type AS "actorType", payload_json AS "payloadJson", updated_at AS "updatedAt"
     FROM public.world_actor_runtime_snapshots WHERE realm_id = $1 AND actor_id = $2 LIMIT 1`,
    [realmId, String(actorId || '')]
  );
  return result.rows[0] || null;
}

async function enqueueWorldCommand({ realmId, commandType, actorId = null, actorType = 'player', payloadJson = {}, availableAt = null, dedupeKey = null }) {
  const result = await getPool().query(
    `INSERT INTO public.world_command_queue (realm_id, command_type, actor_id, actor_type, payload_json, dedupe_key, available_at, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7::timestamptz, timezone('utc', now())), 'pending')
     ON CONFLICT DO NOTHING
     RETURNING id, realm_id AS "realmId", command_type AS "commandType", actor_id AS "actorId", actor_type AS "actorType", payload_json AS "payloadJson", dedupe_key AS "dedupeKey", status, available_at AS "availableAt", created_at AS "createdAt"`,
    [realmId, normalizeCommandType(commandType), actorId, normalizeActorType(actorType), JSON.stringify(payloadJson || {}), dedupeKey, availableAt]
  );
  return result.rows[0] || null;
}

async function claimPendingWorldCommands({ realmId, claimedBy, limit = 50, staleAfterSeconds = 30 }) {
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const result = await getPool().query(
    `WITH claimable AS (
       SELECT id FROM public.world_command_queue
       WHERE realm_id = $1 AND available_at <= timezone('utc', now())
         AND (status = 'pending' OR (status = 'processing' AND claimed_at < timezone('utc', now()) - ($4::text || ' seconds')::interval))
       ORDER BY created_at ASC LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE public.world_command_queue queue
     SET status = 'processing', claimed_by = $2, claimed_at = timezone('utc', now())
     WHERE queue.id IN (SELECT id FROM claimable)
     RETURNING queue.id, queue.realm_id AS "realmId", queue.command_type AS "commandType", queue.actor_id AS "actorId", queue.actor_type AS "actorType", queue.payload_json AS "payloadJson", queue.dedupe_key AS "dedupeKey", queue.status, queue.available_at AS "availableAt", queue.created_at AS "createdAt", queue.claimed_at AS "claimedAt", queue.claimed_by AS "claimedBy"`,
    [realmId, claimedBy, normalizedLimit, Math.max(5, Math.trunc(staleAfterSeconds) || 30)]
  );
  return result.rows;
}

async function completeWorldCommand({ id, claimedBy, status = 'done', resultJson = {} }) {
  await getPool().query(
    `UPDATE public.world_command_queue SET status = $3, completed_at = timezone('utc', now()), result_json = $4::jsonb WHERE id = $1 AND claimed_by = $2`,
    [id, claimedBy, status === 'error' ? 'error' : 'done', JSON.stringify(resultJson || {})]
  );
}

async function requeueWorldCommand({ id, claimedBy, errorMessage = 'worker_error', delayMs = 1500 }) {
  const normalizedDelayMs = Math.max(250, Math.min(30000, Math.trunc(delayMs) || 1500));
  await getPool().query(
    `UPDATE public.world_command_queue SET status = 'pending', available_at = timezone('utc', now()) + ($3::text || ' milliseconds')::interval, result_json = jsonb_build_object('error', $4), claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2`,
    [id, claimedBy, normalizedDelayMs, String(errorMessage || 'worker_error')]
  );
}

module.exports = {
  claimPendingWorldCommands,
  completeWorldCommand,
  enqueueWorldCommand,
  ensureWorldRuntimeTables,
  getActorRuntimeSnapshot,
  getLatestWorldRuntimeSnapshot,
  requeueWorldCommand,
  upsertWorldRuntimeSnapshot,
};
