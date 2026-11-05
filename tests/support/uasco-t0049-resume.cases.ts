// //TR: UASCO-T0049 testleri: simüle kota engeli (BLOCKED_RESUMABLE) açık ve kapılı resumeBlockedRun ile AYNI run'dan devam eder ve tamamlanır (retry bütçesi tüketilmez); örtük istek, devam ettirilemez engel, vadesi gelmemiş resumeAfter, başka tenant, mission'ı engelden çıkarılmış run ve ikinci devam reddedilir; journal'daki devam kaydı tahrif edilirse replay tamper verir. Gerçek sağlayıcı yok (FakeExecutors).
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import {WorkOsStore} from "../../core/workos/store.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import {blockClass, pendingResumableBlock} from "../../core/workos/run-state.js";
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

  });
}
