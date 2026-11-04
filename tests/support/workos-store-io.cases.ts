// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) UASCO-T0042 PAR-03 regresyonunu doğrular: store okuma/yazma başına senkron dayanıklı G/Ç (fsync) sınırlıdır; değişmemiş snapshot yeniden yazılmaz, ama yanlış/eski snapshot her zaman düzeltilir (otorite journal'dır).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore, acquireStoreLock, defaultStoreLockIo, storeLockHostTag, type StoreLockIo} from "../../core/workos/store.js";

export function registerWorkosStoreIoCases(): void {
  describe("UASCO-T0042 PAR-03: Work OS store durable I/O per operation (Windows heartbeat starvation)", () => {
    let tmp = "";
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t0042-")); });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmp, {recursive: true, force: true}); });
    const proj = {tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: "T"};
    const countFsync = () => { const spy = vi.spyOn(fs, "fsyncSync"); return {n: () => spy.mock.calls.length, reset: () => spy.mockClear()}; };
    const snap = (dir: string) => fs.readFileSync(path.join(dir, "snapshot.json"), "utf8");

    it("a read that re-validates the journal (another writer appended) does not rewrite an up-to-date snapshot", () => {
      const dir = path.join(tmp, "d");
      const reader = new WorkOsStore(dir), writer = new WorkOsStore(dir);
      writer.createProject(proj); writer.createProject(proj);   // two writes: snapshot.json.prev exists
      const before = snap(dir), prevBefore = fs.readFileSync(path.join(dir, "snapshot.json.prev"), "utf8");
      const f = countFsync();
      expect(reader.listProjects({tenantId: "tA"}).length).toBe(2);   // signature changed -> locked load()
      expect(f.n()).toBe(0);                                            // neither the lock nor an unchanged snapshot is fsynced (was 4+)
      expect(snap(dir)).toBe(before);
      expect(fs.readFileSync(path.join(dir, "snapshot.json.prev"), "utf8")).toBe(prevBefore);
    });

    it("a write performs one snapshot rewrite (after the append), not two", () => {
      const dir = path.join(tmp, "d");
      const s = new WorkOsStore(dir);
      s.createProject(proj);
      const f = countFsync();
      for (let i = 0; i < 5; i++) s.createProject(proj);
      // per write: journal append (1) + one writeJsonAtomic (tmp + .prev [+ dir on POSIX] = <=3); the lock is not fsynced
      expect(f.n() / 5).toBeLessThanOrEqual(4);
      const fresh = new WorkOsStore(dir);
      expect(JSON.parse(snap(dir)).lastSeq).toBe(6);
      expect(fresh.listProjects({tenantId: "tA"}).length).toBe(6);
    });

    it("a stale or hand-edited snapshot (same lastSeq/lastHash, different body) is still rewritten from the journal", () => {
      const dir = path.join(tmp, "d");
      new WorkOsStore(dir).createProject(proj);
      const good = snap(dir), file = path.join(dir, "snapshot.json");
      const edited = JSON.parse(good); edited.injected = "x"; fs.writeFileSync(file, JSON.stringify(edited, null, 2) + "\n");
      expect(new WorkOsStore(dir).isTampered).toBe(false);   // load() runs, sees different bytes, rewrites
      expect(snap(dir)).toBe(good);
      fs.writeFileSync(file, "{not json");
      expect(new WorkOsStore(dir).isUnavailable).toBe(false);
      expect(snap(dir)).toBe(good);
      fs.rmSync(file);
      expect(new WorkOsStore(dir).listProjects({tenantId: "tA"}).length).toBe(1);
      expect(snap(dir)).toBe(good);
    });

    it("a snapshot that contradicts the journal is still TAMPERED (fail-closed unchanged)", () => {
      const dir = path.join(tmp, "d");
      new WorkOsStore(dir).createProject(proj);
      const file = path.join(dir, "snapshot.json"), s = JSON.parse(snap(dir)); s.lastHash = "f".repeat(64);
      fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
      expect(new WorkOsStore(dir).isTampered).toBe(true);
    });
  });

  // //TR: UASCO-T0042 (C-PAR-1 PAR-03, Windows): dış tanıtıcı (Defender/dizinleyici) açıkken silinen kilit adı "silme-beklemede" kalır ve o ada link() EPERM verir.
  // Bırakma kilit adında yerinde silme yapmamalı (mezar adına rename): aksi halde sonraki withLock senkron döngüde bekler ve olay döngüsü (lease heartbeat'i) durur.
  describe("UASCO-T0042 C-PAR-1 PAR-03: a released lock name never stays delete-pending (Windows heartbeat starvation)", () => {
    /** Windows silme-beklemesini taklit eden bellek içi fs: yerinde silinen ad `pendingOps` işlem boyunca yeniden oluşturulamaz (EPERM); rename adı hemen boşaltır. */
    function pendingIo(pendingOps: number) {
      const files = new Map<string, string>(), pending = new Map<string, number>();
      const err = (code: string) => Object.assign(new Error(code), {code});
      const tick = () => { for (const [k, v] of pending) { if (v <= 1) pending.delete(k); else pending.set(k, v - 1); } };
      const create = (p: string, data: string) => { if (pending.has(p)) throw err("EPERM"); if (files.has(p)) throw err("EEXIST"); files.set(p, data); };
      let busy = 0;
      const io: StoreLockIo = {
        writeFile(p, d) { tick(); create(p, d); },
        link(a, b) { tick(); const d = files.get(a); if (d === undefined) throw err("ENOENT"); try { create(b, d); } catch (e) { if ((e as {code?: string}).code === "EPERM") busy++; throw e; } },
        read(p) { tick(); const d = files.get(p); if (d === undefined) throw err("ENOENT"); return d; },
        unlink(p) { tick(); if (!files.delete(p)) throw err("ENOENT"); pending.set(p, pendingOps); },
        list(d) { return [...files.keys()].filter(k => k.startsWith(d + "/")).map(k => k.slice(d.length + 1)); },
        mtimeMs() { return Date.now(); },
        rename(a, b) { tick(); const d = files.get(a); if (d === undefined) throw err("ENOENT"); if (files.has(b) || pending.has(b)) throw err("EPERM"); files.delete(a); files.set(b, d); },
      };
      return {io, files, busy: () => busy};
    }
    const L = "/w/journal.lock";

    it("acquire -> release -> acquire succeeds immediately while the old name would still be delete-pending", () => {
      const {io, files, busy} = pendingIo(1_000);
      for (let i = 0; i < 20; i++) { const l = acquireStoreLock(L, {io}); expect(files.get(L)).toBe(l.id); l.release(); }
      expect(busy()).toBe(0);                                  // no EPERM on the lock name: nothing for withLock to spin on
      expect([...files.keys()].filter(k => k.startsWith(L))).toEqual([]);   // tombstones are removed (or swept by the next winner)
    });

    // NB-2 (#321 review): the stale-takeover path vacates the stale name the same way release() does, so the link() right after it is not blocked.
    const staleId = (pid: number, host = storeLockHostTag()) => `${pid}.0.${host}:${"a".repeat(32)}`;
    it("stale takeover vacates the dead owner's lock by tombstone rename: the takeover's own link and the next acquire do not stall", () => {
      const {io, files, busy} = pendingIo(1_000);
      files.set(L, staleId(999_999));                          // dead owner, same host
      const l = acquireStoreLock(L, {io, alive: () => false});
      expect(files.get(L)).toBe(l.id);
      expect(busy()).toBe(0);                                  // no EPERM on the lock name during the takeover
      l.release();
      const next = acquireStoreLock(L, {io, alive: () => false});
      expect(files.get(L)).toBe(next.id); next.release();
      expect(busy()).toBe(0);
      expect([...files.keys()].filter(k => k.startsWith(L))).toEqual([]);   // no takeover token, temp file or tombstone left behind
    });
    it("takeover guarantees are unchanged: a live owner is STORE_LOCKED and another host's lock is STORE_LOCK_OTHER_HOST, both left untouched", () => {
      const {io, files} = pendingIo(1_000);
      files.set(L, staleId(4242));
      expect(() => acquireStoreLock(L, {io, alive: () => true})).toThrow(/STORE_LOCKED/);
      expect(files.get(L)).toBe(staleId(4242));
      files.set(L, staleId(999_999, "0123456789ab"));
      expect(() => acquireStoreLock(L, {io, alive: () => false})).toThrow(/STORE_LOCK_OTHER_HOST/);
      expect(files.get(L)).toBe(staleId(999_999, "0123456789ab"));
      expect([...files.keys()].filter(k => k !== L && k.startsWith(L))).toEqual([]);
    });
    // The rename must only ever move the stale lock this process holds the generation token for: these interleavings would otherwise rename a live lock away.
    it("takeover race: if the name changed after our token (another taker re-linked a live lock), it is never vacated", () => {
      const {io, files} = pendingIo(0);
      files.set(L, staleId(999_999));
      let tokenTaken = false, raced = false;
      const racing: StoreLockIo = {...io,
        link(a, b) { io.link(a, b); if (b.includes(".takeover.")) tokenTaken = true; },
        read(p) {
          if (p === L && tokenTaken && !raced) { raced = true; const seen = staleId(888_888); files.set(L, staleId(4242)); return seen; } // B vacated S' and linked its live lock right after our read
          return io.read(p);
        }};
      expect(() => acquireStoreLock(L, {io: racing, alive: pid => pid === 4242})).toThrow(/STORE_LOCKED/);
      expect(raced).toBe(true);
      expect(files.get(L)).toBe(staleId(4242));                // B's live lock is intact
    });
    it("takeover race: a zero-byte lock that turns young again (a legacy writer is mid-write) is re-checked and not vacated", () => {
      const {io, files} = pendingIo(0);
      files.set(L, "");
      let calls = 0;
      const legacy: StoreLockIo = {...io, mtimeMs: () => (++calls === 1 ? Date.now() - 60_000 : Date.now())};
      expect(() => acquireStoreLock(L, {io: legacy, alive: () => false})).toThrow(/STORE_LOCKED/);
      expect(calls).toBeGreaterThan(1);
      expect(files.get(L)).toBe("");
    });
    it("without rename support the stale takeover still uses in-place unlink (the delete-pending name blocks its link)", () => {
      const {io, files, busy} = pendingIo(1_000);
      files.set(L, staleId(999_999));
      expect(() => acquireStoreLock(L, {io: {...io, rename: undefined}, alive: () => false})).toThrow(/STORE_LOCK_BUSY/);
      expect(busy()).toBe(1);
    });

    it("without rename support the old unlink path is still used (and is exactly what leaves the name delete-pending)", () => {
      const {io, busy} = pendingIo(1_000);
      const noRename: StoreLockIo = {...io, rename: undefined};
      acquireStoreLock(L, {io: noRename}).release();
      expect(() => acquireStoreLock(L, {io: noRename})).toThrow(/STORE_LOCK_BUSY/);
      expect(busy()).toBe(1);
    });

    it("end to end: with journal.lock delete-pending for 3 s after every in-place unlink (real fs), store writes never block and a 50 ms heartbeat timer keeps firing well within TTL/3", async () => {
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "t0042b-")), "d");
      const blockedUntil = new Map<string, number>();
      const io: StoreLockIo = {
        ...defaultStoreLockIo,
        unlink: p => { defaultStoreLockIo.unlink(p); if (path.basename(p) === "journal.lock") blockedUntil.set(p, Date.now() + 3_000); },
        link: (a, b) => { if ((blockedUntil.get(b) ?? 0) > Date.now()) throw Object.assign(new Error("EPERM"), {code: "EPERM"}); defaultStoreLockIo.link(a, b); },
      };
      const s = new WorkOsStore(dir, {lock: {io}});
      const proj = {tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: "T"};
      const TTL = 5_000; let last = performance.now(), maxGap = 0;
      const hb = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 50);
      try {
        for (let i = 0; i < 8; i++) {
          const t0 = performance.now(); s.createProject(proj); s.listProjects({tenantId: "tA"});
          expect(performance.now() - t0).toBeLessThan(TTL / 3);
          await new Promise(r => setTimeout(r, 60));
        }
      } finally { clearInterval(hb); }
      expect(maxGap).toBeLessThan(TTL / 3);
      expect(s.lockWaitStats().maxMs).toBeLessThan(TTL / 3);
      expect(new WorkOsStore(dir).listProjects({tenantId: "tA"}).length).toBe(8);
      expect(fs.readdirSync(dir).filter(f => f.startsWith("journal.lock"))).toEqual([]);
      fs.rmSync(path.dirname(dir), {recursive: true, force: true});
    }, 60_000);

    it("lockWaitStats names a lock spin (for the PAR-03 diagnostic)", () => {
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "t0042c-")), "d");
      let fails = 3;
      const io: StoreLockIo = {...defaultStoreLockIo, link: (a, b) => { if (path.basename(b) === "journal.lock" && fails-- > 0) throw Object.assign(new Error("EPERM"), {code: "EPERM"}); defaultStoreLockIo.link(a, b); }};
      const s = new WorkOsStore(dir, {lock: {io}});
      s.createProject({tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: "T"});
      const w = s.lockWaitStats();
      expect(w.waits).toBe(1);
      expect(w.lastCode).toBe("STORE_LOCK_BUSY");
      expect(w.maxMs).toBeGreaterThanOrEqual(30);
      fs.rmSync(path.dirname(dir), {recursive: true, force: true});
    });
  });
}
