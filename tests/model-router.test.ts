// //TR: Bu test model router'ın policy routing yanında provider kimliği ve maliyet girdilerini finite/non-negative olarak fail-closed doğruladığını doğrular.
import { describe, expect, it } from "vitest";
import { chooseProvider } from "../models/router/router.js";
describe("router",()=>{
  it("uses free for public",()=>{const x=chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:0}],"PUBLIC","summary");expect(x?.id).toBe("f")});
  it("blocks free for confidential",()=>{const x=chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:0}],"CONFIDENTIAL","summary");expect(x).toBeUndefined()});
  it("rejects malformed provider identity/cost",()=>{expect(()=>chooseProvider([{id:"",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:0}],"PUBLIC","summary")).toThrow();expect(()=>chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:-1}],"PUBLIC","summary")).toThrow();expect(()=>chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:Number.POSITIVE_INFINITY}],"PUBLIC","summary")).toThrow()});
});
