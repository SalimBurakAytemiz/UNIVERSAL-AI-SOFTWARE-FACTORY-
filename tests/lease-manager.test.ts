// //TR: Bu test aynı fiziksel execution resource'un iki Mission tarafından eşzamanlı lease edilmesini temel seviyede engellediğimizi doğrular.
import { describe, expect, it } from "vitest";
import { LeaseManager } from "../core/resources/lease-manager.js";
describe("leases",()=>{
  it("prevents simultaneous lease",()=>{
    const l=new LeaseManager(); l.acquire("phone-1","m1");
    expect(()=>l.acquire("phone-1","m2")).toThrow();
  });
});
