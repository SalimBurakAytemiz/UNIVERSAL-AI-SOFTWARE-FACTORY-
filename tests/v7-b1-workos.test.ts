// //TR: Bu test Work OS store'unun (hash zincirli journal, snapshot yeniden kurulumu, tamper fail-closed, geçiş reddi, tenant izolasyonu, idempotency) ve yetkili intake route'larının (token, şema, Global Stop 423, policy 403) gerçek dosya I/O ile çalıştığını doğrular.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

let tmp = "";
const mk = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b1-"));
beforeEach(() => { tmp = mk(); });
afterEach(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

const proj = (tenantId = "tA") => ({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
const msn = (projectId: string, tenantId = "tA") => ({tenantId, projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1" as const, createdBy: "FOUNDER_LOCAL"});
const journalLines = (dir: string) => fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean);

describe("WorkOsStore", () => {
  it("creates project/mission/task with prefixed ids and rebuilds the snapshot after restart", () => {
    const dir = path.join(tmp, "data");
    const s1 = new WorkOsStore(dir);
    const p = s1.createProject(proj());
    const m = s1.createMission(msn(p.projectId));
    const t = s1.createTask({tenantId: "tA", missionId: m.missionId, title: "task", actor: "FOUNDER_LOCAL"});
    expect(p.projectId).toMatch(/^prj_[0-9a-f]{24}$/);
    expect(m.missionId).toMatch(/^msn_[0-9a-f]{24}$/);
    expect(m.traceId).toMatch(/^trc_[0-9a-f]{24}$/);
    expect(t.taskId).toMatch(/^tsk_[0-9a-f]{24}$/);
    expect(m.status).toBe("DRAFT");
    fs.rmSync(path.join(dir, "snapshot.json"), {force: true});
    fs.rmSync(path.join(dir, "snapshot.json.prev"), {force: true});
    const s2 = new WorkOsStore(dir);
    expect(s2.isTampered).toBe(false);
    expect(s2.getProject({tenantId: "tA"}, p.projectId)).toEqual(p);
    expect(s2.getMission({tenantId: "tA"}, m.missionId)).toEqual(m);
    expect(s2.listTasks({tenantId: "tA"}, m.missionId)).toEqual([t]);
    expect(fs.existsSync(path.join(dir, "snapshot.json"))).toBe(true);
    const lines = journalLines(dir).map(l => JSON.parse(l));
    expect(lines.map(l => l.seq)).toEqual([1, 2, 3]);
    expect(lines[0].prevHash).toBe("0".repeat(64));
    expect(lines[1].prevHash).toBe(lines[0].hash);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["actor", "at", "hash", "payload", "prevHash", "seq", "type"]);
  });

  it("fails closed on a tampered journal line and refuses writes", () => {
    const dir = path.join(tmp, "data");
    const s1 = new WorkOsStore(dir);
    const p = s1.createProject(proj());
    s1.createMission(msn(p.projectId));
    const file = path.join(dir, "journal.jsonl");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"name":"P"', '"name":"EVIL"'));
    const s2 = new WorkOsStore(dir);
    expect(s2.isTampered).toBe(true);
    expect(() => s2.createProject(proj())).toThrow(/WORKOS_JOURNAL_TAMPERED/);
    expect(() => s2.listProjects({tenantId: "tA"})).toThrow(/WORKOS_JOURNAL_TAMPERED/);
    expect(journalLines(dir).length).toBe(2);
    // the original instance also refuses to write once the disk is tampered
    expect(() => s1.createProject(proj())).toThrow(/WORKOS_JOURNAL_TAMPERED/);
  });

  it("detects a deleted journal tail and a broken chain", () => {
    const dir = path.join(tmp, "data");
    const s1 = new WorkOsStore(dir);
    const p = s1.createProject(proj());
    s1.createMission(msn(p.projectId));
    const file = path.join(dir, "journal.jsonl");
    const lines = journalLines(dir);
    fs.writeFileSync(file, lines[0] + "\n");
    expect(new WorkOsStore(dir).isTampered).toBe(true);
    fs.writeFileSync(file, lines[1] + "\n");
    expect(new WorkOsStore(dir).isTampered).toBe(true);
  });

  it("rejects an invalid mission transition without writing", () => {
    const dir = path.join(tmp, "data");
    const s = new WorkOsStore(dir);
    const p = s.createProject(proj());
    const m = s.createMission(msn(p.projectId));
    const before = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    expect(() => s.transitionMission({tenantId: "tA"}, m.missionId, "COMPLETE", "skip", "FOUNDER_LOCAL")).toThrow(/WORKOS_INVALID_TRANSITION/);
    expect(fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8")).toBe(before);
    expect(s.transitionMission({tenantId: "tA"}, m.missionId, "PREFLIGHT", "go", "FOUNDER_LOCAL").status).toBe("PREFLIGHT");
    expect(new WorkOsStore(dir).getMission({tenantId: "tA"}, m.missionId)?.status).toBe("PREFLIGHT");
  });

  it("isolates tenants", () => {
    const s = new WorkOsStore(path.join(tmp, "data"));
    const pa = s.createProject(proj("tA"));
    const ma = s.createMission(msn(pa.projectId, "tA"));
    s.createProject(proj("tB"));
    expect(s.listProjects({tenantId: "tB"}).map(p => p.projectId)).not.toContain(pa.projectId);
    expect(s.getProject({tenantId: "tB"}, pa.projectId)).toBeUndefined();
    expect(s.getMission({tenantId: "tB"}, ma.missionId)).toBeUndefined();
    expect(s.listMissions({tenantId: "tB"})).toEqual([]);
    expect(() => s.createMission(msn(pa.projectId, "tB"))).toThrow(/WORKOS_NOT_FOUND/);
    expect(() => s.transitionMission({tenantId: "tB"}, ma.missionId, "PREFLIGHT", "x", "a")).toThrow(/WORKOS_NOT_FOUND/);
  });

  it("honours idempotency keys without a second journal entry", () => {
    const dir = path.join(tmp, "data");
    const s = new WorkOsStore(dir);
    const a = s.createProject({...proj(), idempotencyKey: "k1"});
    const n = journalLines(dir).length;
    const b = s.createProject({...proj(), idempotencyKey: "k1"});
    expect(b).toEqual(a);
    expect(journalLines(dir).length).toBe(n);
    expect(new WorkOsStore(dir).createProject({...proj(), idempotencyKey: "k1"})).toEqual(a);
    expect(s.createProject({...proj("tB"), idempotencyKey: "k1"}).projectId).not.toBe(a.projectId);
    const m1 = s.createMission({...msn(a.projectId), idempotencyKey: "m"});
    expect(s.createMission({...msn(a.projectId), idempotencyKey: "m"})).toEqual(m1);
  });
});

describe("Work OS API", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = (extra: Record<string, unknown> = {}) => {
    const runtime = path.join(tmp, "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    return {runtime, app: buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false, ...extra})};
  };
  const project = {name: "API project", environmentId: "dev"};
  const mission = (projectId: string) => ({projectId, title: "M", objective: "obj", acceptanceCriteria: ["a"], riskLevel: "R2"});

  it("rejects requests without the control token", async () => {
    const {app} = mkApp();
    // existing control boundary answers 403 FORBIDDEN for a missing/wrong token (unchanged behaviour)
    const r = await app.inject({method: "GET", url: "/v1/projects", headers: {host: "127.0.0.1:3210"}});
    expect(r.statusCode).toBe(403);
    expect((await app.inject({method: "POST", url: "/v1/projects", headers: {host: "127.0.0.1:3210"}, payload: project})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/projects", headers: {...hdr, "x-uasco-control-token": "wrong"}})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/projects", headers: {...hdr, host: "evil.example:3210"}})).statusCode).toBe(421);
    await app.close();
  });

  it("round-trips create, list, get and transition and writes secret-free audit", async () => {
    const {app, runtime} = mkApp();
    const c = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(c.statusCode).toBe(201);
    const p = c.json().project;
    expect(p.createdBy).toBe("FOUNDER_LOCAL");
    expect((await app.inject({method: "GET", url: "/v1/projects", headers: hdr})).json().projects).toEqual([p]);
    const mc = await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: mission(p.projectId)});
    expect(mc.statusCode).toBe(201);
    const m = mc.json().mission;
    expect(m.status).toBe("DRAFT");
    expect((await app.inject({method: "GET", url: `/v1/missions?projectId=${p.projectId}`, headers: hdr})).json().missions).toEqual([m]);
    expect((await app.inject({method: "GET", url: `/v1/missions/${m.missionId}`, headers: hdr})).json().mission).toEqual(m);
    expect((await app.inject({method: "GET", url: "/v1/missions/msn_000000000000000000000000", headers: hdr})).statusCode).toBe(404);
    const bad = await app.inject({method: "POST", url: `/v1/missions/${m.missionId}/transition`, headers: hdr, payload: {to: "COMPLETE", reason: "skip"}});
    expect(bad.statusCode).toBe(409);
    const ok = await app.inject({method: "POST", url: `/v1/missions/${m.missionId}/transition`, headers: hdr, payload: {to: "PREFLIGHT", reason: "start"}});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mission.status).toBe("PREFLIGHT");
    const audit = fs.readFileSync(path.join(runtime, "control-api-events.jsonl"), "utf8");
    expect(audit).toContain("WORKOS_MISSION_TRANSITIONED");
    expect(audit).not.toContain(token);
    await app.close();
  });

  it("rejects schema-invalid bodies with 400 and writes nothing", async () => {
    const {app} = mkApp();
    for (const payload of [{}, {name: "x"}, {name: "x", environmentId: "dev", extra: 1}, {name: "  ", environmentId: "dev"}]) {
      expect((await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload})).statusCode).toBe(400);
    }
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: {...mission("prj_000000000000000000000000"), riskLevel: "R9"}})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: mission("prj_000000000000000000000000")})).statusCode).toBe(404);
    expect((await app.inject({method: "GET", url: "/v1/missions?projectId=bad", headers: hdr})).statusCode).toBe(400);
    expect(fs.existsSync(path.join(tmp, "data", "journal.jsonl"))).toBe(false);
    await app.close();
  });

  it("returns 423 for writes while GLOBAL_STOP is active but still serves reads", async () => {
    const {app, runtime} = mkApp();
    fs.writeFileSync(path.join(runtime, "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    const w = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(w.statusCode).toBe(423);
    expect(w.json().error).toBe("GLOBAL_STOP_ACTIVE");
    expect((await app.inject({method: "GET", url: "/v1/projects", headers: hdr})).statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmp, "data", "journal.jsonl"))).toBe(false);
    await app.close();
  });

  it("returns 403 with a reason when the action gateway denies", async () => {
    const {app} = mkApp({policyContext: {scopeAllowed: false}});
    const r = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("SCOPE_DENIED");
    expect((await app.inject({method: "GET", url: "/v1/projects", headers: hdr})).statusCode).toBe(200);
    await app.close();
  });

  it("returns 503 for a tampered journal", async () => {
    const {app} = mkApp();
    const c = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(c.statusCode).toBe(201);
    const file = path.join(tmp, "data", "journal.jsonl");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("API project", "EVIL"));
    const w = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(w.statusCode).toBe(503);
    expect(w.json().error).toBe("WORKOS_JOURNAL_TAMPERED");
    await app.close();
  });
});

// //TR: LANE-B plan: mission görev planı (sıralı görevler + bağımlılıklar) route modülü ve kalıcılık testleri.
describe("LANE-B mission task plan", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = async (stopped = false, allowed = true, tenantId = "tA") => {
    const [{default: Fastify}, {registerPlanRoutes}] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/plan.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: string[] = [];
    registerPlanRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: (e: string) => { audits.push(e); },
      workosStopped: () => stopped, workosPolicy: () => allowed ? {allowed: true} : {allowed: false, reason: "NO"},
      workosFail: (r: any, e: any) => r.code(e?.code === "WORKOS_IDEMPOTENCY_CONFLICT" ? 409 : 500).send({error: e?.code ?? "INTERNAL_ERROR"})});
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId));
    return {app, store, audits, m};
  };
  const PLAN = {tasks: [{title: "Scaffold"}, {title: "Feature", dependsOn: [0]}, {title: "Tests", dependsOn: [0, 1]}]};
  const post = (app: any, id: string, body: unknown, headers: any = hdr) => app.inject({method: "POST", url: `/v1/missions/${id}/plan`, headers, payload: body as any});

  it("persists an ordered plan with resolved dependencies, readable after restart; replay is idempotent", async () => {
    const {app, store, audits, m} = await mkApp();
    const r = await post(app, m.missionId, PLAN);
    expect(r.statusCode).toBe(201);
    const t = r.json().tasks;
    expect(t.map((x: any) => x.title)).toEqual(["Scaffold", "Feature", "Tests"]);
    expect(t[2].dependsOn).toEqual([t[0].taskId, t[1].taskId]);
    const again = await post(app, m.missionId, {tasks: [PLAN.tasks[0], PLAN.tasks[1], {title: "Tests", dependsOn: [1, 0]}]});
    expect(again.statusCode).toBe(200); expect(again.json().tasks).toEqual(t);
    expect(store.listTasks({tenantId: "tA"}, m.missionId)).toHaveLength(3);
    expect(audits).toEqual(["WORKOS_PLAN_CREATED", "WORKOS_IDEMPOTENT_REPLAY"]);
    const { app: app2 } = await mkApp().catch(() => ({app: app}));
    expect((await app2.inject({method: "GET", url: `/v1/missions/${m.missionId}/tasks`, headers: hdr})).json().tasks).toHaveLength(3);
  });
  it("rejects a different second plan, forward/self dependencies, bad bodies and non-plannable missions", async () => {
    const {app, store, m} = await mkApp();
    expect((await post(app, m.missionId, PLAN)).statusCode).toBe(201);
    const other = await post(app, m.missionId, {tasks: [{title: "Other"}]});
    expect(other.statusCode).toBe(409); expect(other.json().error).toBe("PLAN_ALREADY_EXISTS");
    const m2 = store.createMission(msn(m.projectId));
    for (const bad of [{}, {tasks: []}, {tasks: [{title: "a", dependsOn: [0]}]}, {tasks: [{title: "a"}, {title: "b", dependsOn: [1]}]}, {tasks: [{title: "a"}, {title: "b", dependsOn: [0, 0]}]}, {tasks: [{title: " "}]}, {tasks: [{title: "a", x: 1}]}])
      expect((await post(app, m2.missionId, bad)).statusCode).toBe(400);
    store.transitionMission({tenantId: "tA"}, m2.missionId, "BLOCKED", "stop", "FOUNDER_LOCAL");
    const np = await post(app, m2.missionId, {tasks: [{title: "a"}]});
    expect(np.statusCode).toBe(409); expect(np.json().error).toBe("MISSION_NOT_PLANNABLE");
    expect(store.listTasks({tenantId: "tA"}, m2.missionId)).toEqual([]);
  });
  it("enforces token, Global Stop, policy, id format, unknown mission and tenant isolation", async () => {
    const {app, m} = await mkApp();
    expect((await post(app, m.missionId, PLAN, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    expect((await post(app, "bad", PLAN)).statusCode).toBe(400);
    expect((await post(app, "msn_" + "0".repeat(24), PLAN)).statusCode).toBe(404);
    expect((await (await mkApp(true)).app.inject({method: "POST", url: `/v1/missions/${m.missionId}/plan`, headers: hdr, payload: PLAN})).statusCode).toBe(423);
    expect((await (await mkApp(false, false)).app.inject({method: "POST", url: `/v1/missions/${m.missionId}/plan`, headers: hdr, payload: PLAN})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/missions/bad/tasks", headers: hdr})).statusCode).toBe(400);
    const b = await mkApp(false, true, "tB");
    expect((await post(b.app, m.missionId, PLAN)).statusCode).toBe(404);
  });
  it("fails closed with 503 on a corrupt plan file", async () => {
    const {app, m} = await mkApp();
    fs.writeFileSync(path.join(tmp, "data", "plans.jsonl"), "{torn");
    const r = await post(app, m.missionId, PLAN);
    expect(r.statusCode).toBe(503); expect(r.json().error).toBe("PLAN_STORE_CORRUPT");
  });
});
