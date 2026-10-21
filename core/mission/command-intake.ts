// //TR: Bu dosya Founder metin komutunu (TR/EN) saf ve deterministik biçimde DRAFT bir mission önerisine çevirir: I/O, ağ, model çağrısı yok; durum her zaman DRAFT'tır, asla yetkilendirmez; belirsiz/bilinmeyen girdi muhafazakâr FOUNDER_ATTENTION_REQUIRED sonucunu alır; metin veridir, talimat benzeri içerik yalnızca bayrak ekler, hiçbir bayrağı kaldırmaz.
import type { MissionStatus } from "./types.js";

export const INTAKE_MAX_LENGTH = 2000;
export type IntakeKind = "build" | "audit" | "test" | "security" | "operate";
export type IntakeRisk = 1 | 2 | 3 | 4 | 5;
export type IntakeReason = "PROTECTED_PATH" | "MERGE_PUSH_FORCE" | "PAID_OR_PRODUCTION" | "SECRETS" | "DELETION" | "INSTRUCTION_LIKE" | "KIND_UNKNOWN" | "KIND_AMBIGUOUS";
export type IntakeRejection = "INTAKE_NOT_STRING" | "INTAKE_EMPTY" | "INTAKE_TOO_LONG" | "INTAKE_CONTROL_CHARS";
export interface IntakeProposal {
  status: Extract<MissionStatus, "DRAFT">;
  outcome: "PROPOSED" | "FOUNDER_ATTENTION_REQUIRED";
  type: IntakeKind | null;
  kinds: IntakeKind[];
  riskLevel: IntakeRisk;
  authorityRequired: boolean;
  reasons: IntakeReason[];
  authorization: { verified: false };
  objective: string;
  origin: string | null;
}
export type IntakeResult = { ok: true; proposal: IntakeProposal } | { ok: false; code: IntakeRejection };

// Katlama: küçük harf, Türkçe harfleri ASCII'ye indir; anahtar sözcükler katlanmış biçimdedir.
const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/̇/g, "").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");

const KINDS: Array<[IntakeKind, RegExp, IntakeRisk]> = [
  ["build", /\b(build|implement|develop|create|add\b|write|fix|refactor|kodla|gelistir|olustur|ekle|yaz|duzelt|uygula)/, 2],
  ["audit", /\b(audit|review|inspect|analy[sz]e|denetle|denetim|incele|analiz)/, 2],
  ["test", /\b(test|verify|validate|dogrula|sina)/, 1],
  ["security", /\b(security|pentest|vulnerab|exploit|guvenlik|zafiyet|sizma)/, 3],
  ["operate", /\b(operate|run\b|running|restart|start|stop|operasyon|calistir|yeniden baslat|baslat|durdur)/, 3],
];
// Bayrak kuralları: eşleşme authorityRequired ve en az `risk` getirir.
const FLAGS: Array<[IntakeReason, RegExp, IntakeRisk]> = [
  ["PROTECTED_PATH", /(protected[- ]?path|korumali yol|trust[- ]?root|\.github|scripts\/ci|core\/workos\/store|package(-lock)?\.json|config\/protected)/, 4],
  ["MERGE_PUSH_FORCE", /\b(merg|push|forc|rebase|birlestir|zorla|force-push)/, 4],
  ["PAID_OR_PRODUCTION", /\b(production|prod\b|deploy|release|paid|billing|payment|canli|uretim|ucretli|odeme|yayinla|yayina al)/, 5],
  ["SECRETS", /(secret|credential|password|passwd|token|api[ -]?key|private key|\.env\b|sifre|parola|gizli anahtar|kimlik bilgi)/, 4],
  ["DELETION", /(\bdelet|\bremov|\bdrop\b|\bwipe|\bdestroy|\btruncat|rm -rf|\bsil\b|\bsilin|\bsilme|\bkaldir|yok et|temizle)/, 4],
  ["INSTRUCTION_LIKE", /(ignor\w*( \w+)? (rules|instructions|polic\w+|guard\w*)|disregard|bypass|override|skip (the )?(review|tests?|validation|checks?)|approve (it|this)|you are now|system prompt|authori[sz]e (it|this|the)|kurallari (yok say|atla)|talimat\w* (yok say|atla)|onceki talimat|incelemeyi atla|testleri atla|dogrudan onayla|yetkilendir|yetki ver)/, 4],
];
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function intakeCommand(text: unknown, context?: { origin?: unknown }): IntakeResult {
  if (typeof text !== "string") return { ok: false, code: "INTAKE_NOT_STRING" };
  if (CONTROL.test(text)) return { ok: false, code: "INTAKE_CONTROL_CHARS" };
  if (text.trim().length === 0) return { ok: false, code: "INTAKE_EMPTY" };
  if (text.length > INTAKE_MAX_LENGTH) return { ok: false, code: "INTAKE_TOO_LONG" };
  const f = fold(text);
  const hits = KINDS.filter(([, re]) => re.test(f));
  const reasons: IntakeReason[] = [];
  let risk = 1;
  for (const [reason, re, r] of FLAGS) if (re.test(f)) { reasons.push(reason); risk = Math.max(risk, r); }
  for (const [, , r] of hits) risk = Math.max(risk, r);
  // Belirsiz veya bilinmeyen tür: en yüksek risk ve Founder dikkati (asla daha düşük risk değil).
  // Talimat benzeri metin türü çözemez (kendi sözcükleriyle riski düşüremez): tür null, risk 5.
  const injected = reasons.includes("INSTRUCTION_LIKE");
  if (hits.length !== 1) reasons.push(hits.length === 0 ? "KIND_UNKNOWN" : "KIND_AMBIGUOUS");
  const attention = hits.length !== 1 || injected;
  if (attention) risk = 5;
  const origin = typeof context?.origin === "string" && context.origin.length > 0 && context.origin.length <= 64 && !CONTROL.test(context.origin) ? context.origin : null;
  return {
    ok: true,
    proposal: {
      status: "DRAFT",
      outcome: attention ? "FOUNDER_ATTENTION_REQUIRED" : "PROPOSED",
      type: hits.length === 1 && !injected ? hits[0][0] : null,
      kinds: hits.map(([k]) => k),
      riskLevel: risk as IntakeRisk,
      authorityRequired: reasons.some(r => r !== "KIND_UNKNOWN" && r !== "KIND_AMBIGUOUS") || risk >= 4,
      reasons,
      authorization: { verified: false },
      objective: text.trim(),
      origin,
    },
  };
}
