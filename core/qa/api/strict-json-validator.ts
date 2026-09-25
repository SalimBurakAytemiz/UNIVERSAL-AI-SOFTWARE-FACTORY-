// //TR: Bu dosya API QA için Ajv JSON Schema validation ile recursive null/empty policy kontrolünü birleştiren gerçek Day-0 reusable validator runtime'ını sağlar.
import AjvModule, { type AnySchema, type ErrorObject } from "ajv";
import addFormatsModule from "ajv-formats";
// //TR: NodeNext altında CJS ajv/ajv-formats default importu module.exports namespace'i olarak tiplenir; her iki paket de `.default` self-reference taşıdığından runtime ve typecheck aynı değeri görür.
const Ajv = AjvModule.default;
const addFormats = addFormatsModule.default;

export interface StrictValuePolicy {
  allowNullPaths?: string[];
  allowEmptyPaths?: string[];
  denyEmptyStrings?: boolean;
  denyWhitespaceStrings?: boolean;
  denyEmptyArrays?: boolean;
  denyEmptyObjects?: boolean;
}
export interface StrictValidationResult {
  valid: boolean;
  schemaErrors: ErrorObject[];
  valuePolicyErrors: string[];
}
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
function matches(path: string, patterns: string[] = []): boolean {
  const b=path.split('.');
  return patterns.some(p=>{const a=p.split('.'); return a.length===b.length && a.every((x,i)=>x==='*'||x===b[i]);});
}
function scan(value: unknown, path: string, p: Required<StrictValuePolicy>, errors: string[]): void {
  if (value === null) { if (!matches(path,p.allowNullPaths)) errors.push(`${path}: null forbidden`); return; }
  if (typeof value === 'string') {
    const empty=value.length===0; const ws=value.trim().length===0;
    if (((p.denyEmptyStrings&&empty)||(p.denyWhitespaceStrings&&ws))&&!matches(path,p.allowEmptyPaths)) errors.push(`${path}: empty string forbidden`);
    return;
  }
  if (Array.isArray(value)) {
    if (p.denyEmptyArrays&&value.length===0&&!matches(path,p.allowEmptyPaths)) errors.push(`${path}: empty array forbidden`);
    value.forEach((v,i)=>scan(v,`${path}.${i}`,p,errors)); return;
  }
  if (typeof value === 'object' && value) {
    const entries=Object.entries(value as Record<string,unknown>);
    if (p.denyEmptyObjects&&entries.length===0&&!matches(path,p.allowEmptyPaths)) errors.push(`${path}: empty object forbidden`);
    for (const [k,v] of entries) scan(v,`${path}.${k}`,p,errors);
  }
}
export function validateStrictJson(schema: AnySchema, data: unknown, policy: StrictValuePolicy = {}): StrictValidationResult {
  const normalized: Required<StrictValuePolicy>={allowNullPaths:policy.allowNullPaths??[],allowEmptyPaths:policy.allowEmptyPaths??[],denyEmptyStrings:policy.denyEmptyStrings??true,denyWhitespaceStrings:policy.denyWhitespaceStrings??true,denyEmptyArrays:policy.denyEmptyArrays??false,denyEmptyObjects:policy.denyEmptyObjects??false};
  const validate=ajv.compile(schema); const schemaValid=validate(data); const valuePolicyErrors:string[]=[];
  scan(data,'$',normalized,valuePolicyErrors);
  return {valid:Boolean(schemaValid)&&valuePolicyErrors.length===0,schemaErrors:[...(validate.errors??[])],valuePolicyErrors};
}
