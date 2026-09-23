// //TR: Bu test production/destructive side-effect action'ın approval ve policy kapılarını bypass edemediğini doğrular.
import {describe,it,expect} from "vitest";
import {authorizeAction} from "../core/action-gateway/policy.js";
describe("action gateway",()=>{
  const req={id:"A1",missionId:"M1",actorId:"051",actionClass:"PRODUCTION_CHANGE" as const,target:"prod",actionDigest:"a",targetDigest:"t",idempotencyKey:"k",production:true,reversible:true};
  it("requires approval",()=>expect(authorizeAction(req,{scopeAllowed:true,dataPolicyAllowed:true,budgetAllowed:true,adapterCertified:true,approvalValid:false})).toEqual({allowed:false,reason:"APPROVAL_REQUIRED"}));
  it("allows policy-compliant approved action",()=>expect(authorizeAction(req,{scopeAllowed:true,dataPolicyAllowed:true,budgetAllowed:true,adapterCertified:true,approvalValid:true})).toEqual({allowed:true}));
});
