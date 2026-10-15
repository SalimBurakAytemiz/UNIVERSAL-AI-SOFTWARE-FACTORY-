// //TR: Bu dosya Company OS Finans alanını (fatura, ödeme) sahiplenir: fatura durum makinesi, sunucu tarafı toplam hesabı, append-only ödeme/ters kayıt kuralları; "fatura kesildi" ile "ödeme alındı" ayrı kayıtlardır ve ikisi karıştırılmaz.
import type {Scope} from "../workos/types.js";
import type {WriteResult, WorkOsStore} from "../workos/store.js";
import {badTransition, clone, compileSchema, conflict, currencySchema, digestOf, idSchema, invalid, isCurrency, isMinor, isObj, isPosMinor, isStr, isTime, keySchema, listScoped, malformed, minorSchema, nameSchema, noSecrets, ownedRecord, reasonSchema, scopedRecord, tampered} from "./common.js";
import type {Validation} from "./common.js";
import type {CompanyApplied, CompanyEntry, CompanyState, Invoice, InvoiceLine, InvoiceStatus, Payment} from "./types.js";

// Fatura durumu: DRAFT -> ISSUED (issue) -> PARTIALLY_PAID -> PAID yalnız kayıtlı net ödemeden türetilir; ISSUED -> VOID yalnız ödemesiz faturada. Ters kayıt durumu geri indirebilir (PAID -> PARTIALLY_PAID/ISSUED).
const MAX_LINES = 100;
const MAX_QTY = 1_000_000;
// Ödeme durumu yalnız net ödenen tutardan hesaplanır: 0 -> ISSUED, kısmi -> PARTIALLY_PAID, toplam -> PAID.
export const statusFor = (totalMinor: number, paidMinor: number): InvoiceStatus => paidMinor === 0 ? "ISSUED" : paidMinor < totalMinor ? "PARTIALLY_PAID" : "PAID";
export const invoiceNumber = (n: number) => `INV-${String(n).padStart(6, "0")}`;

const lineSchema = {
  type: "object", additionalProperties: false, required: ["description", "quantity", "unitAmountMinor"],
  properties: {description: nameSchema, quantity: {type: "integer", minimum: 1, maximum: MAX_QTY}, unitAmountMinor: minorSchema}
} as const;
// totalMinor kabul edilir ama YOK SAYILIR: toplam her zaman sunucuda satırlardan hesaplanır.
export const invoiceCreateSchema = {
  type: "object", additionalProperties: false, required: ["accountId", "currency", "lineItems"],
  properties: {
    accountId: idSchema("acc"), currency: currencySchema, lineItems: {type: "array", minItems: 1, maxItems: MAX_LINES, items: lineSchema},
    dueDate: {type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$"}, totalMinor: minorSchema, idempotencyKey: keySchema
  }
} as const;
export const invoiceVoidSchema = {type: "object", additionalProperties: false, required: ["reason"], properties: {reason: reasonSchema}} as const;
export const invoiceIssueSchema = {type: "object", additionalProperties: false, properties: {}} as const;
export const paymentCreateSchema = {
  type: "object", additionalProperties: false,
  properties: {
    invoiceId: idSchema("inv"), amountMinor: {type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER}, currency: currencySchema,
    receivedAt: {type: "string", format: "date-time"}, reference: {type: "string", minLength: 1, maxLength: 100, pattern: "\\S"},
    reversesPaymentId: idSchema("pay"), reason: reasonSchema, idempotencyKey: keySchema
  }
} as const;
export const validateInvoiceCreate = compileSchema(invoiceCreateSchema);
export const validateInvoiceVoid = compileSchema(invoiceVoidSchema);
export const validateInvoiceIssue = compileSchema(invoiceIssueSchema);
const validatePaymentShape = compileSchema(paymentCreateSchema);
// Ödeme gövdesi iki biçimden tam biri olmalıdır: ödeme (invoiceId+amountMinor+currency) veya ters kayıt (reversesPaymentId+reason).
export const validatePaymentCreate = (x: unknown): Validation => {
  const r = validatePaymentShape(x);
  if (!r.ok) return r;
  const b = x as Record<string, unknown>, has = (k: string) => b[k] !== undefined;
  if (has("reversesPaymentId")) {
    if (!has("reason")) return {ok: false, errors: "reason is required for a reversal"};
    for (const k of ["amountMinor", "currency", "receivedAt", "reference"]) if (has(k)) return {ok: false, errors: `${k} is not allowed for a reversal`};
    return {ok: true};
  }
  for (const k of ["invoiceId", "amountMinor", "currency"]) if (!has(k)) return {ok: false, errors: `${k} is required for a payment`};
  if (has("reason")) return {ok: false, errors: "reason is only allowed for a reversal"};
  return {ok: true};
};

export interface InvoiceInput { accountId: string; currency: string; lineItems: Array<{description: string; quantity: number; unitAmountMinor: number}>; dueDate?: string; idempotencyKey?: string }
export interface PaymentInput { invoiceId: string; amountMinor: number; currency: string; receivedAt?: string; reference?: string; idempotencyKey?: string }
export interface ReversalInput { reversesPaymentId: string; invoiceId?: string; reason: string; idempotencyKey?: string }
export type InvoiceView = Invoice & { balanceMinor: number };
const view = (i: Invoice): InvoiceView => ({...clone(i), balanceMinor: i.totalMinor - i.paidMinor});

// Satırlardan toplam: her çarpım ve toplam güvenli tamsayı olmalıdır, toplam 0'dan büyük olmalıdır.
export function computeLines(lines: ReadonlyArray<{description: string; quantity: number; unitAmountMinor: number}>): {lineItems: InvoiceLine[]; totalMinor: number} {
  let total = 0; const out: InvoiceLine[] = [];
  for (const l of lines) {
    if (!isObj(l) || !isStr(l.description) || !Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY || !isMinor(l.unitAmountMinor)) throw invalid("lineItems");
    const amountMinor = l.quantity * l.unitAmountMinor;
    if (!Number.isSafeInteger(amountMinor)) throw invalid("lineItems");
    total += amountMinor;
    if (!Number.isSafeInteger(total)) throw invalid("lineItems");
    out.push({description: l.description, quantity: l.quantity, unitAmountMinor: l.unitAmountMinor, amountMinor});
  }
  if (out.length < 1 || out.length > MAX_LINES || total <= 0) throw invalid("lineItems");
  return {lineItems: out, totalMinor: total};
}

export class FinanceDomain {
  constructor(private readonly store: WorkOsStore) {}

  createInvoice(scope: Scope, input: InvoiceInput, actor: string): WriteResult<InvoiceView> {
    if (!isCurrency(input.currency)) throw invalid("currency");
    if (input.dueDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || !Number.isFinite(Date.parse(input.dueDate)))) throw invalid("dueDate");
    noSecrets(...input.lineItems.map(l => l.description));
    const {lineItems, totalMinor} = computeLines(input.lineItems);
    return this.store.companyWrite(tx => {
      const digest = digestOf({accountId: input.accountId, currency: input.currency, lineItems, dueDate: input.dueDate ?? null});
      const prior = tx.idem("fin.invoice", scope.tenantId, input.idempotencyKey, digest);
      if (prior) return {entity: view(prior as Invoice), replayed: true};
      scopedRecord(tx.records, input.accountId, "account", scope.tenantId, "account");
      const invoice: Invoice = {
        recordKind: "invoice", invoiceId: tx.newId("inv"), tenantId: scope.tenantId, accountId: input.accountId, currency: input.currency, lineItems, totalMinor, paidMinor: 0,
        status: "DRAFT", number: null, ...(input.dueDate ? {dueDate: input.dueDate} : {}), issuedAt: null, voidedAt: null, createdAt: tx.now(), createdBy: actor
      };
      tx.append("FIN_INVOICE_CREATED", actor, {entity: invoice, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: view(invoice), replayed: false};
    });
  }
  issueInvoice(scope: Scope, invoiceId: string, actor: string): InvoiceView {
    return this.store.companyWrite(tx => {
      const inv = scopedRecord(tx.records, invoiceId, "invoice", scope.tenantId, "invoice");
      if (inv.status !== "DRAFT") throw badTransition(`INVOICE_${inv.status}_TO_ISSUED`);
      tx.append("FIN_INVOICE_ISSUED", actor, {invoiceId, number: invoiceNumber((tx.invoiceSeq[scope.tenantId] ?? 0) + 1), issuedAt: tx.now()});
      return view(tx.records[invoiceId] as Invoice);
    });
  }
  // Ödemesi olan (PARTIALLY_PAID/PAID) fatura VOID olamaz; tamamı ters kayıtla geri çevrilmiş fatura ISSUED'a döner ve void edilebilir.
  voidInvoice(scope: Scope, invoiceId: string, reason: string, actor: string): InvoiceView {
    noSecrets(reason);
    return this.store.companyWrite(tx => {
      const inv = scopedRecord(tx.records, invoiceId, "invoice", scope.tenantId, "invoice");
      if (inv.status !== "ISSUED" || inv.paidMinor !== 0) throw badTransition(`INVOICE_${inv.status}_TO_VOID`);
      tx.append("FIN_INVOICE_VOIDED", actor, {invoiceId, reason: reason.slice(0, 1000), voidedAt: tx.now()});
      return view(tx.records[invoiceId] as Invoice);
    });
  }
  recordPayment(scope: Scope, input: PaymentInput, actor: string): WriteResult<{payment: Payment; invoice: InvoiceView}> {
    if (!isPosMinor(input.amountMinor)) throw invalid("amountMinor");
    if (!isCurrency(input.currency)) throw invalid("currency");
    if (input.receivedAt !== undefined && !isTime(input.receivedAt)) throw invalid("receivedAt");
    noSecrets(input.reference);
    return this.store.companyWrite(tx => {
      const digest = digestOf({invoiceId: input.invoiceId, amountMinor: input.amountMinor, currency: input.currency, receivedAt: input.receivedAt ?? null, reference: input.reference ?? null});
      const prior = tx.idem("fin.payment", scope.tenantId, input.idempotencyKey, digest);
      if (prior) { const pay = prior as Payment; return {entity: {payment: clone(pay), invoice: view(tx.records[pay.invoiceId] as Invoice)}, replayed: true}; }
      const inv = scopedRecord(tx.records, input.invoiceId, "invoice", scope.tenantId, "invoice");
      if (inv.currency !== input.currency) throw invalid("CURRENCY_MISMATCH");
      if (inv.status === "DRAFT" || inv.status === "VOID") throw badTransition("INVOICE_NOT_PAYABLE");
      if (input.amountMinor > inv.totalMinor - inv.paidMinor) throw conflict("OVERPAYMENT");
      const at = tx.now();
      const pay: Payment = {
        recordKind: "payment", paymentId: tx.newId("pay"), tenantId: scope.tenantId, invoiceId: inv.invoiceId, entryKind: "PAYMENT", amountMinor: input.amountMinor, currency: input.currency,
        receivedAt: input.receivedAt ? new Date(input.receivedAt).toISOString() : at, ...(input.reference ? {reference: input.reference} : {}), createdAt: at, createdBy: actor
      };
      tx.append("FIN_PAYMENT_RECORDED", actor, {entity: pay, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: {payment: clone(pay), invoice: view(tx.records[inv.invoiceId] as Invoice)}, replayed: false};
    });
  }
  // Düzeltme: orijinal ödeme düzenlenmez/silinmez; aynı tutarda yeni bir REVERSAL kaydı eklenir.
  reversePayment(scope: Scope, input: ReversalInput, actor: string): WriteResult<{payment: Payment; invoice: InvoiceView}> {
    noSecrets(input.reason);
    return this.store.companyWrite(tx => {
      const digest = digestOf({reversesPaymentId: input.reversesPaymentId, invoiceId: input.invoiceId ?? null, reason: input.reason});
      const prior = tx.idem("fin.payment", scope.tenantId, input.idempotencyKey, digest);
      if (prior) { const pay = prior as Payment; return {entity: {payment: clone(pay), invoice: view(tx.records[pay.invoiceId] as Invoice)}, replayed: true}; }
      const orig = scopedRecord(tx.records, input.reversesPaymentId, "payment", scope.tenantId, "payment");
      if (orig.entryKind !== "PAYMENT" || (input.invoiceId !== undefined && input.invoiceId !== orig.invoiceId)) throw invalid("REVERSAL_TARGET");
      if (tx.reversals[orig.paymentId] !== undefined) throw conflict("ALREADY_REVERSED");
      const inv = scopedRecord(tx.records, orig.invoiceId, "invoice", scope.tenantId, "invoice");
      if (inv.status === "DRAFT" || inv.status === "VOID") throw badTransition("INVOICE_NOT_PAYABLE");
      const at = tx.now();
      const rev: Payment = {
        recordKind: "payment", paymentId: tx.newId("pay"), tenantId: scope.tenantId, invoiceId: inv.invoiceId, entryKind: "REVERSAL", amountMinor: orig.amountMinor, currency: orig.currency,
        receivedAt: at, reversesPaymentId: orig.paymentId, reason: input.reason, createdAt: at, createdBy: actor
      };
      tx.append("FIN_PAYMENT_REVERSED", actor, {entity: rev, ...tx.idemFields(input.idempotencyKey, digest)});
      return {entity: {payment: clone(rev), invoice: view(tx.records[inv.invoiceId] as Invoice)}, replayed: false};
    });
  }

  listInvoices(scope: Scope, accountId?: string): InvoiceView[] { return this.store.companyRead(v => listScoped(v.records, "invoice", scope.tenantId).filter(i => accountId === undefined || i.accountId === accountId).map(view)); }
  getInvoice(scope: Scope, id: string): InvoiceView | undefined { return this.store.companyRead(v => { const r = v.records[id]; return r && r.recordKind === "invoice" && r.tenantId === scope.tenantId ? view(r) : undefined; }); }
  listPayments(scope: Scope, invoiceId?: string): Payment[] { return this.store.companyRead(v => listScoped(v.records, "payment", scope.tenantId).filter(p => invoiceId === undefined || p.invoiceId === invoiceId).map(clone)); }
}

const PAYABLE: readonly InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID", "PAID"];
// Journal replay: tutar/durum/numara tutarsızlıkları journal'ı fail-closed yapar; toplamlar ve durum yeniden hesaplanır, payload'daki hiçbir türetilmiş değere güvenilmez.
export function applyFinance(st: CompanyState, e: CompanyEntry): CompanyApplied {
  const p = e.payload;
  switch (e.type) {
    case "FIN_INVOICE_CREATED": {
      const i = p.entity as Invoice;
      if (!isObj(i) || i.recordKind !== "invoice" || !isStr(i.invoiceId) || !isStr(i.tenantId) || !isStr(i.accountId) || !isCurrency(i.currency) || !Array.isArray(i.lineItems)
        || i.status !== "DRAFT" || i.paidMinor !== 0 || i.number !== null || i.issuedAt !== null || i.voidedAt !== null) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      ownedRecord(st.records, i.accountId, "account", i.tenantId, e.seq);
      let calc: ReturnType<typeof computeLines>;
      try { calc = computeLines(i.lineItems); } catch { throw malformed(`ENTITY_SHAPE:${e.seq}`); }
      if (calc.totalMinor !== i.totalMinor || JSON.stringify(calc.lineItems) !== JSON.stringify(i.lineItems)) throw tampered(`INVOICE_TOTAL_MISMATCH:${e.seq}`);
      if (st.records[i.invoiceId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[i.invoiceId] = i;
      return {idem: {tenantId: i.tenantId, kind: "fin.invoice", id: i.invoiceId}};
    }
    case "FIN_INVOICE_ISSUED": {
      const inv = st.records[isStr(p.invoiceId) ? p.invoiceId : ""];
      if (!inv || inv.recordKind !== "invoice" || inv.status !== "DRAFT") throw tampered(`COMPANY_TRANSITION_INCONSISTENT:${e.seq}`);
      const expected = invoiceNumber((st.invoiceSeq[inv.tenantId] ?? 0) + 1);
      if (p.number !== expected || !isTime(p.issuedAt)) throw tampered(`INVOICE_NUMBER_INCONSISTENT:${e.seq}`);
      st.invoiceSeq[inv.tenantId] = (st.invoiceSeq[inv.tenantId] ?? 0) + 1;
      inv.status = "ISSUED"; inv.number = expected; inv.issuedAt = p.issuedAt;
      return {};
    }
    case "FIN_INVOICE_VOIDED": {
      const inv = st.records[isStr(p.invoiceId) ? p.invoiceId : ""];
      if (!inv || inv.recordKind !== "invoice" || inv.status !== "ISSUED" || inv.paidMinor !== 0 || !isStr(p.reason) || !isTime(p.voidedAt)) throw tampered(`COMPANY_TRANSITION_INCONSISTENT:${e.seq}`);
      inv.status = "VOID"; inv.voidedAt = p.voidedAt; inv.voidReason = p.reason;
      return {};
    }
    case "FIN_PAYMENT_RECORDED": {
      const pay = p.entity as Payment;
      if (!isObj(pay) || pay.recordKind !== "payment" || pay.entryKind !== "PAYMENT" || !isStr(pay.paymentId) || !isStr(pay.tenantId) || !isStr(pay.invoiceId)
        || !isPosMinor(pay.amountMinor) || !isCurrency(pay.currency) || !isTime(pay.receivedAt) || pay.reversesPaymentId !== undefined) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      const inv = ownedRecord(st.records, pay.invoiceId, "invoice", pay.tenantId, e.seq);
      if (inv.currency !== pay.currency || !PAYABLE.includes(inv.status) || inv.paidMinor + pay.amountMinor > inv.totalMinor) throw tampered(`PAYMENT_INCONSISTENT:${e.seq}`);
      if (st.records[pay.paymentId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[pay.paymentId] = pay;
      inv.paidMinor += pay.amountMinor; inv.status = statusFor(inv.totalMinor, inv.paidMinor);
      return {idem: {tenantId: pay.tenantId, kind: "fin.payment", id: pay.paymentId}};
    }
    case "FIN_PAYMENT_REVERSED": {
      const rev = p.entity as Payment;
      if (!isObj(rev) || rev.recordKind !== "payment" || rev.entryKind !== "REVERSAL" || !isStr(rev.paymentId) || !isStr(rev.tenantId) || !isStr(rev.invoiceId)
        || !isStr(rev.reversesPaymentId) || !isPosMinor(rev.amountMinor) || !isCurrency(rev.currency) || !isStr(rev.reason)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
      const orig = ownedRecord(st.records, rev.reversesPaymentId, "payment", rev.tenantId, e.seq);
      const inv = ownedRecord(st.records, rev.invoiceId, "invoice", rev.tenantId, e.seq);
      if (orig.entryKind !== "PAYMENT" || orig.invoiceId !== rev.invoiceId || orig.amountMinor !== rev.amountMinor || orig.currency !== rev.currency
        || st.reversals[orig.paymentId] !== undefined || !PAYABLE.includes(inv.status) || inv.paidMinor < rev.amountMinor) throw tampered(`REVERSAL_INCONSISTENT:${e.seq}`);
      if (st.records[rev.paymentId]) throw tampered(`COMPANY_DUPLICATE:${e.seq}`);
      st.records[rev.paymentId] = rev; st.reversals[orig.paymentId] = rev.paymentId;
      inv.paidMinor -= rev.amountMinor; inv.status = statusFor(inv.totalMinor, inv.paidMinor);
      return {idem: {tenantId: rev.tenantId, kind: "fin.payment", id: rev.paymentId}};
    }
    default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
  }
}
