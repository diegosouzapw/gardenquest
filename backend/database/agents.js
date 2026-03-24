const { getPool } = require('./postgres');

function normalizeMode(mode) {
  return ['hosted_api_key', 'remote_endpoint', 'server_managed'].includes(mode) ? mode : 'hosted_api_key';
}

function normalizeStatus(status) {
  return ['active', 'paused', 'revoked', 'error'].includes(status) ? status : 'active';
}

function normalizeProvider(provider) {
  return String(provider || 'openai').trim().toLowerCase();
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
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked', 'error')),
      route_hint text,
      policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
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
    CREATE TABLE IF NOT EXISTS public.agent_runs (
      id bigserial PRIMARY KEY,
      agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
      status text NOT NULL,
      error_code text,
      latency_ms integer,
      provider_mode text,
      provider_name text,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
    )
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
      SELECT id, owner_user_id AS "ownerUserId", name, mode, provider, status, route_hint AS "routeHint", policy_json AS "policyJson", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.agents
      WHERE owner_user_id = $1
      ORDER BY created_at DESC
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

async function saveAgentEndpoint({ agentId, baseUrl, authMode = 'none', authSecret = null, timeoutMs = 2500 }) {
  const db = getPool();
  await db.query(
    `
      INSERT INTO public.agent_endpoints (agent_id, base_url, auth_mode, auth_secret, timeout_ms, updated_at)
      VALUES ($1, $2, $3, $4, $5, timezone('utc', now()))
      ON CONFLICT (agent_id)
      DO UPDATE SET
        base_url = EXCLUDED.base_url,
        auth_mode = EXCLUDED.auth_mode,
        auth_secret = EXCLUDED.auth_secret,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = timezone('utc', now())
    `,
    [agentId, baseUrl, authMode, authSecret, Math.max(500, Math.trunc(timeoutMs || 2500))]
  );
}

async function getAgentEndpointByAgentId(agentId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT agent_id AS "agentId", base_url AS "baseUrl", auth_mode AS "authMode", auth_secret AS "authSecret", timeout_ms AS "timeoutMs"
      FROM public.agent_endpoints
      WHERE agent_id = $1
      LIMIT 1
    `,
    [agentId]
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

async function recordAgentRun({ agentId, status, errorCode = null, latencyMs = null, providerMode = null, providerName = null }) {
  const db = getPool();
  await db.query(
    `
      INSERT INTO public.agent_runs (agent_id, status, error_code, latency_ms, provider_mode, provider_name)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [agentId, status, errorCode, latencyMs, providerMode, providerName]
  );
}

module.exports = {
  ensureAgentTables,
  createAgent,
  listAgentsByOwner,
  getAgentById,
  getAgentByIdForOwner,
  saveAgentSecret,
  getAgentSecret,
  saveAgentEndpoint,
  getAgentEndpointByAgentId,
  updateAgentStatus,
  recordAgentRun,
};
