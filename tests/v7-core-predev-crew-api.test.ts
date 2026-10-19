// //TR: Bu test FA-V2-PRODUCT (CORE-8) pre-dev + crew salt-okunur okuma API'sinin dikey kesitini doğrular: (1) CONTROL-API — GET /v1/predev/:missionId GERÇEK CORE-2 pre-dev okuma-modelini (faz + artefakt başına durum) döner; dizi yoksa dürüst NOT_STARTED/boş, GERÇEK crew koşusundan sonra kayıttan AYNEN APPROVED (yükseltme/uydurma yok); GET /v1/crew/:missionId GERÇEK CORE-5 koordinasyon ledger'ını (pre-dev artefaktlarından) + CORE-6 dev/review zaman çizelgesini (mission run'larından) döner; pre-dev/run yoksa dürüst tüm-ASSIGNED/boş. İkisi de geçersiz kimlikte 400, bilinmeyen/başka tenant mission'da 404, token yoksa 403 ve POST'ta 404 (yazma yok). (2) ALLOW-LIST — apps/desktop/main.mjs B4-ALLOWLIST izole değerlendirilir ve saldırgan girdilere karşı fail-closed: yalnız kanonik msn_ + 24 hex kimliği kabul; sorgu, sondaki eğik çizgi, alt yol, yanlış önek/büyük-küçük/uzunluk, non-hex reddedilir; her POST reddedilir; EXTRA_GET_ROUTES kümesi büyümez (ux-shell/firstrun güvenlik anlık görüntüsü korunur). (3) DÜRÜSTLÜK — endpoint'ler yalnız journal'dan türetilmiş GERÇEK okuma-modellerini sunar; hiçbir pre-dev artefaktı, crew aktivitesi, onay veya verdict UYDURULMAZ ve hiçbir alan PRODUCT_VERIFIED ima etmez.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {CrewCoordinator, type ReworkDecider, type CrewStore} from "../core/workos/crew/coordinator.js";
import {buildCrewPlan} from "../core/workos/crew/assignment.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import type {ArtifactKind} from "../core/workos/predev/types.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
const APPROVER = "reviewer@local.invalid";

let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-crewapi-")); });
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(tenantId = "tA"): App {
  fs.mkdirSync(runtime(), {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId, port: 3210, logger: false});
  apps.push(app); return app;
}
const get = (app: App, url: string, headers: Record<string, string> = hdr) => app.inject({method: "GET", url, headers});

// //TR: Enjekte edilen BuilderPort: tür başına GERÇEK TaskHub fixture'ını JSON metni olarak döndürür; canlı model/ağ/shell yok (driver/koordinatör metni GERÇEK doğrulayıcıdan geçirir).
class TaskHubFixtureBuilder implements BuilderPort {
  async produce(kind: ArtifactKind, _rolePrompt: string, _ctx: MissionContext): Promise<string> { return JSON.stringify(TASKHUB_ARTIFACTS[kind]); }
}
class AcceptAllDecider implements ReworkDecider { decide(): {accept: true} { return {accept: true}; } }

// //TR: Aynı dataDir'e bir mission tohumlar (sunucu store'u aynı journal'ı yeniden okur, ikinci store yok). AUTHORIZED mission döner.
function seedMission(tenantId = "tA"): string {
  const store = new WorkOsStore(dataDir());
  const scope = {tenantId};
  const p = store.createProject({tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "TaskHub crew", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
  store.transitionMission(scope, m.missionId, "PREFLIGHT", "preflight", RECORDER);
  store.transitionMission(scope, m.missionId, "AUTHORIZED", "authorized", RECORDER);
  return m.missionId;
}
// //TR: GERÇEK CORE-5 crew koşusunu (gerçek driver + doğrulayıcı + store) PRE_DEV_COMPLETE'e kadar sürer; tüm artefaktlar GERÇEK onaylıdır. Dönüş: missionId.
async function seedCompletedCrew(tenantId = "tA"): Promise<string> {
  const store = new WorkOsStore(dataDir());
  const scope = {tenantId};
  const missionId = seedMission(tenantId);
  const builder = new TaskHubFixtureBuilder();
  const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});
  let tick = 0;
  const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder,
    decider: new AcceptAllDecider(), maxReworkPerPhase: 2, recorder: RECORDER, approver: APPROVER, now: () => `2026-10-16T00:00:${String(tick++ % 60).padStart(2, "0")}.000Z`});
  const res = await coord.run(scope, missionId);
  if (res.status !== "PRE_DEV_COMPLETE") throw new Error(`seed failed: ${res.status}`);
  return missionId;
}
const MSN = (h: string) => `msn_${h.repeat(24).slice(0, 24)}`;

// ---------------- (1) CONTROL-API: pre-dev read-only route ----------------
describe("CORE-8 — GET /v1/predev/:missionId read-only control-api route", () => {
  it("returns the honest NOT_STARTED read-model for a real mission with no pre-dev sequence", async () => {
    const missionId = seedMission();
    const app = mkApp();
    const r = await get(app, `/v1/predev/${missionId}`);
    expect(r.statusCode).toBe(200);
    const pd = r.json().predev;
    expect(pd.missionId).toBe(missionId);
    expect(pd.active).toBe(false);
    expect(pd.phase).toBe("NOT_STARTED");
    expect(pd.preDevId).toBeNull();
    for (const kind of ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"]) {
      expect(pd.artifacts[kind].state).toBe("NOT_STARTED");
      expect(pd.artifacts[kind].approved).toBe(false);
      expect(pd.artifacts[kind].artifactId).toBeNull();
    }
  });
  it("reflects the REAL journal-derived read-model after a genuine crew run (states copied verbatim; nothing elevated)", async () => {
    const missionId = await seedCompletedCrew();
    const app = mkApp();
    const pd = (await get(app, `/v1/predev/${missionId}`)).json().predev;
    expect(pd.active).toBe(true);
    expect(pd.phase).toBe("PRE_DEV_COMPLETE");
    expect(pd.preDevId).toMatch(/^pdv_[0-9a-f]{24}$/);
    // Her artefakt GERÇEKTEN APPROVED ve gerçek bir artifactId taşır (uydurma yok; verbatim).
    for (const kind of ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"]) {
      expect(pd.artifacts[kind].state, kind).toBe("APPROVED");
      expect(pd.artifacts[kind].approved, kind).toBe(true);
      expect(pd.artifacts[kind].artifactId, kind).toMatch(/^pda_[0-9a-f]{24}$/);
    }
    // Hiçbir alan PRODUCT_VERIFIED ima etmez.
    expect(JSON.stringify(pd)).not.toContain("PRODUCT_VERIFIED");
  });
  it("rejects malformed mission ids with 400 and honestly 404s an unknown mission", async () => {
    const app = mkApp();
    for (const bad of ["bad", "msn_zzz", "MSN_" + "a".repeat(24), "msn_" + "a".repeat(23), "msn_" + "a".repeat(25), "prj_" + "a".repeat(24), "msn_" + "ag".repeat(12)])
      expect((await get(app, `/v1/predev/${bad}`)).statusCode, bad).toBe(400);
    expect((await get(app, `/v1/predev/${MSN("a")}`)).statusCode).toBe(404);
  });
  it("another tenant never sees a tenant-scoped mission (404, not a leaked read-model)", async () => {
    const missionId = seedMission("tA");
    const app = mkApp("tB");
    expect((await get(app, `/v1/predev/${missionId}`)).statusCode).toBe(404);
  });
  it("requires the control token and exposes no write (POST is not a route)", async () => {
    const missionId = seedMission();
    const app = mkApp();
    expect((await get(app, `/v1/predev/${missionId}`, {host: "127.0.0.1:3210"})).statusCode).toBe(403);
    expect((await app.inject({method: "POST", url: `/v1/predev/${missionId}`, headers: hdr, payload: {}})).statusCode).toBe(404);
  });
});

// ---------------- (1) CONTROL-API: crew read-only route ----------------
describe("CORE-8 — GET /v1/crew/:missionId read-only control-api route", () => {
  it("returns an honest empty coordination ledger and no dev/review when nothing has happened", async () => {
    const missionId = seedMission();
    const app = mkApp();
    const r = await get(app, `/v1/crew/${missionId}`);
    expect(r.statusCode).toBe(200);
    const c = r.json().crew;
    expect(c.missionId).toBe(missionId);
    expect(c.preDevId).toBeNull();
    // Plan gerçeğidir: her uzman ASSIGNED, olay yok, rework yok (uydurma aktivite yok).
    expect(c.coordination.experts.length).toBe(5);
    expect(c.coordination.experts.every((e: any) => e.assignmentState === "ASSIGNED")).toBe(true);
    expect(c.coordination.events).toEqual([]);
    expect(c.coordination.reworkRequests).toEqual([]);
    expect(c.devReview).toEqual([]);
  });
  it("derives the REAL coordination ledger from genuine pre-dev artifacts (events are approvals from the journal)", async () => {
    const missionId = await seedCompletedCrew();
    const app = mkApp();
    const c = (await get(app, `/v1/crew/${missionId}`)).json().crew;
    expect(c.preDevId).toMatch(/^pdv_[0-9a-f]{24}$/);
    expect(c.coordination.experts.length).toBe(5);
    expect(c.coordination.experts.every((e: any) => e.assignmentState === "APPROVED")).toBe(true);
    // Her tür için RECORDED + SUBMITTED + APPROVED olayı gerçek kayıttan türetilir.
    const approvals = c.coordination.events.filter((e: any) => e.type === "APPROVED");
    expect(approvals.length).toBe(5);
    expect(approvals.every((e: any) => e.actor === APPROVER)).toBe(true);
    expect(JSON.stringify(c)).not.toContain("PRODUCT_VERIFIED");
  });
  it("derives an honest dev/review timeline from a real run with no evidence (no fabricated verdict)", async () => {
    const missionId = seedMission();
    const store = new WorkOsStore(dataDir());
    const run = store.createRun({tenantId: "tA", missionId, executor: {implementer: "UASCO-0001", reviewer: "UASCO-0002"}, createdBy: RECORDER});
    const app = mkApp();
    const c = (await get(app, `/v1/crew/${missionId}`)).json().crew;
    expect(c.devReview.length).toBe(1);
    expect(c.devReview[0].runId).toBe(run.runId);
    expect(c.devReview[0].developerRoleId).toBe("UASCO-0001");
    expect(c.devReview[0].reviewerRoleId).toBe("UASCO-0002");
    expect(c.devReview[0].versions).toEqual([]);     // kanıt yok => sürüm yok
    expect(c.devReview[0].finalVerdict).toBe("NONE"); // verdict uydurulmaz
    expect(c.devReview[0].delivery).toBeNull();
  });
  it("rejects malformed ids (400), 404s unknown and other-tenant missions, requires token, and exposes no write", async () => {
    const missionId = seedMission("tA");
    for (const bad of ["bad", "msn_" + "a".repeat(23), "MSN_" + "a".repeat(24), "msn_" + "ag".repeat(12)])
      expect((await get(mkApp(), `/v1/crew/${bad}`)).statusCode, bad).toBe(400);
    expect((await get(mkApp(), `/v1/crew/${MSN("b")}`)).statusCode).toBe(404);
    expect((await get(mkApp("tB"), `/v1/crew/${missionId}`)).statusCode).toBe(404);
    expect((await get(mkApp("tA"), `/v1/crew/${missionId}`, {host: "127.0.0.1:3210"})).statusCode).toBe(403);
    expect((await (mkApp("tA")).inject({method: "POST", url: `/v1/crew/${missionId}`, headers: hdr, payload: {}})).statusCode).toBe(404);
  });
});

// ---------------- (2) ALLOW-LIST (adversarial, isolated) ----------------
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string, ret: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return new Function(`${m![1]}\nreturn ${ret};`)() as (v: unknown) => boolean;
};
const ID = "ab".repeat(12); // 24 hex

describe("CORE-8 — read-only pre-dev/crew allow-list is fail-closed", () => {
  const getAllowed = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed");
  const postAllowed = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed");

  it("accepts exactly the two canonical read-only detail paths", () => {
    expect(getAllowed(`/v1/predev/msn_${ID}`)).toBe(true);
    expect(getAllowed(`/v1/crew/msn_${ID}`)).toBe(true);
  });
  it("rejects wrong prefix, wrong case, wrong length, non-hex and query on the mission id", () => {
    for (const base of ["predev", "crew"]) {
      const bad = [
        `/v1/${base}/msn_${ID}`.replace("msn_", "MSN_"),
        `/v1/${base}/msn_${"ab".repeat(11)}`,   // 22 hex
        `/v1/${base}/msn_${"ab".repeat(13)}`,   // 26 hex
        `/v1/${base}/prj_${ID}`,                // wrong prefix
        `/v1/${base}/msn_${"ag".repeat(12)}`,   // non-hex 'g'
        `/v1/${base}/${ID}`,                    // no prefix at all
        `/v1/${base}/msn_${ID}?x=1`,            // query
        `/v1/${base}/msn_${ID}?missionId=msn_${ID}`,
      ];
      for (const p of bad) expect(getAllowed(p), p).toBe(false);
    }
  });
  it("rejects trailing slashes, sub-paths, the bare collection and near-miss prefixes", () => {
    const bad = [
      `/v1/predev/msn_${ID}/`, `/v1/crew/msn_${ID}/`,
      `/v1/predev/msn_${ID}/artifacts`, `/v1/crew/msn_${ID}/ledger`,
      "/v1/predev", "/v1/crew", "/v1/predev/", "/v1/crew/",
      `/v1/predevs/msn_${ID}`, `/v1/crews/msn_${ID}`, `/v1/predev-x/msn_${ID}`,
    ];
    for (const p of bad) expect(getAllowed(p), p).toBe(false);
  });
  it("never allows a write (POST) to any pre-dev or crew path", () => {
    for (const p of [`/v1/predev/msn_${ID}`, `/v1/crew/msn_${ID}`]) expect(postAllowed(p), `POST ${p}`).toBe(false);
  });
  it("does NOT grow the EXTRA_GET_ROUTES set (security snapshot stays frozen; the two routes are admitted by dedicated patterns)", () => {
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set.includes("/v1/predev")).toBe(false);
    expect(set.includes("/v1/crew")).toBe(false);
  });
});
