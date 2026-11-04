// //TR: UASCO-T0062 / V3-AC-F026-1: routeModel çekirdeğinin her adım için model id + routing kararını journal/Desktop'a uygun tek kayda dönüştürdüğünü gerçek kodla doğrular (sahte katalog, ağ/sağlayıcı/ücret yok).
import {describe,it,expect} from "vitest";
import {routeModel,routeModelStep,modelRoutingRecord,modelRoutingDesktopLine,type CatalogModel,type ModelRouteRequest} from "../../core/policy/model-routing.js";
import {chooseProvider} from "../../models/router/router.js";

const catalog:CatalogModel[]=[
  {id:"cheap-local",modelClass:"CHEAP",tier:"LOCAL"},
  {id:"std-sub",modelClass:"STANDARD",tier:"SUBSCRIPTION"},
  {id:"senior-paid",modelClass:"SENIOR",tier:"PAID"},
];
const req=(over:Partial<ModelRouteRequest>={}):ModelRouteRequest=>
  ({riskLevel:"R1",dataClass:"INTERNAL",complexity:"ROUTINE",role:"BUILDER",paidAuthority:false,executorId:"exec-b",sessionId:"sess-b",...over});

export function registerModelRouterCases():void{
  describe("UASCO-T0062 routeModel core: model id + routing decision record per step (V3-AC-F026-1)",()=>{
    it("every step yields a record carrying the chosen model id and the decision",()=>{
      const steps=[{id:"step-1",r:req({complexity:"MECHANICAL"})},{id:"step-2",r:req()},{id:"step-3",r:req({complexity:"CRITICAL"})}];
      const recs=steps.map(s=>routeModelStep(s.id,s.r,catalog));
      expect(recs.map(x=>x.record.stepId)).toEqual(["step-1","step-2","step-3"]);
      expect(recs[0]!.record).toMatchObject({kind:"MODEL_ROUTING_DECISION",decision:"ROUTE",code:"ROUTED",modelId:"cheap-local",modelClass:"CHEAP",tier:"LOCAL"});
      expect(recs[1]!.record).toMatchObject({decision:"ROUTE",modelId:"std-sub",tier:"SUBSCRIPTION"});
      // CRITICAL + no paidAuthority: refusal is recorded too, never silent.
      expect(recs[2]!.record).toMatchObject({decision:"REFUSE",code:"NO_PERMITTED_MODEL",modelId:null});
      expect(recs[2]!.record.reasons).toContain("PAID excluded: no explicit paidAuthority");
      for(const x of recs)expect(x.record).toMatchObject({decision:x.decision.decision,code:x.decision.code,modelId:x.decision.modelId});
    });
    it("record equals the routeModel decision, is deterministic, frozen and JSON-serialisable for the journal",()=>{
      const d=routeModel(req(),catalog);
      const a=modelRoutingRecord("s",d),b=modelRoutingRecord("s",d);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.parse(JSON.stringify(a))).toEqual({kind:"MODEL_ROUTING_DECISION",stepId:"s",decision:"ROUTE",code:"ROUTED",modelId:"std-sub",modelClass:"STANDARD",tier:"SUBSCRIPTION",reasons:d.reasons});
      expect(Object.isFrozen(a)&&Object.isFrozen(a.reasons)).toBe(true);
      d.reasons.push("later mutation");
      expect(a.reasons).not.toContain("later mutation");
      expect(JSON.stringify(a)).not.toMatch(/exec-b|sess-b/);
    });
    it("Desktop line names the step, model id and decision",()=>{
      expect(modelRoutingDesktopLine(routeModelStep("step-2",req(),catalog).record)).toBe("step-2: ROUTE std-sub (STANDARD/SUBSCRIPTION)");
      const refused=modelRoutingDesktopLine(routeModelStep("step-9",req({riskLevel:"R3"}),catalog).record);
      expect(refused.startsWith("step-9: REFUSE ")).toBe(true);
      expect(refused).toContain("R3");
    });
    it("fails closed on a missing step id or an inconsistent decision",()=>{
      for(const id of ["",undefined,"  ",7])expect(()=>routeModelStep(id,req(),catalog)).toThrow();
      const d=routeModel(req(),catalog);
      expect(()=>modelRoutingRecord("s",{...d,modelId:null})).toThrow();
      expect(()=>modelRoutingRecord("s",{...d,code:"NO_PERMITTED_MODEL"})).toThrow();
      expect(()=>modelRoutingRecord("s",{...routeModel(req({riskLevel:"R4"}),catalog),modelId:"x"})).toThrow();
    });
    it("regression: provider router keeps local-first cost order and never picks PAID without allowPaid",()=>{
      const c=[{id:"p",tier:"PAID" as const,healthy:true,capabilities:["code"],estimatedCost:0},{id:"s",tier:"SUBSCRIPTION" as const,healthy:true,capabilities:["code"],estimatedCost:5},{id:"l",tier:"LOCAL" as const,healthy:false,capabilities:["code"],estimatedCost:0}];
      expect(chooseProvider(c,"INTERNAL","code")?.id).toBe("s");
      expect(chooseProvider([c[0]!],"INTERNAL","code")).toBeUndefined();
    });
  });
}
