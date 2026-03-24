const crypto = require('crypto');
const { getPool } = require('./postgres');

function normalizeRealmId(realmId) {
  const normalized = String(realmId || '').trim();
  return normalized || 'gardenquest-world-01';
}

function mapLeaseRow(row) {
  if (!row) {
    return null;
  }

  return {
    realmId: row.realmId,
    ownerInstanceId: row.ownerInstanceId,
    leaseToken: row.leaseToken,
    acquiredAt: row.acquiredAt,
    renewedAt: row.renewedAt,
    expiresAt: row.expiresAt,
    metaJson: row.metaJson || {},
  };
}

async function ensureRealmLeaseTable() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.realm_leases (
      realm_id text PRIMARY KEY,
      owner_instance_id text NOT NULL,
      lease_token text NOT NULL,
      acquired_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      renewed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      expires_at timestamptz NOT NULL,
      meta_json jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_realm_leases_owner_expires
    ON public.realm_leases (owner_instance_id, expires_at)
  `);
}

async function acquireOrRenewRealmLease({
  realmId,
  ownerInstanceId,
  leaseToken,
  expiresAt,
  metaJson = {},
}) {
  const db = getPool();
  const normalizedRealmId = normalizeRealmId(realmId);
  const proposedLeaseToken = String(leaseToken || crypto.randomUUID());
  const nextExpiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);

  const result = await db.query(
    `
      INSERT INTO public.realm_leases (
        realm_id,
        owner_instance_id,
        lease_token,
        acquired_at,
        renewed_at,
        expires_at,
        meta_json
      )
      VALUES ($1, $2, $3, timezone('utc', now()), timezone('utc', now()), $4, $5::jsonb)
      ON CONFLICT (realm_id)
      DO UPDATE SET
        owner_instance_id = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
            OR public.realm_leases.expires_at <= timezone('utc', now())
          THEN EXCLUDED.owner_instance_id
          ELSE public.realm_leases.owner_instance_id
        END,
        lease_token = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
            OR public.realm_leases.expires_at <= timezone('utc', now())
          THEN EXCLUDED.lease_token
          ELSE public.realm_leases.lease_token
        END,
        acquired_at = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
          THEN public.realm_leases.acquired_at
          WHEN public.realm_leases.expires_at <= timezone('utc', now())
          THEN timezone('utc', now())
          ELSE public.realm_leases.acquired_at
        END,
        renewed_at = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
            OR public.realm_leases.expires_at <= timezone('utc', now())
          THEN timezone('utc', now())
          ELSE public.realm_leases.renewed_at
        END,
        expires_at = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
            OR public.realm_leases.expires_at <= timezone('utc', now())
          THEN EXCLUDED.expires_at
          ELSE public.realm_leases.expires_at
        END,
        meta_json = CASE
          WHEN public.realm_leases.owner_instance_id = EXCLUDED.owner_instance_id
            OR public.realm_leases.expires_at <= timezone('utc', now())
          THEN EXCLUDED.meta_json
          ELSE public.realm_leases.meta_json
        END
      RETURNING
        realm_id AS "realmId",
        owner_instance_id AS "ownerInstanceId",
        lease_token AS "leaseToken",
        acquired_at AS "acquiredAt",
        renewed_at AS "renewedAt",
        expires_at AS "expiresAt",
        meta_json AS "metaJson"
    `,
    [normalizedRealmId, ownerInstanceId, proposedLeaseToken, nextExpiry.toISOString(), JSON.stringify(metaJson || {})]
  );

  return mapLeaseRow(result.rows[0]);
}

async function releaseRealmLease({ realmId, ownerInstanceId, leaseToken }) {
  const db = getPool();
  const result = await db.query(
    `
      DELETE FROM public.realm_leases
      WHERE realm_id = $1
        AND owner_instance_id = $2
        AND lease_token = $3
      RETURNING realm_id AS "realmId"
    `,
    [normalizeRealmId(realmId), ownerInstanceId, leaseToken]
  );

  return result.rowCount > 0;
}

async function getRealmLease(realmId) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        realm_id AS "realmId",
        owner_instance_id AS "ownerInstanceId",
        lease_token AS "leaseToken",
        acquired_at AS "acquiredAt",
        renewed_at AS "renewedAt",
        expires_at AS "expiresAt",
        meta_json AS "metaJson"
      FROM public.realm_leases
      WHERE realm_id = $1
    `,
    [normalizeRealmId(realmId)]
  );

  return mapLeaseRow(result.rows[0]);
}

module.exports = {
  ensureRealmLeaseTable,
  acquireOrRenewRealmLease,
  releaseRealmLease,
  getRealmLease,
};
