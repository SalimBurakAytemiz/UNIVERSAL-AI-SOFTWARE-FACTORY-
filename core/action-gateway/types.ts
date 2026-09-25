// //TR: Bu dosya dış dünyada yan etki oluşturan agent işlemlerini sınıflandıran Action Gateway request/result ve risk sınıflarını tanımlar.
import type {ApprovalAttestation} from "../authority/approval.js";
export type ActionClass =
  | "READ_ONLY" | "MUTATION" | "EXTERNAL_COMMUNICATION" | "SPEND"
  | "PRODUCTION_CHANGE" | "DESTRUCTIVE" | "IRREVERSIBLE" | "LEGAL_FINANCIAL_AUTHORITY";

export interface ActionRequest {
  id: string;
  missionId: string;
  customerId?: string;
  actorId: string;
  actionClass: ActionClass;
  target: string;
  actionDigest: string;
  targetDigest: string;
  idempotencyKey?: string;
  estimatedCost?: number;
  production: boolean;
  reversible: boolean;
}

export interface ActionPolicyContext {
  scopeAllowed: boolean;
  dataPolicyAllowed: boolean;
  budgetAllowed: boolean;
  adapterCertified: boolean;
  trustedApproverIdentityIds?: readonly string[];
  approval?: ApprovalAttestation;
  now?: Date;
}
