// //TR: Bu dosya CLOUD-T0012 staging/production ayrımını (ayrı uç nokta, ayrık anahtar kimlikleri, farklı secret'lar), oturum anahtarı rotasyonunu (örtüşen keyId penceresi, sabit-zamanlı doğrulama), sağlık durumunu ve production'a yalnız yetkili terfi kapısını fail-closed olarak uygular; hiçbir altyapı açmaz, ağ çağrısı yapmaz.
import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import type {CloudEnvironment} from "../../../../core/cloud/contracts.js";
import {MAX_SESSION_TTL_MS, resolveCloudRuntimeConfig, verifySession, type CloudRuntimeConfig, type CloudSession} from "./remote-gateway.js";

const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MIN_SECRET_BYTES = 32;
const digest = (s: string | Buffer): Buffer => createHash("sha256").update(s).digest();
const byteLen = (s: string | Buffer): number => typeof s === "string" ? Buffer.byteLength(s, "utf8") : s.byteLength;
/** Buffer secret'lar kopyalanır: çağıran Buffer'ı sonradan değiştirse/sıfırlasa da halka ve özet geçmişi tutarlı kalır. */
const ownCopy = (s: string | Buffer): string | Buffer => typeof s === "string" ? s : Buffer.from(s);
/** Sabit-zamanlı eşitlik: iki secret'ın özetleri karşılaştırılır (uzunluk sızmaz). */
export function secretsEqual(a: string | Buffer, b: string | Buffer): boolean { return timingSafeEqual(digest(a), digest(b)); }

// ---------- key ring with overlapping rotation ----------
export type KeyState = "ACTIVE" | "VERIFY_ONLY";
interface RingEntry {keyId: string; secret: string | Buffer; state: KeyState; verifyUntil: number | null}
export type RotationDeny = "KEY_ID_INVALID" | "KEY_ID_REUSED" | "KEY_TOO_SHORT" | "KEY_REUSED" | "OVERLAP_INVALID" | "CLOCK_SKEW" | "CLOCK_REGRESSED";
/** Güvenilen sunucu saati ile çağıranın `now` değeri arasında izin verilen en büyük fark. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export interface KeyRingOptions {
  /** Güvenilen sunucu saati (ms). Verilirse rotate() ve doğrulama, bu saatten MAX_CLOCK_SKEW_MS'den fazla sapan `now` değerini reddeder. Production'da zorunlu tutulmalıdır (runbook §1). */
  readonly clock?: () => number;
}

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
  /** Son başarılı rotasyonun zamanı: geriye giden `now` ile rotasyon reddedilir (CLOCK_REGRESSED). */
  private lastRotationAt = Number.NEGATIVE_INFINITY;
  private constructor(readonly environment: CloudEnvironment, private readonly clock?: () => number) {}

  static create(environment: CloudEnvironment, keyId: string, secret: string | Buffer, options: KeyRingOptions = {}): SessionKeyRing {
    if (options.clock !== undefined && typeof options.clock !== "function") throw new Error("CLOCK_INVALID");
    const ring = new SessionKeyRing(environment, options.clock);
    const err = ring.admit(keyId, secret); if (err) throw new Error(err);
    ring.entries.push({keyId, secret: ownCopy(secret), state: "ACTIVE", verifyUntil: null});
    return ring;
  }

  /** Güvenilen saat varsa `now` ondan en çok MAX_CLOCK_SKEW_MS sapabilir; saat okunamazsa ya da sayı değilse sapma kabul edilir (fail-closed). */
  private skewed(now: Date): boolean {
    const t = now instanceof Date ? now.getTime() : NaN;
    if (!Number.isFinite(t)) return true;
    if (this.clock === undefined) return false;
    let c: number; try { c = this.clock(); } catch { return true; }
    return !Number.isFinite(c) || Math.abs(t - c) > MAX_CLOCK_SKEW_MS;
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
    if (this.skewed(now)) return {ok: false, reason: "CLOCK_SKEW"};
    if (now.getTime() < this.lastRotationAt) return {ok: false, reason: "CLOCK_REGRESSED"};
    const err = this.admit(keyId, secret); if (err) return {ok: false, reason: err};
    this.prune(now); this.lastRotationAt = now.getTime();
    const prev = this.entries.find(e => e.state === "ACTIVE")!;
    prev.state = "VERIFY_ONLY"; prev.verifyUntil = now.getTime() + overlapMs;
    this.entries.push({keyId, secret: ownCopy(secret), state: "ACTIVE", verifyUntil: null});
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
    if (this.skewed(now)) return new Map();   // sapmış saat: hiçbir anahtar doğrulamaz (fail-closed)
    return new Map(this.entries.filter(e => e.state === "ACTIVE" || now.getTime() < e.verifyUntil!).map(e => [e.keyId, e.secret] as const));
  }

  /** Secret içermeyen durum özeti (UI/log için). */
  describe(now: Date): Array<{keyId: string; state: KeyState; verifyUntil?: string}> {
    return this.entries.filter(e => e.state === "ACTIVE" || now.getTime() < e.verifyUntil!)
      .map(e => e.state === "ACTIVE" ? {keyId: e.keyId, state: e.state} : {keyId: e.keyId, state: e.state, verifyUntil: new Date(e.verifyUntil!).toISOString()});
  }

  /** @internal ayrım denetimi için: halkadaki tüm (geçmiş dahil) keyId ve secret özetleri. */
  footprint(): {ids: ReadonlySet<string>; digests: readonly Buffer[]} { return {ids: this.usedIds, digests: this.usedDigests}; }

  /** @internal dağıtım onayı doğrulaması için: halkada şu an geçerli olan bir keyId'nin secret'ı. */
  keyFor(keyId: string, now: Date): string | Buffer | undefined { return this.verificationKeys(now).get(keyId); }

  verify(token: unknown, now: Date, revoked?: ReadonlySet<string>) { return verifySession(token, this.verificationKeys(now), now, revoked); }
}

// ---------- staging / production separation ----------
export interface EnvironmentDeployment {env: Readonly<Record<string, string | undefined>>; keys: SessionKeyRing}
export type SeparationDeny =
  | "STAGING_NOT_CONFIGURED" | "PRODUCTION_NOT_CONFIGURED" | "ENVIRONMENT_MISLABELLED" | "ENDPOINT_SHARED" | "ENDPOINT_NON_PUBLIC" | "KEY_ID_SHARED" | "SECRET_SHARED" | "KEYRING_ENVIRONMENT_MISMATCH";

const ipv4Num = (h: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if (!m) return null;
  const o = m.slice(1).map(Number); if (o.some(x => x > 255)) return null;
  return ((o[0]! << 24) >>> 0) + (o[1]! << 16) + (o[2]! << 8) + o[3]!;
};
/** WHATWG URL IPv6'yı zaten kanonik (küçük harf, sıkıştırılmış) yazar; tek fark IPv4-eşlemeli biçimdir, o IPv4'e indirgenir. */
export function canonicalHost(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.+$/, "");
  const m = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(h) ?? /^\[::ffff:(\d+\.\d+\.\d+\.\d+)\]$/.exec(h);
  if (m && m.length === 3) { const n = (parseInt(m[1]!, 16) << 16 >>> 0) + parseInt(m[2]!, 16); return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."); }
  if (m) return m[1]!;
  return h;
}
const V4_NON_PUBLIC: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 3],
];
const NON_PUBLIC_SUFFIX = [".internal", ".local", ".localhost", ".home.arpa", ".lan", ".intranet", ".corp"];
/**
 * Production uç noktası için çevrimdışı denetim: özel/bağlantı-yerel/CGNAT/metadata/belgelendirme/çoklu yayın IP sabitleri
 * ve iç ağ ad uzantıları reddedilir. DNS çözülmez (ağ yok): genel bir adın özel IP'ye çözülmesi burada yakalanamaz (runbook §1).
 */
export function isNonPublicHost(hostname: string): boolean {
  const h = canonicalHost(hostname);
  const n = ipv4Num(h);
  if (n !== null) return V4_NON_PUBLIC.some(([base, bits]) => ((n >>> (32 - bits)) << (32 - bits)) >>> 0 === base);
  if (h.startsWith("[")) {
    const v6 = h.slice(1, -1);
    if (v6 === "::" || v6 === "::1") return true;
    const first = parseInt((v6.split(":")[0] || "0"), 16);
    if (v6.startsWith("::")) return true;                                   // :: ile başlayan (uyumlu/eşlemeli kalıntı) adresler genel değildir
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || v6.startsWith("2001:db8:") || v6.startsWith("64:ff9b:");
  }
  if (h === "localhost" || h === "metadata" || h === "metadata.google.internal") return true;
  return NON_PUBLIC_SUFFIX.some(sfx => h.endsWith(sfx)) || !h.includes(".");
}

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
  if (canonicalHost(s.config.endpoint.hostname) === canonicalHost(p.config.endpoint.hostname)) return {ok: false, reason: "ENDPOINT_SHARED"};
  if (isNonPublicHost(p.config.endpoint.hostname)) return {ok: false, reason: "ENDPOINT_NON_PUBLIC"};
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
export interface HealthReport {environment: CloudEnvironment | null; state: HealthState; checkedAt: string; artifactSha256?: string; probes: Array<{name: string; ok: boolean; critical: boolean; detail?: string}>}

/**
 * Sağlık: önce çalışma zamanı yapılandırması (yoksa UNHEALTHY), sonra en az bir anahtar, sonra sondalar.
 * Sonda yoksa UNKNOWN (sağlıklı sayılmaz). Kritik sonda düşerse UNHEALTHY, kritik olmayan düşerse DEGRADED.
 * Zaman aşımı/hata sonda başarısızlığıdır; detay redakte edilir (ör. CloudGateway.redact).
 */
export async function evaluateHealth(o: {env: Readonly<Record<string, string | undefined>>; keys: SessionKeyRing; probes: readonly HealthProbe[];
  now: Date; timeoutMs?: number; redact?: (s: string) => string; artifactSha256?: string}): Promise<HealthReport> {
  const checkedAt = o.now.toISOString();
  // Redaktör verilmezse ayrıntı hiç gösterilmez; redaktör hata atarsa (ör. bağlanmamış gw.redact) rapor yine üretilir, ayrıntı gizlenir.
  const redact = (s: string): string => { if (!o.redact) return "[REDACTED]"; try { return String(o.redact(s)); } catch { return "[REDACTED]"; } };
  if (o.artifactSha256 !== undefined && (typeof o.artifactSha256 !== "string" || !SHA256_RE.test(o.artifactSha256))) throw new Error("HEALTH_ARTIFACT_INVALID");
  const tag = o.artifactSha256 ? {artifactSha256: o.artifactSha256} : {};
  const rt = resolveCloudRuntimeConfig(o.env);
  if (!rt.ok) return {environment: null, state: "UNHEALTHY", checkedAt, ...tag, probes: [{name: "runtime-config", ok: false, critical: true, detail: rt.reason}]};
  const environment = rt.config.environment;
  if (o.keys.environment !== environment) return {environment, state: "UNHEALTHY", checkedAt, ...tag, probes: [{name: "session-keys", ok: false, critical: true, detail: "KEYRING_ENVIRONMENT_MISMATCH"}]};
  const timeoutMs = o.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) throw new Error("HEALTH_TIMEOUT_INVALID");
  if (o.probes.length === 0) return {environment, state: "UNKNOWN", checkedAt, ...tag, probes: []};
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
  return {environment, state, checkedAt, ...tag, probes: results};
}

// ---------- promotion gate (staging -> production) ----------
export interface StagingEvidence {artifactSha256: string; stagingHealth: HealthReport; smokePassed: boolean; smokeAt: string}
export type PromotionDeny =
  | SeparationDeny | "ARTIFACT_INVALID" | "STAGING_EVIDENCE_MISMATCH" | "STAGING_UNHEALTHY" | "STAGING_SMOKE_FAILED" | "STAGING_EVIDENCE_STALE"
  | "DEPLOY_SESSION_INVALID" | "DEPLOY_SESSION_EXPIRED" | "DEPLOY_NOT_FOUNDER" | "DEPLOY_TENANT_DENIED" | "DEPLOY_SUBJECT_DENIED"
  | "DEPLOY_POLICY_INVALID" | "DEPLOY_APPROVAL_INVALID" | "DEPLOY_APPROVAL_EXPIRED";
export const MAX_STAGING_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_DEPLOY_APPROVAL_TTL_MS = 15 * 60 * 1000;
/** Production terfisini kim onaylayabilir: yalnız platform tenant'ı ve (ayarlıysa) izinli Founder subject'leri. */
export interface DeployPolicy {platformTenantId: string; founderSubjects?: ReadonlySet<string>}

const approvalMac = (key: string | Buffer, keyId: string, sid: string, sha: string, exp: number) =>
  createHmac("sha256", key).update(`da1.${keyId}.${sid}.${sha}.${exp}`).digest("hex");

/**
 * Sunucu tarafında, Founder'ın açık onay eyleminde üretilen, tek artifact'a ve tek oturuma bağlı kısa ömürlü dağıtım onayı:
 * `da1.<keyId>.<sid>.<artifactSha256>.<expiresAtMs>.<hex hmac>` — production ACTIVE anahtarıyla imzalanır, ≤15 dk geçerlidir.
 * Çalınmış bir oturum belirteci tek başına dağıtım yetkisi vermez; başka artifact için onay yeniden kullanılamaz.
 */
export function issueDeployApproval(ring: SessionKeyRing, sid: string, artifactSha256: string, now: Date, ttlMs: number = MAX_DEPLOY_APPROVAL_TTL_MS): string {
  if (ring.environment !== "production") throw new Error("DEPLOY_APPROVAL_RING_NOT_PRODUCTION");
  if (typeof sid !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(sid) || typeof artifactSha256 !== "string" || !SHA256_RE.test(artifactSha256)) throw new Error("DEPLOY_APPROVAL_FIELDS_INVALID");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_DEPLOY_APPROVAL_TTL_MS) throw new Error("DEPLOY_APPROVAL_TTL_INVALID");
  const k = ring.signingKey(), exp = now.getTime() + ttlMs;
  return `da1.${k.keyId}.${sid}.${artifactSha256}.${exp}.${approvalMac(k.secret, k.keyId, sid, artifactSha256, exp)}`;
}

function verifyDeployApproval(approval: unknown, ring: SessionKeyRing, sid: string, artifactSha256: string, now: Date): "OK" | "DEPLOY_APPROVAL_INVALID" | "DEPLOY_APPROVAL_EXPIRED" {
  if (typeof approval !== "string" || approval.length > 512) return "DEPLOY_APPROVAL_INVALID";
  const parts = approval.split(".");   // keyId "." içerebilir: son dört alan sabit, keyId aradaki kısımdır
  if (parts.length < 6 || parts[0] !== "da1") return "DEPLOY_APPROVAL_INVALID";
  const [aSid, aSha, expS, mac] = parts.slice(-4) as [string, string, string, string];
  const keyId = parts.slice(1, -4).join(".");
  if (!KEY_ID_RE.test(keyId) || !/^[0-9]{1,16}$/.test(expS) || !/^[0-9a-f]{64}$/.test(mac)) return "DEPLOY_APPROVAL_INVALID";
  const key = ring.keyFor(keyId, now); if (key === undefined) return "DEPLOY_APPROVAL_INVALID";
  const exp = Number(expS);
  if (!timingSafeEqual(Buffer.from(approvalMac(key, keyId, aSid, aSha, exp), "hex"), Buffer.from(mac, "hex"))) return "DEPLOY_APPROVAL_INVALID";
  if (aSid !== sid || aSha !== artifactSha256) return "DEPLOY_APPROVAL_INVALID";
  if (exp - now.getTime() > MAX_DEPLOY_APPROVAL_TTL_MS) return "DEPLOY_APPROVAL_INVALID";
  if (now.getTime() >= exp) return "DEPLOY_APPROVAL_EXPIRED";
  return "OK";
}

/**
 * Production'a terfi yalnız: ayrım geçerli + aynı artifact SHA için staging HEALTHY (rapor aynı SHA'yı taşır) + smoke PASS (≤24 saat) +
 * production anahtar halkasıyla doğrulanan, platform tenant'ına ait (ve izin listesi varsa listedeki) FOUNDER oturumu +
 * o oturuma ve o artifact SHA'sına bağlı süresi dolmamış dağıtım onayı. Staging oturumu production'da geçmez (ayrık anahtarlar).
 * SINIR: staging kanıtı (smoke/health) çağıranın beyanıdır, imzalı değildir; güven Founder onayına dayanır (runbook §4).
 * Bu fonksiyon bir karar döndürür; dağıtımı kendisi yapmaz (gerçek altyapı D-03/D-29 kapsamındadır).
 */
export function evaluatePromotion(o: {staging: EnvironmentDeployment; production: EnvironmentDeployment; artifactSha256: string;
  evidence: StagingEvidence; deployToken: unknown; deployApproval: unknown; policy: DeployPolicy; now: Date; revoked?: ReadonlySet<string>}):
  {ok: true; approvedBy: string; artifactSha256: string} | {ok: false; reason: PromotionDeny} {
  const pol = o.policy;
  if (!pol || typeof pol.platformTenantId !== "string" || !KEY_ID_RE.test(pol.platformTenantId)
    || (pol.founderSubjects !== undefined && (!(pol.founderSubjects instanceof Set) || pol.founderSubjects.size === 0))) return {ok: false, reason: "DEPLOY_POLICY_INVALID"};
  const sep = checkEnvironmentSeparation(o.staging, o.production);
  if (!sep.ok) return sep;
  if (typeof o.artifactSha256 !== "string" || !SHA256_RE.test(o.artifactSha256)) return {ok: false, reason: "ARTIFACT_INVALID"};
  const ev = o.evidence;
  if (!ev || ev.artifactSha256 !== o.artifactSha256) return {ok: false, reason: "STAGING_EVIDENCE_MISMATCH"};
  if (ev.stagingHealth?.environment !== "staging" || ev.stagingHealth.state !== "HEALTHY" || ev.stagingHealth.artifactSha256 !== o.artifactSha256) return {ok: false, reason: "STAGING_UNHEALTHY"};
  if (ev.smokePassed !== true) return {ok: false, reason: "STAGING_SMOKE_FAILED"};
  const at = Date.parse(ev.smokeAt), hAt = Date.parse(ev.stagingHealth.checkedAt), n = o.now.getTime();
  if (!Number.isFinite(at) || !Number.isFinite(hAt) || at > n + 60_000 || hAt > n + 60_000 || n - at > MAX_STAGING_EVIDENCE_AGE_MS || n - hAt > MAX_STAGING_EVIDENCE_AGE_MS)
    return {ok: false, reason: "STAGING_EVIDENCE_STALE"};
  const v = o.production.keys.verify(o.deployToken, o.now, o.revoked);
  if (!v.ok) return {ok: false, reason: v.reason === "SESSION_EXPIRED" ? "DEPLOY_SESSION_EXPIRED" : "DEPLOY_SESSION_INVALID"};
  const s: CloudSession = v.session;
  if (!s.roles.includes("FOUNDER")) return {ok: false, reason: "DEPLOY_NOT_FOUNDER"};
  if (s.tenantId !== pol.platformTenantId) return {ok: false, reason: "DEPLOY_TENANT_DENIED"};
  if (pol.founderSubjects && !pol.founderSubjects.has(s.subject)) return {ok: false, reason: "DEPLOY_SUBJECT_DENIED"};
  const a = verifyDeployApproval(o.deployApproval, o.production.keys, s.sid, o.artifactSha256, o.now);
  if (a !== "OK") return {ok: false, reason: a};
  return {ok: true, approvedBy: s.subject, artifactSha256: o.artifactSha256};
}
