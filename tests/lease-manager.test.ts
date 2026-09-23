// //TR: Bu test aynı fiziksel execution resource'un iki Mission tarafından eşzamanlı lease edilmesini ve malformed identity/TTL girdilerini engellediğimizi doğrular.
import { describe, expect, it } from "vitest";
import { LeaseManager } from "../core/resources/lease-manager.js";
describe("leases",()=>{
  it("prevents simultaneous lease",()=>{const l=new LeaseManager();l.acquire("phone-1","m1");expect(()=>l.acquire("phone-1","m2")).toThrow()});
  it("rejects invalid identity and ttl",()=>{const l=new LeaseManager();expect(()=>l.acquire("","m1")).toThrow();expect(()=>l.acquire("x","m1",0)).toThrow();expect(()=>l.acquire("x","m1",Number.NaN)).toThrow();expect(()=>l.acquire("x","m1",Number.POSITIVE_INFINITY)).toThrow()});
});
