// //TR: Bu dosya Day-0 için in-memory Resource Registry sağlar; ilerleyen state/persistence fazında transactional persistent registry ile değiştirilmek üzere interface'i sabitler.
import type { ExecutionResource } from "./types.js";

export class ResourceRegistry {
  #items = new Map<string, ExecutionResource>();

  register(resource: ExecutionResource): void {
    if (this.#items.has(resource.id)) throw new Error(`Resource already exists: ${resource.id}`);
    this.#items.set(resource.id, structuredClone(resource));
  }

  get(id: string): ExecutionResource | undefined {
    const value = this.#items.get(id);
    return value ? structuredClone(value) : undefined;
  }

  findByCapability(capability: string): ExecutionResource[] {
    return [...this.#items.values()]
      .filter(r => r.health === "READY" && r.capabilities.includes(capability))
      .map(r => structuredClone(r));
  }

  list(): ExecutionResource[] {
    return [...this.#items.values()].map(r => structuredClone(r));
  }
}
