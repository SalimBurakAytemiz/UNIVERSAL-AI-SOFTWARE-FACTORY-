// //TR: Bu dosya Evidence Center'ın doğrulanmış salt-okunur read-model'ini uygular: Work OS journal run kanıtları, orchestrator review evidence dosyaları ve audit checkpoint'leri hash'i baytlardan yeniden hesaplanarak VERIFIED/MISMATCH/MISSING/UNVERIFIABLE olarak indekslenir; yeni gerçek üretmez, hiçbir şey yazmaz, yalnız izinli kökler içinde okur ve API çıktısına mutlak yol koymaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
// //TR: automation/lib korumalı olduğundan atomic-json.mjs için .d.mts eklenemez; Work OS store'un journal hash'i ile aynı helper dar bir yerel tiple yeniden kullanılır.
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok
import {sha256 as sha256Untyped} from "../../automation/lib/atomic-json.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {redactSecrets} from "../workos/secret-scan.js";
import type {WorkOsStore} from "../workos/store.js";
import type {Scope, WorkRun} from "../workos/types.js";

const canonicalSha256 = sha256Untyped as (value: unknown) => string;

export type EvidenceKind = "WORK_RUN_STEP" | "WORK_RUN_LOG" | "REVIEW_EVIDENCE" | "AUDIT_CHECKPOINT";
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["WORK_RUN_STEP", "WORK_RUN_LOG", "REVIEW_EVIDENCE", "AUDIT_CHECKPOINT"];
export type VerificationStatus = "VERIFIED" | "MISMATCH" | "MISSING" | "UNVERIFIABLE";
export type SourceState = "AVAILABLE" | "UNAVAILABLE" | "ERROR" | "NOT_QUERIED";
export type SourceName = "workos" | "review" | "checkpoints";
export interface EvidenceScope { tenantId: string | null; projectId: string | null; missionId: string | null; runId: string | null }
export interface EvidenceSource { path: string | null; sha256: string | null; sizeBytes: number | null; locator: string | null }
export interface EvidenceVerification { status: VerificationStatus; checkedAt: string; basis: string; reason: string | null }
export interface EvidenceItem {
  evidenceId: string; kind: EvidenceKind; source: EvidenceSource; commit: string | null; createdAt: string | null;
  scope: EvidenceScope; verification: EvidenceVerification;
}
export interface EvidenceTail { text: string; truncated: boolean; redacted: true }
export interface EvidenceDetail { item: EvidenceItem; summary: Record<string, unknown>; tail: EvidenceTail | null; tailWithheld: string | null }
export interface EvidenceQuery { kind?: EvidenceKind; missionId?: string; runId?: string; cursor?: string; limit?: number }
export interface EvidencePage { items: EvidenceItem[]; nextCursor: string | null; sources: Record<SourceName, SourceState> }
export interface EvidenceSummary {
  state: "VERIFIED" | "UNAVAILABLE" | "ERROR"; total: number | null; verified: number | null; mismatch: number | null; missing: number | null; unverifiable: number | null;
  sources: Record<SourceName, SourceState>;
}
export interface EvidenceIndexOptions {
  repoRoot: string; dataDir: string; scope: Scope; store: () => WorkOsStore;
  // Depo düzeyi kanıt (review evidence, checkpoint) yalnız tek FOUNDER_LOCAL principal'ına görünür.
  includeRepositoryEvidence: boolean;
  maxHashBytes?: number; maxJsonBytes?: number; now?: () => number;
}
export class EvidenceInputError extends Error { constructor(readonly code: "INVALID_CURSOR" | "INVALID_QUERY") { super(code); this.name = "EvidenceInputError"; } }

export const DEFAULT_MAX_HASH_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_JSON_BYTES = 16 * 1024 * 1024;
export const TAIL_BYTES = 4096;
const TAIL_LOOKBACK = 512;
const MAX_DIR_ENTRIES = 10_000;
const MAX_LIMIT = 100;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.json$/;
const HEX40 = /^[0-9a-f]{40}$/;
const JOURNAL = "journal.jsonl";
// Kullanıcı dizini yolları API çıktısında görünmez (PQ-006). Kalıplar: Windows <sürücü>:\Users\<u>, yönetim paylaşımı (c$) ve 8.3 kısa adı DOCUME~1; POSIX
// bağlama noktası (/mnt/c/users/<u>, /cygdrive/c/..., /c/Users/<u>); /home/<u> ve /Users/<u>; macOS /var/root; Linux /root; WSL \\wsl$\<dağıtım>\root ve
// \home\<u>; Windows hizmet profilleri. Ayraçlar esnektir (\, /, JSON kaçışlı \\ ve \/). Sol sınır "/root"u "/rootfs", "x/root", "~/root" içinde maskelemez;
// ANSI renk kodundan (\x1b[..m) veya kısa bir bayraktan (-I/root, -v/root) hemen sonra gelen yol yine maskelenir. Eşleşme yalnız bir ayraç dizisinin başında
// başlar ve sol sınır yalnız ayraç önünde denenir, böylece uzun "////" veya rakam dizilerinde de süre doğrusaldır.
const PC = String.raw`\p{L}\p{N}._~\-`;
const LB = String.raw`(?=[\\/])(?:(?<![${PC}\\/])|(?<=\x1b\[[0-9;:?]*[A-Za-z])|(?<=\\u001[bB]\[[0-9;:?]*[A-Za-z])|(?<=(?:^|[\s"'=,;(])-[A-Za-z]))`;
const BR = `(?![${PC}])`, RUN = String.raw`(?<![\\/])`;
const SEP = String.raw`[\\/]+`, PSEP = String.raw`(?:\\?/)+`, BSEP = String.raw`\\+`;
// Kabukta kaçışlı boşluk ("/Users/John\ Smith") adın parçasıdır.
const NAME_P = String.raw`(?:[^\\/\s"'\x60]|\\ )+`;
// Windows profil adı boşluk içerebilir ("John Smith"): boşluklu ad en çok 20 karakterdir (Windows hesap adı sınırı) ve bir ayraç, tırnak veya satır sonunda biter;
// yoksa boşluksuz parça alınır, böylece "C:\Users\bob is not a git repository" iletisinin geri kalanı korunur.
const NAME_W = String.raw`(?:[^\\/"<>|:*?\r\n\t]{1,20}(?=[\\/"'\r\n]|$)|[^\\/\s"<>|:*?]+)`;
const DRIVE = String.raw`[A-Za-z][:$]`, PROFILES = String.raw`(?:users|documents and settings|docume~\d)`;
const USER_DIR_PATTERNS: readonly RegExp[] = [
  new RegExp(`${DRIVE}${SEP}${PROFILES}${SEP}${NAME_W}`, "giu"),
  new RegExp(`${LB}(?:${PSEP}(?:mnt|cygdrive))?${PSEP}[A-Za-z]${PSEP}${PROFILES}${PSEP}${NAME_W}`, "giu"),
  new RegExp(`${RUN}${PSEP}(?:home|Users)${SEP}${NAME_P}`, "gu"),
  new RegExp(`${LB}${BSEP}(?:home|Users)${SEP}${NAME_P}`, "gu"),
  new RegExp(`${RUN}${PSEP}var${PSEP}root${BR}`, "gu"),
  new RegExp(`${LB}${PSEP}root${BR}`, "gu"),
  new RegExp(`${RUN}${SEP}wsl(?:\\$|\\.localhost)${SEP}${NAME_P}${SEP}(?:root${BR}|home${SEP}${NAME_P})`, "giu"),
  new RegExp(`${DRIVE}${SEP}windows${SEP}(?:system32${SEP}config${SEP}systemprofile|serviceprofiles${SEP}${NAME_W})`, "giu"),
];
// Bir tamponun ilk satır sonundan (\n, \r veya \r\n) sonrası; satır sonu yoksa boş tampon: yarım satır hiç gösterilmez.
const afterFirstBreak = (b: Buffer): Buffer => {
  for (let i = 0; i < b.length; i++) if (b[i] === 0x0a || b[i] === 0x0d) return b.subarray(b[i] === 0x0d && b[i + 1] === 0x0a ? i + 2 : i + 1);
  return b.subarray(b.length);
};
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Mutlak bir yolun esnek ayraçlı, büyük/küçük harf duyarsız kalıbı. Ev dizini iki yandan sınırlıdır; kök önek olarak maskelenir (önceki split/join anlamı).
// "/" veya "C:\" gibi yalnız kök olan değer hiç maskelenmez (null).
function pathPattern(abs: string, bounded: boolean): RegExp | null {
  const t = abs.replace(/[\\/]+$/, ""), lead = /^[\\/]/.test(t), segs = t.split(/[\\/]+/).filter(Boolean);
  const drive = segs.length > 0 && /^[A-Za-z]:$/.test(segs[0]);
  if (segs.length - (drive ? 1 : 0) < 1) return null;
  // Boşluklu bir bileşen kabukta kaçışlı ("odd\ home") veya URL kodlu ("odd%20home") da yazılabilir.
  const body = (lead ? SEP : "") + segs.map(x => escapeRe(x).split(" ").join(String.raw`(?:\\ | |%20)`)).join(SEP);
  return new RegExp(bounded ? (lead ? LB : "") + body + BR : (lead ? RUN : "") + body, "giu");
}
// Gerçek kullanıcı dizini değerleri: os.homedir(), hesap kaydı, HOME ve USERPROFILE; her birinin realpath'i (Windows'ta native: 8.3 kısa ad açılır).
function userHomes(): string[] {
  const out = new Set<string>();
  for (const read of [() => os.homedir(), () => os.userInfo().homedir, () => process.env.HOME, () => process.env.USERPROFILE]) {
    let h: unknown;
    try { h = read(); } catch { h = undefined; }
    if (typeof h !== "string" || h.length === 0) continue;
    out.add(h);
    for (const rp of [fs.realpathSync, fs.realpathSync.native]) { try { out.add(rp(h)); } catch { /* yok veya okunamaz: ham değer yeterli */ } }
  }
  return [...out];
}

interface Outcome { sha256: string | null; sizeBytes: number | null; status: VerificationStatus; basis: string; reason: string | null }
interface Candidate {
  id: string; kind: EvidenceKind; sortKey: string; sourcePath: string | null; locator: string | null; commit: string | null; createdAt: string | null; scope: EvidenceScope;
  summary: Record<string, unknown>; verify: () => Promise<Outcome>; tail?: () => Promise<EvidenceTail | null>;
}
type Resolved = {ok: true; real: string; size: number} | {ok: false; code: "MISSING" | "REJECTED" | "ERROR"};
interface GitInfo { ok: boolean; blobs: Map<string, string>; last: Map<string, {commit: string; at: string | null}> }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
// Yalnız ISO-8601 zaman damgası: Date.parse "/root/.ssh 2020" gibi yol taşıyan metni de kabul ettiğinden biçim ayrıca doğrulanır.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const isoOrNull = (x: unknown): string | null => typeof x === "string" && x.length <= 40 && ISO_8601.test(x) && Number.isFinite(Date.parse(x)) ? x : null;
const evidenceId = (parts: unknown[]): string => `evi_${crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;
const posix = (p: string): string => p.split(path.sep).join("/");
const underRoot = (root: string, p: string): boolean => { const rel = path.relative(root, p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const noScope: EvidenceScope = {tenantId: null, projectId: null, missionId: null, runId: null};

// Yol ve sembolik bağ güvenliği: göreli, ".." içermeyen bir ad kökün altına çözülür; realpath kökün dışına çıkıyorsa veya düzenli dosya değilse okunmaz.
function resolveUnder(rootReal: string, rel: unknown, requiredPrefix?: string): Resolved {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 512 || rel.includes("\0") || rel.includes("\\") || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return {ok: false, code: "REJECTED"};
  const segs = rel.split("/");
  // ":" içeren bileşen (sürücü "C:" veya Windows akışı) geçersizdir: "runs/<id>/C:/Users/<u>/x.log" gibi gömülü mutlak yol API'ye yansımaz.
  if (segs.some(s => s === "" || s === "." || s === ".." || s.includes(":"))) return {ok: false, code: "REJECTED"};
  if (requiredPrefix !== undefined && !rel.startsWith(requiredPrefix)) return {ok: false, code: "REJECTED"};
  const abs = path.join(rootReal, ...segs);
  if (!underRoot(rootReal, abs)) return {ok: false, code: "REJECTED"};
  try {
    fs.lstatSync(abs);
  } catch (e) { return {ok: false, code: (e as NodeJS.ErrnoException).code === "ENOENT" ? "MISSING" : "ERROR"}; }
  try {
    const real = fs.realpathSync(abs);
    if (!underRoot(rootReal, real)) return {ok: false, code: "REJECTED"};
    const st = fs.statSync(real);
    if (!st.isFile()) return {ok: false, code: "REJECTED"};
    return {ok: true, real, size: st.size};
  } catch (e) { return {ok: false, code: (e as NodeJS.ErrnoException).code === "ENOENT" ? "MISSING" : "ERROR"}; }
}

interface HashResult { over: boolean; sha256: string; gitBlob: string; bytes: number; changed: boolean; data: Buffer | null }
// Akış halinde hash: dosya belleğe bütünüyle okunmaz (keep=true yalnız küçük JSON için baytları tutar). cap aşılırsa over=true döner.
async function hashFile(real: string, cap: number, keep = false): Promise<HashResult> {
  const fh = await fs.promises.open(real, "r");
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error("NOT_FILE");
    if (st.size > cap) return {over: true, sha256: "", gitBlob: "", bytes: st.size, changed: false, data: null};
    const h = crypto.createHash("sha256"), g = crypto.createHash("sha1").update(`blob ${st.size}\0`);
    const parts: Buffer[] = [];
    let n = 0;
    for await (const chunk of fh.createReadStream({highWaterMark: 65536, autoClose: false}) as AsyncIterable<Buffer>) {
      n += chunk.length;
      if (n > cap) return {over: true, sha256: "", gitBlob: "", bytes: n, changed: false, data: null};
      h.update(chunk); g.update(chunk);
      if (keep) parts.push(chunk);
    }
    return {over: false, sha256: h.digest("hex"), gitBlob: g.digest("hex"), bytes: n, changed: n !== st.size, data: keep ? Buffer.concat(parts) : null};
  } finally { await fh.close(); }
}

export class EvidenceIndex {
  private readonly repoReal: string;
  private readonly dataReal: string | null;
  private readonly roots: string[];
  private readonly pathMasks: {re: RegExp; tag: string}[];
  private readonly maxHash: number; private readonly maxJson: number; private readonly now: () => number;
  constructor(private readonly o: EvidenceIndexOptions) {
    this.repoReal = fs.realpathSync(path.resolve(o.repoRoot));
    let dataReal: string | null = null;
    try { dataReal = fs.realpathSync(path.resolve(o.dataDir)); } catch { dataReal = null; }
    this.dataReal = dataReal;
    this.roots = [o.repoRoot, this.repoReal, o.dataDir, dataReal ?? o.dataDir].map(r => path.resolve(r)).filter((r, i, a) => r.length > 3 && a.indexOf(r) === i).sort((a, b) => b.length - a.length);
    // Kökler <ROOT>, ev dizinleri <USER_PATH>; en uzun yol önce (ev içindeki depo <ROOT> olur).
    this.pathMasks = [...this.roots.map(p => ({p, tag: "<ROOT>", re: pathPattern(p, false)})), ...userHomes().map(p => ({p, tag: "<USER_PATH>", re: pathPattern(p, true)}))]
      .filter((m): m is {p: string; tag: string; re: RegExp} => m.re !== null).sort((x, y) => y.p.length - x.p.length).map(m => ({re: m.re, tag: m.tag}));
    this.maxHash = o.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES;
    this.maxJson = Math.min(o.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES, this.maxHash);
    this.now = o.now ?? Date.now;
  }

  // ---- genel API ----
  async list(q: EvidenceQuery = {}): Promise<EvidencePage> {
    const limit = q.limit === undefined ? 50 : q.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new EvidenceInputError("INVALID_QUERY");
    const after = q.cursor === undefined ? null : this.decodeCursor(q.cursor);
    const {candidates, sources} = await this.enumerate(q);
    candidates.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    const rest = after === null ? candidates : candidates.filter(c => c.sortKey > after);
    const page = rest.slice(0, limit);
    const checkedAt = new Date(this.now()).toISOString();
    const items: EvidenceItem[] = [];
    for (const c of page) items.push(await this.materialize(c, checkedAt));
    const nextCursor = rest.length > limit ? Buffer.from(page[page.length - 1].sortKey, "utf8").toString("base64url") : null;
    return {items, nextCursor, sources};
  }

  async get(evidenceIdValue: string): Promise<EvidenceDetail | null> {
    const {candidates} = await this.enumerate({});
    const c = candidates.find(x => x.id === evidenceIdValue);
    if (!c) return null;
    const item = await this.materialize(c, new Date(this.now()).toISOString());
    let tail: EvidenceTail | null = null, tailWithheld: string | null = null;
    if (c.tail) {
      if (item.verification.status === "VERIFIED" || item.verification.status === "UNVERIFIABLE") { try { tail = await c.tail(); } catch { tailWithheld = "TAIL_UNREADABLE"; } }
      else tailWithheld = `VERIFICATION_${item.verification.status}`;
    }
    return {item, summary: this.scrubValue(c.summary) as Record<string, unknown>, tail, tailWithheld};
  }

  async summary(): Promise<EvidenceSummary> {
    const {candidates, sources} = await this.enumerate({});
    const queried = (Object.values(sources) as SourceState[]).filter(s => s !== "NOT_QUERIED");
    const none = {total: null, verified: null, mismatch: null, missing: null, unverifiable: null};
    if (queried.includes("ERROR")) return {state: "ERROR", ...none, sources};
    if (!queried.includes("AVAILABLE")) return {state: "UNAVAILABLE", ...none, sources};
    const checkedAt = new Date(this.now()).toISOString();
    const n = {VERIFIED: 0, MISMATCH: 0, MISSING: 0, UNVERIFIABLE: 0};
    for (const c of candidates) n[(await this.materialize(c, checkedAt)).verification.status] += 1;
    return {state: "VERIFIED", total: candidates.length, verified: n.VERIFIED, mismatch: n.MISMATCH, missing: n.MISSING, unverifiable: n.UNVERIFIABLE, sources};
  }

  // ---- iç yardımcılar ----
  private decodeCursor(cursor: string): string {
    if (!/^[A-Za-z0-9_-]{1,1500}$/.test(cursor)) throw new EvidenceInputError("INVALID_CURSOR");
    const s = Buffer.from(cursor, "base64url").toString("utf8");
    if (s.length === 0 || !s.includes("\u0001") || s.includes("\uFFFD")) throw new EvidenceInputError("INVALID_CURSOR");
    return s;
  }
  private async materialize(c: Candidate, checkedAt: string): Promise<EvidenceItem> {
    let out: Outcome;
    try { out = await c.verify(); } catch { out = {sha256: null, sizeBytes: null, status: "UNVERIFIABLE", basis: "NONE", reason: "VERIFY_ERROR"}; }
    return {
      evidenceId: c.id, kind: c.kind, source: {path: c.sourcePath, sha256: out.sha256, sizeBytes: out.sizeBytes, locator: c.locator},
      commit: c.commit, createdAt: c.createdAt, scope: c.scope, verification: {status: out.status, checkedAt, basis: out.basis, reason: out.reason}
    };
  }
  private key(kind: EvidenceKind, p: string | null, loc: string | null, id: string): string { return [kind, p ?? "", loc ?? "", id].join("\u0001"); }

  private async enumerate(q: EvidenceQuery): Promise<{candidates: Candidate[]; sources: Record<SourceName, SourceState>}> {
    const sources: Record<SourceName, SourceState> = {workos: "NOT_QUERIED", review: "NOT_QUERIED", checkpoints: "NOT_QUERIED"};
    const candidates: Candidate[] = [];
    const want = (k: EvidenceKind) => q.kind === undefined || q.kind === k;
    const scoped = q.missionId !== undefined || q.runId !== undefined;
    if (want("WORK_RUN_STEP") || want("WORK_RUN_LOG")) {
      try { const r = await this.enumWorkOs(q); sources.workos = r.state; candidates.push(...r.candidates); } catch { sources.workos = "ERROR"; }
    }
    if (this.o.includeRepositoryEvidence && !scoped) {
      if (want("REVIEW_EVIDENCE")) { try { const r = await this.enumReview(); sources.review = r.state; candidates.push(...r.candidates); } catch { sources.review = "ERROR"; } }
      if (want("AUDIT_CHECKPOINT")) { try { const r = this.enumCheckpoints(); sources.checkpoints = r.state; candidates.push(...r.candidates); } catch { sources.checkpoints = "ERROR"; } }
    }
    return {candidates, sources};
  }

  // (a) Work OS: tenant kapsamlı run kanıtı/checkpoint girdileri ve kanıt log dosyaları.
  private async enumWorkOs(q: EvidenceQuery): Promise<{state: SourceState; candidates: Candidate[]}> {
    const dataReal = this.dataReal;
    if (dataReal === null || !fs.existsSync(path.join(dataReal, JOURNAL))) return {state: "UNAVAILABLE", candidates: []};
    const store = this.o.store();
    if (store.isTampered || store.isUnavailable) return {state: "ERROR", candidates: []};
    const runs = new Map<string, WorkRun>();
    for (const r of store.listRuns(this.o.scope, q.missionId)) if (q.runId === undefined || r.runId === q.runId) runs.set(r.runId, r);
    const out: Candidate[] = [];
    const scopeOf = (r: WorkRun): EvidenceScope => ({tenantId: r.tenantId, projectId: r.projectId, missionId: r.missionId, runId: r.runId});
    if (q.kind === undefined || q.kind === "WORK_RUN_LOG") {
      for (const r of runs.values()) {
        for (const e of r.evidence) {
          if (e.logPath === null) continue;
          out.push(this.logCandidate(dataReal, r, e.evidenceId, e.logPath, e.logSha256, e.commitSha ?? null, isoOrNull(e.endedAt), e.kind));
        }
      }
    }
    if (q.kind === undefined || q.kind === "WORK_RUN_STEP") {
      const rl = readline.createInterface({input: fs.createReadStream(path.join(dataReal, JOURNAL), {encoding: "utf8"}), crlfDelay: Infinity});
      for await (const line of rl) {
        if (line.length === 0 || line.length > 4 * 1024 * 1024) continue;
        let e: unknown;
        try { e = JSON.parse(line); } catch { continue; }
        if (!isObj(e) || (e.type !== "RUN_EVIDENCE" && e.type !== "RUN_CHECKPOINT") || !isObj(e.payload) || typeof e.payload.runId !== "string") continue;
        const run = runs.get(e.payload.runId);
        if (!run || typeof e.hash !== "string" || !Number.isSafeInteger(e.seq)) continue;
        const seq = e.seq as number, rec = e.hash, type = e.type, p = e.payload;
        const loc = `seq:${seq}`;
        const id = evidenceId(["WORK_RUN_STEP", JOURNAL, loc, rec]);
        const ev = isObj(p.evidence) ? p.evidence : null, cp = isObj(p.checkpoint) ? p.checkpoint : null;
        const summary: Record<string, unknown> = type === "RUN_EVIDENCE" && ev
          ? {entryType: type, step: ev.step, cycle: ev.cycle, evidenceKind: ev.kind, exitCode: ev.exitCode ?? null, verdict: ev.verdict ?? null, hasLog: ev.logPath != null}
          : {entryType: type, step: cp?.step ?? null, cycle: cp?.cycle ?? null};
        const commit = ev && typeof ev.commitSha === "string" && HEX40.test(ev.commitSha) ? ev.commitSha : null;
        const created = isoOrNull(e.at);
        out.push({
          id, kind: "WORK_RUN_STEP", sortKey: this.key("WORK_RUN_STEP", JOURNAL, `seq:${String(seq).padStart(12, "0")}`, id), sourcePath: JOURNAL, locator: loc, commit, createdAt: created,
          scope: scopeOf(run), summary,
          verify: async () => {
            const bytes = Buffer.from(line, "utf8");
            let ok = false;
            try { const parsed = JSON.parse(line) as Record<string, unknown>; const {hash, ...body} = parsed; ok = hash === rec && canonicalSha256(body) === rec; } catch { ok = false; }
            return {sha256: crypto.createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, status: ok ? "VERIFIED" : "MISMATCH", basis: "JOURNAL_ENTRY_HASH", reason: ok ? null : "JOURNAL_ENTRY_HASH_MISMATCH"};
          }
        });
      }
    }
    return {state: "AVAILABLE", candidates: out};
  }

  private logCandidate(dataReal: string, run: WorkRun, storeEvidenceId: string, logPath: string, recorded: string | null, commit: string | null, createdAt: string | null, evKind: string): Candidate {
    const prefix = `runs/${run.runId}/`;
    const pre = resolveUnder(dataReal, logPath, prefix);
    const safePath = pre.ok || pre.code === "MISSING" ? logPath : null;
    const id = evidenceId(["WORK_RUN_LOG", safePath ?? "REJECTED", storeEvidenceId, recorded]);
    return {
      id, kind: "WORK_RUN_LOG", sortKey: this.key("WORK_RUN_LOG", safePath, null, id), sourcePath: safePath, locator: null, commit: commit && HEX40.test(commit) ? commit : null, createdAt,
      scope: {tenantId: run.tenantId, projectId: run.projectId, missionId: run.missionId, runId: run.runId},
      summary: {evidenceKind: evKind, recordedHashPresent: recorded !== null},
      verify: async () => {
        const r = resolveUnder(dataReal, logPath, prefix);
        if (!r.ok) return r.code === "MISSING" ? {sha256: null, sizeBytes: null, status: "MISSING", basis: "LOG_SHA256", reason: "FILE_MISSING"}
          : {sha256: null, sizeBytes: null, status: "UNVERIFIABLE", basis: "LOG_SHA256", reason: r.code === "REJECTED" ? "PATH_REJECTED" : "READ_ERROR"};
        const h = await hashFile(r.real, this.maxHash);
        if (h.over) return {sha256: null, sizeBytes: r.size, status: "UNVERIFIABLE", basis: "LOG_SHA256", reason: "FILE_TOO_LARGE_TO_HASH"};
        if (h.changed) return {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis: "LOG_SHA256", reason: "FILE_CHANGED_DURING_READ"};
        if (recorded === null) return {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis: "LOG_SHA256", reason: "NO_RECORDED_HASH"};
        const ok = h.sha256 === recorded;
        return {sha256: h.sha256, sizeBytes: h.bytes, status: ok ? "VERIFIED" : "MISMATCH", basis: "LOG_SHA256", reason: ok ? null : "RECOMPUTED_HASH_DIFFERS_FROM_RECORDED"};
      },
      tail: async () => {
        const r = resolveUnder(dataReal, logPath, prefix);
        return r.ok ? this.readTail(r.real) : null;
      }
    };
  }

  private async readTail(real: string): Promise<EvidenceTail> {
    const fh = await fs.promises.open(real, "r");
    try {
      const st = await fh.stat();
      const want = Math.min(st.size, TAIL_BYTES + TAIL_LOOKBACK), start = st.size - want;
      const buf = Buffer.alloc(want);
      let got = 0;
      while (got < want) { const {bytesRead} = await fh.read(buf, got, want - got, start + got); if (bytesRead === 0) break; got += bytesRead; }
      // Önce redaksiyon, sonra son 4 KB: sınırda kesilen token'ın görünür kalan parçası lookback ile tam eşleşir.
      // Pencere dosyanın ortasında başlıyorsa ilk (yarım) satır atılır: maskeleme metni kısalttığında pencere başı çıktıya girer ve yarım bir yol
      // ("sers\<kullanıcı>\...") hiçbir kalıba uymaz. Satır sonu yoksa pencerenin tamamı yarım satırdır ve kuyruk boş döner (truncated: true).
      // Maskeleme metni uzatabilir ("/root" -> "<USER_PATH>"); son 4 KB kesimi de satır başına hizalanır ve kesim truncated olarak bildirilir.
      let raw: Buffer = buf.subarray(0, got);
      if (start > 0) raw = afterFirstBreak(raw);
      let out: Buffer = Buffer.from(this.scrub(raw.toString("utf8")), "utf8");
      const cut = out.length > TAIL_BYTES;
      if (cut) out = afterFirstBreak(out.subarray(out.length - TAIL_BYTES));
      return {text: out.toString("utf8").replace(/^\uFFFD+/, ""), truncated: start > 0 || got > TAIL_BYTES || cut, redacted: true};
    } finally { await fh.close(); }
  }
  // Mevcut secret redaksiyonuna ek olarak bilinen kök yolları ve kullanıcı dizini yolları maskelenir (API gövdesinde mutlak yol olmaz).
  private scrub(text: string): string {
    let s = redactSecrets(text);
    for (const m of this.pathMasks) s = s.replace(m.re, m.tag);
    for (const re of USER_DIR_PATTERNS) s = s.replace(re, "<USER_PATH>");
    return s;
  }
  // Özet değerleri de journal/dosya içeriğinden gelir (step, kind, verdict, reviewerIdentity): metinleri aynı redaksiyondan geçer; aşırı derin yapı null olur.
  private scrubValue(v: unknown, depth = 0): unknown {
    if (typeof v === "string") return this.scrub(v);
    if (v === null || typeof v !== "object") return v;
    if (depth >= 8) return null;
    if (Array.isArray(v)) return v.map(x => this.scrubValue(x, depth + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.scrubValue(x, depth + 1)]));
  }

  // (b) Orchestrator review evidence: config/orchestrator-policy.json stateFile dizini + "evidence".
  private reviewDir(): {rel: string; real: string} | "UNAVAILABLE" {
    const policyFile = path.join(this.repoReal, "config", "orchestrator-policy.json");
    if (!fs.existsSync(policyFile)) return "UNAVAILABLE";
    const pr = resolveUnder(this.repoReal, "config/orchestrator-policy.json");
    if (!pr.ok || pr.size > 1024 * 1024) throw new Error("POLICY_REJECTED");
    const policy = JSON.parse(fs.readFileSync(pr.real, "utf8")) as unknown;
    const sf = isObj(policy) && isObj(policy.roots) ? policy.roots.stateFile : undefined;
    if (typeof sf !== "string" || sf.length > 512 || /\$\{(?!REPO\})/.test(sf)) throw new Error("POLICY_STATE_FILE_INVALID");
    const abs = path.resolve(sf.split("${REPO}").join(this.repoReal));
    if (!underRoot(this.repoReal, abs) || abs === this.repoReal) throw new Error("POLICY_STATE_FILE_OUTSIDE_REPO");
    const dir = path.join(path.dirname(abs), "evidence");
    if (!fs.existsSync(dir)) return "UNAVAILABLE";
    const real = fs.realpathSync(dir);
    if (!underRoot(this.repoReal, real) || !fs.statSync(real).isDirectory()) throw new Error("REVIEW_DIR_REJECTED");
    return {rel: posix(path.relative(this.repoReal, dir)), real};
  }
  private async enumReview(): Promise<{state: SourceState; candidates: Candidate[]}> {
    const d = this.reviewDir();
    if (d === "UNAVAILABLE") return {state: "UNAVAILABLE", candidates: []};
    const names = fs.readdirSync(d.real).filter(n => SAFE_FILE_NAME.test(n)).sort().slice(0, MAX_DIR_ENTRIES);
    const out: Candidate[] = [];
    for (const name of names) {
      const rel = `${d.rel}/${name}`, r = resolveUnder(d.real, name);
      let outcome: Outcome, recorded: string | null = null, commit: string | null = null, createdAt: string | null = null, summary: Record<string, unknown> = {};
      const basis = "REVIEW_RESULT_SHA256";
      if (!r.ok) outcome = {sha256: null, sizeBytes: null, status: r.code === "MISSING" ? "MISSING" : "UNVERIFIABLE", basis, reason: r.code === "MISSING" ? "FILE_MISSING" : r.code === "REJECTED" ? "PATH_REJECTED" : "READ_ERROR"};
      else {
        try {
          const h = await hashFile(r.real, this.maxHash, r.size <= this.maxJson);
          if (h.over) outcome = {sha256: null, sizeBytes: r.size, status: "UNVERIFIABLE", basis, reason: "FILE_TOO_LARGE_TO_HASH"};
          else if (h.data === null) outcome = {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "FILE_TOO_LARGE_TO_PARSE"};
          else {
            let rec: unknown = null;
            try { rec = JSON.parse(h.data.toString("utf8")); } catch { rec = null; }
            if (!isObj(rec)) outcome = {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "UNPARSEABLE_RECORD"};
            else {
              recorded = typeof rec.reviewResultSha256 === "string" ? rec.reviewResultSha256 : null;
              commit = typeof rec.reviewedCommit === "string" && HEX40.test(rec.reviewedCommit) ? rec.reviewedCommit : null;
              const m = isObj(rec.runManifest) ? rec.runManifest : {};
              createdAt = isoOrNull(m.startedAt) ?? isoOrNull(m.createdAt) ?? isoOrNull(m.finishedAt);
              // Önce redaksiyon (girdinin ilk 4096 karakteri), sonra 80 karakter: kesilmiş yarım bir yol kalıplardan kaçamaz.
              summary = {reviewerIdentity: typeof rec.reviewerIdentity === "string" ? this.scrub(rec.reviewerIdentity.slice(0, 4096)).slice(0, 80) : null, cycle: Number.isSafeInteger(rec.cycle) ? rec.cycle : null, recordedHashPresent: recorded !== null};
              const fb = isObj(rec.frozenBundle) ? rec.frozenBundle : null;
              const bundleOk = fb === null || typeof rec.bundleDigest !== "string" || fb.bundleDigest === rec.bundleDigest;
              if (recorded === null || typeof rec.reviewResultText !== "string") outcome = {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "NO_RECORDED_HASH"};
              else {
                const ok = crypto.createHash("sha256").update(Buffer.from(rec.reviewResultText, "utf8")).digest("hex") === recorded && bundleOk;
                outcome = {sha256: h.sha256, sizeBytes: h.bytes, status: ok ? "VERIFIED" : "MISMATCH", basis, reason: ok ? null : bundleOk ? "RECOMPUTED_HASH_DIFFERS_FROM_RECORDED" : "BUNDLE_DIGEST_MISMATCH"};
              }
            }
          }
        } catch { outcome = {sha256: null, sizeBytes: null, status: "UNVERIFIABLE", basis, reason: "READ_ERROR"}; }
      }
      const id = evidenceId(["REVIEW_EVIDENCE", rel, null, recorded]), fixed = outcome;
      out.push({id, kind: "REVIEW_EVIDENCE", sortKey: this.key("REVIEW_EVIDENCE", rel, null, id), sourcePath: rel, locator: null, commit, createdAt, scope: noScope, summary, verify: async () => fixed});
    }
    return {state: "AVAILABLE", candidates: out};
  }

  // (c) Depo audit checkpoint'leri: kayıtlı hash git HEAD blob id'sidir; çalışma ağacı baytlarından yeniden hesaplanır.
  private gitInfo(): GitInfo {
    const bad: GitInfo = {ok: false, blobs: new Map(), last: new Map()};
    try {
      const top = spawnGitSync(this.repoReal, ["rev-parse", "--show-prefix"], {timeout: 15_000});
      if (top.status !== 0 || String(top.stdout).trim() !== "") return bad;
      const tree = spawnGitSync(this.repoReal, ["ls-tree", "-r", "-z", "HEAD", "--", "audit/checkpoints"], {timeout: 30_000, maxBuffer: 32 * 1024 * 1024});
      if (tree.status !== 0) return bad;
      const blobs = new Map<string, string>();
      for (const rec of String(tree.stdout).split("\0")) {
        const m = /^\d+ blob ([0-9a-f]{40})\t(audit\/checkpoints\/[^/]+)$/.exec(rec);
        if (m) blobs.set(m[2], m[1]);
      }
      const log = spawnGitSync(this.repoReal, ["-c", "core.quotepath=false", "log", "--format=@%H %cI", "--name-only", "--", "audit/checkpoints"], {timeout: 60_000, maxBuffer: 64 * 1024 * 1024});
      const last = new Map<string, {commit: string; at: string | null}>();
      if (log.status === 0) {
        let cur: {commit: string; at: string | null} | null = null;
        for (const ln of String(log.stdout).split("\n")) {
          const h = /^@([0-9a-f]{40}) (\S+)$/.exec(ln.trim());
          if (h) { cur = {commit: h[1], at: isoOrNull(h[2])}; continue; }
          const f = ln.trim();
          if (cur && f.startsWith("audit/checkpoints/") && !last.has(f)) last.set(f, cur);
        }
      }
      return {ok: true, blobs, last};
    } catch { return bad; }
  }
  private enumCheckpoints(): {state: SourceState; candidates: Candidate[]} {
    const dir = path.join(this.repoReal, "audit", "checkpoints");
    const git = this.gitInfo();
    let names: string[] = [];
    if (fs.existsSync(dir)) {
      const real = fs.realpathSync(dir);
      if (!underRoot(this.repoReal, real) || !fs.statSync(real).isDirectory()) throw new Error("CHECKPOINT_DIR_REJECTED");
      names = fs.readdirSync(real).filter(n => SAFE_FILE_NAME.test(n));
    }
    const rels = new Set<string>(names.map(n => `audit/checkpoints/${n}`));
    for (const t of git.blobs.keys()) if (SAFE_FILE_NAME.test(t.slice("audit/checkpoints/".length))) rels.add(t);
    if (rels.size === 0 && !fs.existsSync(dir)) return {state: "UNAVAILABLE", candidates: []};
    const basis = "GIT_BLOB_ID";
    const out: Candidate[] = [];
    for (const rel of [...rels].sort().slice(0, MAX_DIR_ENTRIES)) {
      const recorded = git.ok ? git.blobs.get(rel) ?? null : null, info = git.ok ? git.last.get(rel) ?? null : null;
      const id = evidenceId(["AUDIT_CHECKPOINT", rel, null, recorded]);
      out.push({
        id, kind: "AUDIT_CHECKPOINT", sortKey: this.key("AUDIT_CHECKPOINT", rel, null, id), sourcePath: rel, locator: null, commit: info?.commit ?? null, createdAt: info?.at ?? null, scope: noScope,
        summary: {tracked: recorded !== null, gitAvailable: git.ok},
        verify: async () => {
          const r = resolveUnder(this.repoReal, rel);
          if (!r.ok) {
            if (r.code === "MISSING") return recorded !== null ? {sha256: null, sizeBytes: null, status: "MISSING", basis, reason: "FILE_MISSING"} : {sha256: null, sizeBytes: null, status: "UNVERIFIABLE", basis, reason: "FILE_MISSING_NOT_COMMITTED"};
            return {sha256: null, sizeBytes: null, status: "UNVERIFIABLE", basis, reason: r.code === "REJECTED" ? "PATH_REJECTED" : "READ_ERROR"};
          }
          const h = await hashFile(r.real, this.maxHash);
          if (h.over) return {sha256: null, sizeBytes: r.size, status: "UNVERIFIABLE", basis, reason: "FILE_TOO_LARGE_TO_HASH"};
          if (h.changed) return {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "FILE_CHANGED_DURING_READ"};
          if (!git.ok) return {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "GIT_UNAVAILABLE"};
          if (recorded === null) return {sha256: h.sha256, sizeBytes: h.bytes, status: "UNVERIFIABLE", basis, reason: "NOT_COMMITTED"};
          const ok = h.gitBlob === recorded;
          return {sha256: h.sha256, sizeBytes: h.bytes, status: ok ? "VERIFIED" : "MISMATCH", basis, reason: ok ? null : "WORKING_TREE_DIFFERS_FROM_HEAD"};
        }
      });
    }
    return {state: "AVAILABLE", candidates: out};
  }
}
