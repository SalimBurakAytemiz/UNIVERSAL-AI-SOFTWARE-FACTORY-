// //TR: Bu test free provider'ın SECRET veriye erişemediğini, PUBLIC veride policy gereği kullanılabildiğini ve unknown runtime enum'ların fail-closed kaldığını doğrular.
import { describe, expect, it } from "vitest";
import { canRouteData } from "../core/policy/data-routing.js";
describe("data routing",()=>{
  it("denies secret to free",()=>expect(canRouteData("SECRET","FREE")).toBe(false));
  it("allows public to free",()=>expect(canRouteData("PUBLIC","FREE")).toBe(true));
  it("fails closed for unknown runtime classification",()=>expect(canRouteData("BOGUS" as never,"FREE")).toBe(false));
  it("fails closed for unknown runtime tier",()=>expect(canRouteData("PUBLIC","BOGUS" as never)).toBe(false));
});
