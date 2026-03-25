const { getPool } = require('./postgres');

function normalizeMode(mode) {
  return ['hosted_api_key', 'remote_endpoint', 'server_managed'].includes(mode) ? mode : 'hosted_api_key';
}

function normalizeStatus(status) {
  return ['active', 'paused', 'revoked', 'error', 'quarantined'].includes(status) ? status : 'active';
}

function normalizeProvider(provider) {
  return String(provider || 'openai').trim().toLowerCase();
}

function normalizeDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 10);
}

async function ensureAgentTables() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agents (
      id text PRIMARY KEY,
      owner_user_id text NOT NULL,
      name text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('hosted_api_key', 'remote_endpoint', 'server_managed')),
      provider text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked', 'error', 'quarantined')),
      route_hint text,
      policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS policy_json jsonb NOT NULL DEFAULT '{}'::jsonb
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agent_secrets (
      id bigserial PRIMARY KEY,
      agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
      payload text NOT NULL,
      fingerprint text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      rotated_at timestamptz
    )
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_secrets_agent_id
    ON public.agent_secrets (agent_id)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agent_endpoints (
      id bigserial PRIMARY KEY,
      agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
      base_url text NOT NULL,
      auth_mode text NOT NULL DEFAULT 'none',
      auth_secret text,
      auth_secret_payload text,
      auth_secret_fingerprint text,
      timeout_ms integer NOT NULL DEFAULT 2500,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_endpoints_agent_id
    ON public.agent_endpoints (agent_id)
  `);

  await db.query(`
    ALTER TABLE public.agent_endpoints
    ADD COLUMN IF NOT EXISTS auth_secret_payload text
  `);

  await db.query(`
    ALTER TABLE public.agent_endpoints
    ADD COLUMN IF NOT EXISTS auth_secret_fingerprint text
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agent_runs (
      id bigserial PRIMARY KEY,
      agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
      status text NOT NULL,
      error_code text,
      latency_ms integer,
      provider_mode text,
      provider_name text,
      estimated_input_tokens integer,
      estimated_output_tokens integer,
      count_towards_budget boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    ALTER TABLE public.agent_runs
    ADD COLUMN IF NOT EXISTS estimated_input_tokens integer
  `);
  await db.query(`
    ALTER TABLE public.agent_runs
    ADD COLUMN IF NOT EXISTS estimated_output_tokens integer
  `);
  await db.query(`
    ALTER TABLE public.agent_runs
    ADD COLUMN IF NOT EXISTS count_towards_budget boolean NOT NULL DEFAULT true
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agent_usage_daily (
      agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
      usage_date date NOT NULL,
      run_count integer NOT NULL DEFAULT 0,
      success_count integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      blocked_count integer NOT NULL DEFAULT 0,
      total_latency_ms bigint NOT NULL DEFAULT 0,
      estimated_input_tokens bigint NOT NULL DEFAULT 0,
      estimated_output_tokens bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      PRIMARY KEY (agent_id, usage_date)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.agent_endpoint_health (
      agent_id text PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
      failure_count integer NOT NULL DEFAULT 0,
      suspicious_count integer NOT NULL DEFAULT 0,
      last_error_code text,
      last_reason text,
      quarantined_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_endpoint_health_quarantined
    ON public.agent_endpoint_health (quarantined_until DESC, updated_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
    ON public.agent_runs (agent_id, created_at DESC)
  `);
}

async function createAgent({ id, ownerUserId, name, mode, provider, routeHint = null, policyJson = {} }) {
  const db = getPool();
  const result = await db.query(
    `
      INSERT INTO public.agents (
        id, owner_user_id, name, mode, provider, status, route_hint, policy_json, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb, timezone('utc', now()))
      RETURNING id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
    `,
    [id, ownerUserId, name, normalizeMode(mode), normalizeProvider(provider), routeHint, JSON.stringify(policyJson || {})]
  );
  return result.rows[0];
}

async function listAgentsByOwner(ownerUserId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        a.id,
        a.owner_user_id AS "ownerUserId",
        a.name,
        a.mode,
        a.provider,
        a.status,
        a.route_hint AS "routeHint",
        a.policy_json AS "policyJson",
        a.created_at AS "createdAt",
        a.updated_at AS "updatedAt",
        COALESCE(u.run_count, 0) AS "todayRunCount",
        COALESCE(u.success_count, 0) AS "todaySuccessCount",
        COALESCE(u.error_count, 0) AS "todayErrorCount",
        COALESCE(u.blocked_count, 0) AS "todayBlockedCount",
        COALESCE(u.estimated_input_tokens, 0) AS "todayEstimatedInputTokens",
        COALESCE(u.estimated_output_tokens, 0) AS "todayEstimatedOutputTokens",
        h.failure_count AS "endpointFailureCount",
        h.suspicious_count AS "endpointSuspiciousCount",
        h.last_error_code AS "endpointLastErrorCode",
        h.last_reason AS "endpointLastReason",
        h.quarantined_until AS "endpointQuarantinedUntil"
      FROM public.agents a
      LEFT JOIN public.agent_usage_daily u
        ON u.agent_id = a.id AND u.usage_date = timezone('utc', now())::date
      LEFT JOIN public.agent_endpoint_health h
        ON h.agent_id = a.id
      WHERE a.owner_user_id = $1
      ORDER BY a.created_at DESC
    `,
    [ownerUserId]
  );
  return result.rows;
}

async function getAgentById(agentId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.agents
      WHERE id = $1
      LIMIT 1
    `,
    [agentId]
  );
  return result.rows[0] || null;
}

async function getAgentByIdForOwner(agentId, ownerUserId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.agents
      WHERE id = $1 AND owner_user_id = $2
      LIMIT 1
    `,
    [agentId, ownerUserId]
  );
  return result.rows[0] || null;
}

async function updateAgentPolicy({ agentId, ownerUserId, policyJson }) {
  const db = getPool();
  const result = await db.query(
    `
      UPDATE public.agents
      SET policy_json = $3::jsonb, updated_at = timezone('utc', now())
      WHERE id = $1 AND owner_user_id = $2
      RETURNING id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
    `,
    [agentId, ownerUserId, JSON.stringify(policyJson || {})]
  );
  return result.rows[0] || null;
}

async function saveAgentSecret({ agentId, payload, fingerprint }) {
  const db = getPool();
  await db.query(
    `
      INSERT INTO public.agent_secrets (agent_id, payload, fingerprint, rotated_at)
      VALUES ($1, $2, $3, timezone('utc', now()))
      ON CONFLICT (agent_id)
      DO UPDATE SET payload = EXCLUDED.payload, fingerprint = EXCLUDED.fingerprint, rotated_at = timezone('utc', now())
    `,
    [agentId, payload, fingerprint]
  );
}

async function getAgentSecret(agentId) {
  const db = getPool();
  const result = await db.query(
    `SELECT agent_id AS "agentId", payload, fingerprint, rotated_at AS "rotatedAt" FROM public.agent_secrets WHERE agent_id = $1 LIMIT 1`,
    [agentId]
  );
  return result.rows[0] || null;
}

async function saveAgentEndpoint({
  agentId,
  baseUrl,
  authMode = 'none',
  authSecretPayload = null,
  authSecretFingerprint = null,
  timeoutMs = 2500,
}) {
  const db = getPool();
  await db.query(
    `
      INSERT INTO public.agent_endpoints (
        agent_id,
        base_url,
        auth_mode,
        auth_secret,
        auth_secret_payload,
        auth_secret_fingerprint,
        timeout_ms,
        updated_at
      )
      VALUES ($1, $2, $3, NULL, $4, $5, $6, timezone('utc', now()))
      ON CONFLICT (agent_id)
      DO UPDATE SET
        base_url = EXCLUDED.base_url,
        auth_mode = EXCLUDED.auth_mode,
        auth_secret = NULL,
        auth_secret_payload = EXCLUDED.auth_secret_payload,
        auth_secret_fingerprint = EXCLUDED.auth_secret_fingerprint,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = timezone('utc', now())
    `,
    [
      agentId,
      baseUrl,
      authMode,
      authSecretPayload,
      authSecretFingerprint,
      Math.max(500, Math.trunc(timeoutMs || 2500)),
    ]
  );
}

async function getAgentEndpointByAgentId(agentId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        agent_id AS "agentId",
        base_url AS "baseUrl",
        auth_mode AS "authMode",
        auth_secret AS "authSecret",
        auth_secret_payload AS "authSecretPayload",
        auth_secret_fingerprint AS "authSecretFingerprint",
        timeout_ms AS "timeoutMs"
      FROM public.agent_endpoints
      WHERE agent_id = $1
      LIMIT 1
    `,
    [agentId]
  );
  return result.rows[0] || null;
}

async function listRunnableAgents(limit = 16) {
  const db = getPool();
  const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 16));
  const result = await db.query(
    `
      SELECT
        a.id,
        a.owner_user_id AS "ownerUserId",
        a.name,
        a.mode,
        a.provider,
        a.status,
        a.route_hint AS "routeHint",
        a.policy_json AS "policyJson",
        a.created_at AS "createdAt",
        a.updated_at AS "updatedAt",
        (s.agent_id IS NOT NULL) AS "hasSecret",
        (e.agent_id IS NOT NULL) AS "hasEndpoint",
        h.quarantined_until AS "endpointQuarantinedUntil"
      FROM public.agents a
      LEFT JOIN public.agent_secrets s ON s.agent_id = a.id
      LEFT JOIN public.agent_endpoints e ON e.agent_id = a.id
      LEFT JOIN public.agent_endpoint_health h ON h.agent_id = a.id
      WHERE a.status = 'active'
        AND a.mode IN ('hosted_api_key', 'remote_endpoint')
        AND (
          (a.mode = 'hosted_api_key' AND s.agent_id IS NOT NULL)
          OR (a.mode = 'remote_endpoint' AND e.agent_id IS NOT NULL)
        )
        AND (h.quarantined_until IS NULL OR h.quarantined_until <= timezone('utc', now()))
      ORDER BY a.updated_at DESC, a.created_at ASC
      LIMIT $1
    `,
    [normalizedLimit]
  );
  return result.rows;
}

async function listAllActiveAgents() {
  const db = getPool();
  const result = await db.query(
    `
      SELECT id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.agents
      WHERE status = 'active'
      ORDER BY created_at ASC
    `
  );
  return result.rows;
}

async function listAgentRunsByOwner({ ownerUserId, agentId, limit = 50 }) {
  const db = getPool();
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const result = await db.query(
    `
      SELECT
        r.id,
        r.agent_id AS "agentId",
        r.status,
        r.error_code AS "errorCode",
        r.latency_ms AS "latencyMs",
        r.provider_mode AS "providerMode",
        r.provider_name AS "providerName",
        r.estimated_input_tokens AS "estimatedInputTokens",
        r.estimated_output_tokens AS "estimatedOutputTokens",
        r.count_towards_budget AS "countTowardsBudget",
        r.created_at AS "createdAt"
      FROM public.agent_runs r
      INNER JOIN public.agents a ON a.id = r.agent_id
      WHERE a.owner_user_id = $1 AND a.id = $2
      ORDER BY r.created_at DESC
      LIMIT $3
    `,
    [ownerUserId, agentId, normalizedLimit]
  );
  return result.rows;
}

async function getAgentDailyUsage(agentId, usageDate = new Date()) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT agent_id AS "agentId", usage_date AS "usageDate", run_count AS "runCount", success_count AS "successCount", error_count AS "errorCount", blocked_count AS "blockedCount", total_latency_ms AS "totalLatencyMs", estimated_input_tokens AS "estimatedInputTokens", estimated_output_tokens AS "estimatedOutputTokens", updated_at AS "updatedAt"
      FROM public.agent_usage_daily
      WHERE agent_id = $1 AND usage_date = $2::date
      LIMIT 1
    `,
    [agentId, normalizeDateKey(usageDate)]
  );
  return result.rows[0] || null;
}

async function updateAgentStatus({ agentId, ownerUserId, status }) {
  const db = getPool();
  const result = await db.query(
    `
      UPDATE public.agents
      SET status = $3, updated_at = timezone('utc', now())
      WHERE id = $1 AND owner_user_id = $2
      RETURNING id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
    `,
    [agentId, ownerUserId, normalizeStatus(status)]
  );
  return result.rows[0] || null;
}

async function updateAgentStatusAdmin({ agentId, status }) {
  const db = getPool();
  const result = await db.query(
    `
      UPDATE public.agents
      SET status = $2, updated_at = timezone('utc', now())
      WHERE id = $1
      RETURNING id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
    `,
    [agentId, normalizeStatus(status)]
  );
  return result.rows[0] || null;
}

async function recordAgentRun({
  agentId,
  status,
  errorCode = null,
  latencyMs = null,
  providerMode = null,
  providerName = null,
  estimatedInputTokens = null,
  estimatedOutputTokens = null,
  countTowardsBudget = true,
}) {
  const db = getPool();
  const normalizedLatencyMs = Math.max(0, Math.trunc(latencyMs || 0));
  const normalizedInputTokens = Math.max(0, Math.trunc(estimatedInputTokens || 0));
  const normalizedOutputTokens = Math.max(0, Math.trunc(estimatedOutputTokens || 0));
  const normalizedCountTowardsBudget = Boolean(countTowardsBudget);

  await db.query(
    `
      INSERT INTO public.agent_runs (agent_id, status, error_code, latency_ms, provider_mode, provider_name, estimated_input_tokens, estimated_output_tokens, count_towards_budget)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [agentId, status, errorCode, normalizedLatencyMs || null, providerMode, providerName, normalizedInputTokens || null, normalizedOutputTokens || null, normalizedCountTowardsBudget]
  );

  const isSuccess = status === 'success';
  const isBlocked = status === 'blocked';
  const isCounted = normalizedCountTowardsBudget;

  await db.query(
    `
      INSERT INTO public.agent_usage_daily (
        agent_id, usage_date, run_count, success_count, error_count, blocked_count, total_latency_ms, estimated_input_tokens, estimated_output_tokens, updated_at
      )
      VALUES (
        $1,
        timezone('utc', now())::date,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        timezone('utc', now())
      )
      ON CONFLICT (agent_id, usage_date)
      DO UPDATE SET
        run_count = public.agent_usage_daily.run_count + EXCLUDED.run_count,
        success_count = public.agent_usage_daily.success_count + EXCLUDED.success_count,
        error_count = public.agent_usage_daily.error_count + EXCLUDED.error_count,
        blocked_count = public.agent_usage_daily.blocked_count + EXCLUDED.blocked_count,
        total_latency_ms = public.agent_usage_daily.total_latency_ms + EXCLUDED.total_latency_ms,
        estimated_input_tokens = public.agent_usage_daily.estimated_input_tokens + EXCLUDED.estimated_input_tokens,
        estimated_output_tokens = public.agent_usage_daily.estimated_output_tokens + EXCLUDED.estimated_output_tokens,
        updated_at = timezone('utc', now())
    `,
    [
      agentId,
      isCounted ? 1 : 0,
      (isSuccess && isCounted) ? 1 : 0,
      (!isSuccess && !isBlocked && isCounted) ? 1 : 0,
      isBlocked ? 1 : 0,
      normalizedLatencyMs,
      normalizedInputTokens,
      normalizedOutputTokens,
    ]
  );
}

async function getAgentEndpointHealthByAgentId(agentId) {
  const result = await getPool().query(
    `
      SELECT agent_id AS "agentId", failure_count AS "failureCount", suspicious_count AS "suspiciousCount", last_error_code AS "lastErrorCode", last_reason AS "lastReason", quarantined_until AS "quarantinedUntil", updated_at AS "updatedAt"
      FROM public.agent_endpoint_health
      WHERE agent_id = $1
      LIMIT 1
    `,
    [agentId]
  );
  return result.rows[0] || null;
}

async function recordAgentEndpointFailure({ agentId, errorCode = 'remote_error', quarantineThreshold = 6, quarantineMs = 900000 }) {
  const db = getPool();
  const result = await db.query(
    `
      INSERT INTO public.agent_endpoint_health (agent_id, failure_count, suspicious_count, last_error_code, last_reason, quarantined_until, updated_at)
      VALUES (
        $1,
        1,
        0,
        $2,
        $2,
        CASE WHEN 1 >= $3 THEN timezone('utc', now()) + ($4::text || ' milliseconds')::interval ELSE NULL END,
        timezone('utc', now())
      )
      ON CONFLICT (agent_id)
      DO UPDATE SET
        failure_count = public.agent_endpoint_health.failure_count + 1,
        last_error_code = EXCLUDED.last_error_code,
        last_reason = EXCLUDED.last_reason,
        quarantined_until = CASE
          WHEN public.agent_endpoint_health.failure_count + 1 >= $3
          THEN timezone('utc', now()) + ($4::text || ' milliseconds')::interval
          ELSE public.agent_endpoint_health.quarantined_until
        END,
        updated_at = timezone('utc', now())
      RETURNING agent_id AS "agentId", failure_count AS "failureCount", suspicious_count AS "suspiciousCount", last_error_code AS "lastErrorCode", last_reason AS "lastReason", quarantined_until AS "quarantinedUntil", updated_at AS "updatedAt"
    `,
    [agentId, String(errorCode || 'remote_error'), Math.max(1, Math.trunc(quarantineThreshold) || 6), Math.max(1000, Math.trunc(quarantineMs) || 900000)]
  );
  return result.rows[0] || null;
}

async function recordAgentEndpointSuspicion({ agentId, reason = 'moderation_flag', quarantineThreshold = 2, quarantineMs = 900000 }) {
  const db = getPool();
  const result = await db.query(
    `
      INSERT INTO public.agent_endpoint_health (agent_id, failure_count, suspicious_count, last_error_code, last_reason, quarantined_until, updated_at)
      VALUES (
        $1,
        0,
        1,
        'suspicious_response',
        $2,
        CASE WHEN 1 >= $3 THEN timezone('utc', now()) + ($4::text || ' milliseconds')::interval ELSE NULL END,
        timezone('utc', now())
      )
      ON CONFLICT (agent_id)
      DO UPDATE SET
        suspicious_count = public.agent_endpoint_health.suspicious_count + 1,
        last_error_code = 'suspicious_response',
        last_reason = EXCLUDED.last_reason,
        quarantined_until = CASE
          WHEN public.agent_endpoint_health.suspicious_count + 1 >= $3
          THEN timezone('utc', now()) + ($4::text || ' milliseconds')::interval
          ELSE public.agent_endpoint_health.quarantined_until
        END,
        updated_at = timezone('utc', now())
      RETURNING agent_id AS "agentId", failure_count AS "failureCount", suspicious_count AS "suspiciousCount", last_error_code AS "lastErrorCode", last_reason AS "lastReason", quarantined_until AS "quarantinedUntil", updated_at AS "updatedAt"
    `,
    [agentId, String(reason || 'moderation_flag').slice(0, 255), Math.max(1, Math.trunc(quarantineThreshold) || 2), Math.max(1000, Math.trunc(quarantineMs) || 900000)]
  );
  return result.rows[0] || null;
}

async function resetAgentEndpointHealth(agentId) {
  await getPool().query(
    `
      INSERT INTO public.agent_endpoint_health (agent_id, failure_count, suspicious_count, updated_at)
      VALUES ($1, 0, 0, timezone('utc', now()))
      ON CONFLICT (agent_id)
      DO UPDATE SET
        failure_count = 0,
        suspicious_count = 0,
        last_error_code = NULL,
        last_reason = NULL,
        quarantined_until = NULL,
        updated_at = timezone('utc', now())
    `,
    [agentId]
  );
}

async function listAgentHealthOverview(limit = 100) {
  const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 100));
  const result = await getPool().query(
    `
      SELECT
        a.id,
        a.owner_user_id AS "ownerUserId",
        a.name,
        a.mode,
        a.provider,
        a.status,
        h.failure_count AS "failureCount",
        h.suspicious_count AS "suspiciousCount",
        h.last_error_code AS "lastErrorCode",
        h.last_reason AS "lastReason",
        h.quarantined_until AS "quarantinedUntil",
        h.updated_at AS "updatedAt",
        COALESCE(u.run_count, 0) AS "todayRunCount",
        COALESCE(u.error_count, 0) AS "todayErrorCount",
        COALESCE(u.blocked_count, 0) AS "todayBlockedCount"
      FROM public.agents a
      LEFT JOIN public.agent_endpoint_health h ON h.agent_id = a.id
      LEFT JOIN public.agent_usage_daily u ON u.agent_id = a.id AND u.usage_date = timezone('utc', now())::date
      ORDER BY COALESCE(h.quarantined_until, timezone('utc', now()) - interval '100 years') DESC, a.updated_at DESC
      LIMIT $1
    `,
    [normalizedLimit]
  );
  return result.rows;
}

module.exports = {
  createAgent,
  ensureAgentTables,
  getAgentById,
  getAgentByIdForOwner,
  getAgentDailyUsage,
  getAgentEndpointByAgentId,
  getAgentEndpointHealthByAgentId,
  getAgentSecret,
  listAgentsByOwner,
  listAgentHealthOverview,
  listAgentRunsByOwner,
  listAllActiveAgents,
  listRunnableAgents,
  recordAgentEndpointFailure,
  recordAgentEndpointSuspicion,
  recordAgentRun,
  resetAgentEndpointHealth,
  saveAgentEndpoint,
  saveAgentSecret,
  updateAgentPolicy,
  updateAgentStatus,
  updateAgentStatusAdmin,
};
