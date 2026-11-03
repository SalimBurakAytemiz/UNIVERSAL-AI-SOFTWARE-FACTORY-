// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) bulut kuyruk kilidinin araya giren süreç senaryolarını sahte I/O ile deterministik olarak doğrular: boş kilit penceresi yok, devralma jetonu, başkasının taze kilidi silinmez, yazma hatasında artık kalmaz, bırakma yalnız kendi kilidini siler.
import {describe, it, expect} from "vitest";
import {createHash} from "node:crypto";
import {acquireQueueLock, MAX_TAKEOVER_GENERATIONS, type LockIo} from "../../apps/control-api/src/cloud/queue-lock.js";

/** Bellek içi dosya sistemi; `hooks` bir işlemden hemen önce başka bir sürecin adımını araya sokar. */
function memIo(hooks: Partial<Record<"beforeLink" | "beforeUnlink" | "beforeRead" | "beforeWrite", (path: string) => void>> = {}) {
  const files = new Map<string, {data: string; mtime: number}>();
  const err = (code: string) => Object.assign(new Error(code), {code});
  let ops = 0;
  const tick = () => { if (++ops > 10_000) throw new Error("OP_BUDGET_EXCEEDED (unbounded lock loop)"); };
  const io: LockIo = {
    writeFile(p, data) { tick(); hooks.beforeWrite?.(p); if (files.has(p)) throw err("EEXIST"); files.set(p, {data, mtime: 0}); },
    link(a, b) { tick(); hooks.beforeLink?.(b); const f = files.get(a); if (!f) throw err("ENOENT"); if (files.has(b)) throw err("EEXIST"); files.set(b, {...f}); },
    read(p) { tick(); hooks.beforeRead?.(p); const f = files.get(p); if (!f) throw err("ENOENT"); return f.data; },
    unlink(p) { tick(); hooks.beforeUnlink?.(p); if (!files.delete(p)) throw err("ENOENT"); },
    list(d) { tick(); return [...files.keys()].filter(k => k.startsWith(d + "/")).map(k => k.slice(d.length + 1)); },
  };
  return {io, files};
}
const L = "/q/jobs.lock";
const tok = (stale: string, k: number) => `${L}.takeover.${createHash("sha256").update(stale).digest("hex").slice(0, 24)}.${k}`;
const STALE = `999:${"d".repeat(32)}`;
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
          if (p.startsWith(`${L}.takeover.`) && !injected) {
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

    it("a live takeover-token holder blocks others; a dead one is recovered automatically via the next generation (NB-5)", () => {
      const {io, files} = memIo();
      files.set(L, {data: STALE, mtime: 0});
      files.set(tok(STALE, 1), {data: `333:${"e".repeat(32)}`, mtime: 0});   // canlı süreç devralıyor
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(STALE);
      files.set(tok(STALE, 1), {data: `998:${"e".repeat(32)}`, mtime: 0});   // jetonu tutarken çökmüş: elle temizlik GEREKMEZ
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
      expect([...files.keys()]).toEqual([L]);   // eski jetonlar temizlendi
    });

    it("two recoverers racing for the next generation: exactly one wins, no token is ever deleted to take over", () => {
      let injected = false;
      const {io, files} = memIo({
        beforeLink: p => {   // B kuşak 2'yi almadan hemen önce E onu almış olsun (E canlı ve devralmanın ortasında)
          if (p === tok(STALE, 2) && !injected) { injected = true; files.set(tok(STALE, 2), {data: `333:${"f".repeat(32)}`, mtime: 0}); }
        },
        beforeUnlink: p => { if (p.includes(".takeover.") && p.endsWith(".1")) throw new Error("token 1 must never be deleted during takeover"); },
      });
      files.set(L, {data: STALE, mtime: 0});
      files.set(tok(STALE, 1), {data: `998:${"e".repeat(32)}`, mtime: 0});
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(STALE);   // E'nin devralması sürüyor; B hiçbir şey silmedi
    });

    it("fails closed only after MAX_TAKEOVER_GENERATIONS consecutive crashed takeovers", () => {
      const {io, files} = memIo();
      files.set(L, {data: STALE, mtime: 0});
      for (let k = 1; k <= MAX_TAKEOVER_GENERATIONS; k++) files.set(tok(STALE, k), {data: `998:${"e".repeat(32)}`, mtime: 0});
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_TAKEOVER_STALE/);
      expect(files.get(L)!.data).toBe(STALE);
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
      const {io, files} = memIo({beforeRead: p => { if (p === tok(STALE, 1) && !gone) { gone = true; files.delete(tok(STALE, 1)); } }});
      files.set(L, {data: STALE, mtime: 0});
      files.set(tok(STALE, 1), {data: `333:${"e".repeat(32)}`, mtime: 0});   // canlı devralan, okumadan hemen önce bitiriyor
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
    });

    it("a stale pid that becomes live after the token is taken is never deleted (NB-8 / M5)", () => {
      let tokenTaken = false;
      const {io, files} = memIo({beforeLink: p => { if (p.startsWith(`${L}.takeover.`)) tokenTaken = true; }});
      files.set(L, {data: `999:${"d".repeat(32)}`, mtime: 0});
      const alive = (p: number) => p === 999 ? tokenTaken : !dead(p);   // pid yeniden kullanıldı
      expect(() => acquireQueueLock(L, {io, alive, pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(`999:${"d".repeat(32)}`);
      expect([...files.keys()].filter(k => k.includes(".takeover"))).toEqual([]);
    });
    it("holding the token for S never deletes a different stale lock S2 that another process is taking over", () => {
      const S2 = `997:${"9".repeat(32)}`;
      let swapped = false;
      const {io, files} = memIo({beforeLink: p => {
        if (p === tok(STALE, 1) && !swapped) {   // biz S jetonunu alırken: kilit S2 oldu ve S2'yi canlı 333 devralıyor
          swapped = true; files.set(L, {data: S2, mtime: 0}); files.set(tok(S2, 1), {data: `333:${"7".repeat(32)}`, mtime: 0});
        }
      }});
      files.set(L, {data: STALE, mtime: 0});
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/QUEUE_LOCKED/);
      expect(files.get(L)!.data).toBe(S2);
    });
    it("L-1: the winner's token GC never deletes another process's in-flight temp file", () => {
      const {io, files} = memIo();
      const inflight = `${tok(STALE, 1)}.tmp-abcdef0123456789`;
      files.set(inflight, {data: `333:${"e".repeat(32)}`, mtime: 0});
      acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.has(inflight)).toBe(true);
    });

    it("QL4: the last generation (MAX) is still usable", () => {
      const {io, files} = memIo();
      files.set(L, {data: STALE, mtime: 0});
      for (let k = 1; k < MAX_TAKEOVER_GENERATIONS; k++) files.set(tok(STALE, k), {data: `998:${"e".repeat(32)}`, mtime: 0});
      const b = acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.get(L)!.data).toBe(b.id);
    });
    it("N-2/Q8: the legacy single `.takeover` file is cleared by the winner", () => {
      const {io, files} = memIo();
      files.set(`${L}.takeover`, {data: `998:${"e".repeat(32)}`, mtime: 0});
      acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.has(`${L}.takeover`)).toBe(false);
    });

    it("N-3: temp leftovers of dead processes are collected; a live process's in-flight temp is kept", () => {
      const {io, files} = memIo();
      const deadTmp = `${tok(STALE, 1)}.tmp-998-0123456789abcdef`, liveTmp = `${L}.tmp-333-fedcba9876543210`;
      files.set(deadTmp, {data: "x", mtime: 0}); files.set(liveTmp, {data: "y", mtime: 0});
      acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222});
      expect(files.has(deadTmp)).toBe(false);
      expect(files.has(liveTmp)).toBe(true);
    });

    it("N-3/Q7: an endlessly vanishing token is a typed QUEUE_LOCKED, never a raw ENOENT", () => {
      const {io, files} = memIo({beforeRead: p => { if (p === tok(STALE, 1)) files.delete(p); }, beforeLink: p => { if (p === tok(STALE, 1)) files.set(p, {data: `333:${"e".repeat(32)}`, mtime: 0}); }});
      files.set(L, {data: STALE, mtime: 0});
      expect(() => acquireQueueLock(L, {io, alive: p => !dead(p), pid: 222})).toThrow(/^QUEUE_LOCKED$/);
    });
  });
}
