const { getPool } = require('./postgres');

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function ensureAuthSessionTable() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.auth_sessions (
      id text PRIMARY KEY, user_id text NOT NULL, user_email text, user_name text,
      ip text, user_agent text, created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      issued_at timestamptz NOT NULL DEFAULT timezone('utc', now()), expires_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()), revoked_at timestamptz, revoke_reason text
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON public.auth_sessions (user_id, revoked_at, expires_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_seen_at ON public.auth_sessions (last_seen_at DESC)`);
}

async function createAuthSession({ id, userId, userEmail = null, userName = null, ip = null, userAgent = null, expiresAt }) {
  const normalizedExpiresAt = normalizeTimestamp(expiresAt);
  const result = await getPool().query(
    `INSERT INTO public.auth_sessions (id, user_id, user_email, user_name, ip, user_agent, expires_at, issued_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, timezone('utc', now()), timezone('utc', now()))
     RETURNING id, user_id AS "userId", user_email AS "userEmail", user_name AS "userName", ip, user_agent AS "userAgent", created_at AS "createdAt", issued_at AS "issuedAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt", revoke_reason AS "revokeReason"`,
    [id, userId, userEmail, userName, ip, userAgent, normalizedExpiresAt.toISOString()]
  );
  return result.rows[0] || null;
}

async function getAuthSessionById(id) {
  const result = await getPool().query(
    `SELECT id, user_id AS "userId", user_email AS "userEmail", user_name AS "userName", ip, user_agent AS "userAgent", created_at AS "createdAt", issued_at AS "issuedAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt", revoke_reason AS "revokeReason" FROM public.auth_sessions WHERE id = $1 LIMIT 1`, [id]
  );
  return result.rows[0] || null;
}

async function getActiveAuthSession(id) {
  const result = await getPool().query(
    `SELECT id, user_id AS "userId", user_email AS "userEmail", user_name AS "userName", ip, user_agent AS "userAgent", created_at AS "createdAt", issued_at AS "issuedAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", revoked_at AS "revokedAt", revoke_reason AS "revokeReason"
     FROM public.auth_sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > timezone('utc', now()) LIMIT 1`, [id]
  );
  return result.rows[0] || null;
}

async function touchAuthSession(id) {
  const result = await getPool().query(
    `UPDATE public.auth_sessions SET last_seen_at = timezone('utc', now()) WHERE id = $1 AND revoked_at IS NULL AND expires_at > timezone('utc', now()) RETURNING id, user_id AS "userId", last_seen_at AS "lastSeenAt"`, [id]
  );
  return result.rows[0] || null;
}

async function revokeAuthSession(id, revokeReason = 'logout') {
  const result = await getPool().query(
    `UPDATE public.auth_sessions SET revoked_at = timezone('utc', now()), revoke_reason = COALESCE($2, revoke_reason) WHERE id = $1 AND revoked_at IS NULL RETURNING id, user_id AS "userId", revoked_at AS "revokedAt", revoke_reason AS "revokeReason"`,
    [id, revokeReason]
  );
  return result.rows[0] || null;
}

async function revokeAllAuthSessionsForUser(userId, { exceptSessionId = null, revokeReason = 'logout_all' } = {}) {
  const result = await getPool().query(
    `UPDATE public.auth_sessions SET revoked_at = timezone('utc', now()), revoke_reason = COALESCE($3, revoke_reason) WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2) RETURNING id`,
    [userId, exceptSessionId, revokeReason]
  );
  return result.rowCount || 0;
}

async function listActiveAuthSessionsForUser(userId, limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
  const result = await getPool().query(
    `SELECT id, user_id AS "userId", user_email AS "userEmail", user_name AS "userName", ip, user_agent AS "userAgent", created_at AS "createdAt", issued_at AS "issuedAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt"
     FROM public.auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > timezone('utc', now()) ORDER BY last_seen_at DESC, created_at DESC LIMIT $2`,
    [userId, normalizedLimit]
  );
  return result.rows;
}

module.exports = { ensureAuthSessionTable, createAuthSession, getAuthSessionById, getActiveAuthSession, touchAuthSession, revokeAuthSession, revokeAllAuthSessionsForUser, listActiveAuthSessionsForUser };
