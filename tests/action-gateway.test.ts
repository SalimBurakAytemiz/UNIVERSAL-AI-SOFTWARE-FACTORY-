// //TR: Bu test production/destructive side-effect action'ın boolean approval, stale/revoked/digest-mismatch approval ve malformed spend ile bypass edilemediğini doğrular.
import {describe,it,expect} from "vitest";
import {authorizeAction} from "../core/action-gateway/policy.js";
const req={id:"A1",missionId:"M1",actorId:"051",actionClass:"PRODUCTION_CHANGE" as const,target:"prod",actionDigest:"action-digest-123456",targetDigest:"target-digest-123456",idempotencyKey:"k",production:true,reversible:true};
const base={scopeAllowed:true,dataPolicyAllowed:true,budgetAllowed:true,adapterCertified:true,now:new Date("2026-09-23T12:00:00Z")};
const approval={id:"APR-1",approverIdentityId:"FOUNDER",actionDigest:req.actionDigest,targetDigest:req.targetDigest,grantedAt:"2026-09-23T11:00:00Z",expiresAt:"2026-09-23T13:00:00Z"};
describe("action gateway",()=>{
  it("requires bound approval attestation",()=>expect(authorizeAction(req,base)).toEqual({allowed:false,reason:"APPROVAL_REQUIRED"}));
  it("allows policy-compliant bound approval",()=>expect(authorizeAction(req,{...base,approval})).toEqual({allowed:true}));
  it("rejects another action digest",()=>expect(authorizeAction(req,{...base,approval:{...approval,actionDigest:"different-action"}}).allowed).toBe(false));
  it("rejects revoked approval",()=>expect(authorizeAction(req,{...base,approval:{...approval,revokedAt:"2026-09-23T11:30:00Z"}}).allowed).toBe(false));
  it("rejects negative/non-finite spend",()=>{expect(authorizeAction({...req,estimatedCost:-1},{...base,approval}).allowed).toBe(false);expect(authorizeAction({...req,estimatedCost:Number.NaN},{...base,approval}).allowed).toBe(false)});
});
