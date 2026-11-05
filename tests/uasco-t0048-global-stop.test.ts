// //TR: UASCO-T0048 GLOBAL_STOP runner testleri (FakeExecutors; gerçek sağlayıcı yok): adım başındaki stop denetiminden SONRA ama executor/test çağrısından ÖNCE yükselen stop (yarış penceresi) çağrıyı hiç başlatmaz; run açık nedenle CANCELLED + CANCEL kanıtı, mission BLOCKED; stop kalkınca kendiliğinden devam yoktur. Pozitif kontroller dahil.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import fs from "node:fs";
import {FakeExecutors} from "../core/workos/executors.js";
import {T, drive, kinds, missionOf, okScript, rmTmp, runOf, runner, setup, startRun, tmpRoot, type Ctx} from "./support/relfx.js";
import {activateGlobalStop} from "../automation/lib/global-stop.mjs";
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-t0048-"); });
afterEach(() => rmTmp(tmp));

/** Raises GLOBAL_STOP exactly when the runner starts `step` (after the drive loop's own stop check, before the step's executor/test call). */
function stopAtStepStart(c: Ctx, step: string): void {
  const st = c.store as unknown as {transitionRun: (...a: unknown[]) => unknown};
  const orig = st.transitionRun.bind(c.store);
  st.transitionRun = (...a: unknown[]) => { const r = orig(...a); if (a[3] === `step ${step} started`) activateGlobalStop(c.stopFile, `race ${step}`, "TEST"); return r; };
}
const expectStopped = (c: Ctx, runId: string, step: string) => {
  const run = runOf(c, runId);
  expect(run.status).toBe("CANCELLED");
  expect(run.reason).toBe(`GLOBAL_STOP_ACTIVE: race ${step}`);
  expect(kinds(run).at(-1)).toBe("CANCEL");
  expect(missionOf(c).status).toBe("BLOCKED");
  return run;
};

describe("UASCO-T0048 GLOBAL_STOP raised in the race window: the executor / test command is never invoked", () => {
  it("IMPLEMENT: stop raised as the step starts -> implementer never called, CANCELLED with CANCEL evidence; positive control: no stop -> implementer runs", { timeout: T }, async () => {
    const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    stopAtStepStart(c, "IMPLEMENT");
    await drive(c, runner(c, fake), r.runId);
    const run = expectStopped(c, r.runId, "IMPLEMENT");
    expect(fake.calls.implement).toBe(0);
    expect(kinds(run)).not.toContain("IMPLEMENT");

    const c2 = setup(tmp, "tA"), ok = new FakeExecutors(okScript());
    const r2 = await drive(c2, runner(c2, ok), startRun(c2, ok).runId);
    expect(r2.status).toBe("AWAITING_APPROVAL");
    expect(ok.calls.implement).toBe(1);
  });

  it("VERIFY: stop raised as the step starts -> the project test command never runs (no VERIFY_TESTS evidence); review never called", { timeout: T }, async () => {
    const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    stopAtStepStart(c, "VERIFY");
    await drive(c, runner(c, fake), r.runId);
    const run = expectStopped(c, r.runId, "VERIFY");
    expect(fake.calls.implement).toBe(1);
    expect(kinds(run)).not.toContain("VERIFY_TESTS");
    expect(fake.calls.review).toBe(0);
  });

  it("REVIEW: stop raised as the step starts -> the (paid) reviewer is never called", { timeout: T }, async () => {
    const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    stopAtStepStart(c, "REVIEW");
    await drive(c, runner(c, fake), r.runId);
    const run = expectStopped(c, r.runId, "REVIEW");
    expect(fake.calls.review).toBe(0);
    expect(kinds(run)).toContain("VERIFY_TESTS");   // earlier steps ran (positive control within the run)
    expect(kinds(run)).not.toContain("REVIEW");
  });

  it("REGRESSION: stop raised as the step starts -> the regression test command never runs", { timeout: T }, async () => {
    const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    stopAtStepStart(c, "REGRESSION");
    await drive(c, runner(c, fake), r.runId);
    const run = expectStopped(c, r.runId, "REGRESSION");
    expect(fake.calls.review).toBe(1);
    expect(kinds(run)).not.toContain("REGRESSION_TESTS");
  });

  it("stop cleared afterwards: no auto-resume (the cancelled run stays CANCELLED, nothing is invoked again, the mission stays BLOCKED)", { timeout: T }, async () => {
    const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    stopAtStepStart(c, "VERIFY");
    await drive(c, runner(c, fake), r.runId);
    const before = runOf(c, r.runId);
    expect(before.status).toBe("CANCELLED");
    fs.rmSync(c.stopFile, {force: true});
    fs.rmSync(`${c.stopFile}.prev`, {force: true});
    const eng = runner(c, fake);
    for (let i = 0; i < 3; i++) await eng.tick();
    const after = runOf(c, r.runId);
    expect(after.status).toBe("CANCELLED");
    expect(after.evidence.length).toBe(before.evidence.length);
    expect([fake.calls.implement, fake.calls.review]).toEqual([1, 0]);
    expect(missionOf(c).status).toBe("BLOCKED");
  });
});
