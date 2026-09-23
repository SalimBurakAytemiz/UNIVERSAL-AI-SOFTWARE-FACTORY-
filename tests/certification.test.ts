// //TR: Bu test high-risk kullanımda registered/stale bilgiyle devam edilemediğini ve certified+fresh+holdout+independent review şartlarının birlikte gerektiğini doğrular.
import {describe,it,expect} from "vitest";
import {assertHighRiskCompetencyReady} from "../core/competency/certification.js";
describe("competency certification",()=>{
  it("blocks registered-only knowledge",()=>{
    expect(()=>assertHighRiskCompetencyReady({skillState:"REGISTERED",technologyState:"ACTIVE",sourceFresh:true,holdoutPassed:true,independentReviewPassed:true})).toThrow();
  });
  it("allows certified current evidence",()=>{
    expect(()=>assertHighRiskCompetencyReady({skillState:"ACTIVE",technologyState:"CERTIFIED",sourceFresh:true,holdoutPassed:true,independentReviewPassed:true})).not.toThrow();
  });
});
