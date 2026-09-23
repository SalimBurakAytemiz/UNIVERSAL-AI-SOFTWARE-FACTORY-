// //TR: Bu dosya kritik action approval'unu yalnız boolean değil exact action/target/digest/expiry/revocation bağlamına bağlayarak stale veya başka hedefe ait onayın kullanılmasını engeller.
export interface ApprovalAttestation {
  id: string;
  approverIdentityId: string;
  actionDigest: string;
  targetDigest: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string|null;
}

function validIdentity(value:string):boolean{return typeof value==="string"&&value.trim().length>0}
function parseTime(value:string,label:string):number{const t=Date.parse(value);if(!Number.isFinite(t))throw new Error(`Approval ${label} invalid`);return t}

export function assertApprovalValid(
  approval: ApprovalAttestation,
  actionDigest: string,
  targetDigest: string,
  now = new Date()
): void {
  if(!validIdentity(approval.id)||!validIdentity(approval.approverIdentityId)) throw new Error("Approval identity invalid");
  if(!validIdentity(actionDigest)||!validIdentity(targetDigest)) throw new Error("Approval request digest invalid");
  if(approval.revokedAt) throw new Error("Approval revoked");
  if(approval.actionDigest!==actionDigest) throw new Error("Approval action mismatch");
  if(approval.targetDigest!==targetDigest) throw new Error("Approval target mismatch");
  const granted=parseTime(approval.grantedAt,"grantedAt"),expires=parseTime(approval.expiresAt,"expiresAt"),nowMs=now.getTime();
  if(!Number.isFinite(nowMs)) throw new Error("Approval evaluation time invalid");
  if(expires<=granted) throw new Error("Approval expiry window invalid");
  if(granted>nowMs) throw new Error("Approval not yet valid");
  if(expires<=nowMs) throw new Error("Approval expired");
}
