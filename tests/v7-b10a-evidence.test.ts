// //TR: Bu test B10A Evidence Center'ı gerçek geçici git deposu, geçici veri dizini ve store API'siyle tohumlanmış Work OS journal ile doğrular: hash yeniden hesabı VERIFIED, bozulmuş dosya MISMATCH, silinmiş dosya MISSING, kayıtlı hash yok UNVERIFIABLE, yol/symlink kaçışı reddi, tenant izolasyonu, kararlı sayfalama, log kuyruğunda secret redaksiyonu, cockpit evidence bloğu ve yanıtlarda mutlak yol olmaması.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {EvidenceIndex, EvidenceInputError, TAIL_BYTES} from "../core/evidence/index.js";
import type {EvidenceItem} from "../core/evidence/index.js";
import {buildServer} from "../apps/control-api/src/server.js";

const T = 60_000;
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
// Sahte secret çalışma anında parçalardan kurulur; depoda gerçek secret biçimli sabit bulunmaz.
const FAKE_GH = ["gh", "p_", "Q7ZX3MPLW2RT5VB9", "Q7ZX3MPLW2RT5VB9", "ABCD"].join("");
const FAKE_AWS = ["AK", "IA", "Q7ZX3MPLW2RT5VB9"].join("");
let tmp = "";
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "uasco-b10a-"))); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };

interface Ctx { repo: string; dataDir: string; runtime: string; store: WorkOsStore; runId: string; missionId: string; projectId: string; leaseId: string; logs: {good: string; noHash: string; noHashRel: string; goodRel: string} }
function reviewRecord(extra: Record<string, unknown> = {}): string {
  const text = '{"verdict":"CLEAN","findings":[]}';
  return JSON.stringify({schemaVersion: "1.0.0", reviewedCommit: "a".repeat(40), cycle: 1, reviewerIdentity: "CLAUDE_REVIEWER", bundleDigest: "d1", frozenBundle: {bundleDigest: "d1"},
    runManifest: {startedAt: "2026-10-14T10:00:00.000Z"}, reviewResultText: text, reviewResultSha256: sha(text), ...extra}, null, 2) + "\n";
}
function setup(tenantId = "tA"): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const repo = path.join(tmp, `repo-${id}`), dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `rt-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  git(tmp, ["init", "-q", "-b", "main", repo]);
  put(path.join(repo, "config", "orchestrator-policy.json"), JSON.stringify({roots: {stateFile: "${REPO}/.ai/cache/review/ORCHESTRATOR_STATE.json"}}));
  put(path.join(repo, "audit", "checkpoints", "CP-ONE.json"), '{"checkpoint":"one"}\n');
  put(path.join(repo, "audit", "checkpoints", "CP-TWO.json"), '{"checkpoint":"two"}\n');
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  put(path.join(repo, "audit", "checkpoints", "CP-UNTRACKED.json"), '{"checkpoint":"untracked"}\n');
  put(path.join(repo, ".ai", "cache", "review", "evidence", "REV-ONE.json"), reviewRecord());
  put(path.join(repo, ".ai", "cache", "review", "evidence", "REV-NOHASH.json"), JSON.stringify({reviewedCommit: "b".repeat(40), reviewResultText: null, reviewResultSha256: null}) + "\n");
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "M", objective: "O", acceptanceCriteria: ["c"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId}, m.missionId, to, "test", "FOUNDER_LOCAL");
  const run = store.createRun({tenantId, missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: "FOUNDER_LOCAL"});
  const leased = store.acquireRunLease(run.runId, 600_000, "ENGINE");
  const leaseId = leased.leaseId as string;
  store.transitionRun(run.runId, leaseId, "RUNNING", "go", "ENGINE");
  const goodRel = `runs/${run.runId}/logs/verify-c0-a1-test-aaaaaa.log`, noHashRel = `runs/${run.runId}/logs/review-c0-a1-diff-bbbbbb.log`;
  const goodText = "$ node test.mjs\n[exit=0]\nok\n";
  put(path.join(dataDir, goodRel), goodText);
  put(path.join(dataDir, noHashRel), "no recorded hash here\n");
  const base = {step: "VERIFY" as const, cycle: 0, kind: "TEST", argv: ["node", "test.mjs"], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0};
  store.addRunEvidence(run.runId, leaseId, {...base, logPath: goodRel, logSha256: sha(goodText), commitSha: "c".repeat(40)}, "ENGINE");
  store.addRunEvidence(run.runId, leaseId, {...base, kind: "DIFF", logPath: noHashRel, logSha256: null}, "ENGINE");
  store.addRunEvidence(run.runId, leaseId, {...base, kind: "NOTE", logPath: null, logSha256: null}, "ENGINE");
  store.transitionRun(run.runId, leaseId, "CHECKPOINTING", "cp", "ENGINE");
  store.checkpointRun(run.runId, leaseId, {step: "VERIFY", data: {ok: true}}, "ENGINE");
  return {repo, dataDir, runtime, store, runId: run.runId, missionId: m.missionId, projectId: p.projectId, leaseId,
    logs: {good: path.join(dataDir, goodRel), goodRel, noHash: path.join(dataDir, noHashRel), noHashRel}};
}
const index = (c: Ctx, tenantId = "tA", extra: Record<string, unknown> = {}) =>
  new EvidenceIndex({repoRoot: c.repo, dataDir: c.dataDir, scope: {tenantId}, store: () => new WorkOsStore(c.dataDir), includeRepositoryEvidence: true, ...extra});
const server = (c: Ctx, tenantId = "tA", extra: Record<string, unknown> = {}) =>
  buildServer({controlToken: TOKEN, runtime: c.runtime, repoRoot: c.repo, dataDir: c.dataDir, tenantId, port: 3210, logger: false, ...extra});
async function all(idx: EvidenceIndex, q: Record<string, unknown> = {}): Promise<EvidenceItem[]> {
  const out: EvidenceItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) { const p = await idx.list({...q, cursor, limit: 100}); out.push(...p.items); if (!p.nextCursor) return out; cursor = p.nextCursor; }
  throw new Error("pagination did not end");
}
const by = (items: EvidenceItem[], pred: (i: EvidenceItem) => boolean) => { const f = items.filter(pred); if (f.length !== 1) throw new Error(`expected 1 item, got ${f.length}`); return f[0]; };
const byPath = (items: EvidenceItem[], suffix: string) => by(items, i => i.source.path?.endsWith(suffix) === true);
function assertNoAbsolute(body: string) {
  const forms = (p: string) => [p, p.split("\\").join("/"), p.split("/").join("\\"), JSON.stringify(p).slice(1, -1)];
  // //TR: PQ-006: alt dize kontrolü olduğu gibi korunur (zayıflatılmaz); HOME=/root başarısızlığı yanlış pozitif değil gerçek bir ürün sızıntısıydı ve ürün düzeltildi. Yalnız "/" gibi boş kalan biçim atlanır (her gövdede bulunur).
  for (const root of [tmp, os.homedir(), path.resolve(import.meta.dirname, ".."), os.tmpdir()])
    for (const f of forms(root)) if (f.replace(/[\\/]+$/, "").length > 0) expect(body.toLowerCase().includes(f.toLowerCase()), `absolute path leaked: ${f}`).toBe(false);
  expect(/\b[A-Za-z]:(?:\\|\/)/.test(body), "drive-letter path").toBe(false);
  expect(/(?:^|[^A-Za-z0-9.])\/(?:home|Users|tmp|var)\//.test(body), "posix absolute path").toBe(false);
  // //TR: PQ-006: root kullanıcısının ev dizini (/root, macOS /var/root) HOME ne olursa olsun yakalanır; "/rootfs" veya göreli "x/root" sızıntı sayılmaz.
  expect(/(?<![A-Za-z0-9._~-])\/(?:var\/)?root(?![A-Za-z0-9._~-])/i.test(body), "root home path").toBe(false);
}

describe("B10A core: verified evidence read-model", () => {
  it("enumerates all four kinds with scopes and recomputed hashes (VERIFIED)", { timeout: T }, async () => {
    const c = setup();
    const items = await all(index(c));
    const kinds = items.map(i => i.kind);
    expect(kinds.filter(k => k === "WORK_RUN_STEP").length).toBe(4); // 3 evidence + 1 checkpoint
    expect(kinds.filter(k => k === "WORK_RUN_LOG").length).toBe(2);
    expect(kinds.filter(k => k === "REVIEW_EVIDENCE").length).toBe(2);
    expect(kinds.filter(k => k === "AUDIT_CHECKPOINT").length).toBe(3);
    const log = byPath(items, "verify-c0-a1-test-aaaaaa.log");
    expect(log.verification.status).toBe("VERIFIED");
    expect(log.source.sha256).toBe(sha(fs.readFileSync(c.logs.good)));
    expect(log.source.sizeBytes).toBe(fs.statSync(c.logs.good).size);
    expect(log.commit).toBe("c".repeat(40));
    expect(log.scope).toEqual({tenantId: "tA", projectId: c.projectId, missionId: c.missionId, runId: c.runId});
    expect(log.evidenceId).toMatch(/^evi_[0-9a-f]{32}$/);
    for (const s of items.filter(i => i.kind === "WORK_RUN_STEP")) { expect(s.verification.status).toBe("VERIFIED"); expect(s.source.path).toBe("journal.jsonl"); expect(s.scope.runId).toBe(c.runId); }
    const rev = byPath(items, "REV-ONE.json");
    expect(rev.verification.status).toBe("VERIFIED");
    expect(rev.commit).toBe("a".repeat(40));
    expect(rev.createdAt).toBe("2026-10-14T10:00:00.000Z");
    expect(rev.source.path).toBe(".ai/cache/review/evidence/REV-ONE.json");
    expect(rev.scope).toEqual({tenantId: null, projectId: null, missionId: null, runId: null});
    const cp = byPath(items, "CP-ONE.json");
    expect(cp.verification.status).toBe("VERIFIED");
    expect(cp.commit).toBe(git(c.repo, ["rev-parse", "HEAD"]));
    expect(cp.createdAt).not.toBeNull();
    expect(cp.verification.basis).toBe("GIT_BLOB_ID");
  });

  it("tampered file -> MISMATCH while the evidenceId stays stable", { timeout: T }, async () => {
    const c = setup();
    const before = await all(index(c));
    fs.appendFileSync(c.logs.good, "tampered\n");
    fs.writeFileSync(path.join(c.repo, "audit", "checkpoints", "CP-ONE.json"), '{"checkpoint":"changed"}\n');
    const rf = path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-ONE.json");
    fs.writeFileSync(rf, reviewRecord({reviewResultText: '{"verdict":"BLOCKED"}'}));
    const after = await all(index(c));
    for (const suffix of ["verify-c0-a1-test-aaaaaa.log", "CP-ONE.json", "REV-ONE.json"]) {
      const a = byPath(before, suffix), b = byPath(after, suffix);
      expect(a.verification.status).toBe("VERIFIED");
      expect(b.verification.status).toBe("MISMATCH");
      expect(b.evidenceId).toBe(a.evidenceId);
      expect(b.verification.reason).toBeTruthy();
    }
    // the recomputed hash is reported, not the stored one
    expect(byPath(after, "verify-c0-a1-test-aaaaaa.log").source.sha256).toBe(sha(fs.readFileSync(c.logs.good)));
  });

  it("deleted file -> MISSING (log and committed checkpoint)", { timeout: T }, async () => {
    const c = setup();
    fs.rmSync(c.logs.good);
    fs.rmSync(path.join(c.repo, "audit", "checkpoints", "CP-TWO.json"));
    const items = await all(index(c));
    const log = byPath(items, "verify-c0-a1-test-aaaaaa.log"), cp = byPath(items, "CP-TWO.json");
    expect(log.verification.status).toBe("MISSING");
    expect(log.source.sha256).toBeNull();
    expect(cp.verification.status).toBe("MISSING");
    expect(cp.source.sizeBytes).toBeNull();
  });

  it("no recorded hash -> UNVERIFIABLE (never VERIFIED)", { timeout: T }, async () => {
    const c = setup();
    const items = await all(index(c));
    expect(byPath(items, "review-c0-a1-diff-bbbbbb.log").verification).toMatchObject({status: "UNVERIFIABLE", reason: "NO_RECORDED_HASH"});
    expect(byPath(items, "REV-NOHASH.json").verification).toMatchObject({status: "UNVERIFIABLE", reason: "NO_RECORDED_HASH"});
    expect(byPath(items, "CP-UNTRACKED.json").verification).toMatchObject({status: "UNVERIFIABLE", reason: "NOT_COMMITTED"});
    // a stored PASS string is never trusted: a record that merely says PASS stays unverifiable
    put(path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-PASS.json"), JSON.stringify({verification: "PASS", verdict: "CLEAN", status: "VERIFIED"}));
    expect(byPath(await all(index(c)), "REV-PASS.json").verification.status).toBe("UNVERIFIABLE");
    expect(byPath(await all(index(c)), "REV-PASS.json").verification.status).not.toBe("VERIFIED");
  });

  it("file-size cap: oversized files are not hashed into memory and become UNVERIFIABLE", { timeout: T }, async () => {
    const c = setup();
    const items = await all(index(c, "tA", {maxHashBytes: 10, maxJsonBytes: 10}));
    expect(byPath(items, "verify-c0-a1-test-aaaaaa.log").verification).toMatchObject({status: "UNVERIFIABLE", reason: "FILE_TOO_LARGE_TO_HASH"});
    expect(byPath(items, "verify-c0-a1-test-aaaaaa.log").source.sha256).toBeNull();
    expect(byPath(items, "REV-ONE.json").verification.reason).toBe("FILE_TOO_LARGE_TO_HASH");
    // a big file under the hash cap but over the JSON cap is hashed (streamed) yet cannot be parsed
    const big = path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-BIG.json");
    fs.writeFileSync(big, JSON.stringify({pad: "x".repeat(300_000)}));
    const it2 = byPath(await all(index(c, "tA", {maxJsonBytes: 1000})), "REV-BIG.json");
    expect(it2.verification.reason).toBe("FILE_TOO_LARGE_TO_PARSE");
    expect(it2.source.sha256).toBe(sha(fs.readFileSync(big)));
  });

  it("path traversal and absolute recorded log paths are rejected and never read", { timeout: T }, async () => {
    const c = setup();
    const secret = path.join(tmp, "outside-secret.txt");
    put(secret, `top secret ${FAKE_AWS}\n`);
    const other = setup("tA"); // another run's log must not be addressable from this run
    const base = {step: "VERIFY" as const, cycle: 0, kind: "EVIL", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0};
    const evil = ["../outside-secret.txt", `runs/${c.runId}/logs/../../../outside-secret.txt`, secret, secret.split(path.sep).join("/"), "runs\\x\\y.log", `runs/${c.runId}/../${path.basename(c.logs.good)}`, other.logs.goodRel, "journal.jsonl", `${c.logs.goodRel}/`, "runs//x.log"];
    for (const p of evil) c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: p, logSha256: sha(fs.readFileSync(secret))}, "ENGINE");
    const idx = index(c);
    const logs = (await all(idx, {kind: "WORK_RUN_LOG"}));
    const rejected = logs.filter(i => i.source.path === null);
    // every evil path is either null-pathed (rejected) or at most unverifiable/missing; none is VERIFIED
    expect(logs.length).toBe(2 + evil.length);
    for (const i of logs.filter(l => !l.source.path?.startsWith(`runs/${c.runId}/logs/verify-c0`) && !l.source.path?.includes("review-c0"))) expect(i.verification.status).not.toBe("VERIFIED");
    expect(rejected.length).toBeGreaterThanOrEqual(7);
    for (const i of rejected) expect(i.verification).toMatchObject({status: "UNVERIFIABLE", reason: "PATH_REJECTED"});
    for (const i of logs) { const d = await idx.get(i.evidenceId); expect(JSON.stringify(d)).not.toContain(FAKE_AWS); if (i.source.path === null) expect(d?.tail).toBeNull(); }
    // API: malformed and traversal ids never reach the filesystem
    const app = server(c);
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "evi_zz", "evi_" + "0".repeat(31), "evi_" + "0".repeat(33), "%2e%2e", "C%3A%5CWindows"]) {
      const r = await app.inject({method: "GET", url: `/v1/evidence/${bad}`, headers: hdr});
      expect([400, 404]).toContain(r.statusCode);
      expect(r.statusCode).not.toBe(200);
    }
    expect((await app.inject({method: "GET", url: "/v1/evidence/evi_" + "0".repeat(32), headers: hdr})).statusCode).toBe(404);
    await app.close();
  });

  it("symlink escaping the allowed root is rejected (skipped if the OS refuses symlinks)", { timeout: T }, async ctx => {
    const c = setup();
    const outside = path.join(tmp, "outside.txt");
    put(outside, `outside ${FAKE_AWS}\n`);
    const link = path.join(c.dataDir, "runs", c.runId, "logs", "escape.log");
    try { fs.symlinkSync(outside, link, "file"); } catch (e) {
      if (["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes((e as NodeJS.ErrnoException).code ?? "")) { console.warn("SKIPPED: symlink creation not permitted on this host"); ctx.skip(); return; }
      throw e;
    }
    c.store.addRunEvidence(c.runId, c.leaseId, {step: "VERIFY", cycle: 0, kind: "LINK", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0, logPath: `runs/${c.runId}/logs/escape.log`, logSha256: sha(fs.readFileSync(outside))}, "ENGINE");
    // review dir symlinked file and checkpoint symlinked file
    fs.symlinkSync(outside, path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-LINK.json"), "file");
    fs.symlinkSync(outside, path.join(c.repo, "audit", "checkpoints", "CP-LINK.json"), "file");
    const idx = index(c);
    const items = await all(idx);
    // Run log: a rejected (escaping) logPath is never exposed, so source.path is null (safePath=null); select the single rejected WORK_RUN_LOG by kind + reason.
    const esc = by(items, x => x.kind === "WORK_RUN_LOG" && x.verification.reason === "PATH_REJECTED");
    expect(esc.source.path).toBeNull();
    expect(items.some(x => x.source.path?.endsWith("escape.log") === true)).toBe(false);
    // Review result and checkpoint keep their (in-repo) listing name but are equally rejected.
    for (const i of [esc, byPath(items, "REV-LINK.json"), byPath(items, "CP-LINK.json")]) {
      expect(i.verification).toMatchObject({status: "UNVERIFIABLE", reason: "PATH_REJECTED"});
      expect(i.source.sha256).toBeNull();
      expect(JSON.stringify(await idx.get(i.evidenceId))).not.toContain(FAKE_AWS);
    }
  });

  it("a directory junction/symlink inside the run directory that points outside is rejected", { timeout: T }, async ctx => {
    const c = setup();
    const outsideDir = path.join(tmp, "outside-logs");
    const text = `outside ${FAKE_AWS}
`;
    put(path.join(outsideDir, "x.log"), text);
    try { fs.symlinkSync(outsideDir, path.join(c.dataDir, "runs", c.runId, "linked"), "junction"); } catch (e) {
      if (["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes((e as NodeJS.ErrnoException).code ?? "")) { console.warn("SKIPPED: junction creation not permitted on this host"); ctx.skip(); return; }
      throw e;
    }
    c.store.addRunEvidence(c.runId, c.leaseId, {step: "VERIFY", cycle: 0, kind: "LINK", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0, logPath: `runs/${c.runId}/linked/x.log`, logSha256: sha(text)}, "ENGINE");
    const idx = index(c);
    const i = by(await all(idx), x => x.kind === "WORK_RUN_LOG" && x.verification.reason === "PATH_REJECTED");
    expect(i.verification.status).toBe("UNVERIFIABLE");
    expect(i.source.sha256).toBeNull();
    const d = await idx.get(i.evidenceId);
    expect(d?.tail).toBeNull();
    expect(JSON.stringify(d)).not.toContain(FAKE_AWS);
  });

  it("symlinked review evidence directory escaping the repo marks the source ERROR", { timeout: T }, async ctx => {
    const c = setup();
    const outsideDir = path.join(tmp, "outside-dir");
    put(path.join(outsideDir, "REV-OUT.json"), reviewRecord());
    fs.rmSync(path.join(c.repo, ".ai", "cache", "review", "evidence"), {recursive: true, force: true});
    try { fs.symlinkSync(outsideDir, path.join(c.repo, ".ai", "cache", "review", "evidence"), "junction"); } catch (e) {
      if (["EPERM", "EACCES", "ENOSYS", "UNKNOWN"].includes((e as NodeJS.ErrnoException).code ?? "")) { console.warn("SKIPPED: symlink creation not permitted on this host"); ctx.skip(); return; }
      throw e;
    }
    const page = await index(c).list({limit: 100});
    expect(page.sources.review).toBe("ERROR");
    expect(page.items.some(i => i.source.path?.includes("REV-OUT"))).toBe(false);
  });

  it("tenant isolation and repository-level visibility", { timeout: T }, async () => {
    const c = setup("tA");
    const a = await all(index(c, "tA")), b = await all(index(c, "tB"));
    expect(a.filter(i => i.scope.tenantId === "tA").length).toBe(6);
    expect(b.filter(i => i.kind === "WORK_RUN_STEP" || i.kind === "WORK_RUN_LOG").length).toBe(0);
    expect(b.some(i => i.scope.tenantId !== null)).toBe(false);
    // a principal that is not FOUNDER_LOCAL sees no repository-level evidence at all
    const nonFounder = await all(index(c, "tA", {includeRepositoryEvidence: false}));
    expect(nonFounder.every(i => i.kind === "WORK_RUN_STEP" || i.kind === "WORK_RUN_LOG")).toBe(true);
    // API: tenant B cannot fetch tenant A's work-run evidence by id
    const appA = server(c, "tA"), appB = server(c, "tB"), appX = server(c, "tA", {actor: "SOMEONE_ELSE"});
    const idA = by(a, i => i.kind === "WORK_RUN_LOG" && i.verification.status === "VERIFIED").evidenceId;
    expect((await appA.inject({method: "GET", url: `/v1/evidence/${idA}`, headers: hdr})).statusCode).toBe(200);
    expect((await appB.inject({method: "GET", url: `/v1/evidence/${idA}`, headers: hdr})).statusCode).toBe(404);
    expect((await appB.inject({method: "GET", url: `/v1/evidence?runId=${c.runId}`, headers: hdr})).json().evidence).toEqual([]);
    const idRepo = by(a, i => i.kind === "AUDIT_CHECKPOINT" && i.source.path!.endsWith("CP-ONE.json")).evidenceId;
    expect((await appB.inject({method: "GET", url: `/v1/evidence/${idRepo}`, headers: hdr})).statusCode).toBe(200); // FOUNDER_LOCAL principal
    expect((await appX.inject({method: "GET", url: `/v1/evidence/${idRepo}`, headers: hdr})).statusCode).toBe(404);
    await Promise.all([appA.close(), appB.close(), appX.close()]);
  });

  it("pagination has a stable total order, no duplicates and bounded limits", { timeout: T }, async () => {
    const c = setup();
    const idx = index(c);
    const full = await all(idx);
    const paged: string[] = [];
    let cursor: string | undefined, pages = 0;
    for (;;) {
      const p = await idx.list({limit: 3, cursor});
      expect(p.items.length).toBeLessThanOrEqual(3);
      paged.push(...p.items.map(i => i.evidenceId));
      pages += 1;
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(pages).toBeGreaterThan(1);
    expect(paged).toEqual(full.map(i => i.evidenceId));
    expect(new Set(paged).size).toBe(paged.length);
    // repeated listing returns the same order
    expect((await all(idx)).map(i => i.evidenceId)).toEqual(paged);
    // a new item sorts into place without shifting what was already seen
    put(path.join(c.repo, "audit", "checkpoints", "ZZZ-NEW.json"), "{}\n");
    const again = (await all(idx)).map(i => i.evidenceId);
    expect(again.filter(x => paged.includes(x))).toEqual(paged);
    for (const bad of [0, 101, -1, 1.5, NaN]) await expect(idx.list({limit: bad as number})).rejects.toBeInstanceOf(EvidenceInputError);
    await expect(idx.list({cursor: "!!!"})).rejects.toBeInstanceOf(EvidenceInputError);
    await expect(idx.list({cursor: Buffer.from("garbage").toString("base64url")})).rejects.toBeInstanceOf(EvidenceInputError);
  });

  it("log tail is at most 4 KB, redacted and scrubbed of absolute paths", { timeout: T }, async () => {
    const c = setup();
    const rel = `runs/${c.runId}/logs/verify-c0-a1-big-cccccc.log`;
    const file = path.join(c.dataDir, rel);
    const head = "A".repeat(5000) + "\n";
    const middle = `leaked ${FAKE_GH} here\nkey=${FAKE_AWS}\n`;
    const text = head + middle + "B".repeat(3000) + `\npath ${c.repo} and ${c.dataDir}\n` + "tail-end\n";
    put(file, text);
    c.store.addRunEvidence(c.runId, c.leaseId, {step: "VERIFY", cycle: 0, kind: "BIG", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0, logPath: rel, logSha256: sha(text)}, "ENGINE");
    // token straddling the 4 KB window start
    const rel2 = `runs/${c.runId}/logs/verify-c0-a1-edge-dddddd.log`;
    const text2 = "x".repeat(2000) + FAKE_GH + "y".repeat(TAIL_BYTES - 20) + "\n";
    put(path.join(c.dataDir, rel2), text2);
    c.store.addRunEvidence(c.runId, c.leaseId, {step: "VERIFY", cycle: 0, kind: "EDGE", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0, logPath: rel2, logSha256: sha(text2)}, "ENGINE");
    const app = server(c);
    const list = (await app.inject({method: "GET", url: "/v1/evidence?kind=WORK_RUN_LOG&limit=100", headers: hdr})).json().evidence as EvidenceItem[];
    for (const suffix of ["big-cccccc.log", "edge-dddddd.log"]) {
      const item = byPath(list, suffix);
      const res = await app.inject({method: "GET", url: `/v1/evidence/${item.evidenceId}`, headers: hdr});
      expect(res.statusCode).toBe(200);
      const body = res.body, json = res.json();
      expect(body).not.toContain(FAKE_GH);
      expect(body).not.toContain(FAKE_AWS);
      expect(body).not.toContain(FAKE_GH.slice(4, 24)); // no fragment of the token either
      expect(Buffer.byteLength(json.tail.text, "utf8")).toBeLessThanOrEqual(TAIL_BYTES);
      expect(json.tail.truncated).toBe(true);
      expect(json.tail.redacted).toBe(true);
      assertNoAbsolute(body);
    }
    const big = (await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "big-cccccc.log").evidenceId}`, headers: hdr})).json();
    expect(big.tail.text).toContain("[REDACTED:AWS_ACCESS_KEY]");
    expect(big.tail.text).toContain("[REDACTED:GITHUB_TOKEN]");
    expect(big.tail.text).toContain("tail-end");
    // a tampered log withholds its tail entirely
    fs.appendFileSync(file, "more\n");
    const t = (await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "big-cccccc.log").evidenceId}`, headers: hdr})).json();
    expect(t.evidence.verification.status).toBe("MISMATCH");
    expect(t.tail).toBeNull();
    expect(t.tailWithheld).toBe("VERIFICATION_MISMATCH");
    await app.close();
  });

  it("a tampered Work OS journal makes the source ERROR (fail closed, no counts)", { timeout: T }, async () => {
    const c = setup();
    const jf = path.join(c.dataDir, "journal.jsonl");
    const lines = fs.readFileSync(jf, "utf8").split("\n");
    lines[2] = lines[2].replace(/"actor":"[^"]*"/, '"actor":"EVIL"');
    fs.writeFileSync(jf, lines.join("\n"));
    const idx = index(c);
    expect((await idx.summary())).toMatchObject({state: "ERROR", total: null, verified: null});
    const app = server(c);
    const ck = (await app.inject({method: "GET", url: "/v1/cockpit", headers: hdr})).json();
    expect(ck.evidence).toMatchObject({state: "ERROR", total: null});
    await app.close();
  });
});

describe("B10A API", () => {
  it("requires the control token and validates query parameters", { timeout: T }, async () => {
    const c = setup();
    const app = server(c);
    expect((await app.inject({method: "GET", url: "/v1/evidence", headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/evidence/evi_" + "0".repeat(32), headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
    const bad: Array<[string, string]> = [["kind=NOPE", "INVALID_KIND"], ["missionId=msn_x", "INVALID_MISSION_ID"], ["runId=run_x", "INVALID_RUN_ID"], ["limit=0", "INVALID_LIMIT"], ["limit=101", "INVALID_LIMIT"], ["limit=abc", "INVALID_LIMIT"], ["limit=1.5", "INVALID_LIMIT"], ["cursor=%00", "INVALID_CURSOR"], ["cursor=" + "a".repeat(1600), "INVALID_CURSOR"], ["cursor=AAAA", "INVALID_CURSOR"], ["kind=WORK_RUN_LOG&kind=WORK_RUN_STEP", "INVALID_KIND"]];
    for (const [qs, err] of bad) { const r = await app.inject({method: "GET", url: `/v1/evidence?${qs}`, headers: hdr}); expect(r.statusCode, qs).toBe(400); expect(r.json().error).toBe(err); }
    // read-only: GET works while GLOBAL_STOP is active, and nothing is written to the data dir or repo
    fs.writeFileSync(path.join(c.runtime, "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", at: new Date().toISOString()}));
    // The Work OS store itself may rewrite its derived snapshot cache when it loads (existing store behavior, not evidence code); the journal and everything else must stay byte-identical.
    const snap = () => [c.dataDir, c.repo].map(d => fs.readdirSync(d, {recursive: true}).map(String).filter(f => !/^snapshot.json(.prev)?$/.test(f)).sort().map(f => { const full = path.join(d, f), st = fs.statSync(full); return `${f}:${st.isFile() ? sha(fs.readFileSync(full)) : "d"}`; }).join("|")).join("##");
    const before = snap();
    const r = await app.inject({method: "GET", url: "/v1/evidence?limit=100", headers: hdr});
    expect(r.statusCode === 200 || r.statusCode === 423, "GET list").toBe(true);
    expect(r.statusCode).toBe(200);
    expect(snap()).toBe(before);
    await app.close();
  });

  it("filters by kind, missionId and runId; repository evidence is excluded from scoped queries", { timeout: T }, async () => {
    const c = setup();
    const app = server(c);
    const get = async (qs: string) => (await app.inject({method: "GET", url: `/v1/evidence?${qs}`, headers: hdr})).json();
    const logs = await get("kind=WORK_RUN_LOG&limit=100");
    expect(logs.evidence.length).toBe(2);
    expect(logs.evidence.every((i: EvidenceItem) => i.kind === "WORK_RUN_LOG")).toBe(true);
    expect(logs.sources).toEqual({workos: "AVAILABLE", review: "NOT_QUERIED", checkpoints: "NOT_QUERIED"});
    expect((await get("kind=AUDIT_CHECKPOINT&limit=100")).evidence.length).toBe(3);
    expect((await get("kind=REVIEW_EVIDENCE&limit=100")).evidence.length).toBe(2);
    const scoped = await get(`missionId=${c.missionId}&limit=100`);
    expect(scoped.evidence.length).toBe(6);
    expect(scoped.evidence.every((i: EvidenceItem) => i.scope.missionId === c.missionId)).toBe(true);
    expect((await get(`runId=${c.runId}&kind=WORK_RUN_STEP&limit=100`)).evidence.length).toBe(4);
    expect((await get(`runId=run_${"0".repeat(24)}&limit=100`)).evidence).toEqual([]);
    expect((await get(`missionId=msn_${"0".repeat(24)}&limit=100`)).evidence).toEqual([]);
    const everything = await get("limit=100");
    expect(everything.evidence.length).toBe(11);
    expect(everything.nextCursor).toBeNull();
    // pagination over the API
    const p1 = await get("limit=4"), p2 = await get(`limit=4&cursor=${p1.nextCursor}`);
    expect(p1.evidence.length).toBe(4);
    expect(p2.evidence.map((i: EvidenceItem) => i.evidenceId)).toEqual(everything.evidence.slice(4, 8).map((i: EvidenceItem) => i.evidenceId));
    // detail carries metadata + verification (no tail for non-log kinds)
    const one = by(everything.evidence, (i: EvidenceItem) => i.kind === "AUDIT_CHECKPOINT" && i.source.path!.endsWith("CP-ONE.json"));
    const d = (await app.inject({method: "GET", url: `/v1/evidence/${one.evidenceId}`, headers: hdr})).json();
    expect(d.evidence).toEqual({...one, verification: {...one.verification, checkedAt: d.evidence.verification.checkedAt}});
    expect(d.tail).toBeNull();
    await app.close();
  });

  it("cockpit gets a correct evidence block and existing fields are unchanged", { timeout: T }, async () => {
    const c = setup();
    fs.appendFileSync(c.logs.good, "x");                                       // MISMATCH
    fs.rmSync(path.join(c.repo, "audit", "checkpoints", "CP-TWO.json"));        // MISSING
    const app = server(c);
    const ck = (await app.inject({method: "GET", url: "/v1/cockpit", headers: hdr})).json();
    for (const k of ["generatedAt", "globalStop", "projects", "missions", "awaitingApproval", "orchestrator", "workforce", "legacy"]) expect(ck).toHaveProperty(k);
    expect(ck.evidence).toEqual({state: "VERIFIED", total: 11, verified: 6, mismatch: 1, missing: 1, unverifiable: 3, sources: {workos: "AVAILABLE", review: "AVAILABLE", checkpoints: "AVAILABLE"}});
    expect(ck.evidence.verified + ck.evidence.mismatch + ck.evidence.missing + ck.evidence.unverifiable).toBe(ck.evidence.total);
    assertNoAbsolute(JSON.stringify(ck));
    await app.close();
  });

  it("absent sources are UNAVAILABLE with null counts (no invented numbers)", { timeout: T }, async () => {
    const empty = path.join(tmp, "empty-repo"), emptyData = path.join(tmp, "empty-data");
    fs.mkdirSync(empty, {recursive: true}); fs.mkdirSync(emptyData, {recursive: true});
    const app = buildServer({controlToken: TOKEN, runtime: path.join(tmp, "rt"), repoRoot: empty, dataDir: emptyData, tenantId: "tA", port: 3210, logger: false});
    const ck = (await app.inject({method: "GET", url: "/v1/cockpit", headers: hdr})).json();
    expect(ck.evidence).toEqual({state: "UNAVAILABLE", total: null, verified: null, mismatch: null, missing: null, unverifiable: null, sources: {workos: "UNAVAILABLE", review: "UNAVAILABLE", checkpoints: "UNAVAILABLE"}});
    const list = await app.inject({method: "GET", url: "/v1/evidence", headers: hdr});
    expect(list.statusCode).toBe(200);
    expect(list.json().evidence).toEqual([]);
    expect((await app.inject({method: "GET", url: "/v1/evidence/evi_" + "1".repeat(32), headers: hdr})).statusCode).toBe(404);
    await app.close();
  });

  it("no absolute user path appears in any list, detail or error response body", { timeout: T }, async () => {
    const c = setup();
    // hostile recorded paths and a log full of absolute paths
    const rel = `runs/${c.runId}/logs/verify-c0-a1-paths-eeeeee.log`;
    const text = `cwd=${c.repo}\ndata=${c.dataDir}\nhome=${os.homedir()}\nC:\\Users\\someone\\secret\n/home/someone/x\n`;
    put(path.join(c.dataDir, rel), text);
    const base = {step: "VERIFY" as const, cycle: 0, kind: "P", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0};
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: rel, logSha256: sha(text)}, "ENGINE");
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: path.join(tmp, "abs.log"), logSha256: null}, "ENGINE");
    const app = server(c);
    const list = await app.inject({method: "GET", url: "/v1/evidence?limit=100", headers: hdr});
    assertNoAbsolute(list.body);
    for (const i of list.json().evidence as EvidenceItem[]) {
      const d = await app.inject({method: "GET", url: `/v1/evidence/${i.evidenceId}`, headers: hdr});
      expect(d.statusCode).toBe(200);
      assertNoAbsolute(d.body);
    }
    for (const u of ["/v1/evidence?kind=x", "/v1/evidence/not-an-id", `/v1/evidence/evi_${"2".repeat(32)}`, "/v1/evidence?cursor=zzzz"]) assertNoAbsolute((await app.inject({method: "GET", url: u, headers: hdr})).body);
    assertNoAbsolute((await app.inject({method: "GET", url: "/v1/cockpit", headers: hdr})).body);
    await app.close();
  });
});

// //TR: PQ-006 (Founder kapsam genişletmesi): Evidence API yanıtında gerçek mutlak kullanıcı dizini yolu görünmez. Linux, macOS ve Windows yazımları (ayraç, büyük/küçük harf, JSON kaçışı, 8.3 kısa ad) maskelenir; benzer görünen ama kullanıcı dizini olmayan metin olduğu gibi kalır.
describe("PQ-006: no user-directory path leaves the Evidence API", () => {
  const base = {step: "VERIFY" as const, cycle: 0, kind: "PATHS", argv: [], startedAt: "2026-10-14T10:00:00.000Z", endedAt: "2026-10-14T10:00:01.000Z", exitCode: 0};
  async function tailOf(c: Ctx, name: string, text: string) {
    const rel = `runs/${c.runId}/logs/verify-c0-a1-${name}.log`;
    put(path.join(c.dataDir, rel), text);
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: rel, logSha256: sha(text)}, "ENGINE");
    const app = server(c);
    try {
      const list = (await app.inject({method: "GET", url: "/v1/evidence?kind=WORK_RUN_LOG&limit=100", headers: hdr})).json().evidence as EvidenceItem[];
      const res = await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, `${name}.log`).evidenceId}`, headers: hdr});
      expect(res.statusCode).toBe(200);
      return {body: res.body, lines: (res.json().tail.text as string).split("\n")};
    } finally { await app.close(); }
  }
  // [log satırı, API'de beklenen tam satır]
  const POSITIVE: [string, string][] = [
    [String.raw`home=/root`, String.raw`home=<USER_PATH>`],
    [String.raw`key /root/.ssh/id_ed25519`, String.raw`key <USER_PATH>/.ssh/id_ed25519`],
    [String.raw`PATH=/usr/bin:/root/bin`, String.raw`PATH=/usr/bin:<USER_PATH>/bin`],
    [String.raw`{"cwd":"/root/work"}`, String.raw`{"cwd":"<USER_PATH>/work"}`],
    [String.raw`open file:///root/notes.txt`, String.raw`open file:<USER_PATH>/notes.txt`],
    [String.raw`mac /var/root/Library/x`, String.raw`mac <USER_PATH>/Library/x`],
    [String.raw`mac /private/var/root/Library`, String.raw`mac /private<USER_PATH>/Library`],
    [String.raw`wsl \\wsl$\Ubuntu\root\x`, String.raw`wsl <USER_PATH>\x`],
    [String.raw`/home/alice/project/a.ts`, String.raw`<USER_PATH>/project/a.ts`],
    [String.raw`/Users/Bob/Documents`, String.raw`<USER_PATH>/Documents`],
    [String.raw`cd /Users/John\ Smith/proj`, String.raw`cd <USER_PATH>/proj`],
    [String.raw`wsl /mnt/c/users/bob/x`, String.raw`wsl <USER_PATH>/x`],
    [String.raw`bash /c/Users/runneradmin/x`, String.raw`bash <USER_PATH>/x`],
    [String.raw`{"p":"\/home\/alice\/x"}`, String.raw`{"p":"<USER_PATH>\/x"}`],
    [String.raw`C:\Users\bob\AppData\x`, String.raw`<USER_PATH>\AppData\x`],
    [String.raw`c:\users\bob\x`, String.raw`<USER_PATH>\x`],
    [String.raw`C:/Users/bob/x`, String.raw`<USER_PATH>/x`],
    [String.raw`{"p":"C:\\Users\\bob\\x"}`, String.raw`{"p":"<USER_PATH>\\x"}`],
    [String.raw`\\?\C:\Users\bob\x`, String.raw`\\?\<USER_PATH>\x`],
    [String.raw`file:///C:/Users/bob/x`, String.raw`file:///<USER_PATH>/x`],
    [String.raw`D:\Documents and Settings\bob\x`, String.raw`<USER_PATH>\x`],
    [String.raw`tmp C:\Users\RUNNER~1\AppData\Local\Temp\x`, String.raw`tmp <USER_PATH>\AppData\Local\Temp\x`],
    [String.raw`C:\Users\John Smith\Desktop\x`, String.raw`<USER_PATH>\Desktop\x`],
    [String.raw`share \\localhost\c$\Users\bob\x`, String.raw`share \\localhost\<USER_PATH>\x`],
    [String.raw`svc C:\WINDOWS\system32\config\systemprofile\x`, String.raw`svc <USER_PATH>\x`],
    [String.raw`old C:\DOCUME~1\alice\x`, String.raw`old <USER_PATH>\x`],
    [String.raw`wsl \\wsl$\Ubuntu\home\alice\x`, String.raw`wsl <USER_PATH>\x`],
    [String.raw`cwd=C:\Users\John Smith`, String.raw`cwd=<USER_PATH>`],
    [String.raw`warning: C:\Users\bob is not a git repository`, String.raw`warning: <USER_PATH> is not a git repository`],
    // ANSI renk kodu veya kısa bayrak hemen önde olsa da (CI logları, derleyici satırları) yol maskelenir.
    ["\u001b[90m/root/.ssh/id_rsa\u001b[39m", "\u001b[90m<USER_PATH>/.ssh/id_rsa\u001b[39m"],
    ["\u001b[36mc:\\users\\alice\\proj", "\u001b[36m<USER_PATH>\\proj"],
    [String.raw`gcc -I/root/include -L/root/lib`, String.raw`gcc -I<USER_PATH>/include -L<USER_PATH>/lib`],
    [String.raw`docker run -v/root/data:/data`, String.raw`docker run -v<USER_PATH>/data:/data`],
    [String.raw`cl /Ic:\users\bob\inc`, String.raw`cl /I<USER_PATH>\inc`],
  ];
  // Kullanıcı dizini olmayan, benzer görünen metin: maskelenirse kayıt bozulur.
  const NEGATIVE = [String.raw`rel=src/root/x`, String.raw`/rootfs/data`, String.raw`/rooted/y`, String.raw`dir x/root`, String.raw`the word root stays`,
    String.raw`https://example.com/root/page`, String.raw`https://example.com/rootkit`, String.raw`https://api.github.com/users/octocat`, String.raw`/home`, String.raw`/Users`,
    String.raw`~/root and ../root/x`, String.raw`/root.bak /rootä`, String.raw`src\home\Home.tsx(12,5): error TS2322`, String.raw`pages\Users\List.vue`];

  it("Linux, macOS and Windows user-directory spellings are masked exactly; look-alikes are kept verbatim", { timeout: T }, async () => {
    const c = setup();
    const {body, lines} = await tailOf(c, "spellings-ffffff", [...POSITIVE.map(p => p[0]), ...NEGATIVE].join("\n") + "\n");
    expect(lines.slice(0, POSITIVE.length)).toEqual(POSITIVE.map(p => p[1]));
    expect(lines.slice(POSITIVE.length, POSITIVE.length + NEGATIVE.length)).toEqual(NEGATIVE);
    for (const name of ["alice", "bob", "RUNNER~1", "runneradmin", "smith", "systemprofile"]) expect(body.toLowerCase()).not.toContain(name.toLowerCase());
  });

  it("the real home directory is masked whatever its value (HOME / USERPROFILE), in every spelling", { timeout: T }, async () => {
    const saved = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE};
    const home = process.platform === "win32" ? String.raw`D:\uasco-home\carol` : "/srv/uasco-home/carol";
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      expect(os.homedir()).toBe(home);
      const fwd = home.split("\\").join("/"), back = home.split("/").join("\\"), json = back.split("\\").join("\\\\");
      const positive = [`h=${home}`, `${home}/.config/x`, `fwd ${fwd}/x`, `back ${back}\\x`, `json {"h":"${json}\\\\x"}`, `upper ${home.toUpperCase()}`];
      const negative = [`sibling ${home}yn/x`, `parent ${path.dirname(home)}/other`];
      const c = setup();
      const {lines} = await tailOf(c, "home-gggggg", [...positive, ...negative].join("\n") + "\n");
      for (const [i, line] of lines.slice(0, positive.length).entries()) {
        expect(line, positive[i]).toContain("<USER_PATH>");
        expect(line.toLowerCase(), positive[i]).not.toContain("carol");
      }
      expect(lines.slice(positive.length, positive.length + negative.length)).toEqual(negative);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("a home directory with a space is masked plain, shell-escaped and URL-encoded", { timeout: T }, async () => {
    const saved = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE};
    const home = process.platform === "win32" ? String.raw`D:\uasco home\dana` : "/srv/uasco home/dana";
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      const fwd = home.split("\\").join("/");
      const positive = [`plain ${home}/x`, `cd ${fwd.split(" ").join("\\ ")}/x`, `url file://${fwd.split(" ").join("%20")}/x`];
      const c = setup();
      const {lines} = await tailOf(c, "spacehome-nnnnnn", positive.join("\n") + "\n");
      for (const [i, line] of lines.slice(0, positive.length).entries()) { expect(line, positive[i]).toContain("<USER_PATH>"); expect(line, positive[i]).not.toContain("dana"); }
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("text in the detail summary (review reviewerIdentity) is scrubbed the same way", { timeout: T }, async () => {
    const c = setup();
    put(path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-PATHS.json"), reviewRecord({reviewerIdentity: String.raw`REVIEWER /root/.claude C:\Users\bob\x`}));
    const app = server(c);
    try {
      const list = (await app.inject({method: "GET", url: "/v1/evidence?kind=REVIEW_EVIDENCE&limit=100", headers: hdr})).json().evidence as EvidenceItem[];
      const res = await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "REV-PATHS.json").evidenceId}`, headers: hdr});
      expect(res.statusCode).toBe(200);
      expect(res.json().summary.reviewerIdentity).toBe(String.raw`REVIEWER <USER_PATH>/.claude <USER_PATH>\x`);
      assertNoAbsolute(res.body);
      const plain = await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "REV-ONE.json").evidenceId}`, headers: hdr});
      expect(plain.json().summary.reviewerIdentity).toBe("CLAUDE_REVIEWER");
    } finally { await app.close(); }
  });

  it("journal-derived summary text (run evidence kind) is scrubbed in WORK_RUN_LOG and WORK_RUN_STEP details", { timeout: T }, async () => {
    const c = setup();
    const kind = String.raw`K /home/alice/x C:\Users\bob\y`, masked = String.raw`K <USER_PATH>/x <USER_PATH>\y`;
    const rel = `runs/${c.runId}/logs/verify-c0-a1-kind-jjjjjj.log`;
    put(path.join(c.dataDir, rel), "ok\n");
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, kind, logPath: rel, logSha256: sha("ok\n")}, "ENGINE");
    const app = server(c);
    try {
      const list = (await app.inject({method: "GET", url: "/v1/evidence?limit=100", headers: hdr})).json().evidence as EvidenceItem[];
      const details = await Promise.all(list.filter(i => i.kind === "WORK_RUN_LOG" || i.kind === "WORK_RUN_STEP")
        .map(async i => (await app.inject({method: "GET", url: `/v1/evidence/${i.evidenceId}`, headers: hdr}))));
      const withKind = details.filter(d => d.json().summary.evidenceKind === masked);
      expect(withKind.map(d => d.json().evidence.kind).sort()).toEqual(["WORK_RUN_LOG", "WORK_RUN_STEP"]);
      for (const d of details) { expect(d.body).not.toContain("alice"); assertNoAbsolute(d.body); }
    } finally { await app.close(); }
  });

  it("a path cut at the start of the tail window never shows (the partial first line is dropped)", { timeout: T }, async () => {
    const c = setup();
    // Pencere başı (boyut - 4096 - 512 lookback) gizli satırın 2. baytına düşer; kök satırları maskelenince kısalır ve pencere başı çıktıya girer.
    const lead = "x".repeat(10_000) + "\n", secretLine = String.raw`C:\Users\alicesecret\keys` + "\n", rootLine = `cwd=${c.dataDir}/src\n`;
    const restBytes = TAIL_BYTES + 512 + 2 - Buffer.byteLength(secretLine);
    let rest = "";
    while (Buffer.byteLength(rest + rootLine) < restBytes - 20) rest += rootLine;
    rest += "p".repeat(restBytes - Buffer.byteLength(rest) - 1) + "\n";
    const text = lead + secretLine + rest;
    expect(Buffer.byteLength(text) - TAIL_BYTES - 512).toBe(Buffer.byteLength(lead) + 2);
    const {body, lines} = await tailOf(c, "window-hhhhhh", text);
    expect(body).not.toContain("alicesecret");
    expect(lines[0].startsWith("cwd=<ROOT>")).toBe(true);
    assertNoAbsolute(body);
  });

  it("the 4 KB output cut is aligned to a line start: a relative path is never cut into an absolute-looking one", { timeout: T }, async () => {
    const c = setup();
    // Son 4096 bayt kesimi "see src/root/config.json" satırının içine düşer; hizalanmazsa kuyruk "/root/config.json" ile başlardı.
    const line = (i: number) => `line ${String(i).padStart(4, "0")} ${"g".repeat(60)}\n`;
    let after = "";
    for (let i = 0; Buffer.byteLength(after + line(i)) <= 4078 - 30; i++) after += line(i);
    after += "h".repeat(4078 - Buffer.byteLength(after) - 1) + "\n";
    const text = "short\n".repeat(200) + "see src/root/config.json\n" + after;
    expect(Buffer.byteLength(after)).toBe(4078);
    const {body, lines} = await tailOf(c, "cut-kkkkkk", text);
    expect(lines[0]).toBe(line(0).trimEnd());
    expect(body).not.toContain("/root/config.json");
    assertNoAbsolute(body);
  });

  it("masking that makes the text longer still keeps the tail within 4 KB and reports truncated", { timeout: T }, async () => {
    const c = setup();
    const text = "/root\n".repeat(500);
    expect(Buffer.byteLength(text)).toBeLessThan(TAIL_BYTES);
    const rel = `runs/${c.runId}/logs/verify-c0-a1-grow-llllll.log`;
    put(path.join(c.dataDir, rel), text);
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: rel, logSha256: sha(text)}, "ENGINE");
    const app = server(c);
    try {
      const list = (await app.inject({method: "GET", url: "/v1/evidence?kind=WORK_RUN_LOG&limit=100", headers: hdr})).json().evidence as EvidenceItem[];
      const tail = (await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "grow-llllll.log").evidenceId}`, headers: hdr})).json().tail;
      expect(Buffer.byteLength(tail.text, "utf8")).toBeLessThanOrEqual(TAIL_BYTES);
      expect(tail.truncated).toBe(true);
      expect((tail.text as string).split("\n").filter(Boolean).every(l => l === "<USER_PATH>")).toBe(true);
    } finally { await app.close(); }
  });

  it("a window with no line break at all is one partial line: the tail is empty and truncated", { timeout: T }, async () => {
    const c = setup();
    const {lines, body} = await tailOf(c, "oneline-mmmmmm", "x".repeat(3000) + String.raw`C:\Users\bobsecret` + "y".repeat(3000));
    expect(lines).toEqual([""]);
    expect(body).not.toContain("bobsecret");
    expect(JSON.parse(body).tail.truncated).toBe(true);
  });

  it("multi-line log: a secret straddling the 4 KB cut is redacted in full, no fragment shows", { timeout: T }, async () => {
    const c = setup();
    const filler = (n: number) => Array.from({length: n}, (_, i) => `line ${String(i).padStart(4, "0")} ${"f".repeat(80)}`).join("\n") + "\n";
    const after = filler(44);
    const text = filler(30) + `token=${FAKE_GH}\n` + after;
    // 4 KB kesimi maskeleme sonrası metinde token satırının içine düşecek kadar sonrası vardır.
    expect(Buffer.byteLength(after)).toBeLessThan(TAIL_BYTES);
    const {body} = await tailOf(c, "straddle-iiiiii", text);
    expect(body).not.toContain(FAKE_GH);
    expect(body).not.toContain(FAKE_GH.slice(4, 24));
    expect(body).not.toContain(FAKE_GH.slice(-12));
  });

  it("an 80-character reviewerIdentity cut cannot split a path out of the mask", { timeout: T }, async () => {
    const c = setup();
    put(path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-CUT.json"), reviewRecord({reviewerIdentity: "R".repeat(70) + String.raw` C:\Users\bobsecret`}));
    const app = server(c);
    try {
      const list = (await app.inject({method: "GET", url: "/v1/evidence?kind=REVIEW_EVIDENCE&limit=100", headers: hdr})).json().evidence as EvidenceItem[];
      const res = await app.inject({method: "GET", url: `/v1/evidence/${byPath(list, "REV-CUT.json").evidenceId}`, headers: hdr});
      expect(res.json().summary.reviewerIdentity).toBe("R".repeat(70) + " <USER_PAT");
      assertNoAbsolute(res.body);
    } finally { await app.close(); }
  });

  it("createdAt is ISO-8601 only: a path-bearing string that Date.parse accepts becomes null", { timeout: T }, async () => {
    const c = setup();
    expect(Number.isFinite(Date.parse("/root/.ssh 2020"))).toBe(true);
    put(path.join(c.repo, ".ai", "cache", "review", "evidence", "REV-DATE.json"), reviewRecord({runManifest: {startedAt: "/root/.ssh 2020"}}));
    const app = server(c);
    try {
      const res = await app.inject({method: "GET", url: "/v1/evidence?kind=REVIEW_EVIDENCE&limit=100", headers: hdr});
      const items = res.json().evidence as EvidenceItem[];
      expect(byPath(items, "REV-DATE.json").createdAt).toBeNull();
      expect(byPath(items, "REV-ONE.json").createdAt).toBe("2026-10-14T10:00:00.000Z");
      assertNoAbsolute(res.body);
    } finally { await app.close(); }
  });

  it("a recorded log path with a drive segment (runs/<id>/C:/Users/<u>/...) is rejected, never echoed", { timeout: T }, async () => {
    const c = setup();
    c.store.addRunEvidence(c.runId, c.leaseId, {...base, logPath: `runs/${c.runId}/C:/Users/alice/missing.log`, logSha256: null}, "ENGINE");
    const app = server(c);
    try {
      const res = await app.inject({method: "GET", url: "/v1/evidence?kind=WORK_RUN_LOG&limit=100", headers: hdr});
      const rejected = by(res.json().evidence as EvidenceItem[], i => i.source.path === null);
      expect(rejected.verification).toMatchObject({status: "UNVERIFIABLE", reason: "PATH_REJECTED"});
      expect(res.body).not.toContain("alice");
      assertNoAbsolute(res.body);
    } finally { await app.close(); }
  });

  it("the absolute-path checker itself fails on real leaks and passes on look-alikes", () => {
    // Ana makinenin gerçek HOME'u (ör. /root) "/rootfs" gibi benzerlerde alt dize eşleşmesi verir; kontrol bu yüzden genel kalıpların dışındaki nötr bir HOME ile sınanır.
    // Böylece hem genel /root kontrolü hem gerçek ev dizini alt dize kontrolü, ana makineden bağımsız olarak kendi başına kanıtlanır.
    const saved = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE};
    const home = process.platform === "win32" ? String.raw`\\fileserver\uasco-home\carol` : "/srv/uasco-home/carol";
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      expect(os.homedir()).toBe(home);
      const leaks = [String.raw`{"p":"/root/x"}`, String.raw`{"t":"home=/root"}`, String.raw`{"p":"/var/root/x"}`, String.raw`{"p":"C:\\Users\\bob"}`, String.raw`{"p":"/home/alice/x"}`,
        JSON.stringify({p: path.join(home, "x")}), JSON.stringify({p: path.join(tmp, "x")})];
      for (const b of leaks) expect(() => assertNoAbsolute(b), b).toThrow();
      const clean = [String.raw`{"p":"/rootfs/x"}`, String.raw`{"p":"src/root/x"}`, String.raw`{"p":"<ROOT>/x"}`, String.raw`{"p":"<USER_PATH>\\x"}`, String.raw`{"u":"https://example.com/rootkit"}`];
      for (const b of clean) expect(() => assertNoAbsolute(b), b).not.toThrow();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
