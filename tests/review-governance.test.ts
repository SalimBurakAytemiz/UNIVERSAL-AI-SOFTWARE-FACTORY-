// //TR: Bu test strict review parser, Cycle2 moving-goalpost, prior blocker omission ve stable fingerprint davranışını doğrular.
import {describe,it,expect} from "vitest";import {parseStrictReviewJson,governConvergence,canonicalFindingFingerprint} from "../automation/lib/review-governance.mjs";
const prior:any={id:"F-1",category:"runtime",basisRefs:["AC-1"],file:"x.ts",symbol:"x",remediationAcceptance:"fixed",classification:"BLOCKER",status:"OPEN",currentDiffCausality:"CURRENT_DIFF",scopeStatus:"IN_SCOPE",severity:"P1",confidence:1,firstSeenCycle:1,evidenceRefs:["e"],expected:"a",observed:"b",reproduction:{steps:["run"]},blockerReason:"broken"};prior.fingerprint=canonicalFindingFingerprint(prior);
describe("review governance",()=>{it("rejects prose clean",()=>expect(()=>parseStrictReviewJson("I cannot return CLEAN because...")).toThrow());it("rejects omitted prior blocker",()=>expect(()=>governConvergence({findings:[],advisories:[],priorBlockerDispositions:[]} as any,[prior],2)).toThrow());it("downgrades unproven new cycle2 blocker",()=>{const fresh:any={...prior,id:"F-2",file:"y.ts",firstSeenCycle:2};fresh.fingerprint=canonicalFindingFingerprint(fresh);const g=governConvergence({findings:[fresh],advisories:[],priorBlockerDispositions:[{findingId:"F-1",disposition:"OPEN"}]} as any,[prior],2);expect(g.acceptedBlockers).toHaveLength(0)});it("fingerprint ignores remediation wording",()=>expect(canonicalFindingFingerprint({...prior,remediationAcceptance:"different"})).toBe(canonicalFindingFingerprint(prior)))});

// //TR: Autonomous Authority Engine senaryolari (kayitli bu dosyadan calisir; korunan validation.json kaydi gerektirmez).
import {registerAutonomousAuthorityCases} from "./support/autonomous-authority.cases.js";
registerAutonomousAuthorityCases();

// //TR: UASCO Independent Review zorunlu kontrolünün ağsız kanıtı (saf kapı, workflow güven sınırları, sahte GitHub API'ye karşı gerçek aşamalar) bu kayıtlı dosyadan çalışır; korunan validation.json kaydı gerektirmez.
import {spawnSync} from "node:child_process";
describe("UASCO Independent Review gate",{timeout:180000},()=>{
  it("passes every scenario of the review-gate proof",()=>{const r=spawnSync(process.execPath,["scripts/ci/uasco-review/review-gate.proof.mjs"],{encoding:"utf8",timeout:170000});expect(r.status,r.stdout+r.stderr).toBe(0);const line=r.stdout.trim().split(/\r?\n/).pop()??"";expect(line).toMatch(/^UASCO_REVIEW_PROOF: PASS (\d+)\/\1$/);expect(Number(line.match(/PASS (\d+)/)?.[1])).toBeGreaterThanOrEqual(80)});
});

// //TR: A-Z üretim hattı kaydı + dispatcher entegrasyonu (gerçek LANES.json, gerçek dispatch.mjs, geçici git remote) bu kayıtlı dosyadan çalışır; korunan validation.json kaydı gerektirmez.
import {registerProductionLaneCases} from "./support/production-lanes.cases.js";
registerProductionLaneCases();
