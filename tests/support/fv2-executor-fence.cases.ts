// //TR: FV2 korumalı executor otorite çiti (tests/v7-cloud-contracts.test.ts altında kayıtlı, tests-8 adımı): kanonik executeMerge, tek yazısından (PUT pulls/<n>/merge) ÖNCE doğrulanmış otorite kaydını kontrol eder; kayıt yokken bugünkü davranış sürer, V2 otoritedeyken/devir ortasında/doğrulanamayan kayıtta sıfır yazı ile BLOCK döner.
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped governance module
import {executeMerge, runCli} from "../../docs/planning/autonomy/executor.mjs";
// @ts-expect-error untyped governance module
import {GOVERNANCE_PREFIXES, TRUST_FILES} from "../../docs/planning/autonomy/autonomy.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function registerFv2ExecutorFenceCases(): void {
  const H = "a".repeat(40), B = "b".repeat(40);
  const run = (authority: unknown) => {
    let writes = 0;
    const r = executeMerge({pr: 7, implementerSessions: ["s"], authority,
      collect: () => ({policy: {mergeMethod: "merge"}, evidence: {pr: {base: {ref: "v7/integration"}}}}),
      decide: () => ({gate: {decision: "MERGE"}, result: {decision: "AUTO_MERGE", task: "X-T0001", expectedHeadSha: H, expectedBaseSha: B, reasons: []}}),
      api: (p: string) => (p.startsWith("branches/") ? {commit: {sha: B}} : {}), write: () => { writes++; return {merged: false}; }});
    return {r, writes};
  };
  describe("FV2 protected change: authority fence before the canonical merge write", () => {
    it("no authority record: today's behaviour (proceeds to the write)", () => { expect(run(() => ({allowed: true, by: "V4.1"})).writes).toBe(1); });
    it.each([["V2 authoritative", "V41_FENCED_BY_V2_AUTHORITY"], ["mid-handover", "HANDOVER_IN_PROGRESS:V41_DRAINED"], ["unverifiable", "AUTHORITY_UNVERIFIABLE:x"], ["unprotected registry", "REGISTRY_NOT_PROTECTED"]])
      ("%s: BLOCK with zero writes", (_n, reason) => { const {r, writes} = run(() => ({allowed: false, reason})); expect(r).toMatchObject({decision: "BLOCK", reasons: [`AUTHORITY:${reason}`]}); expect(writes).toBe(0); });
    it("the authority check throwing: BLOCK, zero writes", () => { const {r, writes} = run(() => { throw new Error("boom"); }); expect(r.reasons).toEqual(["AUTHORITY:AUTHORITY_CHECK_FAILED"]); expect(writes).toBe(0); });
    it("automation/factory-v2/ is a governance prefix (the guard cannot be weakened by a routine PR)", () => { expect(GOVERNANCE_PREFIXES).toContain("automation/factory-v2/"); });
    it("the guard and its import closure are trust files (byte-identical to the base before any decision)", () => {
      for (const f of ["v41-guard", "bridge", "identity", "shared-registry", "ownership", "scheduler", "topology"]) expect(TRUST_FILES).toContain(`automation/factory-v2/${f}.mjs`);
      for (const f of ["task-lease", "task-lease-git-store"]) expect(TRUST_FILES).toContain(`automation/lib/${f}.mjs`);
      for (const f of TRUST_FILES) expect(fs.existsSync(f)).toBe(true);
    });
    it("--v2-intent: more than one is refused before anything runs; an unreadable or unparseable file never reaches executeMerge", () => {
      expect(runCli(["merge", "--pr", "7", "--v2-intent", "a.json", "--v2-intent", "b.json"])).toMatchObject({res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}});
      expect(() => runCli(["merge", "--pr", "7", "--v2-intent", path.join(os.tmpdir(), "fv2-no-such-intent.json")])).toThrow();
      const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fv2-intent-")), "i.json"); fs.writeFileSync(bad, "{not json");
      expect(() => runCli(["merge", "--pr", "7", "--v2-intent", bad])).toThrow();
    });
    it("the authority check receives exactly the PR, the head being merged and the V2 intent", () => {
      const seen: unknown[] = [];
      let writes = 0;
      executeMerge({pr: 7, implementerSessions: ["s"], v2Intent: {signed: "intent"}, authority: (a: unknown) => { seen.push(a); return {allowed: false, reason: "X"}; },
        collect: () => ({policy: {mergeMethod: "merge"}, evidence: {pr: {base: {ref: "v7/integration"}}}}),
        decide: () => ({gate: {decision: "MERGE"}, result: {decision: "AUTO_MERGE", task: "X-T0001", expectedHeadSha: H, expectedBaseSha: B, reasons: []}}),
        api: (p: string) => (p.startsWith("branches/") ? {commit: {sha: B}} : {}), write: () => { writes++; return {merged: false}; }});
      expect(seen).toEqual([{pr: 7, headSha: H, v2Intent: {signed: "intent"}}]);
      expect(writes).toBe(0);
    });
  });
}
