// //TR: Bu test Mission state machine'in normal geçişi kabul edip DRAFT'tan doğrudan COMPLETE gibi kanıtsız atlamayı reddettiğini doğrular.
import { describe, expect, it } from "vitest";
import { canTransition, assertTransition } from "../core/mission/state-machine.js";
describe("mission state",()=>{
  it("allows planned execution",()=>expect(canTransition("PLANNED","EXECUTING")).toBe(true));
  it("blocks fake completion",()=>expect(()=>assertTransition("DRAFT","COMPLETE")).toThrow());
  it("forces blocked missions back through preflight",()=>{expect(canTransition("BLOCKED","PREFLIGHT")).toBe(true);expect(canTransition("BLOCKED","EXECUTING")).toBe(false);expect(canTransition("FOUNDER_ATTENTION_REQUIRED","EXECUTING")).toBe(false);});
});
