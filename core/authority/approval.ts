// //TR: Bu dosya kritik action approval'unu yalnız boolean değil exact action/target/digest/expiry/revocation bağlamına bağlayarak stale veya başka hedefe ait onayın kullanılmasını engeller.
export interface ApprovalAttestation {
  id: string;
  approverIdentityId: string;
  actionDigest: string;
  targetDigest: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export function assertApprovalValid(
  approval: ApprovalAttestation,
  actionDigest: string,
  targetDigest: string,
  now = new Date()
): void {
  if(approval.revokedAt) throw new Error("Approval revoked");
  if(approval.actionDigest!==actionDigest) throw new Error("Approval action mismatch");
  if(approval.targetDigest!==targetDigest) throw new Error("Approval target mismatch");
  if(Date.parse(approval.expiresAt)<=now.getTime()) throw new Error("Approval expired");
}
