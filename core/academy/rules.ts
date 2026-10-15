// //TR: Bu dosya Skill Academy'nin hem yazma hem journal replay tarafında aynı biçimde uygulanan deterministik kurallarını tutar: bağımsız reviewer kimliği, destekleyici kaynak, tazelik, kanıt referansı biçimi ve kaynak içeriğinde prompt-injection taraması; içerik yalnız veri olarak taranır, hiçbir zaman talimat olarak yürütülmez.
import crypto from "node:crypto";
import type {InjectionCode, LearningRecord, SourceRecord, SourceScreen} from "./types.js";

const DAY_MS = 86_400_000;
export const isSha256 = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
export const sha256Text = (s: string): string => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// Kimlik karşılaştırması büyük/küçük harf, boşluk ve ayırıcı farklarına duyarsızdır: "Claude-Builder" ile " claude_builder " aynı kişidir (kendi kendini onay reddedilir).
export const normIdentity = (x: string): string => x.normalize("NFKC").trim().toLowerCase().replace(/[\s_.-]+/g, "-");
export const sameIdentity = (a: string, b: string): boolean => normIdentity(a) === normIdentity(b);
export function reviewerIsIndependent(rec: Pick<LearningRecord, "implementerIdentity" | "createdBy">, reviewer: string): boolean {
  return normIdentity(reviewer).length > 0 && !sameIdentity(rec.implementerIdentity, reviewer) && !sameIdentity(rec.createdBy, reviewer);
}

// Reviewer kanıtı WFR-03 doğrulayıcısıyla aynı kök biçimindedir: audit/evidence/<alan>/<kayıt>/<ad>.json#sha256=<hex>.
export const EVIDENCE_ROOT = "audit/evidence/skill-academy";
export const REVIEWER_EVIDENCE_REF = /^audit\/evidence\/skill-academy\/(lrn_[0-9a-f]{24})\/REVIEWER\.json#sha256=([0-9a-f]{64})$/;
export function parseReviewerEvidenceRef(ref: unknown): {learningId: string; relPath: string; sha256: string} | null {
  if (typeof ref !== "string") return null;
  const m = REVIEWER_EVIDENCE_REF.exec(ref);
  return m ? {learningId: m[1], relPath: ref.split("#")[0], sha256: m[2]} : null;
}

export function sourceExpiresAtMs(s: Pick<SourceRecord, "fetchedAt" | "freshnessTTLDays">): number | null {
  if (s.fetchedAt === null) return null;
  const t = Date.parse(s.fetchedAt);
  return Number.isFinite(t) ? t + s.freshnessTTLDays * DAY_MS : null;
}
// fetchedAt yoksa tazelik bilinmiyor demektir: taze kabul edilmez (varsayılan DENY/UNKNOWN).
export function isFresh(s: Pick<SourceRecord, "fetchedAt" | "freshnessTTLDays">, atMs: number): boolean {
  const exp = sourceExpiresAtMs(s);
  return exp !== null && atMs < exp;
}
export type SupportProblem = "NO_SHA256" | "UNTRUSTED" | "NOT_ACTIVE" | "NOT_SCREENED_CLEAN" | "NOT_FRESH";
// sha256'sız veya UNTRUSTED kaynak terfiyi destekleyemez; iptal/zehirli, tarama dışı veya bayat kaynak da destekleyemez.
export function supportProblem(s: SourceRecord, screen: SourceScreen | null, atMs: number): SupportProblem | null {
  if (!isSha256(s.sha256)) return "NO_SHA256";
  if (s.sourceTrust === "UNTRUSTED") return "UNTRUSTED";
  if (s.status !== "ACTIVE") return "NOT_ACTIVE";
  if (!screen || !screen.cleanSourceIds.includes(s.sourceId)) return "NOT_SCREENED_CLEAN";
  if (!isFresh(s, atMs)) return "NOT_FRESH";
  return null;
}
// Kaydın atıf yaptığı kaynaklardan biri iptal/zehirli ya da enjeksiyon bulgulu ise kayıt terfi edemez.
export function blockingSources(rec: LearningRecord, sources: Readonly<Record<string, SourceRecord>>): string[] {
  const flagged = new Set(rec.screen?.flaggedSourceIds ?? []);
  return rec.sourceIds.filter(id => flagged.has(id) || sources[id]?.status !== "ACTIVE");
}

// Kaynak görünürlüğü: aynı tenant (proje kapsamlıysa aynı proje) veya açıkça global kaynak.
export function sourceVisibleTo(s: SourceRecord, tenantId: string, projectId: string | null): boolean {
  if (s.scope.global) return true;
  if (s.tenantId !== tenantId) return false;
  return s.scope.projectId === null || s.scope.projectId === projectId;
}

// Prompt-injection taraması: kaynak metni VERİDİR. Bulgu yalnız kaynağı işaretler (destek veremez); hiçbir durum, izin veya kayıt alanı metinden türetilmez.
const INJECTION_PATTERNS: ReadonlyArray<[InjectionCode, RegExp]> = [
  ["IGNORE_INSTRUCTIONS", /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|system|your)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|policy|policies)\b/i],
  ["IGNORE_INSTRUCTIONS", /\b(you are now|new system prompt|system prompt:|act as (an? )?(admin|root|founder))/i],
  ["AUTHORITY_ESCALATION", /\bgrant\b[^.\n]{0,30}\b(yourself|myself|itself|the agent|me|you)\b[^.\n]{0,40}\b(admin|administrator|root|sudo|permissions?|access|authority|privileges?)\b/i],
  ["AUTHORITY_ESCALATION", /\b(elevate|escalate|raise|increase)\b[^.\n]{0,30}\b(your|its|own|the agent'?s?)\b[^.\n]{0,20}\b(permissions?|privileges?|authority|access|role)\b/i],
  ["STATUS_FORGERY", /\b(mark|set|flag|record|declare)\b[^.\n]{0,40}\bas\b[^.\n]{0,10}\b(certified|approved|promoted|clean|verified|trusted|passed)\b/i],
  ["STATUS_FORGERY", /\b(founder|reviewer|supervisor)\b[^.\n]{0,20}\b(has )?(approved|signed off|certified)\b/i],
  ["SECRET_EXFILTRATION", /\b(send|upload|post|exfiltrate|share|email|paste)\b[^.\n]{0,40}\b(ssh|private key|api key|token|secret|credentials?|password|\.env)\b/i],
  ["POLICY_TAMPER", /\b(disable|bypass|turn off|remove|change|override|edit)\b[^.\n]{0,40}\b(rules?|polic(y|ies)|guards?|sandbox|trust[- ]?(kernel|root)|validation|kill switch|global stop)\b/i],
  ["REMOTE_EXEC", /\b(curl|wget|iwr|invoke-webrequest)\b[^\n]{0,200}\|\s*(sh|bash|pwsh|powershell|iex|python)\b/i],
  ["REMOTE_EXEC", /\b(run|execute)\b[^.\n]{0,30}\b(this|the following|attached)\b[^.\n]{0,20}\b(script|command|binary|payload)\b/i]
];
export function screenSourceText(text: string): InjectionCode[] {
  const out = new Set<InjectionCode>();
  for (const [code, re] of INJECTION_PATTERNS) if (re.test(text)) out.add(code);
  return [...out].sort();
}
