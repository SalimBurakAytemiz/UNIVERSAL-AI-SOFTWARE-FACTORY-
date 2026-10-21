// //TR: Bu test Work OS store'unun (hash zincirli journal, snapshot yeniden kurulumu, tamper fail-closed, geçiş reddi, tenant izolasyonu, idempotency) ve yetkili intake route'larının (token, şema, Global Stop 423, policy 403) gerçek dosya I/O ile çalıştığını doğrular.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (test yardımcı olarak geçerli hash'li journal satırı üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";
import {buildServer} from "../apps/control-api/src/server.js";

let tmp = "";
const mk = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b1-"));
beforeEach(() => { tmp = mk(); });
afterEach(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

const proj = (tenantId = "tA") => ({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
const msn = (projectId: string, tenantId = "tA") => ({tenantId, projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1" as const, createdBy: "FOUNDER_LOCAL"});
const journalLines = (dir: string) => fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean);
const sha256 = sha256Untyped as (v: unknown) => string;
// Appends a correctly hashed and chained entry, so only the store's semantic replay checks can reject it.
const appendForged = (dir: string, type: string, payload: Record<string, unknown>) => {
  const lines = journalLines(dir), last = JSON.parse(lines[lines.length - 1]);
  const body = {seq: last.seq + 1, prevHash: last.hash, type, actor: "FORGED", at: new Date().toISOString(), payload};
  fs.appendFileSync(path.join(dir, "journal.jsonl"), JSON.stringify({...body, hash: sha256(body)}) + "\n");
  fs.rmSync(path.join(dir, "snapshot.json"), {force: true});
};

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

  it("task status transitions: allowlisted, dependency-gated, journaled and replayed after restart", () => {
    const dir = path.join(tmp, "data");
    const s = new WorkOsStore(dir), sc = {tenantId: "tA"};
    const p = s.createProject(proj());
    const m = s.createMission(msn(p.projectId));
    const a = s.createTask({tenantId: "tA", missionId: m.missionId, title: "design", actor: "FOUNDER_LOCAL"});
    const b = s.createTask({tenantId: "tA", missionId: m.missionId, title: "build", dependsOn: [a.taskId], actor: "FOUNDER_LOCAL"});
    // b depends on a: it cannot start before a is DONE, and nothing is written
    const before = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    expect(() => s.transitionTask(sc, b.taskId, "IN_PROGRESS", "start", "FOUNDER_LOCAL")).toThrow(/WORKOS_CONFLICT: TASK_DEPENDENCIES_NOT_DONE/);
    expect(fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8")).toBe(before);
    expect(s.transitionTask(sc, a.taskId, "IN_PROGRESS", "start", "FOUNDER_LOCAL").status).toBe("IN_PROGRESS");
    expect(() => s.transitionTask(sc, b.taskId, "IN_PROGRESS", "start", "FOUNDER_LOCAL")).toThrow(/TASK_DEPENDENCIES_NOT_DONE/);
    expect(s.transitionTask(sc, a.taskId, "DONE", "tests pass", "FOUNDER_LOCAL").status).toBe("DONE");
    expect(s.transitionTask(sc, b.taskId, "IN_PROGRESS", "start", "FOUNDER_LOCAL").status).toBe("IN_PROGRESS");
    expect(s.transitionTask(sc, b.taskId, "BLOCKED", "waiting on input", "FOUNDER_LOCAL").status).toBe("BLOCKED");
    expect(s.transitionTask(sc, b.taskId, "PENDING", "input received", "FOUNDER_LOCAL").status).toBe("PENDING");
    const entries = journalLines(dir).map(l => JSON.parse(l)).filter(e => e.type === "TASK_TRANSITIONED");
    expect(entries.map(e => [e.payload.taskId === a.taskId ? "a" : "b", e.payload.from, e.payload.to])).toEqual([["a", "PENDING", "IN_PROGRESS"], ["a", "IN_PROGRESS", "DONE"],
      ["b", "PENDING", "IN_PROGRESS"], ["b", "IN_PROGRESS", "BLOCKED"], ["b", "BLOCKED", "PENDING"]]);
    expect(entries.every(e => e.payload.tenantId === "tA" && e.actor === "FOUNDER_LOCAL")).toBe(true);
    // a fresh store replays the same state from the journal alone
    fs.rmSync(path.join(dir, "snapshot.json"), {force: true});
    const s2 = new WorkOsStore(dir);
    expect(s2.listTasks(sc, m.missionId).map(t => [t.title, t.status]).sort()).toEqual([["build", "PENDING"], ["design", "DONE"]]);
    expect(s2.getTask(sc, a.taskId)?.status).toBe("DONE");
  });

  it("task status transitions: refused without a write (illegal, terminal, bad input, other tenant, completed mission)", () => {
    const dir = path.join(tmp, "data");
    const s = new WorkOsStore(dir), sc = {tenantId: "tA"};
    const p = s.createProject(proj());
    const m = s.createMission(msn(p.projectId));
    const t = s.createTask({tenantId: "tA", missionId: m.missionId, title: "x", actor: "FOUNDER_LOCAL"});
    const before = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    expect(() => s.transitionTask(sc, t.taskId, "DONE", "skip ahead", "a")).toThrow(/WORKOS_INVALID_TRANSITION: PENDING->DONE/);
    expect(() => s.transitionTask(sc, t.taskId, "IN_PROGRESS", "   ", "a")).toThrow(/WORKOS_INVALID_INPUT: reason/);
    expect(() => s.transitionTask(sc, t.taskId, "FINISHED" as never, "x", "a")).toThrow(/WORKOS_INVALID_INPUT: to/);
    expect(() => s.transitionTask({tenantId: "tB"}, t.taskId, "IN_PROGRESS", "x", "a")).toThrow(/WORKOS_NOT_FOUND/);
    expect(() => s.transitionTask(sc, "tsk_missing", "IN_PROGRESS", "x", "a")).toThrow(/WORKOS_NOT_FOUND/);
    expect(s.getTask({tenantId: "tB"}, t.taskId)).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8")).toBe(before);
    // DONE is terminal
    s.transitionTask(sc, t.taskId, "IN_PROGRESS", "go", "a");
    s.transitionTask(sc, t.taskId, "DONE", "done", "a");
    for (const to of ["PENDING", "IN_PROGRESS", "BLOCKED"] as const) expect(() => s.transitionTask(sc, t.taskId, to, "reopen", "a")).toThrow(/WORKOS_INVALID_TRANSITION: DONE->/);
    // tasks of a completed mission are frozen. The mission walks the real state machine to REPORTING; only the final REPORTING -> COMPLETE entry is
    // forged (a legacy-shaped plain transition), to reach COMPLETE without a full evidence-backed run.
    const u = s.createTask({tenantId: "tA", missionId: m.missionId, title: "late", actor: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED", "PLANNED", "EXECUTING", "VERIFYING", "REVIEWING", "REGRESSION", "REPORTING"] as const) s.transitionMission(sc, m.missionId, to, "walk", "a");
    appendForged(dir, "MISSION_TRANSITIONED", {missionId: m.missionId, from: "REPORTING", to: "COMPLETE", reason: "legacy"});
    const s2 = new WorkOsStore(dir);
    expect(s2.isTampered).toBe(false);
    expect(s2.getMission(sc, m.missionId)?.status).toBe("COMPLETE");
    const frozen = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    expect(() => s2.transitionTask(sc, u.taskId, "IN_PROGRESS", "too late", "a")).toThrow(/WORKOS_CONFLICT: MISSION_COMPLETE/);
    expect(fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8")).toBe(frozen);
    // and a forged transition on that frozen task is tamper on replay
    appendForged(dir, "TASK_TRANSITIONED", {taskId: u.taskId, tenantId: "tA", from: "PENDING", to: "IN_PROGRESS", reason: "forged"});
    expect(new WorkOsStore(dir).isTampered).toBe(true);
  });

  it("task status transitions: a well-hashed but inconsistent TASK_TRANSITIONED entry is tamper (fail closed)", () => {
    const cases: Array<(ids: {a: string; b: string}) => Record<string, unknown>> = [
      ({a}) => ({taskId: a, tenantId: "tA", from: "IN_PROGRESS", to: "DONE", reason: "wrong from"}),
      ({a}) => ({taskId: a, tenantId: "tA", from: "PENDING", to: "DONE", reason: "not allowlisted"}),
      ({a}) => ({taskId: a, tenantId: "tB", from: "PENDING", to: "IN_PROGRESS", reason: "other tenant"}),
      ({b}) => ({taskId: b, tenantId: "tA", from: "PENDING", to: "IN_PROGRESS", reason: "dependency not done"}),
      () => ({taskId: "tsk_unknown", tenantId: "tA", from: "PENDING", to: "IN_PROGRESS", reason: "unknown task"}),
    ];
    for (const [i, payloadOf] of cases.entries()) {
      const dir = path.join(tmp, `tamper-${i}`);
      const s = new WorkOsStore(dir);
      const p = s.createProject(proj());
      const m = s.createMission(msn(p.projectId));
      const a = s.createTask({tenantId: "tA", missionId: m.missionId, title: "a", actor: "FOUNDER_LOCAL"});
      const b = s.createTask({tenantId: "tA", missionId: m.missionId, title: "b", dependsOn: [a.taskId], actor: "FOUNDER_LOCAL"});
      appendForged(dir, "TASK_TRANSITIONED", payloadOf({a: a.taskId, b: b.taskId}));
      const s2 = new WorkOsStore(dir);
      expect(s2.isTampered, `case ${i}`).toBe(true);
      expect(() => s2.listTasks({tenantId: "tA"}, m.missionId)).toThrow(/WORKOS_JOURNAL_TAMPERED/);
      expect(() => s2.transitionTask({tenantId: "tA"}, a.taskId, "IN_PROGRESS", "x", "a")).toThrow(/WORKOS_JOURNAL_TAMPERED/);
    }
    // an entry with an unreadable shape is unavailable (not silently skipped)
    const dir = path.join(tmp, "shape");
    const s = new WorkOsStore(dir);
    const p = s.createProject(proj());
    const m = s.createMission(msn(p.projectId));
    const a = s.createTask({tenantId: "tA", missionId: m.missionId, title: "a", actor: "FOUNDER_LOCAL"});
    appendForged(dir, "TASK_TRANSITIONED", {taskId: a.taskId, tenantId: "tA", from: "PENDING", to: "LATER", reason: "x"});
    expect(new WorkOsStore(dir).isUnavailable).toBe(true);
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

// //TR: LANE-B intake: fikir -> doğrulanmış intake kaydı + proje + ilk mission; route modülü server.ts'e dokunmadan Fastify örneğine kaydedilir.
describe("LANE-B project intake", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const IDEA = "A small web app where I can track my daily reading with a streak counter";
  const mkApp = async (stopped = false, allowed = true, tenantId = "tA") => {
    const [{default: Fastify}, {registerIntakeRoutes}] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/intake.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: any[] = [];
    registerIntakeRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: (e: string, d?: any) => { audits.push({e, d}); },
      workosStopped: () => stopped, workosPolicy: () => allowed ? {allowed: true} : {allowed: false, reason: "NO"}, workosFail: (r: any) => r.code(500).send({error: "INTERNAL_ERROR"})});
    return {app, store, audits};
  };
  const post = (app: any, body: unknown, headers: any = hdr) => app.inject({method: "POST", url: "/v1/intakes", headers, payload: body as any});

  it("turns an idea into intake + project + first mission, durable across restart, with honest field sources", async () => {
    const {app, store, audits} = await mkApp();
    const r = await post(app, {idea: IDEA});
    expect(r.statusCode).toBe(201);
    const i = r.json().intake;
    expect(i.intakeId).toMatch(/^itk_[0-9a-f]{24}$/);
    expect(i.sources).toEqual({title: "DERIVED", acceptanceCriteria: "DEFAULT", riskLevel: "DEFAULT"});
    const m = store.getMission({tenantId: "tA"}, i.missionId)!;
    expect(m.objective).toBe(IDEA); expect(m.projectId).toBe(i.projectId); expect(m.status).toBe("DRAFT");
    expect(store.getProject({tenantId: "tA"}, i.projectId)!.name).toBe(IDEA.slice(0, 80).trim());
    expect(audits.map(a => a.e)).toEqual(["WORKOS_INTAKE_CREATED"]);
    expect(JSON.stringify(r.json())).not.toContain(tmp);
    const { app: app2 } = await mkApp();
    expect((await app2.inject({method: "GET", url: `/v1/intakes/${i.intakeId}`, headers: hdr})).json().intake).toEqual(i);
    expect((await app2.inject({method: "GET", url: "/v1/intakes", headers: hdr})).json().intakes).toHaveLength(1);
  });
  it("marks founder-supplied fields FOUNDER and replays an idempotent retry without duplicates; conflicting reuse is 409", async () => {
    const {app, store} = await mkApp();
    const body = {idea: IDEA, title: "Reading tracker", acceptanceCriteria: ["streak shown"], riskLevel: "R2", projectType: "web", idempotencyKey: "k1"};
    const a = await post(app, body), b = await post(app, body);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.json().intake).toEqual(a.json().intake);
    expect(a.json().intake.sources).toEqual({title: "FOUNDER", acceptanceCriteria: "FOUNDER", riskLevel: "FOUNDER"});
    expect(store.listProjects({tenantId: "tA"})).toHaveLength(1);
    expect(store.listMissions({tenantId: "tA"})).toHaveLength(1);
    const c = await post(app, {...body, idea: IDEA + " with reminders"});
    expect(c.statusCode).toBe(409); expect(c.json().error).toBe("INTAKE_IDEMPOTENCY_CONFLICT");
  });
  it("rejects bad input, wrong token, Global Stop and policy denial; isolates tenants", async () => {
    const {app} = await mkApp();
    for (const bad of [{}, {idea: "short"}, {idea: IDEA, extra: 1}, {idea: IDEA, riskLevel: "R4"}, {idea: IDEA, targetOS: ["beos"]}, {idea: "          "}]) expect((await post(app, bad)).statusCode).toBe(400);
    expect((await post(app, {idea: IDEA}, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/intakes/bad", headers: hdr})).statusCode).toBe(400);
    expect((await app.inject({method: "GET", url: "/v1/intakes/itk_" + "0".repeat(24), headers: hdr})).statusCode).toBe(404);
    expect((await (await mkApp(true)).app.inject({method: "POST", url: "/v1/intakes", headers: hdr, payload: {idea: IDEA}})).statusCode).toBe(423);
    expect((await (await mkApp(false, false)).app.inject({method: "POST", url: "/v1/intakes", headers: hdr, payload: {idea: IDEA}})).statusCode).toBe(403);
    const made = (await post(app, {idea: IDEA})).json().intake;
    const other = (await mkApp(false, true, "tB")).app;
    expect((await other.inject({method: "GET", url: `/v1/intakes/${made.intakeId}`, headers: hdr})).statusCode).toBe(404);
    expect((await other.inject({method: "GET", url: "/v1/intakes", headers: hdr})).json().intakes).toEqual([]);
  });
  it("resumes after a crash between project and mission without duplicating the project", async () => {
    const {app, store} = await mkApp();
    const key = "crash1", { sha256 } = { sha256: (s: string) => crypto.createHash("sha256").update(s).digest("hex") };
    const id = "itk_" + sha256(`tA\0${key}`).slice(0, 24);
    store.createProject({tenantId: "tA", orgId: "o1", name: IDEA.slice(0, 80).trim(), environmentId: "local", createdBy: "FOUNDER_LOCAL", idempotencyKey: `${id}.p`, acceptanceCriteria: ["The delivered application starts and its test suite passes"]});
    const r = await post(app, {idea: IDEA, idempotencyKey: key});
    expect(r.statusCode).toBe(201);
    expect(store.listProjects({tenantId: "tA"})).toHaveLength(1);
    expect(store.listMissions({tenantId: "tA"})).toHaveLength(1);
  });
  it("fails closed with 503 on a corrupt intake file", async () => {
    const {app} = await mkApp();
    fs.mkdirSync(path.join(tmp, "data"), {recursive: true}); fs.writeFileSync(path.join(tmp, "data", "intakes.jsonl"), "{torn");
    const r = await app.inject({method: "GET", url: "/v1/intakes", headers: hdr});
    expect(r.statusCode).toBe(503); expect(r.json().error).toBe("INTAKE_STORE_CORRUPT");
  });

  // //TR: COORD-INTAKE-TEST-COMMAND: intake, projeler gibi isteğe bağlı testCommand (argv) kabul eder; komut projeye yazılır, runner mission yoksa projeden okur, böylece ilk koşu TEST_COMMAND_NOT_CONFIGURED ile bloklanmaz.
  describe("optional testCommand (same schema and allowlist policy as projects)", () => {
    const TC = ["node", "--test", "tests/"];
    const intakesFile = () => path.join(tmp, "data", "intakes.jsonl");
    const journalSize = () => fs.existsSync(path.join(tmp, "data", "journal.jsonl")) ? journalLines(path.join(tmp, "data")).length : 0;

    it("creates a project whose testCommand equals the request; the first mission inherits it through the project; it is durable across restart", async () => {
      const {app, store, audits} = await mkApp();
      const r = await post(app, {idea: IDEA, testCommand: TC});
      expect(r.statusCode).toBe(201);
      const i = r.json().intake;
      expect(i.testCommand).toEqual(TC);
      expect(i.testCommandSha256).toBe(crypto.createHash("sha256").update(JSON.stringify(TC)).digest("hex"));
      expect(store.getProject({tenantId: "tA"}, i.projectId)!.testCommand).toEqual(TC);
      // Proje route deseni: komut yalnız projeye yazılır; mission kendi komutunu taşımaz (runner mission ?? proje okur).
      expect(store.getMission({tenantId: "tA"}, i.missionId)!.testCommand).toBeUndefined();
      expect(audits.map(a => a.e)).toEqual(["WORKOS_INTAKE_CREATED"]);
      const {app: app2, store: store2} = await mkApp();
      expect((await app2.inject({method: "GET", url: `/v1/intakes/${i.intakeId}`, headers: hdr})).json().intake).toEqual(i);
      expect(store2.getProject({tenantId: "tA"}, i.projectId)!.testCommand).toEqual(TC);
      // Girdi dizisi aynen kopyalanır: istek gövdesindeki dizi sonradan değişse de kayıt değişmez.
      const arr = [...TC]; const r2 = await post(app, {idea: IDEA, testCommand: arr, idempotencyKey: "copy1"}); arr[0] = "bash";
      expect(store.getProject({tenantId: "tA"}, r2.json().intake.projectId)!.testCommand).toEqual(TC);
    });
    it("refuses a disallowed or malformed command with the same 400 INVALID_BODY as the project route, and writes nothing", async () => {
      const {app, store, audits} = await mkApp();
      const before = journalSize();
      const bad: unknown[] = [["bash", "-c", "rm -rf /"], ["sh", "x"], ["/usr/bin/node", "x.js"], ["./node"], ["C:/node.exe"], ["node.exe", "x"], ["NODE", "x"], "node t.mjs", [], [""], ["node", ""],
        ["node", "a\nb"], ["node", "a\rb"], ["node", "a\u0000b"], ["node", "x".repeat(1001)], Array.from({length: 33}, () => "node"), ["node", 1], {0: "node"}, null];
      for (const tc of bad) {
        const r = await post(app, {idea: IDEA, testCommand: tc});
        expect([r.statusCode, r.json().error], JSON.stringify(tc)?.slice(0, 60)).toEqual([400, "INVALID_BODY"]);
      }
      // İzin verilen yürütülebilir listesi dışındaki ilk öğe, proje route'uyla aynı açıklamayı taşır.
      expect((await post(app, {idea: IDEA, testCommand: ["bash", "-c", "x"]})).json().detail).toBe("testCommand[0] must be one of node,npm,npx,pnpm,yarn,python,pytest,go,cargo,dotnet,mvn,gradle");
      expect(store.listProjects({tenantId: "tA"})).toEqual([]); expect(store.listMissions({tenantId: "tA"})).toEqual([]);
      expect(journalSize()).toBe(before); expect(fs.existsSync(intakesFile())).toBe(false); expect(audits).toEqual([]);
      for (const [n, ok] of [["node", "t.mjs"], ["npm", "test"], ["pytest"], ["go", "test", "./..."], ["gradle", "test"]].entries()) expect((await post(app, {idea: IDEA, testCommand: ok, idempotencyKey: `ok${n}`})).statusCode, ok.join(" ")).toBe(201);
      // submitIntake'i doğrudan çağıran da allowlist dışı komutla hiçbir şey yazdıramaz (ikinci savunma).
      const {submitIntake, validateIntakeCreate} = await import("../core/workos/intake.js");
      const n = journalSize(), lines = fs.readFileSync(intakesFile(), "utf8");
      expect(() => submitIntake({store, scope: {tenantId: "tA"}, orgId: "o1", actor: "FOUNDER_LOCAL"}, {idea: IDEA, testCommand: ["bash", "-c", "x"], idempotencyKey: "direct1"})).toThrow("WORKOS_INVALID_INPUT");
      expect(journalSize()).toBe(n); expect(fs.readFileSync(intakesFile(), "utf8")).toBe(lines);
      expect(validateIntakeCreate({idea: IDEA, testCommand: ["bash"]})).toEqual({ok: false, errors: "testCommand[0] must be one of node,npm,npx,pnpm,yarn,python,pytest,go,cargo,dotnet,mvn,gradle"});
      expect(validateIntakeCreate({idea: IDEA, testCommand: TC})).toEqual({ok: true});
    });
    it("replays an idempotent retry without duplicates; the same key with a different command (or one side absent) is a 409 conflict that writes nothing", async () => {
      const {app, store} = await mkApp();
      const body = {idea: IDEA, testCommand: TC, idempotencyKey: "tc1"};
      const a = await post(app, body), b = await post(app, body);
      expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
      expect(b.json().intake).toEqual(a.json().intake);
      expect(store.listProjects({tenantId: "tA"})).toHaveLength(1); expect(store.listMissions({tenantId: "tA"})).toHaveLength(1);
      const before = journalSize(), file = fs.readFileSync(intakesFile(), "utf8");
      for (const other of [["node", "--test"], ["node", "tests/", "--test"], ["npm", "test"], ["node", "--test", "tests/", "extra"]]) {
        const c = await post(app, {...body, testCommand: other});
        expect([c.statusCode, c.json().error], other.join(" ")).toEqual([409, "INTAKE_IDEMPOTENCY_CONFLICT"]);
      }
      const dropped = await post(app, {idea: IDEA, idempotencyKey: "tc1"});
      expect([dropped.statusCode, dropped.json().error]).toEqual([409, "INTAKE_IDEMPOTENCY_CONFLICT"]);
      // Komutsuz kayıt + sonradan komutlu istek de farklı istektir.
      expect((await post(app, {idea: IDEA, idempotencyKey: "tc2"})).statusCode).toBe(201);
      const added = await post(app, {idea: IDEA, idempotencyKey: "tc2", testCommand: TC});
      expect([added.statusCode, added.json().error]).toEqual([409, "INTAKE_IDEMPOTENCY_CONFLICT"]);
      expect(fs.readFileSync(intakesFile(), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
      expect(fs.readFileSync(intakesFile(), "utf8").startsWith(file)).toBe(true);
      expect(journalSize()).toBeGreaterThan(before); // yalnız tc2 projesi + mission'ı eklendi
      expect(store.listProjects({tenantId: "tA"})).toHaveLength(2);
    });
    it("keeps the previous behaviour when testCommand is absent: no new record fields, no project command, unchanged project idempotency digest, replay still matches", async () => {
      const {app, store} = await mkApp();
      const body = {idea: IDEA, title: "Reading tracker", idempotencyKey: "plain1"};
      const a = await post(app, body);
      expect(a.statusCode).toBe(201);
      const i = a.json().intake;
      expect(Object.keys(i).sort()).toEqual(["acceptanceCriteria", "createdAt", "createdBy", "idea", "ideaSha256", "intakeId", "missionId", "projectId", "riskLevel", "sources", "status", "tenantId", "title"]);
      const proj = store.getProject({tenantId: "tA"}, i.projectId)!;
      expect(proj.testCommand).toBeUndefined(); expect("testCommand" in proj).toBe(false);
      expect(JSON.parse(fs.readFileSync(intakesFile(), "utf8").trim())).toEqual(i);
      // Proje, testCommand olmadan eskiden hesaplanan özetle yazılmıştır: aynı alanlarla doğrudan yeniden oluşturma ESKİ özetle eşleşir (replayed).
      const direct = store.createProjectDetailed({tenantId: "tA", orgId: "o1", name: "Reading tracker", environmentId: "local", createdBy: "FOUNDER_LOCAL", idempotencyKey: `${i.intakeId}.p`, acceptanceCriteria: [...i.acceptanceCriteria]});
      expect(direct.replayed).toBe(true); expect(direct.entity.projectId).toBe(i.projectId);
      const b = await post(app, body);
      expect([b.statusCode, b.json().intake]).toEqual([200, i]);
      // Eski biçimli (testCommand alanı olmayan) bir kayıt, komutsuz tekrar istekle hâlâ eşleşir; komutlu istek çakışır.
      expect((await post(app, {...body, testCommand: TC})).statusCode).toBe(409);
      expect(store.listProjects({tenantId: "tA"})).toHaveLength(1);
    });
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

// //TR: LANE-B flow: proje ilk-teslim akışı durumu yalnız store kayıtlarından türetilir; route modülü ve türetme kuralları test edilir.
describe("LANE-B project flow", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = async (tenantId = "tA") => {
    const [{default: Fastify}, {registerFlowRoutes}] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/flow.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    registerFlowRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: () => {}, workosStopped: () => false, workosPolicy: () => ({allowed: true}),
      workosFail: (r: any) => r.code(500).send({error: "INTERNAL_ERROR"})});
    return {app, store};
  };
  const get = (app: any, id: string, headers: any = hdr) => app.inject({method: "GET", url: `/v1/projects/${id}/flow`, headers});
  const states = (j: any) => Object.fromEntries(j.flow.stages.map((s: any) => [s.stage, s.state]));

  it("reports NOT_STARTED for an empty project and advances honestly as records appear", async () => {
    const {app, store} = await mkApp();
    const p = store.createProject(proj());
    expect(states((await get(app, p.projectId)).json())).toEqual({MISSION: "NOT_STARTED", PLAN: "NOT_STARTED", RUN: "NOT_STARTED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    const m = store.createMission(msn(p.projectId));
    store.createTask({tenantId: "tA", missionId: m.missionId, title: "t1", actor: "FOUNDER_LOCAL"});
    store.createTask({tenantId: "tA", missionId: m.missionId, title: "t2", actor: "FOUNDER_LOCAL", status: "DONE"});
    let j = (await get(app, p.projectId)).json();
    expect(states(j)).toMatchObject({MISSION: "ACTIVE", PLAN: "ACTIVE", RUN: "NOT_STARTED"});
    expect(j.flow.stages[1].detail).toBe("1/2 DONE"); expect(j.flow.taskCount).toBe(2); expect(j.flow.latestRunId).toBeNull();
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "go", "FOUNDER_LOCAL");
    const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
    j = (await get(app, p.projectId)).json();
    expect(states(j)).toMatchObject({RUN: "ACTIVE", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    expect(j.flow.latestRunId).toBe(run.runId);
    expect(j.flow.stages[2].detail).toMatch(/^[A-Z_]+\/[A-Z]+$/);
    store.transitionRun(run.runId, null, "BLOCKED", "test", "FOUNDER_LOCAL");
    j = (await get(app, p.projectId)).json();
    expect(states(j)).toMatchObject({RUN: "BLOCKED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
  });
  it("derives FAILED / SUCCEEDED+completion / REVIEW-step states from run records", async () => {
    const {deriveProjectFlow} = await import("../core/workos/flow.js");
    const mk = (run: any) => ({getProject: () => ({}), listMissions: () => [{missionId: "m", status: "COMPLETE"}], listTasks: () => [{status: "DONE"}], listRuns: () => [{projectId: "p", createdAt: "2026-01-01", ...run}]}) as any;
    const st = (run: any) => Object.fromEntries(deriveProjectFlow(mk(run), {tenantId: "tA"}, "p")!.stages.map(x => [x.stage, x.state]));
    expect(st({runId: "r", status: "FAILED", step: "IMPLEMENT"})).toMatchObject({MISSION: "DONE", PLAN: "DONE", RUN: "FAILED", REVIEW: "UNKNOWN", DELIVERY: "NOT_STARTED"});
    expect(st({runId: "r", status: "VERIFYING", step: "REVIEW"})).toMatchObject({RUN: "ACTIVE", REVIEW: "ACTIVE"});
    expect(st({runId: "r", status: "SUCCEEDED", step: "REPORT", completion: {productVerification: {state: "PRODUCT_VERIFIED"}}})).toMatchObject({RUN: "DONE", REVIEW: "DONE", DELIVERY: "DONE"});
    expect(st({runId: "r", status: "SUCCEEDED", step: "REPORT"}).DELIVERY).toBe("NOT_STARTED");
  });
  it("marks plan BLOCKED when a task is blocked and never claims DONE for review/delivery without a succeeded run", async () => {
    const {app, store} = await mkApp();
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId));
    store.createTask({tenantId: "tA", missionId: m.missionId, title: "t", actor: "FOUNDER_LOCAL", status: "BLOCKED"});
    const s = states((await get(app, p.projectId)).json());
    expect(s.PLAN).toBe("BLOCKED"); expect(s.REVIEW).not.toBe("DONE"); expect(s.DELIVERY).not.toBe("DONE");
  });
  it("rejects bad ids, wrong token, unknown project and other tenants; leaks no absolute path", async () => {
    const {app, store} = await mkApp();
    const p = store.createProject(proj());
    expect((await get(app, "bad")).statusCode).toBe(400);
    expect((await get(app, p.projectId, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    expect((await get(app, "prj_" + "0".repeat(24))).statusCode).toBe(404);
    const r = await get(app, p.projectId);
    expect(JSON.stringify(r.json())).not.toContain(tmp);
    expect((await get((await mkApp("tB")).app, p.projectId)).statusCode).toBe(404);
  });
});

// //TR: COORD-INTEGRATION-L1 uçtan uca ilk-teslim zinciri GERÇEK modüllerle (test edilen modüllerin sahtesi yok, geçici veri dizini): Kurucu fikri -> intake (proje + ilk mission) -> plan (sıralı, bağımlı görevler) -> flow okuma modeli -> rol çözümleyici (developer/security-reviewer EXECUTABLE, bağlamasız rol NOT_EXECUTABLE) -> runner rol kapısı (depodaki FAKE executor; model çağrısı yok). Intake/plan/flow route modülleri korunan server.ts'e kayıtlı DEĞİLDİR; burada tek bir Fastify örneğine ortak RouteDeps ile doğrudan kaydedilir, uygulamadaki HTTP zinciri iddia edilmez.
import type {RouteDeps} from "../apps/control-api/src/routes/deps.js";
import {validateIntakeCreate} from "../core/workos/intake.js";
import {validatePlanCreate} from "../core/workos/plan.js";
import {resolveRoleExecution} from "../core/agents/role-execution.js";
import {FIRST_DELIVERY_BINDINGS, bindingForFunction, assertRoleExecutes} from "../core/agents/first-delivery-bindings.js";
import {MissionRunner} from "../core/workos/runner.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {testExecutionGate} from "./support/test-sandbox.js";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";

describe("COORD-INTEGRATION-L1 first-delivery chain (real modules, temp data dir)", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const IDEA = "A small web app where I can track my daily reading with a streak counter";
  const scope = {tenantId: "tA"}, ACTOR = "FOUNDER_LOCAL", UNBOUND = "UASCO-0001";
  const ENV_POLICY = path.join(path.resolve(import.meta.dirname, ".."), "config", "environment-policy.json");
  const CATALOG = JSON.parse(fs.readFileSync(path.join(process.cwd(), "registries", "role-definitions.json"), "utf8")).roles as {roleId: string; title: string; guildId: string}[];
  const gitRun = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
  const mkChain = async () => {
    const [{default: Fastify}, {registerIntakeRoutes}, {registerPlanRoutes}, {registerFlowRoutes}] = await Promise.all([
      import("fastify"), import("../apps/control-api/src/routes/intake.js"), import("../apps/control-api/src/routes/plan.js"), import("../apps/control-api/src/routes/flow.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: string[] = [];
    const deps: RouteDeps = {getStore: () => store, scope, orgId: "o1", actor: ACTOR, audit: (e: string) => { audits.push(e); },
      workosStopped: () => false, workosPolicy: () => ({allowed: true}), workosFail: (r: any, e: any) => r.code(500).send({error: e?.code ?? "INTERNAL_ERROR"})};
    registerIntakeRoutes(app, deps); registerPlanRoutes(app, deps); registerFlowRoutes(app, deps);
    return {app, store, audits};
  };
  const flowOf = async (app: any, projectId: string) => { const r = await app.inject({method: "GET", url: `/v1/projects/${projectId}/flow`, headers: hdr}); expect(r.statusCode).toBe(200); return r.json().flow; };
  const states = (f: any) => Object.fromEntries(f.stages.map((s: any) => [s.stage, s.state]));
  const authorize = (store: WorkOsStore, missionId: string) => { for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, missionId, to, "founder go", ACTOR); };

  it("idea -> intake -> plan -> flow -> role resolution -> role-gated run, with the negative links", async () => {
    const {app, store, audits} = await mkChain();
    // 1) Geçersiz fikir hiçbir kayıt üretmez.
    for (const bad of [{idea: "short"}, {idea: IDEA, riskLevel: "R4"}, {idea: IDEA, extra: 1}, {}]) {
      const r = await app.inject({method: "POST", url: "/v1/intakes", headers: hdr, payload: bad});
      expect(r.statusCode).toBe(400); expect(r.json().error).toBe("INVALID_BODY");
    }
    expect(validateIntakeCreate({idea: "short"}).ok).toBe(false);
    expect(store.listProjects(scope)).toEqual([]); expect(store.listMissions(scope)).toEqual([]);

    // 2) Intake: proje + ilk mission (DRAFT), flow MISSION ACTIVE, geri kalan NOT_STARTED.
    const ir = await app.inject({method: "POST", url: "/v1/intakes", headers: hdr, payload: {idea: IDEA, riskLevel: "R1"}});
    expect(ir.statusCode).toBe(201);
    const intake = ir.json().intake;
    const project = store.getProject(scope, intake.projectId)!, first = store.getMission(scope, intake.missionId)!;
    expect(project.name).toBe(IDEA.slice(0, 80).trim());
    expect(first).toMatchObject({projectId: project.projectId, objective: IDEA, status: "DRAFT", riskLevel: "R1"});
    expect(store.listMissions(scope, project.projectId).map(m => m.missionId)).toEqual([first.missionId]);
    let flow = await flowOf(app, project.projectId);
    expect(states(flow)).toEqual({MISSION: "ACTIVE", PLAN: "NOT_STARTED", RUN: "NOT_STARTED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    expect(flow.stages[0].detail).toBe("DRAFT"); expect(flow.missionCount).toBe(1); expect(flow.taskCount).toBe(0);

    // 3) Plan: ileri bağımlılık reddedilir ve görev yazılmaz; geçerli plan sıralı görevleri gerçek taskId bağımlılıklarıyla yazar.
    const fwdBody = {tasks: [{title: "Streak counter", dependsOn: [1]}, {title: "Scaffold"}]};
    expect(validatePlanCreate(fwdBody)).toEqual({ok: false, errors: "tasks[0].dependsOn must reference an earlier task"});
    const fwd = await app.inject({method: "POST", url: `/v1/missions/${first.missionId}/plan`, headers: hdr, payload: fwdBody});
    expect(fwd.statusCode).toBe(400); expect(fwd.json().detail).toContain("must reference an earlier task");
    expect(store.listTasks(scope, first.missionId)).toEqual([]);
    const pr = await app.inject({method: "POST", url: `/v1/missions/${first.missionId}/plan`, headers: hdr,
      payload: {tasks: [{title: "Scaffold"}, {title: "Streak counter", dependsOn: [0]}, {title: "Tests", dependsOn: [0, 1]}]}});
    expect(pr.statusCode).toBe(201);
    const tasks = pr.json().tasks;
    expect(tasks.map((t: any) => t.title)).toEqual(["Scaffold", "Streak counter", "Tests"]);
    expect(tasks.map((t: any) => t.dependsOn)).toEqual([[], [tasks[0].taskId], [tasks[0].taskId, tasks[1].taskId]]);
    for (const t of tasks) expect(t).toMatchObject({missionId: first.missionId, projectId: project.projectId, status: "PENDING"});
    flow = await flowOf(app, project.projectId);
    expect(states(flow)).toEqual({MISSION: "ACTIVE", PLAN: "ACTIVE", RUN: "NOT_STARTED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    expect(flow.stages[1].detail).toBe("0/3 DONE"); expect(flow.taskCount).toBe(3); expect(flow.latestRunId).toBeNull();
    expect(audits).toEqual(["WORKOS_INTAKE_CREATED", "WORKOS_PLAN_CREATED"]);

    // 4) Rol çözümleyici (gerçek 599 rollük katalog): developer ve security-reviewer EXECUTABLE (certified değil), bağlamasız rol NOT_EXECUTABLE.
    const dev = bindingForFunction("developer"), sec = bindingForFunction("security-reviewer");
    for (const b of [dev, sec]) expect(resolveRoleExecution(b.roleId, CATALOG, FIRST_DELIVERY_BINDINGS)).toMatchObject({status: "EXECUTABLE", roleId: b.roleId, certification: "NOT_CERTIFIED"});
    expect(CATALOG.some(r => r.roleId === UNBOUND)).toBe(true);
    expect(resolveRoleExecution(UNBOUND, CATALOG, FIRST_DELIVERY_BINDINGS)).toMatchObject({status: "NOT_EXECUTABLE", reason: "ROLE_HAS_NO_BINDING", certification: "NOT_CERTIFIED"});
    expect(() => assertRoleExecutes(sec.roleId, "developer")).toThrow("BINDING_ROLE_MISMATCH");

    // 5) Runner: intake projesine yönetilen depo bağlanır (server.ts içe aktarma route'unun yaptığı aynı store çağrısı), mission yetkilendirilir, developer rolüne bağlı run FAKE executor ile sürülür.
    const repo = path.join(store.dataDir, "projects", project.projectId, "repo");
    fs.mkdirSync(repo, {recursive: true});
    gitRun(repo, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "README.txt"), "reading tracker\n");
    gitRun(repo, ["add", "-A"]);
    gitRun(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
    store.setProjectRepository(scope, project.projectId, {path: repo, managed: true}, ACTOR, {kind: "git", headSha: gitRun(repo, ["rev-parse", "HEAD"])});
    authorize(store, first.missionId);
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
    const pair = fake.pair();
    const runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
    const mkRunner = () => new MissionRunner({executionGate: testExecutionGate(), store, dataDir: store.dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY,
      executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(tmp, "sec")).options});
    const newRun = (missionId: string, roleId: string) => store.createRun({tenantId: "tA", missionId, roleId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: ACTOR});
    const bound = newRun(first.missionId, dev.roleId);
    await mkRunner().tick();
    const br = store.getRun(scope, bound.runId)!;
    // Rol kapısı bağlı developer'ı implementer'a geçirir; intake projesi test komutu kaydetmediği için VERIFY dürüstçe BLOCKED olur (review/teslim yok).
    expect(fake.calls.implement).toBe(1);
    expect(br).toMatchObject({roleId: dev.roleId, status: "BLOCKED", step: "VERIFY", reason: "TEST_COMMAND_NOT_CONFIGURED"});
    expect(fake.calls.review).toBe(0);
    flow = await flowOf(app, project.projectId);
    expect(states(flow)).toEqual({MISSION: "BLOCKED", PLAN: "ACTIVE", RUN: "BLOCKED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    expect(flow.latestRunId).toBe(bound.runId); expect(flow.stages[2].detail).toBe("BLOCKED/VERIFY");

    // 6) Negatif rol kapısı: aynı projenin ikinci yetkili mission'ında bağlamasız rol, implementer çağrılmadan BLOCKED olur.
    const second = store.createMission({tenantId: "tA", projectId: project.projectId, title: "Second delivery", objective: "o", acceptanceCriteria: ["c"], riskLevel: "R1", createdBy: ACTOR});
    authorize(store, second.missionId);
    const unbound = newRun(second.missionId, UNBOUND);
    await mkRunner().tick();
    expect(store.getRun(scope, unbound.runId)).toMatchObject({roleId: UNBOUND, status: "BLOCKED", step: "IMPLEMENT", reason: `ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING:${UNBOUND}`});
    expect(fake.calls.implement).toBe(1);
    expect(store.getMission(scope, second.missionId)!.status).toBe("BLOCKED");
    flow = await flowOf(app, project.projectId);
    expect(flow.latestRunId).toBe(unbound.runId); expect(flow.missionCount).toBe(2);
    expect(states(flow)).toMatchObject({RUN: "BLOCKED", REVIEW: "NOT_STARTED", DELIVERY: "NOT_STARTED"});
    await app.close();
  });
});

// //TR: LANE-B task routes: görev durum geçişi route modülü (strict gövde, 423/403/400/404/409, tenant izolasyonu, audit, restart sonrası kalıcılık).
describe("LANE-B task transition routes", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = async (stopped = false, allowed = true, tenantId = "tA") => {
    const [{default: Fastify}, {registerTaskRoutes}, {WorkOsError}] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/tasks.js"), import("../core/workos/types.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: any[] = [];
    // server.ts workosFail ile aynı eşleme: NOT_FOUND 404, INVALID_TRANSITION/CONFLICT 409, diğer WorkOsError 400.
    const fail = (r: any, e: any) => e instanceof WorkOsError ? r.code(e.code === "WORKOS_NOT_FOUND" ? 404 : e.code === "WORKOS_INVALID_TRANSITION" || e.code === "WORKOS_CONFLICT" ? 409 : 400).send({error: e.code}) : r.code(500).send({error: "INTERNAL_ERROR"});
    registerTaskRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: (e: string, x?: any) => { audits.push({e, x}); },
      workosStopped: () => stopped, workosPolicy: () => allowed ? {allowed: true} : {allowed: false, reason: "NO"}, workosFail: fail});
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId));
    const t1 = store.createTask({tenantId: "tA", missionId: m.missionId, title: "a", actor: "FOUNDER_LOCAL"});
    const t2 = store.createTask({tenantId: "tA", missionId: m.missionId, title: "b", dependsOn: [t1.taskId], actor: "FOUNDER_LOCAL"});
    return {app, store, audits, t1, t2};
  };
  const tr = (app: any, id: string, body: unknown, headers: any = hdr) => app.inject({method: "POST", url: `/v1/tasks/${id}/transition`, headers, payload: body as any});

  it("walks PENDING -> IN_PROGRESS -> DONE with audit, honours the dependency gate and survives restart", async () => {
    const {app, audits, t1, t2} = await mkApp();
    const blocked = await tr(app, t2.taskId, {to: "IN_PROGRESS", reason: "start"});
    expect(blocked.statusCode).toBe(409);
    expect((await tr(app, t1.taskId, {to: "IN_PROGRESS", reason: "start"})).json().task.status).toBe("IN_PROGRESS");
    expect((await tr(app, t1.taskId, {to: "DONE", reason: "done"})).json().task.status).toBe("DONE");
    expect((await tr(app, t2.taskId, {to: "IN_PROGRESS", reason: "start"})).statusCode).toBe(200);
    expect(audits.map(a => a.e)).toEqual(["WORKOS_TASK_TRANSITIONED", "WORKOS_TASK_TRANSITIONED", "WORKOS_TASK_TRANSITIONED"]);
    expect(audits[0].x).toMatchObject({from: "PENDING", to: "IN_PROGRESS"});
    const again = new WorkOsStore(path.join(tmp, "data"));
    expect(again.getTask({tenantId: "tA"}, t1.taskId)!.status).toBe("DONE");
    expect((await app.inject({method: "GET", url: `/v1/tasks/${t2.taskId}`, headers: hdr})).json().task.status).toBe("IN_PROGRESS");
  });
  it("rejects illegal transitions (409), strict-body violations (400), bad ids and unknown tasks (400/404)", async () => {
    const {app, t1} = await mkApp();
    expect((await tr(app, t1.taskId, {to: "DONE", reason: "skip"})).statusCode).toBe(409);
    for (const bad of [{}, {to: "DONE"}, {reason: "x"}, {to: "NOPE", reason: "x"}, {to: "BLOCKED", reason: "  "}, {to: "BLOCKED", reason: "x", extra: 1}, {to: "BLOCKED", reason: "x".repeat(1001)}])
      expect((await tr(app, t1.taskId, bad)).statusCode).toBe(400);
    expect((await tr(app, "bad", {to: "BLOCKED", reason: "x"})).statusCode).toBe(400);
    expect((await tr(app, "tsk_" + "0".repeat(24), {to: "BLOCKED", reason: "x"})).statusCode).toBe(404);
    expect((await app.inject({method: "GET", url: "/v1/tasks/bad", headers: hdr})).statusCode).toBe(400);
  });
  it("enforces token, Global Stop, policy and tenant isolation; leaves the task unchanged on every refusal", async () => {
    const {app, store, t1} = await mkApp();
    expect((await tr(app, t1.taskId, {to: "BLOCKED", reason: "x"}, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    const stop = await mkApp(true), deny = await mkApp(false, false);
    expect((await tr(stop.app, stop.t1.taskId, {to: "BLOCKED", reason: "x"})).statusCode).toBe(423);
    expect((await tr(deny.app, deny.t1.taskId, {to: "BLOCKED", reason: "x"})).statusCode).toBe(403);
    expect(store.getTask({tenantId: "tA"}, t1.taskId)!.status).toBe("PENDING");
    const other = await mkApp(false, true, "tB");
    expect((await tr(other.app, t1.taskId, {to: "BLOCKED", reason: "x"})).statusCode).toBe(404);
    expect((await other.app.inject({method: "GET", url: `/v1/tasks/${t1.taskId}`, headers: hdr})).statusCode).toBe(404);
  });
});

// //TR: COORD-FIRST-DELIVERY-WIRING: ilk teslim zinciri GERÇEK server.ts üzerinden (buildServer) — intake, plan, görevler, görev geçişi, akış ve okumalar; token/Host/Global Stop/politika/tenant kapıları ve masaüstü köprüsüyle aynı 32 KB yazma sınırı.
describe("COORD first-delivery wiring through the real server", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const IDEA = "A small web app where I can track my daily reading with a streak counter";
  const mkApp = (extra: Record<string, unknown> = {}) => {
    const runtime = path.join(tmp, "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    return {runtime, app: buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false, ...extra})};
  };
  const req = (app: any, method: string, url: string, payload?: unknown, headers: any = hdr) => app.inject({method, url, headers, ...(payload === undefined ? {} : {payload: payload as any})});
  const seed = async (app: any) => {
    const i = await req(app, "POST", "/v1/intakes", {idea: IDEA});
    expect(i.statusCode).toBe(201);
    const intake = i.json().intake;
    const p = await req(app, "POST", `/v1/missions/${intake.missionId}/plan`, {tasks: [{title: "Giriş ekranı"}, {title: "API", dependsOn: [0]}]});
    expect(p.statusCode, p.body).toBeLessThan(300);
    const tasks = (await req(app, "GET", `/v1/missions/${intake.missionId}/tasks`)).json().tasks;
    return {intake, tasks};
  };

  it("serves the whole chain over HTTP: intake, plan, tasks, dependency-gated task status, flow and reads, with audit", async () => {
    const {runtime, app} = mkApp();
    const {intake, tasks} = await seed(app);
    expect(intake.intakeId).toMatch(/^itk_[0-9a-f]{24}$/);
    expect((await req(app, "GET", "/v1/intakes")).json().intakes).toHaveLength(1);
    expect((await req(app, "GET", `/v1/intakes/${intake.intakeId}`)).json().intake.projectId).toBe(intake.projectId);
    expect(tasks.map((t: any) => [t.title, t.status])).toEqual([["Giriş ekranı", "PENDING"], ["API", "PENDING"]]);
    const [t1, t2] = tasks;
    expect(t2.dependsOn).toEqual([t1.taskId]);
    const tr = (id: string, to: string) => req(app, "POST", `/v1/tasks/${id}/transition`, {to, reason: `to ${to}`});
    const gated = await tr(t2.taskId, "IN_PROGRESS");
    expect([gated.statusCode, gated.json().reason]).toEqual([409, "TASK_DEPENDENCIES_NOT_DONE"]);
    for (const to of ["IN_PROGRESS", "DONE"]) expect((await tr(t1.taskId, to)).json().task.status).toBe(to);
    expect((await tr(t2.taskId, "IN_PROGRESS")).statusCode).toBe(200);
    expect((await req(app, "GET", `/v1/tasks/${t1.taskId}`)).json().task.status).toBe("DONE");
    const detail = (await req(app, "GET", `/v1/missions/${intake.missionId}`)).json();
    expect(detail.tasks.map((t: any) => t.status)).toEqual(["DONE", "IN_PROGRESS"]);
    const flow = await req(app, "GET", `/v1/projects/${intake.projectId}/flow`);
    expect(flow.statusCode).toBe(200);
    expect(flow.json().projectId ?? flow.json().flow?.projectId).toBe(intake.projectId);
    const events = fs.readFileSync(path.join(runtime, "control-api-events.jsonl"), "utf8");
    for (const e of ["WORKOS_INTAKE_CREATED", "WORKOS_TASK_TRANSITIONED"]) expect(events).toContain(e);
    await app.close();
  });
  it("keeps every gate on the new routes: token 403, Host 421, Global Stop 423 (reads still served), policy 403, tenant isolation", async () => {
    const {runtime, app} = mkApp();
    const {intake, tasks} = await seed(app);
    const t1 = tasks[0].taskId;
    const reads = ["/v1/intakes", `/v1/intakes/${intake.intakeId}`, `/v1/missions/${intake.missionId}/tasks`, `/v1/projects/${intake.projectId}/flow`, `/v1/tasks/${t1}`];
    const writes: Array<[string, unknown]> = [["/v1/intakes", {idea: IDEA + " again"}], [`/v1/missions/${intake.missionId}/plan`, {tasks: [{title: "x"}]}], [`/v1/tasks/${t1}/transition`, {to: "BLOCKED", reason: "x"}]];
    for (const u of reads) {
      expect((await req(app, "GET", u, undefined, {host: "127.0.0.1:3210"})).statusCode, u).toBe(403);
      expect((await req(app, "GET", u, undefined, {...hdr, host: "evil.example:3210"})).statusCode, u).toBe(421);
    }
    for (const [u, b] of writes) expect((await req(app, "POST", u, b, {...hdr, "x-uasco-control-token": "wrong"})).statusCode, u).toBe(403);
    fs.writeFileSync(path.join(runtime, "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    for (const [u, b] of writes) expect((await req(app, "POST", u, b)).json().error, u).toBe("GLOBAL_STOP_ACTIVE");
    for (const u of reads) expect((await req(app, "GET", u)).statusCode, u).toBe(200);
    fs.rmSync(path.join(runtime, "GLOBAL_STOP.json"));
    await app.close();
    const denied = mkApp({policyContext: {scopeAllowed: false}}).app;
    for (const [u, b] of writes) { const r = await req(denied, "POST", u, b); expect([r.statusCode, r.json().error], u).toEqual([403, "ACTION_DENIED"]); }
    await denied.close();
    const other = mkApp({tenantId: "tB"}).app;
    for (const u of reads.slice(1)) expect((await req(other, "GET", u)).statusCode, u).toBe(404);
    expect((await req(other, "GET", "/v1/intakes")).json().intakes).toEqual([]);
    expect((await req(other, "POST", `/v1/tasks/${t1}/transition`, {to: "BLOCKED", reason: "x"})).statusCode).toBe(404);
    await other.close();
    const again = mkApp().app;
    expect((await req(again, "GET", `/v1/tasks/${t1}`)).json().task.status).toBe("PENDING"); // hiçbir ret yazmadı
    await again.close();
  });
  it("caps the three new writes at the Desktop bridge's 32 KB while the legacy global 64 KB limit stays as it was", async () => {
    const {app} = mkApp();
    const {intake, tasks} = await seed(app);
    const big = (n: number) => JSON.stringify({idea: "x".repeat(n)});
    const json = {...hdr, "content-type": "application/json"};
    for (const u of ["/v1/intakes", `/v1/missions/${intake.missionId}/plan`, `/v1/tasks/${tasks[0].taskId}/transition`]) {
      expect((await req(app, "POST", u, big(33 * 1024), json)).statusCode, u).toBe(413);
      expect((await req(app, "POST", u, big(30 * 1024), json)).statusCode, u).toBe(400); // sınır içinde: şema karar verir
    }
    expect((await req(app, "POST", "/v1/projects", big(40 * 1024), json)).statusCode).toBe(400); // eski rota: genel 64 KB değişmedi
    const {LANE_WRITE_BODY_LIMIT} = await import("../apps/control-api/src/routes/deps.js");
    const main = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
    expect(LANE_WRITE_BODY_LIMIT).toBe(Number(/const POST_MAX_BODY_BYTES=(\d+);/.exec(main)![1]));
    await app.close();
  });
  // //TR: COORD-INTAKE-TEST-COMMAND: gerçek server.ts üzerinden POST /v1/intakes testCommand ile çalışır (allowlist dışı 400, replay 200, farklı komut 409); intake projesine yönetilen depo bağlanıp mission'ın rol-bağlı koşusu sürülünce VERIFY artık TEST_COMMAND_NOT_CONFIGURED ile bloklanmaz, kayıtlı komut gerçekten çalıştırılır (model çağrısı yok, FAKE executor).
  it("accepts testCommand on POST /v1/intakes end to end, and a role-bound run of that intake's mission no longer blocks with TEST_COMMAND_NOT_CONFIGURED", async () => {
    const {app} = mkApp();
    const TC = ["node", "test.mjs"];
    const refused = await req(app, "POST", "/v1/intakes", {idea: IDEA, testCommand: ["bash", "-c", "rm -rf /"]});
    expect([refused.statusCode, refused.json().error]).toEqual([400, "INVALID_BODY"]);
    expect((await req(app, "GET", "/v1/intakes")).json().intakes).toEqual([]);
    expect((await req(app, "GET", "/v1/projects")).json().projects).toEqual([]);
    const body = {idea: IDEA, testCommand: TC, idempotencyKey: "real-tc-1"};
    const made = await req(app, "POST", "/v1/intakes", body);
    expect(made.statusCode).toBe(201);
    const intake = made.json().intake;
    expect(intake.testCommand).toEqual(TC);
    const replay = await req(app, "POST", "/v1/intakes", body);
    expect([replay.statusCode, replay.json().intake]).toEqual([200, intake]);
    const conflict = await req(app, "POST", "/v1/intakes", {...body, testCommand: ["node", "other.mjs"]});
    expect([conflict.statusCode, conflict.json().error]).toEqual([409, "INTAKE_IDEMPOTENCY_CONFLICT"]);
    const projects = (await req(app, "GET", "/v1/projects")).json().projects;
    expect(projects.map((p: any) => [p.projectId, p.testCommand])).toEqual([[intake.projectId, TC]]);
    expect((await req(app, "GET", `/v1/intakes/${intake.intakeId}`)).json().intake).toEqual(intake);
    await app.close();

    // Runner: aynı veri dizinindeki gerçek store; intake projesine yönetilen depo bağlanır, mission yetkilendirilir, developer rolüne bağlı koşu FAKE executor ile sürülür.
    const scope = {tenantId: "local"}, ACTOR = "FOUNDER_LOCAL";
    const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
    const store = new WorkOsStore(path.join(tmp, "data"));
    expect(store.getProject(scope, intake.projectId)!.testCommand).toEqual(TC);
    expect(store.getMission(scope, intake.missionId)!.testCommand).toBeUndefined(); // komut yalnız projede; runner mission ?? proje okur
    const repo = path.join(store.dataDir, "projects", intake.projectId, "repo");
    fs.mkdirSync(repo, {recursive: true});
    git(repo, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "test.mjs"), `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") && fs.readFileSync("feature.txt", "utf8").trim() === "ok" ? 0 : 1);\n`);
    fs.writeFileSync(path.join(repo, "README.txt"), "reading tracker\n");
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
    store.setProjectRepository(scope, intake.projectId, {path: repo, managed: true}, ACTOR, {kind: "git", headSha: git(repo, ["rev-parse", "HEAD"])});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, intake.missionId, to, "founder go", ACTOR);
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
    const pair = fake.pair();
    const runtime = path.join(tmp, "runtime-run"); fs.mkdirSync(runtime, {recursive: true});
    const dev = bindingForFunction("developer");
    const run = store.createRun({tenantId: scope.tenantId, missionId: intake.missionId, roleId: dev.roleId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: ACTOR});
    await new MissionRunner({executionGate: testExecutionGate(), store, dataDir: store.dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(path.resolve(import.meta.dirname, ".."), "config", "environment-policy.json"),
      executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(tmp, "sec")).options}).tick();
    const done = store.getRun(scope, run.runId)!;
    // Dürüst iddia: VERIFY artık komut yapılandırılmadığı için bloklanmaz; sonraki adımlar başka sebeplerle durabilir/ilerleyebilir.
    expect(fake.calls.implement).toBe(1);
    expect(done.roleId).toBe(dev.roleId);
    expect(done.reason).not.toBe("TEST_COMMAND_NOT_CONFIGURED");
    expect(JSON.stringify(done.evidence)).not.toContain("TEST_COMMAND_NOT_CONFIGURED");
    const verify = done.evidence.find(e => e.kind === "VERIFY_TESTS");
    expect(verify, `run ${done.status}/${done.step}/${done.reason}`).toBeDefined(); // kayıtlı komut gerçekten çalıştırıldı ve kanıt yazıldı
    // Fake executor + kayıtlı komut: koşu VERIFY'yi geçip REPORT'ta Founder teslim kararını bekler (bu bir doğrulama/CLEAN iddiası değildir).
    expect([done.status, done.step]).toEqual(["AWAITING_APPROVAL", "REPORT"]);
  });
});
