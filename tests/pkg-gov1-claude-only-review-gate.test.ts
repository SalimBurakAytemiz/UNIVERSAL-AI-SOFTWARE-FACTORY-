// //TR: Bu test Founder yönetişim değişikliğinin (2026-10-06, V6-PKG-GOV1) açık policy etkinleştirmesini doğrular: bağımsız governed CLAUDE_REVIEWER gerekli tek inceleme kapısıdır (paket birleşmesi ve son tam depo release denetimi), Codex gerekmez ve planlanmaz, tarihsel Codex kanıtı ve işaretleri korunur, etkinleştirme yokken önceki kapı aynen sürer; senaryolar dual-review ve release-audit selftest'lerinin gov1-* bölümündedir.
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import childProcess from "node:child_process";
const read=(f:string)=>JSON.parse(fs.readFileSync(f,"utf8"));
const runGov1=(script:string)=>childProcess.spawnSync(process.execPath,[script,"--only=gov1-"],{encoding:"utf8",timeout:590000});
function expectScenarios(r:ReturnType<typeof runGov1>,label:string,names:string[]){
  expect(r.status,r.stdout.slice(-3000)+r.stderr.slice(-1500)).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";
  expect(line).toMatch(new RegExp(`^${label}: PASS ${names.length}/${names.length}$`));for(const s of names)expect(r.stdout).toMatch(new RegExp(`"${s}": "PASS"`));
}
describe("independent governed CLAUDE_REVIEWER review gate (GOV1)",{timeout:900000},()=>{
  it("schedules, merges, remediates and waits on the Claude reviewer alone once the gate is activated",()=>{
    expectScenarios(runGov1("scripts/dual-review-selftest.mjs"),"DUAL_REVIEW_SELFTEST",[
      "gov1-activation-is-explicit-two-key-hash-chained-and-recorded-once",
      "gov1-activation-releases-only-the-claude-only-governance-holds-and-the-held-packages-get-claude-reviews-only",
      "gov1-claude-only-scheduling-never-selects-codex-and-markers-stay-history",
      "gov1-claude-clean-merges-and-claude-blocked-remediates-with-attributed-findings",
      "gov1-claude-quota-is-a-provider-wait-and-a-malformed-review-follows-the-format-retry-policy",
      "gov1-a-codex-only-clean-is-not-sufficient-history-is-preserved-and-decided-gates-reconcile",
      "gov1-merge-gate-requires-a-claude-reviewer-clean-bound-to-the-frozen-bundle",
      "gov1-real-executors-an-orchestrator-built-revision-is-claude-blocked-remediated-and-merges-on-claude-clean",
      "gov1-without-the-policy-key-or-the-activation-the-gate-stays-inactive-and-fails-closed-identically"])});
  it("closes a release only on one governed CLAUDE full-repository review bound to the candidate",()=>{
    expectScenarios(runGov1("scripts/release-audit-selftest.mjs"),"RELEASE_AUDIT_SELFTEST",[
      "gov1-a-release-candidate-is-audited-by-exactly-one-governed-claude-full-repository-review",
      "gov1-the-packaging-signing-and-phase0-gates-require-the-claude-audit-evidence-bound-to-the-candidate"])});
  it("activates the CLAUDE_ONLY gate explicitly in the committed, protected policy and keeps the historical dual definitions",()=>{
    const p=read("config/orchestrator-policy.json"),g=p.reviewGate,sealed=read("config/trust-root-manifest.json").files.map((x:{path:string})=>x.path);
    expect(g.model).toBe("CLAUDE_ONLY");expect(g.required).toEqual(["claude"]);expect(g.codexRequired).toBe(false);expect(g.activatedBy).toBe("V6-PKG-GOV1-CLAUDE-ONLY-REVIEW-GATE");
    expect(g.historicalCodexEvidence).toBe("PRESERVED");expect(g.mergeRule).toBe("DETERMINISTIC_GATES_PASS_AND_CLAUDE_REVIEWER_CLEAN");expect(String(g["//TR"])).toMatch(/GOV1/);
    expect(g.releaseAudit.reviewers).toEqual(["claude"]);expect(g.releaseAudit.quorum).toBe("CLAUDE_FULL_REPO_REVIEW_CLEAN");expect(JSON.stringify(g.releaseAudit.contract)).not.toMatch(/CODEX_FULL_REPO_REVIEW/);
    const src=g.releaseAudit.contract.authorizationSources[0],ck=read(src.checkpoint);for(const f of src.fields)expect(f.split(".").reduce((o:any,k:string)=>o?.[k],ck),f).toBeDefined();
    expect(ck.releaseAuditContract.closureRule).toBe("CLAUDE_FULL_REPO_REVIEW_CLEAN");expect(ck.founderAuthorization.decision).toBe("GOVERNANCE_CHANGE_AUTHORIZED");expect(ck.cleanClaim).toBe(false);
    expect(p.review.dualReviewRequired).toBe(true);expect(p.releaseAudit.reviewers).toEqual(["claude","codex"]);expect(p.releaseAudit.required).toBe(true);
    for(const f of ["automation/lib/review-quorum.mjs","automation/lib/orchestrator-engine.mjs","automation/lib/orchestrator-executors.mjs","config/orchestrator-policy.json","scripts/dual-review-selftest.mjs","scripts/release-audit-selftest.mjs"])expect(sealed,`${f} is not sealed in the trust root`).toContain(f)});
});
