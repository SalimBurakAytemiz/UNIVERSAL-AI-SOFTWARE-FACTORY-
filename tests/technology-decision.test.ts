// //TR: Bu test technology decision yardımcı hesabının mission-specific weight kullandığını doğrular; skorun tek başına otomatik nihai karar olmadığını interface seviyesinde korur.
import { describe, expect, it } from "vitest";
import { weightedEvidenceScore } from "../core/decision/technology-decision.js";
describe("technology evidence",()=>{it("weights criteria",()=>expect(weightedEvidenceScore({id:"a",name:"A",risks:[],exitStrategy:"x",criteria:[{criterionId:"fit",weight:2,score:5,evidenceRefs:["e"]},{criterionId:"cost",weight:1,score:2,evidenceRefs:["c"]}]})).toBe(4));});
