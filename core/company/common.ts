// //TR: Bu dosya Company OS domain modülleri için ortak doğrulama yardımcılarını, hata üreticilerini ve sıkı Ajv derleyicisini sağlar; hata mesajları yalnız sabit kod taşır (değer, yol veya PII yok).
import crypto from "node:crypto";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import {WorkOsError} from "../workos/types.js";
import {findSecretKinds} from "../workos/secret-scan.js";
import type {CompanyRecord} from "./types.js";

// //TR: NodeNext altında CJS ajv default importu namespace olarak tiplenir; `.default` runtime ve typecheck için aynı değeri verir (workos/schemas ile aynı desen).
const Ajv = AjvModule.default;
const addFormats = addFormatsModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
addFormats(ajv);
export type Validation = {ok: true} | {ok: false; errors: string};
export const compileSchema = (s: object) => { const v = ajv.compile(s); return (x: unknown): Validation => v(x) ? {ok: true} : {ok: false, errors: ajv.errorsText(v.errors, {separator: " | "})}; };

export const tampered = (d: string) => new WorkOsError("WORKOS_JOURNAL_TAMPERED", d);
export const malformed = (d: string) => new WorkOsError("WORKOS_UNAVAILABLE", d);
export const invalid = (d: string) => new WorkOsError("WORKOS_INVALID_INPUT", d);
export const conflict = (d: string) => new WorkOsError("WORKOS_CONFLICT", d);
export const notFound = (d: string) => new WorkOsError("WORKOS_NOT_FOUND", d);
export const badTransition = (d: string) => new WorkOsError("WORKOS_INVALID_TRANSITION", d);

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
export const isMinor = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export const isPosMinor = (x: unknown): x is number => isMinor(x) && x > 0;
export const isCurrency = (x: unknown): x is string => typeof x === "string" && /^[A-Z]{3}$/.test(x);
export const isSha256 = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
export const isTime = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
export const digestOf = (x: unknown): string => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");

// Ortak şema parçaları.
export const nameSchema = {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"} as const;
export const reasonSchema = {type: "string", minLength: 1, maxLength: 1000, pattern: "\\S"} as const;
export const keySchema = {type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$"} as const;
export const currencySchema = {type: "string", pattern: "^[A-Z]{3}$"} as const;
export const minorSchema = {type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER} as const;
export const idSchema = (prefix: string) => ({type: "string", pattern: `^${prefix}_[0-9a-f]{24}$`}) as const;

// Serbest metin alanlarında secret benzeri değer reddedilir (değer hiçbir zaman hata mesajına girmez).
export function noSecrets(...vals: Array<string | undefined>): void {
  for (const v of vals) if (v !== undefined && findSecretKinds(v).length > 0) throw invalid("SECRET_LIKE_VALUE");
}

// Replay yardımcıları: kayıt var mı, doğru tür ve tenant'ta mı; değilse journal tutarsızdır (fail-closed).
export function ownedRecord<K extends CompanyRecord["recordKind"]>(records: Readonly<Record<string, CompanyRecord>>, id: unknown, kind: K, tenantId: string, seq: number): Extract<CompanyRecord, {recordKind: K}> {
  const r = isStr(id) ? records[id] : undefined;
  if (!r || r.recordKind !== kind || r.tenantId !== tenantId) throw tampered(`COMPANY_REF:${seq}`);
  return r as Extract<CompanyRecord, {recordKind: K}>;
}
// Yazma tarafı: tenant dışı veya yanlış türde kayıt "bulunamadı" görünür (tenant sızıntısı yok).
export function scopedRecord<K extends CompanyRecord["recordKind"]>(records: Readonly<Record<string, CompanyRecord>>, id: string, kind: K, tenantId: string, label: string): Extract<CompanyRecord, {recordKind: K}> {
  const r = records[id];
  if (!r || r.recordKind !== kind || r.tenantId !== tenantId) throw notFound(label);
  return r as Extract<CompanyRecord, {recordKind: K}>;
}
export function listScoped<K extends CompanyRecord["recordKind"]>(records: Readonly<Record<string, CompanyRecord>>, kind: K, tenantId: string): Array<Extract<CompanyRecord, {recordKind: K}>> {
  return Object.values(records).filter(r => r.recordKind === kind && r.tenantId === tenantId) as Array<Extract<CompanyRecord, {recordKind: K}>>;
}
export const clone = <T>(x: T): T => structuredClone(x);
