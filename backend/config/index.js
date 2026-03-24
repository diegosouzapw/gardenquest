const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.join(__dirname, '../..');

function normalizeNodeEnv(value) {
  return String(value || '').trim().toLowerCase() === 'production'
    ? 'production'
    : 'development';
}

function normalizeAppEnv(value, fallbackNodeEnv = 'development') {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'local' || normalized === 'staging' || normalized === 'production') {
    return normalized;
  }

  if (normalized === 'development') {
    return 'local';
  }

  return fallbackNodeEnv === 'production' ? 'production' : 'local';
}

function resolveEnvFilePath(fileName) {
  if (!fileName) {
    return null;
  }

  return path.isAbsolute(fileName)
    ? fileName
    : path.join(projectRoot, fileName);
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return dotenv.parse(fs.readFileSync(filePath));
}

function dedupePreserveOrder(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function applyEnvFiles(filePaths) {
  const mergedValues = {};
  const loadedEnvFiles = [];

  for (const filePath of filePaths) {
    const parsed = parseEnvFile(filePath);
    if (!parsed) {
      continue;
    }

    Object.assign(mergedValues, parsed);
    loadedEnvFiles.push(path.relative(projectRoot, filePath).replace(/\\/g, '/'));
  }

  for (const [name, value] of Object.entries(mergedValues)) {
    if (process.env[name] == null) {
      process.env[name] = value;
    }
  }

  return loadedEnvFiles;
}

function loadEnvironmentFiles() {
  const baseEnvPath = resolveEnvFilePath('.env');
  const explicitEnvPath = resolveEnvFilePath(process.env.ENV_FILE || '');
  const baseEnv = parseEnvFile(baseEnvPath);
  const explicitEnv = parseEnvFile(explicitEnvPath);

  const discoveredNodeEnv = normalizeNodeEnv(
    process.env.NODE_ENV || explicitEnv?.NODE_ENV || baseEnv?.NODE_ENV
  );
  const discoveredAppEnv = normalizeAppEnv(
    process.env.APP_ENV || explicitEnv?.APP_ENV || baseEnv?.APP_ENV,
    discoveredNodeEnv
  );

  const appEnvPath =
    discoveredAppEnv === 'local'
      ? resolveEnvFilePath('.env.local')
      : resolveEnvFilePath(`.env.${discoveredAppEnv}`);

  const loadedEnvFiles = applyEnvFiles(
    dedupePreserveOrder([
      baseEnvPath,
      appEnvPath,
      explicitEnvPath,
    ])
  );

  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV || discoveredNodeEnv);
  const appEnv = normalizeAppEnv(process.env.APP_ENV || discoveredAppEnv, nodeEnv);

  process.env.NODE_ENV = nodeEnv;
  process.env.APP_ENV = appEnv;

  return {
    loadedEnvFiles,
    nodeEnv,
    appEnv,
  };
}

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .replace(/^\./, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
}

function isLoopbackHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseAbsoluteUrl(name, value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch (error) {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

function assertRootUrl(name, parsedUrl) {
  if (!parsedUrl) {
    return;
  }

  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error(`${name} must not include a path, query string, or hash`);
  }
}

function assertCallbackUrl(name, parsedUrl) {
  if (!parsedUrl) {
    return;
  }

  if (parsedUrl.pathname !== '/auth/callback' || parsedUrl.search || parsedUrl.hash) {
    throw new Error(`${name} must be an absolute URL ending in /auth/callback`);
  }
}

function assertLocalUrl(name, parsedUrl) {
  if (!parsedUrl) {
    return;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error(`${name} must use localhost, 127.0.0.1, or ::1 in APP_ENV=local`);
  }
}

function assertSecureRemoteUrl(name, parsedUrl) {
  if (!parsedUrl) {
    return;
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`${name} must use https outside APP_ENV=local`);
  }
}

function validateCookieDomain(cookieDomain, frontendUrl, appEnv) {
  if (!cookieDomain) {
    return;
  }

  const normalizedCookieDomain = normalizeHostname(cookieDomain);
  if (!normalizedCookieDomain) {
    return;
  }

  if (appEnv === 'local') {
    if (!isLoopbackHostname(normalizedCookieDomain)) {
      throw new Error('COOKIE_DOMAIN must stay empty or point to localhost in APP_ENV=local');
    }
    return;
  }

  if (!frontendUrl) {
    return;
  }

  const frontendHostname = normalizeHostname(frontendUrl.hostname);
  if (
    normalizedCookieDomain !== frontendHostname
    && !frontendHostname.endsWith(`.${normalizedCookieDomain}`)
  ) {
    throw new Error('COOKIE_DOMAIN must match FRONTEND_URL or be a parent domain of it');
  }
}

const environmentState = loadEnvironmentFiles();
const nodeEnv = environmentState.nodeEnv;
const appEnv = environmentState.appEnv;

function readEnv(name, { defaultValue = '', requiredInProduction = false } = {}) {
  const value = process.env[name];

  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  if (requiredInProduction && nodeEnv === 'production') {
    throw new Error(`${name} must be set in production`);
  }

  return defaultValue;
}

function readBooleanEnv(name, defaultValue) {
  const value = process.env[name];

  if (value == null || value === '') {
    return defaultValue;
  }

  return value === 'true';
}

function readIntegerEnv(name, defaultValue) {
  const value = process.env[name];

  if (value == null || value === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readFloatEnv(name, defaultValue) {
  const value = process.env[name];

  if (value == null || value === '') {
    return defaultValue;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readSameSiteEnv(name, defaultValue) {
  const value = process.env[name];

  if (typeof value !== 'string' || !value.trim()) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'strict') {
    return 'Strict';
  }

  if (normalized === 'none') {
    return 'None';
  }

  return 'Lax';
}

function readEmailListEnv(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function readStringListEnv(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const cookieSecure =
  process.env.COOKIE_SECURE != null
    ? process.env.COOKIE_SECURE === 'true'
    : appEnv !== 'local';

const config = {
  APP_ENV: appEnv,
  LOADED_ENV_FILES: environmentState.loadedEnvFiles,
  PORT: readEnv('PORT', { defaultValue: '8080' }),

  GOOGLE_CLIENT_ID: readEnv('GOOGLE_CLIENT_ID', {
    requiredInProduction: true,
  }),
  GOOGLE_CLIENT_SECRET: readEnv('GOOGLE_CLIENT_SECRET', {
    requiredInProduction: true,
  }),
  GOOGLE_REDIRECT_URI: readEnv('GOOGLE_REDIRECT_URI', {
    defaultValue: appEnv === 'local' ? 'http://localhost:8080/auth/callback' : '',
  }),

  JWT_SECRET: readEnv('JWT_SECRET', {
    defaultValue: nodeEnv === 'development' ? 'dev-secret-change-me' : '',
    requiredInProduction: true,
  }),
  JWT_EXPIRES_IN: '24h',

  FRONTEND_URL: readEnv('FRONTEND_URL', {
    defaultValue: appEnv === 'local' ? 'http://localhost:3000' : '',
  }),

  GLOBAL_RATE_LIMIT_WINDOW_MS: readIntegerEnv('GLOBAL_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  GLOBAL_RATE_LIMIT_MAX: readIntegerEnv('GLOBAL_RATE_LIMIT_MAX', 600),
  AUTH_RATE_LIMIT_WINDOW_MS: readIntegerEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: readIntegerEnv('AUTH_RATE_LIMIT_MAX', 20),
  ADMIN_RATE_LIMIT_WINDOW_MS: readIntegerEnv('ADMIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  ADMIN_RATE_LIMIT_MAX: readIntegerEnv('ADMIN_RATE_LIMIT_MAX', 10),
  AI_PUBLIC_STATE_RATE_LIMIT_WINDOW_MS: readIntegerEnv('AI_PUBLIC_STATE_RATE_LIMIT_WINDOW_MS', 10 * 1000),
  AI_PUBLIC_STATE_RATE_LIMIT_MAX: readIntegerEnv('AI_PUBLIC_STATE_RATE_LIMIT_MAX', 90),
  AI_COMMAND_RATE_LIMIT_WINDOW_MS: readIntegerEnv('AI_COMMAND_RATE_LIMIT_WINDOW_MS', 10 * 1000),
  AI_COMMAND_RATE_LIMIT_MAX: readIntegerEnv('AI_COMMAND_RATE_LIMIT_MAX', 300),

  COOKIE_SECURE: cookieSecure,
  COOKIE_SAME_SITE: readSameSiteEnv('COOKIE_SAME_SITE', 'Lax'),
  COOKIE_DOMAIN: readEnv('COOKIE_DOMAIN') || undefined,
  ADMIN_GOOGLE_EMAILS: readEmailListEnv('ADMIN_GOOGLE_EMAILS'),

  SUPABASE_DB_URL: readEnv('SUPABASE_DB_URL'),
  SUPABASE_DB_SSL:
    readBooleanEnv('SUPABASE_DB_SSL', appEnv !== 'local'),
  SUPABASE_DB_SSL_CA_PATH: readEnv('SUPABASE_DB_SSL_CA_PATH'),

  OPENAI_API_KEY: readEnv('OPENAI_API_KEY'),
  OPENAI_MODEL: readEnv('OPENAI_MODEL', { defaultValue: 'gpt-5.4-nano' }),
  OPENAI_API_TIMEOUT_MS: readIntegerEnv('OPENAI_API_TIMEOUT_MS', 10000),
  OPENAI_PROJECT_ID: readEnv('OPENAI_PROJECT_ID'),
  OPENAI_ORGANIZATION_ID: readEnv('OPENAI_ORGANIZATION_ID'),

  AI_GAME_ENABLED: readBooleanEnv('AI_GAME_ENABLED', true),
  AGENT_WORLD_ENABLED: readBooleanEnv('AGENT_WORLD_ENABLED', true),
  AI_AGENT_NAME: readEnv('AI_AGENT_NAME', { defaultValue: 'Jardineiro IA' }),
  AI_DECISION_INTERVAL_MS: readIntegerEnv('AI_DECISION_INTERVAL_MS', 4000),
  AI_SIMULATION_TICK_MS: readIntegerEnv('AI_SIMULATION_TICK_MS', 50),
  AI_MOVE_SPEED: readFloatEnv('AI_MOVE_SPEED', 3.5),
  AI_SPEECH_MAX_CHARS: readIntegerEnv('AI_SPEECH_MAX_CHARS', 80),
  AI_REASONING_EFFORT: readEnv('OPENAI_REASONING_EFFORT', { defaultValue: 'low' }),

  PLAYER_MOVE_SPEED: readFloatEnv('PLAYER_MOVE_SPEED', 8),
  PLAYER_RUN_SPEED: readFloatEnv('PLAYER_RUN_SPEED', 12.5),
  PLAYER_CHAT_MAX_CHARS: readIntegerEnv('PLAYER_CHAT_MAX_CHARS', 72),
  PLAYER_CHAT_BLOCKED_WORDS: readStringListEnv('PLAYER_CHAT_BLOCKED_WORDS'),
  PLAYER_IDLE_TIMEOUT_MS: readIntegerEnv('PLAYER_IDLE_TIMEOUT_MS', 20000),

  // V6 — API / Worker Split
  REALM_ID: readEnv('REALM_ID', { defaultValue: 'gardenquest-world-01' }),
  WORLD_COMMAND_POLL_MS: readIntegerEnv('WORLD_COMMAND_POLL_MS', 500),
  WORLD_SNAPSHOT_FLUSH_MS: readIntegerEnv('WORLD_SNAPSHOT_FLUSH_MS', 1000),
  WORLD_COMMAND_BATCH_SIZE: readIntegerEnv('WORLD_COMMAND_BATCH_SIZE', 50),
  AGENT_WORLD_REQUIRE_LEASE: readBooleanEnv('AGENT_WORLD_REQUIRE_LEASE', false),

  // V7 — SSE Realtime
  WORLD_EVENT_STREAM_ENABLED: readBooleanEnv('WORLD_EVENT_STREAM_ENABLED', true),
  WORLD_EVENT_STREAM_POLL_MS: readIntegerEnv('WORLD_EVENT_STREAM_POLL_MS', 500),
  WORLD_EVENT_STREAM_HEARTBEAT_MS: readIntegerEnv('WORLD_EVENT_STREAM_HEARTBEAT_MS', 15000),
  WORLD_EVENT_STREAM_TOUCH_MS: readIntegerEnv('WORLD_EVENT_STREAM_TOUCH_MS', 10000),

  // V9 — Postgres Notify Bus
  WORLD_RUNTIME_BUS_RECONNECT_MS: readIntegerEnv('WORLD_RUNTIME_BUS_RECONNECT_MS', 2000),

  // V10 — Governance
  AGENT_DEFAULT_DAILY_RUN_BUDGET: readIntegerEnv('AGENT_DEFAULT_DAILY_RUN_BUDGET', 5000),
  AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS: readIntegerEnv('AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS', 2000),
  AGENT_CIRCUIT_FAILURE_THRESHOLD: readIntegerEnv('AGENT_CIRCUIT_FAILURE_THRESHOLD', 5),
  AGENT_CIRCUIT_COOLDOWN_MS: readIntegerEnv('AGENT_CIRCUIT_COOLDOWN_MS', 30000),
  AGENT_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: readIntegerEnv('AGENT_PROVIDER_CIRCUIT_FAILURE_THRESHOLD', 10),
  AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS: readIntegerEnv('AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS', 60000),

  // V11 — Moderation
  AGENT_SPEECH_MAX_CHARS: readIntegerEnv('AGENT_SPEECH_MAX_CHARS', 96),
  AGENT_SPEECH_MODERATION_ENABLED: readBooleanEnv('AGENT_SPEECH_MODERATION_ENABLED', true),
  AGENT_SPEECH_ALLOW_URLS: readBooleanEnv('AGENT_SPEECH_ALLOW_URLS', false),
  AGENT_SPEECH_BLOCKLIST: readStringListEnv('AGENT_SPEECH_BLOCKLIST'),

  NODE_ENV: nodeEnv,
};

function validateRuntimeConfig(currentConfig) {
  const frontendUrl = parseAbsoluteUrl('FRONTEND_URL', currentConfig.FRONTEND_URL);
  const googleRedirectUrl = parseAbsoluteUrl('GOOGLE_REDIRECT_URI', currentConfig.GOOGLE_REDIRECT_URI);

  if (currentConfig.APP_ENV === 'local' && currentConfig.NODE_ENV !== 'development') {
    throw new Error('APP_ENV=local requires NODE_ENV=development');
  }

  if (currentConfig.APP_ENV !== 'local' && currentConfig.NODE_ENV !== 'production') {
    throw new Error('APP_ENV=staging/production requires NODE_ENV=production');
  }

  if (currentConfig.COOKIE_SAME_SITE === 'None' && !currentConfig.COOKIE_SECURE) {
    throw new Error('COOKIE_SAME_SITE=None requires COOKIE_SECURE=true');
  }

  assertRootUrl('FRONTEND_URL', frontendUrl);
  assertCallbackUrl('GOOGLE_REDIRECT_URI', googleRedirectUrl);

  if (currentConfig.APP_ENV === 'local') {
    assertLocalUrl('FRONTEND_URL', frontendUrl);
    assertLocalUrl('GOOGLE_REDIRECT_URI', googleRedirectUrl);
  } else {
    if (!currentConfig.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE must be true outside APP_ENV=local');
    }

    if (!currentConfig.SUPABASE_DB_SSL) {
      throw new Error('SUPABASE_DB_SSL must be true outside APP_ENV=local');
    }

    assertSecureRemoteUrl('FRONTEND_URL', frontendUrl);
    assertSecureRemoteUrl('GOOGLE_REDIRECT_URI', googleRedirectUrl);

    if (frontendUrl && googleRedirectUrl && frontendUrl.origin !== googleRedirectUrl.origin) {
      throw new Error('GOOGLE_REDIRECT_URI must share the same origin as FRONTEND_URL outside APP_ENV=local');
    }
  }

  validateCookieDomain(currentConfig.COOKIE_DOMAIN, frontendUrl, currentConfig.APP_ENV);
}

validateRuntimeConfig(config);

if (appEnv === 'local') {
  if (!process.env.JWT_SECRET) {
    console.warn('Using fallback JWT_SECRET in development. Set JWT_SECRET in .env before deploying.');
  }

  if (config.ADMIN_GOOGLE_EMAILS.length === 0) {
    console.warn('ADMIN_GOOGLE_EMAILS is not set. Dashboard access will be denied until it is configured.');
  }

  if (!process.env.SUPABASE_DB_URL) {
    console.warn('SUPABASE_DB_URL is not set. Database-backed logging will not work until it is configured.');
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set. The AI player will use deterministic fallback logic until configured.');
  }
}

if (appEnv !== 'local') {
  if (!process.env.FRONTEND_URL) {
    console.warn('FRONTEND_URL is not set. Auth redirects will stay on the backend origin until it is configured.');
  }

  if (!process.env.GOOGLE_REDIRECT_URI) {
    console.warn('GOOGLE_REDIRECT_URI is not set. Google OAuth will not work until it is configured.');
  }
}

module.exports = config;
