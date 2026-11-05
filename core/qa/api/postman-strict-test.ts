// //TR: UASCO-T0129 Bu dosya Postman post-response şablonunun (templates/postman/strict-ajv-post-response.js) yer tutucularını ONAYLI bir sözleşmeden doldurur; politika core/qa/api/strict-json-validator.ts ile AYNI anahtarlar ve AYNI varsayılanlarla normalize edilir (tek doğruluk kaynağı).
// Saf işlevdir (I/O yok): şablon metni çağırandan gelir. Bilinmeyen politika anahtarı (eski "trimStrings" dahil), derlenemeyen şema, geçersiz durum kodu/başlık ya da şablonda tam bir kez bulunmayan yer tutucu reddedilir; değerler JSON olarak gömülür (betik kaçışı yok).
import { normalizeStrictPolicy, strictSchemaCompiles, type StrictSchema, type StrictValuePolicy } from "./strict-json-validator.js";

export const POSTMAN_STRICT_TEMPLATE_PATH = "templates/postman/strict-ajv-post-response.js";
export const POSTMAN_STRICT_PLACEHOLDERS = Object.freeze(["__UASCO_SCHEMA__", "__UASCO_POLICY__", "__UASCO_REQUIRED_HEADERS__"] as const);
export interface PostmanStrictContract { schema: StrictSchema; policy?: StrictValuePolicy; requiredHeaders?: string[]; allowedStatusCodes: number[] }
export class PostmanStrictTestError extends Error { constructor(readonly code: string) { super(code); this.name = "PostmanStrictTestError"; } }
const POLICY_KEYS: ReadonlySet<string> = new Set(["allowNullPaths", "allowEmptyPaths", "denyEmptyStrings", "denyWhitespaceStrings", "denyEmptyArrays", "denyEmptyObjects"]);
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export function renderPostmanStrictTest(contract: PostmanStrictContract, templateSource: string): string {
  const fail = (code: string): never => { throw new PostmanStrictTestError(code); };
  if (typeof templateSource !== "string") fail("TEMPLATE_MISSING");
  for (const p of POSTMAN_STRICT_PLACEHOLDERS) if (templateSource.split(p).length !== 2) fail(`TEMPLATE_PLACEHOLDER_${p}`);
  const policy = contract.policy ?? {};
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) fail("POLICY_INVALID");
  for (const k of Object.keys(policy)) if (!POLICY_KEYS.has(k)) fail(`POLICY_UNKNOWN_KEY:${k}`);
  const codes = contract.allowedStatusCodes;
  if (!Array.isArray(codes) || codes.length === 0 || !codes.every(c => Number.isInteger(c) && c >= 100 && c <= 599)) fail("STATUS_CODES_INVALID");
  const headers = contract.requiredHeaders ?? [];
  if (!Array.isArray(headers) || !headers.every(h => typeof h === "string" && HEADER.test(h))) fail("HEADERS_INVALID");
  if (!strictSchemaCompiles(contract.schema)) fail("SCHEMA_INVALID");
  const values: Record<string, unknown> = {
    __UASCO_SCHEMA__: contract.schema,
    __UASCO_POLICY__: { ...normalizeStrictPolicy(policy), allowedStatusCodes: [...codes] },
    __UASCO_REQUIRED_HEADERS__: [...headers],
  };
  let out = templateSource;
  for (const p of POSTMAN_STRICT_PLACEHOLDERS) out = out.split(p).join(JSON.stringify(values[p]));
  return out;
}
