// //TR: Bu test Work OS store'unun (hash zincirli journal, snapshot yeniden kurulumu, tamper fail-closed, geçiş reddi, tenant izolasyonu, idempotency) ve yetkili intake route'larının (token, şema, Global Stop 423, policy 403) gerçek dosya I/O ile çalıştığını doğrular.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
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
  it("idempotency covers the WHOLE normalized request: a reused key with any different field is 409, an identical retry stays 200 without duplicates", async () => {
    const {app, store} = await mkApp();
    const base = {idea: IDEA, title: "Reading tracker", acceptanceCriteria: ["streak shown"], riskLevel: "R3", projectType: "web", techStack: ["React"], targetOS: ["web"], idempotencyKey: "kfull"};
    expect((await post(app, base)).statusCode).toBe(201);
    expect((await post(app, {...base})).statusCode).toBe(200);
    const without = (k: string) => { const {[k]: _drop, ...rest} = base as Record<string, unknown>; return rest; };
    const variants: Record<string, unknown> = {
      riskLevel: {...base, riskLevel: "R1"}, title: {...base, title: "Other"}, acceptanceCriteria: {...base, acceptanceCriteria: ["y"]}, projectType: {...base, projectType: "api"},
      techStack: {...base, techStack: ["Vue"]}, targetOS: {...base, targetOS: ["linux"]}, idea: {...base, idea: IDEA + " plus reminders"},
      "title omitted": without("title"), "riskLevel omitted": without("riskLevel"), "acceptanceCriteria omitted": without("acceptanceCriteria"),
      "projectType omitted": without("projectType"), "techStack omitted": without("techStack"), "targetOS omitted": without("targetOS")
    };
    for (const [name, body] of Object.entries(variants)) {
      const r = await post(app, body);
      expect(r.statusCode, name).toBe(409); expect(r.json().error, name).toBe("INTAKE_IDEMPOTENCY_CONFLICT");
    }
    // Varsayılanla açıkça verilen değer farklı bir istektir (alan kaynağı DEFAULT -> FOUNDER): eski kaydı yanlış kaynakla tekrar oynatmak yerine çakışır.
    const plain = {idea: IDEA, idempotencyKey: "kplain"};
    expect((await post(app, plain)).statusCode).toBe(201);
    expect((await post(app, {...plain})).statusCode).toBe(200);
    expect((await post(app, {...plain, riskLevel: "R1"})).statusCode).toBe(409);
    expect(store.listProjects({tenantId: "tA"})).toHaveLength(2);
    expect(store.listMissions({tenantId: "tA"})).toHaveLength(2);
  });
  it("an identical retry still succeeds when the process died after the project and mission writes but before the intake append", async () => {
    const {app, store} = await mkApp();
    const body = {idea: IDEA, riskLevel: "R2", acceptanceCriteria: ["streak shown"], idempotencyKey: "kcrash2"};
    const a = await post(app, body);
    expect(a.statusCode).toBe(201);
    fs.writeFileSync(path.join(tmp, "data", "intakes.jsonl"), ""); // intakes.jsonl satırı yazılamadan çökme
    const b = await post(app, body);
    expect(b.statusCode).toBe(201);
    expect(b.json().intake.intakeId).toBe(a.json().intake.intakeId); expect(b.json().intake.missionId).toBe(a.json().intake.missionId);
    expect(store.listProjects({tenantId: "tA"})).toHaveLength(1); expect(store.listMissions({tenantId: "tA"})).toHaveLength(1);
    const c = await post(app, {...body, riskLevel: "R1"}); // kayıt yeniden yazıldı: farklı gövde artık çakışır
    expect(c.statusCode).toBe(409); expect(c.json().error).toBe("INTAKE_IDEMPOTENCY_CONFLICT");
  });
  it("tolerates a torn trailing intake line like the journal does (ignored, quarantined, rewritten on the identical retry); middle corruption and foreign tails stay fail-closed", async () => {
    const {app} = await mkApp();
    const f = path.join(tmp, "data", "intakes.jsonl");
    const a = await post(app, {idea: IDEA, idempotencyKey: "ta"});
    expect(a.statusCode).toBe(201);
    const oneRecord = fs.readFileSync(f, "utf8");
    const b = await post(app, {idea: IDEA + " second", idempotencyKey: "tb"});
    expect(b.statusCode).toBe(201);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").slice(0, oneRecord.length + 40)); // ikinci kayıt append sırasında yırtıldı (satır sonu yok)
    const list = await app.inject({method: "GET", url: "/v1/intakes", headers: hdr});
    expect(list.statusCode).toBe(200); expect(list.json().intakes.map((i: any) => i.intakeId)).toEqual([a.json().intake.intakeId]);
    const other = await post(app, {idea: IDEA + " third", idempotencyKey: "tc"}); // yırtık kuyruk diğer işleri engellemez
    expect(other.statusCode).toBe(201);
    const retry = await post(app, {idea: IDEA + " second", idempotencyKey: "tb"});
    expect(retry.statusCode).toBe(201);
    expect(retry.json().intake.missionId).toBe(b.json().intake.missionId);
    const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); for (const l of lines) JSON.parse(l);
    expect(fs.readdirSync(path.join(tmp, "data", "quarantine")).filter(n => /^intakes-torn-[0-9a-f]{16}\.tail$/.test(n)).length).toBeGreaterThan(0);
    for (const [name, content] of [["middle corruption", '{"intakeId":"itk_x"\n' + oneRecord], ["foreign tail", oneRecord + "garbage"]] as const) {
      fs.writeFileSync(f, content);
      const r = await app.inject({method: "GET", url: "/v1/intakes", headers: hdr});
      expect(r.statusCode, name).toBe(503); expect(r.json().error, name).toBe("INTAKE_STORE_CORRUPT");
    }
  });
  // Yırtık kuyruk karantinası, kaynak dosya kesilmeden ÖNCE kalıcı olmalı: tmp fsync -> rename -> karantina dizini fsync -> ancak sonra truncate. fs çağrıları gerçek uygulamaya devredilerek sıralanır.
  const tailTrace = async (inject?: (op: "open" | "fsync", target: string) => NodeJS.ErrnoException | undefined, preQuarantined = false) => {
    const {appendJsonlRecord} = await import("../core/workos/jsonl-tail.js");
    const dir = path.join(tmp, "tail"), f = path.join(dir, "intakes.jsonl"), start = '{"intakeId":"';
    fs.mkdirSync(dir, {recursive: true});
    const good = JSON.stringify({intakeId: "itk_a", n: 1}) + "\n", torn = JSON.stringify({intakeId: "itk_b", n: 2}).slice(0, 16);
    fs.writeFileSync(f, good + torn);
    if (preQuarantined) { // önceki yarım kalmış denemeden kalan, bayt bayt aynı karantina kopyası (kalıcılığı bilinmez)
      fs.mkdirSync(path.join(dir, "quarantine"));
      fs.writeFileSync(path.join(dir, "quarantine", `intakes-torn-${crypto.createHash("sha256").update(torn).digest("hex").slice(0, 16)}.tail`), torn);
    }
    const label = (x: string) => x === f ? "source" : x === path.join(dir, "quarantine") ? "quarantine-dir" : x.startsWith(path.join(dir, "quarantine") + path.sep) ? (x.endsWith(".tmp") ? "quarantine-tmp" : "quarantine-file") : x;
    const fdPath = new Map<number, string>(), ev: string[] = [];
    const realOpen = fs.openSync.bind(fs), realFsync = fs.fsyncSync.bind(fs), realRename = fs.renameSync.bind(fs), realTrunc = fs.ftruncateSync.bind(fs);
    const spies = [
      vi.spyOn(fs, "openSync").mockImplementation(((x: any, ...a: any[]) => { const bad = inject?.("open", label(String(x))); if (bad) throw bad; const fd = (realOpen as any)(x, ...a); fdPath.set(fd, String(x)); return fd; }) as any),
      vi.spyOn(fs, "fsyncSync").mockImplementation(((fd: number) => { const t = label(fdPath.get(fd) ?? `fd${fd}`); ev.push(`fsync ${t}`); const bad = inject?.("fsync", t); if (bad) throw bad; return realFsync(fd); }) as any),
      vi.spyOn(fs, "renameSync").mockImplementation(((a: any, b: any) => { ev.push(`rename ${label(String(a))} -> ${label(String(b))}`); return realRename(a, b); }) as any),
      vi.spyOn(fs, "ftruncateSync").mockImplementation(((fd: number, n?: number) => { ev.push(`truncate ${label(fdPath.get(fd) ?? `fd${fd}`)}`); return realTrunc(fd, n); }) as any),
    ];
    let error: unknown;
    try { appendJsonlRecord(f, {intakeId: "itk_c", n: 3}, start); } catch (e) { error = e; } finally { for (const sp of spies) sp.mockRestore(); }
    return {ev, error, f, good, torn, dir};
  };
  it("makes the quarantine copy durable (tmp fsync, rename, quarantine-dir fsync) strictly before the torn tail is truncated off the source", async () => {
    const t = await tailTrace();
    expect(t.error).toBeUndefined();
    const upToTruncate = t.ev.slice(0, t.ev.indexOf("truncate source") + 1);
    expect(upToTruncate).toEqual(["fsync quarantine-tmp", "rename quarantine-tmp -> quarantine-file", "fsync quarantine-dir", "truncate source"]);
    expect(fs.readFileSync(t.f, "utf8")).toBe(t.good + JSON.stringify({intakeId: "itk_c", n: 3}) + "\n");
    const q = fs.readdirSync(path.join(t.dir, "quarantine"));
    expect(q).toHaveLength(1); expect(fs.readFileSync(path.join(t.dir, "quarantine", q[0]), "utf8")).toBe(t.torn);
    // Karantina kopyası zaten varsa (yeniden deneme) yeniden yazılmaz ama o da truncate'ten önce fsync edilir.
    fs.rmSync(t.dir, {recursive: true, force: true});
    const again = await tailTrace(undefined, true);
    expect(again.error).toBeUndefined();
    expect(again.ev.slice(0, again.ev.indexOf("truncate source") + 1)).toEqual(["fsync quarantine-file", "fsync quarantine-dir", "truncate source"]);
  });
  it("leaves the source untouched when the quarantine cannot be made durable, and tolerates only EPERM/EISDIR from directory fsync (Windows)", async () => {
    const err = (code: string) => Object.assign(new Error(code), {code});
    const eio = await tailTrace((op, target) => op === "fsync" && target === "quarantine-dir" ? err("EIO") : undefined);
    expect(eio.error).toMatchObject({name: "JsonlTailError", reason: "QUARANTINE_FAILED"});
    expect(eio.ev).not.toContain("truncate source");
    expect(fs.readFileSync(eio.f, "utf8")).toBe(eio.good + eio.torn);
    fs.rmSync(eio.dir, {recursive: true, force: true});
    const tmpFail = await tailTrace((op, target) => op === "fsync" && target === "quarantine-tmp" ? err("EIO") : undefined);
    expect(tmpFail.error).toMatchObject({reason: "QUARANTINE_FAILED"});
    expect(tmpFail.ev).not.toContain("truncate source");
    expect(fs.readFileSync(tmpFail.f, "utf8")).toBe(tmpFail.good + tmpFail.torn);
    expect(fs.readdirSync(path.join(tmpFail.dir, "quarantine"))).toEqual([]); // başarısız tmp temizlenir, yarım karantina dosyası kalmaz
    for (const [op, code] of [["fsync", "EPERM"], ["open", "EISDIR"], ["open", "EPERM"]] as const) {
      fs.rmSync(tmpFail.dir, {recursive: true, force: true});
      const win = await tailTrace((o, target) => o === op && target === "quarantine-dir" ? err(code) : undefined);
      expect(win.error, `${op} ${code}`).toBeUndefined();
      expect(win.ev, `${op} ${code}`).toContain("truncate source");
    }
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
    const { app: app2 } = await mkApp(); // gerçek yeniden başlatma: başarısız olursa test de başarısız olur (eski uygulamaya geri dönüş yok)
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
  it("tolerates a torn trailing plans.jsonl line: other missions keep planning, the torn plan's identical retry completes without duplicate tasks; middle corruption and foreign tails stay fail-closed", async () => {
    const {app, store, m} = await mkApp();
    const m2 = store.createMission(msn(m.projectId)), m3 = store.createMission(msn(m.projectId));
    const f = path.join(tmp, "data", "plans.jsonl");
    expect((await post(app, m.missionId, PLAN)).statusCode).toBe(201);
    const oneRecord = fs.readFileSync(f, "utf8");
    const first = await post(app, m2.missionId, PLAN);
    expect(first.statusCode).toBe(201);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").slice(0, oneRecord.length + 30)); // m2'nin plan kaydı append sırasında yırtıldı
    expect((await post(app, m.missionId, PLAN)).statusCode).toBe(200); // tamam kayıt hâlâ okunur
    expect((await post(app, m3.missionId, PLAN)).statusCode).toBe(201); // yırtık kuyruk başka mission'ı engellemez
    const retry = await post(app, m2.missionId, PLAN);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().tasks.map((t: any) => t.taskId)).toEqual(first.json().tasks.map((t: any) => t.taskId));
    expect(store.listTasks({tenantId: "tA"}, m2.missionId)).toHaveLength(3);
    const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); for (const l of lines) JSON.parse(l);
    expect(fs.readdirSync(path.join(tmp, "data", "quarantine")).filter(n => /^plans-torn-[0-9a-f]{16}\.tail$/.test(n)).length).toBeGreaterThan(0);
    for (const [name, content] of [["middle corruption", '{"missionId":"msn_x"\n' + oneRecord], ["foreign tail", oneRecord + "garbage"]] as const) {
      fs.writeFileSync(f, content);
      const r = await post(app, m.missionId, PLAN);
      expect(r.statusCode, name).toBe(503); expect(r.json().error, name).toBe("PLAN_STORE_CORRUPT");
    }
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
  it("reflects a CLEAN review at the current head and delivery records honestly: never NOT_STARTED when records exist, never DONE for an unverified delivery", async () => {
    const {deriveProjectFlow} = await import("../core/workos/flow.js");
    const mk = (run: any) => ({getProject: () => ({}), listMissions: () => [{missionId: "m", status: "PLANNED"}], listTasks: () => [{status: "DONE"}], listRuns: () => [{projectId: "p", createdAt: "2026-01-01", ...run}]}) as any;
    const flow = (run: any) => deriveProjectFlow(mk(run), {tenantId: "tA"}, "p")!.stages;
    const st = (run: any) => Object.fromEntries(flow(run).map(x => [x.stage, x.state]));
    const detail = (run: any, stage: string) => flow(run).find(x => x.stage === stage)!.detail;
    const H = "a".repeat(40), OLD = "b".repeat(40);
    const awaiting = {runId: "r", status: "AWAITING_APPROVAL", step: "REPORT", headSha: H, evidence: [{kind: "REVIEW", verdict: "CLEAN", commitSha: H}]};
    expect(st(awaiting)).toMatchObject({RUN: "BLOCKED", REVIEW: "DONE", DELIVERY: "NOT_STARTED"});
    expect(st({...awaiting, evidence: [{kind: "REVIEW", verdict: "CLEAN", commitSha: OLD}]}).REVIEW).toBe("ACTIVE"); // eski commit'in review'u güncel head'i kapsamaz
    expect(st({...awaiting, evidence: [{kind: "REVIEW", verdict: "BLOCKED", commitSha: H}]}).REVIEW).toBe("ACTIVE");
    expect(st({...awaiting, evidence: []}).REVIEW).toBe("ACTIVE");
    expect(st({...awaiting, status: "FAILED"}).REVIEW).toBe("UNKNOWN"); // başarısız koşuda review sonucu bilinmez
    const artifact = {runId: "r", missionId: "m", sourceCommit: H, treeSha: "c".repeat(40), exportArtifactHash: "d".repeat(64), artifactPath: "deliveries/r/x.zip"};
    const accepted = {runId: "r", missionId: "m", sourceCommit: H, exportArtifactHash: "d".repeat(64), acknowledgements: {}, acceptedAt: "2026-01-02T00:00:00.000Z"};
    expect(st({...awaiting, deliveryArtifact: artifact}).DELIVERY).toBe("ACTIVE");
    expect(detail({...awaiting, deliveryArtifact: artifact}, "DELIVERY")).toBe("ARTIFACT_PREPARED_NOT_VERIFIED");
    expect(st({...awaiting, deliveryArtifact: artifact, sourceDelivery: accepted}).DELIVERY).toBe("ACTIVE");
    expect(detail({...awaiting, deliveryArtifact: artifact, sourceDelivery: accepted}, "DELIVERY")).toBe("SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED");
    for (const run of [{...awaiting, deliveryArtifact: artifact}, {...awaiting, deliveryArtifact: artifact, sourceDelivery: accepted}]) expect(st(run).DELIVERY).not.toBe("DONE");
    const done = {...awaiting, status: "SUCCEEDED", deliveryArtifact: artifact, completion: {productVerification: {state: "PRODUCT_VERIFIED"}}};
    expect(st(done)).toMatchObject({RUN: "DONE", REVIEW: "DONE", DELIVERY: "DONE"});
  });
  it("reads REVIEW as DONE for a non-succeeded run only when the runner accepted a CLEAN review for the current head (REGRESSION/REPORT step, no invalidation note)", async () => {
    const {deriveProjectFlow} = await import("../core/workos/flow.js");
    const mk = (run: any) => ({getProject: () => ({}), listMissions: () => [{missionId: "m", status: "PLANNED"}], listTasks: () => [{status: "DONE"}], listRuns: () => [{projectId: "p", createdAt: "2026-01-01", ...run}]}) as any;
    const review = (run: any) => deriveProjectFlow(mk(run), {tenantId: "tA"}, "p")!.stages.find(x => x.stage === "REVIEW")!;
    const H = "a".repeat(40), OLD = "b".repeat(40);
    const clean = (note?: string, commitSha = H) => [{kind: "REVIEW", verdict: "CLEAN", commitSha, ...(note === undefined ? {} : {note})}];
    // Runner CLEAN'i kabul etti: BLOCKED/REGRESSION (onarım bütçesi tükendi) ve AWAITING_APPROVAL/REPORT (mevcut davranış) DONE'dır.
    expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", reason: "REGRESSION_FAILED_REMEDIATION_EXHAUSTED", remediationCycle: 0, headSha: H, evidence: clean()})).toMatchObject({state: "DONE", detail: "CLEAN_REVIEW_FOR_HEAD"});
    expect(review({runId: "r", status: "AWAITING_APPROVAL", step: "REPORT", headSha: H, evidence: clean()})).toMatchObject({state: "DONE", detail: "CLEAN_REVIEW_FOR_HEAD"});
    expect(review({runId: "r", status: "RUNNING", step: "REGRESSION", headSha: H, evidence: clean("provider limit note")}).state).toBe("DONE"); // invalidation olmayan not CLEAN'i bozmaz
    // Runner'ın reddettiği CLEAN (REVIEW_CLONE_MUTATED / REVIEW_INVALID): kayıtlı karar CLEAN olsa da DONE değildir (server.ts reviewRecord NO_VERDICT kuralı).
    for (const note of ["REVIEW_CLONE_MUTATED", "REVIEW_INVALID REVIEW_WORKSPACE_MODIFIED"]) {
      expect(review({runId: "r", status: "BLOCKED", step: "REVIEW", reason: "REVIEWER_MUTATED_CLONE", headSha: H, evidence: clean(note)}), note).toMatchObject({state: "ACTIVE", detail: "REVIEW"});
      expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", headSha: H, evidence: clean(note)}).state, `${note} @REGRESSION`).not.toBe("DONE");
      expect(review({runId: "r", status: "AWAITING_APPROVAL", step: "REPORT", headSha: H, evidence: clean(note)}).state, `${note} @REPORT`).not.toBe("DONE");
    }
    expect(review({runId: "r", status: "RUNNING", step: "REGRESSION", headSha: H, evidence: clean("REVIEW_INVALIDATED_X")}).state).toBe("DONE"); // kelime sınırı: yalnız tam önek geçersizliktir
    // Onarım için IMPLEMENT'e dönmüş koşu: eldeki CLEAN yerine geçilen head'e aittir, DONE değil (önceki davranış: inceleme adımında değil -> NOT_STARTED).
    expect(review({runId: "r", status: "RUNNING", step: "IMPLEMENT", remediationCycle: 1, headSha: H, evidence: clean()})).toMatchObject({state: "NOT_STARTED", detail: null});
    // Runner henüz kabul etmedi (REVIEW adımı: kanıt yazıldı ama checkpoint/geçiş yok) veya adım review öncesi: DONE değil.
    expect(review({runId: "r", status: "RUNNING", step: "REVIEW", headSha: H, evidence: clean()})).toMatchObject({state: "ACTIVE", detail: "REVIEW"});
    expect(review({runId: "r", status: "RUNNING", step: "VERIFY", headSha: H, evidence: clean()}).state).toBe("NOT_STARTED");
    // En son REVIEW kanıtı belirleyicidir: aynı head'de önce CLEAN, sonra geçersiz CLEAN/BLOCKED -> DONE değil; eski commit'in CLEAN'i hiç sayılmaz.
    expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", headSha: H, evidence: [...clean(), {kind: "REVIEW", verdict: "BLOCKED", commitSha: H}]}).state).toBe("ACTIVE");
    expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", headSha: H, evidence: [...clean(), ...clean("REVIEW_CLONE_MUTATED")]}).state).toBe("ACTIVE");
    expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", headSha: H, evidence: clean(undefined, OLD)}).state).toBe("ACTIVE");
    expect(review({runId: "r", status: "BLOCKED", step: "REGRESSION", headSha: H, evidence: clean("REVIEW_CLONE_MUTATED", OLD).concat(clean())}).state).toBe("DONE"); // başka commit'in geçersiz kaydı head'in CLEAN'ini gölgelemez
    // SUCCEEDED ve FAILED kuralları değişmez.
    expect(review({runId: "r", status: "SUCCEEDED", step: "REPORT", headSha: H, evidence: []}).state).toBe("DONE");
    expect(review({runId: "r", status: "FAILED", step: "REGRESSION", headSha: H, evidence: clean()}).state).toBe("UNKNOWN");
  });
  it("derives REVIEW from real MissionRunner outcomes: mutated-clone CLEAN and a CLEAN being replaced by remediation are not DONE; an accepted CLEAN is DONE (REGRESSION-blocked and AWAITING_APPROVAL/REPORT)", async () => {
    const sp = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
    const S = {tenantId: "tA"}, ENV = path.join(path.resolve(import.meta.dirname, ".."), "config", "environment-policy.json");
    const store = new WorkOsStore(path.join(tmp, "data")), runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
    const {deriveProjectFlow} = await import("../core/workos/flow.js");
    const scenario = async (name: string, script: ConstructorParameters<typeof FakeExecutors>[0], extra: Record<string, unknown> = {}) => {
      const repo = path.join(tmp, `src-${name}`), counter = path.join(tmp, `counter-${name}.txt`); fs.mkdirSync(repo, {recursive: true});
      sp(repo, ["init", "-q", "-b", "main"]);
      // 1. çağrı (VERIFY) geçer, 2. çağrı (REGRESSION) düşer.
      fs.writeFileSync(path.join(repo, "test.mjs"), `import fs from "node:fs";\nconst f=${JSON.stringify(counter)};\nconst n=(fs.existsSync(f)?Number(fs.readFileSync(f,"utf8")):0)+1;\nfs.writeFileSync(f,String(n));\nprocess.exit(n===2?1:0);\n`);
      fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
      sp(repo, ["add", "-A"]); sp(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
      const p = store.createProject({tenantId: "tA", orgId: "o1", name: name, environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: name, objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(S, m.missionId, to, "test", "FOUNDER_LOCAL");
      const pair = new FakeExecutors(script).pair();
      const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
      const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir: store.dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(tmp, `sec-${name}`)).options, ...extra});
      const reviewNow = () => deriveProjectFlow(store, S, p.projectId)!.stages.find(x => x.stage === "REVIEW")!.state;
      return {run, runner, reviewNow, final: async () => { await runner.tick(); return {r: store.getRun(S, run.runId)!, review: reviewNow()}; }};
    };
    // A) Reviewer CLEAN der ama salt-okunur klonu değiştirir: runner reddeder (REVIEWER_MUTATED_CLONE, REVIEW_CLONE_MUTATED notu) -> DONE değil.
    const a = await scenario("mutated", {implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN", mutate: true})});
    const fa = await a.final();
    expect(fa.r).toMatchObject({status: "BLOCKED", step: "REVIEW", reason: "REVIEWER_MUTATED_CLONE"});
    expect(fa.r.evidence.filter(e => e.kind === "REVIEW").map(e => [e.verdict, e.commitSha === fa.r.headSha, e.note])).toEqual([["CLEAN", true, "REVIEW_CLONE_MUTATED"]]);
    expect(fa.review).toBe("ACTIVE");
    // B) CLEAN kabul edildi, REGRESSION düştü, onarım IMPLEMENT'te iken CLEAN eski head'e aittir -> DONE değil; yeni commit + yeni CLEAN + REPORT sonunda DONE.
    let during = "UNSET";
    const b: Awaited<ReturnType<typeof scenario>> = await scenario("remediate", {implement: (n: number) => { if (n === 2) during = b.reviewNow(); return {files: {"feature.txt": "ok\n", [`r${n}.txt`]: `v${n}\n`}}; }, review: () => ({verdict: "CLEAN"})});
    const fb = await b.final();
    expect(during).toBe("NOT_STARTED");
    expect(fb.r).toMatchObject({status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1});
    expect(fb.review).toBe("DONE");
    // C) CLEAN kabul edildi, REGRESSION düştü, onarım bütçesi 0 -> BLOCKED/REGRESSION; CLEAN kabul edildiği ve head hâlâ aynı olduğu için DONE.
    const c = await scenario("exhausted", {implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})}, {maxRemediations: 0});
    const fc = await c.final();
    expect(fc.r).toMatchObject({status: "BLOCKED", step: "REGRESSION", reason: "REGRESSION_FAILED_REMEDIATION_EXHAUSTED"});
    expect(fc.review).toBe("DONE");
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
    // Global Stop ve politika retleri KENDİ görevlerine yazmamış olmalı (her mkApp ayrı görev üretir): o görevler yeniden okunur.
    expect(stop.store.getTask({tenantId: "tA"}, stop.t1.taskId)!.status).toBe("PENDING");
    expect(deny.store.getTask({tenantId: "tA"}, deny.t1.taskId)!.status).toBe("PENDING");
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
});

// //TR: COORD-FIRST-DELIVERY-WIRING gerçek Electron E2E betiğinin (scripts/e2e-first-delivery-electron.mjs) süreç hijyeni: betik GERÇEK haliyle, ama Electron/Control API yerine kendi pid'ini ve ortamını yazıp bekleyen sahte çocuk süreçle çalıştırılır. Veri dizini/HOME çalışan kullanıcının ev dizininden (veya UASCO_E2E_HOME'dan) türetilir, sabit /home/e2e kullanılmaz; SIGINT/SIGTERM'de ayrı süreç grubundaki çocuklar öldürülür. Yalnız Linux (betik süreç grupları kullanır).
describe.skipIf(process.platform !== "linux")("COORD first-delivery Electron E2E harness hygiene (stub children)", () => {
  const script = path.resolve(__dirname, "..", "scripts", "e2e-first-delivery-electron.mjs");
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => T | undefined | false, ms = 20_000): Promise<T> => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v as T; if (Date.now() > end) throw new Error("WAIT_TIMEOUT"); await sleep(50); } };
  const alive = (pid: number) => { try { return !/^Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "")); } catch { return false; } };
  const pgrpOf = (pid: number) => Number(fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "").split(" ")[2]);
  const stage = () => {
    const w = path.join(tmp, "repo");
    for (const d of ["automation/lib", "config", "node_modules/tsx/dist"]) fs.mkdirSync(path.join(w, d), {recursive: true});
    fs.writeFileSync(path.join(w, "automation/lib/env-policy.mjs"), "export const safeChildEnv = () => ({PATH: process.env.PATH ?? ''});\n");
    fs.writeFileSync(path.join(w, "config/environment-policy.json"), "{}\n");
    // Sahte API süreci (grup lideri) kendi süreç grubunda ayrılmamış bir torun başlatır (gerçek API'nin tsx/electron alt süreçleri gibi): yalnız lider PID'i öldüren bir betik torunu sahipsiz bırakır ve testte yakalanır.
    fs.writeFileSync(path.join(w, "node_modules/tsx/dist/cli.mjs"), `import fs from "node:fs"; import cp from "node:child_process"; const g = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"}); fs.writeFileSync(${JSON.stringify(path.join(tmp, "child.json"))}, JSON.stringify({pid: process.pid, gpid: g.pid, home: process.env.HOME, data: process.env.UASCO_DATA_DIR})); setInterval(() => {}, 1000);\n`);
    return w;
  };
  const run = async (env: Record<string, string>, body: (h: {proc: import("node:child_process").ChildProcess; child: {pid: number; gpid: number; home: string; data: string}; exited: Promise<number | null>; out: string}) => Promise<void>) => {
    const w = stage(), out = path.join(tmp, "report.json");
    const proc = cp.spawn(process.execPath, [script, w, out, path.join(tmp, "no-electron")], {env: {...process.env, ...env}, stdio: "ignore"});
    const exited = new Promise<number | null>(res => proc.on("exit", code => res(code)));
    let child: {pid: number; gpid: number; home: string; data: string} | undefined;
    try {
      child = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(tmp, "child.json"), "utf8")); } catch { return undefined; } });
      await body({proc, child: child!, exited, out});
    } finally {
      if (child) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* grup zaten bitti */ } } // lider ölmüş olsa da torun grupta kalmış olabilir
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
  };

  it("derives the data dir and HOME from the running user's home (or UASCO_E2E_HOME), never a hard-coded /home/e2e", async () => {
    const home = path.join(tmp, "home-a");
    fs.mkdirSync(home);
    await run({HOME: home, UASCO_E2E_HOME: ""}, async ({proc, child}) => {
      expect(child.home).toBe(home);
      expect(child.data.startsWith(path.join(home, "fd-data-"))).toBe(true);
      expect(fs.readdirSync(home).some(n => n.startsWith("fd-data-"))).toBe(true);
      proc.kill("SIGTERM");
    });
    fs.rmSync(path.join(tmp, "child.json"));
    const ovr = path.join(tmp, "override", "nested");
    await run({HOME: home, UASCO_E2E_HOME: ovr}, async ({proc, child}) => {
      expect(child.home).toBe(ovr);
      expect(child.data.startsWith(path.join(ovr, "fd-data-"))).toBe(true);
      proc.kill("SIGTERM");
    });
  });
  it.each([["SIGTERM", 143], ["SIGINT", 130]] as const)("kills the detached API/Electron process groups when the harness receives %s, and still writes a FAIL report", async (sig, code) => {
    const home = path.join(tmp, "home-b");
    fs.mkdirSync(home);
    await run({HOME: home, UASCO_E2E_HOME: ""}, async ({proc, child, exited, out}) => {
      expect(alive(child.pid)).toBe(true); expect(alive(child.gpid)).toBe(true);
      expect(pgrpOf(child.pid)).toBe(child.pid); expect(pgrpOf(child.gpid)).toBe(child.pid); // torun liderin grubunda: grup öldürme (-pgid) gerekir, lider PID'i yetmez
      proc.kill(sig);
      const exitCode = await exited;
      await waitFor(() => !alive(child.pid) && !alive(child.gpid), 5_000); // WAIT_TIMEOUT = sahipsiz kalan süreç grubu / torun
      expect(exitCode).toBe(code);
      const report = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(report.status).toBe("FAIL");
      expect(report.steps.map((x: any) => x.name)).toContain("harness interrupted");
    });
  });
});

// //TR: LANE-B task-run link: görevi aynı mission'daki gerçek koşuya bağlayan route modülü; doğrulama, idempotency, yırtık kuyruk, tenant ve geçit testleri.
describe("LANE-B task-run link routes", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = async (stopped = false, allowed = true, tenantId = "tA") => {
    const [{default: Fastify}, {registerTaskRunRoutes}, {WorkOsError}] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/task-runs.js"), import("../core/workos/types.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: string[] = [];
    registerTaskRunRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: (e: string) => { audits.push(e); }, workosStopped: () => stopped,
      workosPolicy: () => allowed ? {allowed: true} : {allowed: false, reason: "NO"}, workosFail: (r: any, e: any) => r.code(e instanceof WorkOsError ? 400 : 500).send({error: e?.code ?? "INTERNAL_ERROR"})});
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId)), m2 = store.createMission(msn(p.projectId));
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) { store.transitionMission({tenantId: "tA"}, m.missionId, to, "go", "FOUNDER_LOCAL"); store.transitionMission({tenantId: "tA"}, m2.missionId, to, "go", "FOUNDER_LOCAL"); }
    const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
    const otherRun = store.createRun({tenantId: "tA", missionId: m2.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
    const task = store.createTask({tenantId: "tA", missionId: m.missionId, title: "t", actor: "FOUNDER_LOCAL"});
    return {app, store, audits, run, otherRun, task};
  };
  const link = (app: any, id: string, body: unknown, headers: any = hdr) => app.inject({method: "POST", url: `/v1/tasks/${id}/runs`, headers, payload: body as any});

  it("links a task to a same-mission run, replays idempotently, lists both directions and survives restart", async () => {
    const {app, audits, run, task} = await mkApp();
    const a = await link(app, task.taskId, {runId: run.runId}), b = await link(app, task.taskId, {runId: run.runId});
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.json().link).toEqual(a.json().link);
    expect(audits).toEqual(["WORKOS_TASK_RUN_LINKED", "WORKOS_IDEMPOTENT_REPLAY"]);
    const { app: app2 } = await mkApp().catch(() => ({app}));
    const l = (await app2.inject({method: "GET", url: `/v1/tasks/${task.taskId}/runs`, headers: hdr})).json().runs;
    expect(l).toHaveLength(1); expect(l[0].run.runId).toBe(run.runId); expect(l[0].run.status).toBe("QUEUED");
    const back = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}/tasks`, headers: hdr})).json().links;
    expect(back.map((x: any) => x.taskId)).toEqual([task.taskId]);
    expect(JSON.stringify(a.json())).not.toContain(tmp);
  });
  it("refuses a run of another mission, unknown ids, a DONE task and bad bodies; writes nothing on refusal", async () => {
    const {app, store, otherRun, run, task} = await mkApp();
    expect((await link(app, task.taskId, {runId: otherRun.runId})).json().error).toBe("RUN_MISSION_MISMATCH");
    expect((await link(app, task.taskId, {runId: "run_" + "0".repeat(24)})).statusCode).toBe(404);
    expect((await link(app, "tsk_" + "0".repeat(24), {runId: run.runId})).statusCode).toBe(404);
    for (const bad of [{}, {runId: "x"}, {runId: run.runId, extra: 1}]) expect((await link(app, task.taskId, bad)).statusCode).toBe(400);
    expect((await link(app, "bad", {runId: run.runId})).statusCode).toBe(400);
    for (const to of ["IN_PROGRESS", "DONE"] as const) store.transitionTask({tenantId: "tA"}, task.taskId, to, "x", "FOUNDER_LOCAL");
    const done = await link(app, task.taskId, {runId: run.runId});
    expect(done.statusCode).toBe(409); expect(done.json().error).toBe("TASK_NOT_LINKABLE");
    expect((await app.inject({method: "GET", url: `/v1/tasks/${task.taskId}/runs`, headers: hdr})).json().runs).toEqual([]);
  });
  it("enforces token, Global Stop, policy and tenant isolation; tolerates a torn tail and fails closed on a corrupt middle", async () => {
    const {app, run, task} = await mkApp();
    expect((await link(app, task.taskId, {runId: run.runId}, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    const stop = await mkApp(true), deny = await mkApp(false, false);
    expect((await link(stop.app, stop.task.taskId, {runId: stop.run.runId})).statusCode).toBe(423);
    expect((await link(deny.app, deny.task.taskId, {runId: deny.run.runId})).statusCode).toBe(403);
    const other = await mkApp(false, true, "tB");
    expect((await link(other.app, task.taskId, {runId: run.runId})).statusCode).toBe(404);
    const f = path.join(tmp, "data", "task-run-links.jsonl");
    expect(fs.existsSync(f)).toBe(false);
    fs.writeFileSync(f, '{"taskId":"tsk_tor');
    expect((await link(app, task.taskId, {runId: run.runId})).statusCode).toBe(201);
    expect(fs.readFileSync(f, "utf8").endsWith("\n")).toBe(true);
    fs.writeFileSync(f, "{bad}\n" + fs.readFileSync(f, "utf8"));
    const r = await app.inject({method: "GET", url: `/v1/tasks/${task.taskId}/runs`, headers: hdr});
    expect(r.statusCode).toBe(503); expect(r.json().error).toBe("LINK_STORE_CORRUPT");
  });
});

// //TR: LANE-B flow + task-run link: akış okuması görev-koşu bağı sayısını yalnız doğrulanmış bağ kaydından türetir; bağ dosyası bozuksa null (UNKNOWN) döner.
describe("LANE-B flow task-run summary", () => {
  it("counts linked tasks, stays 0 without links, null for a stub store and for a corrupt link file", async () => {
    const [{deriveProjectFlow}, {linkTaskRun}] = await Promise.all([import("../core/workos/flow.js"), import("../core/workos/task-run-link.js")]);
    const store = new WorkOsStore(path.join(tmp, "data")), sc = {tenantId: "tA"};
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId));
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(sc, m.missionId, to, "go", "FOUNDER_LOCAL");
    const t1 = store.createTask({tenantId: "tA", missionId: m.missionId, title: "a", actor: "FOUNDER_LOCAL"});
    store.createTask({tenantId: "tA", missionId: m.missionId, title: "b", actor: "FOUNDER_LOCAL"});
    expect(deriveProjectFlow(store, sc, p.projectId)!.taskRuns).toEqual({tasksWithRuns: 0, tasks: 2});
    const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
    linkTaskRun(store, sc, "FOUNDER_LOCAL", t1.taskId, run.runId);
    expect(deriveProjectFlow(store, sc, p.projectId)!.taskRuns).toEqual({tasksWithRuns: 1, tasks: 2});
    expect(deriveProjectFlow(store, {tenantId: "tB"}, p.projectId)).toBeUndefined();
    const stub = {getProject: () => ({}), listMissions: () => [], listTasks: () => [], listRuns: () => []} as any;
    expect(deriveProjectFlow(stub, sc, "p")!.taskRuns).toBeNull();
    fs.writeFileSync(path.join(tmp, "data", "task-run-links.jsonl"), "{bad}\n" + fs.readFileSync(path.join(tmp, "data", "task-run-links.jsonl"), "utf8"));
    expect(deriveProjectFlow(store, sc, p.projectId)!.taskRuns).toBeNull();
  });
});

// //TR: LANE-B task outcomes: görev durumu bağlı koşunun gerçek sonucundan türetilir (elle durum yok); uzlaştırma kuralları, idempotency, bağımlılık sırası, yeni koşunun eskiyi ezmesi ve route kapıları test edilir.
describe("LANE-B task outcome reconcile", () => {
  const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const SC = {tenantId: "tA"}, ACT = "FOUNDER_LOCAL";
  const mkApp = async (stopped = false, allowed = true, tenantId = "tA") => {
    const [{default: Fastify}, {registerTaskRunRoutes}, {WorkOsError}, link] = await Promise.all([import("fastify"), import("../apps/control-api/src/routes/task-runs.js"), import("../core/workos/types.js"), import("../core/workos/task-run-link.js")]);
    const app = Fastify({logger: false});
    app.addHook("onRequest", async (req, reply) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
    const store = new WorkOsStore(path.join(tmp, "data"));
    const audits: any[] = [];
    registerTaskRunRoutes(app, {getStore: () => store, scope: {tenantId}, orgId: "o1", actor: ACT, audit: (e: string, x?: any) => { audits.push({e, x}); }, workosStopped: () => stopped,
      workosPolicy: () => allowed ? {allowed: true} : {allowed: false, reason: "NO"}, workosFail: (r: any, e: any) => r.code(e instanceof WorkOsError ? 400 : 500).send({error: e?.code ?? "INTERNAL_ERROR"})});
    const p = store.createProject(proj()), m = store.createMission(msn(p.projectId));
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SC, m.missionId, to, "go", ACT);
    const t1 = store.createTask({tenantId: "tA", missionId: m.missionId, title: "t1", actor: ACT});
    const t2 = store.createTask({tenantId: "tA", missionId: m.missionId, title: "t2", dependsOn: [t1.taskId], actor: ACT});
    const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: ACT});
    return {app, store, audits, link, m, t1, t2, run};
  };
  const rec = (app: any, runId: string, body: unknown = {}, headers: any = hdr) => app.inject({method: "POST", url: `/v1/work-runs/${runId}/tasks/reconcile`, headers, payload: body as any});
  const start = (store: WorkOsStore, runId: string) => { const r = store.acquireRunLease(runId, 60_000, ACT); store.transitionRun(runId, r.leaseId!, "RUNNING", "step started", ACT); return r.leaseId!; };
  const status = (store: WorkOsStore, id: string) => store.getTask(SC, id)!.status;
  const row = (j: any, id: string) => j.results.find((r: any) => r.taskId === id);

  it("maps run state to task state: queued unchanged, running IN_PROGRESS (dependency-gated), failed BLOCKED; idempotent; audited", async () => {
    const {app, store, audits, link, t1, t2, run} = await mkApp();
    link.linkTaskRun(store, SC, ACT, t1.taskId, run.runId); link.linkTaskRun(store, SC, ACT, t2.taskId, run.runId);
    const q = (await rec(app, run.runId)).json();
    expect(q.runStatus).toBe("QUEUED"); expect(q.results.map((r: any) => r.action)).toEqual(["UNCHANGED", "UNCHANGED"]);
    expect([status(store, t1.taskId), status(store, t2.taskId)]).toEqual(["PENDING", "PENDING"]);
    const lease = start(store, run.runId);
    const r1 = (await rec(app, run.runId)).json();
    expect(row(r1, t1.taskId)).toMatchObject({from: "PENDING", to: "IN_PROGRESS", action: "TRANSITIONED"});
    expect(row(r1, t2.taskId)).toMatchObject({action: "SKIPPED", reason: "TASK_DEPENDENCIES_NOT_DONE"});
    const n = fs.readFileSync(path.join(tmp, "data", "journal.jsonl"), "utf8").split("\n").filter(Boolean).length;
    const again = (await rec(app, run.runId)).json();
    expect(row(again, t1.taskId).action).toBe("UNCHANGED");
    expect(fs.readFileSync(path.join(tmp, "data", "journal.jsonl"), "utf8").split("\n").filter(Boolean).length).toBe(n);
    store.transitionRun(run.runId, lease, "FAILED", "boom", ACT);
    const f = (await rec(app, run.runId)).json();
    expect(f.runStatus).toBe("FAILED");
    expect([status(store, t1.taskId), status(store, t2.taskId)]).toEqual(["BLOCKED", "BLOCKED"]);
    expect(audits.filter(a => a.e === "WORKOS_TASK_OUTCOME_RECORDED").map(a => `${a.x.taskId === t1.taskId ? "t1" : "t2"}:${a.x.from}>${a.x.to}`)).toEqual(["t1:PENDING>IN_PROGRESS", "t1:IN_PROGRESS>BLOCKED", "t2:PENDING>BLOCKED"]);
  });
  it("SUCCEEDED completes a dependency chain in order and DONE never regresses; a newer linked run governs the task", async () => {
    const {app, store, link, t1, t2, run, m} = await mkApp();
    link.linkTaskRun(store, SC, ACT, t1.taskId, run.runId); link.linkTaskRun(store, SC, ACT, t2.taskId, run.runId);
    const succeeded = new Proxy(store, {get: (t, k) => k === "getRun" ? (s: any, id: string) => ({...t.getRun(s, id)!, status: "SUCCEEDED"}) : (t as any)[k].bind ? (t as any)[k].bind(t) : (t as any)[k]}) as WorkOsStore;
    const {reconcileRunTasks, reconcileAllLinkedTasks} = await import("../core/workos/task-outcome.js");
    const out = reconcileRunTasks(succeeded, SC, ACT, run.runId);
    expect(out.results.map(r => `${r.action}:${r.to}`)).toEqual(["TRANSITIONED:DONE", "TRANSITIONED:DONE"]);
    expect([status(store, t1.taskId), status(store, t2.taskId)]).toEqual(["DONE", "DONE"]);
    const failedView = new Proxy(store, {get: (t, k) => k === "getRun" ? (s: any, id: string) => ({...t.getRun(s, id)!, status: "FAILED"}) : (t as any)[k].bind ? (t as any)[k].bind(t) : (t as any)[k]}) as WorkOsStore;
    expect(reconcileRunTasks(failedView, SC, ACT, run.runId).results.map(r => r.reason)).toEqual(["TASK_ALREADY_DONE", "TASK_ALREADY_DONE"]);
    expect(reconcileAllLinkedTasks(succeeded, SC, ACT)).toEqual([]);
    // newer run: second mission task relinked; old run no longer governs it
    const m2 = store.createMission(msn(m.projectId)); for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SC, m2.missionId, to, "go", ACT);
    const ta = store.createTask({tenantId: "tA", missionId: m2.missionId, title: "a", actor: ACT});
    const old = store.createRun({tenantId: "tA", missionId: m2.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: ACT});
    link.linkTaskRun(store, SC, ACT, ta.taskId, old.runId);
    const lease = start(store, old.runId); store.transitionRun(old.runId, lease, "FAILED", "boom", ACT);
    expect(reconcileRunTasks(store, SC, ACT, old.runId).results[0]).toMatchObject({to: "BLOCKED", action: "TRANSITIONED"});
    store.transitionMission(SC, m2.missionId, "BLOCKED", "x", ACT); store.transitionMission(SC, m2.missionId, "PREFLIGHT", "x", ACT); store.transitionMission(SC, m2.missionId, "AUTHORIZED", "x", ACT);
    const fresh = store.createRun({tenantId: "tA", missionId: m2.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: ACT});
    link.linkTaskRun(store, SC, ACT, ta.taskId, fresh.runId); start(store, fresh.runId);
    expect(reconcileRunTasks(store, SC, ACT, old.runId).results[0]).toMatchObject({action: "SKIPPED", reason: "SUPERSEDED_BY_NEWER_RUN"});
    expect(reconcileRunTasks(store, SC, ACT, fresh.runId).results[0]).toMatchObject({from: "BLOCKED", to: "IN_PROGRESS", action: "TRANSITIONED"});
    expect(status(store, ta.taskId)).toBe("IN_PROGRESS");
  });
  it("accepts no status from the client and enforces token, Global Stop, policy, ids and tenant isolation", async () => {
    const {app, store, link, t1, run} = await mkApp();
    link.linkTaskRun(store, SC, ACT, t1.taskId, run.runId); start(store, run.runId);
    for (const bad of [{to: "DONE"}, {status: "DONE"}, {x: 1}]) expect((await rec(app, run.runId, bad)).statusCode).toBe(400);
    expect(status(store, t1.taskId)).toBe("PENDING");
    expect((await rec(app, run.runId, {}, {...hdr, "x-uasco-control-token": "x"})).statusCode).toBe(403);
    expect((await rec(app, "bad")).statusCode).toBe(400);
    expect((await rec(app, "run_" + "0".repeat(24))).statusCode).toBe(404);
    const stop = await mkApp(true), deny = await mkApp(false, false);
    expect((await rec(stop.app, stop.run.runId)).statusCode).toBe(423);
    expect((await rec(deny.app, deny.run.runId)).statusCode).toBe(403);
    expect((await rec((await mkApp(false, true, "tB")).app, run.runId)).statusCode).toBe(404);
    expect(status(store, t1.taskId)).toBe("PENDING");
    expect((await rec(app, run.runId)).json().results[0].action).toBe("TRANSITIONED");
  });
  it("targetForRun covers every run status with no positive default", async () => {
    const {targetForRun} = await import("../core/workos/task-outcome.js"), {RUN_STATUSES} = await import("../core/workos/run-state.js");
    const t = Object.fromEntries(RUN_STATUSES.map((s: string) => [s, targetForRun(s as any)]));
    expect(t.SUCCEEDED).toBe("DONE");
    for (const s of ["FAILED", "RECOVERY_FAILED", "CANCELLED", "QUARANTINED", "BLOCKED"]) expect(t[s]).toBe("BLOCKED");
    for (const s of ["CREATED", "QUEUED"]) expect(t[s]).toBeNull();
    for (const s of ["LEASED", "RUNNING", "VERIFYING", "AWAITING_APPROVAL", "CANCELLING", "RETRY_SCHEDULED"]) expect(t[s]).toBe("IN_PROGRESS");
    expect(Object.values(t).filter(v => v === "DONE")).toHaveLength(1);
  });
});

// //TR: LANE-B sözleşme taraması: ilk-teslim route'larına bozuk id, bozuk/yanlış tipte/aşırı gövde gönderilir; hiçbir yanıt 5xx olmaz, hata gövdesi sabit kod taşır ve yol/yığın sızdırmaz.
describe("LANE-B first-delivery 4xx/5xx contract sweep", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const ZERO = (p: string) => p + "0".repeat(24);
  type Route = {method: "GET" | "POST"; url: string; ids: string[]};
  // :p proje, :m mission, :t görev, :r koşu, :i intake kimliği; `ids` hangi yer tutucuların bozulacağını söyler.
  const ROUTES: Route[] = [
    {method: "GET", url: "/v1/intakes/:i", ids: [":i"]}, {method: "POST", url: "/v1/intakes", ids: []},
    {method: "POST", url: "/v1/projects", ids: []}, {method: "POST", url: "/v1/missions", ids: []},
    {method: "GET", url: "/v1/missions/:m", ids: [":m"]}, {method: "POST", url: "/v1/missions/:m/transition", ids: [":m"]},
    {method: "POST", url: "/v1/missions/:m/plan", ids: [":m"]}, {method: "GET", url: "/v1/missions/:m/tasks", ids: [":m"]},
    {method: "POST", url: "/v1/missions/:m/runs", ids: [":m"]},
    {method: "GET", url: "/v1/tasks/:t", ids: [":t"]}, {method: "POST", url: "/v1/tasks/:t/transition", ids: [":t"]},
    {method: "GET", url: "/v1/tasks/:t/runs", ids: [":t"]}, {method: "POST", url: "/v1/tasks/:t/runs", ids: [":t"]},
    {method: "GET", url: "/v1/work-runs/:r", ids: [":r"]}, {method: "GET", url: "/v1/work-runs/:r/tasks", ids: [":r"]},
    {method: "GET", url: "/v1/work-runs/:r/delivery", ids: [":r"]},
    {method: "POST", url: "/v1/work-runs/:r/delivery/prepare", ids: [":r"]}, {method: "POST", url: "/v1/work-runs/:r/delivery/accept", ids: [":r"]},
    {method: "POST", url: "/v1/work-runs/:r/delivery/export", ids: [":r"]}, {method: "POST", url: "/v1/work-runs/:r/tasks/reconcile", ids: [":r"]},
    {method: "GET", url: "/v1/projects/:p/flow", ids: [":p"]}, {method: "GET", url: "/v1/projects/:p/devrun", ids: [":p"]}
  ];
  const BAD_IDS = ["bad", "..%2F..%2Fetc%2Fpasswd", "x".repeat(300), "%00", "prj_" + "G".repeat(24), "%E0%A4%A"];
  const BODIES: {name: string; headers: Record<string, string>; payload: string}[] = [
    {name: "invalid json", headers: {"content-type": "application/json"}, payload: "{bad"},
    {name: "text/plain", headers: {"content-type": "text/plain"}, payload: "hello"},
    {name: "array", headers: {"content-type": "application/json"}, payload: "[]"},
    {name: "null", headers: {"content-type": "application/json"}, payload: "null"},
    {name: "string", headers: {"content-type": "application/json"}, payload: '"str"'},
    {name: "unknown field", headers: {"content-type": "application/json"}, payload: '{"__proto__":{"x":1},"zzz":1}'},
    {name: "oversize", headers: {"content-type": "application/json"}, payload: JSON.stringify({pad: "x".repeat(100 * 1024)})}
  ];
  const FIXED = /^[A-Z][A-Z0-9_]*$/;
  const leaks = (body: string) => [tmp, "node_modules", "/home/", "    at ", "\\Users\\", "stack"].filter(s => s && body.includes(s));

  it("never answers 5xx to malformed ids/bodies, always returns a fixed error code, and leaks no path or stack", async () => {
    const runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
    const app = buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false});
    (await import("../apps/control-api/src/routes/error-contract.js")).registerErrorContract(app);
    const sc = {tenantId: "local"};
    const store = new WorkOsStore(path.join(tmp, "data"));
    const p = store.createProject({tenantId: "local", orgId: "local", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
    const m = store.createMission({tenantId: "local", projectId: p.projectId, title: "T", objective: "O", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    const t = store.createTask({tenantId: "local", missionId: m.missionId, title: "t", actor: "FOUNDER_LOCAL"});
    void sc;
    const real: Record<string, string> = {":p": p.projectId, ":m": m.missionId, ":t": t.taskId, ":r": ZERO("run_"), ":i": ZERO("itk_")};
    const unknown: Record<string, string> = {":p": ZERO("prj_"), ":m": ZERO("msn_"), ":t": ZERO("tsk_"), ":r": ZERO("run_"), ":i": ZERO("itk_")};
    const bad: string[] = [];
    const ROUTER_LEVEL = /id=(x{20}|%E0%A4%A)/;
    const check = (label: string, r: {statusCode: number; headers: any; body: string}) => {
      if (r.statusCode >= 500) bad.push(`${label}: ${r.statusCode} ${r.body.slice(0, 120)}`);
      else if (r.statusCode >= 400) {
        let j: any; try { j = JSON.parse(r.body); } catch { bad.push(`${label}: non-JSON error body ${r.statusCode}`); return; }
        const code = typeof j?.error === "string" ? j.error : null;
        // Yönlendirici düzeyi hatalar kurucu seçeneği `frameworkErrors` ister (server.ts); burada yalnız 4xx + sızıntısız olmaları aranır, sabit biçim aşağıdaki testte kanıtlanır.
        if (!ROUTER_LEVEL.test(label) && (!code || !FIXED.test(code))) bad.push(`${label}: error code not fixed (${r.statusCode}) ${r.body.slice(0, 160)}`);
      }
      const l = leaks(r.body); if (l.length) bad.push(`${label}: leaks ${l.join(",")}`);
    };
    for (const route of ROUTES) {
      const fill = (url: string, vals: Record<string, string>) => Object.entries(vals).reduce((u, [k, v]) => u.replace(k, v), url);
      for (const id of BAD_IDS) for (const ph of route.ids) {
        const url = route.url.replace(ph, id);
        check(`${route.method} ${route.url} id=${id.slice(0, 20)}`, await app.inject({method: route.method, url: fill(url, real), headers: hdr, ...(route.method === "POST" ? {payload: "{}", headers: {...hdr, "content-type": "application/json"}} : {})}));
      }
      check(`${route.method} ${route.url} unknown`, await app.inject({method: route.method, url: fill(route.url, unknown), headers: route.method === "POST" ? {...hdr, "content-type": "application/json"} : hdr, ...(route.method === "POST" ? {payload: "{}"} : {})}));
      if (route.method === "POST") for (const b of BODIES) check(`POST ${route.url} body=${b.name}`, await app.inject({method: "POST", url: fill(route.url, real), headers: {...hdr, ...b.headers}, payload: b.payload}));
    }
    await app.close();
    expect(bad).toEqual([]);
  });

  it("router-level errors (over-long id, malformed percent escape) become fixed codes with the frameworkErrors option; unknown routes and thrown errors too", async () => {
    const {default: Fastify} = await import("fastify");
    const {registerErrorContract, frameworkErrors} = await import("../apps/control-api/src/routes/error-contract.js");
    const app = Fastify({logger: false, frameworkErrors});
    registerErrorContract(app);
    app.get("/v1/things/:id", async () => ({ok: true}));
    app.get("/v1/boom", async () => { throw new Error("secret " + tmp + " node_modules"); });
    app.post("/v1/echo", async (req: any) => ({got: req.body}));
    const go = async (method: "GET" | "POST", url: string, extra: Record<string, unknown> = {}) => { const r = await app.inject({method, url, ...extra}); return {status: r.statusCode, body: r.body}; };
    expect(await go("GET", "/v1/things/" + "x".repeat(300))).toEqual({status: 414, body: '{"error":"URL_TOO_LONG"}'});
    expect(await go("GET", "/v1/things/%E0%A4%A")).toEqual({status: 400, body: '{"error":"BAD_URL"}'});
    expect(await go("GET", "/v1/nope")).toEqual({status: 404, body: '{"error":"NOT_FOUND"}'});
    expect(await go("POST", "/v1/echo", {payload: "{bad", headers: {"content-type": "application/json"}})).toEqual({status: 400, body: '{"error":"INVALID_JSON"}'});
    expect(await go("POST", "/v1/echo", {payload: "<a/>", headers: {"content-type": "application/xml"}})).toEqual({status: 415, body: '{"error":"UNSUPPORTED_MEDIA_TYPE"}'});
    const boom = await go("GET", "/v1/boom");
    expect(boom).toEqual({status: 500, body: '{"error":"INTERNAL_ERROR"}'});
    expect(boom.body).not.toContain("secret");
    const {contractFor} = await import("../apps/control-api/src/routes/error-contract.js");
    expect(contractFor({code: "FST_ERR_CTP_BODY_TOO_LARGE"})).toEqual({status: 413, error: "BODY_TOO_LARGE"});
    expect(contractFor({statusCode: 422})).toEqual({status: 422, error: "INVALID_REQUEST"});
    expect(contractFor({statusCode: 503, message: "x"})).toEqual({status: 500, error: "INTERNAL_ERROR"});
    expect(contractFor(null)).toEqual({status: 500, error: "INTERNAL_ERROR"});
    await app.close();
  });
});
