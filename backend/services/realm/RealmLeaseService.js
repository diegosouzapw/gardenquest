const crypto = require('crypto');
const os = require('os');

function buildDefaultInstanceId() {
  const hostname = os.hostname() || 'localhost';
  const revision = process.env.K_REVISION || process.env.K_SERVICE || 'local';
  return `${revision}:${hostname}:${process.pid}`;
}

class RealmLeaseService {
  constructor({
    realmRepository,
    realmId = 'gardenquest-world-01',
    ownerInstanceId = buildDefaultInstanceId(),
    leaseTtlMs = 20000,
    onLeaseAcquired = null,
    onLeaseLost = null,
    logger = console,
  } = {}) {
    this.realmRepository = realmRepository;
    this.realmId = realmId;
    this.ownerInstanceId = ownerInstanceId;
    this.leaseTtlMs = Math.max(3000, Number(leaseTtlMs) || 20000);
    this.onLeaseAcquired = typeof onLeaseAcquired === 'function' ? onLeaseAcquired : null;
    this.onLeaseLost = typeof onLeaseLost === 'function' ? onLeaseLost : null;
    this.logger = logger;
    this.currentLeaseToken = null;
    this.snapshot = {
      realmId: this.realmId,
      ownerInstanceId: null,
      isLeader: false,
      leaseToken: null,
      expiresAt: null,
      renewedAt: null,
      acquiredAt: null,
      metaJson: {},
      lastError: null,
      checkedAt: null,
      lastHeartbeatAt: null,
    };
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      realmId: this.realmId,
      localInstanceId: this.ownerInstanceId,
      ttlMs: this.leaseTtlMs,
    };
  }

  isLeader() {
    return Boolean(this.snapshot.isLeader);
  }

  notifyLeaseEvent(kind, snapshot) {
    const handler = kind === 'acquired' ? this.onLeaseAcquired : this.onLeaseLost;
    if (!handler) {
      return;
    }

    try {
      const maybePromise = handler(snapshot);
      Promise.resolve(maybePromise).catch((error) => {
        this.logger.error(`Realm lease ${kind} callback failed:`, error.message);
      });
    } catch (error) {
      this.logger.error(`Realm lease ${kind} callback failed:`, error.message);
    }
  }

  async heartbeat() {
    if (!this.realmRepository?.acquireOrRenewRealmLease) {
      return this.getSnapshot();
    }

    const wasLeader = Boolean(this.snapshot?.isLeader);
    const proposedToken = this.currentLeaseToken || crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.leaseTtlMs);
    const lease = await this.realmRepository.acquireOrRenewRealmLease({
      realmId: this.realmId,
      ownerInstanceId: this.ownerInstanceId,
      leaseToken: proposedToken,
      expiresAt,
      metaJson: {
        hostname: os.hostname(),
        pid: process.pid,
        revision: process.env.K_REVISION || null,
        service: process.env.K_SERVICE || null,
        checkedAt: new Date().toISOString(),
      },
    });

    const isLeader = Boolean(
      lease
      && lease.ownerInstanceId === this.ownerInstanceId
      && lease.leaseToken === proposedToken
    );

    this.currentLeaseToken = isLeader ? proposedToken : null;
    this.snapshot = {
      realmId: lease?.realmId || this.realmId,
      ownerInstanceId: lease?.ownerInstanceId || null,
      isLeader,
      leaseToken: isLeader ? proposedToken : null,
      expiresAt: lease?.expiresAt || null,
      renewedAt: lease?.renewedAt || null,
      acquiredAt: lease?.acquiredAt || null,
      metaJson: lease?.metaJson || {},
      lastError: null,
      checkedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };

    if (!wasLeader && isLeader) {
      this.logger.info(`Realm lease acquired for ${this.realmId} by ${this.ownerInstanceId}`);
      this.notifyLeaseEvent('acquired', this.getSnapshot());
    }
    if (wasLeader && !isLeader) {
      this.logger.warn(`Realm lease lost for ${this.realmId} by ${this.ownerInstanceId}`);
      this.notifyLeaseEvent('lost', this.getSnapshot());
    }

    return this.getSnapshot();
  }

  async refreshFollowerSnapshot() {
    if (!this.realmRepository?.getRealmLease) {
      return this.getSnapshot();
    }

    try {
      const lease = await this.realmRepository.getRealmLease(this.realmId);
      this.snapshot = {
        realmId: lease?.realmId || this.realmId,
        ownerInstanceId: lease?.ownerInstanceId || null,
        isLeader: Boolean(this.currentLeaseToken && lease?.ownerInstanceId === this.ownerInstanceId && lease?.leaseToken === this.currentLeaseToken),
        leaseToken: this.currentLeaseToken,
        expiresAt: lease?.expiresAt || null,
        renewedAt: lease?.renewedAt || null,
        acquiredAt: lease?.acquiredAt || null,
        metaJson: lease?.metaJson || {},
        lastError: null,
        checkedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      };
      return this.getSnapshot();
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        lastError: error.message,
        checkedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      };
      return this.getSnapshot();
    }
  }

  async release() {
    if (!this.currentLeaseToken || !this.realmRepository?.releaseRealmLease) {
      return false;
    }

    try {
      const wasLeader = Boolean(this.snapshot?.isLeader);
      const released = await this.realmRepository.releaseRealmLease({
        realmId: this.realmId,
        ownerInstanceId: this.ownerInstanceId,
        leaseToken: this.currentLeaseToken,
      });

      this.currentLeaseToken = null;
      this.snapshot = {
        ...this.snapshot,
        isLeader: false,
        ownerInstanceId: released ? null : this.snapshot.ownerInstanceId,
        leaseToken: null,
        expiresAt: null,
        renewedAt: null,
        checkedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      };

      if (wasLeader) {
        this.notifyLeaseEvent('lost', this.getSnapshot());
      }

      return released;
    } catch (error) {
      this.logger.error('Failed to release realm lease:', error.message);
      return false;
    }
  }
}

module.exports = { RealmLeaseService, buildDefaultInstanceId };
