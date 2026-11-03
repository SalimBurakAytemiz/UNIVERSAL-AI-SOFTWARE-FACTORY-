// //TR: Bu dosya CLOUD-T0004 bulut Control API kapısını uygular: bulut çalışma zamanı yapılandırması (yoksa CLOUD_RUNTIME_NOT_CONFIGURED, yerel yedek yok), yalnız https uç nokta, imzalı oturum, en az yetki rolleri, tenant izolasyonu, secret redaksiyonu ve tenant bütçesiyle sınırlı model çağrısı.
import {createHmac, randomUUID, timingSafeEqual} from "node:crypto";
import {redactSecrets} from "../../../../core/workos/secret-scan.js";
import type {CloudEnvironment} from "../../../../core/cloud/contracts.js";

export type GatewayDeny =
  | "CLOUD_RUNTIME_NOT_CONFIGURED" | "ENDPOINT_INSECURE" | "SESSION_INVALID" | "SESSION_EXPIRED" | "TENANT_DENIED" | "ROLE_DENIED"
  | "BUDGET_NOT_CONFIGURED" | "BUDGET_EXCEEDED" | "COST_INVALID" | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_ERROR" | "PROVIDER_TIMEOUT" | "REQUEST_INVALID";
export type GatewayAction = "job.submit" | "job.read" | "job.cancel" | "artifact.download" | "model.invoke" | "system.stop";
export type CloudRole = "FOUNDER" | "OPERATOR" | "VIEWER";

/** En az yetki: her rol yalnız listelenen eylemleri yapar. STOP yalnız Founder'dır. */
export const ROLE_PERMISSIONS: Readonly<Record<CloudRole, readonly GatewayAction[]>> = Object.freeze({
  FOUNDER: ["job.submit", "job.read", "job.cancel", "artifact.download", "model.invoke", "system.stop"],
  OPERATOR: ["job.submit", "job.read", "job.cancel", "artifact.download", "model.invoke"],
  VIEWER: ["job.read", "artifact.download"],
});
export const MAX_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Yalnız kendi alanları: "constructor" gibi prototip adları rol sayılmaz. */
const isRole = (r: unknown): r is CloudRole => typeof r === "string" && Object.hasOwn(ROLE_PERMISSIONS, r);

// ---------- runtime configuration ----------
export interface CloudRuntimeConfig {endpoint: URL; environment: CloudEnvironment}
/** Üretimde reddedilen yerel adresler: localhost (sondaki nokta ve *.localhost dahil), 127/8, 0.0.0.0, ::, ::1, IPv4-mapped loopback. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h) || h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (/^::ffff:(127\.\d+\.\d+\.\d+|7f[0-9a-f]{2}:[0-9a-f]{1,4}|0\.0\.0\.0|0:0)$/.test(h)) return true;
  return false;
}

/** Ortam değişkenlerinden bulut çalışma zamanını çözer. Uç nokta yoksa iş başlatılmaz; yerel WSL/process yedeği YOKTUR (CLOUD-T0014 ile uyumlu). */
export function resolveCloudRuntimeConfig(env: Readonly<Record<string, string | undefined>>):
  {ok: true; config: CloudRuntimeConfig} | {ok: false; reason: "CLOUD_RUNTIME_NOT_CONFIGURED" | "ENDPOINT_INSECURE"} {
  const raw = env.UASCO_CLOUD_ENDPOINT?.trim();
  if (!raw) return {ok: false, reason: "CLOUD_RUNTIME_NOT_CONFIGURED"};
  let url: URL;
  try { url = new URL(raw); } catch { return {ok: false, reason: "ENDPOINT_INSECURE"}; }
  const environment = (env.UASCO_CLOUD_ENVIRONMENT ?? "staging") as CloudEnvironment;
  if (environment !== "staging" && environment !== "production") return {ok: false, reason: "CLOUD_RUNTIME_NOT_CONFIGURED"};
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return {ok: false, reason: "ENDPOINT_INSECURE"};
  if (environment === "production" && isLoopbackHost(url.hostname)) return {ok: false, reason: "ENDPOINT_INSECURE"};
  return {ok: true, config: {endpoint: url, environment}};
}

// ---------- sessions ----------
export interface CloudSession {sid: string; subject: string; tenantId: string; roles: CloudRole[]; issuedAt: number; expiresAt: number}
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Oturum belirteci: `v1.<keyId>.<base64url(payload)>.<hex hmac>`. Sunucu tarafında üretilir; istemci (.exe) yalnız taşır. */
export function issueSession(s: Omit<CloudSession, "sid" | "issuedAt" | "expiresAt">, ttlMs: number, keyId: string, secret: string | Buffer, now: Date): string {
  if (!ID_RE.test(s.subject) || !ID_RE.test(s.tenantId) || !ID_RE.test(keyId)) throw new Error("SESSION_FIELDS_INVALID");
  if (!Array.isArray(s.roles) || s.roles.length === 0 || !s.roles.every(isRole)) throw new Error("SESSION_ROLES_INVALID");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_SESSION_TTL_MS) throw new Error("SESSION_TTL_INVALID");
  if ((typeof secret === "string" ? secret.length : secret.byteLength) < 32) throw new Error("SESSION_KEY_TOO_SHORT");
  const payload: CloudSession = {sid: randomUUID(), subject: s.subject, tenantId: s.tenantId, roles: [...new Set(s.roles)], issuedAt: now.getTime(), expiresAt: now.getTime() + ttlMs};
  const body = b64u(JSON.stringify(payload));
  return `v1.${keyId}.${body}.${createHmac("sha256", secret).update(`v1.${keyId}.${body}`).digest("hex")}`;
}

export function verifySession(token: unknown, keys: ReadonlyMap<string, string | Buffer>, now: Date, revoked: ReadonlySet<string> = new Set()):
  {ok: true; session: CloudSession} | {ok: false; reason: "SESSION_INVALID" | "SESSION_EXPIRED"} {
  const bad = {ok: false as const, reason: "SESSION_INVALID" as const};
  if (typeof token !== "string" || token.length > 4096) return bad;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !ID_RE.test(parts[1]!) || !/^[A-Za-z0-9_-]+$/.test(parts[2]!) || !/^[0-9a-f]{64}$/.test(parts[3]!)) return bad;
  const key = keys.get(parts[1]!); if (key === undefined) return bad;
  const expected = Buffer.from(createHmac("sha256", key).update(`v1.${parts[1]}.${parts[2]}`).digest("hex"), "hex");
  if (!timingSafeEqual(expected, Buffer.from(parts[3]!, "hex"))) return bad;
  let p: CloudSession;
  try { p = JSON.parse(Buffer.from(parts[2]!, "base64url").toString("utf8")) as CloudSession; } catch { return bad; }
  if (!p || typeof p !== "object" || typeof p.sid !== "string" || !ID_RE.test(p.subject) || !ID_RE.test(p.tenantId) || !Array.isArray(p.roles)
    || p.roles.length === 0 || !p.roles.every(isRole) || !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt)
    || p.expiresAt - p.issuedAt > MAX_SESSION_TTL_MS || p.issuedAt > now.getTime() + 60_000) return bad;
  if (revoked.has(p.sid)) return bad;
  if (now.getTime() >= p.expiresAt) return {ok: false, reason: "SESSION_EXPIRED"};
  return {ok: true, session: p};
}

/** Tenant izolasyonu önce, rol yetkisi sonra. Başka tenant'ın kaynağı Founder için de reddedilir. */
export function authorize(session: CloudSession, action: GatewayAction, resourceTenantId: string): {ok: true} | {ok: false; reason: "TENANT_DENIED" | "ROLE_DENIED"} {
  if (session.tenantId !== resourceTenantId) return {ok: false, reason: "TENANT_DENIED"};
  if (!session.roles.some(r => ROLE_PERMISSIONS[r].includes(action))) return {ok: false, reason: "ROLE_DENIED"};
  return {ok: true};
}

// ---------- bounded billing ----------
/** Tenant başına harcama tavanı. Çağrı önce tahmini azami maliyeti ayırır; tavan aşılacaksa çağrı yapılmaz. */
export class TenantBudget {
  private readonly spent = new Map<string, number>();
  private readonly reserved = new Map<string, {tenantId: string; usd: number}>();
  constructor(private readonly limitsUsd: ReadonlyMap<string, number>) {
    for (const v of limitsUsd.values()) if (!Number.isFinite(v) || v < 0) throw new Error("BUDGET_LIMIT_INVALID");
  }
  reserve(tenantId: string, maxUsd: number): {ok: true; id: string} | {ok: false; reason: "BUDGET_NOT_CONFIGURED" | "BUDGET_EXCEEDED" | "COST_INVALID"} {
    const limit = this.limitsUsd.get(tenantId);
    if (limit === undefined) return {ok: false, reason: "BUDGET_NOT_CONFIGURED"};
    if (typeof maxUsd !== "number" || !Number.isFinite(maxUsd) || maxUsd <= 0) return {ok: false, reason: "COST_INVALID"};
    if (this.committed(tenantId) + maxUsd > limit + 1e-9) return {ok: false, reason: "BUDGET_EXCEEDED"};
    const id = randomUUID(); this.reserved.set(id, {tenantId, usd: maxUsd}); return {ok: true, id};
  }
  /** Gerçek maliyet ayrılan tavanı aşarsa yine gerçek maliyet kaydedilir (eksik kayıt yok) ve overrun bildirilir. */
  settle(id: string, actualUsd: number): {overrun: boolean; chargedUsd: number} {
    const r = this.reserved.get(id); if (!r) throw new Error("RESERVATION_UNKNOWN");
    this.reserved.delete(id);
    const usd = Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : r.usd;   // ölçülemeyen maliyet: ayrılan tavan yazılır
    this.spent.set(r.tenantId, (this.spent.get(r.tenantId) ?? 0) + usd);
    return {overrun: usd > r.usd + 1e-9, chargedUsd: usd};
  }
  release(id: string): void { this.reserved.delete(id); }
  committed(tenantId: string): number {
    let held = 0; for (const r of this.reserved.values()) if (r.tenantId === tenantId) held += r.usd;
    return (this.spent.get(tenantId) ?? 0) + held;
  }
}

// ---------- model invocation ----------
export interface ModelRequest {model: string; prompt: string; maxOutputTokens: number; maxCostUsd: number}
export interface ModelResponse {text: string; inputTokens: number; outputTokens: number; costUsd: number}
/** Bulut tarafındaki model sağlayıcısı (CLOUD-T0015 gerçek bağlantıyı sağlar). Kimlik bilgisi sağlayıcının içinde kalır, kapıya geçmez.
 *  Sözleşme: `signal` abort edildiğinde sağlayıcı isteği iptal etmek ZORUNDADIR; zaman aşımından sonra gelen maliyet ayrılan tavanla sınırlı kaydedilir. */
export interface ModelProvider {readonly name: string; invoke(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>}
export interface GatewayAuditRecord {at: string; action: GatewayAction; tenantId: string | null; subject: string | null; decision: "ALLOWED" | "DENIED" | "FAILED"; reason?: string; costUsd?: number; overrun?: boolean}

export interface CloudGatewayOptions {
  env: Readonly<Record<string, string | undefined>>;
  sessionKeys: ReadonlyMap<string, string | Buffer>;
  budget: TenantBudget | null;
  provider: ModelProvider | null;
  audit: (r: GatewayAuditRecord) => void;
  /** Redaksiyonda ek olarak maskelenecek bilinen gizli değerler (ör. sağlayıcı anahtarı). */
  knownSecrets?: readonly string[];
  now?: () => Date;
  providerTimeoutMs?: number;
  revokedSessions?: ReadonlySet<string>;
}

export class CloudGateway {
  private readonly runtime: ReturnType<typeof resolveCloudRuntimeConfig>;
  private readonly now: () => Date;
  constructor(private readonly o: CloudGatewayOptions) {
    this.runtime = resolveCloudRuntimeConfig(o.env);
    this.now = o.now ?? (() => new Date());
    const t = o.providerTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(t) || t < 10 || t > 600_000) throw new Error("PROVIDER_TIMEOUT_INVALID");   // L-5
    this.timeoutMs = t;
  }
  private readonly timeoutMs: number;

  /** UI ve istemci için güvenli durum: uç nokta adresi ya da secret içermez. */
  status(): {status: "CLOUD_READY" | "CLOUD_RUNTIME_NOT_CONFIGURED" | "ENDPOINT_INSECURE"; environment?: CloudEnvironment} {
    return this.runtime.ok ? {status: "CLOUD_READY", environment: this.runtime.config.environment} : {status: this.runtime.reason};
  }

  /** Önce bilinen secret'lar (en uzundan kısaya, tam eşleşme), sonra kalıplar: kalıp dönüşümü bilinen bir secret'ı parçalayıp kalanını sızdıramaz. */
  redact(text: string): string {
    // N-1: bütün bilinen secret eşleşmelerinin aralıkları birleştirilir; çakışan iki secret birbirinin kalanını açıkta bırakamaz.
    const src = String(text);
    const known = [...(this.o.knownSecrets ?? [])].filter(s => typeof s === "string" && s.length >= 8);
    const spans: Array<[number, number]> = [];
    for (const k of known) for (let at = src.indexOf(k); at !== -1; at = src.indexOf(k, at + 1)) spans.push([at, at + k.length]);
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = "", pos = 0;
    for (let n = 0; n < spans.length;) {
      let [st, en] = spans[n++]!;
      while (n < spans.length && spans[n]![0] <= en) en = Math.max(en, spans[n++]![1]);
      out += src.slice(pos, st) + "[REDACTED]"; pos = en;
    }
    out += src.slice(pos);
    out = redactSecrets(out);
    return out.replace(/v1\.[A-Za-z0-9._:-]{3,128}\.[A-Za-z0-9_-]+\.[0-9a-f]{64}/g, "[REDACTED_SESSION]").slice(0, 2000);
  }

  private log(r: Omit<GatewayAuditRecord, "at">): void {
    this.o.audit({at: this.now().toISOString(), ...r, ...(r.reason ? {reason: this.redact(r.reason)} : {})});
  }

  /** Ortak kapı: çalışma zamanı → oturum → tenant → rol. Herhangi bir belirsizlik reddir. */
  gate(token: unknown, action: GatewayAction, tenantId: string): {ok: true; session: CloudSession} | {ok: false; reason: GatewayDeny} {
    const deny = (reason: GatewayDeny, s?: CloudSession) => { this.log({action, tenantId: ID_RE.test(tenantId) ? tenantId : null, subject: s?.subject ?? null, decision: "DENIED", reason}); return {ok: false as const, reason}; };
    if (!this.runtime.ok) return deny(this.runtime.reason);
    const v = verifySession(token, this.o.sessionKeys, this.now(), this.o.revokedSessions);
    if (!v.ok) return deny(v.reason);
    const a = authorize(v.session, action, tenantId);
    if (!a.ok) return deny(a.reason, v.session);
    return {ok: true, session: v.session};
  }

  async invokeModel(token: unknown, tenantId: string, req: ModelRequest): Promise<{ok: true; response: ModelResponse} | {ok: false; reason: GatewayDeny; detail?: string}> {
    const g = this.gate(token, "model.invoke", tenantId); if (!g.ok) return g;
    const base = {action: "model.invoke" as const, tenantId, subject: g.session.subject};
    if (!req || typeof req.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(req.model) || typeof req.prompt !== "string" || req.prompt.length === 0
      || req.prompt.length > 1_000_000 || !Number.isSafeInteger(req.maxOutputTokens) || req.maxOutputTokens < 1 || req.maxOutputTokens > 64_000) {
      this.log({...base, decision: "DENIED", reason: "REQUEST_INVALID"}); return {ok: false, reason: "REQUEST_INVALID"};
    }
    if (!this.o.provider) { this.log({...base, decision: "DENIED", reason: "PROVIDER_NOT_CONFIGURED"}); return {ok: false, reason: "PROVIDER_NOT_CONFIGURED"}; }
    if (!this.o.budget) { this.log({...base, decision: "DENIED", reason: "BUDGET_NOT_CONFIGURED"}); return {ok: false, reason: "BUDGET_NOT_CONFIGURED"}; }
    const r = this.o.budget.reserve(tenantId, req.maxCostUsd);
    if (!r.ok) { this.log({...base, decision: "DENIED", reason: r.reason}); return {ok: false, reason: r.reason}; }
    const ctl = new AbortController();
    const timeoutMs = this.timeoutMs;
    let timer: NodeJS.Timeout | undefined, settled = false;
    try {
      // önce zaman aşımı, sonra abort: sağlayıcının abort hatası nedeni maskelemez
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { rej(Object.assign(new Error("timeout"), {code: "PROVIDER_TIMEOUT"})); ctl.abort(); }, timeoutMs); });
      const response = await Promise.race([this.o.provider.invoke(req, ctl.signal), timeout]);
      const {overrun, chargedUsd} = this.o.budget.settle(r.id, response.costUsd); settled = true;
      const costValid = typeof response.costUsd === "number" && Number.isFinite(response.costUsd) && response.costUsd >= 0;
      try { this.log({...base, decision: "ALLOWED", costUsd: chargedUsd, overrun, ...(costValid ? {} : {reason: "PROVIDER_COST_INVALID"})}); } catch { /* audit sink hatası sonucu değiştirmez */ }
      return {ok: true, response: {...response, costUsd: chargedUsd}};
    } catch (e) {
      // Sağlayıcı hatasında maliyet bilinmiyor: ayrılan tavan harcanmış sayılır (eksik faturalama yok), metin redakte edilir.
      if (!settled) { this.o.budget.settle(r.id, Number.NaN); settled = true; }
      const reason: GatewayDeny = (e as {code?: string})?.code === "PROVIDER_TIMEOUT" ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
      const detail = this.redact(e instanceof Error ? e.message : String(e));
      try { this.log({...base, decision: "FAILED", reason: `${reason}: ${detail}`}); } catch { /* audit sink hatası */ }
      return {ok: false, reason, detail};
    } finally { if (timer) clearTimeout(timer); }
  }
}
