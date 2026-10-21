// //TR: Mobil izleme çekirdeği testleri: dürüst durumlar, STALE asla taze değil, NOT_CONNECTED eşlemesi, eylem/yazma yüzeyi yok (negatif durumlar dahil).
import { describe, expect, it } from "vitest";
import { createMonitoringStore } from "./monitoring-store.js";
import { classifyCached, formatAge, MAX_CACHE_AGE_MS } from "./stale-cache.js";
import { agentTrackingViewModel, frameOf, homeViewModel, offlineViewModel, taskFlowViewModel } from "./view-models.js";
import { MOBILE_ROUTES, ROUTE_CONNECTION, type CacheEntry, type Envelope, type LiveResult, type MobileRoute, type MonitoringReader } from "./types.js";

const NOW = 1_800_000_000_000;
const env = (route: MobileRoute, data: unknown, state: Envelope["state"] = "VERIFIED"): Envelope =>
  ({ contract: "uasco.mobile.v1", route, generatedAt: "2026-10-21T00:00:00.000Z", state, journal: { state: "OK", seq: 7 }, data });
const entry = (route: MobileRoute, e: Envelope, ageMs: number): CacheEntry => ({ route, key: "", fetchedAtMs: NOW - ageMs, envelope: e });
function reader(live: LiveResult | Error, cache: CacheEntry | null | Error = null): MonitoringReader {
  return {
    readLive: async () => { if (live instanceof Error) throw live; return live; },
    readCache: async () => { if (cache instanceof Error) throw cache; return cache; },
  };
}
const store = (r: MonitoringReader) => createMonitoringStore(r, () => NOW);
const SUMMARY = { globalStop: { active: false, reason: null }, journal: { state: "OK" }, projects: { count: 3 }, missions: { total: 5 }, awaitingApproval: { count: 2 }, workforce: { activeWorkerRuns: 1 } };

describe("stale-cache", () => {
  it("labels cached reads STALE with age, even if stored VERIFIED", () => {
    const c = classifyCached(entry("summary", env("summary", SUMMARY), 12 * 60_000), NOW);
    expect(c.state).toBe("STALE"); expect(c.ageMs).toBe(720_000); expect(c.ageLabel).toBe("12 min ago");
  });
  it("missing entry is UNAVAILABLE, not fresh", () => { expect(classifyCached(null, NOW).state).toBe("UNAVAILABLE"); });
  it("too old is UNAVAILABLE and drops the data", () => {
    const c = classifyCached(entry("summary", env("summary", SUMMARY), MAX_CACHE_AGE_MS + 1), NOW);
    expect(c.state).toBe("UNAVAILABLE"); expect(c.envelope).toBeNull();
  });
  it("clock moved backwards: still STALE, age unknown", () => {
    const c = classifyCached({ ...entry("summary", env("summary", SUMMARY), 0), fetchedAtMs: NOW + 5000 }, NOW);
    expect(c.state).toBe("STALE"); expect(c.ageMs).toBeNull(); expect(c.ageLabel).toBe("unknown age");
  });
  it("NaN fetch time is UNAVAILABLE", () => { expect(classifyCached({ ...entry("summary", env("summary", {}), 0), fetchedAtMs: NaN }, NOW).state).toBe("UNAVAILABLE"); });
  it("formats ages", () => { expect(formatAge(5000)).toBe("5 s ago"); expect(formatAge(3 * 3600_000)).toBe("3 h ago"); expect(formatAge(3 * 86400_000)).toBe("3 d ago"); });
});

describe("monitoring-store", () => {
  it("starts LOADING", () => { expect(store(reader({ kind: "error", code: "X" })).get("summary").status).toBe("LOADING"); });
  it("live ok -> LIVE, notifies subscribers, unsubscribe works", async () => {
    const s = store(reader({ kind: "ok", envelope: env("summary", SUMMARY) })); let n = 0;
    const off = s.subscribe(() => { n++; });
    expect((await s.refresh("summary")).status).toBe("LIVE"); expect(n).toBe(1);
    off(); await s.refresh("summary"); expect(n).toBe(1);
  });
  it("offline with cache -> STALE frame with age, never VERIFIED", async () => {
    const s = store(reader({ kind: "offline", reason: "UNREACHABLE" }, entry("summary", env("summary", SUMMARY), 600_000)));
    const f = frameOf("summary", await s.refresh("summary"));
    expect(f.state).toBe("STALE"); expect(f.staleAgeLabel).toBe("10 min ago"); expect(f.banner).toBe("UNREACHABLE");
  });
  it("offline without cache -> OFFLINE", async () => {
    const f = frameOf("summary", await store(reader({ kind: "offline", reason: "UNREACHABLE" })).refresh("summary"));
    expect(f.state).toBe("OFFLINE"); expect("data" in f).toBe(false);
  });
  it("error with cache -> STALE; without -> ERROR", async () => {
    expect(frameOf("summary", await store(reader({ kind: "error", code: "E" }, entry("summary", env("summary", SUMMARY), 1000))).refresh("summary")).state).toBe("STALE");
    expect(frameOf("summary", await store(reader({ kind: "error", code: "E" })).refresh("summary")).state).toBe("ERROR");
  });
  it("denied never falls back to cache", async () => {
    const f = frameOf("summary", await store(reader({ kind: "denied", code: "MOBILE_SCOPE_INSUFFICIENT" }, entry("summary", env("summary", SUMMARY), 1))).refresh("summary"));
    expect(f.state).toBe("DENIED"); expect("data" in f).toBe(false);
  });
  it("reader throwing and cache throwing degrade to ERROR, not a crash", async () => {
    expect(frameOf("summary", await store(reader(new Error("boom"), new Error("disk"))).refresh("summary")).state).toBe("ERROR");
  });
  it("exposes no write, approve, stop, resume or retry-queue method", () => {
    const keys = Object.keys(store(reader({ kind: "error", code: "E" }))).sort();
    expect(keys).toEqual(["get", "refresh", "subscribe"]);
    expect(keys.join()).not.toMatch(/approve|stop|resume|queue|post|write|deploy/i);
  });
});

describe("view-models", () => {
  const live = (route: MobileRoute, data: unknown, state: Envelope["state"] = "VERIFIED") => ({ status: "LIVE", envelope: env(route, data, state), receivedAtMs: NOW } as const);
  it("home maps fields and marks every field NOT_CONNECTED", () => {
    const h = homeViewModel(live("summary", SUMMARY));
    expect(h.frame.state).toBe("VERIFIED"); expect(h.projectsCount.value).toBe(3); expect(h.awaitingApprovalCount.value).toBe(2);
    expect(h.globalStopActive.value).toBe(false);
    for (const f of [h.projectsCount, h.missionsTotal, h.journalState, h.activeWorkerRuns, h.runsByStatus]) { expect(f.connection).toBe("NOT_CONNECTED"); expect(f.route).toBe("summary"); }
    expect(h.scopeNotice).toContain("not Cloud production");
  });
  it("home missing data is null, never 0; runsByStatus always null", () => {
    const h = homeViewModel(live("summary", { projects: {} }));
    expect(h.projectsCount.value).toBeNull(); expect(h.missionsTotal.value).toBeNull(); expect(h.globalStopActive.value).toBeNull();
    expect(h.runsByStatus.value).toBeNull();
  });
  it("home exposes no approval items or action controls", () => {
    const h = homeViewModel(live("summary", { ...SUMMARY, awaitingApproval: { count: 1, items: [{ title: "x" }] } }));
    expect(JSON.stringify(h)).not.toContain('"items"'); expect(JSON.stringify(h)).not.toMatch(/accept|reject|approve/i);
  });
  it("home on cached read is STALE with age, not VERIFIED", () => {
    const h = homeViewModel({ status: "OFFLINE", reason: "UNREACHABLE", cached: classifyCached(entry("summary", env("summary", SUMMARY), 3600_000), NOW) });
    expect(h.frame.state).toBe("STALE"); expect(h.frame.staleAgeLabel).toBe("1 h ago"); expect(h.projectsCount.value).toBe(3);
  });
  it("server STALE stays STALE; UNKNOWN is not promoted to VERIFIED", () => {
    expect(frameOf("summary", live("summary", SUMMARY, "STALE")).state).toBe("STALE");
    expect(frameOf("summary", live("summary", SUMMARY, "UNKNOWN")).state).not.toBe("VERIFIED");
  });
  it("server UNAVAILABLE / ERROR / phone-only OFFLINE from server", () => {
    expect(frameOf("summary", live("summary", null, "UNAVAILABLE")).state).toBe("UNAVAILABLE");
    expect(frameOf("summary", live("summary", null, "ERROR")).state).toBe("ERROR");
    expect(frameOf("summary", live("summary", SUMMARY, "OFFLINE")).state).toBe("ERROR");
  });
  it("LOADING and EMPTY", () => {
    expect(frameOf("runs", { status: "LOADING" }).state).toBe("LOADING");
    expect(taskFlowViewModel(live("runs", { items: [] })).frame.state).toBe("EMPTY");
  });
  it("task flow: startedAt is always null, items mapped, cursor passed", () => {
    const env2 = { ...env("runs", { items: [{ runId: "r1", missionId: "m1", status: "RUNNING", createdAt: "t", startedAt: "fake", outcome: { code: "OK" }, delivery: { state: "NONE" } }] }), page: { limit: 25, nextCursor: "c2", truncated: false } };
    const t = taskFlowViewModel({ status: "LIVE", envelope: env2, receivedAtMs: NOW });
    expect(t.items[0]!.runId.value).toBe("r1"); expect(t.items[0]!.startedAt.value).toBeNull(); expect(t.items[0]!.outcomeCode.value).toBe("OK");
    expect(t.items[0]!.runId.connection).toBe("NOT_CONNECTED"); expect(t.nextCursor).toBe("c2");
  });
  it("task flow tolerates malformed data", () => {
    expect(taskFlowViewModel(live("runs", { items: [null, 5, "x"] })).items[0]!.runId.value).toBeNull();
    expect(taskFlowViewModel(live("runs", "garbage")).frame.state).toBe("EMPTY");
  });
  it("agent tracking: expired lease is STALE badge, liveness and cloud sessions UNKNOWN", () => {
    const a = agentTrackingViewModel(live("workers", { activeWorkerRuns: 2, canonicalRoles: 9, items: [
      { runId: "a", executorRole: "r", status: "RUNNING", leaseExpiresAt: new Date(NOW - 1000).toISOString() },
      { runId: "b", executorRole: "r", status: "RUNNING", leaseExpiresAt: new Date(NOW + 1000).toISOString() },
      { runId: "c", executorRole: "r", status: "RUNNING" }] }), NOW);
    expect(a.items.map(i => i.leaseBadge)).toEqual(["STALE", "CURRENT", "UNKNOWN"]);
    expect(a.items.every(i => i.liveness === "UNKNOWN")).toBe(true); expect(a.cloudSessions).toBe("UNKNOWN");
    expect(a.activeWorkerRuns.value).toBe(2);
  });
  it("agent tracking missing counts are null, not 0", () => {
    const a = agentTrackingViewModel(live("workers", { items: [{}] }), NOW);
    expect(a.activeWorkerRuns.value).toBeNull(); expect(a.canonicalRoles.value).toBeNull();
  });
  it("offline view: reason text, last sync age, journal at last sync, never queues writes", () => {
    const o = offlineViewModel({ status: "OFFLINE", reason: "DEVICE_REVOKED", cached: classifyCached(entry("summary", env("summary", SUMMARY), 120_000), NOW) });
    expect(o.offline).toBe(true); expect(o.reason).toBe("DEVICE_REVOKED"); expect(o.lastSyncLabel).toBe("2 min ago");
    expect(o.journalStateAtLastSync).toBe("OK"); expect(o.queuesWrites).toBe(false);
  });
  it("offline view: no cache -> no last sync; non-offline snapshot -> offline=false", () => {
    const o = offlineViewModel({ status: "OFFLINE", reason: "UNREACHABLE", cached: classifyCached(null, NOW) });
    expect(o.lastSyncLabel).toBeNull(); expect(o.cachedState).toBe("UNAVAILABLE");
    expect(offlineViewModel({ status: "LOADING" }).offline).toBe(false);
  });
});

describe("route table", () => {
  it("every MOB-3 route is NOT_CONNECTED", () => {
    for (const r of MOBILE_ROUTES) expect(ROUTE_CONNECTION[r]).toBe("NOT_CONNECTED");
  });
});
