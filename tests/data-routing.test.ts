// //TR: Bu test free provider'ın SECRET veriye erişemediğini, PUBLIC veride policy gereği kullanılabildiğini ve unknown runtime enum'ların fail-closed kaldığını doğrular.
import { describe, expect, it } from "vitest";
import { canRouteData } from "../core/policy/data-routing.js";
describe("data routing",()=>{
  it("denies secret to free",()=>expect(canRouteData("SECRET","FREE")).toBe(false));
  it("allows public to free",()=>expect(canRouteData("PUBLIC","FREE")).toBe(true));
  it("fails closed for unknown runtime classification",()=>expect(canRouteData("BOGUS" as never,"FREE")).toBe(false));
  it("fails closed for unknown runtime tier",()=>expect(canRouteData("PUBLIC","BOGUS" as never)).toBe(false));
});

import { routeModel, type CatalogModel, type ModelRouteRequest } from "../core/policy/model-routing.js";
import { RISK_REFUSAL } from "../core/workos/risk-admission.js";
const catalog: CatalogModel[] = [
  { id: "cheap-local", modelClass: "CHEAP", tier: "LOCAL" },
  { id: "std-sub", modelClass: "STANDARD", tier: "SUBSCRIPTION" },
  { id: "std-free", modelClass: "STANDARD", tier: "FREE" },
  { id: "senior-paid", modelClass: "SENIOR", tier: "PAID" },
  { id: "senior-sub", modelClass: "SENIOR", tier: "SUBSCRIPTION" }
];
const req = (over: Partial<ModelRouteRequest> = {}): ModelRouteRequest =>
  ({ riskLevel: "R1", dataClass: "INTERNAL", complexity: "ROUTINE", role: "BUILDER", paidAuthority: false, executorId: "exec-b", sessionId: "sess-b", ...over });
const reviewer = (over: Partial<ModelRouteRequest> = {}) => req({ role: "REVIEWER", executorId: "exec-r", sessionId: "sess-r", builder: { executorId: "exec-b", sessionId: "sess-b" }, ...over });
describe("model routing",()=>{
  it("maps complexity to class",()=>{
    expect(routeModel(req({ complexity: "MECHANICAL" }), catalog)).toMatchObject({ decision: "ROUTE", code: "ROUTED", modelClass: "CHEAP", tier: "LOCAL", modelId: "cheap-local" });
    expect(routeModel(req(), catalog)).toMatchObject({ decision: "ROUTE", modelClass: "STANDARD", modelId: "std-sub" });
    expect(routeModel(req({ complexity: "CRITICAL" }), catalog)).toMatchObject({ decision: "ROUTE", modelClass: "SENIOR", modelId: "senior-sub" });
  });
  it("fails closed on unknown, missing or malformed request fields",()=>{
    for (const bad of [null, [], "x", { ...req(), extra: 1 }, { ...req(), dataClass: "BOGUS" }, { ...req(), complexity: "HARD" }, { ...req(), role: "OWNER" },
      { ...req(), paidAuthority: "true" }, { ...req(), executorId: "" }, { ...req(), sessionId: undefined }, { ...req(), builder: { executorId: "x", sessionId: "y" } },
      reviewer({ builder: undefined }), reviewer({ builder: { executorId: "exec-b", sessionId: "" } }), reviewer({ builder: { executorId: "a", sessionId: "b", extra: 1 } as never })])
      expect(routeModel(bad, catalog)).toMatchObject({ decision: "REFUSE", code: "INVALID_REQUEST", modelId: null, tier: null, modelClass: null });
  });
  it("refuses R3/R4 and unknown risk through riskAdmitted",()=>{
    for (const riskLevel of ["R3", "R4", "R9", undefined]) expect(routeModel(req({ riskLevel: riskLevel as never }), catalog)).toMatchObject({ decision: "REFUSE", code: RISK_REFUSAL });
    for (const riskLevel of ["R0", "R1", "R2"] as const) expect(routeModel(req({ riskLevel }), catalog).decision).toBe("ROUTE");
  });
  it("fails closed on a malformed catalog",()=>{
    for (const bad of [null, {}, [{ id: "a", modelClass: "CHEAP", tier: "LOCAL", extra: 1 }], [{ id: "a", modelClass: "HUGE", tier: "LOCAL" }], [{ id: "a", modelClass: "CHEAP", tier: "GOLD" }],
      [{ id: "", modelClass: "CHEAP", tier: "LOCAL" }], [catalog[0], { ...catalog[0] }]])
      expect(routeModel(req(), bad)).toMatchObject({ decision: "REFUSE", code: "INVALID_CATALOG" });
  });
  it("gates tiers by data class only through canRouteData",()=>{
    expect(routeModel(req({ dataClass: "PUBLIC" }), catalog)).toMatchObject({ decision: "ROUTE", tier: "FREE", modelId: "std-free" });
    expect(routeModel(req({ dataClass: "CONFIDENTIAL" }), catalog)).toMatchObject({ decision: "ROUTE", tier: "SUBSCRIPTION", modelId: "std-sub" });
    expect(routeModel(req({ dataClass: "SECRET", complexity: "MECHANICAL" }), catalog)).toMatchObject({ decision: "ROUTE", tier: "LOCAL" });
    expect(routeModel(req({ dataClass: "SECRET" }), catalog)).toMatchObject({ decision: "REFUSE", code: "NO_PERMITTED_MODEL" });
  });
  it("never chooses PAID without explicit paidAuthority true",()=>{
    const paidOnly: CatalogModel[] = [{ id: "senior-paid", modelClass: "SENIOR", tier: "PAID" }];
    const refused = routeModel(req({ complexity: "CRITICAL" }), paidOnly);
    expect(refused).toMatchObject({ decision: "REFUSE", code: "NO_PERMITTED_MODEL" });
    expect(refused.reasons.join(" ")).toContain("PAID excluded");
    expect(routeModel(req({ complexity: "CRITICAL", paidAuthority: true }), paidOnly)).toMatchObject({ decision: "ROUTE", tier: "PAID", modelId: "senior-paid" });
    expect(routeModel(req({ complexity: "CRITICAL", paidAuthority: true, dataClass: "CONFIDENTIAL" }), paidOnly).decision).toBe("REFUSE");
    expect(routeModel(req({ complexity: "CRITICAL", paidAuthority: true }), catalog)).toMatchObject({ tier: "SUBSCRIPTION", modelId: "senior-sub" });
  });
  it("never downgrades CRITICAL",()=>{
    const noSenior = catalog.filter(m => m.modelClass !== "SENIOR");
    expect(routeModel(req({ complexity: "CRITICAL" }), noSenior)).toMatchObject({ decision: "REFUSE", code: "NO_PERMITTED_MODEL", modelClass: null });
    expect(routeModel(req({ complexity: "CRITICAL", dataClass: "SECRET" }), catalog)).toMatchObject({ decision: "REFUSE", code: "NO_PERMITTED_MODEL" });
  });
  it("escalates lower classes upward only, with a reason",()=>{
    const d = routeModel(req({ complexity: "MECHANICAL", dataClass: "PUBLIC" }), catalog.filter(m => m.modelClass !== "CHEAP"));
    expect(d).toMatchObject({ decision: "ROUTE", modelClass: "STANDARD", modelId: "std-free" });
    expect(d.reasons.join(" ")).toContain("escalated CHEAP -> STANDARD");
    expect(routeModel(req(), catalog.filter(m => m.modelClass === "CHEAP"))).toMatchObject({ decision: "REFUSE", code: "NO_PERMITTED_MODEL" });
    expect(routeModel(req(), catalog).reasons.join(" ")).not.toContain("escalated");
  });
  it("requires reviewer independence from the builder",()=>{
    expect(routeModel(reviewer(), catalog)).toMatchObject({ decision: "ROUTE", modelClass: "STANDARD" });
    expect(routeModel(reviewer({ executorId: "exec-b" }), catalog)).toMatchObject({ decision: "REFUSE", code: "REVIEWER_NOT_INDEPENDENT" });
    expect(routeModel(reviewer({ sessionId: "sess-b" }), catalog)).toMatchObject({ decision: "REFUSE", code: "REVIEWER_NOT_INDEPENDENT" });
  });
  it("breaks ties deterministically by cheapest tier then id, independent of catalog order",()=>{
    const tied: CatalogModel[] = [{ id: "z", modelClass: "STANDARD", tier: "SUBSCRIPTION" }, { id: "b", modelClass: "STANDARD", tier: "SUBSCRIPTION" }, { id: "a", modelClass: "STANDARD", tier: "PAID" }];
    expect(routeModel(req({ paidAuthority: true }), tied).modelId).toBe("b");
    expect(routeModel(req({ paidAuthority: true }), [...tied].reverse()).modelId).toBe("b");
    expect(routeModel(req({ paidAuthority: true, dataClass: "PUBLIC" }), [...tied, { id: "y", modelClass: "STANDARD", tier: "LOCAL" }]).modelId).toBe("y");
  });
  it("is pure: does not mutate its inputs",()=>{
    const r = reviewer(); const c = structuredClone(catalog);
    expect(routeModel(r, c)).toEqual(routeModel(r, c));
    expect(c).toEqual(catalog); expect(r).toEqual(reviewer());
  });
});
