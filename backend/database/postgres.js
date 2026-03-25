const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { runner: pgMigrate } = require('node-pg-migrate');
const config = require('../config');

let pool;
let schemaMigrationsCompleted = false;

function getConnectionString() {
  if (!config.SUPABASE_DB_URL) {
    throw new Error('SUPABASE_DB_URL is not configured');
  }

  const parsed = new URL(config.SUPABASE_DB_URL);
  ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].forEach((parameterName) => {
    parsed.searchParams.delete(parameterName);
  });

  return parsed.toString();
}

function buildSslConfig() {
  if (!config.SUPABASE_DB_SSL) {
    return false;
  }

  const sslConfig = {
    rejectUnauthorized: true,
  };

  if (config.SUPABASE_DB_SSL_CA_PATH) {
    const resolvedCaPath = path.isAbsolute(config.SUPABASE_DB_SSL_CA_PATH)
      ? config.SUPABASE_DB_SSL_CA_PATH
      : path.resolve(process.cwd(), config.SUPABASE_DB_SSL_CA_PATH);

    if (!fs.existsSync(resolvedCaPath)) {
      throw new Error(`SUPABASE_DB_SSL_CA_PATH file not found: ${resolvedCaPath}`);
    }

    sslConfig.ca = fs.readFileSync(resolvedCaPath, 'utf8');
  }

  return sslConfig;
}

function normalizeLogCategory(category) {
  return category === 'game' ? 'game' : 'site';
}

function normalizeActorType(actorType) {
  return actorType === 'ai' ? 'ai' : 'player';
}

function normalizeModerationStatus(status) {
  return status === 'blocked' ? 'blocked' : 'visible';
}

function getPool() {
  const connectionString = getConnectionString();

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: buildSslConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
    });

    pool.on('error', (error) => {
      console.error('Unexpected database pool error:', error.message);
    });
  }

  return pool;
}

function getStandaloneClientConfig() {
  return {
    connectionString: getConnectionString(),
    ssl: buildSslConfig(),
    keepAlive: true,
  };
}

async function runDatabaseMigrations(database) {
  if (schemaMigrationsCompleted) {
    return;
  }

  await pgMigrate({
    dbClient: database,
    dir: path.resolve(__dirname, '../migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    count: Infinity,
    checkOrder: true,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    },
  });

  schemaMigrationsCompleted = true;
}

async function applyLockedDownApiPolicy(database, tableName, policyName) {
  await database.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);

  const rolesResult = await database.query(
    `
      SELECT rolname
      FROM pg_roles
      WHERE rolname = ANY($1::text[])
    `,
    [['anon', 'authenticated']]
  );

  const availableRoles = new Set(rolesResult.rows.map((row) => row.rolname));
  if (!availableRoles.has('anon') || !availableRoles.has('authenticated')) {
    return;
  }

  await database.query(`DROP POLICY IF EXISTS ${policyName} ON ${tableName}`);
  await database.query(`
    CREATE POLICY ${policyName}
      ON ${tableName}
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false)
  `);
  await database.query(`REVOKE ALL ON TABLE ${tableName} FROM anon, authenticated`);
}

async function verifyDatabaseConnection() {
  const database = getPool();
  await database.query('SELECT 1');

  try {
    await runDatabaseMigrations(database);
    return;
  } catch (migrationError) {
    console.warn(`Migration runner unavailable, falling back to legacy bootstrap: ${migrationError.message}`);
  }

  await database.query(`
    CREATE TABLE IF NOT EXISTS public.event_logs (
      id bigint generated always as identity primary key,
      event text not null,
      ip text,
      user_agent text,
      user_id text,
      user_name text,
      details text,
      category text not null default 'site',
      created_at timestamptz not null default timezone('utc', now())
    )
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_event
      ON public.event_logs (event)
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_category
      ON public.event_logs (category)
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_created_at
      ON public.event_logs (created_at DESC)
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_event_logs_ip
      ON public.event_logs (ip)
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id text primary key,
      auth_provider text not null default 'google',
      email text,
      display_name text,
      avatar_url text,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      last_seen_at timestamptz
    )
  `);

  await database.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON public.users (email)
      WHERE email IS NOT NULL AND email <> ''
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
      ON public.users (last_seen_at DESC)
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS public.player_profiles (
      user_id text primary key references public.users(id) on delete cascade,
      nickname text not null,
      outfit_color text not null default '#2563eb',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    )
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_player_profiles_nickname
      ON public.player_profiles (nickname)
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS public.actor_stats (
      actor_id text not null,
      actor_type text not null,
      current_score integer not null default 0,
      best_score integer not null default 0,
      deaths integer not null default 0,
      respawns integer not null default 0,
      soccer_goals integer not null default 0,
      last_death_reason text,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      primary key (actor_id, actor_type)
    )
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_actor_stats_best_score
      ON public.actor_stats (best_score DESC, updated_at DESC)
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_actor_stats_soccer_goals
      ON public.actor_stats (soccer_goals DESC, updated_at DESC)
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS public.chat_messages (
      id bigint generated always as identity primary key,
      user_id text references public.users(id) on delete set null,
      player_name text not null,
      message text not null,
      moderation_status text not null default 'visible',
      moderation_reason text,
      created_at timestamptz not null default timezone('utc', now())
    )
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
      ON public.chat_messages (created_at DESC, id DESC)
  `);

  await database.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_visible_created_at
      ON public.chat_messages (moderation_status, created_at DESC, id DESC)
  `);

  await applyLockedDownApiPolicy(database, 'public.event_logs', 'deny_all_event_logs_api_access');
  await applyLockedDownApiPolicy(database, 'public.users', 'deny_all_users_api_access');
  await applyLockedDownApiPolicy(database, 'public.player_profiles', 'deny_all_player_profiles_api_access');
  await applyLockedDownApiPolicy(database, 'public.actor_stats', 'deny_all_actor_stats_api_access');
  await applyLockedDownApiPolicy(database, 'public.chat_messages', 'deny_all_chat_messages_api_access');
}

async function upsertUser({
  id,
  authProvider = 'google',
  email = null,
  displayName = null,
  avatarUrl = null,
  touchLastSeen = false,
}) {
  if (!id) {
    return null;
  }

  const result = await getPool().query(
    `
      INSERT INTO public.users (
        id,
        auth_provider,
        email,
        display_name,
        avatar_url,
        updated_at,
        last_seen_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        timezone('utc', now()),
        CASE
          WHEN $6 THEN timezone('utc', now())
          ELSE NULL
        END
      )
      ON CONFLICT (id)
      DO UPDATE SET
        auth_provider = COALESCE(EXCLUDED.auth_provider, public.users.auth_provider),
        email = COALESCE(EXCLUDED.email, public.users.email),
        display_name = COALESCE(EXCLUDED.display_name, public.users.display_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = timezone('utc', now()),
        last_seen_at = CASE
          WHEN $6 THEN timezone('utc', now())
          ELSE public.users.last_seen_at
        END
      RETURNING id
    `,
    [id, authProvider || 'google', email, displayName, avatarUrl, Boolean(touchLastSeen)]
  );

  return result.rows[0] || null;
}

async function insertLog({
  event,
  ip = null,
  userAgent = null,
  userId = null,
  userName = null,
  details = null,
  category = 'site',
}) {
  await getPool().query(
    `
      INSERT INTO public.event_logs (
        event,
        ip,
        user_agent,
        user_id,
        user_name,
        details,
        category
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [event, ip, userAgent, userId, userName, details, normalizeLogCategory(category)]
  );
}

async function upsertGameScore({
  actorId,
  actorType,
  actorName = null,
  outfitColor = null,
  score = 0,
  bestScore = 0,
  deaths = 0,
  respawns = 0,
  lastDeathReason = null,
}) {
  if (!actorId) {
    return;
  }

  if (normalizeActorType(actorType) === 'player' && actorName) {
    await upsertPlayerProfile({
      userId: actorId,
      nickname: actorName,
      outfitColor: outfitColor || '#2563eb',
      displayName: actorName,
    });
  }

  await getPool().query(
    `
      INSERT INTO public.actor_stats (
        actor_id,
        actor_type,
        current_score,
        best_score,
        deaths,
        respawns,
        last_death_reason,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, timezone('utc', now()))
      ON CONFLICT (actor_id, actor_type)
      DO UPDATE SET
        current_score = EXCLUDED.current_score,
        best_score = EXCLUDED.best_score,
        deaths = EXCLUDED.deaths,
        respawns = EXCLUDED.respawns,
        last_death_reason = EXCLUDED.last_death_reason,
        updated_at = timezone('utc', now())
    `,
    [
      actorId,
      normalizeActorType(actorType),
      Math.max(0, Math.trunc(score)),
      Math.max(0, Math.trunc(bestScore)),
      Math.max(0, Math.trunc(deaths)),
      Math.max(0, Math.trunc(respawns)),
      lastDeathReason,
    ]
  );
}

async function getGameActorProfile(actorId, actorType = 'player') {
  if (normalizeActorType(actorType) !== 'player') {
    return null;
  }

  const result = await getPool().query(
    `
      SELECT
        nickname AS "actorName",
        outfit_color AS "outfitColor"
      FROM public.player_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [actorId]
  );

  if (result.rowCount < 1) {
    return null;
  }

  return {
    actorName: result.rows[0].actorName || null,
    outfitColor: result.rows[0].outfitColor || null,
  };
}

async function upsertPlayerProfile({
  userId,
  nickname,
  outfitColor = '#2563eb',
  displayName = null,
  email = null,
  avatarUrl = null,
}) {
  if (!userId || !nickname) {
    return;
  }

  await upsertUser({
    id: userId,
    displayName: displayName || nickname,
    email,
    avatarUrl,
    touchLastSeen: true,
  });

  await getPool().query(
    `
      INSERT INTO public.player_profiles (
        user_id,
        nickname,
        outfit_color,
        updated_at
      )
      VALUES ($1, $2, $3, timezone('utc', now()))
      ON CONFLICT (user_id)
      DO UPDATE SET
        nickname = EXCLUDED.nickname,
        outfit_color = EXCLUDED.outfit_color,
        updated_at = timezone('utc', now())
    `,
    [userId, nickname, outfitColor || '#2563eb']
  );
}

async function getTopGameScores(limit = 10) {
  const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 10));
  const result = await getPool().query(
    `
      SELECT
        ast.actor_id AS "actorId",
        ast.actor_type AS "actorType",
        CASE
          WHEN ast.actor_type = 'player' THEN COALESCE(pp.nickname, u.display_name, 'Jogador')
          ELSE $2
        END AS "actorName",
        ast.current_score AS "currentScore",
        ast.best_score AS "bestScore",
        ast.deaths,
        ast.respawns,
        ast.updated_at AS "updatedAt"
      FROM public.actor_stats ast
      LEFT JOIN public.player_profiles pp
        ON ast.actor_type = 'player'
       AND pp.user_id = ast.actor_id
      LEFT JOIN public.users u
        ON ast.actor_type = 'player'
       AND u.id = ast.actor_id
      ORDER BY ast.best_score DESC, ast.updated_at ASC
      LIMIT $1
    `,
    [normalizedLimit, config.AI_AGENT_NAME]
  );

  return result.rows.map((row, index) => ({
    rank: index + 1,
    actorId: row.actorId,
    actorType: normalizeActorType(row.actorType),
    actorName: row.actorName || (row.actorType === 'ai' ? config.AI_AGENT_NAME : 'Jogador'),
    currentScore: Math.max(0, Math.trunc(row.currentScore || 0)),
    bestScore: Math.max(0, Math.trunc(row.bestScore || 0)),
    deaths: Math.max(0, Math.trunc(row.deaths || 0)),
    respawns: Math.max(0, Math.trunc(row.respawns || 0)),
    updatedAt: row.updatedAt,
  }));
}

async function incrementGameActorSoccerGoals({
  actorId,
  actorType = 'player',
  actorName = null,
  outfitColor = null,
}) {
  if (!actorId) {
    return;
  }

  if (normalizeActorType(actorType) === 'player' && actorName) {
    await upsertPlayerProfile({
      userId: actorId,
      nickname: actorName,
      outfitColor: outfitColor || '#2563eb',
      displayName: actorName,
    });
  }

  await getPool().query(
    `
      INSERT INTO public.actor_stats (
        actor_id,
        actor_type,
        current_score,
        best_score,
        deaths,
        respawns,
        soccer_goals,
        updated_at
      )
      VALUES ($1, $2, 0, 0, 0, 0, 1, timezone('utc', now()))
      ON CONFLICT (actor_id, actor_type)
      DO UPDATE SET
        soccer_goals = public.actor_stats.soccer_goals + 1,
        updated_at = timezone('utc', now())
    `,
    [
      actorId,
      normalizeActorType(actorType),
    ]
  );
}

async function getTopSoccerScorers(limit = 10) {
  const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 10));
  const result = await getPool().query(
    `
      SELECT
        ast.actor_id AS "actorId",
        ast.actor_type AS "actorType",
        CASE
          WHEN ast.actor_type = 'player' THEN COALESCE(pp.nickname, u.display_name, 'Jogador')
          ELSE $2
        END AS "actorName",
        ast.soccer_goals AS "soccerGoals",
        ast.updated_at AS "updatedAt"
      FROM public.actor_stats ast
      LEFT JOIN public.player_profiles pp
        ON ast.actor_type = 'player'
       AND pp.user_id = ast.actor_id
      LEFT JOIN public.users u
        ON ast.actor_type = 'player'
       AND u.id = ast.actor_id
      WHERE ast.soccer_goals > 0
      ORDER BY ast.soccer_goals DESC, ast.updated_at ASC
      LIMIT $1
    `,
    [normalizedLimit, config.AI_AGENT_NAME]
  );

  return result.rows.map((row, index) => ({
    rank: index + 1,
    actorId: row.actorId,
    actorType: normalizeActorType(row.actorType),
    actorName: row.actorName || (row.actorType === 'ai' ? config.AI_AGENT_NAME : 'Jogador'),
    soccerGoals: Math.max(0, Math.trunc(row.soccerGoals || 0)),
    updatedAt: row.updatedAt,
  }));
}

async function insertChatMessage({
  userId = null,
  playerName,
  message,
  moderationStatus = 'visible',
  moderationReason = null,
  sourceLogId = null,
  createdAt = null,
}) {
  if (userId) {
    await upsertUser({
      id: userId,
      displayName: playerName || 'Jogador',
      touchLastSeen: true,
    });
  }

  const result = await getPool().query(
    `
      INSERT INTO public.chat_messages (
        user_id,
        player_name,
        message,
        moderation_status,
        moderation_reason,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        COALESCE($6, timezone('utc', now()))
      )
      RETURNING
        id,
        user_id AS "userId",
        player_name AS "playerName",
        message,
        moderation_status AS "moderationStatus",
        moderation_reason AS "moderationReason",
        created_at AS "createdAt"
    `,
    [
      userId,
      playerName,
      message,
      normalizeModerationStatus(moderationStatus),
      moderationReason,
      createdAt,
    ]
  );

  void sourceLogId;
  return result.rows[0] || null;
}

async function getRecentVisibleChatMessages(limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 20));
  const result = await getPool().query(
    `
      SELECT
        id,
        user_id AS "userId",
        player_name AS "playerName",
        message,
        created_at AS "createdAt"
      FROM public.chat_messages
      WHERE moderation_status = 'visible'
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
    [normalizedLimit]
  );

  return result.rows.reverse();
}

async function getDashboardData() {
  const database = getPool();
  const [
    siteMetricsResult,
    gameMetricsResult,
    recentSiteLogsResult,
    recentGameLogsResult,
    uniqueVisitorsResult,
  ] = await Promise.all([
    database.query(
      `
        SELECT event, COUNT(*)::int AS count
        FROM public.event_logs
        WHERE category = 'site'
        GROUP BY event
        ORDER BY event ASC
      `
    ),
    database.query(
      `
        SELECT event, COUNT(*)::int AS count
        FROM public.event_logs
        WHERE category = 'game'
        GROUP BY event
        ORDER BY event ASC
      `
    ),
    database.query(
      `
        SELECT
          id,
          event,
          ip,
          user_agent AS "userAgent",
          user_id AS "userId",
          user_name AS "userName",
          details,
          category,
          created_at AS "timestamp"
        FROM public.event_logs
        WHERE category = 'site'
        ORDER BY created_at DESC
        LIMIT 50
      `
    ),
    database.query(
      `
        SELECT
          id,
          event,
          ip,
          user_agent AS "userAgent",
          user_id AS "userId",
          user_name AS "userName",
          details,
          category,
          created_at AS "timestamp"
        FROM public.event_logs
        WHERE category = 'game'
        ORDER BY created_at DESC
        LIMIT 50
      `
    ),
    database.query(
      `
        SELECT COUNT(DISTINCT ip)::int AS "uniqueVisitors"
        FROM public.event_logs
        WHERE category = 'site'
          AND ip IS NOT NULL AND ip <> ''
      `
    ),
  ]);

  return {
    siteMetrics: siteMetricsResult.rows.map((row) => ({
      event: row.event,
      count: Number(row.count) || 0,
    })),
    gameMetrics: gameMetricsResult.rows.map((row) => ({
      event: row.event,
      count: Number(row.count) || 0,
    })),
    recentSiteLogs: recentSiteLogsResult.rows,
    recentGameLogs: recentGameLogsResult.rows,
    uniqueVisitors: uniqueVisitorsResult.rows[0]?.uniqueVisitors || 0,
  };
}

module.exports = {
  buildSslConfig,
  getConnectionString,
  getGameActorProfile,
  getRecentVisibleChatMessages,
  getTopGameScores,
  getTopSoccerScorers,
  getDashboardData,
  getPool,
  getStandaloneClientConfig,
  incrementGameActorSoccerGoals,
  insertLog,
  insertChatMessage,
  upsertPlayerProfile,
  upsertGameScore,
  upsertUser,
  verifyDatabaseConnection,
};
