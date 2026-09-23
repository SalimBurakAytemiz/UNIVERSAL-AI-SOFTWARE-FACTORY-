// //TR: Bu dosya Day-0 için in-memory Resource Registry sağlar; runtime girdilerini kimlik/health/capability açısından fail-closed doğrular.
import type { ExecutionResource,ResourceHealth } from "./types.js";
const HEALTH=new Set<ResourceHealth>(["UNKNOWN","READY","DEGRADED","QUARANTINED","OFFLINE","MISSING_TOOL","NO_CREDENTIAL"]);
const nonEmpty=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>0;
export class ResourceRegistry {
  #items = new Map<string, ExecutionResource>();
  register(resource: ExecutionResource): void {
    if(!resource||!nonEmpty(resource.id)||!nonEmpty(resource.kind))throw new Error("Resource identity invalid");
    if(!HEALTH.has(resource.health))throw new Error("Resource health invalid");
    if(!Array.isArray(resource.capabilities)||resource.capabilities.some(x=>!nonEmpty(x)))throw new Error("Resource capabilities invalid");
    if(new Set(resource.capabilities).size!==resource.capabilities.length)throw new Error("Resource capabilities duplicate");
    if (this.#items.has(resource.id)) throw new Error(`Resource already exists: ${resource.id}`);
    this.#items.set(resource.id, structuredClone(resource));
  }
  get(id: string): ExecutionResource | undefined {if(!nonEmpty(id))throw new Error("Resource id invalid");const value=this.#items.get(id);return value?structuredClone(value):undefined}
  findByCapability(capability: string): ExecutionResource[] {if(!nonEmpty(capability))throw new Error("Capability invalid");return [...this.#items.values()].filter(r=>r.health==="READY"&&r.capabilities.includes(capability)).map(r=>structuredClone(r))}
  list(): ExecutionResource[] {return [...this.#items.values()].map(r=>structuredClone(r))}
}
