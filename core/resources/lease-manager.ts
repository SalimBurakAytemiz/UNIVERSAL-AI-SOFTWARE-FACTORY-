// //TR: Bu dosya aynı fiziksel cihaz/VM/cloud slot'un iki Mission tarafından aynı anda kullanılmasını önleyen temel lease mekanizmasını sağlar.
import type { ResourceLease } from "./types.js";
const identity=(value:string,label:string)=>{if(typeof value!=="string"||!value.trim())throw new Error(`${label} is required`)};
export class LeaseManager {
  #leases = new Map<string, ResourceLease>();

  acquire(resourceId: string, missionId: string, ttlMs = 15 * 60_000): ResourceLease {
    identity(resourceId,"resourceId");identity(missionId,"missionId");
    if(!Number.isSafeInteger(ttlMs)||ttlMs<=0) throw new Error("ttlMs must be a positive safe integer");
    const existing = this.#leases.get(resourceId);
    if (existing && Date.parse(existing.expiresAt) > Date.now()) throw new Error(`Resource is already leased: ${resourceId}`);
    const now = new Date(),expiresMs=now.getTime()+ttlMs;
    if(!Number.isFinite(expiresMs)||Number.isNaN(new Date(expiresMs).getTime())) throw new Error("Lease expiry is invalid");
    const lease: ResourceLease = {resourceId, missionId, acquiredAt: now.toISOString(),expiresAt: new Date(expiresMs).toISOString()};
    this.#leases.set(resourceId, lease);return structuredClone(lease);
  }
  release(resourceId: string, missionId: string): void {
    identity(resourceId,"resourceId");identity(missionId,"missionId");
    const lease = this.#leases.get(resourceId);if (!lease) return;
    if (lease.missionId !== missionId) throw new Error("Lease owner mismatch");this.#leases.delete(resourceId);
  }
}
