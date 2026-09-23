// //TR: Paste 2B source-level anti-regression testi certification vocabulary, approval binding, numeric identity ve spend fail-closed kurallarını dependency-free doğrular.
import fs from "node:fs";
import {authorizeAutomationAction} from "../automation/lib/action-broker.mjs";
const text=p=>fs.readFileSync(p,"utf8"),json=p=>JSON.parse(text(p));
const checks=[];const ok=(name,value)=>{if(!value)throw new Error(`V6_PASTE2B_SELFTEST_FAILED:${name}`);checks.push(name)};
const canonical=["REGISTERED","TRAINING","EVALUATING","CERTIFIED","ACTIVE","STALE","RECERTIFICATION","REVOKED","RETIRED"];
const competency=text("core/competency/types.ts"),cert=text("core/competency/certification.ts");
ok("canonical-certification-vocabulary",canonical.every(x=>competency.includes(`"${x}"`))&&!competency.includes('"EVALUATION"'));
ok("certification-uses-shared-type",cert.includes('from "./types.js"')&&cert.includes('EVALUATING:["CERTIFIED"'));
for(const f of ["schemas/agent-run.schema.json","schemas/release.schema.json"]){const e=json(f).properties.certificationState.enum;ok(`schema-certification-enum:${f}`,JSON.stringify(e)===JSON.stringify(canonical))}
const policy=text("core/action-gateway/policy.ts"),types=text("core/action-gateway/types.ts"),approval=text("core/authority/approval.ts");
ok("approval-boolean-bypass-removed",!policy.includes("approvalValid")&&!types.includes("approvalValid")&&policy.includes("assertApprovalValid"));
for(const n of ["Approval revoked","Approval action mismatch","Approval target mismatch","Approval expired","Approval not yet valid","Approval expiry window invalid"])ok(`approval-binding:${n}`,approval.includes(n));
const lease=text("core/resources/lease-manager.ts"),resources=text("core/resources/registry.ts"),tech=text("core/decision/technology-decision.ts"),router=text("models/router/router.ts");
ok("lease-numeric-identity-guards",lease.includes("Number.isSafeInteger(ttlMs)")&&lease.includes("resourceId")&&lease.includes("missionId"));
ok("resource-identity-guards",resources.includes("Resource identity invalid")&&resources.includes("Resource capabilities duplicate"));
ok("technology-numeric-guards",tech.includes("Number.isFinite(c.weight)")&&tech.includes("Number.isFinite(c.score)")&&tech.includes("criterion identity invalid or duplicate"));
ok("model-router-numeric-guards",router.includes("Number.isFinite(x.estimatedCost)")&&router.includes("estimatedCost<0")&&router.includes("Provider identity invalid or duplicate"));
for(const f of ["schemas/budget.schema.json","schemas/cost-event.schema.json"])ok(`nonnegative-schema:${f}`,json(f).properties.amount.minimum===0);
const resourceSchema=json("schemas/resource.schema.json");ok("resource-schema-identity",resourceSchema.properties.id.minLength===1&&resourceSchema.properties.kind.minLength===1&&resourceSchema.properties.capabilities.uniqueItems===true&&resourceSchema.properties.capabilities.items.minLength===1);
const g={allowPaidApi:true,allowRisk5:false,allowProduction:false,allowLocalOnlyAutonomy:true};
ok("negative-spend-runtime-denied",authorizeAutomationAction({action:"SPEND",globalConfig:g,estimatedCost:-1}).allowed===false);
ok("nan-spend-runtime-denied",authorizeAutomationAction({action:"SPEND",globalConfig:g,estimatedCost:Number.NaN}).allowed===false);
ok("finite-spend-runtime-policy-denied",authorizeAutomationAction({action:"SPEND",globalConfig:g,estimatedCost:1}).allowed===false);
console.log(`V6_PASTE2B_SELFTEST: PASS ${checks.length}/${checks.length}`);
