// //TR: UASCO Local Windows Test Worker testleri: plan kapsamı (48 canonical adımın tamamı), iş/ana makine kabul kuralları, tekil claim (iki süreç yarışı), tekrar önleme, çökme kurtarma, zaman aşımı, korumalı dosya kayması reddi, kanıt özeti/kurcalama tespiti, yalıtım yapılandırması ve en az yetkili status yükü. Uçtan uca akış gerçek git deposu, gerçek arşiv/çıkarma ve gerçek run-steps.mjs ile çalışır; yalnız Windows Sandbox başlatıcısı test dublörüdür (gerçek sandbox yalnız Founder PC'sinde doğrulanabilir). Kayıtlı bir test dosyasından çağrılır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import * as C from "../../scripts/local-worker/core.mjs";
import * as SB from "../../scripts/local-worker/sandbox.mjs";
import {interpretProbe, probeHost} from "../../scripts/local-worker/probe.mjs";
import {runSteps} from "../../scripts/local-worker/run-steps.mjs";
import {runJob} from "../../scripts/local-worker/worker.mjs";

const ROOT = process.cwd();
const VALIDATION = JSON.parse(fs.readFileSync("config/validation.json", "utf8"));
const PLAN = JSON.parse(fs.readFileSync("scripts/local-worker/test-plan.json", "utf8"));
const code = (fn: () => unknown) => { try { fn(); return "NO_THROW"; } catch (e) { return (e as {code?: string}).code ?? "NO_CODE"; } };
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const SHA = (c: string) => c.repeat(40);
const WIN_PROBE = {platform: "win32", fingerprint: "fp-1", cpu: {name: "Intel(R) Core(TM) i7-9700", logical: 8, loadPct: 5}, memory: {totalMB: 16304, freeMB: 11000}, disk: {freeGB: 200}, sandbox: {available: true}};
const goodSelftest = {networkBlocked: true, hostProfileHidden: true, sourceReadOnly: true, outputWritable: true, secretsAbsent: true, user: "WDAGUtilityAccount"};
const isolationFor = (probe: any, now = Date.now()) => C.buildIsolation({selftest: goodSelftest, fingerprint: probe.fingerprint, now, wsbSha256: "0".repeat(64)}).record;
const G = (cwd: string, args: string[]) => {
  const r = spawnSync("git", args, {cwd, encoding: "utf8", env: {...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x"}});
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

export function registerLocalWorkerCases() {
  describe("local Windows test worker: plan, acceptance and evidence", () => {
    it("the plan lists every canonical validation step once, in order; heavy steps go local with a GitHub-hosted fallback; required checks unchanged", () => {
      const plan = C.validatePlan(PLAN, VALIDATION);
      expect(plan.steps.map((s: any) => s.id)).toEqual(VALIDATION.steps.map((s: any) => s.id));
      // //TR: COORD-PROTECTED-BS1D-SPLIT: tests-bs1-g (d'den ayrılan FRF adımı, ölçülen/türetilen >= 60 sn) yerelde koşan ağır adımlara eklenir; 15 -> 16.
      expect(C.localSteps(plan).length).toBe(16);
      expect(plan.steps.filter((s: any) => s.windows === "LOCAL_PRIMARY").every((s: any) => s.measuredWindowsSec >= 60)).toBe(true);
      expect(plan.steps.every((s: any) => s.fallback === C.FALLBACK)).toBe(true);
      expect([plan.phase, plan.replacesRequiredCheck, plan.requiredChecksUnchanged]).toEqual(["SHADOW", false, [...C.REQUIRED_CHECK_CONTEXTS]]);
      const mut = (f: (p: any) => void) => { const p = structuredClone(PLAN); f(p); return code(() => C.validatePlan(p, VALIDATION)); };
      expect(mut(p => { p.steps.pop(); })).toBe("PLAN_COVERAGE_MISMATCH");
      expect(mut(p => { [p.steps[0], p.steps[1]] = [p.steps[1], p.steps[0]]; })).toBe("PLAN_COVERAGE_MISMATCH");
      expect(mut(p => { p.phase = "PRIMARY"; })).toBe("PLAN_PHASE_NOT_SHADOW");
      expect(mut(p => { p.replacesRequiredCheck = true; })).toBe("PLAN_REPLACES_REQUIRED_CHECK");
      expect(mut(p => { p.requiredChecksUnchanged = ["validate (ubuntu-latest)"]; })).toBe("PLAN_REQUIRED_CHECKS_CHANGED");
      expect(mut(p => { p.limits.maxConcurrentJobs = 2; })).toBe("PLAN_LIMITS_INVALID");
      expect(mut(p => { p.steps[0].fallback = null; })).toMatch(/^PLAN_STEP_FALLBACK_INVALID:/);
    });

    it("accepts only well-formed jobs (full 40-hex SHAs, this repository, the current plan version)", () => {
      const plan = C.validatePlan(PLAN, VALIDATION), j = {schema: C.JOB_SCHEMA, repo: C.REPO, pr: 7, sha: SHA("a"), baseSha: SHA("b"), planVersion: plan.version};
      expect(C.validateJob(j, plan).key).toBe(C.jobKey(j));
      expect(code(() => C.validateJob({...j, sha: "abc1234"}, plan))).toBe("JOB_SHA_INVALID");
      expect(code(() => C.validateJob({...j, sha: SHA("A")}, plan))).toBe("JOB_SHA_INVALID");
      expect(code(() => C.validateJob({...j, repo: "someone/else"}, plan))).toBe("JOB_REPO_INVALID");
      expect(code(() => C.validateJob({...j, planVersion: "2026-01-01.1"}, plan))).toBe("JOB_PLAN_VERSION_MISMATCH");
    });

    it("a busy, unsuitable or unisolated host accepts nothing and hands the commit to GitHub-hosted Windows", () => {
      const plan = C.validatePlan(PLAN, VALIDATION), iso = isolationFor(WIN_PROBE), now = Date.now();
      const st = (probe: any, isolation: any = iso) => { const h = C.assessHost(probe, plan, {isolation, now}); return [h.state, h.reasons.join("+"), h.fallback]; };
      expect(st(WIN_PROBE)).toEqual(["READY", "", null]);
      expect(st({...WIN_PROBE, platform: "linux"})).toEqual(["UNSUPPORTED", "PLATFORM_NOT_WINDOWS", C.FALLBACK]);
      expect(st({...WIN_PROBE, cpu: {...WIN_PROBE.cpu, loadPct: 90}})).toEqual(["BUSY", "CPU_BUSY", C.FALLBACK]);
      expect(st({...WIN_PROBE, memory: {totalMB: 16304, freeMB: 5000}})).toEqual(["BUSY", "RAM_INSUFFICIENT", C.FALLBACK]);
      expect(st({...WIN_PROBE, disk: {}})).toEqual(["BUSY", "DISK_INSUFFICIENT", C.FALLBACK]); // a missing measurement counts as unsuitable
      expect(st({...WIN_PROBE, sandbox: {available: false}})).toEqual(["UNSUPPORTED", "SANDBOX_UNAVAILABLE", C.FALLBACK]);
      expect(st(WIN_PROBE, null)).toEqual(["ISOLATION_NOT_VERIFIED", "ISOLATION_NOT_VERIFIED", C.FALLBACK]);
      expect(st({...WIN_PROBE, fingerprint: "another-pc"})[0]).toBe("ISOLATION_NOT_VERIFIED");
      expect(st(WIN_PROBE, isolationFor(WIN_PROBE, now - 31 * 864e5))[0]).toBe("ISOLATION_NOT_VERIFIED");
      expect(st(WIN_PROBE, {...iso, checks: {...iso.checks, networkBlocked: false}})[0]).toBe("ISOLATION_NOT_VERIFIED"); // digest broken
      const bad = C.buildIsolation({selftest: {...goodSelftest, networkBlocked: false, user: "Salim"}, fingerprint: "fp-1", now, wsbSha256: "x"});
      expect([bad.ok, bad.failed]).toEqual([false, ["networkBlocked", "sandboxUser"]]);
    });

    it("one create-only lock: two processes racing for the same job, exactly one wins; stale locks are recovered as ABANDONED", async () => {
      const dir = tmp("lw-lock-"), f = C.stateFiles(dir), mod = pathToFileURL(path.join(ROOT, "scripts/local-worker/core.mjs")).href;
      const script = `const C=await import(${JSON.stringify(mod)});const r=C.acquireLock(${JSON.stringify(f.lock)},{key:"k1",timeoutSec:60});process.stdout.write(String(r.acquired))`;
      const race = () => new Promise<string>(res => { const c = spawn(process.execPath, ["--input-type=module", "-e", script]); let o = ""; c.stdout.on("data", d => { o += d; }); c.on("close", () => res(o)); });
      const results = await Promise.all([race(), race(), race()]);
      expect(results.filter(r => r === "true").length).toBe(1);
      expect(C.inspectLock(f.lock, {isAlive: () => true})?.stale).toBe(false);
      expect(C.inspectLock(f.lock, {isAlive: () => false})?.why).toBe("LOCK_OWNER_DEAD");
      expect(C.inspectLock(f.lock, {now: Date.now() + 3 * 3600e3, isAlive: () => true})?.why).toBe("LOCK_DEADLINE_PASSED");
      expect(C.recover(dir, {isAlive: () => true})).toMatchObject({recovered: false, why: "LOCK_LIVE"});
      expect(C.recover(dir, {isAlive: () => false})).toMatchObject({recovered: true, why: "LOCK_OWNER_DEAD", key: "k1", fallback: C.FALLBACK});
      expect(fs.existsSync(f.lock)).toBe(false);
      expect(C.readLedger(f.ledger).get("k1")).toMatchObject({state: "ABANDONED", fallback: C.FALLBACK});
      fs.appendFileSync(f.ledger, "not json\n");
      expect(code(() => C.readLedger(f.ledger))).toBe("LEDGER_CORRUPT");
      fs.rmSync(dir, {recursive: true, force: true});
    });

    it("never runs the same job twice; a busy worker or a stale lock defers to GitHub-hosted Windows", () => {
      const job = {key: "k1"}, ready = {state: "READY", reasons: []};
      const live = {rec: {key: "k2"}, stale: false}, own = {rec: {key: "k1"}, stale: false}, stale = {rec: {key: "k2"}, stale: true};
      const d = (ledger: Map<string, any>, lock: any = null, host: any = ready) => C.decideAccept({job, host, ledger, lock});
      expect(d(new Map())).toEqual({accept: true, reason: "ACCEPTED", fallback: null});
      expect(d(new Map([["k1", {state: "PASS"}]]))).toEqual({accept: false, reason: "DUPLICATE_JOB:PASS", fallback: null});
      expect(d(new Map([["k1", {state: "ABANDONED"}]]))).toEqual({accept: false, reason: "DUPLICATE_JOB:ABANDONED", fallback: C.FALLBACK});
      expect(d(new Map(), live)).toEqual({accept: false, reason: "WORKER_BUSY", fallback: C.FALLBACK});
      expect(d(new Map(), own)).toEqual({accept: false, reason: "JOB_ALREADY_RUNNING", fallback: null});
      expect(d(new Map(), stale)).toEqual({accept: false, reason: "STALE_LOCK_RECOVER_FIRST", fallback: C.FALLBACK});
      expect(d(new Map(), null, {state: "BUSY", reasons: ["CPU_BUSY"]})).toEqual({accept: false, reason: "CPU_BUSY", fallback: C.FALLBACK});
    });

    it("evidence is digest-sealed and SHA-bound; the result is derived from the step report; the status uses its own context", () => {
      const plan = C.validatePlan(PLAN, VALIDATION), steps = C.localSteps(plan);
      const job = C.validateJob({schema: C.JOB_SCHEMA, repo: C.REPO, pr: 1, sha: SHA("c"), baseSha: SHA("d"), planVersion: plan.version}, plan);
      const rep = (status = "PASS", timedOut = false) => ({configSha256: "e".repeat(64), steps: steps.map((id, i) => ({id, status: i === 3 ? status : "PASS", durationMs: 1000, timedOut: i === 3 && timedOut}))});
      expect([C.resultFromReport(rep(), plan), C.resultFromReport(rep("FAIL"), plan), C.resultFromReport(rep("FAIL", true), plan), C.resultFromReport({steps: rep().steps.slice(1)}, plan)])
        .toEqual(["PASS", "FAIL", "TIMEOUT", "ERROR"]);
      const ev = C.buildEvidence({job, plan, probe: WIN_PROBE, isolation: isolationFor(WIN_PROBE), startedAt: 1000, finishedAt: 61000, result: "PASS", report: rep(), logSha256: null});
      expect(C.verifyEvidence(ev, {plan, sha: job.sha})).toEqual([]);
      const st = C.statusPayload(ev, {plan, sha: job.sha});
      expect(st.path).toBe(`/repos/${C.REPO}/statuses/${job.sha}`);
      expect(st.body.state).toBe("success");
      expect(C.REQUIRED_CHECK_CONTEXTS).not.toContain(st.body.context);
      const tampered = {...ev, steps: ev.steps.map((s: any, i: number) => i === 0 ? {...s, status: "FAIL"} : s)};
      expect(C.verifyEvidence(tampered, {plan, sha: job.sha})).toContain("DIGEST");
      expect(code(() => C.statusPayload(tampered, {plan, sha: job.sha}))).toMatch(/^EVIDENCE_INVALID:DIGEST/);
      expect(C.verifyEvidence(ev, {plan, sha: SHA("f")})).toEqual(["SHA"]);
      const {digest, ...body} = tampered, resealed = {...body, digest: C.sha256(C.canonical(body))}; // a re-sealed lie is still caught
      expect(C.verifyEvidence(resealed, {plan, sha: job.sha})).toEqual(["RESULT_INCONSISTENT"]);
      const t = C.buildEvidence({job, plan, probe: WIN_PROBE, isolation: null, startedAt: 0, finishedAt: 5, result: "TIMEOUT", report: rep("FAIL", true), logSha256: null});
      expect([t.fallback, C.statusPayload(t, {plan, sha: job.sha}).body.state]).toEqual([C.FALLBACK, "error"]);
      const fl = C.buildEvidence({job, plan, probe: WIN_PROBE, isolation: null, startedAt: 0, finishedAt: 5, result: "FAIL", report: rep("FAIL"), logSha256: null});
      expect([fl.fallback, C.statusPayload(fl, {plan, sha: job.sha}).body.state]).toEqual([null, "failure"]);
    });

    it("Windows Sandbox config: network, clipboard, GPU and devices off; source read-only; only the output folder writable; no profile or secret folder", () => {
      const W = "C:\\uasco-work", P = "C:\\Users\\salim";
      const mapped = [{host: `${W}\\jobs\\k\\src`, sandbox: SB.IN.src, readOnly: true}, {host: `${W}\\jobs\\k\\out & more`, sandbox: SB.IN.out, readOnly: false}];
      const x = SB.buildWsb({memoryMB: 6144, mapped, logonCommand: SB.logonFor("job.ps1"), workRoot: W, profile: P});
      for (const line of ["<Networking>Disable</Networking>", "<vGPU>Disable</vGPU>", "<ClipboardRedirection>Disable</ClipboardRedirection>", "<PrinterRedirection>Disable</PrinterRedirection>",
        "<AudioInput>Disable</AudioInput>", "<VideoInput>Disable</VideoInput>", "<ProtectedClient>Enable</ProtectedClient>", "<MemoryInMB>6144</MemoryInMB>", "out &amp; more"]) expect(x).toContain(line);
      expect(x.match(/<ReadOnly>false<\/ReadOnly>/g)?.length).toBe(1);
      const b = (m: any[], extra: any = {}) => code(() => SB.buildWsb({memoryMB: 6144, mapped: m, logonCommand: "x", workRoot: W, profile: P, ...extra}));
      expect(b([...mapped, {host: `${W}\\jobs\\k\\x`, sandbox: SB.IN.ctl, readOnly: false}])).toBe("MAP_WRITABLE_MUST_BE_OUT_ONLY");
      expect(b([{host: P, sandbox: SB.IN.src, readOnly: true}, mapped[1]])).toBe("MAP_PATH_PROFILE_OR_ANCESTOR");
      expect(b([{host: "C:\\", sandbox: SB.IN.src, readOnly: true}, mapped[1]])).toBe("MAP_PATH_PROFILE_OR_ANCESTOR");
      expect(b([{host: `${W}\\jobs\\.ssh`, sandbox: SB.IN.src, readOnly: true}, mapped[1]])).toBe("MAP_PATH_SECRET");
      expect(b([{host: "D:\\projects\\other", sandbox: SB.IN.src, readOnly: true}, mapped[1]])).toBe("MAP_PATH_OUTSIDE_WORK_ROOT");
      expect(b([{host: "\\\\server\\share", sandbox: SB.IN.src, readOnly: true}, mapped[1]])).toBe("MAP_PATH_INVALID");
      expect(b([mapped[0], {host: "D:\\out", sandbox: SB.IN.out, readOnly: false}])).toBe("MAP_PATH_WRITABLE_OUTSIDE_WORK_ROOT");
      expect(b(mapped, {memoryMB: 16384})).toBe("MEMORY_INVALID");
      expect(code(() => SB.jobScript({steps: ["tests", "x';Remove-Item C:\\ -Recurse;'"]}))).toBe("STEPS_INVALID");
      expect(SB.selftestScript({hostProfile: "C:\\Users\\o'brien"})).toContain("'C:\\Users\\o''brien'");
    });

    it("sandbox waiting is bounded: DONE, TIMEOUT and launch failure all end with every sandbox process killed", async () => {
      const out = tmp("lw-sbx-"); let kills = 0; const killAll = async () => { kills++; };
      const done = await SB.runSandbox({wsbFile: "x.wsb", outDir: out, timeoutMs: 5000, pollMs: 10, killAll, launch: async () => { setTimeout(() => fs.writeFileSync(path.join(out, "DONE"), "done"), 50); }});
      expect(done.outcome).toBe("DONE");
      fs.rmSync(path.join(out, "DONE"));
      let t = 0; const clock = () => (t += 1000);
      expect((await SB.runSandbox({wsbFile: "x.wsb", outDir: out, timeoutMs: 5000, killAll, launch: async () => {}, now: clock, sleep: async () => {}})).outcome).toBe("TIMEOUT");
      expect((await SB.runSandbox({wsbFile: "x.wsb", outDir: out, timeoutMs: 5000, killAll, launch: async () => { throw new Error("no sandbox"); }})).outcome).toBe("LAUNCH_FAILED");
      expect(kills).toBe(3);
      fs.rmSync(out, {recursive: true, force: true});
    });

    it("the read-only probe reports Sandbox readiness honestly and never exposes the raw machine id", () => {
      const raw = {os: {caption: "Microsoft Windows 11 Pro", build: "26100", editionId: "Professional"}, cpu: {name: "Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz", logical: 8, cores: 8, loadPct: 7, virtualizationFirmwareEnabled: false},
        hypervisorPresent: true, memory: {totalMB: 16304, freeMB: 9800}, disk: {drive: "C:", freeGB: 312.4}, physicalDisks: {name: "Samsung SSD 970", mediaType: "SSD"}, sandboxExe: true, machineGuid: "SECRET-GUID"};
      const p = interpretProbe(raw);
      expect([p.sandbox.available, p.ssd, p.physicalDisks.length, JSON.stringify(p).includes("SECRET-GUID"), p.fingerprint.length]).toEqual([true, true, 1, false, 64]);
      expect(interpretProbe({...raw, os: {...raw.os, editionId: "Core"}, sandboxExe: false, hypervisorPresent: false}).sandbox.reasons)
        .toEqual(["EDITION_WITHOUT_SANDBOX", "SANDBOX_FEATURE_NOT_ENABLED", "VIRTUALIZATION_NOT_AVAILABLE"]);
      const here = probeHost();
      expect(here.readOnly).toBe(true);
      if (process.platform !== "win32") expect([here.supported, here.sandbox.available]).toEqual([false, false]);
      else expect(typeof here.memory?.totalMB).toBe("number");
    });
  });

  describe("local Windows test worker: end-to-end job flow (real git, archive and step runner; Sandbox launcher stubbed)", {timeout: 240000}, () => {
    const dir = tmp("lw-e2e-"), fx = path.join(dir, "fixture"), work = path.join(dir, "work"), state = path.join(dir, "state");
    const cfg = {steps: [{id: "light", command: ["node", "-e", "0"]}, {id: "heavy-a", command: ["node", "check-a.js"]}, {id: "heavy-b", command: ["node", "check-b.js"]}]};
    const plan = {...structuredClone(PLAN), limits: {...PLAN.limits, jobTimeoutSec: 60}, steps: [
      {id: "light", windows: "CLOUD_SMOKE", measuredWindowsSec: 1, fallback: C.FALLBACK}, {id: "heavy-a", windows: "LOCAL_PRIMARY", measuredWindowsSec: 120, fallback: C.FALLBACK},
      {id: "heavy-b", windows: "LOCAL_PRIMARY", measuredWindowsSec: 300, fallback: C.FALLBACK}]};
    const planFile = path.join(dir, "plan.json");
    const shas: Record<string, string> = {};
    let base = "";
    const write = (rel: string, s: string) => { fs.mkdirSync(path.dirname(path.join(fx, rel)), {recursive: true}); fs.writeFileSync(path.join(fx, rel), s); };
    const branch = (name: string, edits: Record<string, string>) => {
      G(fx, ["checkout", "-q", "-b", name, base]);
      for (const [k, v] of Object.entries(edits)) write(k, v);
      G(fx, ["add", "-A"]); G(fx, ["commit", "-q", "-m", name]); shas[name] = G(fx, ["rev-parse", "HEAD"]);
    };
    const jobFile = (name: string) => { const f = path.join(dir, `${name}.job.json`); fs.writeFileSync(f, JSON.stringify({schema: C.JOB_SCHEMA, repo: C.REPO, pr: 1, sha: shas[name], baseSha: base, planVersion: plan.version})); return f; };
    const opts = (name: string, execute = true) => ({cmd: "run", stateDir: state, workRoot: work, plan: planFile, job: jobFile(name), flags: new Set(execute ? ["--execute"] : [])});
    // Stub for WindowsSandbox.exe: runs the worker's real run-steps.mjs on the extracted source, then signals DONE like the sandbox entry script.
    const fakeSandbox = async (wsbFile: string) => {
      const j = path.dirname(wsbFile);
      await runSteps({repo: path.join(j, "src"), steps: C.localSteps(plan), out: path.join(j, "out"), runnerRoot: ROOT});
      fs.writeFileSync(path.join(j, "out", "DONE"), "done");
    };
    const env = (extra: any = {}) => ({probe: WIN_PROBE, launch: fakeSandbox, killAll: async () => {}, tools: {nodeDir: "N", gitDir: "G"}, buildWsb: () => "<Configuration/>", ...extra});
    const setup = () => {
      fs.mkdirSync(fx); G(fx, ["init", "-q", "-b", "v7/integration"]);
      write("config/validation.json", JSON.stringify(cfg));
      write("config/trust-root-manifest.json", JSON.stringify({files: [{path: "config/validation.json", sha256: "x"}]}));
      write("package.json", "{}"); write("package-lock.json", "{}"); write("check-a.js", "process.exit(0)"); write("check-b.js", "process.exit(0)");
      G(fx, ["add", "-A"]); G(fx, ["commit", "-q", "-m", "base"]); base = G(fx, ["rev-parse", "HEAD"]);
      branch("pr-pass", {"feature.txt": "x"});
      branch("pr-fail", {"check-b.js": "process.exit(1)"});
      branch("pr-drift", {"config/validation.json": JSON.stringify({steps: cfg.steps.slice(1)})});
      branch("pr-timeout", {"feature.txt": "t"});
      branch("pr-crash", {"feature.txt": "c"});
      G(dir, ["clone", "-q", "--bare", fx, path.join(work, "mirror.git")]);
      const blob = C.parseLsTree(G(fx, ["ls-tree", "-r", "-z", "--full-tree", base])).get("package-lock.json")!;
      fs.mkdirSync(path.join(work, "deps", blob, "repo", "node_modules"), {recursive: true});
      fs.writeFileSync(planFile, JSON.stringify(plan));
      fs.mkdirSync(state, {recursive: true}); fs.writeFileSync(C.stateFiles(state).isolation, JSON.stringify(isolationFor(WIN_PROBE)));
    };

    it("dry run checks everything but locks, records and runs nothing", async () => {
      setup();
      const r = await runJob(opts("pr-pass", false), env());
      expect([r.outcome, r.sha, r.steps]).toEqual(["DRY_RUN", shas["pr-pass"], ["heavy-a", "heavy-b"]]);
      expect([fs.existsSync(C.stateFiles(state).lock), fs.existsSync(C.stateFiles(state).ledger)]).toEqual([false, false]);
    });

    it("runs one job to a sealed PASS evidence, then refuses to run the same job again", async () => {
      const r = await runJob(opts("pr-pass"), env());
      expect([r.outcome, r.result, r.fallback, r.sandbox]).toEqual(["RAN", "PASS", null, "DONE"]);
      const ev = JSON.parse(fs.readFileSync(path.join(C.stateFiles(state).evidence, `${r.key}.json`), "utf8"));
      const p = C.validatePlan(plan, cfg);
      expect(C.verifyEvidence(ev, {plan: p, sha: shas["pr-pass"]})).toEqual([]);
      expect(ev.steps.map((s: any) => `${s.id}:${s.status}`)).toEqual(["heavy-a:PASS", "heavy-b:PASS"]);
      expect(C.statusPayload(ev, {plan: p, sha: shas["pr-pass"]}).body.state).toBe("success");
      expect(fs.existsSync(C.stateFiles(state).lock)).toBe(false);
      expect(await runJob(opts("pr-pass"), env())).toMatchObject({outcome: "NOT_ACCEPTED", reason: "DUPLICATE_JOB:PASS", fallback: null});
    });

    it("a real test failure is a FAIL (no fallback: it goes back to its lane), not an infrastructure error", async () => {
      const r = await runJob(opts("pr-fail"), env());
      expect([r.result, r.fallback]).toEqual(["FAIL", null]);
    });

    it("protected-file drift, a busy host and a missing isolation proof are refused before anything runs, with a GitHub-hosted fallback", async () => {
      expect(await runJob(opts("pr-drift"), env())).toMatchObject({outcome: "NOT_ACCEPTED", reason: "PROTECTED_FILES_CHANGED", changed: ["config/validation.json"], fallback: C.FALLBACK});
      expect(await runJob(opts("pr-timeout"), env({probe: {...WIN_PROBE, cpu: {...WIN_PROBE.cpu, loadPct: 95}}}))).toMatchObject({reason: "CPU_BUSY", fallback: C.FALLBACK});
      expect(await runJob(opts("pr-timeout"), env({probe: {...WIN_PROBE, fingerprint: "other"}}))).toMatchObject({reason: "ISOLATION_NOT_VERIFIED", fallback: C.FALLBACK});
      const bogus = path.join(dir, "bogus.job.json");
      fs.writeFileSync(bogus, JSON.stringify({schema: C.JOB_SCHEMA, repo: C.REPO, pr: 1, sha: shas["pr-pass"], baseSha: shas["pr-drift"], planVersion: plan.version}));
      expect(await runJob({...opts("pr-pass"), job: bogus}, env())).toMatchObject({reason: "BASE_NOT_ON_TRUSTED_BRANCH", fallback: C.FALLBACK});
    });

    it("a job that outlives its time limit is killed, recorded as TIMEOUT and handed to GitHub-hosted Windows", async () => {
      let t = Date.now(), kills = 0;
      const r = await runJob(opts("pr-timeout"), env({launch: async () => {}, killAll: async () => { kills++; }, now: () => (t += 20000), sleep: async () => {}}));
      expect([r.result, r.fallback, r.sandbox, kills]).toEqual(["TIMEOUT", C.FALLBACK, "TIMEOUT", 1]);
      expect(fs.existsSync(C.stateFiles(state).lock)).toBe(false);
    });

    it("after a worker crash the stale lock blocks new work until recovery; the crashed job is then never re-run locally", async () => {
      const key = C.jobKey({repo: C.REPO, sha: shas["pr-crash"], planVersion: plan.version});
      const dead = spawnSync(process.execPath, ["-e", "0"]).pid!; // a process that has exited
      fs.writeFileSync(C.stateFiles(state).lock, JSON.stringify({key, pid: dead, startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600e3).toISOString()}));
      expect(await runJob(opts("pr-crash"), env())).toMatchObject({reason: "STALE_LOCK_RECOVER_FIRST", fallback: C.FALLBACK});
      expect(C.recover(state)).toMatchObject({recovered: true, why: "LOCK_OWNER_DEAD", key});
      expect(await runJob(opts("pr-crash"), env())).toMatchObject({reason: "DUPLICATE_JOB:ABANDONED", fallback: C.FALLBACK});
      const ledger = C.readLedger(C.stateFiles(state).ledger);
      expect([...ledger.values()].map(e => e.state).sort()).toEqual(["ABANDONED", "FAIL", "PASS", "TIMEOUT"]);
    });

    it("CLI: status is honest on this host, publishing is dry-run only, unknown input is refused", () => {
      const cli = (args: string[]) => { const r = spawnSync(process.execPath, ["scripts/local-worker/worker.mjs", ...args], {encoding: "utf8", timeout: 120000}); return {code: r.status, j: JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}")}; };
      const s = cli(["status", "--state-dir", path.join(dir, "cli-state"), "--work-root", path.join(dir, "cli-work")]);
      expect(s.code).toBe(0);
      expect(s.j.state).not.toBe("READY"); // no verified isolation on any CI host
      expect([s.j.fallback, s.j.cloudVisibility, s.j.phase]).toEqual([C.FALLBACK, "NOT_PUBLISHED_CLOUD_SEES_OFFLINE", "SHADOW"]);
      const real = C.validatePlan(PLAN, VALIDATION), sha = SHA("9");
      const job = C.validateJob({schema: C.JOB_SCHEMA, repo: C.REPO, pr: 2, sha, baseSha: SHA("8"), planVersion: real.version}, real);
      const ev = C.buildEvidence({job, plan: real, probe: WIN_PROBE, isolation: null, startedAt: 0, finishedAt: 1, result: "PASS", logSha256: null,
        report: {configSha256: "e".repeat(64), steps: C.localSteps(real).map(id => ({id, status: "PASS", durationMs: 1, timedOut: false}))}});
      const evFile = path.join(dir, "evidence.json"); fs.writeFileSync(evFile, JSON.stringify(ev));
      expect(cli(["publish", "--evidence", evFile, "--sha", sha])).toMatchObject({code: 2, j: {outcome: "PUBLISHER_NOT_ENABLED"}});
      const dry = cli(["publish", "--evidence", evFile, "--sha", sha, "--dry-run"]);
      expect([dry.code, dry.j.outcome, dry.j.payload.body.state, dry.j.payload.body.context]).toEqual([0, "DRY_RUN", "success", C.STATUS_CONTEXT]);
      expect(cli(["publish", "--evidence", evFile, "--sha", SHA("7"), "--dry-run"]).j).toEqual({outcome: "REFUSED", reason: "EVIDENCE_INVALID:SHA"});
      expect(cli(["frobnicate"]).j).toEqual({outcome: "REFUSED", reason: "COMMAND_UNKNOWN"});
      expect(cli(["status", "--bogus"]).j.reason).toBe("ARG_INVALID:--bogus");
      fs.rmSync(dir, {recursive: true, force: true});
    });
  });
}
