// //TR: UASCO-T0049 testleri (2. bölüm: Founder duraklatması adım sınırında BLOCKED(PAUSED) olur ve aynı run devam eder): simüle kota engeli (BLOCKED_RESUMABLE) açık ve kapılı resumeBlockedRun ile AYNI run'dan devam eder ve tamamlanır (retry bütçesi tüketilmez); örtük istek, devam ettirilemez engel, vadesi gelmemiş resumeAfter, başka tenant, mission'ı engelden çıkarılmış run ve ikinci devam reddedilir; journal'daki devam kaydı tahrif edilirse replay tamper verir. Gerçek sağlayıcı yok (FakeExecutors).
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import {WorkOsStore} from "../../core/workos/store.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import {blockClass, isResumableBlockCheckpoint, pendingResumableBlock} from "../../core/workos/run-state.js";
import {T, drive, missionOf, okScript, rewriteJournal, rmTmp, runOf, runner, setup, startRun, tmpRoot, type Ctx} from "./relfx.js";

/** Registered from tests/v7-relfx-4-interruption.test.ts (listed in config/validation.json); the suite's hooks are scoped to this describe. */
export function registerUascoT0049ResumeSuite(): void {
  describe("UASCO-T0049 explicit resume of a BLOCKED_RESUMABLE run", () => {

    let tmp = "";
    beforeEach(() => { tmp = tmpRoot("uasco-t0049-"); });
    afterEach(() => rmTmp(tmp));

    const REQ = {explicit: true, requestedBy: "FOUNDER_LOCAL"};
    const code = (f: () => unknown) => { try { f(); return "OK"; } catch (e) { return String((e as Error).message); } };
    const PAST_RESET = Math.floor(Date.now() / 1000) - 3600, FUTURE_RESET = Math.floor(Date.now() / 1000) + 3600;

    /** Quota on the first implementer call, success afterwards (the provider limit resets). */
    async function quotaBlocked(c: Ctx, resetSec = PAST_RESET, stderr = `Claude AI usage limit reached|${resetSec}`) {
      let n = 0;
      const fake = new FakeExecutors(okScript({implement: () => (++n === 1 ? {exitCode: 75, stderr} : {files: {"feature.txt": "ok\n"}})}));
      const created = startRun(c, fake);
      const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
      expect(run).toEqual(expect.objectContaining({status: "BLOCKED", reason: stderr.includes("ENOSPC") ? "DISK_FULL" : "PROVIDER_QUOTA", retryCount: 0}));
      return {fake, runId: created.runId};
    }

    describe("UASCO-T0049 explicit resume of a BLOCKED_RESUMABLE run continues the SAME run", () => {
      it("quota block -> resumeBlockedRun -> the same run is QUEUED at its step, then completes; retry budget untouched; replay identical", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        const {fake, runId} = await quotaBlocked(c);
        expect(missionOf(c).status).toBe("BLOCKED");
        const resumed = c.store.resumeBlockedRun({tenantId: "tA"}, runId, REQ, "FOUNDER_LOCAL");
        expect(resumed).toEqual(expect.objectContaining({runId, status: "QUEUED", step: "IMPLEMENT", retryCount: 0, leaseId: null, reason: "RESUMED: FOUNDER_LOCAL"}));
        expect(resumed.checkpoints.at(-1)?.data).toEqual({outcome: "RESUMED", resumedFrom: "PROVIDER_QUOTA", attempt: 1, requestedBy: "FOUNDER_LOCAL"});
        expect(pendingResumableBlock(resumed)).toBeNull();   // the guard does not re-block a resumed run
        expect(missionOf(c).status).toBe("EXECUTING");
        const done = await drive(c, runner(c, fake, {maxRetries: 2}), runId);
        expect(done).toEqual(expect.objectContaining({runId, status: "AWAITING_APPROVAL", retryCount: 0}));
        expect(fake.calls.implement).toBe(2);
        expect(missionOf(c).status).toBe("REPORTING");
        expect(c.store.listRuns({tenantId: "tA"}).length).toBe(1);   // no new run was created
        const re = new WorkOsStore(c.dataDir);
        expect(re.isTampered).toBe(false);
        expect(re.getRun({tenantId: "tA"}, runId)!.checkpoints.map(x => x.data.outcome ?? x.step)).toEqual(done.checkpoints.map(x => x.data.outcome ?? x.step));
      });

      it("refusals: implicit request, not resumable (DISK_FULL), not yet due, other tenant, mission no longer BLOCKED, a second resume; nothing is written", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        const {runId} = await quotaBlocked(c);
        const sc = {tenantId: "tA"};
        for (const bad of [undefined, {}, {explicit: false, requestedBy: "x"}, {explicit: true, requestedBy: " "}])
          expect(code(() => c.store.resumeBlockedRun(sc, runId, bad, "FOUNDER_LOCAL"))).toMatch(/RESUME_REQUIRES_EXPLICIT_CALL/);
        expect(code(() => c.store.resumeBlockedRun({tenantId: "tB"}, runId, REQ, "FOUNDER_LOCAL"))).toMatch(/WORKOS_NOT_FOUND/);
        expect(runOf(c, runId).status).toBe("BLOCKED");
        // positive control, then a second resume is refused
        expect(c.store.resumeBlockedRun(sc, runId, REQ, "FOUNDER_LOCAL").status).toBe("QUEUED");
        expect(code(() => c.store.resumeBlockedRun(sc, runId, REQ, "FOUNDER_LOCAL"))).toMatch(/NOT_RESUMABLE/);

        const d = setup(tmp, "tA");
        const disk = await quotaBlocked(d, 0, "ENOSPC: no space left on device, write");
        expect(blockClass(runOf(d, disk.runId))).toBe("BLOCKED_TERMINAL");
        expect(code(() => d.store.resumeBlockedRun(sc, disk.runId, REQ, "FOUNDER_LOCAL"))).toMatch(/NOT_RESUMABLE/);

        const f = setup(tmp, "tA");
        const future = await quotaBlocked(f, FUTURE_RESET);
        expect(code(() => f.store.resumeBlockedRun(sc, future.runId, REQ, "FOUNDER_LOCAL"))).toMatch(/RESUME_NOT_YET_DUE/);
        const later = new WorkOsStore(f.dataDir, {now: () => (FUTURE_RESET + 1) * 1000});
        expect(later.resumeBlockedRun(sc, future.runId, REQ, "FOUNDER_LOCAL").status).toBe("QUEUED");   // due -> allowed

        const g = setup(tmp, "tA");
        const moved = await quotaBlocked(g);
        g.store.transitionMission(sc, g.missionId, "PREFLIGHT", "Founder reopened", "FOUNDER_LOCAL");
        expect(code(() => g.store.resumeBlockedRun(sc, moved.runId, REQ, "FOUNDER_LOCAL"))).toMatch(/MISSION_NOT_BLOCKED/);
      });

      it("replay re-validates RUN_RESUMED: a forged mission target, checkpoint or empty requester is tamper (positive control: untouched journal opens)", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        const {runId} = await quotaBlocked(c);
        c.store.resumeBlockedRun({tenantId: "tA"}, runId, REQ, "FOUNDER_LOCAL");
        expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
        const forge = (f: (p: any) => void) => {
          const d = setup(tmp, "tA");
          rewriteJournal(d, () => {
            const es = JSON.parse(JSON.stringify(fs.readFileSync(`${c.dataDir}/journal.jsonl`, "utf8").split("\n").filter(Boolean).map((l: string) => JSON.parse(l))));
            f(es.find((e: any) => e.type === "RUN_RESUMED").payload);
            return es;
          });
          return new WorkOsStore(d.dataDir).isTampered;
        };
        expect(forge(() => {})).toBe(false);
        expect(forge(p => { p.mission.to = "REPORTING"; })).toBe(true);
        expect(forge(p => { p.checkpoint.data.attempt = 9; })).toBe(true);
        expect(forge(p => { p.requestedBy = ""; p.checkpoint.data.requestedBy = ""; })).toBe(true);
        expect(forge(p => { p.to = "LEASED"; })).toBe(true);
      });
    });


    describe("UASCO-T0049 (2) per-run PAUSE at the step boundary; the same run resumes", () => {
      const PAUSE = {explicit: true, requestedBy: "FOUNDER_LOCAL"};
      it("pause requested while IMPLEMENT runs: the step is NOT interrupted, the run stops BLOCKED(PAUSED) at the VERIFY boundary; resume completes the same run", { timeout: T }, async () => {
        const c = setup(tmp, "tA");
        let runId = "";
        const fake = new FakeExecutors(okScript({implement: () => { c.store.requestRunPause({tenantId: "tA"}, runId, PAUSE, "FOUNDER_LOCAL"); return {files: {"feature.txt": "ok\n"}}; }}));
        runId = startRun(c, fake).runId;
        const paused = await drive(c, runner(c, fake), runId);
        expect(paused).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PAUSED", step: "VERIFY", retryCount: 0}));
        expect(paused.headSha).toMatch(/^[0-9a-f]{40}$/);   // IMPLEMENT finished its commit (no mid-step stop)
        expect(paused.checkpoints.at(-1)?.data).toEqual(expect.objectContaining({outcome: "BLOCKED_RESUMABLE", reason: "PAUSED", limit: "FOUNDER_PAUSE", step: "VERIFY", resumeAfter: null}));
        expect(blockClass(paused)).toBe("BLOCKED_RESUMABLE");
        expect([fake.calls.implement, fake.calls.review]).toEqual([1, 0]);
        expect(missionOf(c).status).toBe("BLOCKED");
        const back = c.store.resumeBlockedRun({tenantId: "tA"}, runId, REQ, "FOUNDER_LOCAL");
        expect(back).toEqual(expect.objectContaining({status: "QUEUED", step: "VERIFY"}));
        expect(back.pauseRequested).toBeUndefined();
        expect(missionOf(c).status).toBe("VERIFYING");
        const done = await drive(c, runner(c, fake), runId);
        expect(done).toEqual(expect.objectContaining({runId, status: "AWAITING_APPROVAL"}));
        expect([fake.calls.implement, fake.calls.review]).toEqual([1, 1]);
        expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
      });

      it("pause on a QUEUED run: nothing executes, BLOCKED(PAUSED) at WORKSPACE (mission PLANNED -> BLOCKED); positive control: an unpaused run executes", { timeout: T }, async () => {
        const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
        const r = startRun(c, fake);
        c.store.requestRunPause({tenantId: "tA"}, r.runId, PAUSE, "FOUNDER_LOCAL");
        const paused = await drive(c, runner(c, fake), r.runId);
        expect(paused).toEqual(expect.objectContaining({status: "BLOCKED", reason: "PAUSED", step: "WORKSPACE"}));
        expect(paused.evidence).toEqual([]);
        expect(fake.calls.implement).toBe(0);
        expect(c.store.resumeBlockedRun({tenantId: "tA"}, r.runId, REQ, "FOUNDER_LOCAL").status).toBe("QUEUED");
        expect(missionOf(c).status).toBe("PLANNED");
        expect((await drive(c, runner(c, fake), r.runId)).status).toBe("AWAITING_APPROVAL");
        expect(fake.calls.implement).toBe(1);
      });

      it("pause refusals (implicit, other tenant, not open, duplicate), schema pairing, and forged RUN_PAUSE_REQUESTED is tamper", { timeout: T }, async () => {
        const c = setup(tmp, "tA"), fake = new FakeExecutors(okScript());
        const r = startRun(c, fake), sc = {tenantId: "tA"};
        for (const bad of [undefined, {}, {explicit: false, requestedBy: "x"}, {explicit: true, requestedBy: "  "}])
          expect(code(() => c.store.requestRunPause(sc, r.runId, bad, "FOUNDER_LOCAL"))).toMatch(/PAUSE_REQUIRES_EXPLICIT_CALL/);
        expect(code(() => c.store.requestRunPause({tenantId: "tB"}, r.runId, PAUSE, "FOUNDER_LOCAL"))).toMatch(/WORKOS_NOT_FOUND/);
        expect(c.store.requestRunPause(sc, r.runId, PAUSE, "FOUNDER_LOCAL").pauseRequested?.requestedBy).toBe("FOUNDER_LOCAL");
        expect(code(() => c.store.requestRunPause(sc, r.runId, PAUSE, "FOUNDER_LOCAL"))).toMatch(/PAUSE_ALREADY_REQUESTED/);
        await drive(c, runner(c, fake), r.runId);
        expect(code(() => c.store.requestRunPause(sc, r.runId, PAUSE, "FOUNDER_LOCAL"))).toMatch(/RUN_NOT_PAUSABLE/);   // BLOCKED is not open
        const d = setup(tmp, "tA"), ok = new FakeExecutors(okScript());
        const done = await drive(d, runner(d, ok), startRun(d, ok).runId);
        expect(done.status).toBe("AWAITING_APPROVAL");
        expect(code(() => d.store.requestRunPause(sc, done.runId, PAUSE, "FOUNDER_LOCAL"))).toMatch(/RUN_NOT_PAUSABLE/);
        // schema: the reason/limit pair is fixed
        const base = {outcome: "BLOCKED_RESUMABLE", schema: 1, step: "IMPLEMENT", attempt: 1, retryCount: 0, lastEvidenceRef: null, resumeAfter: null, blockedAt: "2026-11-05T10:00:00.000Z", resume: "EXPLICIT_ONLY"};
        expect(isResumableBlockCheckpoint({...base, reason: "PAUSED", limit: "FOUNDER_PAUSE"})).toBe(true);
        expect(isResumableBlockCheckpoint({...base, reason: "PAUSED", limit: "QUOTA_EXHAUSTED"})).toBe(false);
        expect(isResumableBlockCheckpoint({...base, reason: "PROVIDER_QUOTA", limit: "FOUNDER_PAUSE"})).toBe(false);
        // replay: a pause request forged onto a terminal run, or with an empty requester, is tamper
        const forge = (f: (es: any[]) => void) => {
          const e = setup(tmp, "tA");
          rewriteJournal(e, () => { const es = fs.readFileSync(`${d.dataDir}/journal.jsonl`, "utf8").split("\n").filter(Boolean).map((l: string) => JSON.parse(l)); f(es); return es; });
          return new WorkOsStore(e.dataDir).isTampered;
        };
        const pauseEntry = (runId: string, requestedBy: string) => ({seq: 0, prevHash: "", type: "RUN_PAUSE_REQUESTED", actor: "X", at: "2026-11-05T12:00:00.000Z", payload: {runId, requestedBy}});
        expect(forge(() => {})).toBe(false);
        expect(forge(es => { es.push(pauseEntry(done.runId, "FOUNDER_LOCAL")); })).toBe(true);
        expect(forge(es => { const i = es.findIndex(x => x.type === "RUN_TRANSITION" && x.payload.to === "QUEUED"); es.splice(i + 1, 0, pauseEntry(done.runId, "")); })).toBe(true);
      });
    });

  });
}
