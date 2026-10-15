// //TR: Bu dosya Company OS CRM alanını (hesap, kişi, fırsat) sahiplenir: girdi doğrulaması, fırsat aşama makinesi, journal replay kuralları; kayıtlar ortak Work OS journal'ında tenant kapsamlı ve denetlenebilir yazılır.
import type {Scope} from "../workos/types.js";
import type {WriteResult, WorkOsStore} from "../workos/store.js";
import {badTransition, clone, compileSchema, currencySchema, digestOf, idSchema, invalid, isCurrency, isMinor, isObj, isStr, keySchema, listScoped, malformed, minorSchema, nameSchema, noSecrets, ownedRecord, reasonSchema, scopedRecord, tampered} from "./common.js";
import type {Validation} from "./common.js";
import type {Account, CompanyApplied, CompanyEntry, CompanyState, Contact, Opportunity, OpportunityStage} from "./types.js";

// LEAD -> QUALIFIED -> PROPOSAL -> WON; her açık aşamadan LOST. WON ve LOST terminaldir. Fırsat WON olması hiçbir sözleşme veya fatura üretmez.
export const OPPORTUNITY_STAGES: readonly OpportunityStage[] = ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
export const OPPORTUNITY_TRANSITIONS: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  LEAD: ["QUALIFIED", "LOST"], QUALIFIED: ["PROPOSAL", "LOST"], PROPOSAL: ["WON", "LOST"], WON: [], LOST: []
};
export const isOpportunityStage = (x: unknown): x is OpportunityStage => typeof x === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(x);

export const accountCreateSchema = {type: "object", additionalProperties: false, required: ["name"], properties: {name: nameSchema, idempotencyKey: keySchema}} as const;
export const contactCreateSchema = {
  type: "object", additionalProperties: false, required: ["accountId", "name"],
  properties: {accountId: idSchema("acc"), name: nameSchema, role: {type: "string", minLength: 1, maxLength: 100, pattern: "\\S"}, email: {type: "string", format: "email", maxLength: 254}, idempotencyKey: keySchema}
} as const;
export const opportunityCreateSchema = {
  type: "object", additionalProperties: false, required: ["accountId", "title", "amountMinor", "currency"],
  properties: {accountId: idSchema("acc"), title: nameSchema, amountMinor: minorSchema, currency: currencySchema, idempotencyKey: keySchema}
} as const;
export const opportunityStageSchema = {
  type: "object", additionalProperties: false, required: ["stage"],
  properties: {stage: {enum: ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"]}, reason: reasonSchema}
} as const;
export const validateAccountCreate = compileSchema(accountCreateSchema);
export const validateContactCreate = compileSchema(contactCreateSchema);
export const validateOpportunityCreate = compileSchema(opportunityCreateSchema);
export const validateOpportunityStage: (x: unknown) => Validation = compileSchema(opportunityStageSchema);

export interface AccountInput { name: string; idempotencyKey?: string }
export interface ContactInput { accountId: string; name: string; role?: string; email?: string; idempotencyKey?: string }
export interface OpportunityInput { accountId: string; title: string; amountMinor: number; currency: string; idempotencyKey?: string }

export class CrmDomain {
  constructor(private readonly store: WorkOsStore) {}

  createAccount(scope: Scope, input: AccountInput, actor: string): WriteResult<Account> {
    noSecrets(input.name);
    return this.store.companyWrite(tx => {
      const digest = digestOf({name: input.name});
      const prior = tx.idem("crm.account", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior as Account), replayed: true};
      const account: Account = {recordKind: "account", accountId: tx.newId("acc"), tenantId: scope.tenantId, name: input.name, createdAt: tx.now(), createdBy: actor};
      tx.append("CRM_ACCOUNT_CREATED", actor, {entity: account, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(account), replayed: false};
    });
  }
  createContact(scope: Scope, input: ContactInput, actor: string): WriteResult<Contact> {
    noSecrets(input.name, input.role, input.email);
    return this.store.companyWrite(tx => {
      const digest = digestOf({accountId: input.accountId, name: input.name, role: input.role ?? null, email: input.email ?? null});
      const prior = tx.idem("crm.contact", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior as Contact), replayed: true};
      scopedRecord(tx.records, input.accountId, "account", scope.tenantId, "account");
      const contact: Contact = {
        recordKind: "contact", contactId: tx.newId("cnt"), tenantId: scope.tenantId, accountId: input.accountId, name: input.name,
        ...(input.role !== undefined ? {role: input.role} : {}), ...(input.email !== undefined ? {email: input.email} : {}), createdAt: tx.now(), createdBy: actor
      };
      tx.append("CRM_CONTACT_CREATED", actor, {entity: contact, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(contact), replayed: false};
    });
  }
  createOpportunity(scope: Scope, input: OpportunityInput, actor: string): WriteResult<Opportunity> {
    noSecrets(input.title);
    if (!isMinor(input.amountMinor)) throw invalid("amountMinor");
    if (!isCurrency(input.currency)) throw invalid("currency");
    return this.store.companyWrite(tx => {
      const digest = digestOf({accountId: input.accountId, title: input.title, amountMinor: input.amountMinor, currency: input.currency});
      const prior = tx.idem("crm.opportunity", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior as Opportunity), replayed: true};
      scopedRecord(tx.records, input.accountId, "account", scope.tenantId, "account");
      const at = tx.now();
      const opp: Opportunity = {
        recordKind: "opportunity", opportunityId: tx.newId("opp"), tenantId: scope.tenantId, accountId: input.accountId, title: input.title, stage: "LEAD",
        amountMinor: input.amountMinor, currency: input.currency, createdAt: at, createdBy: actor, updatedAt: at
      };
      tx.append("CRM_OPPORTUNITY_CREATED", actor, {entity: opp, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: clone(opp), replayed: false};
    });
  }
  // Geçersiz geçiş hiçbir şey yazmaz (kontrol append'ten önce).
  stageOpportunity(scope: Scope, opportunityId: string, to: OpportunityStage, reason: string | undefined, actor: string): Opportunity {
    noSecrets(reason);
    return this.store.companyWrite(tx => {
      const opp = scopedRecord(tx.records, opportunityId, "opportunity", scope.tenantId, "opportunity");
      if (!isOpportunityStage(to)) throw invalid("stage");
      if (!OPPORTUNITY_TRANSITIONS[opp.stage].includes(to)) throw badTransition(`OPPORTUNITY_${opp.stage}_TO_${to}`);
      tx.append("CRM_OPPORTUNITY_STAGED", actor, {opportunityId, from: opp.stage, to, ...(reason ? {reason: reason.slice(0, 1000)} : {})});
      return clone(tx.records[opportunityId] as Opportunity);
    });
  }

  listAccounts(scope: Scope): Account[] { return this.store.companyRead(v => listScoped(v.records, "account", scope.tenantId).map(clone)); }
  getAccount(scope: Scope, id: string): Account | undefined { return this.store.companyRead(v => { const r = v.records[id]; return r && r.recordKind === "account" && r.tenantId === scope.tenantId ? clone(r) : undefined; }); }
  listContacts(scope: Scope, accountId?: string): Contact[] { return this.store.companyRead(v => listScoped(v.records, "contact", scope.tenantId).filter(c => accountId === undefined || c.accountId === accountId).map(clone)); }
  listOpportunities(scope: Scope, accountId?: string): Opportunity[] { return this.store.companyRead(v => listScoped(v.records, "opportunity", scope.tenantId).filter(o => accountId === undefined || o.accountId === accountId).map(clone)); }
  getOpportunity(scope: Scope, id: string): Opportunity | undefined { return this.store.companyRead(v => { const r = v.records[id]; return r && r.recordKind === "opportunity" && r.tenantId === scope.tenantId ? clone(r) : undefined; }); }
}

// Journal replay: her girdi tam doğrulanır, tutarsız girdi journal'ı fail-closed yapar. Mutasyon yalnız tüm kontroller geçtikten sonra yapılır.
export function applyCrm(st: CompanyState, e: CompanyEntry): CompanyApplied {
  const p = e.payload;
  switch (e.type) {
    case "CRM_ACCOUNT_CREATED": {
      const a = p.entity as Account;
      if (!isObj(a) || a.recordKind !== "account" || !isStr(a.accountId) || !isStr(a.tenantId) || !isStr(a.name)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      if (st.records[a.accountId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[a.accountId] = a;
      return {idem: {tenantId: a.tenantId, kind: "crm.account", id: a.accountId}};
    }
    case "CRM_CONTACT_CREATED": {
      const c = p.entity as Contact;
      if (!isObj(c) || c.recordKind !== "contact" || !isStr(c.contactId) || !isStr(c.tenantId) || !isStr(c.accountId) || !isStr(c.name)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      ownedRecord(st.records, c.accountId, "account", c.tenantId, e.seq);
      if (st.records[c.contactId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[c.contactId] = c;
      return {idem: {tenantId: c.tenantId, kind: "crm.contact", id: c.contactId}};
    }
    case "CRM_OPPORTUNITY_CREATED": {
      const o = p.entity as Opportunity;
      if (!isObj(o) || o.recordKind !== "opportunity" || !isStr(o.opportunityId) || !isStr(o.tenantId) || !isStr(o.accountId) || !isStr(o.title)
        || o.stage !== "LEAD" || !isMinor(o.amountMinor) || !isCurrency(o.currency)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      ownedRecord(st.records, o.accountId, "account", o.tenantId, e.seq);
      if (st.records[o.opportunityId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[o.opportunityId] = o;
      return {idem: {tenantId: o.tenantId, kind: "crm.opportunity", id: o.opportunityId}};
    }
    case "CRM_OPPORTUNITY_STAGED": {
      const o = st.records[isStr(p.opportunityId) ? p.opportunityId : ""];
      if (!o || o.recordKind !== "opportunity" || o.stage !== p.from || !isOpportunityStage(p.to)) throw tampered(`COMPANY_TRANSITION_INCONSISTENT:${e.seq}`);
      if (!OPPORTUNITY_TRANSITIONS[o.stage].includes(p.to)) throw tampered(`COMPANY_TRANSITION_ILLEGAL:${e.seq}`);
      o.stage = p.to; o.updatedAt = e.at;
      return {};
    }
    default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
  }
}
