// //TR: Bu dosya SC-14 Proje Belleği çekirdeğini uygular: proje başına append-only, sha256 hash zincirli JSONL kayıt (karar/olgu/kaynak/revizyon/not); doğrulama tamper/sıra bozulması/yırtık kuyruğu yalnız raporlar (onarmaz), yazılar path-guard ve secret-scan ile fail-closed'dır. API'ye bağlı değildir.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// //TR: automation/lib korumalı olduğundan atomic-json.mjs için .d.mts eklenemez; store.ts ile aynı kanonik sha256 helper'ı dar bir yerel tiple yeniden kullanılır, kopyalanmaz.
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok
import {sha256 as sha256Untyped} from "../../automation/lib/atomic-json.mjs";
import {acquireProcessLock} from "../../automation/lib/process-lock.mjs";
import {canonicalPath, underKey} from "../workos/path-guard.js";
import {findSecretKinds} from "../workos/secret-scan.js";
import {MEMORY_KINDS, MEMORY_LIMITS, PROJECT_ID_RE, ProjectMemoryError} from "./project-memory-types.js";
import type {AppendMemoryInput, CurrentViewEntry, MemoryAuthor, MemoryHealth, MemoryKind, MemoryRecord, MemorySource, Provenance} from "./project-memory-types.js";

const sha256 = sha256Untyped as (value: unknown) => string;
const GENESIS = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const memId = (seq: number) => `mem_${String(seq).padStart(6, "0")}`;
const recordHash = (body: Omit<MemoryRecord, "hash">): string => sha256(body);
const invalid = (d: string) => new ProjectMemoryError("MEMORY_INVALID_INPUT", d);
const limit = (d: string) => new ProjectMemoryError("MEMORY_LIMIT_EXCEEDED", d);

export interface ProjectMemoryOptions { rootDir: string; projectId: string; now?: () => Date }

interface Loaded { health: MemoryHealth; records: MemoryRecord[] }

function validIso(v: unknown): v is string { return isStr(v) && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)); }

function checkAuthor(a: unknown): MemoryAuthor {
  if (!isObj(a) || !isStr(a.role) || !/^[A-Za-z0-9_.:-]{1,64}$/.test(a.role)) throw invalid("AUTHOR_ROLE");
  if (a.sessionId !== undefined && (!isStr(a.sessionId) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(a.sessionId))) throw invalid("AUTHOR_SESSION_ID");
  return a.sessionId === undefined ? {role: a.role} : {role: a.role, sessionId: a.sessionId};
}

function checkSources(s: unknown): MemorySource[] {
  if (s === undefined) return [];
  if (!Array.isArray(s)) throw invalid("SOURCES_NOT_ARRAY");
  if (s.length > MEMORY_LIMITS.sources) throw limit("SOURCES_COUNT");
  return s.map((x, i) => {
    if (!isObj(x) || !isStr(x.ref) || !x.ref.trim() || /[\u0000\r\n]/.test(x.ref)) throw invalid(`SOURCE_REF:${i}`);
    if (x.ref.length > MEMORY_LIMITS.refChars) throw limit(`SOURCE_REF_LENGTH:${i}`);
    if (x.sha256 !== undefined && (!isStr(x.sha256) || !HEX64.test(x.sha256))) throw invalid(`SOURCE_SHA256:${i}`);
    if (!validIso(x.retrievedAt)) throw invalid(`SOURCE_RETRIEVED_AT:${i}`);
    return x.sha256 === undefined ? {ref: x.ref, retrievedAt: x.retrievedAt} : {ref: x.ref, sha256: x.sha256, retrievedAt: x.retrievedAt};
  });
}

function checkTags(t: unknown): string[] {
  if (t === undefined) return [];
  if (!Array.isArray(t)) throw invalid("TAGS_NOT_ARRAY");
  if (t.length > MEMORY_LIMITS.tags) throw limit("TAGS_COUNT");
  for (const [i, x] of t.entries()) if (!isStr(x) || !TAG_RE.test(x)) throw invalid(`TAG:${i}`);
  return [...new Set(t as string[])];
}

// Supersession zinciri doğrusal tutulur: hedef var olmalı ve henüz başka bir kayıtça geçersiz kılınmamış olmalıdır.
function supersessionError(records: MemoryRecord[], target: string): "MEMORY_SUPERSEDES_MISSING" | "MEMORY_SUPERSEDES_NOT_HEAD" | null {
  if (!records.some(r => r.id === target)) return "MEMORY_SUPERSEDES_MISSING";
  if (records.some(r => r.supersedes === target)) return "MEMORY_SUPERSEDES_NOT_HEAD";
  return null;
}

export class ProjectMemory {
  readonly projectId: string;
  readonly journalFile: string;
  private readonly rootKey: string;
  private readonly lockFile: string;
  private readonly now: () => Date;

  constructor(opts: ProjectMemoryOptions) {
    if (!isObj(opts)) throw invalid("OPTIONS");
    if (!isStr(opts.projectId) || !PROJECT_ID_RE.test(opts.projectId)) throw new ProjectMemoryError("MEMORY_INVALID_PROJECT_ID", "PROJECT_ID_PATTERN");
    const root = canonicalPath(opts.rootDir);
    if (!root.ok) throw new ProjectMemoryError("MEMORY_PATH_REJECTED", root.reason);
    this.projectId = opts.projectId;
    this.rootKey = root.key;
    this.now = opts.now ?? (() => new Date());
    this.journalFile = this.insideRoot(path.join(root.path, "projects", opts.projectId, "memory", "journal.jsonl"));
    this.lockFile = this.insideRoot(path.join(root.path, "projects", opts.projectId, "memory", "journal.lock"));
  }

  // Yol kökün kanonik biçiminin altında çözülmelidir (symlink/junction ile dışarı kaçış dahil); değilse fail-closed.
  private insideRoot(p: string): string {
    const c = canonicalPath(p);
    if (!c.ok) throw new ProjectMemoryError("MEMORY_PATH_REJECTED", c.reason);
    if (!underKey(this.rootKey, c.key)) throw new ProjectMemoryError("MEMORY_PATH_REJECTED", "PATH_OUTSIDE_ROOT");
    return c.path;
  }

  private load(): Loaded {
    const health = (state: MemoryHealth["state"], reason: string | null, records: MemoryRecord[], torn = 0): Loaded => {
      const last = records[records.length - 1];
      return {health: {state, reason, records: records.length, lastSeq: last?.seq ?? 0, lastHash: last?.hash ?? GENESIS, tornTailBytes: torn}, records};
    };
    this.insideRoot(this.journalFile);
    if (!fs.existsSync(this.journalFile)) return health("ABSENT", null, []);
    const buf = fs.readFileSync(this.journalFile);
    const cut = buf.length > 0 && buf[buf.length - 1] !== 0x0a ? buf.lastIndexOf(0x0a) + 1 : buf.length;
    const lines = buf.subarray(0, cut).toString("utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const out: MemoryRecord[] = [];
    let prev = {seq: 0, hash: GENESIS};
    for (const line of lines) {
      const n = prev.seq + 1;
      let r: MemoryRecord;
      try { r = JSON.parse(line) as MemoryRecord; } catch { return health("TAMPERED", `LINE_NOT_JSON:${n}`, out); }
      if (!isObj(r) || !isStr(r.hash)) return health("TAMPERED", `RECORD_SHAPE:${n}`, out);
      const {hash, ...body} = r;
      if (recordHash(body) !== hash) return health("TAMPERED", `HASH_MISMATCH:${n}`, out);
      if (r.seq !== n) return health("TAMPERED", `SEQUENCE_BROKEN:${n}`, out);
      if (r.prevHash !== prev.hash) return health("TAMPERED", `CHAIN_BROKEN:${n}`, out);
      if (r.id !== memId(n) || r.projectId !== this.projectId || !(MEMORY_KINDS as readonly string[]).includes(r.kind)) return health("TAMPERED", `RECORD_FIELDS:${n}`, out);
      if (r.supersedes !== undefined && supersessionError(out, r.supersedes)) return health("TAMPERED", `SUPERSEDES_INVALID:${n}`, out);
      out.push(r); prev = {seq: r.seq, hash: r.hash};
    }
    if (cut === buf.length) return health("OK", null, out);
    // Yırtık kuyruk yalnız zincirin beklenen sonraki kaydının baş baytlarıysa TORN_TAIL'dır; aksi yabancı veridir.
    const tail = buf.subarray(cut), expected = Buffer.from(`{"seq":${prev.seq + 1},"id":"${memId(prev.seq + 1)}",`, "utf8");
    const k = Math.min(tail.length, expected.length);
    if (!tail.subarray(0, k).equals(expected.subarray(0, k))) return health("TAMPERED", "TRAILING_GARBAGE", out);
    return health("TORN_TAIL", `TORN_TAIL:${prev.seq + 1}`, out, tail.length);
  }

  // Okumalar: TAMPERED fail-closed; TORN_TAIL'de doğrulanmış önek okunur (yazı reddedilir).
  private readable(): MemoryRecord[] {
    const l = this.load();
    if (l.health.state === "TAMPERED") throw new ProjectMemoryError("MEMORY_TAMPERED", l.health.reason ?? "TAMPERED");
    return l.records;
  }

  verify(): MemoryHealth { return this.load().health; }

  append(input: AppendMemoryInput): MemoryRecord {
    if (!isObj(input)) throw invalid("INPUT");
    if (!isStr(input.kind) || !(MEMORY_KINDS as readonly string[]).includes(input.kind)) throw invalid("UNKNOWN_KIND");
    if (!isStr(input.title) || !input.title.trim() || /[\u0000\r\n]/.test(input.title)) throw invalid("TITLE");
    if ([...input.title].length > MEMORY_LIMITS.titleChars) throw limit("TITLE_LENGTH");
    if (!isStr(input.body) || input.body.includes("\u0000")) throw invalid("BODY");
    if (Buffer.byteLength(input.body, "utf8") > MEMORY_LIMITS.bodyBytes) throw limit("BODY_BYTES");
    const sources = checkSources(input.sources), tags = checkTags(input.tags), author = checkAuthor(input.author);
    if (input.supersedes !== undefined && !isStr(input.supersedes)) throw invalid("SUPERSEDES");
    const secretKinds = new Set([input.title, input.body, ...sources.map(s => s.ref), ...tags, author.sessionId ?? ""].flatMap(findSecretKinds));
    if (secretKinds.size) throw new ProjectMemoryError("MEMORY_SECRET_REJECTED", [...secretKinds].sort().join(","));
    const at = this.now().toISOString();
    return this.withLock(() => {
      const l = this.load();
      if (l.health.state === "TAMPERED") throw new ProjectMemoryError("MEMORY_TAMPERED", l.health.reason ?? "TAMPERED");
      if (l.health.state === "TORN_TAIL") throw new ProjectMemoryError("MEMORY_READ_ONLY", l.health.reason ?? "TORN_TAIL");
      if (input.supersedes !== undefined) {
        const err = supersessionError(l.records, input.supersedes);
        if (err) throw new ProjectMemoryError(err, input.supersedes);
      }
      const seq = l.health.lastSeq + 1;
      const body: Omit<MemoryRecord, "hash"> = {
        seq, id: memId(seq), at, kind: input.kind as MemoryKind, projectId: this.projectId, title: input.title, body: input.body, sources,
        ...(input.supersedes !== undefined ? {supersedes: input.supersedes} : {}), tags, author, prevHash: l.health.lastHash
      };
      const record: MemoryRecord = {...body, hash: recordHash(body)};
      this.appendLine(Buffer.from(JSON.stringify(record) + "\n", "utf8"));
      return record;
    });
  }

  // Kısa/başarısız yazıda dosya yazı öncesi boyuta geri kesilir; geri kesme de başarısızsa sonraki verify TORN_TAIL raporlar.
  private appendLine(line: Buffer): void {
    const fd = fs.openSync(this.journalFile, "a");
    let size = 0;
    try {
      size = fs.fstatSync(fd).size;
      const n = fs.writeSync(fd, line);
      if (n !== line.length) throw new Error("SHORT_WRITE");
      fs.fsyncSync(fd);
    } catch (e) {
      try { const rfd = fs.openSync(this.journalFile, "r+"); try { fs.ftruncateSync(rfd, size); } finally { fs.closeSync(rfd); } } catch { /* verify ayrımı yapar */ }
      throw e;
    } finally { fs.closeSync(fd); }
  }

  private withLock<T>(fn: () => T): T {
    fs.mkdirSync(path.dirname(this.journalFile), {recursive: true});
    this.insideRoot(this.journalFile);
    let release: () => void;
    try { release = acquireProcessLock(this.lockFile, `memory-${process.pid}-${crypto.randomBytes(4).toString("hex")}`); }
    catch { throw new ProjectMemoryError("MEMORY_BUSY", "LOCK_HELD"); }
    try { return fn(); } finally { try { release(); } catch { /* yazı tamamlandı */ } }
  }

  all(): MemoryRecord[] { return this.readable(); }

  get(id: string): MemoryRecord {
    const r = this.readable().find(x => x.id === id);
    if (!r) throw new ProjectMemoryError("MEMORY_NOT_FOUND", isStr(id) ? id.slice(0, 64) : "ID");
    return r;
  }

  list(filter: {kind?: MemoryKind; tag?: string} = {}): MemoryRecord[] {
    if (filter.kind !== undefined && !(MEMORY_KINDS as readonly string[]).includes(filter.kind)) throw invalid("UNKNOWN_KIND");
    return this.readable().filter(r => (filter.kind === undefined || r.kind === filter.kind) && (filter.tag === undefined || r.tags.includes(filter.tag)));
  }

  // Büyük/küçük harfe duyarsız düz metin eşleşmesi (başlık, gövde, etiketler); regex yorumlanmaz.
  search(text: string): MemoryRecord[] {
    if (!isStr(text) || !text.trim()) throw invalid("SEARCH_TEXT");
    const needle = text.toLowerCase();
    return this.readable().filter(r => r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle) || r.tags.some(t => t.toLowerCase().includes(needle)));
  }

  // Her supersession zinciri için en son revizyon (head) ve kökten head'e kimlik geçmişi.
  currentView(): CurrentViewEntry[] {
    const records = this.readable();
    const byId = new Map(records.map(r => [r.id, r]));
    const superseded = new Set(records.flatMap(r => r.supersedes ? [r.supersedes] : []));
    return records.filter(r => !superseded.has(r.id)).map(head => {
      const history: string[] = [];
      for (let c: MemoryRecord | undefined = head; c; c = c.supersedes ? byId.get(c.supersedes) : undefined) history.unshift(c.id);
      return {head, history};
    });
  }

  provenance(id: string): Provenance {
    const records = this.readable();
    const byId = new Map(records.map(r => [r.id, r]));
    const start = byId.get(id);
    if (!start) throw new ProjectMemoryError("MEMORY_NOT_FOUND", isStr(id) ? id.slice(0, 64) : "ID");
    const lineage = [];
    for (let c: MemoryRecord | undefined = start; c; c = c.supersedes ? byId.get(c.supersedes) : undefined)
      lineage.unshift({id: c.id, seq: c.seq, at: c.at, kind: c.kind, author: c.author, sources: c.sources, hash: c.hash});
    const nextOf = new Map(records.flatMap(r => r.supersedes ? [[r.supersedes, r.id] as const] : []));
    let headId = start.id;
    while (nextOf.has(headId)) headId = nextOf.get(headId)!;
    return {id: start.id, currentHeadId: headId, lineage};
  }
}
