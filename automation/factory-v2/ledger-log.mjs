// //TR: Factory V2 kalıcı olay günlüğü arka uçları: (1) yerel dosya (JSONL + fsync + kilit) ve (2) korumalı paylaşımlı registry üzerinde bölüm-parçalı, Supervisor anahtarıyla imzalı ve hash zincirli günlük. Registry arka ucunda ekleme yalnız beklenen son sıra numarası tutuyorsa CAS ile yapılır; zinciri bozuk, imzasız veya yetkisiz imzalı bir olay okunduğunda günlük hiçbir durumu kabul etmez (fail-closed). Cloud konteyneri kapanınca durum kaybolmaz: yeni yetkili Supervisor aynı günlükten devam eder.
import fs from "node:fs";
import path from "node:path";
import {signAction, verifyAction, canonDigest} from "./identity.mjs";

export class LedgerError extends Error { constructor(code, detail) { super(`${code}${detail ? ":" + detail : ""}`); this.code = code; this.detail = detail; } }

/** Local JSONL backend (single machine). tryAppend applies only if the last persisted seq still equals expectedSeq. */
export function fileLog(dir) {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, "journal.jsonl"), lock = file + ".lock";
  const load = () => {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n"), out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch { if (lines.slice(i + 1).every(x => !x.trim())) break; throw new LedgerError("JOURNAL_CORRUPT", String(i + 1)); } // torn tail write is dropped
    }
    return out;
  };
  const withLock = fn => {
    for (let i = 0; ; i++) {
      try { fs.closeSync(fs.openSync(lock, "wx")); break; } catch (e) {
        if (e.code !== "EEXIST") throw e;
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) { fs.rmSync(lock, {force: true}); continue; } } catch {}
        if (i > 2000) throw new LedgerError("JOURNAL_LOCK_TIMEOUT");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      }
    }
    try { return fn(); } finally { fs.rmSync(lock, {force: true}); }
  };
  return {
    kind: "FILE", file, load,
    tryAppend(expectedSeq, entry) {
      return withLock(() => {
        const last = load().at(-1)?.seq ?? 0;
        if (last !== expectedSeq) return {ok: false};
        const fd = fs.openSync(file, "a");
        try { fs.writeSync(fd, JSON.stringify(entry) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        return {ok: true, entry};
      });
    }
  };
}

const CHUNK = /^ledger\/([A-Za-z0-9._-]+)\/c\/(\d{6})$/;
/**
 * Shared backend on a sectioned registry (createSharedRegistry over the protected registry branch).
 * Events live in chunk sections `ledger/<ns>/c/<000001>`; every event carries a LEDGER envelope signed by the Supervisor key over
 * {seq, prev digest, event}, so a registry writer without that key cannot insert, alter, reorder or drop events unnoticed.
 */
export function registryLog({registry, ns, signer, ring, domain, chunkSize = 100}) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(ns ?? "")) throw new LedgerError("LEDGER_NS_INVALID", ns);
  if (!ring || !domain) throw new LedgerError("LEDGER_KEYRING_REQUIRED");
  const key = n => `ledger/${ns}/c/${String(n).padStart(6, "0")}`;
  const chunks = () => registry.sections().map(k => CHUNK.exec(k)).filter(m => m && m[1] === ns).map(m => Number(m[2])).sort((a, b) => a - b);
  const digestOf = e => canonDigest(e);
  /** Verified events in order; throws on any gap, reorder, foreign or tampered event (fail closed). */
  const loadVerified = () => {
    const out = []; let prev = "genesis", expectNo = 1;
    for (const n of chunks()) {
      if (n !== expectNo++) throw new LedgerError("LEDGER_CHUNK_GAP", String(n));
      for (const e of registry.read(key(n)).doc?.events ?? []) {
        const {sig, ...body} = e;
        if (body.seq !== out.length + 1) throw new LedgerError("LEDGER_SEQ_GAP", String(body.seq));
        if (body.prev !== prev) throw new LedgerError("LEDGER_CHAIN_BROKEN", String(body.seq));
        try { verifyAction(sig, {ring, action: "LEDGER", domain, prev, payload: body, checkTime: false}); } catch (x) { throw new LedgerError("LEDGER_EVENT_UNVERIFIED", `${body.seq}:${x.code ?? x.message}`); }
        out.push(e); prev = digestOf(e);
      }
    }
    return out;
  };
  return {
    kind: "REGISTRY", ns,
    load: () => loadVerified().map(({sig, prev, ...e}) => ({...e, signer: sig.sessionId ?? null})),
    tryAppend(expectedSeq, entry) {
      if (!signer) throw new LedgerError("LEDGER_SIGNER_REQUIRED");
      const all = loadVerified();
      if ((all.at(-1)?.seq ?? 0) !== expectedSeq) return {ok: false};
      const prev = all.length ? digestOf(all.at(-1)) : "genesis";
      const body = JSON.parse(JSON.stringify({...entry, prev})); // exactly what readers will see (no undefined fields)
      const e = {...body, sig: signAction({...signer, domain, action: "LEDGER", prev, payload: body, ttlMs: 365 * 24 * 3600_000})};
      try { verifyAction(e.sig, {ring, action: "LEDGER", domain, prev, payload: body, checkTime: false}); } catch (x) { throw new LedgerError("LEDGER_SIGNER_NOT_AUTHORIZED", x.code ?? x.message); } // never write what readers would refuse
      const ns_ = chunks(), last = ns_.at(-1) ?? 0;
      const cur = last ? registry.read(key(last)) : {sha: null, doc: null};
      const full = !last || (cur.doc?.events?.length ?? 0) >= chunkSize;
      const target = full ? key(last + 1) : key(last);
      const r = full ? registry.cas(target, null, {events: [e]}) : registry.cas(target, cur.sha, {events: [...cur.doc.events, e]});
      return r.ok ? {ok: true, entry} : {ok: false};
    }
  };
}
