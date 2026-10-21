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
