// //TR: Bu dosya CLOUD-T0012 staging/production ayrımını (ayrı uç nokta, ayrık anahtar kimlikleri, farklı secret'lar), oturum anahtarı rotasyonunu (örtüşen keyId penceresi, sabit-zamanlı doğrulama), sağlık durumunu ve production'a yalnız yetkili terfi kapısını fail-closed olarak uygular; hiçbir altyapı açmaz, ağ çağrısı yapmaz.
import {createHash, timingSafeEqual} from "node:crypto";
import type {CloudEnvironment} from "../../../../core/cloud/contracts.js";
import {MAX_SESSION_TTL_MS, resolveCloudRuntimeConfig, verifySession, type CloudRuntimeConfig, type CloudSession} from "./remote-gateway.js";

const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MIN_SECRET_BYTES = 32;
const digest = (s: string | Buffer): Buffer => createHash("sha256").update(s).digest();
const byteLen = (s: string | Buffer): number => typeof s === "string" ? Buffer.byteLength(s, "utf8") : s.byteLength;
/** Sabit-zamanlı eşitlik: iki secret'ın özetleri karşılaştırılır (uzunluk sızmaz). */
export function secretsEqual(a: string | Buffer, b: string | Buffer): boolean { return timingSafeEqual(digest(a), digest(b)); }

// ---------- key ring with overlapping rotation ----------
export type KeyState = "ACTIVE" | "VERIFY_ONLY";
interface RingEntry {keyId: string; secret: string | Buffer; state: KeyState; verifyUntil: number | null}
export type RotationDeny = "KEY_ID_INVALID" | "KEY_ID_REUSED" | "KEY_TOO_SHORT" | "KEY_REUSED" | "OVERLAP_INVALID";

/**
 * Bir ortamın oturum anahtar halkası. Her an tek ACTIVE (imzalayan) anahtar vardır.
 * rotate(): yeni anahtar ACTIVE olur, eskisi `overlapMs` boyunca VERIFY_ONLY kalır (canlı oturumlar düşmez), sonra halkadan düşer.
 * Önerilen örtüşme = MAX_SESSION_TTL_MS (12 saat): rotasyondan önce verilmiş en uzun oturum da doğal süresinde biter.
 * Kullanılmış keyId ya da secret tekrar kullanılamaz (rollback için bile; geri dönüş yeni keyId ile yapılır).
 */
export class SessionKeyRing {
  private readonly entries: RingEntry[] = [];
  private readonly usedIds = new Set<string>();
  private readonly usedDigests: Buffer[] = [];
  private constructor(readonly environment: CloudEnvironment) {}

  static create(environment: CloudEnvironment, keyId: string, secret: string | Buffer): SessionKeyRing {
    const ring = new SessionKeyRing(environment);
    const err = ring.admit(keyId, secret); if (err) throw new Error(err);
    ring.entries.push({keyId, secret, state: "ACTIVE", verifyUntil: null});
    return ring;
  }

  private admit(keyId: string, secret: string | Buffer): RotationDeny | null {
    if (typeof keyId !== "string" || !KEY_ID_RE.test(keyId)) return "KEY_ID_INVALID";
    if (this.usedIds.has(keyId)) return "KEY_ID_REUSED";
    if ((typeof secret !== "string" && !Buffer.isBuffer(secret)) || byteLen(secret) < MIN_SECRET_BYTES) return "KEY_TOO_SHORT";
    const d = digest(secret);
    if (this.usedDigests.some(u => timingSafeEqual(u, d))) return "KEY_REUSED";
    this.usedIds.add(keyId); this.usedDigests.push(d);
    return null;
  }

  rotate(keyId: string, secret: string | Buffer, now: Date, overlapMs: number = MAX_SESSION_TTL_MS): {ok: true; retiredKeyId: string; verifyUntil: string} | {ok: false; reason: RotationDeny} {
    if (!Number.isSafeInteger(overlapMs) || overlapMs < 60_000 || overlapMs > 2 * MAX_SESSION_TTL_MS) return {ok: false, reason: "OVERLAP_INVALID"};
    const err = this.admit(keyId, secret); if (err) return {ok: false, reason: err};
    this.prune(now);
    const prev = this.entries.find(e => e.state === "ACTIVE")!;
    prev.state = "VERIFY_ONLY"; prev.verifyUntil = now.getTime() + overlapMs;
    this.entries.push({keyId, secret, state: "ACTIVE", verifyUntil: null});
    return {ok: true, retiredKeyId: prev.keyId, verifyUntil: new Date(prev.verifyUntil).toISOString()};
  }

  /** Acil iptal (sızıntı): anahtar örtüşme beklemeden düşer. ACTIVE anahtar iptal edilemez; önce rotate edilir. */
  revoke(keyId: string): boolean {
    const i = this.entries.findIndex(e => e.keyId === keyId && e.state === "VERIFY_ONLY");
    if (i === -1) return false;
    this.entries.splice(i, 1); return true;
  }

  private prune(now: Date): void {
    for (let i = this.entries.length - 1; i >= 0; i--) { const e = this.entries[i]!; if (e.state === "VERIFY_ONLY" && now.getTime() >= e.verifyUntil!) this.entries.splice(i, 1); }
  }

  signingKey(): {keyId: string; secret: string | Buffer} { const a = this.entries.find(e => e.state === "ACTIVE")!; return {keyId: a.keyId, secret: a.secret}; }

  /** verifySession için doğrulama anahtarları: ACTIVE + süresi dolmamış VERIFY_ONLY. */
  verificationKeys(now: Date): ReadonlyMap<string, string | Buffer> {
    return new Map(this.entries.filter(e => e.state === "ACTIVE" || now.getTime() < e.verifyUntil!).map(e => [e.keyId, e.secret] as const));
  }

  /** Secret içermeyen durum özeti (UI/log için). */
  describe(now: Date): Array<{keyId: string; state: KeyState; verifyUntil?: string}> {
    return this.entries.filter(e => e.state === "ACTIVE" || now.getTime() < e.verifyUntil!)
      .map(e => e.state === "ACTIVE" ? {keyId: e.keyId, state: e.state} : {keyId: e.keyId, state: e.state, verifyUntil: new Date(e.verifyUntil!).toISOString()});
  }

  /** @internal ayrım denetimi için: halkadaki tüm (geçmiş dahil) keyId ve secret özetleri. */
  footprint(): {ids: ReadonlySet<string>; digests: readonly Buffer[]} { return {ids: this.usedIds, digests: this.usedDigests}; }

  verify(token: unknown, now: Date, revoked?: ReadonlySet<string>) { return verifySession(token, this.verificationKeys(now), now, revoked); }
}

// ---------- staging / production separation ----------
export interface EnvironmentDeployment {env: Readonly<Record<string, string | undefined>>; keys: SessionKeyRing}
export type SeparationDeny =
  | "STAGING_NOT_CONFIGURED" | "PRODUCTION_NOT_CONFIGURED" | "ENVIRONMENT_MISLABELLED" | "ENDPOINT_SHARED" | "KEY_ID_SHARED" | "SECRET_SHARED" | "KEYRING_ENVIRONMENT_MISMATCH";

/** İki ortam tamamen ayrık olmalıdır: farklı host, ayrık keyId kümeleri, ortak secret yok. Herhangi bir belirsizlik reddir. */
export function checkEnvironmentSeparation(staging: EnvironmentDeployment, production: EnvironmentDeployment):
  {ok: true; staging: CloudRuntimeConfig; production: CloudRuntimeConfig} | {ok: false; reason: SeparationDeny} {
  const s = resolveCloudRuntimeConfig(staging.env), p = resolveCloudRuntimeConfig(production.env);
  if (!s.ok) return {ok: false, reason: "STAGING_NOT_CONFIGURED"};
  if (!p.ok) return {ok: false, reason: "PRODUCTION_NOT_CONFIGURED"};
  // Ortam belirtilmezse resolveCloudRuntimeConfig "staging" kabul eder; production tarafı bu yüzden açıkça "production" olmalıdır.
  if (s.config.environment !== "staging" || p.config.environment !== "production")
    return {ok: false, reason: "ENVIRONMENT_MISLABELLED"};
  if (staging.keys.environment !== "staging" || production.keys.environment !== "production") return {ok: false, reason: "KEYRING_ENVIRONMENT_MISMATCH"};
  const host = (u: URL) => u.hostname.toLowerCase().replace(/\.+$/, "");
  if (host(s.config.endpoint) === host(p.config.endpoint)) return {ok: false, reason: "ENDPOINT_SHARED"};
  const sf = staging.keys.footprint(), pf = production.keys.footprint();
  for (const id of sf.ids) if (pf.ids.has(id)) return {ok: false, reason: "KEY_ID_SHARED"};
  let shared = false;   // sabit-zamanlı: erken çıkış yok
  for (const a of sf.digests) for (const b of pf.digests) shared = timingSafeEqual(a, b) || shared;
  if (shared) return {ok: false, reason: "SECRET_SHARED"};
  return {ok: true, staging: s.config, production: p.config};
}

// ---------- health ----------
export type HealthState = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";
export interface HealthProbe {readonly name: string; readonly critical: boolean; check(signal: AbortSignal): Promise<{ok: boolean; detail?: string}>}
export interface HealthReport {environment: CloudEnvironment | null; state: HealthState; checkedAt: string; probes: Array<{name: string; ok: boolean; critical: boolean; detail?: string}>}

/**
 * Sağlık: önce çalışma zamanı yapılandırması (yoksa UNHEALTHY), sonra en az bir anahtar, sonra sondalar.
 * Sonda yoksa UNKNOWN (sağlıklı sayılmaz). Kritik sonda düşerse UNHEALTHY, kritik olmayan düşerse DEGRADED.
 * Zaman aşımı/hata sonda başarısızlığıdır; detay redakte edilir (ör. CloudGateway.redact).
 */
export async function evaluateHealth(o: {env: Readonly<Record<string, string | undefined>>; keys: SessionKeyRing; probes: readonly HealthProbe[];
  now: Date; timeoutMs?: number; redact?: (s: string) => string}): Promise<HealthReport> {
  const checkedAt = o.now.toISOString();
  const redact = o.redact ?? ((_: string) => "[REDACTED]");   // redaktör verilmezse ayrıntı hiç gösterilmez
  const rt = resolveCloudRuntimeConfig(o.env);
  if (!rt.ok) return {environment: null, state: "UNHEALTHY", checkedAt, probes: [{name: "runtime-config", ok: false, critical: true, detail: rt.reason}]};
  const environment = rt.config.environment;
  if (o.keys.environment !== environment) return {environment, state: "UNHEALTHY", checkedAt, probes: [{name: "session-keys", ok: false, critical: true, detail: "KEYRING_ENVIRONMENT_MISMATCH"}]};
  const timeoutMs = o.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) throw new Error("HEALTH_TIMEOUT_INVALID");
  if (o.probes.length === 0) return {environment, state: "UNKNOWN", checkedAt, probes: []};
  const results = await Promise.all(o.probes.map(async p => {
    const ctl = new AbortController(); let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { rej(new Error("HEALTH_PROBE_TIMEOUT")); ctl.abort(); }, timeoutMs); });
      const r = await Promise.race([p.check(ctl.signal), timeout]);
      const ok = r?.ok === true;
      return {name: p.name, ok, critical: p.critical !== false, ...(r?.detail ? {detail: redact(String(r.detail))} : {})};
    } catch (e) {
      return {name: p.name, ok: false, critical: p.critical !== false, detail: redact(e instanceof Error ? e.message : String(e))};
    } finally { if (timer) clearTimeout(timer); }
  }));
  const state: HealthState = results.some(r => !r.ok && r.critical) ? "UNHEALTHY" : results.some(r => !r.ok) ? "DEGRADED" : "HEALTHY";
  return {environment, state, checkedAt, probes: results};
}

// ---------- promotion gate (staging -> production) ----------
export interface StagingEvidence {artifactSha256: string; stagingHealth: HealthReport; smokePassed: boolean; smokeAt: string}
export type PromotionDeny =
  | SeparationDeny | "ARTIFACT_INVALID" | "STAGING_EVIDENCE_MISMATCH" | "STAGING_UNHEALTHY" | "STAGING_SMOKE_FAILED" | "STAGING_EVIDENCE_STALE"
  | "DEPLOY_SESSION_INVALID" | "DEPLOY_SESSION_EXPIRED" | "DEPLOY_NOT_FOUNDER";
export const MAX_STAGING_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Production'a terfi yalnız: ayrım geçerli + aynı artifact SHA için staging HEALTHY + smoke PASS (≤24 saat) +
 * production anahtar halkasıyla doğrulanan FOUNDER oturumu. Staging oturumu production'da geçmez (ayrık anahtarlar).
 * Bu fonksiyon bir karar döndürür; dağıtımı kendisi yapmaz (gerçek altyapı D-03/D-29 kapsamındadır).
 */
export function evaluatePromotion(o: {staging: EnvironmentDeployment; production: EnvironmentDeployment; artifactSha256: string;
  evidence: StagingEvidence; deployToken: unknown; now: Date; revoked?: ReadonlySet<string>}):
  {ok: true; approvedBy: string; artifactSha256: string} | {ok: false; reason: PromotionDeny} {
  const sep = checkEnvironmentSeparation(o.staging, o.production);
  if (!sep.ok) return sep;
  if (typeof o.artifactSha256 !== "string" || !SHA256_RE.test(o.artifactSha256)) return {ok: false, reason: "ARTIFACT_INVALID"};
  const ev = o.evidence;
  if (!ev || ev.artifactSha256 !== o.artifactSha256) return {ok: false, reason: "STAGING_EVIDENCE_MISMATCH"};
  if (ev.stagingHealth?.environment !== "staging" || ev.stagingHealth.state !== "HEALTHY") return {ok: false, reason: "STAGING_UNHEALTHY"};
  if (ev.smokePassed !== true) return {ok: false, reason: "STAGING_SMOKE_FAILED"};
  const at = Date.parse(ev.smokeAt), hAt = Date.parse(ev.stagingHealth.checkedAt), n = o.now.getTime();
  if (!Number.isFinite(at) || !Number.isFinite(hAt) || at > n + 60_000 || hAt > n + 60_000 || n - at > MAX_STAGING_EVIDENCE_AGE_MS || n - hAt > MAX_STAGING_EVIDENCE_AGE_MS)
    return {ok: false, reason: "STAGING_EVIDENCE_STALE"};
  const v = o.production.keys.verify(o.deployToken, o.now, o.revoked);
  if (!v.ok) return {ok: false, reason: v.reason === "SESSION_EXPIRED" ? "DEPLOY_SESSION_EXPIRED" : "DEPLOY_SESSION_INVALID"};
  const s: CloudSession = v.session;
  if (!s.roles.includes("FOUNDER")) return {ok: false, reason: "DEPLOY_NOT_FOUNDER"};
  return {ok: true, approvedBy: s.subject, artifactSha256: o.artifactSha256};
}
