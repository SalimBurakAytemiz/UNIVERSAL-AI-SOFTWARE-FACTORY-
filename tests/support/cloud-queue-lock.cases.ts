// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) bulut kuyruk kilidinin araya giren süreç senaryolarını sahte I/O ile deterministik olarak doğrular: boş kilit penceresi yok, devralma jetonu, başkasının taze kilidi silinmez, yazma hatasında artık kalmaz, bırakma yalnız kendi kilidini siler.
import {describe, it, expect} from "vitest";
import {acquireQueueLock, type LockIo} from "../../apps/control-api/src/cloud/queue-lock.js";

/** Bellek içi dosya sistemi; `hooks` bir işlemden hemen önce başka bir sürecin adımını araya sokar. */
function memIo(hooks: Partial<Record<"beforeLink" | "beforeUnlink" | "beforeRead" | "beforeWrite", (path: string) => void>> = {}) {
  const files = new Map<string, {data: string; mtime: number}>();
  const err = (code: string) => Object.assign(new Error(code), {code});
  const io: LockIo = {
    writeFile(p, data) { hooks.beforeWrite?.(p); if (files.has(p)) throw err("EEXIST"); files.set(p, {data, mtime: 0}); },
    link(a, b) { hooks.beforeLink?.(b); const f = files.get(a); if (!f) throw err("ENOENT"); if (files.has(b)) throw err("EEXIST"); files.set(b, {...f}); },
    read(p) { hooks.beforeRead?.(p); const f = files.get(p); if (!f) throw err("ENOENT"); return f.data; },
    unlink(p) { hooks.beforeUnlink?.(p); if (!files.delete(p)) throw err("ENOENT"); },
  };
  return {io, files};
}
const L = "/q/jobs.lock";
const dead = (pid: number) => pid !== 111 && pid !== 222 && pid !== 333;   // 111/222/333 canlı süreçler

export function registerQueueLockCases(): void {
  describe("CLOUD-T0003 queue lock (NB-1/NB-2/NB-3)", () => {
    it("the lock file only ever appears with full content: no empty-lock window (NB-1a)", () => {
      const seen: string[] = [];
      const {io, files} = memIo({beforeLink: p => { if (p === L) seen.push(files.has(L) ? files.get(L)!.data : "<absent>"); }});
      const a = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 111});
      expect(files.get(L)!.data).toBe(a.id);
      expect([...files.keys()]).toEqual([L]);   // geçici dosya kalmadı
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(seen.every(x => x !== "")).toBe(true);
    });

    it("a stale lock is taken over; a fresh lock created by another process during the takeover is never deleted (NB-1b)", () => {
      let injected = false;
      const {io, files} = memIo({
        // B jetonu almadan hemen önce, A bayat kilidi devralıp kendi taze kilidini yazmış olsun.
        beforeLink: p => {
          if (p === `${L}.takeover` && !injected) {
            injected = true;
            files.delete(L); files.set(L, {data: `111:${"c".repeat(32)}`, mtime: 0});
          }
        },
      });
      files.set(L, {data: `999:${"d".repeat(32)}`, mtime: 0});   // ölü sahip
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(`111:${"c".repeat(32)}`);   // A'nın taze kilidi yerinde
      expect([...files.keys()].filter(k => k !== L)).toEqual([]);  // jeton ve geçici dosyalar temizlendi
    });

    it("only the takeover-token holder deletes a stale lock; a live token holder blocks others", () => {
      const {io, files} = memIo();
      files.set(L, {data: `999:${"d".repeat(32)}`, mtime: 0});
      files.set(`${L}.takeover`, {data: `333:${"e".repeat(32)}`, mtime: 0});   // canlı süreç devralıyor
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(`999:${"d".repeat(32)}`);   // silinmedi
      // NB-5: jetonu tutarken çökmüş süreç -> otomatik temizlik YOK; operatör görür, kilit ve jeton yerinde kalır.
      files.set(`${L}.takeover`, {data: `998:${"e".repeat(32)}`, mtime: 0});
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_TAKEOVER_STALE/);
      expect(files.get(L)!.data).toBe(`999:${"d".repeat(32)}`);
      expect(files.get(`${L}.takeover`)!.data).toBe(`998:${"e".repeat(32)}`);
      files.delete(`${L}.takeover`);   // operatör temizledi
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
    });

    it("a write failure leaves neither a lock nor a temp file behind (NB-2 / M17)", () => {
      const {io, files} = memIo({beforeLink: () => { throw Object.assign(new Error("EIO"), {code: "EIO"}); }});
      expect(() => acquireQueueLock(L, {io, alive: () => true, pid: 111})).toThrow(/EIO/);
      expect([...files.keys()]).toEqual([]);
    });

    it("release removes only our own lock, never one that replaced it (NB-3)", () => {
      const {io, files} = memIo();
      const a = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 111});
      files.set(L, {data: `222:${"f".repeat(32)}`, mtime: 0});
      a.release();
      expect(files.get(L)!.data).toBe(`222:${"f".repeat(32)}`);
      files.set(L, {data: a.id, mtime: 0}); a.release();
      expect(files.has(L)).toBe(false);
    });
      it("malformed lock content is never mistaken for a live owner (NB-6 Q13)", () => {
      const {io, files} = memIo();
      files.set(L, {data: "111garbage", mtime: 0});   // 111 canlı ama içerik tanınmıyor
      const a = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(a.id);
    });

    it("an owner releasing during our acquire is retried, not an error (NB-6 Q15/Q16)", () => {
      let released = false;
      const {io, files} = memIo({beforeRead: p => { if (p === L && !released) { released = true; files.delete(L); } }});
      files.set(L, {data: `111:${"a".repeat(32)}`, mtime: 0});
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
    });
      it("ENOENT on the takeover-token read is retried, then the lock is acquired (NB-8 / M9)", () => {
      let gone = false;
      const {io, files} = memIo({beforeRead: p => { if (p === `${L}.takeover` && !gone) { gone = true; files.delete(`${L}.takeover`); } }});
      files.set(L, {data: `999:${"d".repeat(32)}`, mtime: 0});
      files.set(`${L}.takeover`, {data: `333:${"e".repeat(32)}`, mtime: 0});   // canlı devralan, okumadan hemen önce bitiriyor
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
    });

    it("a stale pid that becomes live after the token is taken is never deleted (NB-8 / M5)", () => {
      let tokenTaken = false;
      const {io, files} = memIo({beforeLink: p => { if (p === `${L}.takeover`) tokenTaken = true; }});
      files.set(L, {data: `999:${"d".repeat(32)}`, mtime: 0});
      const alive = (p: number) => p === 999 ? tokenTaken : !dead(p);   // pid yeniden kullanıldı
      expect(() => acquireQueueLock(L, {io, alive, pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(`999:${"d".repeat(32)}`);
      expect(files.has(`${L}.takeover`)).toBe(false);
    });
  });
}
