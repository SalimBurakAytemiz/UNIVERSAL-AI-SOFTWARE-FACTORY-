// //TR: V3-T1016 kota olay modeli testleri: simüle sağlayıcı kotası run'ı açık nedenle (PROVIDER_QUOTA) durdurur ve engel noktasında şemalı checkpoint yazar (BLOCKED_RESUMABLE); diğer BLOCKED'lar terminaldir; devam ettirilebilir engel açık resume çağrısı olmadan asla kendiliğinden sürdürülmez. Gerçek/ücretli sağlayıcı yok (FakeExecutors).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {WorkOsStore} from "../core/workos/store.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {providerResumeAfter} from "../core/workos/runner.js";
import {autoResumeAllowed, blockClass, isResumableBlockCheckpoint, pendingResumableBlock, resumableBlockCheckpoint, resumeGate, type ResumableBlockCheckpoint} from "../core/workos/run-state.js";
import type {RunCheckpoint, RunStatus, RunStep} from "../core/workos/types.js";
import {T, drive, missionOf, okScript, rmTmp, runOf, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-t1016-"); });
afterEach(() => rmTmp(tmp));

const RESET_SEC = 1760540400, RESET_ISO = new Date(RESET_SEC * 1000).toISOString();
const QUOTA_STDERR = `Claude AI usage limit reached|${RESET_SEC}`;
const lastCheckpoint = (r: {checkpoints: RunCheckpoint[]}) => r.checkpoints[r.checkpoints.length - 1];

describe("V3-T1016 simulated provider quota -> BLOCKED_RESUMABLE with a checkpoint at the block point", () => {
  it("implementer QUOTA_EXHAUSTED: run BLOCKED(PROVIDER_QUOTA), retry budget untouched, schema checkpoint (step, attempt, last evidence ref, resumeAfter) persisted and replayed", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({implement: () => ({exitCode: 75, stderr: QUOTA_STDERR})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("PROVIDER_QUOTA");
    expect(run.retryCount).toBe(0);
    expect(run.step).toBe("IMPLEMENT");
    expect(fake.calls.implement).toBe(1);
    expect(missionOf(c).status).toBe("BLOCKED");
    const impl = run.evidence.filter(e => e.kind === "IMPLEMENT").at(-1)!;
    const cp = lastCheckpoint(run);
    expect(cp.step).toBe("IMPLEMENT");
    expect(cp.data).toEqual({outcome: "BLOCKED_RESUMABLE", schema: 1, reason: "PROVIDER_QUOTA", limit: "QUOTA_EXHAUSTED", step: "IMPLEMENT", attempt: 1, retryCount: 0,
      lastEvidenceRef: impl.evidenceId, resumeAfter: RESET_ISO, blockedAt: expect.any(String), resume: "EXPLICIT_ONLY"});
    expect(isResumableBlockCheckpoint(cp.data)).toBe(true);
    expect(blockClass(run)).toBe("BLOCKED_RESUMABLE");
    expect(autoResumeAllowed(run)).toBe(false);
    // journal replay (fresh store) reproduces the same state; nothing tampered
    const re = new WorkOsStore(c.dataDir);
    expect(re.isTampered).toBe(false);
    const rr = re.getRun({tenantId: "tA"}, created.runId)!;
    expect(lastCheckpoint(rr).data).toEqual(cp.data);
    expect(blockClass(rr)).toBe("BLOCKED_RESUMABLE");
  });

  it("reviewer RATE_LIMIT: checkpoint at step REVIEW with limit RATE_LIMIT, resumeAfter null (unknown), last evidence = the REVIEW evidence", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({review: () => ({exitCode: 1, raw: "API Error: 429 Too Many Requests (rate limit)"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PROVIDER_QUOTA", retryCount: 0, step: "REVIEW"}));
    const rev = run.evidence.filter(e => e.kind === "REVIEW").at(-1)!;
    expect(lastCheckpoint(run).data).toEqual(expect.objectContaining({outcome: "BLOCKED_RESUMABLE", limit: "RATE_LIMIT", step: "REVIEW", lastEvidenceRef: rev.evidenceId, resumeAfter: null}));
    expect(blockClass(run)).toBe("BLOCKED_RESUMABLE");
  });

  it("#360 N-1: the checkpoint records the run's CURRENT retryCount (a transient failure first, then quota: retryCount 1 is preserved, not reset)", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    let n = 0;
    const fake = new FakeExecutors(okScript({implement: () => (++n === 1 ? {exitCode: 75} : {exitCode: 75, stderr: QUOTA_STDERR})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2, retryBackoffMs: [0]}), created.runId);
    expect(fake.calls.implement).toBe(2);
    expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PROVIDER_QUOTA", retryCount: 1}));
    expect(lastCheckpoint(run).data).toEqual(expect.objectContaining({outcome: "BLOCKED_RESUMABLE", step: "IMPLEMENT", retryCount: 1}));
  });

  it("control: a non-quota block (DISK_FULL) stays terminal BLOCKED: no resumable checkpoint, blockClass BLOCKED_TERMINAL", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({implement: () => ({exitCode: 1, stderr: "ENOSPC: no space left on device, write"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: "DISK_FULL", retryCount: 0}));
    expect(run.checkpoints.some(x => isResumableBlockCheckpoint(x.data))).toBe(false);
    expect(blockClass(run)).toBe("BLOCKED_TERMINAL");
  });

  it("guard: a crash after the resumable checkpoint but before BLOCKED is NOT auto-resumed by takeover: the step (paid provider call) is never re-executed", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({implement: () => ({exitCode: 75, stderr: QUOTA_STDERR})}));
    const created = startRun(c, fake);
    // simulated process death right after the checkpoint is durable: every later run write of engine A fails
    let dead = false;
    const st = c.store as unknown as {checkpointRun: (...a: unknown[]) => unknown; transitionRun: (...a: unknown[]) => unknown};
    const cpOrig = st.checkpointRun.bind(c.store), trOrig = st.transitionRun.bind(c.store);
    st.checkpointRun = (...a: unknown[]) => { const r = cpOrig(...a); if ((a[2] as {data: {outcome?: string}}).data.outcome === "BLOCKED_RESUMABLE") dead = true; return r; };
    st.transitionRun = (...a: unknown[]) => { if (dead) throw new Error("SIMULATED_CRASH"); return trOrig(...a); };
    await runner(c, fake, {maxRetries: 2}).tick();
    const mid = runOf(c, created.runId);
    expect(mid.status).toBe("CHECKPOINTING");
    expect(pendingResumableBlock(mid)).not.toBeNull();
    expect(autoResumeAllowed(mid)).toBe(false);
    expect(fake.calls.implement).toBe(1);
    const later = Date.now() + 10 * 60_000;
    const storeB = new WorkOsStore(c.dataDir, {now: () => later});
    const rep = await runner(c, fake, {maxRetries: 2, store: storeB, now: () => later}).tick();
    expect(rep.recovered).toEqual([created.runId]);
    const run = runOf(c, created.runId);
    expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PROVIDER_QUOTA", retryCount: 0}));
    expect(fake.calls.implement).toBe(1);   // not re-executed
    expect(blockClass(run)).toBe("BLOCKED_RESUMABLE");
    expect(missionOf(c).status).toBe("BLOCKED");
  });
});

describe("V3-T1016 checkpoint schema, block classification and the explicit-resume gate (pure)", () => {
  const base = (): ResumableBlockCheckpoint => resumableBlockCheckpoint({reason: "PROVIDER_QUOTA", limit: "QUOTA_EXHAUSTED", step: "IMPLEMENT", attempt: 1, retryCount: 0,
    lastEvidenceRef: "evd_0123456789abcdef", resumeAfter: "2026-11-05T12:00:00.000Z", blockedAt: "2026-11-05T10:00:00.000Z"});
  const view = (o: {status?: RunStatus; reason?: string | null; step?: RunStep; data?: Record<string, unknown>; cpStep?: RunStep; extra?: RunCheckpoint[]} = {}) => ({
    status: o.status ?? "BLOCKED" as RunStatus, reason: o.reason === undefined ? "PROVIDER_QUOTA" : o.reason, step: o.step ?? "IMPLEMENT" as RunStep,
    checkpoints: [{step: o.cpStep ?? "IMPLEMENT" as RunStep, cycle: 0, at: "2026-11-05T10:00:00.000Z", data: o.data ?? {...base()}}, ...(o.extra ?? [])]});
  const AFTER = Date.parse("2026-11-05T12:00:00.000Z");

  it("schema validator: positive control accepted; every single-field corruption, a missing key and an extra key are rejected; the builder refuses invalid input", () => {
    expect(isResumableBlockCheckpoint(base())).toBe(true);
    const bad: Array<[string, Record<string, unknown>]> = [
      ["outcome", {outcome: "BLOCKED"}], ["schema", {schema: 2}], ["reason", {reason: "DISK_FULL"}], ["limit", {limit: "DISK_FULL"}], ["step", {step: "DEPLOY"}],
      ["attempt", {attempt: 0}], ["retryCount", {retryCount: -1}], ["lastEvidenceRef", {lastEvidenceRef: "../etc"}], ["resumeAfter", {resumeAfter: "tomorrow"}],
      ["blockedAt", {blockedAt: "2026-11-05 10:00"}], ["resume", {resume: "AUTO"}], ["extra", {autoResume: true}],
    ];
    for (const [k, patch] of bad) expect(isResumableBlockCheckpoint({...base(), ...patch}), k).toBe(false);
    const {resume: _r, ...missing} = base();
    expect(isResumableBlockCheckpoint(missing)).toBe(false);
    expect(isResumableBlockCheckpoint({...base(), lastEvidenceRef: null, resumeAfter: null})).toBe(true);
    expect(() => resumableBlockCheckpoint({...base(), attempt: 0})).toThrow(/INVALID_RESUMABLE_BLOCK_CHECKPOINT/);
  });

  it("blockClass: recorded quota block = BLOCKED_RESUMABLE; reason mismatch, superseded checkpoint, step mismatch or corrupt record = BLOCKED_TERMINAL; not BLOCKED = null", () => {
    expect(blockClass(view())).toBe("BLOCKED_RESUMABLE");
    expect(blockClass(view({reason: "DISK_FULL"}))).toBe("BLOCKED_TERMINAL");
    expect(blockClass(view({extra: [{step: "IMPLEMENT", cycle: 0, at: "2026-11-05T11:00:00.000Z", data: {attempt: 1}}]}))).toBe("BLOCKED_TERMINAL");
    expect(blockClass(view({step: "VERIFY"}))).toBe("BLOCKED_TERMINAL");
    expect(blockClass(view({data: {...base(), step: "VERIFY"}}))).toBe("BLOCKED_TERMINAL");
    expect(blockClass(view({data: {...base(), resume: "AUTO"}}))).toBe("BLOCKED_TERMINAL");
    expect(blockClass(view({status: "FAILED"}))).toBeNull();
    expect(autoResumeAllowed(view())).toBe(false);
    expect(autoResumeAllowed(view({extra: [{step: "IMPLEMENT", cycle: 0, at: "2026-11-05T11:00:00.000Z", data: {attempt: 1}}]}))).toBe(true);   // positive control
  });

  it("resumeGate: only an explicit request on a BLOCKED_RESUMABLE run whose resumeAfter has passed is admitted", () => {
    const req = {explicit: true, requestedBy: "FOUNDER_LOCAL"};
    expect(resumeGate(view(), req, AFTER)).toEqual({ok: true, checkpoint: base()});   // positive control
    for (const r of [undefined, null, {}, {explicit: false, requestedBy: "FOUNDER_LOCAL"}, {explicit: "true", requestedBy: "x"}, {explicit: true}, {explicit: true, requestedBy: "  "}])
      expect(resumeGate(view(), r, AFTER), JSON.stringify(r)).toEqual({ok: false, reason: "RESUME_REQUIRES_EXPLICIT_CALL"});
    expect(resumeGate(view({reason: "DISK_FULL"}), req, AFTER)).toEqual({ok: false, reason: "NOT_RESUMABLE"});
    expect(resumeGate(view({status: "FAILED"}), req, AFTER)).toEqual({ok: false, reason: "NOT_RESUMABLE"});
    expect(resumeGate(view(), req, AFTER - 1)).toEqual({ok: false, reason: "RESUME_NOT_YET_DUE"});
    expect(resumeGate(view({data: {...base(), resumeAfter: null}}), req, 0)).toEqual(expect.objectContaining({ok: true}));
  });

  it("providerResumeAfter: only a Claude CLI usage-limit line with a sane unix reset time yields resumeAfter; anything else is null (no guessing)", () => {
    expect(providerResumeAfter(`out\n${QUOTA_STDERR}\n`)).toBe(RESET_ISO);
    expect(providerResumeAfter("Claude AI usage limit reached")).toBeNull();
    expect(providerResumeAfter("TypeError: x usage limit reached|1760540400")).toBeNull();
    expect(providerResumeAfter("Claude AI usage limit reached|9999999999")).toBeNull();
    expect(providerResumeAfter("API Error: 429 Too Many Requests")).toBeNull();
  });
});
