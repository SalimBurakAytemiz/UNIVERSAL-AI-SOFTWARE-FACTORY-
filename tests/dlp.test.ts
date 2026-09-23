// //TR: Bu test model/report egress öncesi örnek credential pattern'inin DLP tarafından engellendiğini doğrular.
import {describe,it,expect} from "vitest";
import {assertNoSensitiveEgress,scanDlp} from "../core/policy/dlp.js";
describe("DLP",()=>{
  it("detects generic secret",()=>expect(scanDlp('api_key="abcdefghijklmnop"').length).toBeGreaterThan(0));
  it("blocks sensitive egress",()=>expect(()=>assertNoSensitiveEgress("Bearer abcdefghijklmnopqrstuvwxyz123")).toThrow());
});
