// //TR: Bu validator 363 agentın self-approval yapamadığını ve head dışındaki agentların lead/principal/head zincirinde en az bir teknik reviewer'a sahip olduğunu doğrular.
import fs from "node:fs";
const rows=JSON.parse(fs.readFileSync("registries/agent-review-graph-v2.json","utf8")).reviews;
if(rows.length!==363) throw new Error("Review graph must contain 363 agents");
for(const r of rows){
 if(r.selfApprovalForbidden!==true) throw new Error(`Self approval not forbidden ${r.agentId}`);
 const refs=[r.technicalLeadAgentId,...r.principalReviewerAgentIds,r.departmentHeadAgentId].filter(Boolean);
 if(refs.includes(r.agentId)) throw new Error(`Self reviewer detected ${r.agentId}`);
 if(r.agentId!=="001" && refs.length===0) throw new Error(`No reviewer ${r.agentId}`);
}
console.log("REVIEW_GRAPH_V2_VALIDATION: PASS");
