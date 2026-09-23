// //TR: Bu test Ajv schema validation ile factory strict null/empty policy'nin required/type/null/empty alanlarda gerçekten hata verdiğini ve explicit null exception'ı kabul ettiğini doğrular.
import { describe, expect, it } from "vitest";
import { validateStrictJson } from "../core/qa/api/strict-json-validator.js";
const schema={type:"object",additionalProperties:false,required:["id","name","deletedAt"],properties:{id:{type:"integer",minimum:1},name:{type:"string",minLength:1},deletedAt:{type:["string","null"]}}};
describe("strict api json",()=>{
 it("rejects empty and null by default",()=>{const r=validateStrictJson(schema,{id:1,name:"",deletedAt:null});expect(r.valid).toBe(false);expect(r.valuePolicyErrors.length).toBeGreaterThan(0)});
 it("allows explicit nullable path",()=>{const r=validateStrictJson(schema,{id:1,name:"Burak",deletedAt:null},{allowNullPaths:["$.deletedAt"]});expect(r.valid).toBe(true)});
});
