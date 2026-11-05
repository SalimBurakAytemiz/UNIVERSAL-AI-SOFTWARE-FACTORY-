// //TR: V3-T1032 testleri. (A) Görev eşzamanlılığı değişmezi kanıtı: aynı mission'da açık koşu varken ikinci createRun RUN_ALREADY_ACTIVE; bayat/süresi dolmuş lease yazısı WORKOS_LEASE_FENCED; devralmadan sonra eski lease yazamaz (pozitif kontroller dahil). (B) Salt okunur görev kanıt görünümü (taskEvidence): bağlı/bağsız görev, çoklu koşu, sıra, kapsam reddi, bilinmeyen görev; kanıt koşunun tamamını kapsar.
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {linkTaskRun} from "../core/workos/task-run-link.js";
import {taskEvidence} from "../core/workos/task-evidence.js";

const SC = {tenantId: "tA"}, ACT = "FOUNDER_LOCAL", TTL = 60_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t1032-")); });
afterEach(() => fs.rmSync(tmp, {recursive: true, force: true}));

function world(dir = path.join(tmp, "data")) {
  const clock = {t: Date.parse("2026-11-05T10:00:00.000Z")};
  const store = new WorkOsStore(dir, {now: () => clock.t});
  const p = store.createProject({tenantId: "tA", orgId: "o", name: "P", environmentId: "dev", createdBy: ACT});
  const mission = (title: string) => {
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: ACT});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SC, m.missionId, to, "t", ACT);
    return m;
  };
  const m = mission("M1");
  const run = (missionId = m.missionId) => store.createRun({tenantId: "tA", missionId, executor: {implementer: "impl", reviewer: "rev"}, createdBy: ACT});
  const ev = (runId: string, leaseId: string, kind: string, step: "IMPLEMENT" | "VERIFY" | "REVIEW", sha: string) => store.addRunEvidence(runId, leaseId,
    {step, cycle: 0, kind, argv: [], startedAt: new Date(clock.t).toISOString(), endedAt: new Date(clock.t).toISOString(), exitCode: 0, logPath: null, logSha256: sha}, ACT);
  const close = (runId: string, leaseId: string) => { store.transitionRun(runId, leaseId, "CANCELLING", "t", ACT); store.transitionRun(runId, leaseId, "CANCELLED", "t", ACT); };
  return {store, clock, p, m, mission, run, ev, close};
}
const fenced = (f: () => unknown) => { try { f(); } catch (e) { return (e as {code?: string}).code; } return "NO_ERROR"; };

describe("V3-T1032 (A) one worker per task: run-level exclusivity and lease fencing already hold", () => {
  it("a second createRun on a mission with an open run is RUN_ALREADY_ACTIVE; positive control: after the run is closed a new run is allowed", () => {
    const w = world();
    const r1 = w.run();
    expect(() => w.run()).toThrow(/RUN_ALREADY_ACTIVE/);
    const l = w.store.acquireRunLease(r1.runId, TTL, ACT).leaseId!;
    expect(() => w.run()).toThrow(/RUN_ALREADY_ACTIVE/);   // still open while leased
    w.close(r1.runId, l);
    expect(w.run().status).toBe("QUEUED");
  });

  it("a write with a stale or expired lease is WORKOS_LEASE_FENCED; positive control: the live lease writes", () => {
    const w = world();
    const r = w.run(), l = w.store.acquireRunLease(r.runId, TTL, ACT).leaseId!;
    expect(fenced(() => w.ev(r.runId, l, "IMPLEMENT", "IMPLEMENT", "a".repeat(64)))).toBe("NO_ERROR");
    expect(fenced(() => w.ev(r.runId, "lse_not_the_lease", "IMPLEMENT", "IMPLEMENT", "b".repeat(64)))).toBe("WORKOS_LEASE_FENCED");
    w.clock.t += TTL + 1;
    expect(fenced(() => w.ev(r.runId, l, "IMPLEMENT", "IMPLEMENT", "c".repeat(64)))).toBe("WORKOS_LEASE_FENCED");
    expect(w.store.getRun(SC, r.runId)!.evidence.map(e => e.logSha256)).toEqual(["a".repeat(64)]);
  });

  it("after takeover the old lease can never write again; the new lease can; a live lease cannot be taken over", () => {
    const w = world();
    const r = w.run(), old = w.store.acquireRunLease(r.runId, TTL, ACT).leaseId!;
    expect(fenced(() => w.store.takeoverRunLease(r.runId, TTL, "worker-2"))).toBe("WORKOS_LEASE_FENCED");   // not expired yet
    w.clock.t += TTL + 1;
    const fresh = w.store.takeoverRunLease(r.runId, TTL, "worker-2");
    expect(fresh.leaseId).not.toBe(old);
    expect(fresh.attempt).toBe(2);
    expect(fenced(() => w.ev(r.runId, old, "IMPLEMENT", "IMPLEMENT", "d".repeat(64)))).toBe("WORKOS_LEASE_FENCED");
    expect(fenced(() => w.store.renewRunLease(r.runId, old, TTL, "worker-1"))).toBe("WORKOS_LEASE_FENCED");
    expect(fenced(() => w.ev(r.runId, fresh.leaseId!, "IMPLEMENT", "IMPLEMENT", "e".repeat(64)))).toBe("NO_ERROR");
  });
});

describe("V3-T1032 (B) taskEvidence: read-only view over the linked runs' evidence chains (coverage WHOLE_RUN)", () => {
  it("linked task over two runs: link order, each run's evidence in journal order, status/attempt; a sibling task on the same run sees the same run evidence", () => {
    const w = world();
    const t1 = w.store.createTask({tenantId: "tA", missionId: w.m.missionId, title: "t1", actor: ACT});
    const t2 = w.store.createTask({tenantId: "tA", missionId: w.m.missionId, title: "t2", actor: ACT});
    const r1 = w.run(), l1 = w.store.acquireRunLease(r1.runId, TTL, ACT).leaseId!;
    linkTaskRun(w.store, SC, ACT, t1.taskId, r1.runId);
    const e1 = w.ev(r1.runId, l1, "IMPLEMENT", "IMPLEMENT", "1".repeat(64)), e2 = w.ev(r1.runId, l1, "TEST", "VERIFY", "2".repeat(64));
    w.close(r1.runId, l1);
    const r2 = w.run(), l2 = w.store.acquireRunLease(r2.runId, TTL, ACT).leaseId!;
    linkTaskRun(w.store, SC, ACT, t1.taskId, r2.runId); linkTaskRun(w.store, SC, ACT, t2.taskId, r2.runId);
    const e3 = w.ev(r2.runId, l2, "REVIEW", "REVIEW", "3".repeat(64));
    const v = taskEvidence(w.store, SC, t1.taskId);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v).toMatchObject({taskId: t1.taskId, missionId: w.m.missionId, projectId: w.p.projectId, coverage: "WHOLE_RUN"});
    expect(v.runs.map(r => [r.runId, r.status, r.attempt])).toEqual([[r1.runId, "CANCELLED", 1], [r2.runId, "LEASED", 1]]);
    expect(v.runs[0].evidence).toEqual([
      {evidenceId: e1.evidenceId, kind: "IMPLEMENT", step: "IMPLEMENT", cycle: 0, logSha256: "1".repeat(64)},
      {evidenceId: e2.evidenceId, kind: "TEST", step: "VERIFY", cycle: 0, logSha256: "2".repeat(64)}]);
    expect(v.runs[1].evidence.map(e => e.evidenceId)).toEqual([e3.evidenceId]);
    const s = taskEvidence(w.store, SC, t2.taskId);
    expect(s.ok && s.runs.map(r => r.runId)).toEqual([r2.runId]);
    expect(s.ok && s.runs[0].evidence).toEqual(v.runs[1].evidence);   // the same whole-run chain, no per-task attribution
    w.clock.t += TTL + 1;
    w.store.takeoverRunLease(r2.runId, TTL, "worker-2");
    const after = taskEvidence(w.store, SC, t1.taskId);
    expect(after.ok && after.runs.map(r => [r.status, r.attempt])).toEqual([["CANCELLED", 1], ["RECOVERING", 2]]);
  });

  it("unlinked task -> ok with no runs; unknown task and another tenant -> TASK_NOT_FOUND; read-only (journal unchanged)", () => {
    const w = world();
    const t = w.store.createTask({tenantId: "tA", missionId: w.m.missionId, title: "t", actor: ACT});
    const journal = path.join(tmp, "data", "journal.jsonl"), before = fs.readFileSync(journal);
    expect(taskEvidence(w.store, SC, t.taskId)).toEqual({ok: true, taskId: t.taskId, missionId: w.m.missionId, projectId: w.p.projectId, coverage: "WHOLE_RUN", runs: []});
    expect(taskEvidence(w.store, SC, "tsk_unknown")).toEqual({ok: false, reason: "TASK_NOT_FOUND"});
    expect(taskEvidence(w.store, {tenantId: "tB"}, t.taskId)).toEqual({ok: false, reason: "TASK_NOT_FOUND"});
    expect(fs.readFileSync(journal).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(tmp, "data", "task-run-links.jsonl"))).toBe(false);
  });

  it("scope: a project/mission expectation mismatch and a linked run of another mission are SCOPE_MISMATCH; a dangling link is RUN_NOT_FOUND; corrupt links fail closed", () => {
    const w = world();
    const t = w.store.createTask({tenantId: "tA", missionId: w.m.missionId, title: "t", actor: ACT});
    const r = w.run();
    linkTaskRun(w.store, SC, ACT, t.taskId, r.runId);
    expect(taskEvidence(w.store, SC, t.taskId, {projectId: w.p.projectId, missionId: w.m.missionId}).ok).toBe(true);   // positive control
    expect(taskEvidence(w.store, SC, t.taskId, {projectId: "prj_other"})).toEqual({ok: false, reason: "SCOPE_MISMATCH"});
    expect(taskEvidence(w.store, SC, t.taskId, {missionId: "msn_other"})).toEqual({ok: false, reason: "SCOPE_MISMATCH"});
    // a link record pointing at a run of ANOTHER mission (tampered side file) is refused, never shown as this task's evidence
    const l = w.store.acquireRunLease(r.runId, TTL, ACT).leaseId!; w.close(r.runId, l);
    const m2 = w.mission("M2"), other = w.run(m2.missionId);
    const links = path.join(tmp, "data", "task-run-links.jsonl");
    const rec = (runId: string, missionId: string) => JSON.stringify({taskId: t.taskId, runId, missionId, tenantId: "tA", linkedAt: "2026-11-05T10:00:00.000Z", linkedBy: ACT}) + "\n";
    const good = fs.readFileSync(links, "utf8");
    fs.writeFileSync(links, good + rec(other.runId, w.m.missionId));
    expect(taskEvidence(w.store, SC, t.taskId)).toEqual({ok: false, reason: "SCOPE_MISMATCH"});
    fs.writeFileSync(links, good + rec("run_000000000000000000000000", w.m.missionId));
    expect(taskEvidence(w.store, SC, t.taskId)).toEqual({ok: false, reason: "RUN_NOT_FOUND"});
    fs.writeFileSync(links, good + "not json\n" + rec(r.runId, w.m.missionId));
    expect(taskEvidence(w.store, SC, t.taskId)).toEqual({ok: false, reason: "LINK_STORE_CORRUPT"});
  });
});
