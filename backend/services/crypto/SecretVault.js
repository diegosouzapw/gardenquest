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

  async storeAgentSecret(agentId, secretPlaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(secretPlaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
    const fingerprint = this.buildFingerprint(secretPlaintext);

    await this.agentRepository.saveAgentSecret({ agentId, payload, fingerprint });
    return { fingerprint };
  }

  async getAgentSecret(agentId) {
    const record = await this.agentRepository.getAgentSecret(agentId);
    if (!record?.payload) {
      return null;
    }

    const raw = Buffer.from(record.payload, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  buildFingerprint(secretPlaintext) {
    return crypto.createHash('sha256').update(secretPlaintext, 'utf8').digest('hex').slice(0, 16);
  }
}

module.exports = { SecretVault };
