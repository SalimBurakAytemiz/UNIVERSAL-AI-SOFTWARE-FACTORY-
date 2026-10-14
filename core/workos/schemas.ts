// //TR: Bu dosya Work OS intake route gövdeleri için sıkı (additionalProperties:false) Ajv şemalarını ve doğrulayıcı fonksiyonları sağlar.
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
// //TR: NodeNext altında CJS ajv default importu namespace olarak tiplenir; `.default` runtime ve typecheck için aynı değeri verir (strict-json-validator ile aynı desen).
const Ajv = AjvModule.default;
const addFormats = addFormatsModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
addFormats(ajv);
const name = {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"};
const text = {type: "string", minLength: 1, maxLength: 4000, pattern: "\\S"};
const key = {type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$"};

export const projectCreateSchema = {
  type: "object", additionalProperties: false, required: ["name", "environmentId"],
  properties: {
    name, environmentId: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$"}, customerId: {type: "string", minLength: 1, maxLength: 100},
    repository: {type: "object", additionalProperties: false, minProperties: 1, properties: {path: {type: "string", minLength: 1, maxLength: 1000}, url: {type: "string", minLength: 1, maxLength: 1000}}},
    idempotencyKey: key
  }
} as const;
export const missionCreateSchema = {
  type: "object", additionalProperties: false, required: ["projectId", "title", "objective", "acceptanceCriteria", "riskLevel"],
  properties: {
    projectId: {type: "string", pattern: "^prj_[0-9a-f]{24}$"}, title: name, objective: text,
    acceptanceCriteria: {type: "array", minItems: 1, maxItems: 50, items: text}, riskLevel: {enum: ["R0", "R1", "R2", "R3", "R4"]}, idempotencyKey: key
  }
} as const;
export const missionTransitionSchema = {
  type: "object", additionalProperties: false, required: ["to", "reason"],
  properties: {to: {type: "string", minLength: 1, maxLength: 64}, reason: text}
} as const;

const compile = (s: object) => { const v = ajv.compile(s); return (x: unknown): {ok: true} | {ok: false; errors: string} => v(x) ? {ok: true} : {ok: false, errors: ajv.errorsText(v.errors, {separator: " | "})}; };
export const validateProjectCreate = compile(projectCreateSchema);
export const validateMissionCreate = compile(missionCreateSchema);
export const validateMissionTransition = compile(missionTransitionSchema);
