// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) UASCO-T0042 PAR-03 regresyonunu doğrular: store okuma/yazma başına senkron dayanıklı G/Ç (fsync) sınırlıdır; değişmemiş snapshot yeniden yazılmaz, ama yanlış/eski snapshot her zaman düzeltilir (otorite journal'dır).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../../core/workos/store.js";

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
}
