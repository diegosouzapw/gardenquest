const crypto = require('crypto');

class SecretVault {
  constructor({ agentRepository, masterKeyHex }) {
    if (!masterKeyHex) {
      throw new Error('AGENT_SECRET_MASTER_KEY_HEX is required for SecretVault');
    }

    const masterKey = Buffer.from(masterKeyHex, 'hex');
    if (masterKey.length !== 32) {
      throw new Error('AGENT_SECRET_MASTER_KEY_HEX must decode to 32 bytes (64 hex chars)');
    }

    this.agentRepository = agentRepository;
    this.masterKey = masterKey;
  }

  encryptSecret(secretPlaintext) {
    if (typeof secretPlaintext !== 'string' || !secretPlaintext.trim()) {
      throw new Error('Secret plaintext must be a non-empty string');
    }

    const normalizedSecret = secretPlaintext.trim();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(normalizedSecret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      payload: Buffer.concat([iv, authTag, encrypted]).toString('base64'),
      fingerprint: this.buildFingerprint(normalizedSecret),
    };
  }

  decryptPayload(payload) {
    if (typeof payload !== 'string' || !payload.trim()) {
      return null;
    }

    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  async storeAgentSecret(agentId, secretPlaintext) {
    const encrypted = this.encryptSecret(secretPlaintext);
    await this.agentRepository.saveAgentSecret({
      agentId,
      payload: encrypted.payload,
      fingerprint: encrypted.fingerprint,
    });
    return { fingerprint: encrypted.fingerprint };
  }

  async getAgentSecret(agentId) {
    const record = await this.agentRepository.getAgentSecret(agentId);
    if (!record?.payload) {
      return null;
    }
    return this.decryptPayload(record.payload);
  }

  buildFingerprint(secretPlaintext) {
    return crypto.createHash('sha256').update(secretPlaintext, 'utf8').digest('hex').slice(0, 16);
  }
}

module.exports = { SecretVault };
