// //TR: Bu dosya DSK-T0008 P-B görev başı kapsamlı yetkilendirmenin saf kurallarını tanımlar (Founder kararı Q4): Founder bir mission için kapsam (izin verilen en yüksek risk), sınırlar (en çok koşu sayısı) ve bitiş zamanı belirler; bu yetki yalnız Founder POLİTİKASININ içinde olabilir (en çok 20 koşu, en çok 7 gün, risk <= mission riski) ve kapsam genişletme, harcama veya riskli eylem VERMEZ. Gerçek model koşusu (LOCAL_CLAUDE) yalnız canlı (geri alınmamış, süresi dolmamış), mission'ı kapsayan ve koşu hakkı tükenmemiş bir yetkiyle lease alır; mission'ın AUTHORIZED durumu tek başına yeterli DEĞİLDİR. Kayıt ve geri alma aynı hash zincirli journal içindedir; replay aynı kuralları yeniden uygular.
import type {RiskLevel} from "./types.js";

export const MISSION_AUTH_POLICY = Object.freeze({maxRuns: 20, maxConcurrent: 1, maxDays: 7});
export const RISK_ORDER: readonly RiskLevel[] = ["R0", "R1", "R2", "R3", "R4"];
export const AUTH_ID_RE = /^mau_[0-9a-f]{24}$/;
export interface MissionAuthorization {
  authId: string; missionId: string; tenantId: string; maxRisk: RiskLevel; maxRuns: number;
  grantedAt: string; expiresAt: string; grantedBy: string; revokedAt: string | null; revokedBy: string | null;
}
export interface MissionAuthorizationInput { maxRisk: unknown; maxRuns: unknown; expiresAt: unknown }
export type MissionAuthRefusal = "AUTH_MISSING" | "AUTH_REVOKED" | "AUTH_EXPIRED" | "AUTH_SCOPE" | "AUTH_RUNS_EXHAUSTED";
const DAY_MS = 86_400_000;
const isRisk = (x: unknown): x is RiskLevel => typeof x === "string" && (RISK_ORDER as readonly string[]).includes(x);

/** Grant input check against the policy at grant time `nowMs`. Returns the normalised fields or a fixed error code. */
export function validateGrant(input: MissionAuthorizationInput, missionRisk: RiskLevel, nowMs: number): {ok: true; maxRisk: RiskLevel; maxRuns: number; expiresAt: string} | {ok: false; error: string} {
  const x = input && typeof input === "object" ? input : ({} as MissionAuthorizationInput);
  if (!isRisk(x.maxRisk)) return {ok: false, error: "INVALID_RISK"};
  if (RISK_ORDER.indexOf(x.maxRisk) > RISK_ORDER.indexOf(missionRisk)) return {ok: false, error: "ABOVE_MISSION_RISK"}; // no over-broad grant
  if (RISK_ORDER.indexOf(x.maxRisk) < RISK_ORDER.indexOf(missionRisk)) return {ok: false, error: "BELOW_MISSION_RISK"}; // would never cover this mission
  if (!Number.isSafeInteger(x.maxRuns) || (x.maxRuns as number) < 1) return {ok: false, error: "INVALID_MAX_RUNS"};
  if ((x.maxRuns as number) > MISSION_AUTH_POLICY.maxRuns) return {ok: false, error: "MAX_RUNS_ABOVE_POLICY"};
  const exp = typeof x.expiresAt === "string" ? Date.parse(x.expiresAt) : NaN;
  if (!Number.isFinite(exp)) return {ok: false, error: "INVALID_EXPIRY"};
  if (exp <= nowMs) return {ok: false, error: "EXPIRY_IN_PAST"};
  if (exp - nowMs > MISSION_AUTH_POLICY.maxDays * DAY_MS) return {ok: false, error: "EXPIRY_ABOVE_POLICY"};
  return {ok: true, maxRisk: x.maxRisk, maxRuns: x.maxRuns as number, expiresAt: new Date(exp).toISOString()};
}
/** Replay shape check (time-independent: expiry relative to its own grant time). */
export function validRecord(a: unknown): a is MissionAuthorization {
  const r = a as Partial<MissionAuthorization> | null;
  if (!r || typeof r !== "object" || !AUTH_ID_RE.test(String(r.authId)) || typeof r.missionId !== "string" || typeof r.tenantId !== "string" || !isRisk(r.maxRisk)) return false;
  if (!Number.isSafeInteger(r.maxRuns) || (r.maxRuns as number) < 1 || (r.maxRuns as number) > MISSION_AUTH_POLICY.maxRuns) return false;
  const g = Date.parse(String(r.grantedAt)), e = Date.parse(String(r.expiresAt));
  if (!Number.isFinite(g) || !Number.isFinite(e) || e <= g || e - g > MISSION_AUTH_POLICY.maxDays * DAY_MS) return false;
  return typeof r.grantedBy === "string" && r.revokedAt === null && r.revokedBy === null;
}
/**
 * The runner's decision for one real-model run of `mission` at `nowMs`: null = covered; otherwise a fixed refusal.
 * startedUnder: runs of this mission whose first lease is at/after the grant (already counted against maxRuns).
 */
export function authorizationRefusal(auth: MissionAuthorization | undefined, missionRisk: RiskLevel, nowMs: number, startedUnder: number, alreadyStarted: boolean): MissionAuthRefusal | null {
  if (!auth) return "AUTH_MISSING";
  if (auth.revokedAt !== null) return "AUTH_REVOKED";
  if (Date.parse(auth.expiresAt) <= nowMs) return "AUTH_EXPIRED";
  if (RISK_ORDER.indexOf(missionRisk) > RISK_ORDER.indexOf(auth.maxRisk)) return "AUTH_SCOPE";
  if (!alreadyStarted && startedUnder >= auth.maxRuns) return "AUTH_RUNS_EXHAUSTED";
  return null;
}
