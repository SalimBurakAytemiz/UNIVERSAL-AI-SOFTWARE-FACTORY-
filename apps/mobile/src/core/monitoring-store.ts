// //TR: Küçük salt okunur izleme deposu: enjekte okuyucudan canlı okur, hata/çevrimdışı durumda yalnız STALE önbelleği gösterir; yazma, onay, STOP veya RESUME yöntemi yoktur.
import { classifyCached, type CachedRead } from "./stale-cache.js";
import type { Clock, Envelope, MobileRoute, MonitoringReader, OfflineReason } from "./types.js";

export type Snapshot =
  | { readonly status: "LOADING" }
  | { readonly status: "LIVE"; readonly envelope: Envelope; readonly receivedAtMs: number }
  | { readonly status: "OFFLINE"; readonly reason: OfflineReason; readonly cached: CachedRead }
  | { readonly status: "ERROR"; readonly code: string; readonly cached: CachedRead }
  | { readonly status: "DENIED"; readonly code: string };

export interface MonitoringStore {
  get(route: MobileRoute, key?: string): Snapshot;
  refresh(route: MobileRoute, key?: string): Promise<Snapshot>;
  subscribe(listener: () => void): () => void;
}

const k = (route: MobileRoute, key: string) => `${route}|${key}`;

export function createMonitoringStore(reader: MonitoringReader, now: Clock): MonitoringStore {
  const snaps = new Map<string, Snapshot>();
  const listeners = new Set<() => void>();
  const set = (id: string, s: Snapshot) => { snaps.set(id, s); for (const l of [...listeners]) l(); return s; };
  const cachedOf = async (route: MobileRoute, key: string): Promise<CachedRead> => {
    try { return classifyCached(await reader.readCache(route, key), now()); }
    catch { return classifyCached(null, now()); }
  };
  return {
    get: (route, key = "") => snaps.get(k(route, key)) ?? { status: "LOADING" },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh(route, key = "") {
      const id = k(route, key);
      let res;
      try { res = await reader.readLive(route, key); }
      catch { return set(id, { status: "ERROR", code: "READER_THREW", cached: await cachedOf(route, key) }); }
      switch (res.kind) {
        case "ok": return set(id, { status: "LIVE", envelope: res.envelope, receivedAtMs: now() });
        case "offline": return set(id, { status: "OFFLINE", reason: res.reason, cached: await cachedOf(route, key) });
        case "denied": return set(id, { status: "DENIED", code: res.code });
        default: return set(id, { status: "ERROR", code: res.code, cached: await cachedOf(route, key) });
      }
    },
  };
}
