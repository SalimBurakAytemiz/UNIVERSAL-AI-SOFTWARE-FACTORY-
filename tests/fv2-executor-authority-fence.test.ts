// //TR: FV2 korumalı executor otorite çiti: kanonik executeMerge, tek yazısından (PUT pulls/<n>/merge) ÖNCE doğrulanmış otorite kaydını kontrol eder; kayıt yokken bugünkü davranış sürer, V2 otoritedeyken/devir ortasında/doğrulanamayan kayıtta sıfır yazı ile BLOCK döner.
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped governance module
import {executeMerge} from "../docs/planning/autonomy/executor.mjs";
// @ts-expect-error untyped governance module
import {GOVERNANCE_PREFIXES} from "../docs/planning/autonomy/autonomy.mjs";

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
});
