// //TR: Bu test Company OS çekirdek alanlarını (CRM, Finans fatura/ödeme, Hukuk sözleşme) gerçek geçici journal ve gerçek API ile doğrular: durum makineleri, "fatura kesildi ödeme alındı değildir", append-only ödeme/ters kayıt, imza kanıtı, tenant izolasyonu, idempotency, Global Stop 423, tamper fail-closed ve ikinci store olmaması.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {CrmDomain} from "../core/company/crm.js";
import {FinanceDomain} from "../core/company/finance.js";
import {LegalDomain} from "../core/company/legal.js";
import {buildServer} from "../apps/control-api/src/server.js";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (test geçerli hash zincirli sahte journal satırı üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";
import {NO_REAL_WSL_ON_WIN32} from "./support/test-sandbox.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const sha256 = sha256Untyped as (v: unknown) => string;
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b11a-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
const journalFile = () => path.join(dataDir(), "journal.jsonl");
const journalLines = () => (fs.existsSync(journalFile()) ? fs.readFileSync(journalFile(), "utf8").split("\n").filter(Boolean) : []);
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });
function mkApp(tenantId = "tA", extra: Record<string, unknown> = {}): App {
  fs.mkdirSync(runtime(), {recursive: true});
  const app = buildServer({...NO_REAL_WSL_ON_WIN32, controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId, port: 3210, logger: false, ...extra});
  apps.push(app);
  return app;
}
const post = (app: App, url: string, payload?: unknown) => app.inject({method: "POST", url, headers: hdr, ...(payload === undefined ? {} : {payload: payload as object})});
const get = (app: App, url: string) => app.inject({method: "GET", url, headers: hdr});
const HASH = "a".repeat(64);
const lines2 = [{description: "Development", quantity: 3, unitAmountMinor: 10000}, {description: "Hosting", quantity: 1, unitAmountMinor: 2500}]; // 32500

async function account(app: App, name = "Acme Ltd", extra: Record<string, unknown> = {}) {
  const r = await post(app, "/v1/company/accounts", {name, ...extra});
  expect(r.statusCode).toBe(201);
  return r.json().account as {accountId: string; tenantId: string; name: string};
}
async function draftInvoice(app: App, accountId: string, extra: Record<string, unknown> = {}) {
  const r = await post(app, "/v1/company/invoices", {accountId, currency: "EUR", lineItems: lines2, ...extra});
  expect(r.statusCode).toBe(201);
  return r.json().invoice as {invoiceId: string; status: string; totalMinor: number; paidMinor: number; balanceMinor: number; number: string | null};
}
async function issuedInvoice(app: App, accountId: string) {
  const inv = await draftInvoice(app, accountId);
  const r = await post(app, `/v1/company/invoices/${inv.invoiceId}/issue`);
  expect(r.statusCode).toBe(200);
  return r.json().invoice as typeof inv;
}
const pay = (app: App, invoiceId: string, amountMinor: number, extra: Record<string, unknown> = {}) => post(app, "/v1/company/payments", {invoiceId, amountMinor, currency: "EUR", ...extra});
const invoiceOf = async (app: App, id: string) => ((await get(app, "/v1/company/invoices")).json().invoices as Array<{invoiceId: string; status: string; paidMinor: number; balanceMinor: number}>).find(i => i.invoiceId === id)!;

describe("CRM", () => {
  it("creates accounts, contacts and opportunities with integer minor units and strict schemas", async () => {
    const app = mkApp();
    const acc = await account(app);
    expect(acc.accountId).toMatch(/^acc_[0-9a-f]{24}$/);
    expect(acc.tenantId).toBe("tA");
    const c = await post(app, "/v1/company/contacts", {accountId: acc.accountId, name: "Jane Doe", role: "CTO", email: "jane@example.com"});
    expect(c.statusCode).toBe(201);
    expect(c.json().contact.contactId).toMatch(/^cnt_[0-9a-f]{24}$/);
    const o = await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "Platform deal", amountMinor: 1250000, currency: "USD"});
    expect(o.statusCode).toBe(201);
    expect(o.json().opportunity).toMatchObject({stage: "LEAD", amountMinor: 1250000, currency: "USD"});
    expect((await get(app, "/v1/company/accounts")).json().accounts).toHaveLength(1);
    expect((await get(app, `/v1/company/contacts?accountId=${acc.accountId}`)).json().contacts).toHaveLength(1);
    expect((await get(app, `/v1/company/opportunities?accountId=${acc.accountId}`)).json().opportunities).toHaveLength(1);
    expect((await get(app, "/v1/company/contacts?accountId=bad")).statusCode).toBe(400);
    // sıkı şema: bilinmeyen alan, ondalıklı/negatif tutar, küçük harfli para birimi, geçersiz e-posta
    for (const [url, payload] of [
      ["/v1/company/accounts", {name: "x", extra: 1}],
      ["/v1/company/contacts", {accountId: acc.accountId, name: "x", email: "not-an-email"}],
      ["/v1/company/contacts", {accountId: acc.accountId, name: "x", password: "p"}],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "t", amountMinor: 10.5, currency: "USD"}],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "t", amountMinor: -1, currency: "USD"}],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "t", amountMinor: 1, currency: "usd"}],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "t", amountMinor: 1, currency: "USDX"}]
    ] as const) expect((await post(app, url, payload)).statusCode, JSON.stringify(payload)).toBe(400);
  });

  it("rejects secret-like values in free text and never writes them", async () => {
    const app = mkApp();
    const fake = ["gh", "p_", "Q7ZX3MPLW2RT5VB9Q7ZX3MPLW2RT5VB9", "ABCD"].join("");
    const r = await post(app, "/v1/company/accounts", {name: `Acme ${fake}`});
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain(fake);
    expect(journalLines()).toHaveLength(0);
  });

  it("enforces the opportunity stage machine and invalid transitions write nothing", async () => {
    const app = mkApp();
    const acc = await account(app);
    const o = (await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "Deal", amountMinor: 100, currency: "EUR"})).json().opportunity;
    const stage = (to: string) => post(app, `/v1/company/opportunities/${o.opportunityId}/stage`, {stage: to});
    const before = journalLines().length;
    for (const bad of ["PROPOSAL", "WON", "LEAD"]) { const r = await stage(bad); expect(r.statusCode, bad).toBe(409); }
    expect((await stage("NOPE")).statusCode).toBe(400);
    expect(journalLines()).toHaveLength(before);
    expect((await stage("QUALIFIED")).json().opportunity.stage).toBe("QUALIFIED");
    expect((await stage("WON")).statusCode).toBe(409);
    expect((await stage("PROPOSAL")).json().opportunity.stage).toBe("PROPOSAL");
    expect((await stage("WON")).json().opportunity.stage).toBe("WON");
    const after = journalLines().length;
    for (const to of ["LOST", "LEAD", "QUALIFIED", "PROPOSAL", "WON"]) expect((await stage(to)).statusCode, to).toBe(409);
    expect(journalLines()).toHaveLength(after);
    const l = (await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "Lost deal", amountMinor: 1, currency: "EUR"})).json().opportunity;
    expect((await post(app, `/v1/company/opportunities/${l.opportunityId}/stage`, {stage: "LOST", reason: "no budget"})).json().opportunity.stage).toBe("LOST");
    expect((await post(app, `/v1/company/opportunities/${l.opportunityId}/stage`, {stage: "QUALIFIED"})).statusCode).toBe(409);
    expect((await post(app, "/v1/company/opportunities/opp_000000000000000000000000/stage", {stage: "QUALIFIED"})).statusCode).toBe(404);
    expect((await post(app, "/v1/company/opportunities/bad/stage", {stage: "QUALIFIED"})).statusCode).toBe(400);
  });

  it("a WON opportunity never creates a contract or an invoice implicitly", async () => {
    const app = mkApp();
    const acc = await account(app);
    const o = (await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "Deal", amountMinor: 5000, currency: "EUR"})).json().opportunity;
    for (const s of ["QUALIFIED", "PROPOSAL", "WON"]) expect((await post(app, `/v1/company/opportunities/${o.opportunityId}/stage`, {stage: s})).statusCode).toBe(200);
    expect((await get(app, "/v1/company/contracts")).json().contracts).toEqual([]);
    expect((await get(app, "/v1/company/invoices")).json().invoices).toEqual([]);
    expect((await get(app, "/v1/company/payments")).json().payments).toEqual([]);
  });
});

describe("Finance", () => {
  it("computes totals on the server and ignores client totals", async () => {
    const app = mkApp();
    const acc = await account(app);
    const inv = await draftInvoice(app, acc.accountId, {totalMinor: 1});
    expect(inv.totalMinor).toBe(32500);
    expect(inv).toMatchObject({status: "DRAFT", paidMinor: 0, balanceMinor: 32500, number: null});
    const full = (await get(app, "/v1/company/invoices")).json().invoices[0];
    expect(full.lineItems.map((l: {amountMinor: number}) => l.amountMinor)).toEqual([30000, 2500]);
    for (const payload of [
      {accountId: acc.accountId, currency: "EUR", lineItems: []},
      {accountId: acc.accountId, currency: "EUR", lineItems: [{description: "x", quantity: 0, unitAmountMinor: 5}]},
      {accountId: acc.accountId, currency: "EUR", lineItems: [{description: "x", quantity: 1, unitAmountMinor: 1.5}]},
      {accountId: acc.accountId, currency: "EUR", lineItems: [{description: "x", quantity: 1, unitAmountMinor: 5, amountMinor: 999}]},
      {accountId: acc.accountId, currency: "eur", lineItems: lines2}
    ]) expect((await post(app, "/v1/company/invoices", payload)).statusCode, JSON.stringify(payload)).toBe(400);
    // toplamı 0 olan veya güvenli tamsayıyı aşan fatura reddedilir
    expect((await post(app, "/v1/company/invoices", {accountId: acc.accountId, currency: "EUR", lineItems: [{description: "free", quantity: 1, unitAmountMinor: 0}]})).statusCode).toBe(400);
    const huge = await post(app, "/v1/company/invoices", {accountId: acc.accountId, currency: "EUR", lineItems: [{description: "big", quantity: 1000000, unitAmountMinor: Number.MAX_SAFE_INTEGER}]});
    expect(huge.statusCode).toBe(400);
    expect((await post(app, "/v1/company/invoices", {accountId: "acc_000000000000000000000000", currency: "EUR", lineItems: lines2})).statusCode).toBe(404);
  });

  it("invoice ISSUED is not PAID, partial payment is PARTIALLY_PAID and the full amount is PAID", async () => {
    const app = mkApp();
    const acc = await account(app);
    const inv = await issuedInvoice(app, acc.accountId);
    expect(inv).toMatchObject({status: "ISSUED", paidMinor: 0, balanceMinor: 32500, number: "INV-000001"});
    expect((await get(app, "/v1/company/payments")).json().payments).toEqual([]);
    expect((await post(app, `/v1/company/invoices/${inv.invoiceId}/issue`)).statusCode).toBe(409); // tekrar kesilemez
    const p1 = await pay(app, inv.invoiceId, 10000, {reference: "BANK-1"});
    expect(p1.statusCode).toBe(201);
    expect(p1.json().invoice).toMatchObject({status: "PARTIALLY_PAID", paidMinor: 10000, balanceMinor: 22500});
    expect(p1.json().payment).toMatchObject({entryKind: "PAYMENT", amountMinor: 10000, invoiceId: inv.invoiceId});
    const p2 = await pay(app, inv.invoiceId, 22500);
    expect(p2.json().invoice).toMatchObject({status: "PAID", paidMinor: 32500, balanceMinor: 0});
    expect(((await get(app, `/v1/company/payments?invoiceId=${inv.invoiceId}`)).json().payments as unknown[])).toHaveLength(2);
    const second = await issuedInvoice(app, acc.accountId);
    expect(second.number).toBe("INV-000002");
  });

  it("rejects overpayment, currency mismatch and payments on non-payable invoices without writing", async () => {
    const app = mkApp();
    const acc = await account(app);
    const draft = await draftInvoice(app, acc.accountId);
    const inv = await issuedInvoice(app, acc.accountId);
    const before = journalLines().length;
    expect((await pay(app, draft.invoiceId, 100)).statusCode).toBe(409); // DRAFT ödenemez
    const over = await pay(app, inv.invoiceId, 32501);
    expect(over.statusCode).toBe(409);
    expect(over.json().reason).toBe("OVERPAYMENT");
    expect((await pay(app, inv.invoiceId, 100, {currency: "USD"})).statusCode).toBe(400);
    for (const bad of [0, -5, 1.5]) expect((await pay(app, inv.invoiceId, bad)).statusCode, String(bad)).toBe(400);
    expect((await post(app, "/v1/company/payments", {invoiceId: inv.invoiceId, amountMinor: 100})).statusCode).toBe(400); // currency zorunlu
    expect((await post(app, "/v1/company/payments", {invoiceId: inv.invoiceId, amountMinor: 100, currency: "EUR", reason: "x"})).statusCode).toBe(400);
    expect((await pay(app, "inv_000000000000000000000000", 100)).statusCode).toBe(404);
    expect(journalLines()).toHaveLength(before);
    expect((await pay(app, inv.invoiceId, 32500)).json().invoice.status).toBe("PAID");
    const afterPaid = journalLines().length;
    expect((await pay(app, inv.invoiceId, 1)).statusCode).toBe(409); // PAID faturaya fazla ödeme
    expect(journalLines()).toHaveLength(afterPaid);
  });

  it("payments are append-only: corrections are reversal entries and never edit the original", async () => {
    const app = mkApp();
    const acc = await account(app);
    const inv = await issuedInvoice(app, acc.accountId);
    const p = (await pay(app, inv.invoiceId, 32500)).json().payment;
    expect((await get(app, "/v1/company/invoices")).json().invoices[0].status).toBe("PAID");
    const origLine = journalLines().find(l => l.includes(p.paymentId))!;
    const r = await post(app, "/v1/company/payments", {reversesPaymentId: p.paymentId, reason: "bounced"});
    expect(r.statusCode).toBe(201);
    expect(r.json().payment).toMatchObject({entryKind: "REVERSAL", reversesPaymentId: p.paymentId, amountMinor: 32500});
    expect(r.json().invoice).toMatchObject({status: "ISSUED", paidMinor: 0});
    expect(journalLines()).toContain(origLine); // orijinal satır değişmedi
    const all = (await get(app, `/v1/company/payments?invoiceId=${inv.invoiceId}`)).json().payments as Array<{paymentId: string; entryKind: string}>;
    expect(all.map(x => x.entryKind).sort()).toEqual(["PAYMENT", "REVERSAL"]);
    const before = journalLines().length;
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: p.paymentId, reason: "again"})).statusCode).toBe(409); // çift geri çevirme
    const revId = r.json().payment.paymentId;
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: revId, reason: "undo"})).statusCode).toBe(400); // ters kayıt geri çevrilmez
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: p.paymentId})).statusCode).toBe(400); // reason zorunlu
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: p.paymentId, reason: "x", amountMinor: 5})).statusCode).toBe(400);
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: "pay_000000000000000000000000", reason: "x"})).statusCode).toBe(404);
    expect(journalLines()).toHaveLength(before);
    // geri çevrilen tutar yeniden ödenebilir; kısmi geri çevirme faturayı PARTIALLY_PAID'e indirir
    const a = (await pay(app, inv.invoiceId, 20000)).json().payment, b = (await pay(app, inv.invoiceId, 12500)).json().payment;
    expect((await invoiceOf(app, inv.invoiceId)).status).toBe("PAID");
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: b.paymentId, reason: "refund"})).json().invoice).toMatchObject({status: "PARTIALLY_PAID", paidMinor: 20000});
    expect(a.paymentId).not.toBe(b.paymentId);
  });

  it("voids only ISSUED invoices without net payments", async () => {
    const app = mkApp();
    const acc = await account(app);
    const draft = await draftInvoice(app, acc.accountId);
    const partial = await issuedInvoice(app, acc.accountId);
    const paid = await issuedInvoice(app, acc.accountId);
    const clean = await issuedInvoice(app, acc.accountId);
    await pay(app, partial.invoiceId, 100);
    await pay(app, paid.invoiceId, 32500);
    const before = journalLines().length;
    const v = (id: string, reason = "mistake") => post(app, `/v1/company/invoices/${id}/void`, {reason});
    expect((await v(draft.invoiceId)).statusCode).toBe(409);
    expect((await v(partial.invoiceId)).statusCode).toBe(409);
    expect((await v(paid.invoiceId)).statusCode).toBe(409);
    expect((await post(app, `/v1/company/invoices/${clean.invoiceId}/void`, {})).statusCode).toBe(400); // reason zorunlu
    expect(journalLines()).toHaveLength(before);
    const ok = await v(clean.invoiceId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().invoice.status).toBe("VOID");
    expect((await v(clean.invoiceId)).statusCode).toBe(409);
    expect((await pay(app, clean.invoiceId, 100)).statusCode).toBe(409); // VOID ödenemez
    expect((await post(app, `/v1/company/invoices/${clean.invoiceId}/issue`)).statusCode).toBe(409);
    // tamamı ters kayıtla geri çevrilmiş fatura ISSUED'a döner ve void edilebilir
    const p = (await pay(app, partial.invoiceId, 200)).json().payment;
    await post(app, "/v1/company/payments", {reversesPaymentId: p.paymentId, reason: "r"});
    expect((await v(partial.invoiceId)).statusCode).toBe(409); // 100 net ödeme hâlâ var
  });
});

describe("Legal", () => {
  async function contract(app: App, extra: Record<string, unknown> = {}) {
    const acc = (extra.accountId ? {accountId: extra.accountId as string} : await account(app));
    const r = await post(app, "/v1/company/contracts", {accountId: acc.accountId, title: "MSA", ...extra});
    expect(r.statusCode).toBe(201);
    return {...(r.json().contract as {contractId: string; status: string}), accountId: acc.accountId};
  }
  const tr = (app: App, id: string, payload: unknown) => post(app, `/v1/company/contracts/${id}/transition`, payload);

  it("SIGNED requires document sha256, signer name and signedAt; invalid transitions write nothing", async () => {
    const app = mkApp();
    const c = await contract(app);
    expect(c.status).toBe("DRAFT");
    const before = journalLines().length;
    const signed = {to: "SIGNED", documentSha256: HASH, signerName: "Jane Doe", signedAt: "2026-10-01T10:00:00Z"};
    expect((await tr(app, c.contractId, signed)).statusCode).toBe(409); // DRAFT -> SIGNED yok
    for (const drop of ["documentSha256", "signerName", "signedAt"]) {
      const p: Record<string, unknown> = {...signed}; delete p[drop];
      expect((await tr(app, c.contractId, p)).statusCode, drop).toBe(400);
    }
    expect((await tr(app, c.contractId, {to: "SENT", documentSha256: HASH})).statusCode).toBe(400);
    expect((await tr(app, c.contractId, {to: "DRAFT"})).statusCode).toBe(400);
    expect(journalLines()).toHaveLength(before);
    expect((await tr(app, c.contractId, {to: "SENT"})).json().contract.status).toBe("SENT");
    expect((await tr(app, c.contractId, {...signed, documentSha256: "xyz"})).statusCode).toBe(400);
    expect((await tr(app, c.contractId, {...signed, signerName: "  "})).statusCode).toBe(400);
    expect((await tr(app, c.contractId, {...signed, signedAt: "2999-01-01T00:00:00Z"})).statusCode).toBe(400);
    const afterBad = journalLines().length;
    const ok = await tr(app, c.contractId, signed);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().contract).toMatchObject({status: "SIGNED", documentSha256: HASH, signerName: "Jane Doe", signedAt: "2026-10-01T10:00:00.000Z"});
    expect(journalLines().length).toBe(afterBad + 1);
    for (const to of ["SENT", "DECLINED", "EXPIRED"]) expect((await tr(app, c.contractId, {to})).statusCode, to).toBe(409);
  });

  it("supports DECLINED and EXPIRED from SENT only", async () => {
    const app = mkApp();
    const a = await contract(app), b = await contract(app);
    expect((await tr(app, a.contractId, {to: "DECLINED"})).statusCode).toBe(409);
    expect((await tr(app, a.contractId, {to: "EXPIRED"})).statusCode).toBe(409);
    await tr(app, a.contractId, {to: "SENT"}); await tr(app, b.contractId, {to: "SENT"});
    expect((await tr(app, a.contractId, {to: "DECLINED", reason: "too expensive"})).json().contract.status).toBe("DECLINED");
    expect((await tr(app, b.contractId, {to: "EXPIRED"})).json().contract.status).toBe("EXPIRED");
    expect((await tr(app, a.contractId, {to: "SENT"})).statusCode).toBe(409);
    expect((await tr(app, "ctr_000000000000000000000000", {to: "SENT"})).statusCode).toBe(404);
  });

  it("a quote/opportunity never becomes a signed contract implicitly and links are validated", async () => {
    const app = mkApp();
    const acc = await account(app);
    const other = await account(app, "Other Co");
    const o = (await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "Deal", amountMinor: 100, currency: "EUR"})).json().opportunity;
    for (const s of ["QUALIFIED", "PROPOSAL", "WON"]) await post(app, `/v1/company/opportunities/${o.opportunityId}/stage`, {stage: s});
    expect((await get(app, "/v1/company/contracts")).json().contracts).toEqual([]);
    expect((await post(app, "/v1/company/contracts", {accountId: other.accountId, opportunityId: o.opportunityId, title: "x"})).statusCode).toBe(400); // farklı hesap
    expect((await post(app, "/v1/company/contracts", {accountId: acc.accountId, opportunityId: "opp_000000000000000000000000", title: "x"})).statusCode).toBe(404);
    const c = await post(app, "/v1/company/contracts", {accountId: acc.accountId, opportunityId: o.opportunityId, title: "From deal"});
    expect(c.json().contract).toMatchObject({status: "DRAFT", documentSha256: null, signerName: null, signedAt: null, opportunityId: o.opportunityId});
    expect((await get(app, `/v1/company/opportunities?accountId=${acc.accountId}`)).json().opportunities[0].stage).toBe("WON");
  });
});

describe("Tenant isolation", () => {
  it("never exposes or mutates another tenant's records for any entity", async () => {
    const a = mkApp("tA"), b = mkApp("tB");
    const acc = await account(a);
    const contact = (await post(a, "/v1/company/contacts", {accountId: acc.accountId, name: "Jane", email: "jane@example.com"})).json().contact;
    const opp = (await post(a, "/v1/company/opportunities", {accountId: acc.accountId, title: "Deal", amountMinor: 100, currency: "EUR"})).json().opportunity;
    const inv = await issuedInvoice(a, acc.accountId);
    const payment = (await pay(a, inv.invoiceId, 100)).json().payment;
    const ctr = (await post(a, "/v1/company/contracts", {accountId: acc.accountId, title: "MSA"})).json().contract;
    const snapshotBefore = journalLines().length;
    // B hiçbir şey görmez
    for (const k of ["accounts", "contacts", "opportunities", "invoices", "payments", "contracts"]) expect((await get(b, `/v1/company/${k}`)).json()[k], k).toEqual([]);
    expect((await get(b, `/v1/company/contacts?accountId=${acc.accountId}`)).json().contacts).toEqual([]);
    // B, A'nın kayıtlarına referans veremez/değiştiremez (404, sızıntı yok)
    const attempts: Array<[string, unknown]> = [
      ["/v1/company/contacts", {accountId: acc.accountId, name: "x"}],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "t", amountMinor: 1, currency: "EUR"}],
      [`/v1/company/opportunities/${opp.opportunityId}/stage`, {stage: "QUALIFIED"}],
      ["/v1/company/invoices", {accountId: acc.accountId, currency: "EUR", lineItems: lines2}],
      [`/v1/company/invoices/${inv.invoiceId}/issue`, undefined],
      [`/v1/company/invoices/${inv.invoiceId}/void`, {reason: "x"}],
      ["/v1/company/payments", {invoiceId: inv.invoiceId, amountMinor: 1, currency: "EUR"}],
      ["/v1/company/payments", {reversesPaymentId: payment.paymentId, reason: "x"}],
      ["/v1/company/contracts", {accountId: acc.accountId, title: "x"}],
      [`/v1/company/contracts/${ctr.contractId}/transition`, {to: "SENT"}]
    ];
    for (const [url, payload] of attempts) {
      const r = await post(b, url, payload);
      expect(r.statusCode, url).toBe(404);
      expect(r.json()).toEqual({error: "WORKOS_NOT_FOUND"});
    }
    expect(journalLines()).toHaveLength(snapshotBefore);
    // A etkilenmedi
    expect((await invoiceOf(a, inv.invoiceId)).status).toBe("PARTIALLY_PAID");
    expect((await get(a, "/v1/company/contracts")).json().contracts[0].status).toBe("DRAFT");
    expect(contact.tenantId).toBe("tA");
    // B kendi kayıtlarını aynı journal içinde ayrı tutar; aynı idempotency anahtarı tenant'lar arasında çakışmaz
    const accB = await account(b, "B Co", {idempotencyKey: "same-key"});
    const accA = await account(a, "A2 Co", {idempotencyKey: "same-key"});
    expect(accB.accountId).not.toBe(accA.accountId);
    expect((await get(b, "/v1/company/accounts")).json().accounts).toHaveLength(1);
    expect((await get(a, "/v1/company/accounts")).json().accounts).toHaveLength(2);
  });
});

describe("Idempotency", () => {
  it("replays the same key and payload with 200 and conflicts on a different payload (409)", async () => {
    const app = mkApp();
    const acc = await account(app, "Acme", {idempotencyKey: "k-acc"});
    const again = await post(app, "/v1/company/accounts", {name: "Acme", idempotencyKey: "k-acc"});
    expect(again.statusCode).toBe(200);
    expect(again.json().account.accountId).toBe(acc.accountId);
    expect((await post(app, "/v1/company/accounts", {name: "Different", idempotencyKey: "k-acc"})).json()).toEqual({error: "IDEMPOTENCY_CONFLICT"});
    expect((await post(app, "/v1/company/accounts", {name: "Different", idempotencyKey: "k-acc"})).statusCode).toBe(409);
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
      ["/v1/company/contacts", {accountId: acc.accountId, name: "Jane", idempotencyKey: "k-c"}, {name: "John"}, "contact"],
      ["/v1/company/opportunities", {accountId: acc.accountId, title: "D", amountMinor: 10, currency: "EUR", idempotencyKey: "k-o"}, {amountMinor: 11}, "opportunity"],
      ["/v1/company/invoices", {accountId: acc.accountId, currency: "EUR", lineItems: lines2, idempotencyKey: "k-i"}, {currency: "USD"}, "invoice"],
      ["/v1/company/contracts", {accountId: acc.accountId, title: "MSA", idempotencyKey: "k-t"}, {title: "NDA"}, "contract"]
    ];
    for (const [url, payload, change, key] of cases) {
      const first = await post(app, url, payload);
      expect(first.statusCode, key).toBe(201);
      const replay = await post(app, url, payload);
      expect(replay.statusCode, key).toBe(200);
      expect(replay.json(), key).toEqual(first.json());
      const conflict = await post(app, url, {...payload, ...change});
      expect(conflict.statusCode, key).toBe(409);
      expect(conflict.json().error).toBe("IDEMPOTENCY_CONFLICT");
    }
    // ödeme: tekrar gönderim iki kez sayılmaz
    const inv = await issuedInvoice(app, acc.accountId);
    const p1 = await pay(app, inv.invoiceId, 10000, {idempotencyKey: "k-p"});
    const p2 = await pay(app, inv.invoiceId, 10000, {idempotencyKey: "k-p"});
    expect([p1.statusCode, p2.statusCode]).toEqual([201, 200]);
    expect(p2.json().payment.paymentId).toBe(p1.json().payment.paymentId);
    expect((await invoiceOf(app, inv.invoiceId)).paidMinor).toBe(10000);
    expect((await pay(app, inv.invoiceId, 5000, {idempotencyKey: "k-p"})).statusCode).toBe(409);
    expect((await invoiceOf(app, inv.invoiceId)).paidMinor).toBe(10000);
    // ters kayıt da idempotent
    const r1 = await post(app, "/v1/company/payments", {reversesPaymentId: p1.json().payment.paymentId, reason: "r", idempotencyKey: "k-r"});
    const r2 = await post(app, "/v1/company/payments", {reversesPaymentId: p1.json().payment.paymentId, reason: "r", idempotencyKey: "k-r"});
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 200]);
    expect((await invoiceOf(app, inv.invoiceId)).paidMinor).toBe(0);
    // aynı anahtar ödeme ve ters kayıt arasında paylaşılamaz
    expect((await post(app, "/v1/company/payments", {reversesPaymentId: p1.json().payment.paymentId, reason: "other", idempotencyKey: "k-p"})).statusCode).toBe(409);
  });
});

describe("Write gate order and fail-closed behaviour", () => {
  const writes: Array<[string, unknown]> = [
    ["/v1/company/accounts", {name: "x"}], ["/v1/company/contacts", {accountId: "acc_000000000000000000000000", name: "x"}],
    ["/v1/company/opportunities", {accountId: "acc_000000000000000000000000", title: "t", amountMinor: 1, currency: "EUR"}],
    ["/v1/company/opportunities/opp_000000000000000000000000/stage", {stage: "QUALIFIED"}],
    ["/v1/company/invoices", {accountId: "acc_000000000000000000000000", currency: "EUR", lineItems: lines2}],
    ["/v1/company/invoices/inv_000000000000000000000000/issue", undefined], ["/v1/company/invoices/inv_000000000000000000000000/void", {reason: "x"}],
    ["/v1/company/payments", {invoiceId: "inv_000000000000000000000000", amountMinor: 1, currency: "EUR"}],
    ["/v1/company/contracts", {accountId: "acc_000000000000000000000000", title: "t"}],
    ["/v1/company/contracts/ctr_000000000000000000000000/transition", {to: "SENT"}]
  ];

  it("returns 423 on every write while GLOBAL_STOP is active, GET keeps working and nothing is written", async () => {
    const app = mkApp();
    const acc = await account(app);
    fs.writeFileSync(path.join(runtime(), "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    const before = journalLines().length;
    for (const [url, payload] of writes) {
      const r = await post(app, url, payload);
      expect(r.statusCode, url).toBe(423);
      expect(r.json().error).toBe("GLOBAL_STOP_ACTIVE");
    }
    expect((await post(app, "/v1/company/accounts", {bogus: true})).statusCode).toBe(423); // geçersiz gövde de önce 423
    for (const k of ["accounts", "contacts", "opportunities", "invoices", "payments", "contracts"]) expect((await get(app, `/v1/company/${k}`)).statusCode, k).toBe(200);
    expect((await get(app, "/v1/company/accounts")).json().accounts[0].accountId).toBe(acc.accountId);
    expect(journalLines()).toHaveLength(before);
  });

  it("orders gates stop(423) -> action gateway(403) -> schema(400)", async () => {
    const app = mkApp("tA", {policyContext: {scopeAllowed: false}});
    expect((await post(app, "/v1/company/accounts", {bogus: true})).statusCode).toBe(403); // şemadan önce policy
    const r = await post(app, "/v1/company/accounts", {name: "ok"});
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("SCOPE_DENIED");
    fs.writeFileSync(path.join(runtime(), "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    expect((await post(app, "/v1/company/accounts", {name: "ok"})).statusCode).toBe(423); // policy'den önce stop
    expect(journalLines()).toHaveLength(0);
    const app2 = mkApp("tA2");
    fs.rmSync(path.join(runtime(), "GLOBAL_STOP.json"));
    expect((await post(app2, "/v1/company/accounts", {bogus: true})).statusCode).toBe(400);
    expect((await app2.inject({method: "POST", url: "/v1/company/accounts", headers: {host: "127.0.0.1:3210"}, payload: {name: "x"}})).statusCode).toBe(403); // token hook
  });

  it("fails closed with 503 on a tampered journal for reads and writes, without leaking paths", async () => {
    const app = mkApp();
    const acc = await account(app, "Acme Tamper");
    const inv = await issuedInvoice(app, acc.accountId);
    await pay(app, inv.invoiceId, 100);
    const file = journalFile();
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Acme Tamper", "Evil Tamper"));
    for (const k of ["accounts", "invoices", "payments", "contracts"]) {
      const r = await get(app, `/v1/company/${k}`);
      expect(r.statusCode, k).toBe(503);
      expect(r.json()).toEqual({error: "WORKOS_JOURNAL_TAMPERED"});
    }
    const w = await post(app, "/v1/company/accounts", {name: "after"});
    expect(w.statusCode).toBe(503);
    expect(w.json()).toEqual({error: "WORKOS_JOURNAL_TAMPERED"});
    expect(w.body).not.toContain(tmp);
    expect(w.body).not.toContain(path.basename(tmp));
  });

  it("fails closed on a forged but hash-valid journal: overpayment, unsigned SIGNED contract and wrong invoice total", () => {
    const forge = (setup: (s: WorkOsStore) => Record<string, string>, make: (ids: Record<string, string>) => {type: string; payload: Record<string, unknown>}) => {
      fs.rmSync(dataDir(), {recursive: true, force: true});
      const s = new WorkOsStore(dataDir());
      const ids = setup(s);
      const lines = journalLines().map(l => JSON.parse(l) as {seq: number; hash: string});
      const last = lines[lines.length - 1];
      const f = make(ids);
      const body = {seq: last.seq + 1, prevHash: last.hash, type: f.type, actor: "FORGER", at: new Date().toISOString(), payload: f.payload};
      fs.appendFileSync(journalFile(), JSON.stringify({...body, hash: sha256(body)}) + "\n");
      return new WorkOsStore(dataDir());
    };
    const scope = {tenantId: "tA"};
    const baseSetup = (s: WorkOsStore) => {
      const crm = new CrmDomain(s), fin = new FinanceDomain(s);
      const acc = crm.createAccount(scope, {name: "Acme"}, "T").entity;
      const inv = fin.createInvoice(scope, {accountId: acc.accountId, currency: "EUR", lineItems: lines2}, "T").entity;
      fin.issueInvoice(scope, inv.invoiceId, "T");
      return {accountId: acc.accountId, invoiceId: inv.invoiceId};
    };
    const payment = (ids: Record<string, string>, amountMinor: number) => ({
      recordKind: "payment", paymentId: `pay_${"1".repeat(24)}`, tenantId: "tA", invoiceId: ids.invoiceId, entryKind: "PAYMENT", amountMinor, currency: "EUR", receivedAt: new Date().toISOString(), createdAt: new Date().toISOString(), createdBy: "FORGER"
    });
    const over = forge(baseSetup, ids => ({type: "FIN_PAYMENT_RECORDED", payload: {entity: payment(ids, 32501)}}));
    expect(over.isTampered).toBe(true);
    expect(() => over.companyRead(() => 0)).toThrow(/TAMPERED/);
    const wrongCurrency = forge(baseSetup, ids => ({type: "FIN_PAYMENT_RECORDED", payload: {entity: {...payment(ids, 10), currency: "USD"}}}));
    expect(wrongCurrency.isTampered).toBe(true);
    const unsigned = forge(baseSetup, ids => ({type: "LEGAL_CONTRACT_CREATED", payload: {entity: {
      recordKind: "contract", contractId: `ctr_${"2".repeat(24)}`, tenantId: "tA", accountId: ids.accountId, title: "t", status: "SIGNED", sentAt: null, documentSha256: null, signerName: null, signedAt: null, closedAt: null, createdAt: "x", createdBy: "F"
    }}}));
    expect(unsigned.isTampered || unsigned.isUnavailable).toBe(true);
    const forgedTransition = forge(baseSetup, ids => ({type: "LEGAL_CONTRACT_TRANSITIONED", payload: {contractId: ids.accountId, from: "SENT", to: "SIGNED", at: new Date().toISOString(), documentSha256: HASH, signerName: "x", signedAt: new Date().toISOString()}}));
    expect(forgedTransition.isTampered).toBe(true);
    const badTotal = forge(baseSetup, ids => ({type: "FIN_INVOICE_CREATED", payload: {entity: {
      recordKind: "invoice", invoiceId: `inv_${"3".repeat(24)}`, tenantId: "tA", accountId: ids.accountId, currency: "EUR",
      lineItems: [{description: "x", quantity: 2, unitAmountMinor: 100, amountMinor: 200}], totalMinor: 1, paidMinor: 0, status: "DRAFT", number: null, issuedAt: null, voidedAt: null, createdAt: "x", createdBy: "F"
    }}}));
    expect(badTotal.isTampered).toBe(true);
    const unknownType = forge(baseSetup, () => ({type: "FIN_SOMETHING_ELSE", payload: {}}));
    expect(unknownType.isTampered).toBe(true);
  });
});

describe("Single journal, audit and Work OS compatibility", () => {
  it("company records live in the Work OS journal beside projects, rebuild after restart and create no second store", async () => {
    const app = mkApp();
    const project = (await post(app, "/v1/projects", {name: "P", environmentId: "dev"})).json().project;
    const acc = await account(app);
    const inv = await issuedInvoice(app, acc.accountId);
    await pay(app, inv.invoiceId, 12000);
    const o = (await post(app, "/v1/company/opportunities", {accountId: acc.accountId, title: "D", amountMinor: 5, currency: "EUR"})).json().opportunity;
    await post(app, `/v1/company/opportunities/${o.opportunityId}/stage`, {stage: "QUALIFIED"});
    const lines = journalLines().map(l => JSON.parse(l) as {seq: number; prevHash: string; hash: string; type: string});
    expect(lines.map(l => l.seq)).toEqual(lines.map((_, i) => i + 1));
    for (let i = 1; i < lines.length; i++) expect(lines[i].prevHash).toBe(lines[i - 1].hash);
    expect(lines.map(l => l.type)).toEqual(expect.arrayContaining(["PROJECT_CREATED", "CRM_ACCOUNT_CREATED", "FIN_INVOICE_CREATED", "FIN_INVOICE_ISSUED", "FIN_PAYMENT_RECORDED", "CRM_OPPORTUNITY_STAGED"]));
    expect(fs.readdirSync(dataDir()).every(f => ["journal.jsonl", "snapshot.json", "snapshot.json.prev", "journal.lock"].includes(f)), fs.readdirSync(dataDir()).join(",")).toBe(true);
    // yeniden başlatma: snapshot silinse bile journal'dan aynı durum yeniden kurulur
    await app.close(); apps.splice(apps.indexOf(app), 1);
    fs.rmSync(path.join(dataDir(), "snapshot.json"), {force: true}); fs.rmSync(path.join(dataDir(), "snapshot.json.prev"), {force: true});
    const app2 = mkApp();
    expect(await invoiceOf(app2, inv.invoiceId)).toMatchObject({status: "PARTIALLY_PAID", paidMinor: 12000, balanceMinor: 20500});
    expect((await get(app2, "/v1/projects")).json().projects[0].projectId).toBe(project.projectId);
    expect((await get(app2, "/v1/company/opportunities")).json().opportunities[0].stage).toBe("QUALIFIED");
    const next = await issuedInvoice(app2, acc.accountId);
    expect(next.number).toBe("INV-000002"); // numara sayacı replay ile aynen kurulur
  });

  it("audit events carry ids/status/amounts but never names or emails, and error bodies stay generic", async () => {
    const app = mkApp();
    const acc = await account(app, "Zed Unique Corp");
    const c = await post(app, "/v1/company/contacts", {accountId: acc.accountId, name: "Zed Unique Person", role: "Buyer", email: "zed.unique@example.com"});
    expect(c.statusCode).toBe(201);
    await pay(app, (await issuedInvoice(app, acc.accountId)).invoiceId, 100);
    const audit = fs.readFileSync(path.join(runtime(), "control-api-events.jsonl"), "utf8");
    expect(audit).toContain("COMPANY_CONTACT_CREATED");
    expect(audit).toContain("COMPANY_PAYMENT_RECORDED");
    for (const pii of ["Zed Unique", "zed.unique", "example.com", "Buyer"]) expect(audit, pii).not.toContain(pii);
    for (const r of [await post(app, "/v1/company/payments", {invoiceId: "inv_000000000000000000000000", amountMinor: 1, currency: "EUR"}), await get(app, "/v1/company/contacts?accountId=nope")]) {
      expect(r.body).not.toContain(tmp);
      expect(r.body).not.toMatch(/\bat .*\.(ts|js):\d+/);
      expect(r.body).not.toContain("stack");
    }
  });

  it("domain functions give the same results through the store API (restart safe, fresh instance sees the writes)", () => {
    const scope = {tenantId: "tA"};
    const s1 = new WorkOsStore(dataDir(), {now: () => Date.parse("2026-10-14T10:00:00.000Z")});
    const crm = new CrmDomain(s1), fin = new FinanceDomain(s1);
    const acc = crm.createAccount(scope, {name: "Acme"}, "T").entity;
    const inv = fin.createInvoice(scope, {accountId: acc.accountId, currency: "EUR", lineItems: lines2}, "T").entity;
    expect(inv.createdAt).toBe("2026-10-14T10:00:00.000Z");
    fin.issueInvoice(scope, inv.invoiceId, "T");
    const s2 = new WorkOsStore(dataDir());
    expect(new FinanceDomain(s2).getInvoice(scope, inv.invoiceId)).toMatchObject({status: "ISSUED", number: "INV-000001"});
    expect(new FinanceDomain(s2).getInvoice({tenantId: "tB"}, inv.invoiceId)).toBeUndefined();
    expect(() => new FinanceDomain(s2).issueInvoice({tenantId: "tB"}, inv.invoiceId, "T")).toThrow(/NOT_FOUND/);
    // domain katmanı API şemasına güvenmez: imza kanıtı olmadan SIGNED doğrudan çağrıda da reddedilir ve hiçbir şey yazılmaz
    const legal = new LegalDomain(s2);
    const c = legal.createContract(scope, {accountId: acc.accountId, title: "MSA"}, "T").entity;
    legal.transitionContract(scope, c.contractId, {to: "SENT"}, "T");
    const n = journalLines().length;
    expect(() => legal.transitionContract(scope, c.contractId, {to: "SIGNED"}, "T")).toThrow(/INVALID_INPUT/);
    expect(() => legal.transitionContract(scope, c.contractId, {to: "SIGNED", documentSha256: HASH, signerName: "A"}, "T")).toThrow(/INVALID_INPUT/);
    expect(() => legal.transitionContract(scope, c.contractId, {to: "SIGNED", documentSha256: "bad", signerName: "A", signedAt: "2026-10-01T00:00:00Z"}, "T")).toThrow(/INVALID_INPUT/);
    expect(journalLines()).toHaveLength(n);
  });
});
