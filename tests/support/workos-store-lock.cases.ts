// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) V3-T1001 Work OS store kilidini doğrular: sıfır baytlık/ölü/yetim kilit güvenli geri alınır (LOCK_TIMEOUT yok), Windows geçici EBUSY/EPERM/EACCES hataları iki yazar üretmez ve kilidi yetim bırakmaz.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {threadId} from "node:worker_threads";
import {createHash} from "node:crypto";
import {WorkOsStore, acquireStoreLock, defaultStoreLockIo, storeLockHostTag, STORE_LOCK_ORPHAN_GRACE_MS, STORE_LOCK_RELEASE_RETRY_MS, type StoreLockIo} from "../../core/workos/store.js";

type Hook = (p: string) => void;
/** Bellek içi dosya sistemi; `hooks` bir işlemden hemen önce hata fırlatabilir ya da başka bir sürecin adımını araya sokabilir. */
function memIo(hooks: Partial<Record<"beforeLink" | "beforeUnlink" | "beforeRead" | "beforeWrite", Hook>> = {}) {
  const files = new Map<string, {data: string; mtime: number}>();
  let ops = 0;
  const tick = () => { if (++ops > 20_000) throw new Error("OP_BUDGET_EXCEEDED (unbounded lock loop)"); };
  const io: StoreLockIo = {
    writeFile(p, data) { tick(); hooks.beforeWrite?.(p); if (files.has(p)) throw err("EEXIST"); files.set(p, {data, mtime: clock.t}); },
    link(a, b) { tick(); hooks.beforeLink?.(b); const f = files.get(a); if (!f) throw err("ENOENT"); if (files.has(b)) throw err("EEXIST"); files.set(b, {...f}); },
    read(p) { tick(); hooks.beforeRead?.(p); const f = files.get(p); if (!f) throw err("ENOENT"); return f.data; },
    unlink(p) { tick(); hooks.beforeUnlink?.(p); if (!files.delete(p)) throw err("ENOENT"); },
    list(d) { tick(); return [...files.keys()].filter(k => k.startsWith(d + "/")).map(k => k.slice(d.length + 1)); },
    mtimeMs(p) { tick(); const f = files.get(p); if (!f) throw err("ENOENT"); return f.mtime; },
  };
  return {io, files};
}
const err = (code: string) => Object.assign(new Error(code), {code});
const clock = {t: 1_000_000};
const now = () => clock.t;
const L = "/w/journal.lock";
const H = storeLockHostTag();   // bu host
const OTHER = storeLockHostTag(`${os.hostname()}-peer`);   // ortak dataDir'i paylaşan başka host
const LIVE = new Set([111, 222, 333]);
const alive = (pid: number) => LIVE.has(pid);
const noSleep = () => { clock.t += 10; };
const base = {alive, now, sleep: noSleep};
const sleepSyncMs = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const lockFiles = (files: Map<string, unknown>) => [...files.keys()].filter(k => k.startsWith(L)).sort();

export function registerWorkosStoreLockCases(): void {
  describe("V3-T1001 Work OS store lock: zero-byte / orphan recovery and Windows contention", () => {
    beforeEach(() => { clock.t = 1_000_000; });

    it("TD-V2-06: an old zero-byte lock is recovered (no LOCK_TIMEOUT) and replaced by full content", () => {
      const {io, files} = memIo();
      files.set(L, {data: "", mtime: clock.t - STORE_LOCK_ORPHAN_GRACE_MS - 1});
      const l = acquireStoreLock(L, {...base, io, pid: 111});
      expect(files.get(L)!.data).toBe(l.id);
      expect(l.id).toMatch(new RegExp(`^111\\.${threadId}\\.${H}:[0-9a-f]{32}$`));
      l.release();
      expect(lockFiles(files)).toEqual([]);
    });

    it("a fresh zero-byte / unparsable lock (a writer mid-create) is never taken over", () => {
      for (const data of ["", "{", "garbage"]) {
        const {io, files} = memIo();
        files.set(L, {data, mtime: clock.t - STORE_LOCK_ORPHAN_GRACE_MS + 50});
        expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(/STORE_LOCKED/);
        expect(files.get(L)!.data).toBe(data);
        expect(lockFiles(files)).toEqual([L]);
      }
    });

    it("this lock never writes a zero-byte or partial lock: the lock path only ever appears with full content", () => {
      const seen: string[] = [];
      const {io, files} = memIo({beforeLink: p => { if (p === L) seen.push(files.has(L) ? files.get(L)!.data : "<absent>"); }});
      const l = acquireStoreLock(L, {...base, io, pid: 111});
      expect(seen).toEqual(["<absent>"]);
      expect(files.get(L)!.data).toBe(l.id);
      expect([...files.keys()].filter(k => k.includes(".tmp-"))).toEqual([]);
      l.release();
    });

    it("a lock of a dead (killed) writer is recovered, in both the new and the legacy process-lock format", () => {
      for (const data of [`999.0.${H}:${"d".repeat(32)}`, JSON.stringify({pid: 999, hostname: os.hostname(), runId: "r", lockId: "x"})]) {
        const {io, files} = memIo();
        files.set(L, {data, mtime: clock.t});
        const l = acquireStoreLock(L, {...base, io, pid: 111});
        expect(files.get(L)!.data).toBe(l.id);
        l.release();
        expect(lockFiles(files)).toEqual([]);
      }
    });

    it("a lock held by another live process, or by another host, is never removed", () => {
      for (const [data, code] of [[`222.0.${H}:${"a".repeat(32)}`, /STORE_LOCKED/], [JSON.stringify({pid: 999, hostname: `${os.hostname()}-other`}), /STORE_LOCK_OTHER_HOST/]] as const) {
        const {io, files} = memIo();
        files.set(L, {data, mtime: 0});
        expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(code);
        expect(files.get(L)!.data).toBe(data);
      }
    });

    it("NB-1: a lock of another host is never taken over or deleted, even if its PID looks dead here (STORE_LOCK_OTHER_HOST)", () => {
      for (const data of [`999.0.${OTHER}:${"e".repeat(32)}`, `111.${threadId}.${OTHER}:${"e".repeat(32)}`, JSON.stringify({pid: 999, hostname: `${os.hostname()}-peer`})]) {
        const {io, files} = memIo();
        files.set(L, {data, mtime: 0});
        clock.t += 10 * STORE_LOCK_ORPHAN_GRACE_MS;
        expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(/STORE_LOCK_OTHER_HOST/);
        expect(files.get(L)!.data).toBe(data);
        expect(lockFiles(files)).toEqual([L]);   // no takeover token left behind either
      }
    });

    it("NB-1: a takeover token held by another host blocks the takeover fail-closed", () => {
      const {io, files} = memIo();
      files.set(L, {data: "", mtime: 0});
      const token = `${L}.takeover.${createHash("sha256").update("").digest("hex").slice(0, 24)}.1`;
      files.set(token, {data: `999.0.${OTHER}:${"f".repeat(32)}`, mtime: 0});
      expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(/STORE_LOCK_OTHER_HOST/);
      expect(files.get(L)!.data).toBe("");
      expect(files.get(token)!.data).toBe(`999.0.${OTHER}:${"f".repeat(32)}`);
    });

    it("NB-1: same host, dead PID is still recovered", () => {
      const {io, files} = memIo();
      files.set(L, {data: `999.7.${H}:${"9".repeat(32)}`, mtime: clock.t});
      const l = acquireStoreLock(L, {...base, io, pid: 111});
      expect(files.get(L)!.data).toBe(l.id);
      l.release();
      expect(lockFiles(files)).toEqual([]);
    });

    it("L-1: the winner sweeps a crashed writer's old temp file but never a fresh one", () => {
      const {io, files} = memIo();
      files.set(`${L}.tmp-0000000000000001`, {data: "x", mtime: clock.t - STORE_LOCK_ORPHAN_GRACE_MS - 1});
      files.set(`${L}.tmp-0000000000000002`, {data: "y", mtime: clock.t});
      const l = acquireStoreLock(L, {...base, io, pid: 111});
      expect(lockFiles(files)).toEqual([L, `${L}.tmp-0000000000000002`]);
      l.release();
    });

    it("two contenders on the same stale zero-byte lock: exactly one wins, the other never becomes a second writer", () => {
      let inner: Error | null = null, fired = false;
      const {io, files} = memIo({beforeUnlink: p => {
        if (p !== L || fired) return; fired = true;   // A holds the takeover token and is about to remove the stale lock: B runs now
        try { acquireStoreLock(L, {...base, io, pid: 222}); } catch (e) { inner = e as Error; }
      }});
      files.set(L, {data: "", mtime: 0});
      const a = acquireStoreLock(L, {...base, io, pid: 111});
      expect(String(inner)).toMatch(/STORE_LOCKED/);
      expect(files.get(L)!.data).toBe(a.id);
      a.release();
      expect(lockFiles(files)).toEqual([]);
    });

    it("Windows: transient EBUSY/EPERM on release read and unlink is retried; the lock is not left behind", () => {
      for (const code of ["EBUSY", "EPERM", "EACCES"]) {
        let reads = 0, unlinks = 0;
        const {io, files} = memIo({
          beforeRead: p => { if (p === L && ++reads <= 3) throw err(code); },
          beforeUnlink: p => { if (p === L && ++unlinks <= 3) throw err(code); },
        });
        const l = acquireStoreLock(L, {...base, io, pid: 111});
        l.release();
        expect(lockFiles(files)).toEqual([]);
      }
    });

    it("Windows: an unlink that keeps failing leaves an orphan the owner thread adopts without any fs mutation, while other live processes still see it as held", () => {
      let block = true, mutations = 0;
      const {io, files} = memIo({
        beforeUnlink: p => { if (block && p === L) throw err("EPERM"); },
        beforeLink: () => { mutations++; }, beforeWrite: () => { mutations++; },
      });
      const a = acquireStoreLock(L, {...base, io, pid: 111});
      a.release();   // bounded retries exhausted: lock stays on disk
      expect(files.get(L)!.data).toBe(a.id);
      expect(() => acquireStoreLock(L, {...base, io, pid: 222})).toThrow(/STORE_LOCKED/);   // never two writers
      mutations = 0;
      const b = acquireStoreLock(L, {...base, io, pid: 111});   // same process+thread, unlink STILL failing: adopted as-is, no LOCK_TIMEOUT
      expect(b.id).toBe(a.id);
      expect(files.get(L)!.data).toBe(a.id);
      expect(mutations).toBe(2);   // only the first attempt (temp write + link -> EEXIST); the lock is never deleted or re-linked
      expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(/STORE_LOCKED/);   // a lock this thread actually holds is live
      block = false;
      b.release();
      expect(lockFiles(files)).toEqual([]);
    });

    it("PAR-03 regression (run 41705299747): a release that keeps failing blocks the thread for at most STORE_LOCK_RELEASE_RETRY_MS, far below a heartbeat period", () => {
      expect(STORE_LOCK_RELEASE_RETRY_MS).toBeLessThanOrEqual(1500 / 3 / 2);   // engine tests: TTL 1500 ms, heartbeat TTL/3
      for (const code of ["EPERM", "EBUSY", "EACCES"]) {
        let slept = 0;
        const {io} = memIo({beforeUnlink: p => { if (p === L) throw err(code); }});
        const l = acquireStoreLock(L, {...base, io, pid: 111, sleep: ms => { slept += ms; clock.t += ms; }});
        l.release();
        expect(slept).toBeLessThanOrEqual(STORE_LOCK_RELEASE_RETRY_MS + 10);
        expect(slept).toBeGreaterThan(0);   // it did retry
      }
    });

    it("Windows: link onto a delete-pending lock (EPERM/EACCES) is a retryable busy, creates no lock and leaves no temp file", () => {
      for (const code of ["EPERM", "EACCES", "EBUSY"]) {
        const {io, files} = memIo({beforeLink: p => { if (p === L) throw err(code); }});
        expect(() => acquireStoreLock(L, {...base, io, pid: 111})).toThrow(/STORE_LOCK_BUSY/);
        expect([...files.keys()]).toEqual([]);
      }
    });

    it("release never removes a lock that is no longer ours", () => {
      const {io, files} = memIo();
      const a = acquireStoreLock(L, {...base, io, pid: 111});
      files.set(L, {data: `222.0.${H}:${"b".repeat(32)}`, mtime: clock.t});
      a.release();
      expect(files.get(L)!.data).toBe(`222.0.${H}:${"b".repeat(32)}`);
    });

    describe("real filesystem (runs on the Windows shard too)", () => {
      let tmp = "";
      beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t1001-")); });
      afterEach(() => { fs.rmSync(tmp, {recursive: true, force: true}); });
      const proj = {tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: "T"};

      it("TD-V2-06: a store with a leftover zero-byte journal.lock writes without LOCK_TIMEOUT", () => {
        const dir = path.join(tmp, "d"); fs.mkdirSync(dir, {recursive: true});
        const lock = path.join(dir, "journal.lock");
        fs.writeFileSync(lock, "");
        const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old);
        const t0 = Date.now();
        const s = new WorkOsStore(dir);
        expect(s.isUnavailable).toBe(false);
        const p = s.createProject(proj);
        expect(Date.now() - t0).toBeLessThan(5_000);
        expect(new WorkOsStore(dir).getProject({tenantId: "tA"}, p.projectId)).toEqual(p);
        expect(fs.readdirSync(dir).filter(f => f.startsWith("journal.lock"))).toEqual([]);
      });

      it("PAR-03 regression: with journal.lock undeletable (Windows EPERM) every write still succeeds and no write blocks for long", () => {
        const dir = path.join(tmp, "d");
        let slept = 0;
        const io: StoreLockIo = {...defaultStoreLockIo, unlink: p => { if (path.basename(p) === "journal.lock") throw err("EPERM"); defaultStoreLockIo.unlink(p); }};
        const s = new WorkOsStore(dir, {lock: {io, sleep: ms => { slept += ms; sleepSyncMs(ms); }}});
        const ids: string[] = [];
        for (let i = 0; i < 6; i++) { const t0 = Date.now(); ids.push(s.createProject(proj).projectId); expect(Date.now() - t0).toBeLessThan(1_000); }
        expect(new WorkOsStore(dir, {lock: {io}}).listProjects({tenantId: "tA"}).map(p => p.projectId).sort()).toEqual([...ids].sort());
        expect(slept).toBeLessThanOrEqual(12 * (STORE_LOCK_RELEASE_RETRY_MS + 10));   // bounded per release, never the old 2 s
      });

      it("a killed writer's lock (real dead PID) is recovered without LOCK_TIMEOUT", async () => {
        const dir = path.join(tmp, "d"); fs.mkdirSync(dir, {recursive: true});
        const kid = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"});
        const pid = kid.pid!;
        fs.writeFileSync(path.join(dir, "journal.lock"), `${pid}.0.${storeLockHostTag()}:${"c".repeat(32)}`);
        const s = new WorkOsStore(dir);
        await new Promise<void>(resolve => { kid.on("exit", () => resolve()); kid.kill("SIGKILL"); });
        const t0 = Date.now();
        const p = s.createProject(proj);
        expect(Date.now() - t0).toBeLessThan(5_000);
        expect(new WorkOsStore(dir).listProjects({tenantId: "tA"}).map(x => x.projectId)).toEqual([p.projectId]);
        expect(fs.existsSync(path.join(dir, "journal.lock"))).toBe(false);
      }, 20_000);
    });
  });
}
