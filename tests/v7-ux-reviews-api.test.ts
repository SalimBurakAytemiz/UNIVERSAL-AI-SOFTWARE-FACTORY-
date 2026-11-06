// //TR: Bu test UI-049 salt-okunur bağımsız review kararı API'sini doğrular: (1) GERÇEK MissionRunner + FakeExecutors (gerçek git, gerçek Work OS journal) bir run'ı BLOCKED->CLEAN remediation, reviewer-çalışma-alanı-değişti ve review'a hiç ulaşmayan senaryolarla koşturur; GET /v1/reviews ve GET /v1/reviews/:reviewId bu journal'dan türetilen kararları AYNEN döner, review yoksa NOT_REVIEWED der ve geçersiz kılınan review'ı asla CLEAN saymaz. (2) Tohumlanmış journal ile dürüst durumlar (boş, eski commit'te CLEAN, bağımsızlığı kanıtsız, karar yok), redaksiyon/kırpma, sıkı kimlik doğrulaması (400/404), tenant izolasyonu, token/Host kapısı, yazma yokluğu ve journal'ın değişmemesi. (3) Desktop GET allow-list'i yalnız kanonik review yollarını regex ile kabul eder ve EXTRA_GET_ROUTES kümesi BÜYÜMEZ.
import {describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeScript} from "../core/workos/executors.js";
import type {WorkRun, RunEvidence} from "../core/workos/types.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {testExecutionGate} from "./support/test-sandbox.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
const FAKE_AWS = ["AK", "IA", "Q7ZX3MPLW2RT5VB9"].join(""); // gerçek secret dosyada durmasın diye çalışma anında kurulur
const ID = "ab".repeat(12); // 24 hex

type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
const mkApp = (dataDir: string, runtime: string, tenantId = "tA"): App => {
  fs.mkdirSync(runtime, {recursive: true});
  const a = buildServer({controlToken: TOKEN, runtime, dataDir, tenantId, port: 3210, logger: false});
  apps.push(a); return a;
};
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });
const get = (app: App, url: string, headers: Record<string, string> = hdr) => app.inject({method: "GET", url, headers});
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

// ---------------- (1) REAL MissionRunner journal ----------------
const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nconsole.log("feature=" + v);\nprocess.exit(v === "ok" ? 0 : 1);\n`;

describe("UI-049 — GET /v1/reviews derived from the REAL Work OS journal (MissionRunner + fake executors)", () => {
  let tmp = "", dataDir = "", runtime = "", repoHead = "";
  let store: WorkOsStore;
  const ids = {} as Record<"remediated" | "mutated" | "unreached", {missionId: string; runId: string}>;
  const runOf = (id: string): WorkRun => store.getRun({tenantId: "tA"}, id)!;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-be-reviews-"));
    const repo = path.join(tmp, "src");
    fs.mkdirSync(repo, {recursive: true});
    git(repo, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
    fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
    repoHead = git(repo, ["rev-parse", "HEAD"]);
    dataDir = path.join(tmp, "data"); runtime = path.join(tmp, "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    store = new WorkOsStore(dataDir);
    const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
    const mission = (title: string) => {
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      return m.missionId;
    };
    const drive = async (key: keyof typeof ids, script: FakeScript, extra: Partial<RunnerOptions> = {}) => {
      const fake = new FakeExecutors(script), pair = fake.pair(), missionId = mission(key);
      const run = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
      const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${dataDir}-sec`).options, ...extra});
      await runner.tick();
      ids[key] = {missionId, runId: run.runId};
    };
    // A: reviewer BLOCKED first, then (after bounded remediation with a NEW commit) CLEAN.
    await drive("remediated", {
      implement: n => ({files: {"feature.txt": "ok\n", [`rework-${n}.txt`]: `v${n}\n`}}),
      review: n => n === 1 ? {verdict: "BLOCKED", findings: [{severity: "P1", title: "missing edge case"}]} : {verdict: "CLEAN"}
    });
    // B: reviewer reports CLEAN but touched its read-only clone -> the runner refuses it (REVIEWER_MUTATED_CLONE).
    await drive("mutated", {implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN", mutate: true})});
    // C: tests fail and remediation budget is zero -> the run never reaches the reviewer.
    await drive("unreached", {implement: () => ({files: {"feature.txt": "bad\n"}}), review: () => ({verdict: "CLEAN"})}, {maxRemediations: 0});
  }, T);
  afterAll(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("scenarios produced the expected REAL run outcomes (sanity of the seed)", () => {
    expect(runOf(ids.remediated.runId).status).toBe("AWAITING_APPROVAL");
    expect(runOf(ids.mutated.runId)).toEqual(expect.objectContaining({status: "BLOCKED", reason: "REVIEWER_MUTATED_CLONE"}));
    expect(runOf(ids.unreached.runId).status).toBe("BLOCKED");
    expect(runOf(ids.unreached.runId).evidence.some(e => e.kind === "REVIEW")).toBe(false);
  });

  it("lists real verdicts newest-first with reviewer, commit/range, timestamp and evidence summary", async () => {
    const r = await get(mkApp(dataDir, runtime), "/v1/reviews");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.source).toBe("WORK_OS_JOURNAL_RUN_EVIDENCE");
    expect(j.notice).toMatch(/NOT_REVIEWED/);
    expect(j.summary).toEqual({runs: 3, reviews: 3, runsByReviewState: {CLEAN: 1, NO_VERDICT: 1, NOT_REVIEWED: 1}, reviewsByVerdict: {BLOCKED: 1, CLEAN: 1, NO_VERDICT: 1}, truncated: false});
    const stamps: string[] = j.reviews.map((x: {timestamp: string}) => x.timestamp);
    expect([...stamps].sort().reverse()).toEqual(stamps);

    const runA = runOf(ids.remediated.runId);
    const mine = j.reviews.filter((x: {runId: string}) => x.runId === ids.remediated.runId);
    expect(mine.map((x: {verdict: string}) => x.verdict)).toEqual(["CLEAN", "BLOCKED"]);
    const [clean, blocked] = mine;
    const cleanEv = runA.evidence.filter(e => e.kind === "REVIEW").find(e => e.verdict === "CLEAN")!;
    expect(clean).toEqual(expect.objectContaining({
      reviewId: cleanEv.evidenceId, missionId: ids.remediated.missionId, projectId: runA.projectId, cycle: 1, step: "REVIEW",
      reviewer: {identity: "FAKE_REVIEWER"}, implementer: {identity: "FAKE_IMPLEMENTER"}, independent: true,
      reviewedCommit: runA.headSha, reviewedRange: {baseSha: repoHead, headSha: runA.headSha}, currentHead: true, verdict: "CLEAN",
      startedAt: cleanEv.startedAt, timestamp: cleanEv.endedAt
    }));
    expect(clean.evidence).toEqual(expect.objectContaining({recordedVerdict: "CLEAN", invalidated: null, findingsCount: 0, findings: null, logSha256: cleanEv.logSha256}));
    expect(clean.reviewId).toMatch(/^evd_[0-9a-f]{24}$/);
    // the BLOCKED review was against the OLD commit: it is real history, it does not apply to the current head, and its findings come from the real REMEDIATE checkpoint.
    expect(blocked).toEqual(expect.objectContaining({cycle: 0, verdict: "BLOCKED", currentHead: false, independent: true}));
    expect(blocked.reviewedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(blocked.reviewedCommit).not.toBe(runA.headSha);
    expect(blocked.evidence).toEqual(expect.objectContaining({recordedVerdict: "BLOCKED", findingsCount: 1, findings: ["P1: missing edge case"]}));

    const byRun = new Map<string, {reviewState: string; latestReviewId: string | null; reviewCount: number; headSha: string | null}>(j.runs.map((x: {runId: string}) => [x.runId, x]));
    expect(byRun.get(ids.remediated.runId)).toEqual(expect.objectContaining({reviewState: "CLEAN", latestReviewId: cleanEv.evidenceId, reviewCount: 2, headSha: runA.headSha}));
  });

  it("never implies CLEAN: a verdict the runner invalidated is NO_VERDICT and a run that never reached review is NOT_REVIEWED", async () => {
    const j = (await get(mkApp(dataDir, runtime), "/v1/reviews")).json();
    const mutated = j.reviews.filter((x: {runId: string}) => x.runId === ids.mutated.runId);
    expect(mutated).toHaveLength(1);
    expect(mutated[0].verdict).toBe("NO_VERDICT");
    expect(mutated[0].evidence).toEqual(expect.objectContaining({recordedVerdict: "CLEAN", invalidated: "REVIEW_CLONE_MUTATED"}));
    const runs = new Map<string, {reviewState: string; latestReviewId: string | null; reviewCount: number}>(j.runs.map((x: {runId: string}) => [x.runId, x]));
    expect(runs.get(ids.mutated.runId)!.reviewState).toBe("NO_VERDICT");
    expect(runs.get(ids.unreached.runId)).toEqual(expect.objectContaining({reviewState: "NOT_REVIEWED", latestReviewId: null, reviewCount: 0}));
    expect(j.reviews.some((x: {runId: string}) => x.runId === ids.unreached.runId)).toBe(false);
  });

  it("detail returns the same record plus the run's current review state; BLOCKED detail keeps its history flag", async () => {
    const app = mkApp(dataDir, runtime);
    const list = (await get(app, "/v1/reviews")).json();
    for (const rec of list.reviews) {
      const d = await get(app, `/v1/reviews/${rec.reviewId}`);
      expect(d.statusCode, rec.reviewId).toBe(200);
      const dj = d.json();
      expect(dj.review).toEqual(rec);
      expect(dj.run.runId).toBe(rec.runId);
      expect(dj.source).toBe("WORK_OS_JOURNAL_RUN_EVIDENCE");
    }
    const blocked = list.reviews.find((x: {verdict: string}) => x.verdict === "BLOCKED");
    const d = (await get(app, `/v1/reviews/${blocked.reviewId}`)).json();
    expect(d.review.currentHead).toBe(false);
    expect(d.run.reviewState).toBe("CLEAN"); // the run's CURRENT head was later cleaned by a separate review; the BLOCKED record is not rewritten
  });

  it("filters by missionId and runId (strict), honest empty for a valid but unknown mission", async () => {
    const app = mkApp(dataDir, runtime);
    const byMission = (await get(app, `/v1/reviews?missionId=${ids.unreached.missionId}`)).json();
    expect(byMission.reviews).toEqual([]);
    expect(byMission.runs.map((x: {reviewState: string}) => x.reviewState)).toEqual(["NOT_REVIEWED"]);
    expect(byMission.summary).toEqual({runs: 1, reviews: 0, runsByReviewState: {NOT_REVIEWED: 1}, reviewsByVerdict: {}, truncated: false});
    const byRun = (await get(app, `/v1/reviews?runId=${ids.remediated.runId}`)).json();
    expect(byRun.reviews).toHaveLength(2);
    expect(byRun.runs).toHaveLength(1);
    const both = (await get(app, `/v1/reviews?missionId=${ids.remediated.missionId}&runId=${ids.mutated.runId}`)).json();
    expect(both.reviews).toEqual([]);
    expect(both.runs).toEqual([]);
    const unknown = (await get(app, `/v1/reviews?missionId=msn_${"c".repeat(24)}`)).json();
    expect(unknown).toEqual(expect.objectContaining({reviews: [], runs: []}));
    for (const bad of ["missionId=bad", "missionId=msn_" + "a".repeat(23), "missionId=MSN_" + "a".repeat(24), "missionId=a&missionId=b", "missionId="])
      expect((await get(app, `/v1/reviews?${bad}`)).json().error, bad).toBe("INVALID_MISSION_ID");
    for (const bad of ["runId=bad", "runId=run_" + "a".repeat(23), "runId=RUN_" + "a".repeat(24), "runId=" + ids.remediated.missionId])
      expect((await get(app, `/v1/reviews?${bad}`)).json().error, bad).toBe("INVALID_RUN_ID");
  });

  it("isolates tenants: another tenant sees no reviews and gets 404 for a real review id", async () => {
    const list = (await get(mkApp(dataDir, runtime), "/v1/reviews")).json();
    const other = mkApp(dataDir, runtime, "tB");
    const o = (await get(other, "/v1/reviews")).json();
    expect(o.reviews).toEqual([]);
    expect(o.runs).toEqual([]);
    const r = await get(other, `/v1/reviews/${list.reviews[0].reviewId}`);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({error: "REVIEW_NOT_FOUND"});
  });

  it("is strictly read-only: GETs leave the journal byte-identical and no write verb is exposed", async () => {
    const jf = path.join(dataDir, "journal.jsonl");
    const before = crypto.createHash("sha256").update(fs.readFileSync(jf)).digest("hex");
    const app = mkApp(dataDir, runtime);
    const list = (await get(app, "/v1/reviews")).json();
    await get(app, `/v1/reviews/${list.reviews[0].reviewId}`);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      for (const url of ["/v1/reviews", `/v1/reviews/${list.reviews[0].reviewId}`])
        expect((await app.inject({method, url, headers: hdr, payload: {}})).statusCode, `${method} ${url}`).toBe(404);
    }
    expect(crypto.createHash("sha256").update(fs.readFileSync(jf)).digest("hex")).toBe(before);
  });
});

// ---------------- (2) seeded journal: honest states, redaction, fail-closed ----------------
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-be-reviews-seed-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDirS = () => path.join(tmp, "data");
const runtimeS = () => path.join(tmp, "runtime");
const sha40 = (c: string) => c.repeat(40);

interface SeedReview { at?: number; cycle?: number; verdict?: "CLEAN" | "BLOCKED"; commit?: string | null; reviewer?: string | null; implementer?: string | null; note?: string; findingsCount?: number; exitCode?: number }
interface SeedOpts { impl?: string; rev?: string; base?: string | null; head?: string | null; reviews?: SeedReview[]; findings?: unknown[] }
// //TR: Aynı Work OS store API'siyle (runner'ın kullandığı yazma yolu) tek bir run + REVIEW kanıtları tohumlar; tohumlanan her kayıt gerçek journal girdisidir.
function seedRun(store: WorkOsStore, tenantId: string, o: SeedOpts = {}): {runId: string; missionId: string; reviewIds: string[]} {
  const p = store.createProject({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "M", objective: "O", acceptanceCriteria: ["c"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId}, m.missionId, to, "test", "FOUNDER_LOCAL");
  const run = store.createRun({tenantId, missionId: m.missionId, executor: {implementer: o.impl ?? "IMPL", reviewer: o.rev ?? "REV"}, createdBy: "FOUNDER_LOCAL"});
  const leaseId = store.acquireRunLease(run.runId, 600_000, "ENGINE").leaseId as string;
  const patch: {baseSha?: string | null; headSha?: string | null} = {};
  if (o.base !== undefined) patch.baseSha = o.base;
  if (o.head !== undefined) patch.headSha = o.head;
  store.transitionRun(run.runId, leaseId, "RUNNING", "go", "ENGINE", Object.keys(patch).length ? {patch} : {});
  const reviewIds: string[] = [];
  for (const [i, r] of (o.reviews ?? []).entries()) {
    const at = r.at ?? i;
    const ev: Omit<RunEvidence, "evidenceId"> = {
      step: "REVIEW", cycle: r.cycle ?? 0, kind: "REVIEW", argv: [], startedAt: `2026-10-17T10:00:${String(at).padStart(2, "0")}.000Z`, endedAt: `2026-10-17T10:01:${String(at).padStart(2, "0")}.000Z`,
      exitCode: r.exitCode ?? 0, logPath: null, logSha256: crypto.createHash("sha256").update(`log-${i}`).digest("hex"),
      ...(r.commit !== null ? {commitSha: r.commit ?? o.head ?? sha40("1")} : {}),
      ...(r.reviewer !== null ? {reviewerIdentity: r.reviewer ?? o.rev ?? "REV"} : {}),
      ...(r.implementer !== null ? {executorIdentity: r.implementer ?? o.impl ?? "IMPL"} : {}),
      ...(r.verdict ? {verdict: r.verdict, findingsCount: r.findingsCount ?? 0} : {}),
      ...(r.note ? {note: r.note} : {})
    };
    reviewIds.push(store.addRunEvidence(run.runId, leaseId, ev, "ENGINE").evidenceId);
  }
  if (o.findings) {
    store.transitionRun(run.runId, leaseId, "CHECKPOINTING", "cp", "ENGINE");
    store.checkpointRun(run.runId, leaseId, {step: "REVIEW", data: {outcome: "REMEDIATE", reason: "REVIEW_BLOCKED", findings: o.findings}}, "ENGINE");
  }
  return {runId: run.runId, missionId: m.missionId, reviewIds};
}

describe("UI-049 — honest states, redaction and fail-closed behaviour on a seeded journal", () => {
  it("empty: no journal / no runs => 200 with empty arrays and zero counters (nothing invented)", async () => {
    const app = mkApp(dataDirS(), runtimeS());
    const r = await get(app, "/v1/reviews");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(expect.objectContaining({reviews: [], runs: [], summary: {runs: 0, reviews: 0, runsByReviewState: {}, reviewsByVerdict: {}, truncated: false}}));
    expect((await get(app, `/v1/reviews/evd_${ID}`)).statusCode).toBe(404);
  });

  it("a run without any REVIEW evidence is NOT_REVIEWED (never CLEAN) and appears only in runs[]", async () => {
    const store = new WorkOsStore(dataDirS());
    const s = seedRun(store, "tA", {base: sha40("a"), head: sha40("b")});
    const j = (await get(mkApp(dataDirS(), runtimeS()), "/v1/reviews")).json();
    expect(j.reviews).toEqual([]);
    expect(j.runs).toEqual([expect.objectContaining({runId: s.runId, reviewState: "NOT_REVIEWED", latestReviewId: null, reviewCount: 0, headSha: sha40("b")})]);
  });

  it("a CLEAN review of an OLD commit does not make the run CLEAN: the record is verbatim, the run is NOT_REVIEWED", async () => {
    const store = new WorkOsStore(dataDirS());
    const s = seedRun(store, "tA", {base: sha40("a"), head: sha40("b"), reviews: [{verdict: "CLEAN", commit: sha40("c")}]});
    const app = mkApp(dataDirS(), runtimeS());
    const d = (await get(app, `/v1/reviews/${s.reviewIds[0]}`)).json();
    expect(d.review).toEqual(expect.objectContaining({verdict: "CLEAN", reviewedCommit: sha40("c"), currentHead: false, reviewedRange: {baseSha: sha40("a"), headSha: sha40("c")}}));
    expect(d.run).toEqual(expect.objectContaining({reviewState: "NOT_REVIEWED", latestReviewId: null, reviewCount: 1}));
  });

  it("independence that cannot be established from the recorded identities is never reported as CLEAN", async () => {
    const store = new WorkOsStore(dataDirS());
    const same = seedRun(store, "tA", {head: sha40("b"), reviews: [{verdict: "CLEAN", commit: sha40("b"), reviewer: "SAME", implementer: "SAME"}]});
    const noRev = seedRun(store, "tA", {head: sha40("d"), reviews: [{verdict: "CLEAN", commit: sha40("d"), reviewer: null}]});
    const j = (await get(mkApp(dataDirS(), runtimeS()), "/v1/reviews")).json();
    const rec = (id: string) => j.reviews.find((x: {reviewId: string}) => x.reviewId === id);
    expect(rec(same.reviewIds[0])).toEqual(expect.objectContaining({verdict: "CLEAN", independent: false, currentHead: true}));
    expect(rec(noRev.reviewIds[0])).toEqual(expect.objectContaining({verdict: "CLEAN", independent: null, reviewer: {identity: null}}));
    const state = (runId: string) => j.runs.find((x: {runId: string}) => x.runId === runId).reviewState;
    expect(state(same.runId)).toBe("INDEPENDENCE_UNVERIFIED");
    expect(state(noRev.runId)).toBe("INDEPENDENCE_UNVERIFIED");
  });

  it("a review with no recorded verdict is NO_VERDICT with its reason; an adapter-invalidated CLEAN is NO_VERDICT too", async () => {
    const store = new WorkOsStore(dataDirS());
    const none = seedRun(store, "tA", {head: sha40("b"), reviews: [{commit: sha40("b"), note: "REVIEW_INVALID CLAUDE_PROFILE_LOGIN_REQUIRED", exitCode: 1}]});
    const inval = seedRun(store, "tA", {head: sha40("c"), reviews: [{verdict: "CLEAN", commit: sha40("c"), note: "REVIEW_INVALID WORKSPACE_CHANGED"}]});
    const j = (await get(mkApp(dataDirS(), runtimeS()), "/v1/reviews")).json();
    const rec = (id: string) => j.reviews.find((x: {reviewId: string}) => x.reviewId === id);
    expect(rec(none.reviewIds[0])).toEqual(expect.objectContaining({verdict: "NO_VERDICT"}));
    expect(rec(none.reviewIds[0]).evidence).toEqual(expect.objectContaining({recordedVerdict: null, invalidated: "REVIEW_INVALID", findingsCount: null, exitCode: 1, note: "REVIEW_INVALID CLAUDE_PROFILE_LOGIN_REQUIRED"}));
    expect(rec(inval.reviewIds[0])).toEqual(expect.objectContaining({verdict: "NO_VERDICT"}));
    expect(rec(inval.reviewIds[0]).evidence.recordedVerdict).toBe("CLEAN");
    expect(j.summary.runsByReviewState).toEqual({NO_VERDICT: 2});
    expect(j.summary.reviewsByVerdict).toEqual({NO_VERDICT: 2});
  });

  it("the latest review at the current head decides the run state (a later BLOCKED beats an earlier CLEAN)", async () => {
    const store = new WorkOsStore(dataDirS());
    const s = seedRun(store, "tA", {head: sha40("b"), reviews: [{at: 1, verdict: "CLEAN", commit: sha40("b")}, {at: 2, verdict: "BLOCKED", commit: sha40("b"), findingsCount: 1}]});
    const j = (await get(mkApp(dataDirS(), runtimeS()), "/v1/reviews")).json();
    expect(j.runs[0]).toEqual(expect.objectContaining({runId: s.runId, reviewState: "BLOCKED", latestReviewId: s.reviewIds[1], reviewCount: 2}));
    expect(j.reviews.map((x: {reviewId: string}) => x.reviewId)).toEqual([s.reviewIds[1], s.reviewIds[0]]);
  });

  it("findings are redacted, clipped and capped; BLOCKED without a recorded checkpoint has findings=null (not invented)", async () => {
    const store = new WorkOsStore(dataDirS());
    const many = [`P1: leaked ${FAKE_AWS} in config`, "x".repeat(500), ...Array.from({length: 30}, (_, i) => `P2: item ${i}`)];
    const withCp = seedRun(store, "tA", {head: sha40("b"), reviews: [{verdict: "BLOCKED", commit: sha40("b"), findingsCount: 32}], findings: many});
    const noCp = seedRun(store, "tA", {head: sha40("c"), reviews: [{verdict: "BLOCKED", commit: sha40("c"), findingsCount: 2}]});
    const app = mkApp(dataDirS(), runtimeS());
    const text = (await get(app, "/v1/reviews")).body + (await get(app, `/v1/reviews/${withCp.reviewIds[0]}`)).body;
    expect(text.includes(FAKE_AWS)).toBe(false);
    const a = (await get(app, `/v1/reviews/${withCp.reviewIds[0]}`)).json().review;
    expect(a.evidence.findings).toHaveLength(20);
    expect(a.evidence.findings[0]).toBe("P1: leaked [REDACTED:AWS_ACCESS_KEY] in config");
    expect(a.evidence.findings[1]).toHaveLength(300);
    expect(a.evidence.findingsCount).toBe(32); // the recorded count is kept verbatim even though the list is capped
    const b = (await get(app, `/v1/reviews/${noCp.reviewIds[0]}`)).json().review;
    expect(b.verdict).toBe("BLOCKED");
    expect(b.evidence.findings).toBeNull();
    expect(b.evidence.findingsCount).toBe(2);
  });

  it("rejects malformed review ids with 400 and unknown or foreign well-formed ids with 404", async () => {
    const store = new WorkOsStore(dataDirS());
    const s = seedRun(store, "tA", {head: sha40("b"), reviews: [{verdict: "CLEAN", commit: sha40("b")}]});
    const app = mkApp(dataDirS(), runtimeS());
    for (const bad of ["bad", `evd_${"a".repeat(23)}`, `evd_${"a".repeat(25)}`, `EVD_${ID}`, `evd_${"ag".repeat(12)}`, `evi_${ID}`, `run_${ID}`, `msn_${ID}`, ID, `evd_${ID.toUpperCase()}`, "evd_"])
      expect((await get(app, `/v1/reviews/${bad}`)).statusCode, bad).toBe(400);
    // dot segments may be normalised away by the HTTP layer (no route => 404) but can never reach a review record
    for (const dot of ["..", "%2e%2e", "%2e%2e%2f"]) expect([400, 404], dot).toContain((await get(app, `/v1/reviews/${dot}`)).statusCode);
    expect((await get(app, `/v1/reviews/evd_${"c".repeat(24)}`)).statusCode).toBe(404);
    // the evidence id of a non-REVIEW evidence entry (or the run id) is not a review id
    expect((await get(app, `/v1/reviews/${s.runId}`)).statusCode).toBe(400);
    expect((await get(app, `/v1/reviews/${s.reviewIds[0]}`)).statusCode).toBe(200);
  });

  it("requires the control token and a loopback Host, like every other /v1 route", async () => {
    const store = new WorkOsStore(dataDirS());
    const s = seedRun(store, "tA", {head: sha40("b"), reviews: [{verdict: "CLEAN", commit: sha40("b")}]});
    const app = mkApp(dataDirS(), runtimeS());
    for (const url of ["/v1/reviews", `/v1/reviews/${s.reviewIds[0]}`]) {
      expect((await get(app, url, {host: "127.0.0.1:3210"})).statusCode, url).toBe(403);
      expect((await get(app, url, {"x-uasco-control-token": "x".repeat(32), host: "127.0.0.1:3210"})).statusCode, url).toBe(403);
      expect((await get(app, url, {"x-uasco-control-token": TOKEN, host: "evil.example:3210"})).statusCode, url).toBe(421);
    }
  });
});

// ---------------- (3) ALLOW-LIST (adversarial, isolated) ----------------
const mainSrc = fs.readFileSync(path.join(import.meta.dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string, ret: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return new Function(`${m![1]}\nreturn ${ret};`)() as (v: unknown) => boolean;
};

describe("UI-049 — read-only reviews allow-list is fail-closed and EXTRA_GET_ROUTES is untouched", () => {
  const getAllowed = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed");
  const postAllowed = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed");

  it("accepts exactly the canonical list, filtered list and detail paths", () => {
    expect(getAllowed("/v1/reviews")).toBe(true);
    expect(getAllowed(`/v1/reviews/evd_${ID}`)).toBe(true);
    expect(getAllowed(`/v1/reviews?missionId=msn_${ID}`)).toBe(true);
    expect(getAllowed(`/v1/reviews?runId=run_${ID}`)).toBe(true);
    expect(getAllowed(`/v1/reviews?missionId=msn_${ID}&runId=run_${ID}`)).toBe(true);
  });
  it("rejects wrong prefix, case, length, non-hex, query on the id, sub-paths, trailing slashes and near-miss prefixes", () => {
    const bad = [
      `/v1/reviews/EVD_${ID}`, `/v1/reviews/evd_${ID.toUpperCase()}`, `/v1/reviews/evd_${"ab".repeat(11)}`, `/v1/reviews/evd_${"ab".repeat(13)}`,
      `/v1/reviews/evi_${ID}`, `/v1/reviews/run_${ID}`, `/v1/reviews/msn_${ID}`, `/v1/reviews/${ID}`, `/v1/reviews/evd_${"ag".repeat(12)}`,
      `/v1/reviews/evd_${ID}?x=1`, `/v1/reviews/evd_${ID}?missionId=msn_${ID}`,
      `/v1/reviews/evd_${ID}/`, `/v1/reviews/evd_${ID}/log`, `/v1/reviews/evd_${ID}/../evd_${ID}`, `/v1/reviews/`, `/v1/reviews/ `,
      "/v1/reviews/", "/v1/reviews?", "/v1/reviews?x=1", "/v1/reviews?limit=1", "/v1/reviews?cursor=abc",
      `/v1/reviews?missionId=msn_${"ab".repeat(11)}`, `/v1/reviews?missionId=MSN_${ID}`, `/v1/reviews?missionId=prj_${ID}`, `/v1/reviews?runId=a/b`,
      `/v1/reviews?missionId=msn_${ID}&missionId=msn_${ID}`, `/v1/reviews?missionId=msn_${ID}&x=1`, `/v1/reviews?missionId=msn_${ID}&`,
      `/v1/review/evd_${ID}`, `/v1/reviewsx`, `/v1/reviewsx/evd_${ID}`, `/v1/reviews%2Fevd_${ID}`, `/v1//reviews`, `/v1/reviews/evd_${ID}%00`,
      `/v1/reviews/evd_%61${ID.slice(1)}`
    ];
    for (const p of bad) expect(getAllowed(p), p).toBe(false);
  });
  it("never allows a write (POST) to any reviews path", () => {
    for (const p of ["/v1/reviews", `/v1/reviews/evd_${ID}`, `/v1/reviews?missionId=msn_${ID}`]) expect(postAllowed(p), `POST ${p}`).toBe(false);
  });
  it("does NOT grow the frozen EXTRA_GET_ROUTES set (the routes are admitted by dedicated patterns)", () => {
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set.includes("review")).toBe(false);
    expect(mainSrc).toContain("const REVIEWS_LIST_RE=/^\\/v1\\/reviews$/;");
    expect(mainSrc).toContain("const REVIEW_DETAIL_RE=/^\\/v1\\/reviews\\/evd_[0-9a-f]{24}$/;");
    expect(mainSrc).toMatch(/REVIEW_DETAIL_RE\.test\(/);
    expect(mainSrc).toMatch(/listQueryAllowed\(value,"\/v1\/reviews",\["missionId","runId"\]\)/);
  });
});

// //TR: Güvence / QA & Güvenlik (UASCO-T0006): /v1/work-runs en eski önce döner; güvenlik eşleyicisi en YENİ 500 koşuyu tutar (toplam + truncated açık), "son tarama" en yeni taramadır ve tablolar en yeni üstte gösterilir. Sessiz kesme yok.
describe("Assurance security & test-report lists — newest runs kept and shown first, the cut stated, latest scan is the newest", () => {
  const rend = path.join(REPO, "apps", "desktop", "renderer");
  const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
  class N {
    tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = "";
    constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
    get id() { return this.attrs.get("id") ?? ""; }
    get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
    set textContent(v: string) { this.children = []; this._text = String(v); }
    append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
    appendChild(n: N) { this.append(n); return n; }
    replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
    setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
    getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
    addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
    focus() { /* test double */ }
  }
  class D {
    body: N; constructor() { this.body = new N(this, "body"); }
    createElement(t: string) { return new N(this, t); }
    createElementNS(_ns: string, t: string) { return new N(this, t); }
    createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
    getElementById(id: string) { return allN(this.body).find(n => n.id === id) ?? null; }
  }
  const allN = (n: N): N[] => n.children.flatMap(c => [c, ...allN(c)]);
  const byData = (r: N, k: string) => allN(r).filter(n => k in n.dataset);
  const secIds = (r: N) => byData(r, "runId").filter(n => n.tagName === "TR").map(n => n.dataset.runId);
  const testIds = (r: N) => byData(r, "testRun").filter(n => n.tagName === "TR").map(n => n.dataset.testRun);
  const rid = (i: number) => `run_${String(i).padStart(24, "0")}`;
  const H = (i: number) => (i % 16).toString(16).repeat(40);
  const secSummary = (status: string, headSha: string) => ({schemaVersion: 1, status, blockReason: status === "BLOCKED" ? "SECRET_DETECTED" : null, baseSha: "0".repeat(40), headSha, cycle: 1,
    secrets: {builtin: {status: "CLEAN", hits: 0}, gitleaks: {status: status === "BLOCKED" ? "FINDINGS" : "CLEAN", findings: status === "BLOCKED" ? 1 : 0, items: [], rawReportSha256: null}},
    sca: {status: "CLEAN", counts: {}, blocking: 0, findings: [], truncated: false, rawReportSha256: null},
    sast: {status: "NOT_AVAILABLE", reason: "TOOL_NOT_INSTALLED", tool: "semgrep"}, sbom: {status: "NOT_AVAILABLE", reason: "NOT_IMPLEMENTED"},
    gaps: [], tools: [{tool: status === "BLOCKED" ? "gitleaks" : "trivy", status: "INSTALLED", path: null, version: status === "BLOCKED" ? "9.9.9" : "0.1", sha256: null}], founderNote: "n"});
  const secEv = (status: string, headSha: string) => ({evidenceId: `evi_${"1".repeat(32)}`, step: "SECURITY", cycle: 1, kind: "SECURITY_REPORT", argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, commitSha: headSha, security: secSummary(status, headSha)});
  const fakeRun = (i: number, evidence: any[] = []) => ({runId: rid(i), missionId: `msn_${"0".repeat(24)}`, projectId: `prj_${"0".repeat(24)}`, status: "AWAITING_APPROVAL", step: "REVIEW", createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z", remediationCycle: 0, headSha: H(i), evidence});
  async function renderAssurance(getFn: (p: string) => any, lang = "en") {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), v = await load("views", "assurance.js");
    v.resetAssuranceView();
    const doc = new D(), store = st.createStore(null), calls: string[] = [];
    const bridge = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }, apiPost: async (p: string) => { throw new Error(`POST must never be called (${p})`); }};
    const t = (k: string, x?: any) => i18n.translate(lang, k, x);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang, t, setLang: () => {}}, t, navigate: () => {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => false, settleFocus: () => {}};
    return {root: (await v.render(ctx)) as N, calls};
  }
  const only = (runs: unknown) => (p: string) => { if (p === "/v1/work-runs") return runs; throw new Error(`${p}: HTTP 404`); };

  it("pure: newestWindow keeps the server-order tail, newestFirst reverses for display, neither mutates its input", async () => {
    const c = await load("assurance-core.js");
    const xs = [1, 2, 3, 4, 5];
    expect(c.newestWindow(xs, 3)).toEqual([3, 4, 5]); expect(c.newestWindow(xs, 9)).toEqual(xs); expect(c.newestWindow([], 3)).toEqual([]);
    expect(c.newestFirst(xs)).toEqual([5, 4, 3, 2, 1]); expect(xs).toEqual([1, 2, 3, 4, 5]);
    expect(c.SECURITY_ROWS_MAX).toBe(500);
  });
  it("mapper: >500 runs keeps the NEWEST 500 with total + truncated; the newest BLOCKED scan counts and its tools are the latest seen", async () => {
    const c = await load("assurance-core.js");
    const list = Array.from({length: 503}, (_, i) => fakeRun(i, i === 0 ? [secEv("PASSED", H(0))] : i === 502 ? [secEv("BLOCKED", H(502))] : []));
    const r = c.mapSecurityScans({ok: true, data: {workRuns: list}});
    expect([r.state, r.total, r.truncated, r.runs.length]).toEqual(["VERIFIED", 503, true, 500]);
    expect(r.runs[0].runId).toBe(rid(3)); expect(r.runs[499].runId).toBe(rid(502));          // server order kept; the three OLDEST are the ones cut
    expect(r.aggregate.blocked).toBe(1);                                                    // the newest run's BLOCKED scan is never dropped
    expect(r.aggregate.toolsSeen.map((x: any) => x.version)).toEqual(["9.9.9"]);
    const small = c.mapSecurityScans({ok: true, data: {workRuns: [fakeRun(1, [secEv("PASSED", H(1))]), fakeRun(2, [secEv("BLOCKED", H(2))])]}});
    expect([small.total, small.truncated]).toEqual([2, false]);
    expect(small.aggregate.toolsSeen.map((x: any) => x.version)).toEqual(["9.9.9"]);      // latest scan = the newer run, not the first scanned
    expect(c.mapSecurityScans({ok: false, state: "OFFLINE"})).toMatchObject({state: "OFFLINE", runs: [], total: 0, truncated: false});
    expect(c.mapSecurityScans({ok: true, data: {nope: 1}})).toMatchObject({state: "ERROR", total: 0, truncated: false});
  });
  it("view: the security and test-report tables show the newest runs on top; the cut is stated with the real total (en + tr)", async () => {
    const list = Array.from({length: 503}, (_, i) => fakeRun(i, i === 502 ? [secEv("BLOCKED", H(502))] : []));
    const {root} = await renderAssurance(only({workRuns: list}));
    const ids = secIds(root);
    expect(ids.length).toBe(150); expect(ids[0]).toBe(rid(502)); expect(ids[149]).toBe(rid(353));
    expect(byData(root, "results").find(n => n.dataset.results === "1")!.textContent).toBe("Showing 150 of 503 runs.");
    expect(byData(root, "truncated").find(n => n.dataset.truncated === "1")!.textContent).toBe("353 more runs not shown.");
    const pt = byData(root, "postureTruncated")[0]!;
    expect([pt.dataset.postureTruncated, pt.textContent]).toEqual(["3", "3 more runs not shown."]);
    expect(byData(root, "posture")[0]!.dataset.posture).toBe("BLOCKED");
    const few = await renderAssurance(only({workRuns: [fakeRun(1), fakeRun(2), fakeRun(3)]}));
    expect(secIds(few.root)).toEqual([rid(3), rid(2), rid(1)]);
    expect(testIds(few.root)).toEqual([rid(3), rid(2), rid(1)]);
    expect(byData(few.root, "postureTruncated")).toEqual([]);
    expect(byData(few.root, "truncated").filter(n => n.dataset.truncated === "1")).toEqual([]);
    // a row the mapper rejects (bad runId) is still a run the server returned: it counts in the total and is stated as not shown, never silently dropped
    const bad = await renderAssurance(only({workRuns: [fakeRun(1), {...fakeRun(2), runId: "x"}, fakeRun(3)]}));
    expect(secIds(bad.root)).toEqual([rid(3), rid(1)]);
    expect(byData(bad.root, "results").find(n => n.dataset.results === "1")!.textContent).toBe("Showing 2 of 3 runs.");
    expect(byData(bad.root, "truncated").find(n => n.dataset.truncated === "1")!.textContent).toBe("1 more runs not shown.");
    const tr = await renderAssurance(only({workRuns: list}), "tr");
    expect(byData(tr.root, "postureTruncated")[0]!.textContent).not.toBe("");
  });
  it("real buildServer + real Work OS store: 503 runs, the newest has a BLOCKED scan -> posture is BLOCKED, newest on top, 3 cut runs stated", { timeout: T }, async () => {
    const store = new WorkOsStore(dataDirS());
    const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
    const created: string[] = [];
    for (let i = 0; i < 503; i++) {
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: `M${i}`, objective: "O", acceptanceCriteria: ["c"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: "FOUNDER_LOCAL"});
      created.push(run.runId);
      if (i === 502) {
        const head = sha40("e"), leaseId = store.acquireRunLease(run.runId, 600_000, "ENGINE").leaseId as string;
        store.transitionRun(run.runId, leaseId, "RUNNING", "go", "ENGINE", {patch: {baseSha: sha40("0"), headSha: head}});
        const {evidenceId: _e, ...ev} = secEv("BLOCKED", head) as any;
        store.addRunEvidence(run.runId, leaseId, {...ev, startedAt: "2026-10-17T10:00:00.000Z", endedAt: "2026-10-17T10:00:01.000Z"}, "ENGINE");
      }
    }
    const app = mkApp(dataDirS(), runtimeS());
    const body = (await get(app, "/v1/work-runs")).json();
    const serverIds = (body.workRuns ?? body.runs ?? body.items).map((r: any) => r.runId);
    expect(serverIds.length).toBe(503);
    expect(serverIds.indexOf(created[502])).toBe(502);                                      // measured: the server lists the newest run LAST
    const {root, calls} = await renderAssurance(async (q: string) => { const r = await get(app, q); if (r.statusCode !== 200) throw new Error(`${q}: HTTP ${r.statusCode}`); return r.json(); });
    expect(calls).toContain("/v1/work-runs");
    expect(byData(root, "posture")[0]!.dataset.posture).toBe("BLOCKED");                   // before the fix the newest BLOCKED run was cut away -> "OK"
    const ids = secIds(root);
    expect(ids[0]).toBe(created[502]);
    expect(ids).not.toContain(created[0]);
    expect(byData(root, "postureTruncated")[0]!.dataset.postureTruncated).toBe("3");
    expect(byData(root, "results").find(n => n.dataset.results === "1")!.textContent).toBe("Showing 150 of 503 runs.");
  });
});
