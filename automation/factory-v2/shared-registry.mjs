// //TR: Factory V2 ortak kalıcı kayıt: Claude Cloud oturumları git proxy'si üzerinden yalnız atanmış dallarına push edebildiğinden (refs/uasco/* 403), tüm paylaşımlı durum (otorite kaydı, handover manifestleri, Supervisor/Writer/görev lease'leri) TEK bir izinli dalda (refs/heads/uasco/<ad>) tek belge içinde bölümler halinde tutulur. Her bölüm kendi sürüm özetiyle CAS'lanır; belgenin tamamı ise sunucuda `--force-with-lease` + fast-forward commit zinciriyle CAS'lanır, böylece başka bir bölümdeki eşzamanlı yazı bölüm CAS'ını yanlışlıkla bozmaz ama hiçbir yazı kaybolmaz. Sahiplik garantisi yerel kilitten değil ortak sunucunun ref güncellemesinden gelir.
import crypto from "node:crypto";
import {leaseVersion} from "../lib/task-lease.mjs";

const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v);
/** Section version: hash of (per-section revision, content); null = absent. The revision makes A -> B -> A a NEW version (no ABA). */
export const sectionVersion = (v, rev = 0) => (v === undefined || v === null ? null : crypto.createHash("sha256").update(canon({rev, v})).digest("hex"));
export const REGISTRY_SCHEMA = "uasco.factory-v2.shared-registry/1";
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/#:-]{0,240}$/;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Sectioned store over one document at `ref` in a commit-chained doc store (createRemoteDocStore / createLocalDocStore).
 * Exposes the doc-store contract (read/cas/remove keyed by section name) so AuthorityBridge runs on it unchanged,
 * plus leaseStore(prefix) implementing the task-lease Store contract.
 */
export function createSharedRegistry({docStore, ref, maxRetries = 8, backoffMs = 40}) {
  if (!docStore?.kind) throw new Error("REGISTRY_DOCSTORE_REQUIRED");
  const readAll = () => { const r = docStore.read(ref); const doc = r.doc ?? {schema: REGISTRY_SCHEMA, sections: {}}; if (doc.schema !== REGISTRY_SCHEMA || typeof doc.sections !== "object") throw new Error("REGISTRY_SCHEMA_INVALID"); return {sha: r.sha, doc}; };
  /** Section-level CAS: applies only if the section still has `expected` version; retries whole-doc CAS lost to writes in OTHER sections. */
  const update = (key, expected, next) => {
    if (!KEY.test(key) || key.includes("..")) throw new Error(`REGISTRY_KEY_INVALID:${key}`);
    for (let i = 0; i <= maxRetries; i++) {
      const cur = readAll();
      const have = cur.doc.sections[key], revs = cur.doc.revs ?? {}, rev = revs[key] ?? 0;
      if (sectionVersion(have, rev) !== expected) return {ok: false, current: have ?? null, version: sectionVersion(have, rev)};
      const sections = {...cur.doc.sections}, nextRevs = {...revs, [key]: rev + 1}; // revisions only grow, even across delete/recreate
      if (next === null) delete sections[key]; else sections[key] = next;
      const r = docStore.cas(ref, cur.sha, {schema: REGISTRY_SCHEMA, phase: `section:${key}`, sections, revs: nextRevs, seq: (cur.doc.seq ?? 0) + 1});
      if (r.ok) return {ok: true, version: sectionVersion(next, rev + 1), sha: r.sha};
      sleep(backoffMs * (i + 1) + Math.floor(Math.random() * backoffMs));
    }
    throw new Error("REGISTRY_CONTENDED"); // fail closed: never assume a write landed
  };
  const api = {
    kind: docStore.kind, ref,
    read: key => { const d = readAll().doc, v = d.sections[key]; return {sha: sectionVersion(v, d.revs?.[key] ?? 0), doc: v ?? null}; },
    cas: (key, expectedVersion, doc) => { const r = update(key, expectedVersion, doc); return r.ok ? {ok: true, sha: r.version} : {ok: false, sha: null, current: {sha: r.version, doc: r.current}}; },
    remove: (key, expectedVersion) => update(key, expectedVersion, null).ok,
    sections: () => Object.keys(readAll().doc.sections).sort(),
    /** task-lease Store contract (createIfAbsent/read/cas/remove) under `lease/<namespace>/<id>`; CAS on the lease VERSION like the ref store. */
    leaseStore(namespace) {
      const k = id => `lease/${namespace}/${id}`;
      return {
        kind: docStore.kind, namespace: `registry:${ref}:${namespace}`,
        read: id => readAll().doc.sections[k(id)] ?? null,
        createIfAbsent(id, rec) { const r = update(k(id), null, rec); return r.ok ? {created: true, current: rec} : {created: false, current: r.current}; },
        cas(id, expected, rec) {
          const d = readAll().doc, cur = d.sections[k(id)];
          if (!leaseVersion(expected) || leaseVersion(cur) !== leaseVersion(expected)) return {ok: false, current: cur ?? null};
          const r = update(k(id), sectionVersion(cur, d.revs?.[k(id)] ?? 0), rec); return r.ok ? {ok: true, current: rec} : {ok: false, current: r.current};
        },
        // Release leaves an expired tombstone instead of deleting, so the next grant is epoch+1: epochs only grow per lease id.
        remove(id, expected) {
          const d = readAll().doc, cur = d.sections[k(id)];
          if (!leaseVersion(expected) || leaseVersion(cur) !== leaseVersion(expected)) return {ok: false};
          const tomb = {...cur, token: `released:${cur.token}`, expiresAt: 0, released: true};
          return {ok: update(k(id), sectionVersion(cur, d.revs?.[k(id)] ?? 0), tomb).ok};
        }
      };
    }
  };
  return api;
}
