// //TR: Küçük salt okunur izleme deposu: enjekte okuyucudan canlı okur, hata/çevrimdışı durumda yalnız STALE önbelleği gösterir; yazma, onay, STOP veya RESUME yöntemi yoktur.
import { classifyCached, dropsCache, type CachedRead } from "./stale-cache.js";
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
  const latest = new Map<string, number>();
  const listeners = new Set<() => void>();
  const set = (id: string, s: Snapshot) => { snaps.set(id, s); for (const l of [...listeners]) l(); return s; };
  const cachedOf = async (route: MobileRoute, key: string): Promise<CachedRead> => {
    try {
      const e = await reader.readCache(route, key);
      // An entry for another route or key must never be shown for this request.
      return classifyCached(e !== null && e.route === route && e.key === key ? e : null, now());
    }
    catch { return classifyCached(null, now()); }
  };
  return {
    get: (route, key = "") => snaps.get(k(route, key)) ?? { status: "LOADING" },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh(route, key = "") {
      const id = k(route, key);
      const seq = (latest.get(id) ?? 0) + 1;
      latest.set(id, seq);
      // An older response must never overwrite a newer snapshot on the same route/key.
      const commit = (s: Snapshot): Snapshot => (latest.get(id) === seq ? set(id, s) : (snaps.get(id) ?? { status: "LOADING" }));
      let res;
      try { res = await reader.readLive(route, key); }
      catch { return commit({ status: "ERROR", code: "READER_THREW", cached: await cachedOf(route, key) }); }
      switch (res.kind) {
        case "ok": return commit({ status: "LIVE", envelope: res.envelope, receivedAtMs: now() });
        case "offline": return commit({ status: "OFFLINE", reason: res.reason, cached: dropsCache(res.reason) ? classifyCached(null, now()) : await cachedOf(route, key) });
        case "denied": return commit({ status: "DENIED", code: res.code });
        default: return commit({ status: "ERROR", code: res.code, cached: await cachedOf(route, key) });
      }
    },
  };
}
