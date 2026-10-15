// //TR: Bu dosya Project Studio (PS-1A) arka ucudur: aynı Work OS proje kaydının üzerinde yönetilen depo (<dataDir>/projects/<id>/repo) kurar (şablon, yerel git klonu, güvenli ZIP), dosya/git okuma görünümlerini (yol/symlink kaçışına kapalı, secret redaksiyonlu, sınırlı) ve teslim paketi export'unu (git archive + README + raporlar, önce secret taraması) sağlar. İkinci bir store yoktur; kayıtlar Work OS journal'ındadır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import type {DeliveryArtifactRecord, Project, ProjectExport, ProjectTemplate, RunEvidence, WorkRun} from "./types.js";
import {M1A_LABELS, deliveryArtifactPath, deliveryPrepareCheck, deliveryVerificationStatus, verificationStatus} from "./outcomes.js";
import {findSecretKinds, redactSecrets} from "./secret-scan.js";
import {renderTemplate} from "./project-templates.js";
import {DEFAULT_ZIP_LIMITS, ZipError, listZipEntries, readZipEntry, writeZip} from "./zip.js";
import type {ZipWriteEntry} from "./zip.js";
import type {ZipLimits} from "./zip.js";
import {canonicalPath, managedRepoCanonical, pathOverlapsDataDir} from "./path-guard.js";
import {agentConfigPattern} from "./agent-config-paths.js";
import type {AgentConfigPattern} from "./agent-config-paths.js";

// Sabit kodlu hata: yol, stack veya secret taşımaz; HTTP durumu route tarafından aynen kullanılır.
export class StudioError extends Error {
  constructor(readonly code: string, readonly status: number, readonly reason?: string, readonly details?: unknown) { super(code); this.name = "StudioError"; }
}
export const STUDIO_IDENTITY = {name: "UASCO Project Studio", email: "studio@local.invalid"} as const;
const PROJECT_ID = /^prj_[0-9a-f]{24}$/;
const SHA = /^[0-9a-f]{40}$/;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_LIST_ENTRIES = 1000;
export const MAX_DIFF_BYTES = 512 * 1024;
const EXPORT_LIMITS: ZipLimits = {maxArchiveBytes: 512 * 1024 * 1024, maxEntries: 200_000, maxFiles: 200_000, maxEntryBytes: 128 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024};
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const under = (root: string, p: string) => { const rel = path.relative(root, p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

export interface StudioOptions { dataDir: string; envPolicyFile: string; zipLimits?: Partial<ZipLimits>; gitTimeoutMs?: number }
// SBX-8: içe aktarmada yönetilen depo ağacından çıkarılan ajan yapılandırma dosyası (kanıt). İçerik <proje dizini>/quarantine/agent-config/<sha256> altında, özgün adı/uzantısı olmadan saklanır; hiçbir çalışma alanına girmez.
export interface QuarantinedAgentConfig { path: string; pattern: AgentConfigPattern; kind: "file" | "symlink" | "other"; bytes: number; sha256: string }
export interface ImportResult { headSha: string; agentConfigQuarantine: QuarantinedAgentConfig[] }
export const AGENT_CONFIG_QUARANTINE_COMMIT = "Quarantine agent configuration files (.claude/**, .mcp.json, .claude.json, CLAUDE.md, CLAUDE.local.md) [UASCO SBX-8]";
export interface FileEntry { name: string; type: "file" | "dir" | "symlink" | "other"; size: number | null }

export class ProjectStudio {
  readonly dataDir: string;
  private readonly zipLimits: ZipLimits;
  constructor(private readonly o: StudioOptions) {
    this.dataDir = path.resolve(o.dataDir);
    this.zipLimits = {...DEFAULT_ZIP_LIMITS, ...(o.zipLimits ?? {})};
  }

  projectDir(projectId: string): string {
    if (!PROJECT_ID.test(projectId)) throw new StudioError("INVALID_PROJECT_ID", 400);
    const root = path.join(this.dataDir, "projects"), dir = path.join(root, projectId);
    if (!under(root, dir)) throw new StudioError("INVALID_PROJECT_ID", 400);
    return dir;
  }
  managedRepoPath(projectId: string): string { return path.join(this.projectDir(projectId), "repo"); }
  exportsDir(): string { return path.join(this.dataDir, "exports"); }

  // Runner'ın taze klonlarıyla aynı nötrleştirilmiş git ortamı (izole global/system config, boş hooksPath, credential helper yok) + safeChildEnv.
  private env(extra: Record<string, string> = {}): NodeJS.ProcessEnv { return {...safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), ...extra}; }
  git(cwd: string, args: string[], extra: Record<string, string> = {}, maxBuffer = 64 * 1024 * 1024) {
    return spawnGitSync(cwd, args, {env: this.env(extra), maxBuffer, timeout: this.o.gitTimeoutMs ?? 10 * 60_000});
  }
  private gitOk(cwd: string, args: string[], extra: Record<string, string> = {}): string | null { const r = this.git(cwd, args, extra); return r.status === 0 ? String(r.stdout ?? "").trim() : null; }
  private commitAll(repo: string, message: string): string {
    const id = ["-c", `user.name=${STUDIO_IDENTITY.name}`, "-c", `user.email=${STUDIO_IDENTITY.email}`, "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];
    if (this.git(repo, ["-c", "core.autocrlf=false", "add", "-A"]).status !== 0) throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500);
    if (this.git(repo, [...id, "commit", "-q", "--no-verify", "--allow-empty", "-m", message]).status !== 0) throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500);
    const head = this.gitOk(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head || !SHA.test(head)) throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500);
    return head;
  }
  private initRepo(dir: string): void {
    if (this.git(dir, ["init", "-q", "-b", "main", "--template=", dir]).status !== 0) throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500);
  }

  // ---- PS-001/002: şablondan yönetilen depo ----
  // Store kilidi altında çağrılır (idempotency kontrolünden sonra): dizin yeni projectId için sıfırdan kurulur; hata olursa dizin silinir ve kayıt yazılmaz.
  createTemplateRepository(projectId: string, template: ProjectTemplate, projectName: string): {path: string; headSha: string; discard: () => void} {
    const dir = this.projectDir(projectId), repo = path.join(dir, "repo");
    if (fs.existsSync(dir)) throw new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500);
    const discard = () => fs.rmSync(dir, {recursive: true, force: true});
    try {
      fs.mkdirSync(repo, {recursive: true});
      for (const [rel, content] of Object.entries(renderTemplate(template, projectName).files)) {
        const f = path.join(repo, ...rel.split("/"));
        fs.mkdirSync(path.dirname(f), {recursive: true});
        fs.writeFileSync(f, content, {flag: "wx"});
      }
      this.initRepo(repo);
      const headSha = this.commitAll(repo, `Initial commit from template ${template}`);
      return {path: repo, headSha, discard};
    } catch (e) { try { discard(); } catch { /* en iyi çaba */ } throw e instanceof StudioError ? e : new StudioError("PROJECT_REPOSITORY_INIT_FAILED", 500); }
  }

  // ---- PS-003: içe aktarma (yalnız yerel kaynak) ----
  // Uzak URL, scp biçimi, UNC/ağ yolu, göreli yol ve veri dizini içindeki kaynaklar (başka projenin yönetilen deposu) reddedilir.
  // PS1A-C2-F1: içerme kararı kanonik yol (realpathSync.native: 8.3 kısa ad, junction/symlink açılır) üzerinden verilir; açılamayan kısa ad/UNC/aygıt yolu fail-closed reddedilir.
  private localSource(raw: string, kind: "git" | "zip"): string {
    if (typeof raw !== "string" || !raw || /[\u0000\r\n]/.test(raw)) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_PATH_INVALID");
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) || /^[^\\/]+@[^\\/]+:/.test(raw) || /::/.test(raw)) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_REMOTE_NOT_SUPPORTED");
    if (raw.startsWith("\\\\") || raw.startsWith("//")) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_REMOTE_NOT_SUPPORTED");
    if (!path.isAbsolute(raw)) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_PATH_NOT_ABSOLUTE");
    const c = canonicalPath(raw);
    if (!c.ok) throw new StudioError("IMPORT_REJECTED", 400, c.reason === "PATH_UNC_OR_DEVICE" ? "IMPORT_REMOTE_NOT_SUPPORTED" : c.reason === "PATH_UNRESOLVABLE" ? "IMPORT_SOURCE_NOT_FOUND" : "IMPORT_SOURCE_FORBIDDEN");
    const g = pathOverlapsDataDir(raw, this.dataDir);
    if (g.forbidden) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_SOURCE_FORBIDDEN");
    let st: fs.Stats;
    try { st = fs.statSync(g.canonical); } catch { throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_SOURCE_NOT_FOUND"); }
    if (kind === "git" ? !st.isDirectory() : !st.isFile()) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_SOURCE_NOT_FOUND");
    return g.canonical;
  }
  stagingDir(projectId: string): string { return path.join(this.projectDir(projectId), `.staging-${crypto.randomBytes(6).toString("hex")}`); }
  quarantineDir(projectId: string): string { return path.join(this.projectDir(projectId), "quarantine", "agent-config"); }
  // İçerik adreslenen karantina kopyası (aynı içerik bir kez); staging'in kardeşi olan proje dizinine yazılır.
  private quarantine(staging: string, rel: string, pattern: AgentConfigPattern, kind: QuarantinedAgentConfig["kind"], data: Buffer): QuarantinedAgentConfig {
    const digest = sha256(data), dir = path.join(path.dirname(staging), "quarantine", "agent-config");
    fs.mkdirSync(dir, {recursive: true});
    try { fs.writeFileSync(path.join(dir, digest), data, {flag: "wx"}); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    return {path: rel, pattern, kind, bytes: data.length, sha256: digest};
  }
  // Git içe aktarması: izlenen ajan yapılandırma dosyaları çalışma ağacından kaldırılır ve Studio kimliğiyle ayrı bir commit atılır; yeni HEAD bu dosyaları içermez (builder/reviewer klonlarına girmez).
  private quarantineGitTree(staging: string): QuarantinedAgentConfig[] {
    const ls = this.git(staging, ["-c", "core.quotePath=false", "ls-files", "-z", "--cached"]);
    if (ls.status !== 0) throw new StudioError("IMPORT_FAILED", 422, "GIT_CLONE_FAILED");
    const hits = String(ls.stdout ?? "").split("\0").filter(Boolean).map(rel => ({rel, pattern: agentConfigPattern(rel)})).filter((h): h is {rel: string; pattern: AgentConfigPattern} => h.pattern !== null);
    if (!hits.length) return [];
    const out: QuarantinedAgentConfig[] = [];
    const root = path.resolve(staging);
    for (const h of hits) {
      const abs = path.resolve(root, ...h.rel.split("/"));
      if (!under(root, abs) || abs === root) throw new StudioError("IMPORT_FAILED", 422, "AGENT_CONFIG_QUARANTINE_FAILED");
      let st: fs.Stats | null = null;
      try { st = fs.lstatSync(abs); } catch { st = null; }
      if (st?.isSymbolicLink()) out.push(this.quarantine(staging, h.rel, h.pattern, "symlink", Buffer.from(fs.readlinkSync(abs), "utf8")));
      else if (st?.isFile()) out.push(this.quarantine(staging, h.rel, h.pattern, "file", fs.readFileSync(abs)));
      else out.push(this.quarantine(staging, h.rel, h.pattern, "other", Buffer.alloc(0)));
    }
    // .claude/** altındaki her şey ajan yapılandırmasıdır: yoldaki ilk .claude bileşeni (dizin/symlink) bütünüyle kaldırılır; diğerleri tek tek.
    for (const h of hits) {
      const segs = h.rel.split("/"), i = segs.findIndex(x => agentConfigPattern(x) === ".claude/**");
      const target = path.resolve(root, ...(i >= 0 ? segs.slice(0, i + 1) : segs));
      fs.rmSync(target, {recursive: true, force: true});
    }
    this.commitAll(staging, AGENT_CONFIG_QUARANTINE_COMMIT);
    const after = this.git(staging, ["-c", "core.quotePath=false", "ls-files", "-z", "--cached"]);
    if (after.status !== 0 || String(after.stdout ?? "").split("\0").filter(Boolean).some(rel => agentConfigPattern(rel) !== null)) throw new StudioError("IMPORT_FAILED", 422, "AGENT_CONFIG_QUARANTINE_FAILED");
    return out;
  }

  // git clone --no-local --no-hardlinks: orijinal depoya yazılmaz (upload-pack yalnız okur); origin uzak kaydı kaldırılır, yönetilen depo kaynağa geri bağlanmaz.
  importGitInto(staging: string, rawSource: string): ImportResult {
    const src = this.localSource(rawSource, "git");
    if (this.gitOk(src, ["rev-parse", "--verify", "HEAD^{commit}"]) === null) throw new StudioError("IMPORT_REJECTED", 400, "IMPORT_SOURCE_NOT_A_REPOSITORY");
    fs.mkdirSync(path.dirname(staging), {recursive: true});
    const r = this.git(path.dirname(staging), ["clone", "--no-local", "--no-hardlinks", "--quiet", "--", src, staging]);
    if (r.status !== 0) throw new StudioError("IMPORT_FAILED", 422, "GIT_CLONE_FAILED");
    if (this.git(staging, ["remote", "remove", "origin"]).status !== 0) throw new StudioError("IMPORT_FAILED", 422, "GIT_CLONE_FAILED");
    if (!SHA.test(this.gitOk(staging, ["rev-parse", "--verify", "HEAD^{commit}"]) ?? "")) throw new StudioError("IMPORT_FAILED", 422, "IMPORT_SOURCE_EMPTY");
    // SBX-8: ajan yapılandırma dosyaları karantinaya alınır (kanıt kaydıyla); dönen HEAD karantina commit'idir.
    const agentConfigQuarantine = this.quarantineGitTree(staging);
    const head = this.gitOk(staging, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head || !SHA.test(head)) throw new StudioError("IMPORT_FAILED", 422, "IMPORT_SOURCE_EMPTY");
    return {headSha: head, agentConfigQuarantine};
  }

  // ZIP: önce bütün girdiler doğrulanır (zip-slip, symlink, .git, yineleme, boyut, sayı, CRC); hiçbiri geçmezse diske tek bayt yazılmaz.
  importZipInto(staging: string, rawSource: string): ImportResult {
    const src = this.localSource(rawSource, "zip");
    if (fs.statSync(src).size > this.zipLimits.maxArchiveBytes) throw new StudioError("IMPORT_REJECTED", 400, "ZIP_TOO_LARGE");
    const buf = fs.readFileSync(src);
    let files: Array<{segments: string[]; data: Buffer}>;
    try {
      const entries = listZipEntries(buf, this.zipLimits);
      files = entries.filter(e => !e.isDir).map(e => ({segments: e.segments, data: readZipEntry(buf, e, this.zipLimits)}));
    } catch (e) { if (e instanceof ZipError) throw new StudioError("IMPORT_REJECTED", 400, e.code); throw new StudioError("IMPORT_REJECTED", 400, "ZIP_INVALID"); }
    if (!files.length) throw new StudioError("IMPORT_REJECTED", 400, "ZIP_EMPTY");
    // Tek ortak üst dizin (arşivleyicilerin yaygın biçimi) soyulur.
    const first = files[0].segments[0];
    const strip = files.every(f => f.segments.length > 1 && f.segments[0] === first) ? 1 : 0;
    fs.mkdirSync(staging, {recursive: true});
    const root = path.resolve(staging);
    const agentConfigQuarantine: QuarantinedAgentConfig[] = [];
    for (const f of files) {
      const target = path.resolve(root, ...f.segments.slice(strip));
      if (!under(root, target) || target === root) throw new StudioError("IMPORT_REJECTED", 400, "ZIP_PATH_TRAVERSAL");
      // SBX-8: ajan yapılandırma girdileri depo ağacına hiç yazılmaz; içerikleri karantinaya alınır ve kanıt olarak kaydedilir.
      const rel = f.segments.slice(strip).join("/"), pattern = agentConfigPattern(rel);
      if (pattern) { agentConfigQuarantine.push(this.quarantine(staging, rel, pattern, "file", f.data)); continue; }
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, f.data, {flag: "wx"});
    }
    this.initRepo(root);
    return {headSha: this.commitAll(root, "Import ZIP archive"), agentConfigQuarantine};
  }

  // ---- PS-007: dosyalar ----
  // PS1A-C1-F1: Studio dosya/git/export/dev-run işlemleri YALNIZ bu projenin yönetilen deposunda çalışır. İstemcinin verdiği (yönetilmeyen) repository.path
  // veri dizinine, başka bir tenant'ın yönetilen deposuna veya journal'a işaret edebilir; bu yüzden managed bayrağı ve realpath'in <dataDir>/projects/<id>/repo'ya eşitliği zorunludur.
  // PS1A-C2-F1: eşitlik ve içerme kanonik yol (realpathSync.native) üzerinden; 8.3 kısa ad/junction takma adı başka bir projenin deposuna eşlenemez.
  managedRepoRoot(project: Project): string {
    const p = project.repository?.path;
    if (!p) throw new StudioError("REPOSITORY_NOT_CONFIGURED", 409);
    if (project.repository?.managed !== true) throw new StudioError("REPOSITORY_NOT_MANAGED", 409);
    const real = managedRepoCanonical(this.dataDir, project.projectId, p);
    if (!real) throw new StudioError("REPOSITORY_NOT_MANAGED", 409);
    try { if (!fs.statSync(real).isDirectory()) throw new Error("x"); } catch { throw new StudioError("REPOSITORY_NOT_CONFIGURED", 409); }
    return real;
  }
  private repoRoot(project: Project): string { return this.managedRepoRoot(project); }
  // PS1A-C1-F1/PS1A-C2-F1 (proje oluşturma): istemcinin verdiği repository.path'in kanonik biçimi veri dizininin kanonik biçiminin içinde veya üstünde olamaz;
  // UNC/aygıt yolu ve kanonik açılımı alınamayan kısa ad da reddedilir.
  assertRepositoryPathAllowed(raw: unknown): void {
    if (raw === undefined) return;
    if (pathOverlapsDataDir(raw, this.dataDir).forbidden) throw new StudioError("REPOSITORY_PATH_FORBIDDEN", 400);
  }
  // Göreli yol: '..', mutlak yol, sürücü/ADS ':' ve (all=false iken) '.git' reddedilir; her segment lstat ile yürünür, symlink/junction reddedilir; son olarak realpath kökün altında olmalıdır.
  private safePath(root: string, raw: string | undefined, all: boolean): {abs: string; rel: string} {
    const s = (raw ?? "").replace(/\\/g, "/");
    if (s.length > 1000 || /[\u0000-\u001f]/.test(s)) throw new StudioError("PATH_REJECTED", 400);
    if (s.startsWith("/") || s.includes(":")) throw new StudioError("PATH_REJECTED", 400);
    const segs = s.split("/").filter(x => x !== "" && x !== ".");
    if (segs.some(x => x === "..")) throw new StudioError("PATH_REJECTED", 400);
    if (!all && segs.some(x => x.toLowerCase() === ".git")) throw new StudioError("PATH_REJECTED", 400);
    let cur = root;
    for (const seg of segs) {
      cur = path.join(cur, seg);
      let st: fs.Stats;
      try { st = fs.lstatSync(cur); } catch { throw new StudioError("FILE_NOT_FOUND", 404); }
      if (st.isSymbolicLink()) throw new StudioError("PATH_REJECTED", 400, "SYMLINK_NOT_FOLLOWED");
    }
    let real: string; try { real = fs.realpathSync.native(cur); } catch { throw new StudioError("FILE_NOT_FOUND", 404); }
    const k = (x: string) => process.platform === "win32" ? x.toLowerCase() : x;
    if (!under(k(root), k(real))) throw new StudioError("PATH_REJECTED", 400, "SYMLINK_NOT_FOLLOWED");
    // PS1A-C2-F1: 8.3 kısa ad (ör. GIT~1) gizli '.git' kuralını aşamaz: karar kanonik (açılmış) göreli yol üzerinden de verilir.
    if (!all && path.relative(k(root), k(real)).split(path.sep).some(x => x === ".git")) throw new StudioError("PATH_REJECTED", 400);
    return {abs: cur, rel: segs.join("/")};
  }
  listFiles(project: Project, rawPath: string | undefined, all: boolean): {path: string; entries: FileEntry[]; truncated: boolean} {
    const root = this.repoRoot(project), {abs, rel} = this.safePath(root, rawPath, all);
    if (!fs.lstatSync(abs).isDirectory()) throw new StudioError("NOT_A_DIRECTORY", 400);
    const hidden = (n: string) => !all && (n.toLowerCase() === ".git" || n.toLowerCase() === "node_modules");
    const dirents = fs.readdirSync(abs, {withFileTypes: true}).filter(d => !hidden(d.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const entries = dirents.slice(0, MAX_LIST_ENTRIES).map((d): FileEntry => {
      const type = d.isSymbolicLink() ? "symlink" : d.isDirectory() ? "dir" : d.isFile() ? "file" : "other";
      let size: number | null = null;
      if (type === "file") { try { size = fs.lstatSync(path.join(abs, d.name)).size; } catch { size = null; } }
      return {name: d.name, type, size};
    });
    return {path: rel, entries, truncated: dirents.length > MAX_LIST_ENTRIES};
  }
  readFile(project: Project, rawPath: string | undefined, all: boolean): {path: string; size: number; sha256: string; redacted: boolean; text: string} {
    const root = this.repoRoot(project), {abs, rel} = this.safePath(root, rawPath, all);
    const st = fs.lstatSync(abs);
    if (!st.isFile()) throw new StudioError("NOT_A_FILE", 400);
    if (st.size > MAX_FILE_BYTES) throw new StudioError("FILE_TOO_LARGE", 413);
    const fd = fs.openSync(abs, "r");
    let buf: Buffer;
    try {
      const fst = fs.fstatSync(fd);
      if (fst.ino !== st.ino || fst.dev !== st.dev || !fst.isFile() || fst.size > MAX_FILE_BYTES) throw new StudioError("PATH_REJECTED", 400);
      buf = Buffer.alloc(fst.size); let off = 0;
      while (off < buf.length) { const n = fs.readSync(fd, buf, off, buf.length - off, off); if (n <= 0) break; off += n; }
      buf = buf.subarray(0, off);
    } finally { fs.closeSync(fd); }
    if (buf.includes(0)) throw new StudioError("FILE_NOT_TEXT", 415);
    let text: string;
    try { text = new TextDecoder("utf-8", {fatal: true}).decode(buf); } catch { throw new StudioError("FILE_NOT_TEXT", 415); }
    const red = redactSecrets(text);
    return {path: rel, size: buf.length, sha256: sha256(buf), redacted: red !== text, text: red};
  }

  // ---- PS-007: git görünümü (run commit'leri dahil, salt okunur) ----
  // Run commit'leri yönetilen depoya yazılmadan okunur: run workspace nesne dizinleri GIT_ALTERNATE_OBJECT_DIRECTORIES ile eklenir; kendi alternates dosyası olan nesne dizini (zincirleme okuma) atlanır.
  alternatesEnv(runs: WorkRun[]): Record<string, string> {
    const dirs: string[] = [];
    for (const r of runs) {
      if (!/^run_[0-9a-f]{24}$/.test(r.runId)) continue;
      const objects = path.join(this.dataDir, "runs", r.runId, "work", ".git", "objects");
      try {
        if (!fs.statSync(objects).isDirectory()) continue;
        if (fs.existsSync(path.join(objects, "info", "alternates")) || fs.existsSync(path.join(objects, "info", "http-alternates"))) continue;
        if (objects.includes(path.delimiter)) continue;
        dirs.push(objects);
      } catch { /* run workspace yok */ }
    }
    return dirs.length ? {GIT_ALTERNATE_OBJECT_DIRECTORIES: dirs.join(path.delimiter)} : {};
  }
  resolveCommit(project: Project, runs: WorkRun[], ref: string): string {
    if (ref !== "HEAD" && !/^[0-9a-f]{7,40}$/.test(ref)) throw new StudioError("INVALID_REF", 400);
    const root = this.repoRoot(project);
    const sha = this.gitOk(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], this.alternatesEnv(runs));
    if (!sha || !SHA.test(sha)) throw new StudioError("COMMIT_NOT_FOUND", 404);
    return sha;
  }
  gitLog(project: Project, runs: WorkRun[], limit: number, runId?: string) {
    const root = this.repoRoot(project), alt = this.alternatesEnv(runs);
    let ref = "HEAD";
    if (runId !== undefined) {
      const run = runs.find(r => r.runId === runId);
      if (!run) throw new StudioError("WORKOS_NOT_FOUND", 404);
      if (!run.headSha || !SHA.test(run.headSha)) throw new StudioError("RUN_HAS_NO_COMMIT", 409);
      ref = run.headSha;
    }
    const r = this.git(root, ["log", "--no-color", "--no-show-signature", "-n", String(limit), "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e", ref, "--"], alt, 16 * 1024 * 1024);
    if (r.status !== 0) throw new StudioError("COMMIT_NOT_FOUND", 404);
    const runLinks = runs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(run => {
      let commits: string[] = [];
      if (run.baseSha && run.headSha && SHA.test(run.baseSha) && SHA.test(run.headSha)) {
        const rl = this.gitOk(root, ["rev-list", "--max-count=100", `${run.baseSha}..${run.headSha}`, "--"], alt);
        commits = rl ? rl.split(/\s+/).filter(x => SHA.test(x)) : [];
      }
      return {runId: run.runId, missionId: run.missionId, status: run.status, baseSha: run.baseSha, headSha: run.headSha, workBranch: run.workBranch, commits};
    });
    const commits = String(r.stdout ?? "").split("\x1e").map(x => x.replace(/^\s+/, "")).filter(Boolean).map(line => {
      const [sha, parents, author, date, subject] = line.split("\x1f");
      return {sha, parents: (parents ?? "").split(" ").filter(Boolean), author: redactSecrets(author ?? "").slice(0, 200), date, subject: redactSecrets(subject ?? "").slice(0, 500),
        runIds: runLinks.filter(l => l.commits.includes(sha)).map(l => l.runId)};
    });
    return {ref: runId ? {runId} : {ref: "HEAD"}, commits, runs: runLinks};
  }
  private emptyAttributesFile(): string {
    const f = path.join(this.dataDir, "studio", "empty-attributes");
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, ""); }
    return f;
  }
  // Diff: --no-textconv --no-ext-diff ve boş core.attributesFile (depo sürücüleri içerik gizleyemez/komut çalıştıramaz); çıktı sınırlı ve redakte edilir.
  gitDiff(project: Project, runs: WorkRun[], from: string, to: string) {
    const root = this.repoRoot(project), alt = this.alternatesEnv(runs);
    const a = this.resolveCommit(project, runs, from), b = this.resolveCommit(project, runs, to);
    const flags = ["-c", `core.attributesFile=${this.emptyAttributesFile()}`, "diff", "--no-color", "--no-textconv", "--no-ext-diff"];
    const ns = this.git(root, [...flags, "--numstat", a, b, "--"], alt, 16 * 1024 * 1024);
    const d = this.git(root, [...flags, a, b, "--"], alt, 4 * MAX_DIFF_BYTES);
    const raw = String(d.stdout ?? "");
    if (d.status !== 0 && !(d.error && (d.error as NodeJS.ErrnoException).code === "ENOBUFS")) throw new StudioError("DIFF_UNAVAILABLE", 409);
    const bytes = Buffer.byteLength(raw, "utf8");
    const truncated = bytes > MAX_DIFF_BYTES || Boolean(d.error);
    const text = truncated ? Buffer.from(raw, "utf8").subarray(0, MAX_DIFF_BYTES).toString("utf8") : raw;
    const files = String(ns.stdout ?? "").split("\n").filter(Boolean).slice(0, 1000).map(l => { const [add, del, ...f] = l.split("\t"); return {file: f.join("\t"), added: add === "-" ? null : Number(add), deleted: del === "-" ? null : Number(del)}; });
    return {from: a, to: b, files, truncated, diff: redactSecrets(text)};
  }

  // ---- PS-012: export / teslim paketi ----
  exportProject(project: Project, runs: WorkRun[], commit: string | undefined, actor: string): Omit<ProjectExport, "tenantId"> {
    const root = this.repoRoot(project), alt = this.alternatesEnv(runs);
    const sha = this.resolveCommit(project, runs, commit ?? "HEAD");
    const exportId = `exp_${crypto.randomBytes(12).toString("hex")}`;
    const outDir = this.exportsDir(), tmp = path.join(outDir, `.tmp-${exportId}`);
    fs.mkdirSync(tmp, {recursive: true});
    try {
      const run = runs.filter(r => r.headSha === sha).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
      const ev = (pred: (e: RunEvidence) => boolean) => run ? [...run.evidence].reverse().find(pred) : undefined;
      const tests = run ? run.evidence.filter(e => (e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS") && e.commitSha === sha) : [];
      const secEv = ev(e => e.kind === "SECURITY_REPORT" && e.commitSha === sha);
      const review = ev(e => e.kind === "REVIEW" && e.commitSha === sha && e.verdict !== undefined);
      const reportEv = ev(e => e.kind === "REPORT" && e.commitSha === sha);
      const reportDir = path.join(tmp, "reports-src"); fs.mkdirSync(reportDir);
      const added: Array<{prefix: string; file: string}> = [];
      const contents = {readme: true, testReport: false, securityReport: false, runReport: false, verificationStatus: true};
      // M1a (D-SBX1-PATH-2026-10-15): VERIFICATION_STATUS.json arşiv köküne yazılır; yalnız kanıttan türetilir. M1a c2: bu varsayılan proje dışa aktarımı bir koşu teslimi DEĞİLDİR;
      // her zaman NO_RUN/NOT_VERIFIED etiketlenir (koşu teslimi yalnız prepareRunDelivery artefaktıdır).
      const vs = verificationStatus(run, sha);
      if (run && tests.length) {
        const f = path.join(reportDir, "test-report.json");
        const last = tests[tests.length - 1];
        fs.writeFileSync(f, JSON.stringify({schemaVersion: 1, runId: run.runId, missionId: run.missionId, commit: sha, status: last.exitCode === 0 ? "PASSED" : "FAILED",
          results: tests.map(t => ({kind: t.kind, cycle: t.cycle, argv: t.argv.map((a, i) => i === 0 && path.isAbsolute(a) ? path.basename(a).replace(/\.exe$/i, "") : a), exitCode: t.exitCode, timedOut: t.timedOut ?? false, startedAt: t.startedAt, endedAt: t.endedAt, logSha256: t.logSha256}))}, null, 2) + "\n");
        added.push({prefix: "reports/", file: f}); contents.testReport = true;
      }
      const copyVerified = (e: RunEvidence | undefined, name: string): boolean => {
        if (!e?.logPath || !e.logSha256) return false;
        const src = path.resolve(this.dataDir, e.logPath);
        if (!under(this.dataDir, src)) return false;
        try { const b = fs.readFileSync(src); if (sha256(b) !== e.logSha256) return false; const f = path.join(reportDir, name); fs.writeFileSync(f, b); added.push({prefix: "reports/", file: f}); return true; } catch { return false; }
      };
      contents.securityReport = copyVerified(secEv, "security-report.json");
      contents.runReport = copyVerified(reportEv, "run-report.json");
      const sec = secEv?.security;
      const fmt = (argv?: string[]) => argv && argv.length ? `\`${argv.join(" ")}\`` : "not configured";
      const readme = [
        `# ${project.name.replace(/[\r\n]+/g, " ").slice(0, 200)} - delivery package`, "",
        "Generated by UASCO Project Studio. The source tree is under `source/` (git archive of the commit below; no `.git` directory).", "",
        `**${M1A_LABELS.NO_RUN_NOT_VERIFIED}.** This project export is NOT a UASCO run delivery package and is never a verified product. A run delivery is prepared per run in Studio > Delivery ("Teslim paketini hazırla").`, "",
        "| Field | Value |", "| --- | --- |",
        `| Project | ${project.projectId} |`, `| Commit | ${sha} |`, `| Export | ${exportId} |`, `| Generated at | ${new Date().toISOString()} |`,
        "| Run delivery | NO_RUN (project export, not a run delivery package) |",
        `| Commit produced by run (informational) | ${run ? run.runId : "none (commit not produced by a UASCO run)"} |`,
        `| Tests | ${tests.length ? `${tests[tests.length - 1].exitCode === 0 ? "PASSED" : "FAILED"} (${tests.map(t => `${t.kind} exit ${t.exitCode}`).join(", ")})` : `NOT_EXECUTED (${vs.notExecutedReason})`} |`,
        `| Verification | ${vs.label} (productVerification ${vs.productVerification}; functionalAcceptance ${vs.functionalAcceptance}; see VERIFICATION_STATUS.json) |`,
        `| Security | ${sec ? `${sec.status}${sec.gaps.length ? ` (gaps: ${sec.gaps.join(", ")})` : ""}` : "NOT_AVAILABLE"} |`,
        `| Independent review | ${review ? `${review.verdict} by ${review.reviewerIdentity ?? "unknown"}` : "NOT_AVAILABLE"} |`,
        "| Export secret scan | CLEAN (built-in scanner over every archived file) |", "",
        "## How to run", "",
        `- Tests: ${fmt(project.testCommand)}`, `- Development server: ${fmt(project.devCommand)}`, "",
        "Run the commands from the `source/` directory. Reports (when available) are under `reports/`.", "",
        "Delivery decision: this package is an export of the project state; it is not a merge, release or production deployment.", ""
      ].join("\n");
      const readmeFile = path.join(reportDir, "README.md");
      fs.writeFileSync(readmeFile, readme);
      const vsFile = path.join(reportDir, "VERIFICATION_STATUS.json");
      fs.writeFileSync(vsFile, JSON.stringify(vs, null, 2) + "\n");
      const zipTmp = path.join(tmp, "archive.zip");
      const args = ["-c", `core.attributesFile=${this.emptyAttributesFile()}`, "archive", "--format=zip", "-o", zipTmp, "--prefix=", `--add-file=${readmeFile}`, `--add-file=${vsFile}`];
      let lastPrefix = "";
      for (const a of added) { if (a.prefix !== lastPrefix) { args.push(`--prefix=${a.prefix}`); lastPrefix = a.prefix; } args.push(`--add-file=${a.file}`); }
      args.push("--prefix=source/", sha);
      if (this.git(root, args, alt).status !== 0 || !fs.existsSync(zipTmp)) throw new StudioError("EXPORT_FAILED", 500);
      // Teslim edilen arşivin TAMAMI (kaynak ağacı + üretilen README/raporlar) yayımlanmadan önce taranır; bulgu varsa hiçbir şey yayımlanmaz.
      const buf = fs.readFileSync(zipTmp);
      const findings: Array<{file: string; line: number; kind: string}> = [];
      let scanned = 0;
      try {
        for (const e of listZipEntries(buf, EXPORT_LIMITS, {scanOnly: true})) {
          if (e.isDir) continue;
          if (e.segments.some(s => s.toLowerCase() === ".git")) throw new StudioError("EXPORT_FAILED", 500);
          scanned += 1;
          const lines = readZipEntry(buf, e, EXPORT_LIMITS).toString("utf8").split("\n");
          for (let i = 0; i < lines.length && findings.length < 50; i++) for (const kind of findSecretKinds(lines[i])) findings.push({file: e.name.slice(0, 500), line: i + 1, kind});
        }
      } catch (err) { if (err instanceof StudioError) throw err; throw new StudioError("EXPORT_FAILED", 500); }
      if (findings.length) throw new StudioError("EXPORT_BLOCKED_SECRET", 409, undefined, {findings});
      const final = path.join(outDir, `${exportId}.zip`);
      fs.renameSync(zipTmp, final);
      return {exportId, projectId: project.projectId, commit: sha, sha256: sha256(buf), size: buf.length, file: `exports/${exportId}.zip`, createdAt: new Date().toISOString(), createdBy: actor,
        runId: run?.runId ?? null, contents, secretScan: {scanner: "builtin", status: "CLEAN", entriesScanned: scanned},
        verification: {label: vs.label, testsExecuted: vs.testsExecuted, notExecutedReason: vs.notExecutedReason, functionalAcceptance: vs.functionalAcceptance, completionMode: vs.completionMode, runDelivery: "NO_RUN", productVerification: "NOT_VERIFIED"}};
    } finally { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* geçici dizin */ } }
  }
  // ---- M1a c2: koşu teslim artefaktı (Founder koşulu 1, RV-M1A-C1-F1) ----
  deliveriesDir(): string { return path.join(this.dataDir, "deliveries"); }
  // Teslim artefaktı dosyası: kayıttaki göreli yol yeniden kurulur ve dataDir/deliveries altında olduğu doğrulanır (kayıttan gelen yol asla doğrudan kullanılmaz).
  deliveryFile(rec: DeliveryArtifactRecord): string {
    if (!/^run_[0-9a-f]{24}$/.test(rec.runId) || !/^[0-9a-f]{64}$/.test(rec.exportArtifactHash) || rec.artifactPath !== deliveryArtifactPath(rec.runId, rec.exportArtifactHash)) throw new StudioError("DELIVERY_RECORD_INVALID", 409);
    const f = path.join(this.deliveriesDir(), rec.runId, `${rec.exportArtifactHash}.zip`);
    if (!under(this.deliveriesDir(), f)) throw new StudioError("DELIVERY_RECORD_INVALID", 409);
    return f;
  }
  // Dışa aktarma/teslim öncesi yeniden doğrulama: dosyanın sha256'sı kayıttaki exportArtifactHash ile birebir eşleşmezse bayt verilmez.
  deliveryFileState(rec: DeliveryArtifactRecord): "VERIFIED" | "MISSING" | "MODIFIED" {
    try { return sha256(fs.readFileSync(this.deliveryFile(rec))) === rec.exportArtifactHash ? "VERIFIED" : "MODIFIED"; } catch { return "MISSING"; }
  }
  readVerifiedDelivery(rec: DeliveryArtifactRecord): Buffer {
    let b: Buffer;
    try { b = fs.readFileSync(this.deliveryFile(rec)); } catch (e) { if (e instanceof StudioError) throw e; throw new StudioError("DELIVERY_ARTIFACT_MISSING", 409); }
    if (sha256(b) !== rec.exportArtifactHash) throw new StudioError("DELIVERY_ARTIFACT_HASH_MISMATCH", 409);
    return b;
  }
  // Run nesnelerini yönetilen depoya getirir: run çalışma alanının nesne dizini yalnız GIT_ALTERNATE_OBJECT_DIRECTORIES olarak okunur (çalışma alanının config/hook'ları hiç yüklenmez),
  // run.headSha'dan erişilebilen nesneler pack-objects ile yönetilen deponun kendi nesne deposuna yazılır ve refs/uasco/runs/<runId> ad alanlı ref'i kurulur. Git, izole global/system
  // config + boş hooksPath (spawnGitSync) ve core.fsmonitor=false ile çalışır; ls-tree/cat-file filtre/textconv uygulamaz. Bağlantı, alternates OLMADAN yeniden doğrulanır.
  private importRunObjects(root: string, run: WorkRun, head: string): void {
    const neutral = ["-c", "core.fsmonitor=false", "-c", `core.attributesFile=${this.emptyAttributesFile()}`];
    const local = this.gitOk(root, [...neutral, "cat-file", "-t", head]) === "commit" && this.git(root, [...neutral, "rev-list", "--objects", "--quiet", head, "--"]).status === 0;
    if (!local) {
      const alt = this.alternatesEnv([run]);
      if (!alt.GIT_ALTERNATE_OBJECT_DIRECTORIES || this.gitOk(root, [...neutral, "cat-file", "-t", head], alt) !== "commit") throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
      const gitDir = this.gitOk(root, [...neutral, "rev-parse", "--absolute-git-dir"]);
      if (!gitDir) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
      const packDir = path.join(gitDir, "objects", "pack");
      fs.mkdirSync(packDir, {recursive: true});
      const pk = spawnGitSync(root, [...neutral, "pack-objects", "--revs", "-q", path.join(packDir, "pack")], {env: this.env(alt), input: `${head}\n`, maxBuffer: 1024 * 1024, timeout: this.o.gitTimeoutMs ?? 10 * 60_000});
      if (pk.status !== 0) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
      if (this.git(root, [...neutral, "rev-list", "--objects", "--quiet", head, "--"]).status !== 0) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
    }
    if (this.git(root, [...neutral, "update-ref", `refs/uasco/runs/${run.runId}`, head]).status !== 0) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
  }
  // //TR: Deterministik teslim artefaktı: run.headSha ağacındaki her blob (sıralı; sabit zaman damgası 0; mod yalnız 0644/0755/symlink; stored/sıkıştırmasız) "source/" altında +
  // README.md + VERIFICATION_STATUS.json (makine yolu/zaman yok; Founder kabulü İÇİNDE DEĞİL). exportArtifactHash = arşiv baytlarının sha256'sı; aynı run yeniden hazırlanırsa aynı bayt/hash.
  // run.headSha taban/şablon commit'iyle aynıysa veya ağacı taban ya da kök (şablon) commit ağacıyla aynıysa NO_GENERATED_SOURCE (şablon gerçek çıktı yerine teslim edilmez).
  // Arşivin tamamı yayımlanmadan önce secret taramasından geçer (bulgu = 409, dosya yazılmaz). Proje kodu hiç çalıştırılmaz.
  prepareRunDelivery(project: Project, run: WorkRun): DeliveryArtifactRecord {
    const pre = deliveryPrepareCheck(run);
    if (!pre.ok) throw new StudioError(pre.reason, 409, pre.detail);
    const head = run.headSha!, base = run.baseSha!, root = this.repoRoot(project);
    if (run.projectId !== project.projectId) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
    this.importRunObjects(root, run, head);
    const neutral = ["-c", "core.fsmonitor=false", "-c", `core.attributesFile=${this.emptyAttributesFile()}`];
    const treeSha = this.gitOk(root, [...neutral, "rev-parse", "--verify", "--quiet", "--end-of-options", `${head}^{tree}`]);
    if (!treeSha || !SHA.test(treeSha)) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
    const baseTree = this.gitOk(root, [...neutral, "rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{tree}`]);
    const roots = (this.gitOk(root, [...neutral, "rev-list", "--max-parents=0", head, "--"]) ?? "").split(/\s+/).filter(x => SHA.test(x));
    const rootTrees = roots.map(c => this.gitOk(root, [...neutral, "rev-parse", "--verify", "--quiet", "--end-of-options", `${c}^{tree}`]));
    if (head === base || treeSha === baseTree || rootTrees.includes(treeSha)) throw new StudioError("NO_GENERATED_SOURCE", 409);
    const ls = spawnGitSync(root, [...neutral, "ls-tree", "-r", "-z", "--full-tree", head], {env: this.env(), encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: this.o.gitTimeoutMs ?? 10 * 60_000});
    if (ls.status !== 0) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
    const files: Array<{name: Buffer; mode: string; sha: string}> = [];
    for (const rec of (ls.stdout as unknown as Buffer).toString("utf8").split("\0")) {
      if (!rec) continue;
      const tab = rec.indexOf("\t"), [mode, type, sha] = rec.slice(0, tab).split(" "), name = rec.slice(tab + 1);
      // Alt modül (gitlink) içeriği bu commit'te yoktur: dürüstçe atlanır ve VERIFICATION_STATUS'ta sayılmaz (kaynak ağacı yalnız bloblardır).
      if (type !== "blob") continue;
      if (!SHA.test(sha) || !name || name.split("/").some(s => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
      files.push({name: Buffer.from(`source/${name}`, "utf8"), mode, sha});
    }
    if (files.length > EXPORT_LIMITS.maxFiles) throw new StudioError("DELIVERY_TOO_LARGE", 409);
    const cat = files.length ? spawnGitSync(root, [...neutral, "cat-file", "--batch"], {env: this.env(), encoding: "buffer", input: Buffer.from(files.map(f => f.sha).join("\n") + "\n", "utf8"), maxBuffer: EXPORT_LIMITS.maxTotalBytes + 64 * files.length + 1024, timeout: this.o.gitTimeoutMs ?? 10 * 60_000}) : null;
    if (cat && cat.status !== 0) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
    const out = cat ? cat.stdout as unknown as Buffer : Buffer.alloc(0);
    const entries: ZipWriteEntry[] = [];
    let off = 0, total = 0;
    for (const f of files) {
      const nl = out.indexOf(0x0a, off);
      const [sha, type, size] = out.subarray(off, nl).toString("utf8").split(" ");
      const n = Number(size);
      if (sha !== f.sha || type !== "blob" || !Number.isSafeInteger(n) || n < 0 || nl + 1 + n > out.length) throw new StudioError("DELIVERY_SOURCE_UNAVAILABLE", 409);
      const data = Buffer.from(out.subarray(nl + 1, nl + 1 + n));
      off = nl + 1 + n + 1; total += n;
      if (n > EXPORT_LIMITS.maxEntryBytes || total > EXPORT_LIMITS.maxTotalBytes) throw new StudioError("DELIVERY_TOO_LARGE", 409);
      entries.push({name: f.name.toString("utf8"), rawName: f.name, data, method: 0, unixMode: f.mode === "120000" ? 0o120777 : f.mode === "100755" ? 0o100755 : 0o100644});
    }
    const vs = deliveryVerificationStatus(run, treeSha);
    const sec = vs.securitySummary;
    const readme = [
      "# UASCO run delivery package", "",
      `**${vs.labels.sourceGeneration}** / **${vs.labels.productVerification}**`, "",
      "The generated source tree is under `source/` (every file of the run's source commit; no `.git` directory). Nothing in this package was executed by UASCO.", "",
      "| Field | Value |", "| --- | --- |",
      `| Run | ${vs.runId} |`, `| Mission | ${vs.missionId} |`, `| Project | ${vs.projectId} |`,
      `| Source commit | ${vs.sourceCommit} |`, `| Source tree | ${vs.treeSha} |`, `| Base commit | ${vs.baseCommit} |`,
      `| Source generation | ${vs.labels.sourceGeneration} |`,
      `| Product verification | ${vs.labels.productVerification} (${vs.productVerificationReason}) |`,
      `| Tests executed | ${vs.testsExecuted ? "yes" : `no (${vs.notExecutedReason ?? "not executed"})`} |`,
      `| Independent review | ${vs.reviewVerdict} (evidence ${vs.reviewEvidenceId}) |`,
      `| Static security | ${sec ? `${sec.status}${sec.gaps.length ? ` (gaps: ${sec.gaps.join(", ")})` : ""}` : "NOT_AVAILABLE"} |`, "",
      "## Verification and acceptance", "",
      `- The SHA-256 of this archive is the exportArtifactHash shown by UASCO; verify it with \`Get-FileHash -Algorithm SHA256 <file>\` before use.`,
      `- When the Founder accepts this source delivery, UASCO records "${M1A_LABELS.SOURCE_DELIVERY_ACCEPTED}" in its journal (SOURCE_DELIVERY_ACCEPTED, bound to runId + mission + source commit + this archive's hash). The acceptance is not stored in this archive.`,
      "- Source generation is not product verification: static security scanning and an independent review do not show that the product works. In M1a no verified sandbox exists, so PRODUCT_VERIFIED and mission COMPLETE are impossible.",
      "- This package is not a merge, release or production deployment.", ""
    ].join("\n");
    entries.push({name: "README.md", data: readme, method: 0}, {name: "VERIFICATION_STATUS.json", data: JSON.stringify(vs, null, 2) + "\n", method: 0});
    entries.sort((a, b) => Buffer.compare(a.rawName ?? Buffer.from(a.name, "utf8"), b.rawName ?? Buffer.from(b.name, "utf8")));
    const findings: Array<{file: string; line: number; kind: string}> = [];
    for (const e of entries) {
      const lines = (Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8")).toString("utf8").split("\n");
      for (let i = 0; i < lines.length && findings.length < 50; i++) for (const kind of findSecretKinds(lines[i])) findings.push({file: e.name.slice(0, 500), line: i + 1, kind});
    }
    if (findings.length) throw new StudioError("EXPORT_BLOCKED_SECRET", 409, undefined, {findings});
    const bytes = writeZip(entries), hash = sha256(bytes);
    const rec: DeliveryArtifactRecord = {runId: run.runId, missionId: run.missionId, sourceCommit: head, treeSha, exportArtifactHash: hash, artifactPath: deliveryArtifactPath(run.runId, hash)};
    const file = this.deliveryFile(rec);
    if (this.deliveryFileState(rec) !== "VERIFIED") {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      const tmp = `${file}.tmp-${crypto.randomBytes(6).toString("hex")}`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, file);
    }
    return rec;
  }
  exportFileState(ex: ProjectExport): "PRESENT" | "MISSING" | "MODIFIED" {
    if (!/^exp_[0-9a-f]{24}$/.test(ex.exportId)) return "MISSING";
    const f = path.join(this.exportsDir(), `${ex.exportId}.zip`);
    try { return sha256(fs.readFileSync(f)) === ex.sha256 ? "PRESENT" : "MODIFIED"; } catch { return "MISSING"; }
  }
}
