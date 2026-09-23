// //TR: Bu test Mission state machine'in normal geçişi kabul edip DRAFT'tan doğrudan COMPLETE gibi kanıtsız atlamayı reddettiğini doğrular.
import { describe, expect, it } from "vitest";
import { canTransition, assertTransition } from "../core/mission/state-machine.js";
describe("mission state",()=>{
  it("allows planned execution",()=>expect(canTransition("PLANNED","EXECUTING")).toBe(true));
  it("blocks fake completion",()=>expect(()=>assertTransition("DRAFT","COMPLETE")).toThrow());
});
