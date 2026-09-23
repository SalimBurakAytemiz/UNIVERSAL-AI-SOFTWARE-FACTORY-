// //TR: Bu test technology decision yardımcı hesabının mission-specific finite/positive weight ve kimlik kurallarını enforce ettiğini doğrular.
import { describe, expect, it } from "vitest";
import { weightedEvidenceScore } from "../core/decision/technology-decision.js";
const good={id:"a",name:"A",risks:[],exitStrategy:"x",criteria:[{criterionId:"fit",weight:2,score:5,evidenceRefs:["e"]},{criterionId:"cost",weight:1,score:2,evidenceRefs:["c"]}]};
describe("technology evidence",()=>{
  it("weights criteria",()=>expect(weightedEvidenceScore(good)).toBe(4));
  it("rejects malformed numeric/identity data",()=>{expect(()=>weightedEvidenceScore({...good,id:""})).toThrow();expect(()=>weightedEvidenceScore({...good,criteria:[{criterionId:"fit",weight:0,score:5,evidenceRefs:["e"]}]})).toThrow();expect(()=>weightedEvidenceScore({...good,criteria:[{criterionId:"fit",weight:1,score:Number.NaN,evidenceRefs:["e"]}]})).toThrow()});
});
