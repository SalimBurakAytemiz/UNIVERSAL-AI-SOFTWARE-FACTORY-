// //TR: Bu test REL-FX-4 kesinti kurtarma minimumunu doğrular: gerçek bir yarım (sonlandırılmamış) son satır geçerli zincir üzerinde TORN_TAIL olur (salt-okunur açılış, karantina kopyası, durum route'u, yalnız token + tam kuyruk hash onayıyla kesme), zincir ortası bozulma ve uyuşmayan kuyruk tamper kalır; ENOSPC append'i DISK_FULL ile reddeder ve yarım satır bırakmaz, asla PASS üretmez; sağlayıcı QUOTA_EXHAUSTED/RATE_LIMIT retry bütçesini tüketmeden run'ı BLOCKED(PROVIDER_QUOTA) yapar.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import type {WorkOsStoreOptions} from "../core/workos/store.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {HDR, T, api, drive, journalFile, missionOf, okScript, rmTmp, runOf, runner, setup, startRun, tmpRoot} from "./support/relfx.js";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfx4-"); });
afterEach(() => rmTmp(tmp));
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const proj = {tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"};
const msn = (projectId: string) => ({tenantId: "tA", projectId, title: "M", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1" as const, createdBy: "FOUNDER_LOCAL"});

// Gerçek bir yırtık append: üçüncü girdi gerçekten yazılır, sonra dosya ilk iki satır + üçüncü satırın ilk `cut` baytına indirilir ve
// snapshot iki girdilik hâline geri konur (çökmede snapshot append'den sonra yazılamamış olur).
function tornJournal(dir: string, cut = 57): {prefix: Buffer; tail: Buffer; full: Buffer; projectId: string} {
  const s = new WorkOsStore(dir);
  const p = s.createProject(proj);
  s.createMission(msn(p.projectId));
  const snap2 = fs.readFileSync(path.join(dir, "snapshot.json"));
  s.createTask({tenantId: "tA", missionId: s.listMissions({tenantId: "tA"})[0].missionId, title: "t", actor: "FOUNDER_LOCAL"});
  const lines = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean);
  const prefix = Buffer.from(lines.slice(0, 2).join("\n") + "\n", "utf8"), tail = Buffer.from(lines[2].slice(0, cut), "utf8");
  const full = Buffer.concat([prefix, tail]);
  fs.writeFileSync(path.join(dir, "journal.jsonl"), full);
  fs.writeFileSync(path.join(dir, "snapshot.json"), snap2);
  return {prefix, tail, full, projectId: p.projectId};
}

describe("REL-FX-4 torn journal tail", () => {
  it("a real unterminated last line over a valid chain opens read-only (TORN_TAIL) with a quarantine copy; reads work, writes are refused", () => {
    const dir = path.join(tmp, "data");
    const {tail, full, projectId} = tornJournal(dir);
    const s = new WorkOsStore(dir);
    expect(s.isTampered).toBe(false);
    expect(s.isReadOnly).toBe(true);
    expect(s.listProjects({tenantId: "tA"}).map(p => p.projectId)).toEqual([projectId]);
    expect(s.listMissions({tenantId: "tA"})).toHaveLength(1);
    expect(() => s.createMission(msn(projectId))).toThrow(/WORKOS_READ_ONLY: JOURNAL_TORN_TAIL/);
    const h = s.journalHealth();
    expect(h.state).toBe("TORN_TAIL");
    expect(h.tornTail).toEqual(expect.objectContaining({bytes: tail.length, sha256: sha(tail), expectedSeq: 3, lastSeq: 2}));
    const q = path.join(dir, h.tornTail!.quarantineFile);
    expect(fs.readFileSync(q).equals(full)).toBe(true);
    // the journal itself is not modified by opening it
    expect(fs.readFileSync(path.join(dir, "journal.jsonl")).equals(full)).toBe(true);
  });

  it("distinguishes a torn tail from mid-file corruption, a foreign tail and a snapshot ahead of the journal (all stay tamper/fail-closed)", () => {
    const d1 = path.join(tmp, "mid");
    const t1 = tornJournal(d1);
    const lines = t1.prefix.toString("utf8").split("\n");
    lines[0] = lines[0].replace('"name":"P"', '"name":"X"');
    fs.writeFileSync(path.join(d1, "journal.jsonl"), Buffer.concat([Buffer.from(lines.join("\n"), "utf8"), t1.tail]));
    const s1 = new WorkOsStore(d1);
    expect(s1.isTampered).toBe(true);
    expect(s1.journalHealth().state).toBe("TAMPERED");
    expect(() => s1.listProjects({tenantId: "tA"})).toThrow(/HASH_MISMATCH/);

    const d2 = path.join(tmp, "foreign");
    const t2 = tornJournal(d2);
    fs.writeFileSync(path.join(d2, "journal.jsonl"), Buffer.concat([t2.prefix, Buffer.from('{"seq":9,"prevHash":"', "utf8")]));
    expect(new WorkOsStore(d2).isTampered).toBe(true);
    fs.writeFileSync(path.join(d2, "journal.jsonl"), Buffer.concat([t2.prefix, Buffer.from("garbage", "utf8")]));
    const s2 = new WorkOsStore(d2);
    expect(s2.isTampered).toBe(true);
    expect(() => s2.listProjects({tenantId: "tA"})).toThrow(/JOURNAL_TRUNCATED_LINE/);

    const d3 = path.join(tmp, "ahead");
    tornJournal(d3);
    const snap = JSON.parse(fs.readFileSync(path.join(d3, "snapshot.json"), "utf8"));
    fs.writeFileSync(path.join(d3, "snapshot.json"), JSON.stringify({...snap, lastSeq: 3, lastHash: "f".repeat(64)}));
    expect(new WorkOsStore(d3).isTampered).toBe(true);
  });

  it("control API: status shows TORN_TAIL, writes 503, repair needs the per-launch token and the exact tail hash, then the store is writable again", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const {tail, prefix} = (() => {
      // tear the next append of this data dir
      const before = fs.readFileSync(journalFile(c)), snap = fs.readFileSync(path.join(c.dataDir, "snapshot.json"));
      c.store.createTask({tenantId: "tA", missionId: c.missionId, title: "t", actor: "FOUNDER_LOCAL"});
      const after = fs.readFileSync(journalFile(c));
      const torn = after.subarray(before.length, before.length + 31);
      fs.writeFileSync(journalFile(c), Buffer.concat([before, torn]));
      fs.writeFileSync(path.join(c.dataDir, "snapshot.json"), snap);
      return {tail: torn, prefix: before};
    })();
    const app = api(c);
    const st = (await app.inject({method: "GET", url: "/v1/control/status", headers: HDR})).json();
    expect(st.workos).toEqual(expect.objectContaining({state: "TORN_TAIL", tornTail: expect.objectContaining({sha256: sha(tail), bytes: tail.length})}));
    const w = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: c.projectId, title: "x", objective: "y", acceptanceCriteria: ["z"], riskLevel: "R1"}});
    expect(w.statusCode).toBe(503);
    expect(w.json()).toEqual({error: "WORKOS_READ_ONLY", reason: "JOURNAL_TORN_TAIL"});
    expect((await app.inject({method: "GET", url: "/v1/missions", headers: HDR})).statusCode).toBe(200);
    const url = "/v1/system/workos/journal/repair-torn-tail";
    expect((await app.inject({method: "POST", url, headers: {host: HDR.host}, payload: {confirmTailSha256: sha(tail)}})).statusCode).toBe(403);
    expect((await app.inject({method: "POST", url, headers: {...HDR, "x-uasco-control-token": "0".repeat(48)}, payload: {confirmTailSha256: sha(tail)}})).statusCode).toBe(403);
    expect((await app.inject({method: "POST", url, headers: HDR, payload: {}})).statusCode).toBe(400);
    const wrong = await app.inject({method: "POST", url, headers: HDR, payload: {confirmTailSha256: "e".repeat(64)}});
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toEqual({error: "WORKOS_CONFLICT", reason: "TORN_TAIL_CONFIRMATION_MISMATCH"});
    expect(fs.readFileSync(journalFile(c)).equals(Buffer.concat([prefix, tail]))).toBe(true);
    const ok = await app.inject({method: "POST", url, headers: HDR, payload: {confirmTailSha256: sha(tail)}});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().repair).toEqual(expect.objectContaining({truncatedBytes: tail.length, tailSha256: sha(tail), lastSeq: 4}));
    expect(fs.readFileSync(journalFile(c)).equals(prefix)).toBe(true);
    // the quarantine copy keeps the torn bytes
    const q = path.join(c.dataDir, ok.json().repair.quarantineFile);
    expect(fs.readFileSync(q).subarray(prefix.length).equals(tail)).toBe(true);
    expect((await app.inject({method: "GET", url: "/v1/control/status", headers: HDR})).json().workos.state).toBe("OK");
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: c.projectId, title: "x", objective: "y", acceptanceCriteria: ["z"], riskLevel: "R1"}})).statusCode).toBe(201);
    const again = await app.inject({method: "POST", url, headers: HDR, payload: {confirmTailSha256: sha(tail)}});
    expect(again.statusCode).toBe(409);
    expect(again.json().reason).toBe("JOURNAL_NOT_TORN");
    await app.close();
  });

  it("the repair action refuses a tampered journal (no truncation of a corrupted chain)", () => {
    const dir = path.join(tmp, "data");
    const t = tornJournal(dir);
    const corrupted = Buffer.from(t.full.toString("utf8").replace('"name":"P"', '"name":"Y"'), "utf8");
    fs.writeFileSync(path.join(dir, "journal.jsonl"), corrupted);
    const s = new WorkOsStore(dir);
    expect(() => s.repairTornTail(sha(t.tail), "FOUNDER_LOCAL")).toThrow(/WORKOS_JOURNAL_TAMPERED/);
    expect(fs.readFileSync(path.join(dir, "journal.jsonl")).equals(corrupted)).toBe(true);
  });
});

describe("REL-FX-4 disk full on append", () => {
  const enospc = () => Object.assign(new Error("ENOSPC: no space left on device, write"), {code: "ENOSPC"});
  it("ENOSPC (injected through the fs seam) refuses the write with DISK_FULL and leaves no partial line, including a short write", () => {
    const dir = path.join(tmp, "data");
    let mode: "ok" | "full" | "short" = "ok";
    const io: WorkOsStoreOptions["io"] = {writeSync: (fd, data) => {
      if (mode === "full") throw enospc();
      if (mode === "short") { fs.writeSync(fd, data.subarray(0, Math.floor(data.length / 2))); throw enospc(); }
      return fs.writeSync(fd, data);
    }};
    const s = new WorkOsStore(dir, {io});
    const p = s.createProject(proj);
    const before = fs.readFileSync(path.join(dir, "journal.jsonl"));
    for (const m of ["full", "short"] as const) {
      mode = m;
      expect(() => s.createMission(msn(p.projectId))).toThrow(/WORKOS_DISK_FULL/);
      expect(fs.readFileSync(path.join(dir, "journal.jsonl")).equals(before)).toBe(true);
      expect(s.listMissions({tenantId: "tA"})).toEqual([]);
    }
    mode = "ok";
    const fresh = new WorkOsStore(dir);
    expect(fresh.isTampered).toBe(false);
    expect(fresh.isReadOnly).toBe(false);
    expect(s.createMission(msn(p.projectId)).status).toBe("DRAFT");
    expect(new WorkOsStore(dir).listMissions({tenantId: "tA"})).toHaveLength(1);
  });

  it("control API maps DISK_FULL to 507 and the journal is unchanged", { timeout: T }, async () => {
    let full = false;
    const c = setup(tmp, "tA");
    const app = api(c, {workosStoreOptions: {io: {writeSync: (fd: number, data: Buffer) => { if (full) throw enospc(); return fs.writeSync(fd, data); }}}});
    const before = fs.readFileSync(journalFile(c));
    full = true;
    const r = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: c.projectId, title: "x", objective: "y", acceptanceCriteria: ["z"], riskLevel: "R1"}});
    expect(r.statusCode).toBe(507);
    expect(r.json()).toEqual({error: "WORKOS_DISK_FULL"});
    expect(fs.readFileSync(journalFile(c)).equals(before)).toBe(true);
    await app.close();
  });

  it("REL-AT-011: disk full during a run is never a PASS (no AWAITING_APPROVAL, no REPORTING, COMPLETE refused, no partial line)", { timeout: T }, async () => {
    let full = false;
    const c = setup(tmp, "tA", {storeOptions: {io: {writeSync: (fd, data) => { if (full) throw enospc(); return fs.writeSync(fd, data); }}}});
    const fake = new FakeExecutors(okScript({review: () => { full = true; return {verdict: "CLEAN"}; }}));
    const created = startRun(c, fake);
    const eng = runner(c, fake);
    await eng.tick();
    full = false;
    const run = runOf(c, created.runId);
    expect(["AWAITING_APPROVAL", "SUCCEEDED"]).not.toContain(run.status);
    expect(run.evidence.some(e => e.kind === "REVIEW" || e.kind === "REPORT")).toBe(false);
    expect(missionOf(c).status).not.toBe("REPORTING");
    expect(fs.readFileSync(journalFile(c), "utf8").endsWith("\n")).toBe(true);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
    expect(() => c.store.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow();
  });
});

describe("REL-FX-4 provider quota / rate limit", () => {
  it("implementer QUOTA_EXHAUSTED -> run BLOCKED(PROVIDER_QUOTA) without consuming the retry budget", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({implement: () => ({exitCode: 75, stderr: "Claude AI usage limit reached|1760540400"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("PROVIDER_QUOTA");
    expect(run.retryCount).toBe(0);
    expect(fake.calls.implement).toBe(1);
    expect(missionOf(c).status).toBe("BLOCKED");
    expect(run.evidence.find(e => e.kind === "IMPLEMENT")?.note).toMatch(/PROVIDER_LIMIT: QUOTA_EXHAUSTED/);
  });

  it("reviewer RATE_LIMIT -> run BLOCKED(PROVIDER_QUOTA); a plain transient failure still uses the bounded retry path", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({review: () => ({exitCode: 1, raw: "API Error: 429 Too Many Requests (rate limit)"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("PROVIDER_QUOTA");
    expect(run.retryCount).toBe(0);
    expect(fake.calls.review).toBe(1);
    expect(run.evidence.find(e => e.kind === "REVIEW")?.note).toMatch(/PROVIDER_LIMIT: RATE_LIMIT/);

    const c2 = setup(tmp, "tA");
    let n = 0;
    const plain = new FakeExecutors(okScript({implement: () => (++n === 1 ? {exitCode: 75} : {files: {"feature.txt": "ok\n"}})}));
    const r2 = startRun(c2, plain);
    await runner(c2, plain, {maxRetries: 2, retryBackoffMs: [600_000]}).tick();
    expect(runOf(c2, r2.runId)).toEqual(expect.objectContaining({status: "RETRY_SCHEDULED", retryCount: 1, reason: "IMPLEMENT_TRANSIENT_FAILURE"}));
    expect(plain.calls.implement).toBe(1);
  });
});
