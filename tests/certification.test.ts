// //TR: Bu test high-risk kullanımda registered/stale bilgiyle devam edilemediğini ve canonical EVALUATING lifecycle vocabulary'sinin tek kaynaktan geldiğini doğrular.
import {describe,it,expect} from "vitest";
import {CERTIFICATION_STATES,assertHighRiskCompetencyReady,canCertificationTransition} from "../core/competency/certification.js";
describe("competency certification",()=>{
  it("uses canonical EVALUATING vocabulary",()=>{expect(CERTIFICATION_STATES).toContain("EVALUATING");expect(CERTIFICATION_STATES).not.toContain("EVALUATION");expect(canCertificationTransition("TRAINING","EVALUATING")).toBe(true)});
  it("blocks registered-only knowledge",()=>{expect(()=>assertHighRiskCompetencyReady({skillState:"REGISTERED",technologyState:"ACTIVE",sourceFresh:true,holdoutPassed:true,independentReviewPassed:true})).toThrow()});
  it("allows certified current evidence",()=>{expect(()=>assertHighRiskCompetencyReady({skillState:"ACTIVE",technologyState:"CERTIFIED",sourceFresh:true,holdoutPassed:true,independentReviewPassed:true})).not.toThrow()});
});
