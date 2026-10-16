// //TR: Bu test F1 bulgusunu (güvenlik test kapsamı) kapatır: UX-INT-1'de eklenen GET /v1/company/* salt-okunur izin listesini (apps/desktop/main.mjs B4-ALLOWLIST) ve POST izin listesini (B5-POST-ALLOWLIST) korumalı dosyadan izole olarak değerlendirip saldırgan girdilere karşı fail-closed olduğunu doğrular: altı çıplak yol kabul edilir; accounts hiçbir sorgu kabul etmez; contacts/opportunities/invoices/contracts tam olarak bir ?accountId=acc_<24hex> ve payments ?invoiceId=inv_<24hex> kabul eder; yinelenen/bilinmeyen anahtar, boş sorgu, yanlış önek/büyük-küçük harf, sondaki eğik çizgi, alt yol ve her /v1/company/* yola POST reddedilir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string, ret: string, ...params: string[]) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return new Function(...params, `${m![1]}\nreturn ${ret};`)() as (v: unknown) => boolean;
};

const ACC = "acc_" + "ab".repeat(12);          // acc_ + 24 hex
const INV = "inv_" + "cd".repeat(12);          // inv_ + 24 hex
const COMPANY = ["accounts", "contacts", "opportunities", "invoices", "payments", "contracts"] as const;
const ACCOUNT_QUERY = ["contacts", "opportunities", "invoices", "contracts"] as const;

describe("F1 — GET /v1/company/* read-only allow-list is fail-closed (B4/B5 evaluated in isolation)", () => {
  const get = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed");
  const post = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed");

  it("accepts exactly the six bare company list paths", () => {
    for (const k of COMPANY) expect(get(`/v1/company/${k}`), k).toBe(true);
  });

  it("accounts rejects ANY query string (it takes no parameters)", () => {
    for (const q of [`?accountId=${ACC}`, `?invoiceId=${INV}`, "?x=1", "?", "?limit=1", `?accountId=${ACC}&x=1`])
      expect(get(`/v1/company/accounts${q}`), q).toBe(false);
  });

  it("contacts/opportunities/invoices/contracts accept exactly one ?accountId=acc_<24hex>", () => {
    for (const k of ACCOUNT_QUERY) {
      expect(get(`/v1/company/${k}?accountId=${ACC}`), k).toBe(true);
      // invoiceId is not a valid key for these resources
      expect(get(`/v1/company/${k}?invoiceId=${INV}`), `${k}-invoiceId`).toBe(false);
    }
  });

  it("payments accepts exactly one ?invoiceId=inv_<24hex> and not accountId", () => {
    expect(get(`/v1/company/payments?invoiceId=${INV}`)).toBe(true);
    expect(get(`/v1/company/payments?accountId=${ACC}`)).toBe(false);
  });

  it("rejects duplicate keys, unknown keys and empty query on query-bearing paths", () => {
    const bad = [
      `/v1/company/contacts?accountId=${ACC}&accountId=${ACC}`, // duplicate
      `/v1/company/contacts?accountId=${ACC}&x=1`,              // unknown extra
      "/v1/company/contacts?foo=bar",                           // unknown only
      "/v1/company/contacts?",                                  // empty query
      "/v1/company/contacts?=",                                 // empty key+value
      `/v1/company/payments?invoiceId=${INV}&invoiceId=${INV}`, // duplicate
      `/v1/company/payments?invoiceId=${INV}&accountId=${ACC}`  // mixed/unknown
    ];
    for (const p of bad) expect(get(p), p).toBe(false);
  });

  it("rejects wrong id prefix, wrong case, wrong length and non-hex ids", () => {
    const bad = [
      `/v1/company/contacts?accountId=${ACC.toUpperCase()}`,    // upper-case prefix+hex
      `/v1/company/contacts?accountId=ACC_${"ab".repeat(12)}`,  // upper prefix
      `/v1/company/contacts?accountId=acc_${"ab".repeat(11)}`,  // 22 hex (short)
      `/v1/company/contacts?accountId=acc_${"ab".repeat(13)}`,  // 26 hex (long)
      `/v1/company/contacts?accountId=xcc_${"ab".repeat(12)}`,  // wrong prefix
      `/v1/company/contacts?accountId=acc_${"ag".repeat(12)}`,  // non-hex 'g'
      `/v1/company/payments?invoiceId=acc_${"ab".repeat(12)}`   // wrong prefix for payments
    ];
    for (const p of bad) expect(get(p), p).toBe(false);
  });

  it("rejects trailing slashes and sub-paths under every company resource", () => {
    for (const k of COMPANY) {
      expect(get(`/v1/company/${k}/`), `${k}/`).toBe(false);
      expect(get(`/v1/company/${k}/acc_${"ab".repeat(12)}`), `${k}/sub`).toBe(false);
    }
    expect(get(`/v1/company/contacts/?accountId=${ACC}`)).toBe(false);
    expect(get("/v1/company")).toBe(false);
    expect(get("/v1/company/")).toBe(false);
    expect(get("/v1/company/unknown")).toBe(false);
  });

  it("never allows a write (POST) to any /v1/company/* path", () => {
    for (const k of COMPANY) {
      expect(post(`/v1/company/${k}`), `POST ${k}`).toBe(false);
      expect(post(`/v1/company/${k}?accountId=${ACC}`), `POST ${k}?q`).toBe(false);
    }
    expect(post(`/v1/company/payments?invoiceId=${INV}`)).toBe(false);
  });
});
