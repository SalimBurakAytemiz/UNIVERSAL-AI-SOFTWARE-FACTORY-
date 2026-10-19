// //TR: Bu test B1 inceleme bulgularının (F-B1-001/002/004/005/006/007) düzeltmelerini gerçek negatif senaryolarla ve GET /v1/cockpit tek okuma otoritesini (UNAVAILABLE/ERROR/VERIFIED/STALE durumları, doğru sayılar, GLOBAL_STOP, token zorunluluğu) gerçek dosya I/O ile doğrular.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (test yardımcı olarak geçerli hash'li journal satırı üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";
import {WorkOsStore, defaultDataDir} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

const sha256 = sha256Untyped as (v: unknown) => string;
const REPO = path.resolve(import.meta.dirname, "..");
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b2-")); });
afterEach(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

const proj = (tenantId = "tA") => ({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
const msn = (projectId: string, tenantId = "tA") => ({tenantId, projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1" as const, createdBy: "FOUNDER_LOCAL"});
const lines = (dir: string) => fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean);
const GENESIS = "0".repeat(64);
// Geçerli hash zincirine sahip ama payload'ı bozuk bir journal satırı üretir (hash doğrulaması geçer, apply başarısız olur).
function writeMalformedJournal(dir: string, type: string, payload: unknown) {
  fs.mkdirSync(dir, {recursive: true});
  const body = {seq: 1, prevHash: GENESIS, type, actor: "TEST", at: new Date().toISOString(), payload};
  fs.writeFileSync(path.join(dir, "journal.jsonl"), JSON.stringify({...body, hash: sha256(body)}) + "\n");
}

describe("B2 store hardening", () => {
  it("F-B1-001: idempotency keys cannot collide across tenants", () => {
    const s = new WorkOsStore(path.join(tmp, "d"));
    // the old key `${tenant}|${kind}|${key}` was identical for these two (tenant, key) pairs
    const a = s.createProject({...proj("a|project|b"), idempotencyKey: "c"});
    const b = s.createProject({...proj("a"), idempotencyKey: "b|project|c"});
    expect(b.projectId).not.toBe(a.projectId);
    expect(b.tenantId).toBe("a");
    expect(a.tenantId).toBe("a|project|b");
    expect(s.listProjects({tenantId: "a"}).map(p => p.projectId)).toEqual([b.projectId]);
    // the first tenant's key was not overwritten by the second tenant's colliding key
    expect(s.createProject({...proj("a|project|b"), idempotencyKey: "c"})).toEqual(a);
    // same tenant + same key + same payload is still a replay
    expect(s.createProject({...proj("a"), idempotencyKey: "b|project|c"})).toEqual(b);
    // same key text in another tenant is independent
    expect(s.createProject({...proj("tZ"), idempotencyKey: "c"}).projectId).not.toBe(a.projectId);
  });

  it("F-B1-002: malformed payload, IO error and tamper all fail closed (never empty data)", () => {
    for (const [type, payload] of [["PROJECT_CREATED", {}], ["PROJECT_CREATED", {entity: null}], ["MISSION_CREATED", {entity: {missionId: "x"}}], ["TASK_CREATED", "str"], ["MISSION_TRANSITIONED", {}]] as const) {
      const dir = path.join(tmp, `m-${crypto.randomBytes(3).toString("hex")}`);
      writeMalformedJournal(dir, type, payload);
      const before = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
      const s = new WorkOsStore(dir);
      expect(s.isUnavailable).toBe(true);
      expect(() => s.listProjects({tenantId: "tA"})).toThrow(/WORKOS_UNAVAILABLE/);
      expect(() => s.createProject(proj())).toThrow(/WORKOS_UNAVAILABLE/);
      expect(fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8")).toBe(before);
    }
    // IO error: the journal path is a directory
    const dio = path.join(tmp, "io");
    fs.mkdirSync(path.join(dio, "journal.jsonl"), {recursive: true});
    const sio = new WorkOsStore(dio);
    expect(() => sio.listMissions({tenantId: "tA"})).toThrow(/WORKOS_UNAVAILABLE/);
    expect(() => sio.createProject(proj())).toThrow(/WORKOS_UNAVAILABLE/);
  });

  it("F-B1-002: failure is not sticky once the journal is valid again, and a good state is never half-replaced", () => {
    const dir = path.join(tmp, "d");
    const s = new WorkOsStore(dir);
    const p = s.createProject(proj());
    const good = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    fs.writeFileSync(path.join(dir, "journal.jsonl"), good.replace('"name":"P"', '"name":"X"'));
    expect(() => s.listProjects({tenantId: "tA"})).toThrow(/WORKOS_JOURNAL_TAMPERED/);
    fs.writeFileSync(path.join(dir, "journal.jsonl"), good);
    expect(s.listProjects({tenantId: "tA"})).toEqual([p]);
  });

  it("F-B1-004: default data dir is under .ai/runtime/workos (git-ignored) unless UASCO_DATA_DIR is set; urls with userinfo are rejected", () => {
    const saved = process.env.UASCO_DATA_DIR;
    try {
      delete process.env.UASCO_DATA_DIR;
      expect(defaultDataDir(path.join(tmp, "repo"))).toBe(path.join(tmp, "repo", ".ai", "runtime", "workos"));
      process.env.UASCO_DATA_DIR = path.join(tmp, "custom");
      expect(defaultDataDir(path.join(tmp, "repo"))).toBe(path.join(tmp, "custom"));
    } finally { if (saved === undefined) delete process.env.UASCO_DATA_DIR; else process.env.UASCO_DATA_DIR = saved; }
    const r = cp.spawnSync("git", ["check-ignore", "-q", ".ai/runtime/workos/journal.jsonl"], {cwd: REPO});
    expect(r.status).toBe(0);
    const s = new WorkOsStore(path.join(tmp, "d"));
    for (const url of ["https://user:pw@github.com/o/r.git", "https://tok@github.com/o/r.git", "ssh://git:x@host/o/r", "user:pw@host:o/r"]) {
      expect(() => s.createProject({...proj(), repository: {url}})).toThrow(/WORKOS_INVALID_INPUT/);
    }
    expect(s.hasJournal).toBe(false);
    expect(s.createProject({...proj(), repository: {url: "https://github.com/o/r.git"}}).repository?.url).toBe("https://github.com/o/r.git");
    expect(s.createProject({...proj(), repository: {url: "git@github.com:o/r.git"}}).projectId).toMatch(/^prj_/);
  });

  it("F-B1-005: same key with a different payload conflicts; same payload is a replay without a new entry", () => {
    const dir = path.join(tmp, "d");
    const s = new WorkOsStore(dir);
    const r1 = s.createProjectDetailed({...proj(), idempotencyKey: "k"});
    expect(r1.replayed).toBe(false);
    const n = lines(dir).length;
    const r2 = s.createProjectDetailed({...proj(), idempotencyKey: "k"});
    expect(r2.replayed).toBe(true);
    expect(r2.entity).toEqual(r1.entity);
    expect(() => s.createProjectDetailed({...proj(), name: "Other", idempotencyKey: "k"})).toThrow(/WORKOS_IDEMPOTENCY_CONFLICT/);
    expect(lines(dir).length).toBe(n);
    const m1 = s.createMissionDetailed({...msn(r1.entity.projectId), idempotencyKey: "m"});
    expect(() => s.createMissionDetailed({...msn(r1.entity.projectId), riskLevel: "R3", idempotencyKey: "m"})).toThrow(/WORKOS_IDEMPOTENCY_CONFLICT/);
    expect(s.createMissionDetailed({...msn(r1.entity.projectId), idempotencyKey: "m"}).entity).toEqual(m1.entity);
    // the stored digest survives a restart
    expect(() => new WorkOsStore(dir).createProject({...proj(), name: "Other", idempotencyKey: "k"})).toThrow(/WORKOS_IDEMPOTENCY_CONFLICT/);
  });

  it("F-B1-006: a second store instance sees the first one's writes and appends keep a valid chain", () => {
    const dir = path.join(tmp, "d");
    const s1 = new WorkOsStore(dir), s2 = new WorkOsStore(dir);
    const p1 = s1.createProject(proj());
    expect(s2.listProjects({tenantId: "tA"}).map(p => p.projectId)).toEqual([p1.projectId]);
    const p2 = s2.createProject(proj());
    expect(s1.getProject({tenantId: "tA"}, p2.projectId)).toEqual(p2);
    for (let i = 0; i < 10; i++) { (i % 2 ? s1 : s2).createProject(proj()); }
    const fresh = new WorkOsStore(dir);
    expect(fresh.isTampered).toBe(false);
    expect(fresh.isUnavailable).toBe(false);
    expect(fresh.listProjects({tenantId: "tA"}).length).toBe(12);
    expect(lines(dir).map(l => JSON.parse(l).seq)).toEqual(Array.from({length: 12}, (_, i) => i + 1));
    expect(fs.existsSync(path.join(dir, "journal.lock"))).toBe(false);
    // out-of-band tamper after s1's last read is detected by the next read, not served stale
    const file = path.join(dir, "journal.jsonl");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"name":"P"', '"name":"Q"'));
    expect(() => s1.listProjects({tenantId: "tA"})).toThrow(/WORKOS_JOURNAL_TAMPERED/);
  });

  it("F-B1-006: concurrent appends from separate processes never corrupt the chain", () => {
    const dir = path.join(tmp, "d");
    const storeUrl = new URL(`file:///${path.join(REPO, "core", "workos", "store.ts").split(path.sep).join("/")}`).href;
    const script = path.join(tmp, "child.mts");
    fs.writeFileSync(script, `import {WorkOsStore} from ${JSON.stringify(storeUrl)};
const s = new WorkOsStore(process.argv[2]);
for (let i = 0; i < 12; i++) s.createProject({tenantId: "tA", orgId: "o", name: "P" + process.argv[3] + "-" + i, environmentId: "dev", createdBy: "CHILD"});
`);
    const tsx = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
    const kids = [0, 1, 2].map(i => new Promise<number | null>(resolve => {
      const c = cp.spawn(process.execPath, [tsx, script, dir, String(i)], {stdio: "ignore", cwd: REPO});
      c.on("exit", code => resolve(code));
    }));
    return Promise.all(kids).then(codes => {
      expect(codes).toEqual([0, 0, 0]);
      const fresh = new WorkOsStore(dir);
      expect(fresh.isTampered).toBe(false);
      expect(fresh.isUnavailable).toBe(false);
      expect(fresh.listProjects({tenantId: "tA"}).length).toBe(36);
      expect(lines(dir).map(l => JSON.parse(l).seq)).toEqual(Array.from({length: 36}, (_, i) => i + 1));
    });
  }, 60_000);
});

describe("B2 API hardening and cockpit", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mkApp = (extra: Record<string, unknown> = {}) => {
    const repo = path.join(tmp, "repo"), runtime = path.join(repo, ".ai", "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    return {repo, runtime, app: buildServer({controlToken: token, runtime, repoRoot: repo, port: 3210, logger: false, ...extra})};
  };
  const project = {name: "API project", environmentId: "dev"};
  const mission = (projectId: string) => ({projectId, title: "M", objective: "obj", acceptanceCriteria: ["a"], riskLevel: "R2"});
  const noEnvDataDir = () => { delete process.env.UASCO_DATA_DIR; };

  it("F-B1-002: malformed journal gives 503 WORKOS_UNAVAILABLE for both GET and POST", async () => {
    noEnvDataDir();
    const {app, repo} = mkApp();
    const dir = path.join(repo, ".ai", "runtime", "workos");
    writeMalformedJournal(dir, "PROJECT_CREATED", {});
    for (const r of [await app.inject({method: "GET", url: "/v1/projects", headers: hdr}), await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project}),
      await app.inject({method: "GET", url: "/v1/missions", headers: hdr})]) {
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({error: "WORKOS_UNAVAILABLE"});
    }
    expect(lines(dir).length).toBe(1);
    await app.close();
  });

  it("F-B1-004: userinfo repository.url is a 400 and nothing is written", async () => {
    const {app, repo} = mkApp({dataDir: path.join(tmp, "data")});
    for (const url of ["https://user:pw@github.com/o/r.git", "https://tok@github.com/o/r.git"]) {
      const r = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: {...project, repository: {url}}});
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain("pw@");
    }
    expect(fs.existsSync(path.join(tmp, "data", "journal.jsonl"))).toBe(false);
    expect((await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: {...project, repository: {url: "https://github.com/o/r.git"}}})).statusCode).toBe(201);
    expect(fs.readFileSync(path.join(repo, ".ai", "runtime", "control-api-events.jsonl"), "utf8")).not.toContain("user:pw");
    await app.close();
  });

  it("F-B1-005: payload-mismatch replay is 409; same-payload replay is 200 and audits WORKOS_IDEMPOTENT_REPLAY", async () => {
    const {app, runtime} = mkApp({dataDir: path.join(tmp, "data")});
    const body = {...project, idempotencyKey: "idem-1"};
    const c1 = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: body});
    expect(c1.statusCode).toBe(201);
    const c2 = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: body});
    expect(c2.statusCode).toBe(200);
    expect(c2.json().project).toEqual(c1.json().project);
    const c3 = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: {...body, name: "Different"}});
    expect(c3.statusCode).toBe(409);
    expect(c3.json()).toEqual({error: "IDEMPOTENCY_CONFLICT"});
    const mb = {...mission(c1.json().project.projectId), idempotencyKey: "idem-m"};
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: mb})).statusCode).toBe(201);
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: mb})).statusCode).toBe(200);
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: {...mb, riskLevel: "R4"}})).statusCode).toBe(409);
    const audit = fs.readFileSync(path.join(runtime, "control-api-events.jsonl"), "utf8");
    expect((audit.match(/WORKOS_PROJECT_CREATED/g) ?? []).length).toBe(1);
    expect((audit.match(/WORKOS_MISSION_CREATED/g) ?? []).length).toBe(1);
    expect((audit.match(/WORKOS_IDEMPOTENT_REPLAY/g) ?? []).length).toBe(2);
    expect(lines(path.join(tmp, "data")).length).toBe(2);
    await app.close();
  });

  it("F-B1-007: unknown errors return a generic 500 without filesystem paths or stack", async () => {
    const {app, runtime} = mkApp({dataDir: path.join(tmp, "data")});
    // an unexpected failure after the write (audit sink is a directory) must not leak the path
    fs.mkdirSync(path.join(runtime, "control-api-events.jsonl"));
    const r = await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({error: "INTERNAL_ERROR"});
    expect(r.body).not.toContain(tmp);
    expect(r.body).not.toMatch(/\bat\s+\S+\s*\(|node_modules|\.ts:\d+|EISDIR|ENOENT/);
    await app.close();
  });

  describe("GET /v1/cockpit", () => {
    const get = (app: ReturnType<typeof buildServer>) => app.inject({method: "GET", url: "/v1/cockpit", headers: hdr});
    const policy = {roots: {stateFile: "${REPO}/.ai/cache/review/ORCHESTRATOR_STATE.json", transitionLog: "${REPO}/.ai/cache/review/orchestrator-transitions.jsonl"}};
    const seedPolicy = (repo: string) => { fs.mkdirSync(path.join(repo, "config"), {recursive: true}); fs.writeFileSync(path.join(repo, "config", "orchestrator-policy.json"), JSON.stringify(policy)); };
    const stateFile = (repo: string) => path.join(repo, ".ai", "cache", "review", "ORCHESTRATOR_STATE.json");
    const seedState = (repo: string, doc: unknown) => { fs.mkdirSync(path.dirname(stateFile(repo)), {recursive: true}); fs.writeFileSync(stateFile(repo), typeof doc === "string" ? doc : JSON.stringify(doc)); };
    const control = (extra: Record<string, unknown> = {}) => ({
      schemaVersion: "2.0.0", order: ["A", "B", "C"], ...extra,
      packages: {A: {id: "A", kind: "IMPLEMENT", status: "QUEUED", cycle: 1}, B: {id: "B", kind: "IMPLEMENT", status: "MERGED", cycle: 1}, C: {id: "C", kind: "IMPLEMENT", status: "QUEUED", cycle: 2}}
    });

    it("rejects requests without a valid control token", async () => {
      const {app} = mkApp();
      expect((await app.inject({method: "GET", url: "/v1/cockpit", headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
      expect((await app.inject({method: "GET", url: "/v1/cockpit", headers: {...hdr, "x-uasco-control-token": "wrong"}})).statusCode).toBe(403);
      await app.close();
    });

    it("reports every block UNAVAILABLE with null counts on an empty repo and invents nothing", async () => {
      noEnvDataDir();
      const {app, repo} = mkApp();
      const r = await get(app);
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(Number.isFinite(Date.parse(j.generatedAt))).toBe(true);
      expect(j.globalStop).toEqual({active: false, reason: null});
      expect(j.projects).toEqual({state: "UNAVAILABLE", count: null});
      expect(j.missions).toEqual({state: "UNAVAILABLE", total: null, byStatus: {}});
      expect(j.awaitingApproval).toEqual({state: "UNAVAILABLE", items: []});
      expect(j.orchestrator).toEqual({state: "UNAVAILABLE", asOf: null, packages: {total: null, byStatus: {}}, source: "ORCHESTRATOR_STATE"});
      expect(j.workforce.state).toBe("UNAVAILABLE");
      expect(j.workforce.registeredRoles).toBeNull();
      expect(j.workforce.targetRoles).toBeNull();
      expect(j.workforce.activeWorkerRuns).toBeNull();
      expect(j.legacy).toEqual({scheduler: {authority: false, note: "LEGACY_SNAPSHOT"}});
      expect(fs.existsSync(path.join(repo, ".ai", "runtime", "workos"))).toBe(false);
      await app.close();
    });

    it("counts seeded Work OS data and registries correctly", async () => {
      noEnvDataDir();
      const {app, repo} = mkApp();
      const p1 = (await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project})).json().project;
      await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: {...project, name: "second"}});
      const ids: string[] = [];
      for (const t of ["m1", "m2", "m3"]) ids.push((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: {...mission(p1.projectId), title: t}})).json().mission.missionId);
      const tr = (id: string, to: string) => app.inject({method: "POST", url: `/v1/missions/${id}/transition`, headers: hdr, payload: {to, reason: "test"}});
      expect((await tr(ids[1], "PREFLIGHT")).statusCode).toBe(200);
      expect((await tr(ids[2], "PREFLIGHT")).statusCode).toBe(200);
      expect((await tr(ids[2], "FOUNDER_ATTENTION_REQUIRED")).statusCode).toBe(200);
      fs.mkdirSync(path.join(repo, "registries"), {recursive: true});
      fs.writeFileSync(path.join(repo, "registries", "agents.json"), JSON.stringify({agents: [{id: "1"}, {id: "2"}, {id: "3"}]}));
      fs.writeFileSync(path.join(repo, "registries", "role-definitions.json"), JSON.stringify({roles: [1, 2, 3, 4, 5].map(id => ({id}))}));
      const j = (await get(app)).json();
      expect(j.projects).toEqual({state: "VERIFIED", count: 2});
      expect(j.missions).toEqual({state: "VERIFIED", total: 3, byStatus: {DRAFT: 1, PREFLIGHT: 1, FOUNDER_ATTENTION_REQUIRED: 1}});
      expect(j.awaitingApproval.state).toBe("VERIFIED");
      expect(j.awaitingApproval.items.map((i: {title: string}) => i.title).sort()).toEqual(["m2", "m3"]);
      expect(j.awaitingApproval.items[0]).toEqual(expect.objectContaining({missionId: expect.stringMatching(/^msn_/), projectId: p1.projectId, riskLevel: "R2"}));
      // B3a: the mission runner exists now; with a Work OS journal and no runs the real count is 0 (state VERIFIED).
      expect(j.workforce).toEqual(expect.objectContaining({state: "VERIFIED", registeredRoles: 3, targetRoles: 5, activeWorkerRuns: 0}));
      // legacy routes keep their payload shape
      expect((await app.inject({method: "GET", url: "/v1/projects", headers: hdr})).json().projects.length).toBe(2);
      await app.close();
    });

    it("maps a tampered Work OS journal to ERROR with null counts", async () => {
      noEnvDataDir();
      const {app, repo} = mkApp();
      await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: project});
      const f = path.join(repo, ".ai", "runtime", "workos", "journal.jsonl");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("API project", "EVIL"));
      const j = (await get(app)).json();
      expect(j.projects).toEqual({state: "ERROR", count: null});
      expect(j.missions).toEqual({state: "ERROR", total: null, byStatus: {}});
      expect(j.awaitingApproval).toEqual({state: "ERROR", items: []});
      await app.close();
    });

    it("orchestrator: present valid state -> VERIFIED, absent -> UNAVAILABLE, corrupt/invalid -> ERROR, expired lease -> STALE; never writes", async () => {
      const {app, repo} = mkApp();
      seedPolicy(repo);
      expect((await get(app)).json().orchestrator.state).toBe("UNAVAILABLE");
      const now = new Date().toISOString();
      seedState(repo, {updatedAt: now, control: control()});
      const before = sha256(fs.readFileSync(stateFile(repo), "utf8"));
      const dirBefore = fs.readdirSync(path.dirname(stateFile(repo))).sort();
      let o = (await get(app)).json().orchestrator;
      expect(o).toEqual({state: "VERIFIED", asOf: now, packages: {total: 3, byStatus: {QUEUED: 2, MERGED: 1}}, source: "ORCHESTRATOR_STATE"});
      expect(sha256(fs.readFileSync(stateFile(repo), "utf8"))).toBe(before);
      expect(fs.readdirSync(path.dirname(stateFile(repo))).sort()).toEqual(dirBefore);
      seedState(repo, "{not json");
      o = (await get(app)).json().orchestrator;
      expect(o.state).toBe("ERROR"); expect(o.packages.total).toBeNull(); expect(o.asOf).toBeNull();
      const badControl = control(); (badControl.packages as any).A.status = "NOT_A_STATUS";
      seedState(repo, {updatedAt: now, control: badControl});
      expect((await get(app)).json().orchestrator.state).toBe("ERROR");
      seedState(repo, {updatedAt: now, control: control({lease: {workerId: "w", expiresAt: new Date(Date.now() - 60_000).toISOString()}})});
      o = (await get(app)).json().orchestrator;
      expect(o.state).toBe("STALE"); expect(o.packages.total).toBe(3);
      seedState(repo, {updatedAt: now});
      expect((await get(app)).json().orchestrator.state).toBe("UNAVAILABLE");
      // a transition log that does not verify against the state is ERROR
      seedState(repo, {updatedAt: now, control: control({lastTransition: {seq: 1, hash: "a".repeat(64), at: now}})});
      expect((await get(app)).json().orchestrator.state).toBe("ERROR");
      await app.close();
    });

    it("reflects GLOBAL_STOP and treats an unreadable stop file as active", async () => {
      const {app, runtime} = mkApp();
      fs.writeFileSync(path.join(runtime, "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "founder stop", actor: "TEST"}));
      expect((await get(app)).json().globalStop).toEqual({active: true, reason: "founder stop"});
      fs.writeFileSync(path.join(runtime, "GLOBAL_STOP.json"), "{broken");
      const g = (await get(app)).json().globalStop;
      expect(g.active).toBe(true);
      expect(typeof g.reason).toBe("string");
      await app.close();
    });

    it("workforce: malformed registry -> ERROR with null counts", async () => {
      const {app, repo} = mkApp();
      fs.mkdirSync(path.join(repo, "registries"), {recursive: true});
      fs.writeFileSync(path.join(repo, "registries", "agents.json"), "{bad");
      const w = (await get(app)).json().workforce;
      expect(w).toEqual(expect.objectContaining({state: "ERROR", registeredRoles: null, targetRoles: null, activeWorkerRuns: null}));
      await app.close();
    });
  });
});

describe("F-B2-001 trust-root seal matches LF bytes", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "config/trust-root-manifest.json"), "utf8")) as {files: {path: string; sha256: string}[]};
  const sealed = ["apps/control-api/src/server.ts", "config/validation.json"];
  const touched = ["apps/control-api/src/server.ts", "core/workos/store.ts", "core/workos/types.ts", "core/workos/schemas.ts", "core/workos/README.md", "tests/v7-b2-workos-hardening.test.ts"];
  it("sealed B2 files have no CR bytes and manifest sha256 equals the file bytes", () => {
    for (const rel of sealed) {
      const buf = fs.readFileSync(path.join(REPO, rel));
      const entry = manifest.files.find((f) => f.path === rel);
      expect(entry, rel).toBeDefined();
      expect(crypto.createHash("sha256").update(buf).digest("hex"), rel).toBe(entry!.sha256);
    }
  });
  it("B2 touched text files are stored with LF only", () => {
    for (const rel of touched) expect(fs.readFileSync(path.join(REPO, rel)).includes(13), rel).toBe(false);
  });
  it("the committed git blob of server.ts equals the sealed digest", () => {
    let blob: Buffer;
    try { blob = cp.execFileSync("git", ["cat-file", "blob", "HEAD:apps/control-api/src/server.ts"], {cwd: REPO}); } catch { return; }
    const entry = manifest.files.find((f) => f.path === "apps/control-api/src/server.ts");
    if (fs.readFileSync(path.join(REPO, "apps/control-api/src/server.ts")).equals(blob)) expect(crypto.createHash("sha256").update(blob).digest("hex")).toBe(entry!.sha256);
  });
});
