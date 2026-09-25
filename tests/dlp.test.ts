// //TR: Bu test model/report egress öncesi credential pattern'inin ve invalid runtime input'un DLP tarafından fail-closed engellendiğini doğrular.
import {describe,it,expect} from "vitest";
import {assertNoSensitiveEgress,scanDlp} from "../core/policy/dlp.js";
describe("DLP",()=>{
  it("detects generic secret",()=>expect(scanDlp('api_'+'key="'+'abcdefghijklmnop'+'"').length).toBeGreaterThan(0));
  it("blocks sensitive egress",()=>expect(()=>assertNoSensitiveEgress("Bearer "+"abcdefghijklmnopqrstuvwxyz123")).toThrow());
  it("fails closed on non-string runtime input",()=>expect(()=>scanDlp(null as unknown as string)).toThrow(/DLP_INPUT_INVALID/));
});
