// //TR: Bu test production/destructive/spend side-effect action'ların class, trusted approver, digest, budget, idempotency ve runtime type kapılarını bypass edemediğini doğrular.
import {describe,it,expect} from "vitest";
import {authorizeAction} from "../core/action-gateway/policy.js";
const req={id:"A1",missionId:"M1",actorId:"051",actionClass:"PRODUCTION_CHANGE" as const,target:"prod",actionDigest:"action-digest-123456",targetDigest:"target-digest-123456",idempotencyKey:"k",production:true,reversible:true};
const base={scopeAllowed:true,dataPolicyAllowed:true,budgetAllowed:true,adapterCertified:true,trustedApproverIdentityIds:["FOUNDER"],now:new Date("2026-09-23T12:00:00Z")};
const approval={id:"APR-1",approverIdentityId:"FOUNDER",actionDigest:req.actionDigest,targetDigest:req.targetDigest,grantedAt:"2026-09-23T11:00:00Z",expiresAt:"2026-09-23T13:00:00Z"};
describe("action gateway",()=>{
  it("requires bound approval attestation",()=>expect(authorizeAction(req,base)).toEqual({allowed:false,reason:"APPROVAL_REQUIRED"}));
  it("allows policy-compliant bound approval",()=>expect(authorizeAction(req,{...base,approval})).toEqual({allowed:true}));
  it("rejects another action digest",()=>expect(authorizeAction(req,{...base,approval:{...approval,actionDigest:"different-action-123"}}).allowed).toBe(false));
  it("rejects revoked approval",()=>expect(authorizeAction(req,{...base,approval:{...approval,revokedAt:"2026-09-23T11:30:00Z"}}).allowed).toBe(false));
  it("rejects untrusted approver",()=>expect(authorizeAction(req,{...base,approval:{...approval,approverIdentityId:"AGENT-007"}}).allowed).toBe(false));
  it("rejects negative/non-finite spend",()=>{expect(authorizeAction({...req,estimatedCost:-1},{...base,approval}).allowed).toBe(false);expect(authorizeAction({...req,estimatedCost:Number.NaN},{...base,approval}).allowed).toBe(false)});
  it("rejects production mutation without approval-class classification",()=>expect(authorizeAction({...req,actionClass:"MUTATION"},{...base,approval}).allowed).toBe(false));
  it("requires explicit spend amount",()=>expect(authorizeAction({...req,actionClass:"SPEND",production:false,estimatedCost:undefined},{...base,approval}).allowed).toBe(false));
  it("rejects irreversible semantic contradiction",()=>expect(authorizeAction({...req,actionClass:"IRREVERSIBLE",production:false,reversible:true,idempotencyKey:undefined},{...base,approval}).allowed).toBe(false));
  it("rejects whitespace idempotency key for non-reversible mutation",()=>expect(authorizeAction({...req,actionClass:"MUTATION",production:false,reversible:false,idempotencyKey:"   "},base).allowed).toBe(false));
  it("rejects non-boolean policy context at runtime",()=>expect(authorizeAction({...req,actionClass:"MUTATION",production:false},{...base,scopeAllowed:"false" as unknown as boolean}).allowed).toBe(false));
});
