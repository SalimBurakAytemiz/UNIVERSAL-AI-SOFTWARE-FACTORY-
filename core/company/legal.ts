// //TR: Bu dosya Company OS Hukuk alanını (sözleşme) sahiplenir: sözleşme durum makinesi ve imza kanıtı kuralı; SIGNED durumu belge sha256, imzalayan adı ve imza zamanı olmadan oluşamaz ve bir teklif/fırsat asla örtük olarak imzalı sözleşme olmaz.
import type {Scope} from "../workos/types.js";
import type {WriteResult, WorkOsStore} from "../workos/store.js";
import {badTransition, clone, compileSchema, digestOf, idSchema, invalid, isObj, isSha256, isStr, isTime, keySchema, listScoped, malformed, nameSchema, noSecrets, ownedRecord, reasonSchema, scopedRecord, tampered} from "./common.js";
import type {Validation} from "./common.js";
import type {CompanyApplied, CompanyEntry, CompanyState, Contract, ContractStatus} from "./types.js";

// DRAFT -> SENT -> SIGNED | DECLINED | EXPIRED. SIGNED/DECLINED/EXPIRED terminaldir.
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  DRAFT: ["SENT"], SENT: ["SIGNED", "DECLINED", "EXPIRED"], SIGNED: [], DECLINED: [], EXPIRED: []
};
export const TRANSITION_TARGETS: readonly ContractStatus[] = ["SENT", "SIGNED", "DECLINED", "EXPIRED"];
const SKEW_MS = 5 * 60 * 1000;

export const contractCreateSchema = {
  type: "object", additionalProperties: false, required: ["accountId", "title"],
  properties: {accountId: idSchema("acc"), opportunityId: idSchema("opp"), title: nameSchema, idempotencyKey: keySchema}
} as const;
export const contractTransitionSchema = {
  type: "object", additionalProperties: false, required: ["to"],
  properties: {
    to: {enum: ["SENT", "SIGNED", "DECLINED", "EXPIRED"]}, reason: reasonSchema, documentSha256: {type: "string", pattern: "^[0-9a-f]{64}$"},
    signerName: nameSchema, signedAt: {type: "string", format: "date-time"}
  }
} as const;
export const validateContractCreate = compileSchema(contractCreateSchema);
const validateTransitionShape = compileSchema(contractTransitionSchema);
// SIGNED üç imza kanıtının tamamını ister; diğer hedefler bu alanları taşıyamaz (imza kanıtı yalnız SIGNED içindir).
export const validateContractTransition = (x: unknown): Validation => {
  const r = validateTransitionShape(x);
  if (!r.ok) return r;
  const b = x as Record<string, unknown>, has = (k: string) => b[k] !== undefined;
  if (b.to === "SIGNED") {
    for (const k of ["documentSha256", "signerName", "signedAt"]) if (!has(k)) return {ok: false, errors: `${k} is required to sign a contract`};
  } else for (const k of ["documentSha256", "signerName", "signedAt"]) if (has(k)) return {ok: false, errors: `${k} is only allowed when signing`};
  return {ok: true};
};

export interface ContractInput { accountId: string; opportunityId?: string; title: string; idempotencyKey?: string }
export interface ContractTransitionInput { to: ContractStatus; reason?: string; documentSha256?: string; signerName?: string; signedAt?: string }

export class LegalDomain {
  constructor(private readonly store: WorkOsStore) {}

  createContract(scope: Scope, input: ContractInput, actor: string): WriteResult<Contract> {
    noSecrets(input.title);
    return this.store.companyWrite(tx => {
      const digest = digestOf({accountId: input.accountId, opportunityId: input.opportunityId ?? null, title: input.title});
      const prior = tx.idem("legal.contract", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior as Contract), replayed: true};
      scopedRecord(tx.records, input.accountId, "account", scope.tenantId, "account");
      if (input.opportunityId !== undefined) {
        // Fırsat yalnız referanstır: durumu (WON dahil) sözleşme oluşturmaz ve sözleşme fırsat durumunu değiştirmez.
        const opp = scopedRecord(tx.records, input.opportunityId, "opportunity", scope.tenantId, "opportunity");
        if (opp.accountId !== input.accountId) throw invalid("OPPORTUNITY_ACCOUNT_MISMATCH");
      }
      const contract: Contract = {
        recordKind: "contract", contractId: tx.newId("ctr"), tenantId: scope.tenantId, accountId: input.accountId, ...(input.opportunityId ? {opportunityId: input.opportunityId} : {}),
        title: input.title, status: "DRAFT", sentAt: null, documentSha256: null, signerName: null, signedAt: null, closedAt: null, createdAt: tx.now(), createdBy: actor
      };
      tx.append("LEGAL_CONTRACT_CREATED", actor, {entity: contract, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(contract), replayed: false};
    });
  }
  // Geçersiz geçiş veya eksik imza kanıtı hiçbir şey yazmaz.
  transitionContract(scope: Scope, contractId: string, input: ContractTransitionInput, actor: string): Contract {
    noSecrets(input.reason, input.signerName);
    return this.store.companyWrite(tx => {
      const c = scopedRecord(tx.records, contractId, "contract", scope.tenantId, "contract");
      if (!TRANSITION_TARGETS.includes(input.to)) throw invalid("to");
      let signedAt: string | undefined;
      if (input.to === "SIGNED") {
        if (!isSha256(input.documentSha256) || !isStr(input.signerName) || input.signerName.trim().length === 0 || !isTime(input.signedAt)) throw invalid("SIGNATURE_EVIDENCE_REQUIRED");
        const t = Date.parse(input.signedAt);
        if (t > Date.parse(tx.now()) + SKEW_MS) throw invalid("signedAt");
        signedAt = new Date(t).toISOString();
      } else if (input.documentSha256 !== undefined || input.signerName !== undefined || input.signedAt !== undefined) throw invalid("SIGNATURE_EVIDENCE_ONLY_WHEN_SIGNING");
      if (!CONTRACT_TRANSITIONS[c.status].includes(input.to)) throw badTransition(`CONTRACT_${c.status}_TO_${input.to}`);
      tx.append("LEGAL_CONTRACT_TRANSITIONED", actor, {
        contractId, from: c.status, to: input.to, at: tx.now(), ...(input.reason ? {reason: input.reason.slice(0, 1000)} : {}),
        ...(input.to === "SIGNED" ? {documentSha256: input.documentSha256, signerName: input.signerName, signedAt} : {})
      });
      return clone(tx.records[contractId] as Contract);
    });
  }

  listContracts(scope: Scope, accountId?: string): Contract[] { return this.store.companyRead(v => listScoped(v.records, "contract", scope.tenantId).filter(c => accountId === undefined || c.accountId === accountId).map(clone)); }
  getContract(scope: Scope, id: string): Contract | undefined { return this.store.companyRead(v => { const r = v.records[id]; return r && r.recordKind === "contract" && r.tenantId === scope.tenantId ? clone(r) : undefined; }); }
}

// Journal replay: SIGNED girdisi imza kanıtı (hash, imzalayan, zaman) taşımıyorsa journal bozuk sayılır (fail-closed).
export function applyLegal(st: CompanyState, e: CompanyEntry): CompanyApplied {
  const p = e.payload;
  switch (e.type) {
    case "LEGAL_CONTRACT_CREATED": {
      const c = p.entity as Contract;
      if (!isObj(c) || c.recordKind !== "contract" || !isStr(c.contractId) || !isStr(c.tenantId) || !isStr(c.accountId) || !isStr(c.title) || c.status !== "DRAFT"
        || c.sentAt !== null || c.documentSha256 !== null || c.signerName !== null || c.signedAt !== null || c.closedAt !== null) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      const acc = ownedRecord(st.records, c.accountId, "account", c.tenantId, e.seq);
      if (c.opportunityId !== undefined && ownedRecord(st.records, c.opportunityId, "opportunity", c.tenantId, e.seq).accountId !== acc.accountId) throw tampered(`COMPANY_REF:${e.seq}`);
      if (st.records[c.contractId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[c.contractId] = c;
      return {idem: {tenantId: c.tenantId, kind: "legal.contract", id: c.contractId}};
    }
    case "LEGAL_CONTRACT_TRANSITIONED": {
      const c = st.records[isStr(p.contractId) ? p.contractId : ""];
      if (!c || c.recordKind !== "contract" || c.status !== p.from || typeof p.to !== "string" || !TRANSITION_TARGETS.includes(p.to as ContractStatus) || !isTime(p.at)) throw tampered(`COMPANY_TRANSITION_INCONSISTENT:${e.seq}`);
      const to = p.to as ContractStatus;
      if (!CONTRACT_TRANSITIONS[c.status].includes(to)) throw tampered(`COMPANY_TRANSITION_ILLEGAL:${e.seq}`);
      if (to === "SIGNED") {
        if (!isSha256(p.documentSha256) || !isStr(p.signerName) || p.signerName.trim().length === 0 || !isTime(p.signedAt)) throw tampered(`SIGNATURE_EVIDENCE_MISSING:${e.seq}`);
        c.documentSha256 = p.documentSha256; c.signerName = p.signerName; c.signedAt = p.signedAt;
      }
      c.status = to;
      if (to === "SENT") c.sentAt = p.at; else c.closedAt = p.at;
      if (isStr(p.reason)) c.reason = p.reason;
      return {};
    }
    default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
  }
}
