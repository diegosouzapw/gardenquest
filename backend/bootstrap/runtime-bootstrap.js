const { SecretVault } = require('../services/crypto/SecretVault');

const LOCAL_FALLBACK_AGENT_SECRET_MASTER_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function resolveAgentSecretMasterKeyHex({ appEnv = 'local', env = process.env } = {}) {
  return env.AGENT_SECRET_MASTER_KEY_HEX
    || (appEnv === 'local' ? LOCAL_FALLBACK_AGENT_SECRET_MASTER_KEY_HEX : null);
}

function createRuntimeSecretVault({
  agentRepository,
  appEnv = 'local',
  env = process.env,
  SecretVaultClass = SecretVault,
} = {}) {
  const masterKeyHex = resolveAgentSecretMasterKeyHex({ appEnv, env });
  if (!masterKeyHex) {
    return null;
  }

  return new SecretVaultClass({
    agentRepository,
    masterKeyHex,
  });
}

async function initializeRuntimeDatabase({
  verifyDatabaseConnection,
  agentRepository = null,
  authSessionRepository = null,
  realmRepository = null,
  worldRuntimeRepository = null,
} = {}) {
  await verifyDatabaseConnection();
  await agentRepository?.ensureAgentTables?.();
  await authSessionRepository?.ensureAuthSessionTable?.();
  await realmRepository?.ensureRealmLeaseTable?.();
  await worldRuntimeRepository?.ensureWorldRuntimeTables?.();
}

module.exports = {
  LOCAL_FALLBACK_AGENT_SECRET_MASTER_KEY_HEX,
  createRuntimeSecretVault,
  initializeRuntimeDatabase,
  resolveAgentSecretMasterKeyHex,
};
