// //TR: Bu dosya görev başına model sınıfını ve maliyet katmanını saf ve fail-closed olarak seçer: R3/R4 reddedilir, veri sınıfı katmanı canRouteData ile sınırlar, PAID yalnız açık paidAuthority ile seçilir, CRITICAL asla düşürülmez ve REVIEWER builder ile aynı executor/oturumu paylaşamaz.
import type { DataClass } from "../mission/types.js";
import type { RiskLevel } from "../workos/types.js";
import { RISK_REFUSAL, riskAdmitted } from "../workos/risk-admission.js";
import { canRouteData, type CostTier } from "./data-routing.js";

export type Complexity = "MECHANICAL" | "ROUTINE" | "CRITICAL";
export type ModelClass = "CHEAP" | "STANDARD" | "SENIOR";
export type ModelRole = "BUILDER" | "REVIEWER";
export interface ExecutorIdentity { executorId: string; sessionId: string }
export interface ModelRouteRequest extends ExecutorIdentity {
  riskLevel: RiskLevel; dataClass: DataClass; complexity: Complexity; role: ModelRole; paidAuthority: boolean;
  builder?: ExecutorIdentity; // REVIEWER için zorunlu, BUILDER için yasak.
}
export interface CatalogModel { id: string; modelClass: ModelClass; tier: CostTier }
export type RouteCode = "ROUTED" | "INVALID_REQUEST" | "INVALID_CATALOG" | typeof RISK_REFUSAL | "REVIEWER_NOT_INDEPENDENT" | "NO_PERMITTED_MODEL";
export interface ModelRouteDecision {
  decision: "ROUTE" | "REFUSE"; code: RouteCode; modelClass: ModelClass | null; tier: CostTier | null; modelId: string | null; reasons: string[];
}

// Sıra önemlidir: sınıflar yalnız yukarı tırmanır, katmanlar ucuzdan pahalıya denenir.
export const MODEL_CLASS_ORDER: readonly ModelClass[] = ["CHEAP", "STANDARD", "SENIOR"];
export const COST_TIER_ORDER: readonly CostTier[] = ["LOCAL", "FREE", "SUBSCRIPTION", "PAID"];
const BASE_CLASS: Record<Complexity, ModelClass> = { MECHANICAL: "CHEAP", ROUTINE: "STANDARD", CRITICAL: "SENIOR" };
const REQUEST_KEYS = new Set(["riskLevel", "dataClass", "complexity", "role", "paidAuthority", "executorId", "sessionId", "builder"]);
const IDENTITY_KEYS = new Set(["executorId", "sessionId"]);
const MODEL_KEYS = new Set(["id", "modelClass", "tier"]);

const refuse = (code: RouteCode, reason: string): ModelRouteDecision => ({ decision: "REFUSE", code, modelClass: null, tier: null, modelId: null, reasons: [reason] });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const onlyKeys = (v: Record<string, unknown>, keys: Set<string>) => Object.keys(v).every(k => keys.has(k));
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isIdentity = (v: unknown): v is ExecutorIdentity => isRecord(v) && onlyKeys(v, IDENTITY_KEYS) && nonEmpty(v.executorId) && nonEmpty(v.sessionId);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === "string" && (values as readonly string[]).includes(v);

function requestProblem(r: unknown): string | null {
  if (!isRecord(r) || !onlyKeys(r, REQUEST_KEYS)) return "request is not a plain object with known fields";
  // Her bilinen veri sınıfı LOCAL'e izin verir; bu yüzden LOCAL reddi bilinmeyen sınıf demektir.
  if (typeof r.dataClass !== "string" || !canRouteData(r.dataClass as DataClass, "LOCAL")) return "unknown dataClass";
  if (!oneOf(r.complexity, Object.keys(BASE_CLASS) as Complexity[])) return "unknown complexity";
  if (!oneOf(r.role, ["BUILDER", "REVIEWER"] as const)) return "unknown role";
  if (typeof r.paidAuthority !== "boolean") return "paidAuthority must be boolean";
  if (!nonEmpty(r.executorId) || !nonEmpty(r.sessionId)) return "executorId and sessionId are required";
  if (r.role === "REVIEWER" ? !isIdentity(r.builder) : r.builder !== undefined) return r.role === "REVIEWER" ? "REVIEWER requires builder identity" : "BUILDER must not carry builder identity";
  return null;
}

function catalogValid(catalog: unknown): catalog is readonly CatalogModel[] {
  if (!Array.isArray(catalog)) return false;
  const ids = new Set<string>();
  for (const m of catalog) {
    if (!isRecord(m) || !onlyKeys(m, MODEL_KEYS) || !nonEmpty(m.id) || ids.has(m.id) || !oneOf(m.modelClass, MODEL_CLASS_ORDER) || !oneOf(m.tier, COST_TIER_ORDER)) return false;
    ids.add(m.id);
  }
  return true;
}

// Deterministik eşitlik bozma: önce ucuz katman (COST_TIER_ORDER), sonra id'nin kod birimi sırası (locale'den bağımsız).
const byTierThenId = (a: CatalogModel, b: CatalogModel) =>
  COST_TIER_ORDER.indexOf(a.tier) - COST_TIER_ORDER.indexOf(b.tier) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function routeModel(request: unknown, catalog: unknown): ModelRouteDecision {
  const problem = requestProblem(request);
  if (problem) return refuse("INVALID_REQUEST", problem);
  const r = request as ModelRouteRequest;
  if (!riskAdmitted(r.riskLevel)) return refuse(RISK_REFUSAL, `risk level ${String(r.riskLevel)} is not admitted`);
  if (r.role === "REVIEWER" && (r.builder!.executorId === r.executorId || r.builder!.sessionId === r.sessionId))
    return refuse("REVIEWER_NOT_INDEPENDENT", "reviewer shares the builder executor id or session id");
  if (!catalogValid(catalog)) return refuse("INVALID_CATALOG", "catalog is malformed, has unknown fields or duplicate ids");

  const permitted = (m: CatalogModel) => canRouteData(r.dataClass, m.tier) && (m.tier !== "PAID" || r.paidAuthority === true);
  const base = BASE_CLASS[r.complexity];
  const reasons: string[] = [];
  if (!r.paidAuthority && catalog.some(m => m.tier === "PAID" && canRouteData(r.dataClass, m.tier))) reasons.push("PAID excluded: no explicit paidAuthority");
  for (const modelClass of MODEL_CLASS_ORDER.slice(MODEL_CLASS_ORDER.indexOf(base))) {
    const chosen = catalog.filter(m => m.modelClass === modelClass && permitted(m)).sort(byTierThenId)[0];
    if (chosen) {
      if (modelClass !== base) reasons.push(`escalated ${base} -> ${modelClass}: no permitted ${base} model`);
      reasons.push(`complexity ${r.complexity} -> ${modelClass}; tier ${chosen.tier} permitted for ${r.dataClass}`);
      return { decision: "ROUTE", code: "ROUTED", modelClass, tier: chosen.tier, modelId: chosen.id, reasons };
    }
  }
  const none = `no permitted model at ${base} or above for ${r.dataClass}`;
  return { ...refuse("NO_PERMITTED_MODEL", none), reasons: [...reasons, none] };
}
