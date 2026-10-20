// //TR: Bu test UX WP3 Company OS (SC-15) görünümünün dürüstlüğünü gerçek görünüm modülleriyle doğrular: gerçek /v1/company/* verisi CRM/Finans/Hukuk tablolarına ve KPI'lara bağlanır; veri yokken (köprü reddi, 404/503, ağ, 500) ayrık EMPTY/UNAVAILABLE/NOT_CONNECTED/OFFLINE/FAILED/STALE durumları gösterilir; referans görseldeki uydurma adlar, taslak faturanın ödenmiş ve fırsatın imzalı görünmesi, para birimlerinin karışması ve eksik kanıtlı "imzalı" sözleşmenin sayılması engellenir; sekme/klavye/süzgeç ve TR/EN sözlük kapsamı kontrol edilir.
import {describe, it, expect, beforeEach, vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
}
class D {
  body: N;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const cls = (n: N, c: string) => all(n).filter(x => x.className.split(" ").includes(c));
const kpi = (root: N, id: string) => all(root).find(n => n.dataset.kpi === id)!;
const kpiValue = (root: N, id: string) => cls(kpi(root, id), "kpi-value")[0].textContent;
const pills = (n: N) => all(n).filter(x => "pill" in x.dataset).map(x => x.dataset.pill);
const table = (root: N, id: string) => all(root).find(n => n.tagName === "TABLE" && n.dataset.companyTable === id);
const rowsOf = (root: N, id: string) => all(table(root, id)!).filter(n => n.tagName === "TR" && "recordId" in n.dataset);
const rowFor = (root: N, id: string, recordId: string) => rowsOf(root, id).find(r => r.dataset.recordId === recordId)!;
const sourceState = (root: N, key: string) => all(root).find(n => n.tagName === "LI" && n.dataset.source === key)!.dataset.sourceState;

const hex = (n: number) => n.toString(16).padStart(24, "0");
const id = (prefix: string, n: number) => `${prefix}_${hex(n)}`;
const A1 = id("acc", 1), A2 = id("acc", 2);
const O = [1, 2, 3, 4, 5].map(n => id("opp", n)), I = [1, 2, 3, 4, 5].map(n => id("inv", n)), P = [1, 2, 3].map(n => id("pay", n)), C = [1, 2, 3, 4].map(n => id("ctr", n)), K = [1, 2].map(n => id("cnt", n));
const SHA = "ab".repeat(32);
const t = (n: number) => `2026-10-1${n}T10:00:00.000Z`;

const FIX: Record<string, any> = {
  "/v1/company/accounts": {accounts: [
    {recordKind: "account", accountId: A1, tenantId: "t1", name: "Fixture Account One", createdAt: t(1), createdBy: "x"},
    {recordKind: "account", accountId: A2, tenantId: "t1", name: "Fixture Account Two", createdAt: t(2), createdBy: "x"}]},
  "/v1/company/contacts": {contacts: [
    {recordKind: "contact", contactId: K[0], tenantId: "t1", accountId: A1, name: "Fixture Person A", role: "Buyer", email: "a@example.invalid", createdAt: t(1), createdBy: "x"},
    {recordKind: "contact", contactId: K[1], tenantId: "t1", accountId: A2, name: "Fixture Person B", createdAt: t(2), createdBy: "x"}]},
  "/v1/company/opportunities": {opportunities: [
    {recordKind: "opportunity", opportunityId: O[0], tenantId: "t1", accountId: A1, title: "Lead one", stage: "LEAD", amountMinor: 100000, currency: "TRY", createdAt: t(1), createdBy: "x", updatedAt: t(1)},
    {recordKind: "opportunity", opportunityId: O[1], tenantId: "t1", accountId: A1, title: "Proposal two", stage: "PROPOSAL", amountMinor: 250050, currency: "TRY", createdAt: t(2), createdBy: "x", updatedAt: t(2)},
    {recordKind: "opportunity", opportunityId: O[2], tenantId: "t1", accountId: A2, title: "Qualified three", stage: "QUALIFIED", amountMinor: 5000, currency: "USD", createdAt: t(3), createdBy: "x", updatedAt: t(3)},
    {recordKind: "opportunity", opportunityId: O[3], tenantId: "t1", accountId: A2, title: "Won four", stage: "WON", amountMinor: 999900, currency: "USD", createdAt: t(4), createdBy: "x", updatedAt: t(4)},
    {recordKind: "opportunity", opportunityId: O[4], tenantId: "t1", accountId: A1, title: "Lost five", stage: "LOST", amountMinor: 700, currency: "TRY", createdAt: t(5), createdBy: "x", updatedAt: t(5)}]},
  "/v1/company/invoices": {invoices: [
    {recordKind: "invoice", invoiceId: I[0], tenantId: "t1", accountId: A1, currency: "TRY", lineItems: [{description: "x", quantity: 1, unitAmountMinor: 120000, amountMinor: 120000}], totalMinor: 120000, paidMinor: 0, balanceMinor: 120000, status: "DRAFT", number: null, issuedAt: null, voidedAt: null, createdAt: t(1), createdBy: "x"},
    {recordKind: "invoice", invoiceId: I[1], tenantId: "t1", accountId: A1, currency: "TRY", lineItems: [], totalMinor: 100000, paidMinor: 0, balanceMinor: 100000, status: "ISSUED", number: "INV-000001", dueDate: "2026-11-01", issuedAt: t(2), voidedAt: null, createdAt: t(2), createdBy: "x"},
    {recordKind: "invoice", invoiceId: I[2], tenantId: "t1", accountId: A2, currency: "USD", lineItems: [], totalMinor: 20000, paidMinor: 5000, balanceMinor: 15000, status: "PARTIALLY_PAID", number: "INV-000002", issuedAt: t(3), voidedAt: null, createdAt: t(3), createdBy: "x"},
    {recordKind: "invoice", invoiceId: I[3], tenantId: "t1", accountId: A1, currency: "TRY", lineItems: [], totalMinor: 50000, paidMinor: 50000, balanceMinor: 0, status: "PAID", number: "INV-000003", issuedAt: t(4), voidedAt: null, createdAt: t(4), createdBy: "x"},
    {recordKind: "invoice", invoiceId: I[4], tenantId: "t1", accountId: A2, currency: "USD", lineItems: [], totalMinor: 30000, paidMinor: 0, balanceMinor: 30000, status: "PAID", number: "INV-000004", issuedAt: t(5), voidedAt: null, createdAt: t(5), createdBy: "x"}]},
  "/v1/company/payments": {payments: [
    {recordKind: "payment", paymentId: P[0], tenantId: "t1", invoiceId: I[2], entryKind: "PAYMENT", amountMinor: 5000, currency: "USD", receivedAt: t(3), reference: "REF-1", createdAt: t(3), createdBy: "x"},
    {recordKind: "payment", paymentId: P[1], tenantId: "t1", invoiceId: I[3], entryKind: "PAYMENT", amountMinor: 50000, currency: "TRY", receivedAt: t(4), createdAt: t(4), createdBy: "x"},
    {recordKind: "payment", paymentId: P[2], tenantId: "t1", invoiceId: I[4], entryKind: "REVERSAL", amountMinor: 100, currency: "USD", receivedAt: t(5), reversesPaymentId: P[0], reason: "r", createdAt: t(5), createdBy: "x"}]},
  "/v1/company/contracts": {contracts: [
    {recordKind: "contract", contractId: C[0], tenantId: "t1", accountId: A1, opportunityId: O[1], title: "Signed with evidence", status: "SIGNED", sentAt: t(1), documentSha256: SHA, signerName: "Fixture Signer", signedAt: t(2), closedAt: t(2), createdAt: t(1), createdBy: "x"},
    {recordKind: "contract", contractId: C[1], tenantId: "t1", accountId: A2, title: "Signed no evidence", status: "SIGNED", sentAt: t(1), documentSha256: null, signerName: null, signedAt: null, closedAt: null, createdAt: t(2), createdBy: "x"},
    {recordKind: "contract", contractId: C[2], tenantId: "t1", accountId: A1, title: "Sent three", status: "SENT", sentAt: t(3), documentSha256: null, signerName: null, signedAt: null, closedAt: null, createdAt: t(3), createdBy: "x"},
    {recordKind: "contract", contractId: C[3], tenantId: "t1", accountId: A2, title: "Draft four", status: "DRAFT", sentAt: null, documentSha256: null, signerName: null, signedAt: null, closedAt: null, createdAt: t(4), createdBy: "x"}]}
};
const EMPTY_FIX: Record<string, any> = {
  "/v1/company/accounts": {accounts: []}, "/v1/company/contacts": {contacts: []}, "/v1/company/opportunities": {opportunities: []},
  "/v1/company/invoices": {invoices: []}, "/v1/company/payments": {payments: []}, "/v1/company/contracts": {contracts: []}
};
// Referans görseldeki örnek adlar yalnız gerçek backend döndürürse görünebilir; fixture'larda yoktur, bu yüzden hiçbir yüzeyde olmamalıdır.
const FAKE_REFERENCE = ["Healthcare", "Acme", "Contoso", "Globex", "Lorem", "Sample Customer", "Alex", "Chen"];

async function mkCtx(get: (p: string) => any, lang = "tr", now: () => number = () => 1_760_000_000_000) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], rerenders: number[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return get(p); }};
  const api = apiMod.createApi({bridge, store, now});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, principal: "FOUNDER_LOCAL", rerender: async () => { rerenders.push(1); }};
  return {ctx, doc, store, calls, rerenders};
}
const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };

beforeEach(async () => { (await load("views", "company.js")).resetCompanyView(); });

describe("UX WP3 Company OS honest states (no data)", () => {
  it("shows NOT_CONNECTED for every source when the secure bridge rejects the company paths, with no rows, em-dash KPIs and no reference names", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(() => { throw new Error("Error invoking remote method 'uasco:api-get': Error: INVALID_API_PATH"); });
    const root = await company.render(ctx, {id: "company"});
    for (const k of ["accounts", "contacts", "opportunities", "invoices", "payments", "contracts"]) expect(sourceState(root, k), k).toBe("NOT_CONNECTED");
    for (const id of ["company-accounts", "company-opportunities", "company-receivables", "company-contracts"]) {
      expect(kpiValue(root, id), id).toBe("—");
      expect(pills(kpi(root, id)), id).toEqual(["NOT_CONNECTED"]);
    }
    expect(all(root).filter(n => n.tagName === "TABLE").length).toBe(0);
    expect(all(root).filter(n => n.tagName === "TR").length).toBe(0);
    expect(root.textContent).toContain("Bağlı değil");
    expect(root.textContent).not.toMatch(/\d+,\d{2} (TRY|USD)/);
    for (const bad of FAKE_REFERENCE) expect(root.textContent, bad).not.toContain(bad);
  });

  it("distinguishes UNAVAILABLE (404 and 503), OFFLINE, FAILED (500) and an invalid payload with separate pills and labels", async () => {
    const company = await load("views", "company.js");
    const cases: Array<[string, () => never, string, string]> = [
      ["404", () => { throw new Error("/v1/company/accounts: HTTP 404"); }, "UNAVAILABLE", "UNAVAILABLE"],
      ["503", () => { throw new Error("/v1/company/accounts: HTTP 503"); }, "UNAVAILABLE", "UNAVAILABLE"],
      ["offline", () => { throw new Error("fetch failed"); }, "OFFLINE", "OFFLINE"],
      ["500", () => { throw new Error("/v1/company/accounts: HTTP 500"); }, "ERROR", "FAILED"]
    ];
    const seen = new Set<string>();
    for (const [name, fail, state, pill] of cases) {
      const {ctx} = await mkCtx(fail);
      const root = await company.render(ctx, {id: "company"});
      expect(sourceState(root, "accounts"), name).toBe(state);
      expect(pills(kpi(root, "company-accounts")), name).toEqual([pill]);
      expect(kpiValue(root, "company-accounts"), name).toBe("—");
      expect(all(root).filter(n => n.tagName === "TABLE").length, name).toBe(0);
      seen.add(pill);
    }
    const bad = await mkCtx(() => ({accounts: "nope"}));
    const root = await company.render(bad.ctx, {id: "company"});
    expect(sourceState(root, "accounts")).toBe("ERROR");
    expect(pills(kpi(root, "company-accounts"))).toEqual(["FAILED"]);
    expect([...seen].sort()).toEqual(["FAILED", "OFFLINE", "UNAVAILABLE"]);
  });

  it("shows EMPTY (not zero data and not an error) with per-resource empty text and no tables when the backend returns empty lists", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(fromFix(EMPTY_FIX));
    const root = await company.render(ctx, {id: "company"});
    for (const id of ["company-accounts", "company-opportunities", "company-receivables", "company-contracts"]) { expect(kpiValue(root, id), id).toBe("0"); expect(pills(kpi(root, id)), id).toEqual(["EMPTY"]); }
    expect(all(root).filter(n => n.tagName === "TABLE").length).toBe(0);
    expect(root.textContent).toContain("Henüz hesap kaydedilmedi.");
    expect(all(root).filter(n => n.dataset.companyState === "EMPTY").length).toBeGreaterThanOrEqual(3);
    expect(root.textContent).not.toMatch(/\d+,\d{2} (TRY|USD)/);
    // Finans ve Hukuk sekmeleri de boş durumu kendi metnini söyler.
    for (const [tab, text] of [["finance", "Henüz fatura kaydedilmedi."], ["legal", "Henüz sözleşme kaydedilmedi."]]) {
      all(root).find(n => n.dataset.tab === tab)!.fire("click");
      const r2 = await company.render(ctx, {id: "company"});
      expect(r2.textContent, tab).toContain(text);
    }
  });

  it("keeps the last successful rows as STALE with its time and cause when a later refresh fails, and never marks NOT_CONNECTED as stale", async () => {
    const company = await load("views", "company.js");
    let fail = false, tick = 1_760_000_000_000;
    const {ctx, store} = await mkCtx(p => { if (fail) throw new Error("fetch failed"); return fromFix(FIX)(p); }, "en", () => (tick += 10_000));
    const ok = await company.render(ctx, {id: "company"});
    expect(sourceState(ok, "accounts")).toBe("VERIFIED");
    fail = true; store.cache.clear();
    const stale = await company.render(ctx, {id: "company"});
    expect(sourceState(stale, "accounts")).toBe("STALE");
    expect(pills(kpi(stale, "company-accounts"))).toEqual(["STALE"]);
    expect(kpiValue(stale, "company-accounts")).toBe("2");
    expect(rowsOf(stale, "company-accounts-table").length).toBe(2);
    expect(all(stale).some(n => n.className === "company-stale")).toBe(true);
    expect(stale.textContent).toContain("Showing the last successful read");
    expect(stale.textContent).toContain("Offline");
    const never = await mkCtx(() => { throw new Error("INVALID_API_PATH"); });
    await company.render(never.ctx, {id: "company"});
    const again = await company.render(never.ctx, {id: "company"});
    expect(sourceState(again, "accounts")).toBe("NOT_CONNECTED");
  });

  it("uses six distinct pill kinds and labels for the six data states", async () => {
    const core = await load("company-core.js"), comps = await load("components.js");
    const {ctx} = await mkCtx(() => undefined);
    const kinds = ["EMPTY", "UNAVAILABLE", "NOT_CONNECTED", "STALE", "OFFLINE", "FAILED"];
    const res = [{state: "VERIFIED", items: []}, {state: "UNAVAILABLE", items: []}, {state: "NOT_CONNECTED", items: []}, {state: "STALE", items: [1]}, {state: "OFFLINE", items: []}, {state: "ERROR", items: []}];
    expect(res.map(r => core.companyPillKind(r))).toEqual(kinds);
    const labels = kinds.map(k => comps.statePill(ctx, k).textContent);
    expect(new Set(labels).size).toBe(6);
    expect(core.companyPillKind({loading: true})).toBe("LOADING");
  });
});

describe("UX WP3 Company OS with real data", () => {
  it("binds the KPIs and CRM tables to the real records, separating currencies and counting only open stages", async () => {
    const company = await load("views", "company.js");
    const {ctx, calls} = await mkCtx(fromFix(FIX));
    const root = await company.render(ctx, {id: "company"});
    expect(calls.sort()).toEqual(Object.keys(FIX).sort());
    expect(kpiValue(root, "company-accounts")).toBe("2");
    expect(kpiValue(root, "company-opportunities")).toBe("3");
    expect(kpiValue(root, "company-receivables")).toBe("2");
    expect(kpiValue(root, "company-contracts")).toBe("1");
    const pipe = kpi(root, "company-opportunities");
    const cur = (k: N) => all(k).filter(n => "currency" in n.dataset).map(n => `${n.dataset.currency}:${n.textContent}`);
    expect(cur(pipe)).toEqual(["TRY:3.500,50 TRY", "USD:50,00 USD"]);
    expect(cur(kpi(root, "company-receivables"))).toEqual(["TRY:1.000,00 TRY", "USD:150,00 USD"]);
    expect(kpi(root, "company-contracts").textContent).toContain("1 gönderildi");
    expect(pills(kpi(root, "company-accounts"))).toEqual(["VERIFIED"]);
    expect(rowsOf(root, "company-accounts-table").map(r => r.dataset.recordId).sort()).toEqual([A1, A2].sort());
    const row = rowFor(root, "company-accounts-table", A1).children.map(c => c.textContent);
    expect(row[0]).toBe("Fixture Account One");
    expect(row.slice(3)).toEqual(["1", "3", "2", "3"]);
    expect(rowsOf(root, "company-opps-table").length).toBe(5);
    const opp = rowFor(root, "company-opps-table", O[1]);
    expect(opp.textContent).toContain("Fixture Account One");
    expect(opp.textContent).toContain("2.500,50 TRY");
    expect(pills(opp)).toEqual(["ACTIVE"]);
    expect(pills(rowFor(root, "company-opps-table", O[3]))).toEqual(["DONE"]);
    expect(pills(rowFor(root, "company-opps-table", O[4]))).toEqual(["STOPPED"]);
    expect(rowFor(root, "company-contacts-table", K[0]).textContent).toContain("a@example.invalid");
    expect(root.textContent).toContain("imzalı sözleşme değildir");
    for (const bad of FAKE_REFERENCE) expect(root.textContent, bad).not.toContain(bad);
  });

  it("renders English when asked, with exact decimal formatting", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(fromFix(FIX), "en");
    const root = await company.render(ctx, {id: "company"});
    const pipe = kpi(root, "company-opportunities");
    expect(all(pipe).filter(n => "currency" in n.dataset).map(n => n.textContent)).toEqual(["3,500.50 TRY", "50.00 USD"]);
    expect(root.textContent).toContain("Read-only view");
    expect(root.textContent).toContain("Open opportunities");
  });

  it("never shows a draft invoice as paid, flags a PAID status the payments do not cover as NOT_VERIFIED, and shows partial payment honestly", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(fromFix(FIX));
    const root0 = await company.render(ctx, {id: "company"});
    all(root0).find(n => n.dataset.tab === "finance")!.fire("click");
    const root = await company.render(ctx, {id: "company"});
    const draft = rowFor(root, "company-invoices-table", I[0]);
    expect(pills(draft)).toEqual(["IDLE"]);
    expect(draft.textContent).toContain("Taslak · kesilmedi, ödenmedi");
    expect(draft.textContent).not.toMatch(/Ödendi|Kısmen/);
    expect(draft.textContent).toContain("Henüz numara yok");
    expect(pills(rowFor(root, "company-invoices-table", I[1]))).toEqual(["WAITING"]);
    expect(pills(rowFor(root, "company-invoices-table", I[2]))).toEqual(["ATTENTION"]);
    expect(pills(rowFor(root, "company-invoices-table", I[3]))).toEqual(["DONE"]);
    const mismatch = rowFor(root, "company-invoices-table", I[4]);
    expect(pills(mismatch)).toEqual(["NOT_VERIFIED"]);
    expect(rowFor(root, "company-invoices-table", I[2]).textContent).toContain("150,00 USD");
    expect(pills(rowFor(root, "company-payments-table", P[0]))).toEqual(["DONE"]);
    expect(pills(rowFor(root, "company-payments-table", P[2]))).toEqual(["ATTENTION"]);
    expect(rowFor(root, "company-payments-table", P[0]).textContent).toContain("INV-000002");
    expect(all(root).some(n => n.dataset.note === "draft-not-paid")).toBe(true);
  });

  it("counts a contract as signed only with document hash, signer and time; a SIGNED status without evidence is NOT_VERIFIED", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(fromFix(FIX));
    const root0 = await company.render(ctx, {id: "company"});
    expect(kpiValue(root0, "company-contracts")).toBe("1");
    all(root0).find(n => n.dataset.tab === "legal")!.fire("click");
    const root = await company.render(ctx, {id: "company"});
    const good = rowFor(root, "company-contracts-table", C[0]);
    expect(pills(good)).toEqual(["DONE"]);
    expect(good.textContent).toContain("Fixture Signer");
    expect(good.textContent).toContain(`sha256:${SHA.slice(0, 12)}`);
    const weak = rowFor(root, "company-contracts-table", C[1]);
    expect(pills(weak)).toEqual(["NOT_VERIFIED"]);
    expect(weak.textContent).toContain("kanıt eksik");
    expect(weak.textContent).not.toContain("sha256:");
    expect(pills(rowFor(root, "company-contracts-table", C[2]))).toEqual(["WAITING"]);
    expect(pills(rowFor(root, "company-contracts-table", C[3]))).toEqual(["IDLE"]);
    expect(rowFor(root, "company-contracts-table", C[2]).textContent).toContain("imza bekliyor");
  });

  it("shows the raw id instead of inventing an account name when the account record is unavailable, and keeps unknown statuses neutral", async () => {
    const company = await load("views", "company.js");
    const fix: Record<string, any> = {...FIX, "/v1/company/accounts": undefined, "/v1/company/opportunities": {opportunities: [{...FIX["/v1/company/opportunities"].opportunities[0], stage: "MYSTERY"}]}};
    const {ctx} = await mkCtx(p => { if (fix[p] === undefined) throw new Error(`${p}: HTTP 404`); return fix[p]; });
    const root = await company.render(ctx, {id: "company"});
    const opp = rowFor(root, "company-opps-table", O[0]);
    expect(opp.textContent).toContain(A1);
    expect(opp.textContent).not.toContain("Fixture Account");
    expect(pills(opp)).toEqual(["NEUTRAL"]);
    expect(opp.textContent).toContain("MYSTERY");
    expect(root.textContent).toContain("Kullanılamıyor");
  });

  it("drops malformed rows and never turns invalid amounts into numbers", async () => {
    const core = await load("company-core.js");
    const r = core.mapOpportunities({opportunities: [
      {opportunityId: "bad", title: "x"},
      {opportunityId: O[0], accountId: A1, title: "neg", stage: "LEAD", amountMinor: -5, currency: "TRY"},
      {opportunityId: O[1], accountId: A1, title: "float", stage: "LEAD", amountMinor: 1.5, currency: "TRY"},
      {opportunityId: O[2], accountId: A1, title: "lower", stage: "LEAD", amountMinor: 100, currency: "try"}]});
    expect(r.items.length).toBe(3);
    expect(r.items.map((i: any) => i.amountMinor).sort()).toEqual([100, null, null].sort());
    expect(r.items.filter((i: any) => i.amountMinor === null).length).toBe(2);
    expect(r.items.find((i: any) => i.id === O[2]).currency).toBeNull();
    expect(core.formatMoney(null, "TRY")).toBe("—");
    expect(core.formatMoney(100, "try")).toBe("—");
    expect(core.mapAccounts({}).state).toBe("ERROR");
    expect(core.mapInvoices({invoices: [{invoiceId: I[0], totalMinor: 10, paidMinor: 20}]}).items[0].balanceMinor).toBeNull();
  });
});

describe("UX WP3 money and totals", () => {
  it("formats exactly with BigInt, honours currency exponents and keeps currencies apart", async () => {
    const core = await load("company-core.js");
    expect(core.formatMoney(Number.MAX_SAFE_INTEGER, "TRY", "en")).toBe("90,071,992,547,409.91 TRY");
    expect(core.formatMoney(5, "USD", "en")).toBe("0.05 USD");
    expect(core.formatMoney(1234567, "JPY", "en")).toBe("1,234,567 JPY");
    expect(core.formatMoney(12345, "KWD", "en")).toBe("12.345 KWD");
    expect(core.formatMoney(123450n * 10n ** 12n, "USD", "en")).toBe("1,234,500,000,000,000.00 USD");
    expect(core.formatMoney(100, "TRY", "tr")).toBe("1,00 TRY");
    const s = core.sumByCurrency([{currency: "TRY", v: 1}, {currency: "USD", v: 2}, {currency: "TRY", v: 3}, {currency: "TRY", v: null}, {currency: "xx", v: 9}], (x: any) => x.v);
    expect(s.totals.map((x: any) => [x.currency, String(x.minor)])).toEqual([["TRY", "4"], ["USD", "2"]]);
    expect(s.skipped).toBe(2);
  });
});

describe("UX WP3 tabs, keyboard and account filter", () => {
  it("exposes an accessible tablist with roving tabindex and arrow/Home/End keys that change the active tab", async () => {
    const company = await load("views", "company.js");
    const {ctx, rerenders} = await mkCtx(fromFix(FIX));
    const root = await company.render(ctx, {id: "company"});
    const list = all(root).find(n => n.getAttribute("role") === "tablist")!;
    const tabs = all(list).filter(n => n.getAttribute("role") === "tab");
    expect(tabs.map(n => n.dataset.tab)).toEqual(["crm", "finance", "legal"]);
    expect(tabs.map(n => n.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map(n => n.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    for (const tb of tabs) expect(tb.getAttribute("aria-controls")).toBe("company-panel");
    const panelNode = all(root).find(n => n.id === "company-panel")!;
    expect(panelNode.getAttribute("role")).toBe("tabpanel");
    expect(panelNode.getAttribute("aria-labelledby")).toBe("company-tab-crm");
    tabs[0].fire("keydown", {key: "ArrowRight"});
    expect(company.selectedTab()).toBe("finance");
    tabs[1].fire("keydown", {key: "End"});
    expect(company.selectedTab()).toBe("legal");
    tabs[2].fire("keydown", {key: "ArrowRight"});
    expect(company.selectedTab()).toBe("crm");
    tabs[0].fire("keydown", {key: "ArrowLeft"});
    expect(company.selectedTab()).toBe("legal");
    tabs[0].fire("keydown", {key: "Home"});
    expect(company.selectedTab()).toBe("crm");
    expect(rerenders.length).toBeGreaterThanOrEqual(5);
    tabs[1].fire("click");
    const fin = await company.render(ctx, {id: "company"});
    expect(table(fin, "company-invoices-table")).toBeTruthy();
    expect(table(fin, "company-accounts-table")).toBeFalsy();
    expect(all(fin).find(n => n.id === "company-panel")!.getAttribute("aria-labelledby")).toBe("company-tab-finance");
  });

  it("marks a tab whose sources are unavailable as degraded with accessible text", async () => {
    const company = await load("views", "company.js");
    const fix = {...FIX}; delete (fix as any)["/v1/company/contracts"];
    const {ctx} = await mkCtx(fromFix(fix));
    const root = await company.render(ctx, {id: "company"});
    const legal = all(root).find(n => n.dataset.tab === "legal")!;
    expect(legal.dataset.tabHealth).toBe("degraded");
    expect(legal.textContent).toContain("kullanılamıyor");
    expect(all(root).find(n => n.dataset.tab === "crm")!.dataset.tabHealth).toBe("ok");
  });

  it("filters every table by the selected account using the records already read, including payments through their invoice", async () => {
    const company = await load("views", "company.js");
    const {ctx, calls} = await mkCtx(fromFix(FIX));
    const root = await company.render(ctx, {id: "company"});
    const select = all(root).find(n => n.id === "company-account-filter")!;
    expect(select.tagName).toBe("SELECT");
    expect(all(root).some(n => n.tagName === "LABEL" && n.getAttribute("for") === "company-account-filter")).toBe(true);
    expect(all(select).filter(n => n.tagName === "OPTION").map(n => n.getAttribute("value"))).toEqual(["", A1, A2]);
    const before = calls.length;
    select.fire("change", {target: {value: A2}});
    const crm = await company.render(ctx, {id: "company"});
    expect(rowsOf(crm, "company-accounts-table").map(r => r.dataset.recordId)).toEqual([A2]);
    expect(rowsOf(crm, "company-opps-table").map(r => r.dataset.recordId).sort()).toEqual([O[2], O[3]].sort());
    expect(rowsOf(crm, "company-contacts-table").map(r => r.dataset.recordId)).toEqual([K[1]]);
    expect(all(crm).find(n => n.id === "company-account-filter")!.children.find(o => o.getAttribute("value") === A2)!.attrs.has("selected")).toBe(true);
    all(crm).find(n => n.dataset.tab === "finance")!.fire("click");
    const fin = await company.render(ctx, {id: "company"});
    expect(rowsOf(fin, "company-invoices-table").map(r => r.dataset.recordId).sort()).toEqual([I[2], I[4]].sort());
    expect(rowsOf(fin, "company-payments-table").map(r => r.dataset.recordId).sort()).toEqual([P[0], P[2]].sort());
    // süzgeç yeni istek üretmez (tüm kaynaklar önbellekten/aynı altı uçtan okunur)
    expect(new Set(calls.slice(before)).size).toBeLessThanOrEqual(6);
    // hesap listesi kaybolursa seçili hesap sıfırlanır
    const none = await mkCtx(fromFix({...FIX, "/v1/company/accounts": {accounts: []}}));
    const r = await company.render(none.ctx, {id: "company"});
    expect(all(r).some(n => n.id === "company-account-filter")).toBe(false);
  });

  it("says payments cannot be filtered when invoices are unavailable instead of showing unrelated rows", async () => {
    const company = await load("views", "company.js");
    const withInv = await mkCtx(fromFix(FIX));
    const first = await company.render(withInv.ctx, {id: "company"});
    all(first).find(n => n.id === "company-account-filter")!.fire("change", {target: {value: A1}});
    const fix = {...FIX}; delete (fix as any)["/v1/company/invoices"];
    const {ctx} = await mkCtx(fromFix(fix));
    all(first).find(n => n.dataset.tab === "finance")!.fire("click");
    const root = await company.render(ctx, {id: "company"});
    expect(all(root).some(n => n.dataset.filterBlocked === "1")).toBe(true);
    expect(table(root, "company-payments-table")).toBeFalsy();
  });
});

describe("UX WP3 wiring and static safety", () => {
  it("replaces the planned panel: the company route is hosted by planned.js and delegates to views/company.js; delivery is now a real component too", async () => {
    const routes = await load("routes.js"), planned = await load("views", "planned.js");
    const co = routes.ROUTES.find((r: any) => r.id === "company");
    expect(co).toMatchObject({view: "planned", component: "company"});
    expect(co.plannedPackage).toBeUndefined();
    const {ctx} = await mkCtx(fromFix(FIX));
    const root = await planned.render(ctx, co);
    expect(root.className).toContain("view-company");
    expect(all(root).some(n => n.dataset.planned !== undefined)).toBe(false);
    // UX WP-DELIVERY: delivery is no longer a planned placeholder; it delegates to the real view with no planned panel.
    const dRoute = routes.ROUTES.find((r: any) => r.id === "delivery");
    expect(dRoute).toMatchObject({view: "planned", component: "delivery"});
    expect(dRoute.plannedPackage).toBeUndefined();
    const delivery = await planned.render(ctx, dRoute);
    expect(delivery.className).toContain("view-delivery");
    expect(all(delivery).some(n => n.dataset.planned !== undefined)).toBe(false);
    // app.js (korumalı) değişmedi: VIEWS tablosu "planned" anahtarını kullanmaya devam eder, company için yeni anahtar yoktur.
    expect(read("app.js")).toMatch(/const VIEWS=\{home,projects,work,workforce,assurance,planned,tower,inbox,settings\};/);
  });

  it("view and core have no HTML injection, network, storage, randomness or fabricated reference data, and the api adds only GET reads", () => {
    for (const f of [["views", "company.js"], ["company-core.js"]]) {
      const src = read(...f), code = src.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n");
      expect(code, f.join("/")).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Math\.random|\bbridge\b|apiGet|apiPost/);
      for (const bad of FAKE_REFERENCE) expect(src, bad).not.toContain(bad);
      expect(src.startsWith("// //TR:"), f.join("/")).toBe(true);
    }
    const api = read("api.js");
    const company = /async company\(\)\{([\s\S]*?)\n    async raw/.exec(api)![1];
    expect(company).not.toMatch(/\bpost\(|apiPost|method/);
    const core = read("company-core.js");
    for (const m of core.matchAll(/"(\/v1\/company\/[a-z]+)"/g)) expect(m[1]).toMatch(/^\/v1\/company\/(accounts|contacts|opportunities|invoices|payments|contracts)$/);
  });

  it("every translation key used by the company view exists in TR and EN with matching placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const core = await load("company-core.js");
    const need = new Set<string>(["area.company.title", "area.company.desc", "state.NOT_CONNECTED", "company.tab.degraded", "company.tabs.label", "company.sources", "company.stale"]);
    for (const k of core.COMPANY_KEYS) { need.add(`company.src.${k}`); need.add(`company.empty.${k}`); need.add(`company.${k}.title`); }
    for (const k of core.COMPANY_TABS) need.add(`company.tab.${k}`);
    for (const s of core.OPPORTUNITY_STAGES) need.add(`company.stage.${s}`);
    for (const s of core.INVOICE_STATUSES) need.add(`company.invoice.${s}`);
    for (const s of core.CONTRACT_STATUSES) need.add(`company.contract.${s}`);
    for (const s of ["PAYMENT", "REVERSAL"]) need.add(`company.payment.${s}`);
    for (const s of ["EMPTY", "STALE", "UNAVAILABLE", "NOT_CONNECTED", "OFFLINE", "ERROR"]) need.add(`company.state.${s}`);
    for (const s of ["UNAVAILABLE", "NOT_CONNECTED", "OFFLINE", "ERROR"]) need.add(`company.hint.${s}`);
    const src = read("views", "company.js");
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/\{key:"(company\.col\.[a-z]+)"/g)) need.add(m[1]);
    const missing = [...need].filter(k => !(k in tr) || !(k in en));
    expect(missing).toEqual([]);
    for (const k of need) expect((en[k].match(/\{\w+\}/g) ?? []).sort().join(","), k).toBe((tr[k].match(/\{\w+\}/g) ?? []).sort().join(","));
    expect(Object.keys(tr).filter(k => k.startsWith("area.company.plan"))).toEqual([]);
  });

  it("styles define the company classes with token colours only and a forced-colors fallback", () => {
    const css = read("styles.css");
    for (const c of [".company-toolbar", ".company-state", ".company-stale", ".company-sources", ".company-table", ".money-list", ".view-company"]) expect(css, c).toContain(c);
    const block = css.slice(css.indexOf("UX WP3: Company OS"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).toContain("forced-colors");
  });
});

// //TR: Ek sertleştirme: ctx.api.company() fırlatsa bile sahte veri yok; h1 odaklanabilir; tüm düğmeler type=button; durum blokları role=status; tablolar caption + scope=col; company.* anahtarları EN/TR'de birebir.
describe("UX WP3 hardening: negative, accessibility and locale parity", () => {
  it("renders an honest ERROR for every source when the api layer itself throws, with no rows and no em-dash replaced by numbers", async () => {
    const company = await load("views", "company.js");
    const {ctx} = await mkCtx(fromFix(FIX));
    ctx.api = {company: async () => { throw new Error("boom"); }};
    const root = await company.render(ctx, {id: "company"});
    for (const k of ["accounts", "contacts", "opportunities", "invoices", "payments", "contracts"]) expect(sourceState(root, k), k).toBe("ERROR");
    expect(all(root).filter(n => n.tagName === "TR").length).toBe(0);
    for (const id of ["company-accounts", "company-opportunities", "company-receivables", "company-contracts"]) expect(kpiValue(root, id), id).toBe("—");
    for (const bad of FAKE_REFERENCE) expect(root.textContent, bad).not.toContain(bad);
  });
  it("a payload that is not an object for any resource never produces rows or a signed/paid claim", async () => {
    const company = await load("views", "company.js");
    for (const bad of ["x", null, 7, [], {accounts: "no"}]) {
      const {ctx} = await mkCtx(() => bad);
      const root = await company.render(ctx, {id: "company"});
      expect(all(root).filter(n => n.tagName === "TR").length, JSON.stringify(bad)).toBe(0);
      expect(all(root).some(n => n.dataset.evidence === "complete"), JSON.stringify(bad)).toBe(false);
    }
  });
  it("h1 is focusable, every button is typed, state blocks are announced via role=status, tables have caption and scope=col (all tabs, TR and EN)", async () => {
    const company = await load("views", "company.js");
    for (const lang of ["tr", "en"]) {
      for (const [name, get] of [["real", fromFix(FIX)], ["failing", () => { throw new Error("x: HTTP 500"); }]] as const) {
        for (const tab of ["crm", "finance", "legal"]) {
          company.resetCompanyView();
          const {ctx} = await mkCtx(get as any, lang);
          const first = await company.render(ctx, {id: "company"});
          const tabBtn = all(first).find(n => n.id === `company-tab-${tab}`)!;
          tabBtn.fire("click");
          await new Promise(r => setTimeout(r, 0));
          const root = await company.render(ctx, {id: "company"});
          const where = `${lang}/${name}/${tab}`;
          const h1 = all(root).filter(n => n.tagName === "H1");
          expect(h1.length, where).toBe(1);
          expect(h1[0].getAttribute("tabindex"), where).toBe("-1");
          for (const b of all(root).filter(n => n.tagName === "BUTTON")) expect(b.getAttribute("type"), where).toBe("button");
          for (const s of all(root).filter(n => n.dataset.companyState)) expect(s.getAttribute("role"), where).toBe("status");
          for (const t of all(root).filter(n => n.tagName === "TABLE")) {
            expect(t.children.some(c => c.tagName === "CAPTION" && c.textContent.length > 0), where).toBe(true);
            for (const th of all(t).filter(n => n.tagName === "TH")) expect(th.getAttribute("scope"), where).toBe("col");
          }
          for (const g of all(root).filter(n => n.getAttribute("role") === "group")) expect((g.getAttribute("aria-label") ?? "").length, where).toBeGreaterThan(0);
        }
      }
    }
  });
  it("company.* and area.company.* have identical key sets in TR and EN", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const pick = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("company.") || k.startsWith("area.company.")).sort();
    expect(pick(tr)).toEqual(pick(en));
    for (const k of pick(en)) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); }
  });
});

// //TR: UI-233 Hesap maruziyeti tablosu: el ile hesaplanmış fixture değerleri, UTC takvim günü ile gecikme, vadesi bilinmeyen sayımı, kaynak durumlarında "—"+rozet (asla 0), STALE işareti, hesap süzgeci ve skor/etiket üretilmemesi.
describe("UI-233 account exposure table", () => {
  const EXP = "company-exposure-table";
  const cells = (r: N) => all(r).filter(n => n.tagName === "TD").map(n => n.textContent);
  const NOW = Date.UTC(2026, 11, 1, 12, 0, 0); // 2026-12-01 UTC
  const withInv = (invoices: any[]) => ({...FIX, "/v1/company/invoices": {invoices}});
  const inv = (n: number, over: any) => ({recordKind: "invoice", invoiceId: id("inv", n), tenantId: "t1", accountId: A1, currency: "TRY", lineItems: [], totalMinor: 1000, paidMinor: 0, balanceMinor: 1000, status: "ISSUED", number: `INV-X${n}`, issuedAt: t(1), voidedAt: null, createdAt: t(1), createdBy: "x", ...over});
  const run = async (fix: Record<string, any> | ((p: string) => any), now = NOW, lang = "en") => {
    const company = await load("views", "company.js");
    const m = await mkCtx(typeof fix === "function" ? (fix as (p: string) => any) : fromFix(fix), lang);
    m.ctx.now = () => now;
    return {...m, root: await company.render(m.ctx, {id: "company"}) as N};
  };

  it("lists one row per account with hand-computed per-currency pipeline, outstanding, overdue, unknown and awaiting-signature values", async () => {
    const {root} = await run(FIX);
    expect(rowsOf(root, EXP).length).toBe(2);
    const tbl = table(root, EXP)!;
    expect(all(tbl).some(n => n.tagName === "CAPTION")).toBe(true);
    expect(all(tbl).filter(n => n.tagName === "TH").every(n => n.getAttribute("scope") === "col")).toBe(true);
    // A1: open TRY 1.000,00 + 2.500,50 = 3,500.50 ; ISSUED 1,000.00 due 2026-11-01 < 2026-12-01 -> 1 overdue ; SENT 1
    expect(cells(rowFor(root, EXP, A1))).toEqual(["Fixture Account One", "3,500.50 TRY", "1,000.00 TRY", "1", "0", "1"]);
    // A2: open USD 50.00 ; PARTIALLY_PAID 150.00 USD with no dueDate -> unknown ; no SENT
    expect(cells(rowFor(root, EXP, A2))).toEqual(["Fixture Account Two", "50.00 USD", "150.00 USD", "0", "1", "0"]);
  });

  it("judges overdue on the UTC calendar date and counts unreadable due dates/balances as unknown, never overdue or on time", async () => {
    const fix = withInv([
      inv(1, {dueDate: "2026-11-30"}), inv(2, {dueDate: "2026-12-01"}), inv(3, {dueDate: "2026-12-02"}),
      inv(4, {dueDate: "2026-02-30"}), inv(5, {dueDate: undefined}), inv(6, {dueDate: "2026-11-01", balanceMinor: null, totalMinor: null, paidMinor: null}),
      inv(7, {dueDate: "2026-01-01", status: "DRAFT"}), inv(8, {dueDate: "2026-01-01", status: "PAID", balanceMinor: 0, paidMinor: 1000}), inv(9, {dueDate: "2026-01-01", status: "VOID"}),
      inv(10, {dueDate: "2026-11-01", status: "PARTIALLY_PAID", balanceMinor: 500})]);
    const {root} = await run(fix, Date.UTC(2026, 11, 1, 23, 59, 59));
    const c = cells(rowFor(root, EXP, A1));
    expect(c[3]).toBe("2"); // inv1 + inv10 (inv2 is due today, not before)
    expect(c[4]).toBe("3"); // inv4 invalid calendar date, inv5 missing, inv6 unreadable balance
    const early = await run(fix, Date.UTC(2026, 10, 30, 23, 59, 59));
    expect(cells(rowFor(early.root, EXP, A1))[3]).toBe("1"); // due 2026-11-30 is "today" (not before it); only inv10 (2026-11-01) is overdue
  });

  it("falls back to Date.now when ctx.now is absent and shows the dash for overdue when the clock is not finite", async () => {
    const company = await load("views", "company.js");
    const m = await mkCtx(fromFix(withInv([inv(1, {dueDate: "2000-01-01"}), inv(2, {dueDate: "9999-12-31"})])));
    const root = await company.render(m.ctx, {id: "company"}) as N;
    expect(cells(rowFor(root, EXP, A1))[3]).toBe("1"); // real clock: 2000 is past, 9999 is not
    const bad = await run(FIX, Number.NaN);
    const c = cells(rowFor(bad.root, EXP, A1));
    expect(c[3]).toBe("—");
    expect(c[4]).toBe("0");
  });

  it("shows the dash plus the honest source pill (never 0) when a source is not live, and a STALE marker with as-of time for stale data", async () => {
    const fail = (key: string, err: string) => (p: string) => { if (p === `/v1/company/${key}`) throw new Error(err); return FIX[p]; };
    for (const [err, pill] of [["INVALID_API_PATH", "NOT_CONNECTED"], ["/v1/company/invoices: HTTP 503", "UNAVAILABLE"], ["fetch failed", "OFFLINE"], ["/v1/company/invoices: HTTP 500", "FAILED"]] as const) {
      const {root} = await run(fail("invoices", err));
      const c = cells(rowFor(root, EXP, A1));
      expect(c[2], err).toContain("—"); expect(c[3], err).toContain("—"); expect(c[4], err).toContain("—");
      expect(c[2]).not.toMatch(/\b0\b/);
      expect(c[1]).toBe("3,500.50 TRY"); expect(c[5]).toBe("1");
      const row = rowFor(root, EXP, A1);
      expect(all(row).filter(n => n.dataset.exposureCell === "missing" && n.dataset.source === "invoices").length).toBe(3);
      expect(pills(row)).toContain(pill);
    }
    const {ctx} = await mkCtx(fromFix(FIX), "en");
    ctx.now = () => NOW;
    const company = await load("views", "company.js");
    const stale: any = await (await mkCtx(fromFix(FIX), "en")).ctx.api.company();
    stale.invoices = {...stale.invoices, state: "STALE", asOf: t(3), cause: "OFFLINE"};
    ctx.api.company = async () => stale;
    const root = await company.render(ctx, {id: "company"}) as N;
    const row = rowFor(root, EXP, A1);
    expect(cells(row)[2]).toContain("1,000.00 TRY");
    expect(all(row).some(n => n.dataset.exposureCell === "stale" && n.dataset.source === "invoices")).toBe(true);
    expect(pills(row)).toContain("STALE");
  });

  it("renders no exposure table for EMPTY or non-live accounts and honours the account filter", async () => {
    const empty = await run(EMPTY_FIX);
    expect(table(empty.root, EXP)).toBeUndefined();
    const off = await run(() => { throw new Error("fetch failed"); });
    expect(table(off.root, EXP)).toBeUndefined();
    const company = await load("views", "company.js");
    const m = await mkCtx(fromFix(FIX)); m.ctx.now = () => NOW;
    let root = await company.render(m.ctx, {id: "company"}) as N;
    const select = all(root).find(n => n.id === "company-account-filter")!;
    select.fire("change", {target: {value: A2}});
    root = await company.render(m.ctx, {id: "company"}) as N;
    expect(rowsOf(root, EXP).map(r => r.dataset.recordId)).toEqual([A2]);
  });

  it("falls back to the raw account id when the name is missing, and produces no score, rating or health label (TR and EN)", async () => {
    const fix = {...FIX, "/v1/company/accounts": {accounts: [{recordKind: "account", accountId: A1, tenantId: "t1", createdAt: t(1), createdBy: "x"}]}};
    for (const lang of ["en", "tr"]) {
      const {root} = await run(fix, NOW, lang);
      expect(cells(rowFor(root, EXP, A1))[0]).toBe(A1);
      const text = all(root).filter(n => n.dataset.note === "exposure-recorded").map(n => n.textContent).join("");
      expect(text.length).toBeGreaterThan(20);
      const tblText = table(root, EXP)!.textContent;
      expect(tblText).not.toMatch(/healthy|at[- ]risk|low[- ]risk|score|rating|sağlıklı|riskli|skor/i);
    }
  });

  it("defines every exposure key in TR and EN with identical placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = ["company.exposure.title", "company.exposure.note", ...["pipelineOpen", "outstanding", "overdue", "dueUnknown", "awaitingSig"].map(k => `company.col.${k}`)];
    for (const k of keys) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); expect((en[k].match(/\{\w+\}/g) ?? []).join(), k).toBe((tr[k].match(/\{\w+\}/g) ?? []).join()); }
  });
});
