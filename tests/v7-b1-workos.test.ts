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

// //TR: COORD-INTAKE-TEMPLATE: intake'in yönetilen şablon deposu kurması (core/workos/project-provisioner.ts + intake.ts) önce çekirdek düzeyinde gerçek dosya sistemi ve git ile, sonra gerçek server.ts üzerinden sınanır. Testler intake ile POST /v1/projects'in aynı depoyu ürettiğini, çökme sonrası tekrarın ikinci depo kurmadığını, her reddin hiçbir şey yazmadığını ve runner'ın elle tohumlama olmadan VERIFY'ye ulaştığını kanıtlar.
import {submitIntake} from "../core/workos/intake.js";
import {IntakeError} from "../core/workos/intake.js";
import {APP_ENV_POLICY_FILE, TemplateProvisioner, templateProjectFields} from "../core/workos/project-provisioner.js";
import {ProjectStudio, StudioError} from "../core/workos/project-studio.js";
import {renderTemplate} from "../core/workos/project-templates.js";
import {managedRepoCanonical} from "../core/workos/path-guard.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {WorkOsError} from "../core/workos/types.js";
import type {ProjectTemplate} from "../core/workos/types.js";

const TPL_IDEA = "A small web app where I can track my daily reading with a streak counter";
const tplGit = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const tplData = () => path.join(tmp, "data");
const tplJournalN = (dir = tplData()) => fs.existsSync(path.join(dir, "journal.jsonl")) ? journalLines(dir).length : 0;
const tplIntakes = (dir = tplData()) => path.join(dir, "intakes.jsonl");
const tplIntakeLines = (dir = tplData()) => fs.existsSync(tplIntakes(dir)) ? fs.readFileSync(tplIntakes(dir), "utf8").split("\n").filter(Boolean) : [];
const tplPrjDirs = (dir = tplData()) => { const p = path.join(dir, "projects"); return fs.existsSync(p) && fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(n => n.startsWith("prj_")).sort() : []; };
const tplAuthorSubject = (repo: string) => tplGit(repo, ["log", "--format=%an <%ae>|%s"]);

describe("COORD-INTAKE-TEMPLATE core provisioner (real fs and git, temp data dir)", () => {
  const scope = {tenantId: "tA"}, ACTOR = "FOUNDER_LOCAL";
  const REPO_ROOT = path.resolve(import.meta.dirname, "..");
  const deps = (store: WorkOsStore, studio?: unknown) => ({store, scope, orgId: "o1", actor: ACTOR, ...(studio ? {studio: studio as any} : {})});
  const studioErr = (fn: () => unknown): unknown[] => {
    try { fn(); } catch (e) { expect(e).toBeInstanceOf(StudioError); const s = e as StudioError; return [s.code, s.status, s.reason]; }
    throw new Error("expected a StudioError");
  };
  // Gerçek ProjectStudio'yu saran casus: createTemplateRepository çağrılarını (projectId, template, ad) kaydeder.
  const spyStudio = (dir = tplData()) => {
    const real = new ProjectStudio({dataDir: dir, envPolicyFile: APP_ENV_POLICY_FILE});
    const calls: Array<[string, ProjectTemplate, string]> = [];
    return {calls, studio: {dataDir: real.dataDir, createTemplateRepository: (id: string, t: ProjectTemplate, name: string) => { calls.push([id, t, name]); return real.createTemplateRepository(id, t, name); }}};
  };

  it("U1 resolves the environment policy file exactly as buildServer does (repoRoot/config/environment-policy.json), and the file exists", () => {
    expect(APP_ENV_POLICY_FILE).toBe(path.join(REPO_ROOT, "config", "environment-policy.json"));
    expect(fs.statSync(APP_ENV_POLICY_FILE).isFile()).toBe(true);
    const policy = JSON.parse(fs.readFileSync(APP_ENV_POLICY_FILE, "utf8"));
    expect(policy !== null && typeof policy === "object" && !Array.isArray(policy)).toBe(true);
  });
  it("U2 templateProjectFields: the Founder value wins over the template value, a missing value is an absent key (never []), and arrays are copies", () => {
    expect(templateProjectFields("web-node", "N")).toEqual({template: "web-node", projectType: "web", testCommand: ["node", "test.js"], devCommand: ["node", "server.js"]});
    expect(templateProjectFields("node-lib", "N")).toEqual({template: "node-lib", projectType: "library", testCommand: ["node", "test.js"]});
    const e = templateProjectFields("empty", "N");
    expect(e).toEqual({template: "empty", projectType: "other"}); expect("testCommand" in e).toBe(false); expect("devCommand" in e).toBe(false);
    expect(templateProjectFields("web-node", "N", {projectType: "api", testCommand: ["npm", "test"]})).toEqual({template: "web-node", projectType: "api", testCommand: ["npm", "test"], devCommand: ["node", "server.js"]});
    expect(templateProjectFields("node-lib", "N", {devCommand: ["node", "watch.js"]})).toEqual({template: "node-lib", projectType: "library", testCommand: ["node", "test.js"], devCommand: ["node", "watch.js"]});
    expect(templateProjectFields("empty", "N", {testCommand: ["node", "t.js"], projectType: "cli"})).toEqual({template: "empty", projectType: "cli", testCommand: ["node", "t.js"]});
    const tc = ["node", "x.js"], f = templateProjectFields("node-lib", "N", {testCommand: tc});
    expect(f.testCommand).not.toBe(tc); tc[0] = "bash"; expect(f.testCommand).toEqual(["node", "x.js"]);
    // server.ts POST /v1/projects kuralı (b.x ?? tpl?.x) ile her şablonda birebir aynı.
    for (const t of ["web-node", "node-lib", "empty"] as const) {
      const spec = renderTemplate(t, "N");
      expect(templateProjectFields(t, "N"), t).toEqual({template: t, projectType: spec.projectType, ...(spec.testCommand ? {testCommand: spec.testCommand} : {}), ...(spec.devCommand ? {devCommand: spec.devCommand} : {})});
    }
  });
  it("U3 TemplateProvisioner fails closed with a 500 (never 503) on a foreign data dir or an unreadable policy, and prepare/discard work against a real studio", () => {
    const foreign = new ProjectStudio({dataDir: path.join(tmp, "other"), envPolicyFile: APP_ENV_POLICY_FILE});
    expect(studioErr(() => new TemplateProvisioner({dataDir: tplData(), studio: foreign}))).toEqual(["PROJECT_PROVISIONER_MISCONFIGURED", 500, "DATA_DIR_MISMATCH"]);
    // Aynı dizinin farklı yazımı (göreli yol) kabul edilir.
    expect(() => new TemplateProvisioner({dataDir: path.relative(process.cwd(), tplData()), studio: new ProjectStudio({dataDir: tplData(), envPolicyFile: APP_ENV_POLICY_FILE})})).not.toThrow();
    const bad = path.join(tmp, "policy.json");
    for (const content of [null, "{", "[]", "null", "", "42", "\"x\""]) {
      if (content === null) fs.rmSync(bad, {force: true}); else fs.writeFileSync(bad, content);
      expect(studioErr(() => new TemplateProvisioner({dataDir: tplData(), envPolicyFile: bad})), String(content)).toEqual(["PROJECT_PROVISIONER_UNAVAILABLE", 500, "ENV_POLICY_UNREADABLE"]);
    }
    expect(fs.existsSync(tplData())).toBe(false); // ön kontrol hiçbir şey oluşturmaz
    const id = "prj_" + "a1".repeat(12);
    const made = new TemplateProvisioner({dataDir: tplData()}).prepare("node-lib", "Lib")(id);
    expect(Object.keys(made).sort()).toEqual(["discard", "path"]);
    expect(made.path).toBe(path.join(tplData(), "projects", id, "repo"));
    expect(fs.readdirSync(made.path).sort()).toEqual([".git", ".gitignore", "README.md", "index.js", "package.json", "test.js"]);
    expect(tplAuthorSubject(made.path)).toBe("UASCO Project Studio <studio@local.invalid>|Initial commit from template node-lib");
    made.discard();
    expect(fs.existsSync(path.join(tplData(), "projects", id))).toBe(false);
    // submitIntake de yabancı veri dizinli studio ile hiçbir şey yazmaz (iki dizinde de).
    const store = new WorkOsStore(tplData());
    expect(() => submitIntake(deps(store, foreign), {idea: TPL_IDEA, template: "web-node", idempotencyKey: "u3"})).toThrow("PROJECT_PROVISIONER_MISCONFIGURED");
    expect([tplJournalN(), tplIntakeLines().length, tplPrjDirs(), tplPrjDirs(path.join(tmp, "other"))]).toEqual([0, 0, [], []]);
  });
  it("U4 the studio is called exactly once across the first call and a replay, never for a template-less intake, and a failing studio writes nothing", () => {
    const store = new WorkOsStore(tplData());
    const {calls, studio} = spyStudio();
    const input = {idea: TPL_IDEA, title: "Reading tracker", template: "web-node" as const, idempotencyKey: "u4"};
    const a = submitIntake(deps(store, studio), input), b = submitIntake(deps(store, studio), input);
    expect([a.replayed, b.replayed]).toEqual([false, true]); expect(b.intake).toEqual(a.intake);
    expect(calls).toEqual([[a.intake.projectId, "web-node", "Reading tracker"]]);
    const plain = submitIntake(deps(store, studio), {idea: TPL_IDEA, idempotencyKey: "u4-plain"});
    expect(calls).toHaveLength(1);
    expect(store.getProject(scope, plain.intake.projectId)!.repository).toBeUndefined();
    // Aynı anahtar + farklı/eksik şablon kayıt düzeyinde çakışmadır; eski şablonsuz kayıt + şablonlu istek de çakışır.
    for (const other of [{...input, template: "node-lib" as const}, {idea: TPL_IDEA, title: "Reading tracker", idempotencyKey: "u4"}, {idea: TPL_IDEA, idempotencyKey: "u4-plain", template: "empty" as const, testCommand: ["node", "t.js"]}]) {
      let err: unknown = null;
      try { submitIntake(deps(store, studio), other); } catch (e) { err = e; }
      expect(err, JSON.stringify(other)).toBeInstanceOf(IntakeError); expect((err as IntakeError).code).toBe("INTAKE_IDEMPOTENCY_CONFLICT");
    }
    expect(calls).toHaveLength(1);
    const before = [tplJournalN(), tplIntakeLines().length, store.listProjects(scope).length, tplPrjDirs()];
    const failing = {dataDir: path.resolve(tplData()), createTemplateRepository: () => { throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500); }};
    expect(() => submitIntake(deps(store, failing), {...input, idempotencyKey: "u4-fail"})).toThrow("PROJECT_REPOSITORY_INIT_FAILED");
    expect([tplJournalN(), tplIntakeLines().length, store.listProjects(scope).length, tplPrjDirs()]).toEqual(before);
    const fresh = path.join(tmp, "fresh"), s2 = new WorkOsStore(fresh);
    expect(() => submitIntake(deps(s2, {...failing, dataDir: path.resolve(fresh)}), input)).toThrow("PROJECT_REPOSITORY_INIT_FAILED");
    expect([tplJournalN(fresh), fs.existsSync(tplIntakes(fresh)), s2.listProjects(scope)]).toEqual([0, false, []]);
  });
  it("U5 crash-resume: a mission failure after the project commit keeps the repository; a changed retry conflicts; the same retry completes with one repository and the same head", () => {
    const store = new WorkOsStore(tplData());
    const {calls, studio} = spyStudio();
    const input = {idea: TPL_IDEA, title: "Reading tracker", template: "web-node" as const, idempotencyKey: "u5"};
    const orig = store.createMissionDetailed.bind(store);
    let fail = 1;
    (store as any).createMissionDetailed = (x: any) => { if (fail-- > 0) throw new WorkOsError("WORKOS_UNAVAILABLE", "INJECTED"); return orig(x); };
    expect(() => submitIntake(deps(store, studio), input)).toThrow("WORKOS_UNAVAILABLE");
    const projects = store.listProjects(scope);
    expect(projects).toHaveLength(1);
    const p = projects[0], repo = path.join(tplData(), "projects", p.projectId, "repo");
    expect(p.repository).toEqual({path: repo, managed: true}); // proje kaydından sonra discard yok
    const head = tplGit(repo, ["rev-parse", "HEAD"]);
    expect([fs.existsSync(tplIntakes()), store.listMissions(scope)]).toEqual([false, []]);
    const n = tplJournalN();
    for (const changed of [{...input, title: "Other title"}, {...input, template: "node-lib" as const}, {idea: TPL_IDEA, title: "Reading tracker", idempotencyKey: "u5"}, {...input, testCommand: ["npm", "test"]}, {...input, projectType: "api" as const}, {...input, riskLevel: "R2" as const, acceptanceCriteria: ["other"]}]) {
      expect(() => submitIntake(deps(store, studio), changed), JSON.stringify(changed)).toThrow("WORKOS_IDEMPOTENCY_CONFLICT");
    }
    expect([tplJournalN(), calls.length, tplPrjDirs()]).toEqual([n, 1, [p.projectId]]);
    const r = submitIntake(deps(store, studio), input);
    expect([r.replayed, r.intake.projectId]).toEqual([false, p.projectId]);
    expect(r.intake.repository).toEqual({kind: "TEMPLATE", template: "web-node", managed: true, testCommandSource: "TEMPLATE"});
    expect(calls).toHaveLength(1); expect(tplGit(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect([store.listMissions(scope).length, tplIntakeLines().length, tplPrjDirs()]).toEqual([1, 1, [p.projectId]]);
    expect(submitIntake(deps(store, studio), input).replayed).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it("U6 a direct caller cannot bypass the route: an unknown template or a template without a key is WORKOS_INVALID_INPUT and nothing is written", () => {
    const store = new WorkOsStore(tplData());
    const {calls, studio} = spyStudio();
    for (const [bad, msg] of [[{idea: TPL_IDEA, template: "rails", idempotencyKey: "u6"}, "template"], [{idea: TPL_IDEA, template: "web-node"}, "template requires idempotencyKey"], [{idea: TPL_IDEA, template: "web-node", idempotencyKey: ""}, "template requires idempotencyKey"], [{idea: TPL_IDEA, template: 7, idempotencyKey: "u6"}, "template"]] as const) {
      expect(() => submitIntake(deps(store, studio), bad as any), JSON.stringify(bad)).toThrow(`WORKOS_INVALID_INPUT: ${msg}`);
    }
    expect([tplJournalN(), fs.existsSync(tplIntakes()), fs.existsSync(path.join(tplData(), "projects")), calls.length]).toEqual([0, false, false, 0]);
    // Route şeması aynı kuralları uygular (400 INVALID_BODY): istemci repository/path/url/devCommand gönderemez.
    expect(validateIntakeCreate({idea: TPL_IDEA, template: "web-node"})).toEqual({ok: false, errors: "template requires idempotencyKey"});
    expect(validateIntakeCreate({idea: TPL_IDEA, template: "web-node", idempotencyKey: "k"})).toEqual({ok: true});
    for (const t of ["node-lib", "empty"]) expect(validateIntakeCreate({idea: TPL_IDEA, template: t, idempotencyKey: "k"}), t).toEqual({ok: true});
    for (const extra of [{template: "rails"}, {template: ""}, {template: null}, {template: ["web-node"]}, {repository: {path: "/x"}}, {devCommand: ["node", "x.js"]}, {path: "/x"}, {url: "https://example.invalid/x.git"}]) {
      expect(validateIntakeCreate({idea: TPL_IDEA, template: "web-node", idempotencyKey: "k", ...extra}).ok, JSON.stringify(extra)).toBe(false);
    }
    expect((validateIntakeCreate({idea: TPL_IDEA, template: "web-node", testCommand: ["bash"]}) as {errors: string}).errors).toMatch(/^testCommand\[0\] must be one of /);
  });
  it("U7 compatibility: a template-less intake writes no repository block and its project gains no repository, template or command keys", () => {
    const store = new WorkOsStore(tplData());
    const r = submitIntake(deps(store), {idea: TPL_IDEA, idempotencyKey: "u7"});
    expect("repository" in r.intake).toBe(false);
    expect(Object.keys(JSON.parse(tplIntakeLines()[0]))).not.toContain("repository");
    const p = store.getProject(scope, r.intake.projectId)!;
    expect(["repository", "template", "devCommand", "testCommand", "projectType"].filter(k => k in p)).toEqual([]);
    expect(tplPrjDirs()).toEqual([]);
    expect(submitIntake(deps(store), {idea: TPL_IDEA, idempotencyKey: "u7"}).replayed).toBe(true);
  });
  it("U8 the replay compares the whole normalized request digest AND the template: any drifted or dropped field of a template intake conflicts, an identical retry replays, and a template-less record compares through the same digest", () => {
    const store = new WorkOsStore(tplData());
    const {calls, studio} = spyStudio();
    const input = {idea: TPL_IDEA, title: "Reading tracker", template: "web-node" as const, projectType: "web" as const, techStack: ["React"], targetOS: ["web"], acceptanceCriteria: ["streak shown"], riskLevel: "R2" as const, testCommand: ["node", "t.js"], idempotencyKey: "u8"};
    const a = submitIntake(deps(store, studio), input);
    const b = submitIntake(deps(store, studio), {...input, techStack: [...input.techStack]});
    expect([a.replayed, b.replayed, b.intake]).toEqual([false, true, a.intake]);
    const conflict = (other: object) => { let err: unknown = null; try { submitIntake(deps(store, studio), other as any); } catch (e) { err = e; } expect(err, JSON.stringify(other)).toBeInstanceOf(IntakeError); expect((err as IntakeError).code, JSON.stringify(other)).toBe("INTAKE_IDEMPOTENCY_CONFLICT"); };
    for (const drift of [{idea: TPL_IDEA + " plus reminders"}, {title: "Other"}, {projectType: "api"}, {techStack: ["Vue"]}, {targetOS: ["linux"]}, {acceptanceCriteria: ["y"]}, {riskLevel: "R1"}, {testCommand: ["node", "u.js"]}, {template: "node-lib"}]) conflict({...input, ...drift});
    for (const k of ["title", "projectType", "techStack", "targetOS", "acceptanceCriteria", "riskLevel", "testCommand", "template"]) { const {[k]: _drop, ...rest} = input as Record<string, unknown>; conflict(rest); }
    // Şablonsuz (eski biçimli) kayıt: aynı özet kuralıyla karşılaştırılır; farklı alan ya da eklenen şablon çakışır, birebir tekrar oynatılır.
    const legacy = {idea: TPL_IDEA, title: "Reading tracker", riskLevel: "R2" as const, idempotencyKey: "u8-legacy"};
    const l = submitIntake(deps(store, studio), legacy);
    expect("repository" in l.intake).toBe(false);
    expect(submitIntake(deps(store, studio), {...legacy}).replayed).toBe(true);
    for (const drift of [{riskLevel: "R1"}, {title: "Other"}, {techStack: ["React"]}, {template: "web-node"}, {testCommand: ["node", "t.js"]}]) conflict({...legacy, ...drift});
    conflict({idea: TPL_IDEA, title: "Reading tracker", idempotencyKey: "u8-legacy"});
    expect([calls, tplIntakeLines().length, store.listProjects(scope).length]).toEqual([[[a.intake.projectId, "web-node", "Reading tracker"]], 2, 2]);
  });
});

describe("COORD-INTAKE-TEMPLATE through the real server", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const scope = {tenantId: "local"}, ACTOR = "FOUNDER_LOCAL";
  const mkApp = (extra: Record<string, unknown> = {}) => {
    const runtime = path.join(tmp, "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    return {runtime, app: buildServer({controlToken: token, runtime, dataDir: tplData(), port: 3210, logger: false, ...extra})};
  };
  const req = (app: any, method: string, url: string, payload?: unknown, headers: any = hdr) => app.inject({method, url, headers, ...(payload === undefined ? {} : {payload: payload as any})});
  const projectOf = async (app: any, id: string) => (await req(app, "GET", "/v1/projects")).json().projects.find((p: any) => p.projectId === id);
  const events = (runtime: string) => { const f = path.join(runtime, "control-api-events.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []; };
  const intakeEvents = (runtime: string) => events(runtime).filter((e: any) => e.details?.kind === "intake");

  it("S1 web-node: one POST creates the project with a managed starting repository and the template's commands; a replay rebuilds nothing", async () => {
    const {app} = mkApp();
    const body = {idea: TPL_IDEA, title: "Reading tracker", template: "web-node", idempotencyKey: "tpl-s1"};
    const made = await req(app, "POST", "/v1/intakes", body);
    expect(made.statusCode, made.body).toBe(201);
    const intake = made.json().intake;
    expect(intake.repository).toEqual({kind: "TEMPLATE", template: "web-node", managed: true, testCommandSource: "TEMPLATE"});
    expect(["projectType", "testCommand", "testCommandSha256"].filter(k => k in intake)).toEqual([]); // kayıttaki bu alanlar yalnız Founder değeridir
    expect(made.body).not.toContain(tmp); expect(made.body).not.toContain("repo\""); // yanıt depo yolu taşımaz
    const repo = path.join(tplData(), "projects", intake.projectId, "repo");
    const p = await projectOf(app, intake.projectId);
    expect(p).toMatchObject({template: "web-node", projectType: "web", testCommand: ["node", "test.js"], devCommand: ["node", "server.js"], repository: {path: repo, managed: true}});
    expect(managedRepoCanonical(tplData(), intake.projectId, p.repository.path)).not.toBeNull();
    expect(tplAuthorSubject(repo)).toBe("UASCO Project Studio <studio@local.invalid>|Initial commit from template web-node");
    expect(tplGit(repo, ["status", "--porcelain"])).toBe("");
    const files = await req(app, "GET", `/v1/projects/${intake.projectId}/files`);
    expect(files.statusCode).toBe(200);
    expect(files.json().entries.map((e: any) => e.name)).toEqual(expect.arrayContaining(["package.json", "server.js", "test.js", "README.md", "public"]));
    expect((await req(app, "GET", `/v1/missions/${intake.missionId}`)).json().mission.testCommand).toBeUndefined(); // runner mission ?? proje okur
    const head = tplGit(repo, ["rev-parse", "HEAD"]), n = tplJournalN();
    const replay = await req(app, "POST", "/v1/intakes", body);
    expect([replay.statusCode, replay.json().intake]).toEqual([200, intake]);
    expect([tplPrjDirs(), tplGit(repo, ["rev-parse", "HEAD"]), tplJournalN(), tplIntakeLines().length]).toEqual([[intake.projectId], head, n, 1]);
    expect((await req(app, "GET", `/v1/intakes/${intake.intakeId}`)).json().intake).toEqual(intake);
    await app.close();
  });
  it("S2 the Founder's test command and project type win over the template defaults (testCommandSource FOUNDER)", async () => {
    const {app} = mkApp();
    const r = await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "web-node", testCommand: ["npm", "test"], projectType: "api", idempotencyKey: "tpl-s2"});
    expect(r.statusCode, r.body).toBe(201);
    const i = r.json().intake;
    expect([i.repository.testCommandSource, i.testCommand, i.projectType]).toEqual(["FOUNDER", ["npm", "test"], "api"]);
    expect(await projectOf(app, i.projectId)).toMatchObject({template: "web-node", projectType: "api", testCommand: ["npm", "test"], devCommand: ["node", "server.js"]});
    await app.close();
  });
  it("S3 the empty template: a repository without a test command (NONE), or with the Founder's command (FOUNDER)", async () => {
    const {app} = mkApp();
    const a = (await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "empty", idempotencyKey: "tpl-s3a"})).json().intake;
    expect(a.repository).toEqual({kind: "TEMPLATE", template: "empty", managed: true, testCommandSource: "NONE"});
    const pa = await projectOf(app, a.projectId);
    expect(pa).toMatchObject({template: "empty", projectType: "other", repository: {managed: true}});
    expect(["testCommand", "devCommand"].filter(k => k in pa)).toEqual([]);
    expect(fs.readdirSync(pa.repository.path).sort()).toEqual([".git", ".gitignore", "README.md"]);
    const b = (await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "empty", testCommand: ["node", "t.js"], idempotencyKey: "tpl-s3b"})).json().intake;
    expect(b.repository.testCommandSource).toBe("FOUNDER");
    expect((await projectOf(app, b.projectId)).testCommand).toEqual(["node", "t.js"]);
    await app.close();
  });
  it("S4 the same key with another template, or with none, is 409 INTAKE_IDEMPOTENCY_CONFLICT and builds no repository", async () => {
    const {app} = mkApp();
    const body = {idea: TPL_IDEA, template: "web-node", idempotencyKey: "tpl-s4"};
    expect((await req(app, "POST", "/v1/intakes", body)).statusCode).toBe(201);
    const plain = {idea: TPL_IDEA, idempotencyKey: "tpl-s4-plain"};
    expect((await req(app, "POST", "/v1/intakes", plain)).statusCode).toBe(201);
    const n = tplJournalN(), dirs = tplPrjDirs();
    expect(dirs).toHaveLength(1);
    for (const other of [{...body, template: "node-lib"}, {...body, template: "empty", testCommand: ["node", "t.js"]}, {idea: TPL_IDEA, idempotencyKey: "tpl-s4"}, {...plain, template: "web-node"}]) {
      const c = await req(app, "POST", "/v1/intakes", other);
      expect([c.statusCode, c.json().error], JSON.stringify(other)).toEqual([409, "INTAKE_IDEMPOTENCY_CONFLICT"]);
    }
    expect([tplJournalN(), tplPrjDirs(), tplIntakeLines().length]).toEqual([n, dirs, 2]);
    await app.close();
  });
  it("S5 an unknown template, a template without a key, or a template with client repository/command fields is 400 and writes nothing", async () => {
    const {runtime, app} = mkApp();
    const bads: unknown[] = [{idea: TPL_IDEA, template: "rails", idempotencyKey: "k"}, {idea: TPL_IDEA, template: "web-node"}, {idea: TPL_IDEA, template: "web-node", idempotencyKey: "k", repository: {path: path.join(tmp, "x")}},
      {idea: TPL_IDEA, template: "web-node", idempotencyKey: "k", devCommand: ["node", "x.js"]}, {idea: TPL_IDEA, template: ["web-node"], idempotencyKey: "k"}, {idea: TPL_IDEA, template: "", idempotencyKey: "k"}, {idea: TPL_IDEA, template: null, idempotencyKey: "k"}];
    for (const bad of bads) {
      const r = await req(app, "POST", "/v1/intakes", bad);
      expect([r.statusCode, r.json().error], JSON.stringify(bad)).toEqual([400, "INVALID_BODY"]);
    }
    expect((await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "web-node"})).json().detail).toBe("template requires idempotencyKey");
    expect([fs.existsSync(path.join(tplData(), "projects")), tplJournalN(), fs.existsSync(tplIntakes()), intakeEvents(runtime)]).toEqual([false, 0, false, []]);
    await app.close();
  });
  it("S6 Global Stop (423) and a policy denial (403) refuse a template intake before anything is built", async () => {
    const {runtime, app} = mkApp();
    const body = {idea: TPL_IDEA, template: "web-node", idempotencyKey: "tpl-s6"};
    fs.writeFileSync(path.join(runtime, "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    const stopped = await req(app, "POST", "/v1/intakes", body);
    expect([stopped.statusCode, stopped.json().error]).toEqual([423, "GLOBAL_STOP_ACTIVE"]);
    fs.rmSync(path.join(runtime, "GLOBAL_STOP.json"));
    await app.close();
    const denied = mkApp({policyContext: {scopeAllowed: false}});
    const d = await req(denied.app, "POST", "/v1/intakes", body);
    expect([d.statusCode, d.json().error]).toEqual([403, "ACTION_DENIED"]);
    await denied.app.close();
    expect([fs.existsSync(path.join(tplData(), "projects")), tplJournalN(), fs.existsSync(tplIntakes()), intakeEvents(runtime)]).toEqual([false, 0, false, []]);
    expect(events(runtime).map((e: any) => e.event)).toContain("WORKOS_WRITE_DENIED");
  });
  it("S7 a full disk on the PROJECT_CREATED append is 507 and the store discards the repository it just built", async () => {
    const {app} = mkApp({workosStoreOptions: {io: {writeSync: () => { throw Object.assign(new Error("x"), {code: "ENOSPC"}); }}}});
    const body = {idea: TPL_IDEA, template: "web-node", idempotencyKey: "tpl-s7"};
    const r = await req(app, "POST", "/v1/intakes", body);
    expect([r.statusCode, r.json().error]).toEqual([507, "WORKOS_DISK_FULL"]);
    expect([tplPrjDirs(), fs.existsSync(tplIntakes()), tplJournalN()]).toEqual([[], false, 0]);
    await app.close();
    const ok = mkApp().app; // aynı anahtarla sonraki deneme tek depo kurar
    expect((await req(ok, "POST", "/v1/intakes", body)).statusCode).toBe(201);
    expect(tplPrjDirs()).toHaveLength(1);
    await ok.close();
  });
  it("S8 a repository that cannot be created is 500 PROJECT_REPOSITORY_INIT_FAILED with no project, no record and no journal entry", async () => {
    fs.mkdirSync(tplData(), {recursive: true});
    fs.writeFileSync(path.join(tplData(), "projects"), "not a directory");
    const {app} = mkApp();
    const r = await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "node-lib", idempotencyKey: "tpl-s8"});
    expect([r.statusCode, r.json().error]).toEqual([500, "PROJECT_REPOSITORY_INIT_FAILED"]);
    expect(r.body).not.toContain(tmp);
    expect((await req(app, "GET", "/v1/projects")).json().projects).toEqual([]);
    expect([fs.existsSync(tplIntakes()), tplJournalN()]).toEqual([false, 0]);
    await app.close();
  });
  it("S9 parity with POST /v1/projects for every template: the same fields, the same tree, the same author and subject (also with Founder overrides)", async () => {
    const {app} = mkApp();
    const pick = (p: any) => ({template: p.template, projectType: p.projectType, testCommand: p.testCommand, devCommand: p.devCommand, managed: p.repository?.managed});
    const cases: Array<[string, Record<string, unknown>]> = [["web-node", {}], ["node-lib", {}], ["empty", {}], ["web-node", {testCommand: ["npm", "test"], projectType: "api"}], ["empty", {testCommand: ["node", "t.js"]}]];
    for (const [i, [t, extra]] of cases.entries()) {
      const N = `Parity ${t} ${i}`;
      const viaProject = await req(app, "POST", "/v1/projects", {name: N, environmentId: "local", template: t, ...extra});
      const viaIntake = await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, title: N, template: t, idempotencyKey: `parity-${i}`, ...extra});
      expect([viaProject.statusCode, viaIntake.statusCode], `${t} ${viaProject.body} ${viaIntake.body}`).toEqual([201, 201]);
      const a = viaProject.json().project, b = await projectOf(app, viaIntake.json().intake.projectId);
      expect(pick(b), N).toEqual(pick(a));
      expect(tplGit(b.repository.path, ["rev-parse", "HEAD^{tree}"]), N).toBe(tplGit(a.repository.path, ["rev-parse", "HEAD^{tree}"]));
      expect(tplAuthorSubject(b.repository.path), N).toBe(tplAuthorSubject(a.repository.path));
    }
    await app.close();
  });
  it("S10 an intake project's managed repository cannot be replaced by an import (409 PROJECT_REPOSITORY_ALREADY_MANAGED)", async () => {
    const {app} = mkApp();
    const i = (await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "node-lib", idempotencyKey: "tpl-s10"})).json().intake;
    const src = path.join(tmp, "src"); fs.mkdirSync(src);
    const r = await req(app, "POST", `/v1/projects/${i.projectId}/import`, {kind: "git", path: src});
    expect([r.statusCode, r.json().error]).toEqual([409, "PROJECT_REPOSITORY_ALREADY_MANAGED"]);
    await app.close();
  });
  it("S11 tenant isolation: another tenant on the same data dir sees nothing, and the same key there makes a distinct intake, project and repository", async () => {
    const {app} = mkApp();
    const body = {idea: TPL_IDEA, template: "web-node", idempotencyKey: "tpl-s11"};
    const a = (await req(app, "POST", "/v1/intakes", body)).json().intake;
    await app.close();
    const other = mkApp({tenantId: "tB"}).app;
    expect((await req(other, "GET", `/v1/intakes/${a.intakeId}`)).statusCode).toBe(404);
    expect((await req(other, "GET", "/v1/projects")).json().projects).toEqual([]);
    expect((await req(other, "GET", `/v1/projects/${a.projectId}/files`)).statusCode).toBe(404);
    const b = await req(other, "POST", "/v1/intakes", body);
    expect(b.statusCode).toBe(201);
    const bi = b.json().intake;
    expect([bi.intakeId === a.intakeId, bi.projectId === a.projectId]).toEqual([false, false]);
    expect(tplPrjDirs()).toEqual([a.projectId, bi.projectId].sort());
    expect((await projectOf(other, bi.projectId)).repository.path).toBe(path.join(tplData(), "projects", bi.projectId, "repo"));
    await other.close();
  });
  it("S12 the control audit names the template on create and replay (no path), and a template-less intake's audit is unchanged", async () => {
    const {runtime, app} = mkApp();
    const body = {idea: TPL_IDEA, template: "node-lib", idempotencyKey: "tpl-s12"};
    await req(app, "POST", "/v1/intakes", body); await req(app, "POST", "/v1/intakes", body);
    await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, template: "rails", idempotencyKey: "x"});
    await req(app, "POST", "/v1/intakes", {idea: TPL_IDEA, idempotencyKey: "tpl-s12-plain"});
    const ev = intakeEvents(runtime);
    expect(ev.map((e: any) => [e.event, e.details.template ?? null])).toEqual([["WORKOS_INTAKE_CREATED", "node-lib"], ["WORKOS_IDEMPOTENT_REPLAY", "node-lib"], ["WORKOS_INTAKE_CREATED", null]]);
    expect("template" in ev[2].details).toBe(false);
    expect(JSON.stringify(ev)).not.toContain(tmp);
    await app.close();
  });
  it("S13 a web-node intake's mission runs with no manual seeding: VERIFY executes the template test; a template-less intake still blocks; without a sandbox the test is NOT_EXECUTED", async () => {
    const {app} = mkApp();
    const post = async (b: unknown) => { const r = await req(app, "POST", "/v1/intakes", b); expect(r.statusCode, r.body).toBe(201); return r.json().intake; };
    const tpl = await post({idea: TPL_IDEA, template: "web-node", idempotencyKey: "tpl-s13"});
    const plain = await post({idea: TPL_IDEA + " (plain)", idempotencyKey: "tpl-s13-plain"});
    const nosbx = await post({idea: TPL_IDEA + " (no sandbox)", template: "node-lib", idempotencyKey: "tpl-s13-nosbx"});
    await app.close();
    const store = new WorkOsStore(tplData());
    const runtime = path.join(tmp, "runtime-run"); fs.mkdirSync(runtime, {recursive: true});
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
    const pair = fake.pair(), dev = bindingForFunction("developer");
    const drive = async (missionId: string, gate: ExecutionGate) => {
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, missionId, to, "founder go", ACTOR);
      const run = store.createRun({tenantId: scope.tenantId, missionId, roleId: dev.roleId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: ACTOR});
      await new MissionRunner({executionGate: gate, store, dataDir: store.dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: APP_ENV_POLICY_FILE,
        executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(tmp, "sec")).options}).tick();
      return store.getRun(scope, run.runId)!;
    };
    const done = await drive(tpl.missionId, testExecutionGate());
    const ev = JSON.stringify(done.evidence);
    expect(ev).not.toContain("REPOSITORY_NOT_CONFIGURED"); expect(ev).not.toContain("TEST_COMMAND_NOT_CONFIGURED");
    expect(fake.calls.implement).toBe(1);
    const verify = done.evidence.find(e => e.kind === "VERIFY_TESTS");
    expect(verify, `run ${done.status}/${done.step}/${done.reason}`).toBeDefined();
    // Şablonun testi gerçekten çalıştı ve geçti (runner yürütülebilir dosyayı mutlak yola çözer).
    expect([path.basename(verify!.argv[0]).replace(/\.exe$/i, ""), verify!.argv.slice(1), verify!.exitCode]).toEqual(["node", ["test.js"], 0]);
    // Dürüst iddia: FAKE executor ile koşu REPORT'ta Founder kararını bekler; bu bir CLEAN/COMPLETE/doğrulama iddiası değildir.
    expect([done.status, done.step]).toEqual(["AWAITING_APPROVAL", "REPORT"]);
    const blocked = await drive(plain.missionId, testExecutionGate());
    expect([blocked.status, blocked.reason]).toEqual(["BLOCKED", "REPOSITORY_NOT_CONFIGURED"]);
    // Doğrulanmış sandbox yoksa proje kodu ana makinede çalıştırılmaz: kanıt NOT_EXECUTED (SANDBOX_UNAVAILABLE), asla VERIFY_TESTS değil.
    const ns = await drive(nosbx.missionId, new ExecutionGate(null));
    expect(ns.evidence.some(e => e.kind === "VERIFY_TESTS")).toBe(false);
    expect(ns.evidence.find(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED")?.note).toContain("SANDBOX_UNAVAILABLE");
    expect(JSON.stringify(ns.evidence)).not.toContain("REPOSITORY_NOT_CONFIGURED");
  });
});

// //TR: COORD-FIRST-DELIVERY-WIRING gerçek Electron E2E betiğinin (scripts/e2e-first-delivery-electron.mjs) süreç hijyeni: betik GERÇEK haliyle, ama Electron/Control API yerine kendi pid'ini ve ortamını yazıp bekleyen sahte çocuk süreçle çalıştırılır. Veri dizini/HOME çalışan kullanıcının ev dizininden (veya UASCO_E2E_HOME'dan) türetilir, sabit /home/e2e kullanılmaz; SIGINT/SIGTERM'de ayrı süreç grubundaki çocuklar öldürülür. Yalnız Linux (betik süreç grupları kullanır).
describe.skipIf(process.platform !== "linux")("COORD first-delivery Electron E2E harness hygiene (stub children)", () => {
  const script = path.resolve(__dirname, "..", "scripts", "e2e-first-delivery-electron.mjs");
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => T | undefined | false, ms = 20_000): Promise<T> => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v as T; if (Date.now() > end) throw new Error("WAIT_TIMEOUT"); await sleep(50); } };
  const alive = (pid: number) => { try { return !/^Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /, "")); } catch { return false; } };
  const stage = () => {
    const w = path.join(tmp, "repo");
    for (const d of ["automation/lib", "config", "node_modules/tsx/dist"]) fs.mkdirSync(path.join(w, d), {recursive: true});
    fs.writeFileSync(path.join(w, "automation/lib/env-policy.mjs"), "export const safeChildEnv = () => ({PATH: process.env.PATH ?? ''});\n");
    fs.writeFileSync(path.join(w, "config/environment-policy.json"), "{}\n");
    fs.writeFileSync(path.join(w, "node_modules/tsx/dist/cli.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(tmp, "child.json"))}, JSON.stringify({pid: process.pid, home: process.env.HOME, data: process.env.UASCO_DATA_DIR})); setInterval(() => {}, 1000);\n`);
    return w;
  };
  const run = async (env: Record<string, string>, body: (h: {proc: import("node:child_process").ChildProcess; child: {pid: number; home: string; data: string}; exited: Promise<number | null>; out: string}) => Promise<void>) => {
    const w = stage(), out = path.join(tmp, "report.json");
    const proc = cp.spawn(process.execPath, [script, w, out, path.join(tmp, "no-electron")], {env: {...process.env, ...env}, stdio: "ignore"});
    const exited = new Promise<number | null>(res => proc.on("exit", code => res(code)));
    let child: {pid: number; home: string; data: string} | undefined;
    try {
      child = await waitFor(() => { try { return JSON.parse(fs.readFileSync(path.join(tmp, "child.json"), "utf8")); } catch { return undefined; } });
      await body({proc, child: child!, exited, out});
    } finally {
      if (child && alive(child.pid)) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* zaten bitti */ } }
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
      expect(alive(child.pid)).toBe(true);
      proc.kill(sig);
      const exitCode = await exited;
      await waitFor(() => !alive(child.pid), 5_000); // WAIT_TIMEOUT = sahipsiz kalan süreç grubu
      expect(exitCode).toBe(code);
      const report = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(report.status).toBe("FAIL");
      expect(report.steps.map((x: any) => x.name)).toContain("harness interrupted");
    });
  });
});
