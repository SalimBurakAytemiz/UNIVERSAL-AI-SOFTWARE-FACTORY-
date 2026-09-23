// //TR: Bu test model router'ın PUBLIC işte uygun free provider'ı seçebildiğini fakat CONFIDENTIAL veriyi free provider'a yönlendirmediğini doğrular.
import { describe, expect, it } from "vitest";
import { chooseProvider } from "../models/router/router.js";
describe("router",()=>{
  it("uses free for public",()=>{
    const x=chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:0}],"PUBLIC","summary");
    expect(x?.id).toBe("f");
  });
  it("blocks free for confidential",()=>{
    const x=chooseProvider([{id:"f",tier:"FREE",healthy:true,capabilities:["summary"],estimatedCost:0}],"CONFIDENTIAL","summary");
    expect(x).toBeUndefined();
  });
});
