// //TR: Bu dosya Company OS çekirdek alan kayıtlarının (CRM, Finans, Hukuk) tip sözleşmesini ve journal girdi türlerini tanımlar; ayrı bir store yoktur, kayıtlar Work OS hash zincirli journal içinde yaşar.

// Para yalnız tamsayı minor unit + ISO 4217 koddur; kayıtlar tenant'a aittir ve oluşturan aktörle birlikte denetlenir.
export type Currency = string;

export interface Account { recordKind: "account"; accountId: string; tenantId: string; name: string; createdAt: string; createdBy: string }
// PII asgaridir: ad, rol (opsiyonel), e-posta (opsiyonel). Secret taşımaz; audit/log kaydına asla yazılmaz.
export interface Contact { recordKind: "contact"; contactId: string; tenantId: string; accountId: string; name: string; role?: string; email?: string; createdAt: string; createdBy: string }
export type OpportunityStage = "LEAD" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
export interface Opportunity {
  recordKind: "opportunity"; opportunityId: string; tenantId: string; accountId: string; title: string; stage: OpportunityStage;
  amountMinor: number; currency: Currency; createdAt: string; createdBy: string; updatedAt: string;
}

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
export interface InvoiceLine { description: string; quantity: number; unitAmountMinor: number; amountMinor: number }
// totalMinor sunucuda hesaplanır; paidMinor yalnız kayıtlı ödemelerden journal replay ile türetilen izdüşümdür (ikinci doğruluk kaynağı değildir).
export interface Invoice {
  recordKind: "invoice"; invoiceId: string; tenantId: string; accountId: string; currency: Currency; lineItems: InvoiceLine[];
  totalMinor: number; paidMinor: number; status: InvoiceStatus; number: string | null; dueDate?: string;
  issuedAt: string | null; voidedAt: string | null; voidReason?: string; createdAt: string; createdBy: string;
}
// Ödemeler ayrı ve append-only kayıtlardır; düzeltme yalnız REVERSAL kaydıyla yapılır, hiçbir kayıt düzenlenmez.
export interface Payment {
  recordKind: "payment"; paymentId: string; tenantId: string; invoiceId: string; entryKind: "PAYMENT" | "REVERSAL"; amountMinor: number; currency: Currency;
  receivedAt: string; reference?: string; reversesPaymentId?: string; reason?: string; createdAt: string; createdBy: string;
}

export type ContractStatus = "DRAFT" | "SENT" | "SIGNED" | "DECLINED" | "EXPIRED";
export interface Contract {
  recordKind: "contract"; contractId: string; tenantId: string; accountId: string; opportunityId?: string; title: string; status: ContractStatus;
  sentAt: string | null; documentSha256: string | null; signerName: string | null; signedAt: string | null; closedAt: string | null; reason?: string;
  createdAt: string; createdBy: string;
}

export type CompanyRecord = Account | Contact | Opportunity | Invoice | Payment | Contract;
// reversals: paymentId -> geri çeviren kaydın paymentId değeri (journal'dan türetilir; bir ödeme en fazla bir kez geri çevrilir).
// invoiceSeq: tenant başına verilmiş fatura numarası sayacı (journal'dan türetilir; numara boşluksuz ve tekildir).
export interface CompanyState { records: Record<string, CompanyRecord>; reversals: Record<string, string>; invoiceSeq: Record<string, number> }
export const emptyCompanyState = (): CompanyState => ({records: {}, reversals: {}, invoiceSeq: {}});

export type CompanyJournalType =
  | "CRM_ACCOUNT_CREATED" | "CRM_CONTACT_CREATED" | "CRM_OPPORTUNITY_CREATED" | "CRM_OPPORTUNITY_STAGED"
  | "FIN_INVOICE_CREATED" | "FIN_INVOICE_ISSUED" | "FIN_INVOICE_VOIDED" | "FIN_PAYMENT_RECORDED" | "FIN_PAYMENT_REVERSED"
  | "LEGAL_CONTRACT_CREATED" | "LEGAL_CONTRACT_TRANSITIONED";
export const COMPANY_JOURNAL_TYPES: readonly CompanyJournalType[] = [
  "CRM_ACCOUNT_CREATED", "CRM_CONTACT_CREATED", "CRM_OPPORTUNITY_CREATED", "CRM_OPPORTUNITY_STAGED",
  "FIN_INVOICE_CREATED", "FIN_INVOICE_ISSUED", "FIN_INVOICE_VOIDED", "FIN_PAYMENT_RECORDED", "FIN_PAYMENT_REVERSED",
  "LEGAL_CONTRACT_CREATED", "LEGAL_CONTRACT_TRANSITIONED"
];
export const isCompanyJournalType = (t: string): t is CompanyJournalType => (COMPANY_JOURNAL_TYPES as readonly string[]).includes(t);

// Journal girdisinin domain apply fonksiyonlarının gördüğü dar biçim (store JournalEntry türünün yapısal alt kümesi).
export interface CompanyEntry { seq: number; type: string; at: string; actor: string; payload: Record<string, unknown> }
export interface CompanyApplied { idem?: { tenantId: string; kind: string; id: string } }

// Domain yazmaları store'un lock ve yeniden doğrulama altında verdiği bu dar arayüz üzerinden yapılır.
export interface CompanyTx {
  readonly records: Readonly<Record<string, CompanyRecord>>;
  readonly reversals: Readonly<Record<string, string>>;
  readonly invoiceSeq: Readonly<Record<string, number>>;
  now(): string;
  newId(prefix: string): string;
  idem(kind: string, tenantId: string, key: string | undefined, digest: string): CompanyRecord | undefined;
  idemFields(key: string | undefined, digest: string): Record<string, unknown>;
  append(type: CompanyJournalType, actor: string, payload: Record<string, unknown>): void;
}
export interface CompanyView { readonly records: Readonly<Record<string, CompanyRecord>>; readonly reversals: Readonly<Record<string, string>> }
