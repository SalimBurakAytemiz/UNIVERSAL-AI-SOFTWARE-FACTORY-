// //TR: Bu dosya Company OS journal girdilerini ilgili domain apply fonksiyonuna yönlendirir; store tek journal uygulamasını korur, domain kuralları core/company/{crm,finance,legal}.ts içinde kalır.
import {tampered} from "./common.js";
import {applyCrm} from "./crm.js";
import {applyFinance} from "./finance.js";
import {applyLegal} from "./legal.js";
import type {CompanyApplied, CompanyEntry, CompanyState} from "./types.js";

export function applyCompanyEntry(st: CompanyState, e: CompanyEntry): CompanyApplied {
  if (e.type.startsWith("CRM_")) return applyCrm(st, e);
  if (e.type.startsWith("FIN_")) return applyFinance(st, e);
  if (e.type.startsWith("LEGAL_")) return applyLegal(st, e);
  throw tampered(`UNKNOWN_TYPE:${e.seq}`);
}
