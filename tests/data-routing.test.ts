// //TR: Bu test free provider'ın SECRET veriye erişemediğini ve PUBLIC veride policy gereği kullanılabildiğini doğrular.
import { describe, expect, it } from "vitest";
import { canRouteData } from "../core/policy/data-routing.js";
describe("data routing",()=>{
  it("denies secret to free",()=>expect(canRouteData("SECRET","FREE")).toBe(false));
  it("allows public to free",()=>expect(canRouteData("PUBLIC","FREE")).toBe(true));
});
