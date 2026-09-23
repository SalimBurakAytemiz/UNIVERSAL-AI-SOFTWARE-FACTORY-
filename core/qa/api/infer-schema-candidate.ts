// //TR: Bu dosya yalnız contract bulunamadığında sample response'tan aday JSON Schema çıkarır; üretilen schema açıkça INFERRED_CANDIDATE olarak işaretlenir ve otomatik expected contract sayılmaz.
export interface InferredSchemaCandidate { provenance:"INFERRED_CANDIDATE_NOT_CONTRACT"; schema: Record<string,unknown> }
function infer(value: unknown): Record<string,unknown> {
  if (value===null) return { not:{type:"null"}, "$comment":"Observed null; strict policy requires human/contract decision instead of accepting it." };
  if (Array.isArray(value)) return {type:"array",items:value.length?infer(value[0]):{},minItems:value.length?1:0};
  if (typeof value==='object') { const o=value as Record<string,unknown>; const keys=Object.keys(o); return {type:"object",additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(k=>[k,infer(o[k])]))}; }
  if (typeof value==='string') return {type:"string",minLength:value.length?1:0};
  if (typeof value==='number') return {type:Number.isInteger(value)?"integer":"number"};
  if (typeof value==='boolean') return {type:"boolean"};
  return {};
}
export function inferSchemaCandidate(sample: unknown): InferredSchemaCandidate { return {provenance:"INFERRED_CANDIDATE_NOT_CONTRACT",schema:infer(sample)}; }
