// //TR: Bu dosya kritik action approval'unu exact approver/action/target/digest/expiry/revocation bağlamına bağlayarak stale, sahte veya başka hedefe ait onayın kullanılmasını engeller.
export interface ApprovalAttestation {
  id: string;
  approverIdentityId: string;
  actionDigest: string;
  targetDigest: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

function validIdentity(value:unknown):value is string{return typeof value==="string"&&value.trim().length>0}
function validDigest(value:unknown):value is string{return typeof value==="string"&&value.trim().length>=16}
function parseTime(value:unknown,label:string):number{
  if(typeof value!=="string"||!value.trim())throw new Error(`Approval ${label} invalid`);
  const t=Date.parse(value);if(!Number.isFinite(t))throw new Error(`Approval ${label} invalid`);return t
}

export function assertApprovalValid(
  approval: ApprovalAttestation,
  actionDigest: string,
  targetDigest: string,
  trustedApproverIdentityIds: readonly string[],
  now = new Date()
): void {
  if(!approval||typeof approval!=="object") throw new Error("Approval object invalid");
  if(!validIdentity(approval.id)||!validIdentity(approval.approverIdentityId)) throw new Error("Approval identity invalid");
  if(!Array.isArray(trustedApproverIdentityIds)||!trustedApproverIdentityIds.some(x=>validIdentity(x)&&x===approval.approverIdentityId)) throw new Error("Approval approver not trusted");
  if(!validDigest(actionDigest)||!validDigest(targetDigest)||!validDigest(approval.actionDigest)||!validDigest(approval.targetDigest)) throw new Error("Approval request digest invalid");
  if(approval.revokedAt!==undefined){parseTime(approval.revokedAt,"revokedAt");throw new Error("Approval revoked")}
  if(approval.actionDigest!==actionDigest) throw new Error("Approval action mismatch");
  if(approval.targetDigest!==targetDigest) throw new Error("Approval target mismatch");
  const granted=parseTime(approval.grantedAt,"grantedAt"),expires=parseTime(approval.expiresAt,"expiresAt"),nowMs=now.getTime();
  if(!Number.isFinite(nowMs)) throw new Error("Approval evaluation time invalid");
  if(expires<=granted) throw new Error("Approval expiry window invalid");
  if(granted>nowMs) throw new Error("Approval not yet valid");
  if(expires<=nowMs) throw new Error("Approval expired");
}
