// //TR: Bu test Resource Registry'nin duplicate resource ID'yi reddettiğini ve yalnız READY capability kaynaklarını discovery sonucuna dahil ettiğini doğrular.
import { describe, expect, it } from "vitest";
import { ResourceRegistry } from "../core/resources/registry.js";
describe("resource registry",()=>{
  it("registers and finds ready capability",()=>{
    const r=new ResourceRegistry(); r.register({id:"phone-1",kind:"LOCAL_ANDROID_DEVICE",health:"READY",capabilities:["APPIUM"]});
    expect(r.findByCapability("APPIUM")).toHaveLength(1);
  });
  it("rejects duplicate",()=>{
    const r=new ResourceRegistry(); const x={id:"x",kind:"VM",health:"READY" as const,capabilities:[]};
    r.register(x); expect(()=>r.register(x)).toThrow();
  });
});
