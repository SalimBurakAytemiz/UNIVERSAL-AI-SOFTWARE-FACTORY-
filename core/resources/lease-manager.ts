// //TR: Bu dosya aynı fiziksel cihaz/VM/cloud slot'un iki Mission tarafından aynı anda kullanılmasını önleyen temel lease mekanizmasını sağlar.
import type { ResourceLease } from "./types.js";

export class LeaseManager {
  #leases = new Map<string, ResourceLease>();

  acquire(resourceId: string, missionId: string, ttlMs = 15 * 60_000): ResourceLease {
    const existing = this.#leases.get(resourceId);
    if (existing && Date.parse(existing.expiresAt) > Date.now()) {
      throw new Error(`Resource is already leased: ${resourceId}`);
    }
    const now = new Date();
    const lease: ResourceLease = {
      resourceId, missionId, acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    this.#leases.set(resourceId, lease);
    return structuredClone(lease);
  }

  release(resourceId: string, missionId: string): void {
    const lease = this.#leases.get(resourceId);
    if (!lease) return;
    if (lease.missionId !== missionId) throw new Error("Lease owner mismatch");
    this.#leases.delete(resourceId);
  }
}
