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
  clarification: IntakeClarification | null;
}
// UASCO-T0010: belirsiz/bilinmeyen tür için deterministik netleştirme sorusu (TR+EN); seçenekler yalnız bilinen türlerdir, hiçbir yetki vermez.
export interface IntakeClarification { code: "KIND_UNKNOWN" | "KIND_AMBIGUOUS"; question: string; options: IntakeKind[] }
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
const ALL_KINDS: IntakeKind[] = KINDS.map(([k]) => k);
// UASCO-T0010 PRODUCT-INTAKE profili: intake fikir metni bir ürün açıklamasıdır ("görev ekle/sil", "ödeme sayfası", "şifre sıfırlama", "push bildirimleri", "deploy-ready"); varsayılan profil bunları fiil eşleşmesiyle işler sayar.
// Bu profil YALNIZ şu dört bayrağı operasyonel talimat biçimine daraltır (hedef nesne + belirleyici/ortam: "delete the production database", "force-push to main", "rotate the AWS secret key", "pay the invoice").
// PROTECTED_PATH ve INSTRUCTION_LIKE ASLA gevşetilmez (tip düzeyinde de gevşetilemez); tür belirsizliği yoktur: intake fikri her zaman "build" işidir (talimat benzeri metin yine türü çözemez, risk 5).
export type IntakeProfile = "command" | "product-intake";
export const INTAKE_PROFILES: readonly IntakeProfile[] = Object.freeze(["command", "product-intake"] as IntakeProfile[]);
type RelaxableReason = "MERGE_PUSH_FORCE" | "PAID_OR_PRODUCTION" | "SECRETS" | "DELETION";
const DET = String.raw`(?:(?:the|all|our|every|entire|whole|existing|any|this|that|these|those|its|my)\s+)+`;
// Hedef dal/ortamdan sonra başka bir ad gelirse (main list, remote server, main screen) hedef bir ürün öğesidir, git dalı değil.
const REF_END = String.raw`(?!\s+(?!(?:branch|and|then|now|today|please|after|before|with|without|immediately|directly|ve|sonra)\b)[a-z])`;
const SECRET_NOUN = String.raw`(?:secrets?|credentials?|tokens?|api[ -]?keys?|private keys?|access keys?|passwords?|passwd|\.env)\b(?!\s*(?:reset|strength|recovery|manager|field|form|input|hint|rules?|polic\w*|change|protected|less|-protected|-less))`;
const PRODUCT_FLAGS: Readonly<Record<RelaxableReason, RegExp>> = Object.freeze({
  MERGE_PUSH_FORCE: new RegExp(String.raw`(force[- ]?push|--force\b|\bpush\s+-f\b|\bgit\s+(?:push|merge|rebase|reset)\b|\brebase\b|\breset\s+--hard|\bpush\w*\s+(?:\w+\s+){0,2}?(?:to|into|onto)\s+(?:the\s+)?(?:main|master|origin|remote|upstream|prod\w*|release|develop|default branch)\b${REF_END}|\bmerg\w*\s+(?:\w+\s+){0,3}?(?:into|to|onto)\s+(?:the\s+)?(?:main|master|develop|release|prod\w*|default branch)\b${REF_END}|\bmerg\w*\s+(?:the\s+|this\s+|my\s+|that\s+|our\s+)?(?:pr|prs|pull requests?|branch(?:es)?)\b|\b(?:main|master|ana dal)\w*\s+(?:\w+\s+)?(?:birlestir|zorla|push)|\bzorla\s+(?:push|gonder))`),
  PAID_OR_PRODUCTION: new RegExp(String.raw`(\b(?:deploy|release|publish|ship|roll out|promote)\w*\s+(?:it|this|that|everything|(?:\w+\s+){0,2}?(?:to|on|into)\s+(?:the\s+)?(?:prod|production|live|staging|app store|play store)\b)|\b(?:on|in|to|into|against|from)\s+(?:the\s+)?(?:prod|production)\b(?!\s+(?:planning|line|lines|schedul\w*|cost\w*|quality|management|tracking|volume\w*))|\b(?:prod|production)\s+(?:database|db|servers?|environment|env|cluster|data|keys?|credentials|instance|bucket)\b|\blive\s+(?:database|db|servers?|environment|env|cluster|instance)\b|\bpay\s+(?:the|our|this|that|all|an?|every)\s+(?:\w+\s+)?(?:invoices?|bills?|fees?|vendor|supplier|subscription|license)\b|\b(?:use|call|enable|switch to|turn on)\s+(?:the\s+|our\s+|a\s+)?paid\b|\bcharge\s+(?:the\s+|our\s+)?(?:company|corporate|credit)\s+card|\bpaid\s+(?:api|apis|model|models|provider|service|tier|plan)\b|\bbilling\s+(?:account|settings|limit)\b|fatura\w*\s+(?:\w+\s+)?ode\b|(?:canliya|yayina|uretime)\s+al\b|(?:canli|uretim)\s+(?:ortam|sunucu|veritaban)\w*|ucretli\s+(?:api|model|servis|plan)\w*)`),
  SECRETS: new RegExp(String.raw`(\b(?:rotate|reveal|print|dump|leak|exfiltrate|expose|paste|commit|echo|disclose|upload)(?:s|d|ed|ing)?\s+(?:\w+\s+){0,3}?${SECRET_NOUN}|\b(?:send|share|copy|show|output|give)(?:s|ing)?\s+(?:the|our|my|your|all|its)\s+(?:\w+\s+){0,2}?${SECRET_NOUN}|\b(?:aws|gcp|azure|stripe|github|openai|anthropic|ssh|gpg|pgp|signing|deploy|npm)\s+(?:secret\s+|access\s+|private\s+|api\s+)?(?:keys?|tokens?|credentials?|secrets?)\b|(?:^|[\s/])\.env\b|id_rsa|\.pem\b|(?:sifre|parola|gizli anahtar|token|anahtar)\w*\s+(?:\w+\s+)?(?:goster|yazdir|paylas|gonder|dondur|sizdir|kopyala|ifsa))`),
  DELETION: new RegExp(String.raw`(rm -rf|\b(?:drop|truncat\w*)\s+(?:the\s+)?(?:table|tables|database|db|schema|collection|index)\b|\b(?:delet|remov|wip|destroy|purg|eras|drop|truncat)\w*\s+${DET}(?:\w+\s+){0,2}?(?:database|databases|db|tables?|branch(?:es)?|repo\w*|buckets?|servers?|cluster|backups?|logs?|records|data|files|folders?|director(?:y|ies)|accounts|users|history|commits|tags|environment|containers?|volumes?|disks?|secrets?|keys?|migrations?)\b|\bwipe\s+(?:the\s+)?(?:disk|drive|server|machine|repo\w*|database|db)\b|(?:veritaban\w*|tablo\w*|\bdal\w*|depo\w*|sunucu\w*|yedek\w*|kayitlar\w*|tum\s+\w+)\s+(?:\w+\s+)?(?:sil\b|silin|kaldir|yok et|temizle))`),
});
const NEVER_RELAXED: ReadonlySet<IntakeReason> = new Set<IntakeReason>(["PROTECTED_PATH", "INSTRUCTION_LIKE"]);
const flagsFor = (profile: IntakeProfile): Array<[IntakeReason, RegExp, IntakeRisk]> => profile === "product-intake"
  ? FLAGS.map(([r, re, k]) => [r, NEVER_RELAXED.has(r) ? re : (PRODUCT_FLAGS[r as RelaxableReason] ?? re), k])
  : FLAGS;
// UASCO-T0011 (sunucu kapısı): yetki gerektiren bayraklar (tür belirsizliği DEĞİL). POST /v1/intakes bunları her serbest metin alanında yeniden çalıştırır; uzunluk sınırı yoktur (intake fikri 4000 karaktere kadar).
export type IntakeAuthorityReason = Exclude<IntakeReason, "KIND_UNKNOWN" | "KIND_AMBIGUOUS">;
export const INTAKE_AUTHORITY_REASONS: readonly IntakeAuthorityReason[] = Object.freeze(FLAGS.map(([r]) => r as IntakeAuthorityReason));
/** Verilen metinlerin birleşik yetki bayrakları (FLAGS sırasıyla, tekrarsız); metin olmayan öğe yok sayılır. intakeCommand ile aynı katlama ve aynı kurallar. */
export function intakeAuthorityFlags(texts: readonly unknown[]): IntakeAuthorityReason[] {
  const folded = texts.filter((t): t is string => typeof t === "string").map(fold);
  return FLAGS.filter(([, re]) => folded.some(f => re.test(f))).map(([r]) => r as IntakeAuthorityReason);
}
// UASCO-T0010: Windows UI'deki örnek komutlar; her biri tek türe çözülür ve DRAFT/PROPOSED üretir (testle bağlıdır).
export const COMMAND_INTAKE_EXAMPLES: readonly string[] = Object.freeze(["Ayarlar sayfasını geliştir", "Audit the login module", "Birim testlerini doğrula"]);
const clarify = (code: "KIND_UNKNOWN" | "KIND_AMBIGUOUS", kinds: IntakeKind[]): IntakeClarification => code === "KIND_UNKNOWN"
  ? { code, question: `Komut hangi iş türü? / Which kind of work is this command? (${ALL_KINDS.join(" | ")})`, options: [...ALL_KINDS] }
  : { code, question: `Komut birden fazla iş türüne uyuyor; hangisi kastedildi? / The command matches several kinds; which one did you mean? (${kinds.join(" | ")})`, options: [...kinds] };
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function intakeCommand(text: unknown, context?: { origin?: unknown; profile?: IntakeProfile }): IntakeResult {
  if (typeof text !== "string") return { ok: false, code: "INTAKE_NOT_STRING" };
  if (CONTROL.test(text)) return { ok: false, code: "INTAKE_CONTROL_CHARS" };
  if (text.trim().length === 0) return { ok: false, code: "INTAKE_EMPTY" };
  if (text.length > INTAKE_MAX_LENGTH) return { ok: false, code: "INTAKE_TOO_LONG" };
  const f = fold(text);
  // Bilinmeyen profil adı reddedilmez, varsayılana düşer: yalnız tam "product-intake" gevşetir (başka her değer varsayılan, muhafazakâr kurallardır).
  const profile: IntakeProfile = context?.profile === "product-intake" ? "product-intake" : "command";
  // Ürün intake'i her zaman build işidir: tür sözcükleri ("review", "test", "security camera") özelliktir, iş türü değil.
  const hits = profile === "product-intake" ? KINDS.filter(([k]) => k === "build") : KINDS.filter(([, re]) => re.test(f));
  const reasons: IntakeReason[] = [];
  let risk = 1;
  for (const [reason, re, r] of flagsFor(profile)) if (re.test(f)) { reasons.push(reason); risk = Math.max(risk, r); }
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
      clarification: hits.length === 1 ? null : clarify(hits.length === 0 ? "KIND_UNKNOWN" : "KIND_AMBIGUOUS", hits.map(([k]) => k)),
    },
  };
}
