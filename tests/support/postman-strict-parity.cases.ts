// //TR: Bu vaka dosyası (kayıtlı tests/strict-json-validator.test.ts tarafından içe aktarılır) UASCO-T0129 kapsamında Postman post-response şablonunu GERÇEK ajv + ajv-formats ile node:vm içinde sahte pm nesnesiyle çalıştırır ve aynı sözleşme/politika/gövde tablosunda core/qa/api validateStrictJson ile AYNI kararı (şema geçerliliği, null/boş ihlal listesi, genel sonuç) verdiğini doğrular;
// ayrıca doldurucunun (renderPostmanStrictTest) bilinmeyen politika anahtarını, geçersiz şemayı/durum kodunu/başlığı ve eksik/yinelenen yer tutucuyu reddettiğini, değerleri betik kaçışı olmadan gömdüğünü ve format desteği yoksa şablonun sessizce geçmediğini sınar.
import {describe, it, expect, chai} from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {validateStrictJson, normalizeStrictPolicy, type StrictValuePolicy} from "../../core/qa/api/strict-json-validator.js";
import {renderPostmanStrictTest, PostmanStrictTestError, POSTMAN_STRICT_TEMPLATE_PATH, type PostmanStrictContract} from "../../core/qa/api/postman-strict-test.js";

const REPO = path.resolve(__dirname, "..", "..");
const TEMPLATE = fs.readFileSync(path.join(REPO, POSTMAN_STRICT_TEMPLATE_PATH), "utf8");
const realRequire = createRequire(path.join(REPO, "package.json"));
type PmResult = {name: string; pass: boolean};
// Postman sandbox'ının bu şablonun kullandığı alt kümesi: pm.test/pm.expect (chai)/pm.response; require yalnız ajv ve ajv-formats.
function runInPostman(script: string, res: {code: number; headers?: string[]; body: unknown}, opts: {formats?: boolean} = {}) {
  const results: PmResult[] = [];
  const headers = new Set((res.headers ?? []).map(h => h.toLowerCase()));
  const sandbox: Record<string, unknown> = {
    require: (m: string) => { if (m === "ajv") return realRequire("ajv"); if (m === "ajv-formats" && opts.formats !== false) return realRequire("ajv-formats"); throw new Error(`Cannot find module '${m}'`); },
    pm: {test: (name: string, fn: () => void) => { try { fn(); results.push({name, pass: true}); } catch { results.push({name, pass: false}); } }, expect: chai.expect,
      response: {code: res.code, headers: {has: (h: string) => headers.has(h.toLowerCase())}, json: () => JSON.parse(JSON.stringify(res.body))}},
  };
  vm.runInNewContext(script, sandbox, {timeout: 2000});
  const scan = sandbox.scan as (v: unknown) => string[];
  return {results, scanErrors: JSON.parse(JSON.stringify(scan(JSON.parse(JSON.stringify(res.body))))) as string[]};
}
const SCHEMA = {type: "object", additionalProperties: false, required: ["id", "email", "name", "tags", "meta", "deletedAt", "items"], properties: {
  id: {type: "integer", minimum: 1}, email: {type: "string", format: "email"}, name: {type: "string"}, tags: {type: "array", items: {type: "string"}}, meta: {type: "object"},
  deletedAt: {type: ["string", "null"]}, items: {type: "array", items: {type: "object", additionalProperties: false, required: ["note"], properties: {note: {type: "string"}}}}}};
const OK = {id: 7, email: "a@example.com", name: "Burak", tags: ["x"], meta: {k: 1}, deletedAt: "2026-11-05", items: [{note: "n1"}, {note: "n2"}]};
const CASES: Array<[string, Record<string, unknown>, StrictValuePolicy]> = [
  ["valid body", OK, {}],
  ["empty string", {...OK, name: ""}, {}],
  ["whitespace-only string (core default denies it; the old template's trimStrings default allowed it)", {...OK, name: "   "}, {}],
  ["whitespace allowed when denyWhitespaceStrings is false", {...OK, name: "   "}, {denyWhitespaceStrings: false}],
  ["empty string allowed only when both string rules are off", {...OK, name: ""}, {denyEmptyStrings: false, denyWhitespaceStrings: false}],
  ["null without an allowed path", {...OK, deletedAt: null}, {}],
  ["null on an allowed path", {...OK, deletedAt: null}, {allowNullPaths: ["$.deletedAt"]}],
  ["empty array is allowed by default", {...OK, tags: []}, {}],
  ["empty array denied", {...OK, tags: []}, {denyEmptyArrays: true}],
  ["empty array denied but allowed on its path", {...OK, tags: []}, {denyEmptyArrays: true, allowEmptyPaths: ["$.tags"]}],
  ["empty object denied", {...OK, meta: {}}, {denyEmptyObjects: true}],
  ["wildcard allowEmptyPaths", {...OK, items: [{note: "n1"}, {note: ""}]}, {allowEmptyPaths: ["$.items.*.note"]}],
  ["nested empty string reported with its path", {...OK, items: [{note: "n1"}, {note: " "}]}, {}],
  ["format violation (email)", {...OK, email: "not-an-email"}, {}],
  ["missing required property", (({id, ...rest}) => rest)(OK), {}],
  ["additional property", {...OK, extra: 1}, {}],
  ["schema and policy violations together", {...OK, email: "x", name: "", deletedAt: null}, {}],
];
const contract = (policy: StrictValuePolicy, extra: Partial<PostmanStrictContract> = {}): PostmanStrictContract => ({schema: SCHEMA, policy, requiredHeaders: ["Content-Type"], allowedStatusCodes: [200], ...extra});

export function registerPostmanStrictParityCases(): void {
  describe("UASCO-T0129 Postman strict post-response template == core/qa/api validateStrictJson (rendered by renderPostmanStrictTest, run in a pm sandbox)", () => {
    it(`${CASES.length} contract/policy/body cases: identical schema verdict, identical null/empty violation list and identical overall verdict`, () => {
      let invalid = 0;
      for (const [name, body, policy] of CASES) {
        const core = validateStrictJson(SCHEMA, body, policy);
        const pm = runInPostman(renderPostmanStrictTest(contract(policy), TEMPLATE), {code: 200, headers: ["content-type"], body});
        const byName = Object.fromEntries(pm.results.map(r => [r.name, r.pass]));
        expect(byName["JSON Schema geçerli"], name).toBe(core.schemaErrors.length === 0);
        expect(pm.scanErrors, name).toEqual(core.valuePolicyErrors);
        expect(byName["Null / empty policy geçerli"], name).toBe(core.valuePolicyErrors.length === 0);
        expect(pm.results.every(r => r.pass), name).toBe(core.valid);
        if (!core.valid) invalid++;
      }
      expect(invalid).toBeGreaterThanOrEqual(10); expect(CASES.length - invalid).toBeGreaterThanOrEqual(5);   // both verdicts are exercised
    });
    it("status and header contract checks fail independently of the body (positive control: the same body passes with an allowed status and the header present)", () => {
      const script = renderPostmanStrictTest(contract({}, {allowedStatusCodes: [200, 201], requiredHeaders: ["Content-Type", "X-Request-Id"]}), TEMPLATE);
      const pass = runInPostman(script, {code: 201, headers: ["content-type", "x-request-id"], body: OK}).results;
      expect(pass.length).toBe(5); expect(pass.every(r => r.pass)).toBe(true);
      const bad = runInPostman(script, {code: 500, headers: ["content-type"], body: OK}).results;
      expect(bad.filter(r => !r.pass).map(r => r.name)).toEqual(["Status contract ile uyumlu", "Header mevcut: X-Request-Id"]);
    });
    it("the renderer embeds exactly the core-normalized policy (same defaults) and refuses stale/unknown keys, bad schema, bad status codes, bad headers and a broken template", () => {
      expect(normalizeStrictPolicy({})).toEqual({allowNullPaths: [], allowEmptyPaths: [], denyEmptyStrings: true, denyWhitespaceStrings: true, denyEmptyArrays: false, denyEmptyObjects: false});   // the single source of the defaults
      const out = renderPostmanStrictTest(contract({allowNullPaths: ["$.deletedAt"]}), TEMPLATE);
      for (const p of ["__UASCO_SCHEMA__", "__UASCO_POLICY__", "__UASCO_REQUIRED_HEADERS__"]) expect(out).not.toContain(p);
      expect(out).toContain(`const policy = ${JSON.stringify({...normalizeStrictPolicy({allowNullPaths: ["$.deletedAt"]}), allowedStatusCodes: [200]})};`);
      expect(out).toContain(`const schema = ${JSON.stringify(SCHEMA)};`);
      const code = (f: () => unknown) => { try { f(); return "OK"; } catch (e) { return e instanceof PostmanStrictTestError ? e.code : `OTHER:${String(e)}`; } };
      expect(code(() => renderPostmanStrictTest(contract({trimStrings: true} as never), TEMPLATE))).toBe("POLICY_UNKNOWN_KEY:trimStrings");
      expect(code(() => renderPostmanStrictTest(contract({}, {schema: {type: "nope"}}), TEMPLATE))).toBe("SCHEMA_INVALID");
      expect(code(() => renderPostmanStrictTest(contract({}, {schema: {type: "object", unknownKeyword: 1}}), TEMPLATE))).toBe("SCHEMA_INVALID");   // strict mode
      for (const codes of [[], [99], [600], [200.5], ["200"]] as never[]) expect(code(() => renderPostmanStrictTest(contract({}, {allowedStatusCodes: codes}), TEMPLATE)), JSON.stringify(codes)).toBe("STATUS_CODES_INVALID");
      for (const h of ["X Bad", "", "a\nb", 5] as never[]) expect(code(() => renderPostmanStrictTest(contract({}, {requiredHeaders: [h]}), TEMPLATE)), JSON.stringify(h)).toBe("HEADERS_INVALID");
      expect(code(() => renderPostmanStrictTest(contract({}), TEMPLATE.replace("__UASCO_POLICY__", "{}")))).toBe("TEMPLATE_PLACEHOLDER___UASCO_POLICY__");
      expect(code(() => renderPostmanStrictTest(contract({}), TEMPLATE + "\n// __UASCO_SCHEMA__"))).toBe("TEMPLATE_PLACEHOLDER___UASCO_SCHEMA__");
      expect(code(() => renderPostmanStrictTest(contract({}), TEMPLATE))).toBe("OK");
    });
    it("contract text is embedded as data, never as script (a hostile description cannot add a pm.test); without format support a format schema fails closed (positive control: a format-free schema still runs)", () => {
      const hostile = {...SCHEMA, description: "*/ '); pm.test('pwned', () => {}); (' </script>   ${x}"};
      const r = runInPostman(renderPostmanStrictTest(contract({}, {schema: hostile}), TEMPLATE), {code: 200, headers: ["content-type"], body: OK});
      expect(r.results.map(x => x.name)).not.toContain("pwned"); expect(r.results.every(x => x.pass)).toBe(true);
      expect(() => runInPostman(renderPostmanStrictTest(contract({}), TEMPLATE), {code: 200, headers: ["content-type"], body: OK}, {formats: false})).toThrow(/format/i);
      const noFormat = {...SCHEMA, properties: {...SCHEMA.properties, email: {type: "string"}}};
      const ok = runInPostman(renderPostmanStrictTest(contract({}, {schema: noFormat}), TEMPLATE), {code: 200, headers: ["content-type"], body: OK}, {formats: false});
      expect(ok.results.every(x => x.pass)).toBe(true);
    });
  });
}
