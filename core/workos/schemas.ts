// //TR: Bu dosya Work OS intake route gövdeleri için sıkı (additionalProperties:false) Ajv şemalarını ve doğrulayıcı fonksiyonları sağlar.
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import {urlHasUserinfo} from "./types.js";
// //TR: NodeNext altında CJS ajv default importu namespace olarak tiplenir; `.default` runtime ve typecheck için aynı değeri verir (strict-json-validator ile aynı desen).
const Ajv = AjvModule.default;
const addFormats = addFormatsModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
addFormats(ajv);
const name = {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"};
const text = {type: "string", minLength: 1, maxLength: 4000, pattern: "\\S"};
const key = {type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$"};
// //TR: B3a: test komutu shell string değil argv dizisidir; ilk öğe allowlist'teki bir çalıştırılabilir addır (yol/uzantı yok), argümanlarda NUL/satır sonu yoktur.
export const TEST_COMMAND_EXECUTABLES: readonly string[] = ["node", "npm", "npx", "pnpm", "yarn", "python", "pytest", "go", "cargo", "dotnet", "mvn", "gradle"];
const testCommand = {type: "array", minItems: 1, maxItems: 32, items: {type: "string", minLength: 1, maxLength: 1000, pattern: "^[^\\u0000\\r\\n]*$"}};
export function testCommandAllowed(argv: unknown): argv is string[] {
  return Array.isArray(argv) && argv.length >= 1 && argv.length <= 32 && argv.every(a => typeof a === "string" && a.length > 0 && a.length <= 1000 && !/[\u0000\r\n]/.test(a))
    && TEST_COMMAND_EXECUTABLES.includes(argv[0]);
}

export const projectCreateSchema = {
  type: "object", additionalProperties: false, required: ["name", "environmentId"],
  properties: {
    name, environmentId: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$"}, customerId: {type: "string", minLength: 1, maxLength: 100},
    repository: {type: "object", additionalProperties: false, minProperties: 1, properties: {path: {type: "string", minLength: 1, maxLength: 1000}, url: {type: "string", minLength: 1, maxLength: 1000}}},
    idempotencyKey: key, testCommand,
    // PS-1A Project Studio (hepsi isteğe bağlı; template ile repository birlikte verilemez).
    template: {enum: ["web-node", "node-lib", "empty"]}, projectType: {enum: ["web", "api", "library", "cli", "desktop", "mobile", "native", "other"]},
    techStack: {type: "array", maxItems: 20, uniqueItems: true, items: {type: "string", minLength: 1, maxLength: 50, pattern: "^[A-Za-z0-9.+#/ _-]+$"}},
    targetOS: {type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: {enum: ["windows", "macos", "linux", "web", "android", "ios"]}},
    acceptanceCriteria: {type: "array", minItems: 1, maxItems: 50, items: text},
    budget: {type: "object", additionalProperties: false, minProperties: 1, properties: {maxRuns: {type: "integer", minimum: 1, maximum: 10000}, maxTokens: {type: "integer", minimum: 1, maximum: 10000000000}}},
    devCommand: testCommand
  }
} as const;
export const missionCreateSchema = {
  type: "object", additionalProperties: false, required: ["projectId", "title", "objective", "acceptanceCriteria", "riskLevel"],
  properties: {
    projectId: {type: "string", pattern: "^prj_[0-9a-f]{24}$"}, title: name, objective: text,
    acceptanceCriteria: {type: "array", minItems: 1, maxItems: 50, items: text}, riskLevel: {enum: ["R0", "R1", "R2", "R3", "R4"]}, idempotencyKey: key, testCommand
  }
} as const;
export const runStartSchema = {
  type: "object", additionalProperties: false,
  properties: {idempotencyKey: key, roleId: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._:-]+$"}}
} as const;
// //TR: REL-FX c4 (S1): acknowledgement yalnız to=COMPLETE ile geçerlidir (route ayrıca denetler); açık true ve TEST_SURFACE kanıt logunun sha256'sı (64 küçük hex) ister.
export const missionTransitionSchema = {
  type: "object", additionalProperties: false, required: ["to", "reason"],
  properties: {
    to: {type: "string", minLength: 1, maxLength: 64}, reason: text,
    acknowledgement: {type: "object", additionalProperties: false, required: ["acknowledgeTestChanges", "testSurfaceSha256"],
      properties: {acknowledgeTestChanges: {const: true}, testSurfaceSha256: {type: "string", pattern: "^[0-9a-f]{64}$"}}},
    // M1a: NOT_EXECUTED onayı; yalnız to=COMPLETE ile (route ayrıca denetler), açık true ve run.headSha (40 küçük hex).
    notExecutedAcknowledgement: {type: "object", additionalProperties: false, required: ["acknowledgeNotExecuted", "headSha"],
      properties: {acknowledgeNotExecuted: {const: true}, headSha: {type: "string", pattern: "^[0-9a-f]{40}$"}}}
  }
} as const;

const compile = (s: object) => { const v = ajv.compile(s); return (x: unknown): {ok: true} | {ok: false; errors: string} => v(x) ? {ok: true} : {ok: false, errors: ajv.errorsText(v.errors, {separator: " | "})}; };
const validateProjectShape = compile(projectCreateSchema);
// //TR: F-B1-004: userinfo içeren repository.url (user:pass@host, token@host) şema düzeyinde reddedilir; secret journal'a veya audit'e girmez.
export const validateProjectCreate = (x: unknown): {ok: true} | {ok: false; errors: string} => {
  const r = validateProjectShape(x);
  if (!r.ok) return r;
  const url = (x as {repository?: {url?: string}}).repository?.url;
  if (url !== undefined && urlHasUserinfo(url)) return {ok: false, errors: "repository.url must not contain credentials"};
  const b = x as {template?: unknown; repository?: unknown; devCommand?: unknown};
  if (b.template !== undefined && b.repository !== undefined) return {ok: false, errors: "template and repository are mutually exclusive"};
  if (b.devCommand !== undefined && !testCommandAllowed(b.devCommand)) return {ok: false, errors: `devCommand[0] must be one of ${TEST_COMMAND_EXECUTABLES.join(",")}`};
  return withTestCommand(x, r);
};
function withTestCommand(x: unknown, r: {ok: true}): {ok: true} | {ok: false; errors: string} {
  const tc = (x as {testCommand?: unknown}).testCommand;
  return tc !== undefined && !testCommandAllowed(tc) ? {ok: false, errors: `testCommand[0] must be one of ${TEST_COMMAND_EXECUTABLES.join(",")}`} : r;
}
const validateMissionShape = compile(missionCreateSchema);
export const validateMissionCreate = (x: unknown): {ok: true} | {ok: false; errors: string} => { const r = validateMissionShape(x); return r.ok ? withTestCommand(x, r) : r; };
export const validateRunStart = compile(runStartSchema);
export const validateMissionTransition = compile(missionTransitionSchema);

// //TR: PS-1A Project Studio route gövdeleri: içe aktarma yalnız yerel yol alır (uzak URL bu pakette reddedilir), export yalnız commit seçer, gövdesiz yazma route'ları boş nesne kabul eder.
export const projectImportSchema = {
  type: "object", additionalProperties: false, required: ["kind", "path"],
  properties: {kind: {enum: ["git", "zip"]}, path: {type: "string", minLength: 1, maxLength: 1000, pattern: "^[^\\u0000\\r\\n]*$"}}
} as const;
export const projectExportSchema = {type: "object", additionalProperties: false, properties: {commit: {type: "string", pattern: "^(HEAD|[0-9a-f]{7,40})$"}}} as const;
export const emptyBodySchema = {type: "object", additionalProperties: false, properties: {}} as const;
export const validateProjectImport = compile(projectImportSchema);
export const validateProjectExport = compile(projectExportSchema);
export const validateEmptyBody = compile(emptyBodySchema);
// //TR: REL-FX-4 onaylı yırtık kuyruk onarımı: kullanıcı kuyruğun tam sha256 değerini aynen onaylamalıdır.
export const tornTailRepairSchema = {type: "object", additionalProperties: false, required: ["confirmTailSha256"], properties: {confirmTailSha256: {type: "string", pattern: "^[0-9a-f]{64}$"}}} as const;
export const validateTornTailRepair = compile(tornTailRepairSchema);
