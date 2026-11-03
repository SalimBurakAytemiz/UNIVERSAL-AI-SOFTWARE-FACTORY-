// //TR: Bu dosya runner'ın üretilen diff'i için muhafazakâr secret taramasını (private key, AWS/GitHub/Anthropic/OpenAI benzeri token) ve log redaksiyonunu sağlar; eşleşen değer hiçbir zaman kanıta veya log'a yazılmaz, yalnız tür/dosya/satır kaydedilir.
import type {SecretHit} from "./types.js";

// Sıra önemlidir: daha özel desenler (sk-ant-) genel OpenAI benzeri desenden önce gelir.
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ["AWS_ACCESS_KEY", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GITHUB_TOKEN", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/],
  ["ANTHROPIC_KEY", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OPENAI_STYLE_KEY", /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/]
];

export function findSecretKinds(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

// `git diff` çıktısında yalnız eklenen satırlar taranır; hit kaydı değeri değil, yalnız tür/dosya/satır taşır.
// Hunk başlığındaki satır sayıları izlenir: hunk içindeki "+++ ..." / "--- ..." satırları başlık değil içeriktir (eklenen "++ x" satırı taranır).
export function scanDiffForSecrets(diff: string): SecretHit[] {
  const hits: SecretHit[] = [];
  let file = "", line = 0, oldLeft = 0, newLeft = 0;
  for (const raw0 of diff.split("\n")) {
    const raw = raw0.endsWith("\r") ? raw0.slice(0, -1) : raw0;
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        for (const kind of findSecretKinds(raw.slice(1))) hits.push({kind, file: file.slice(0, 500), line});
        line += 1; newLeft -= 1; continue;
      }
      if (raw.startsWith("-")) { oldLeft -= 1; continue; }
      if (raw.startsWith(" ") || raw === "") { line += 1; oldLeft -= 1; newLeft -= 1; continue; }
      if (raw.startsWith("\\")) continue;
      oldLeft = 0; newLeft = 0; // beklenmeyen satır: hunk bitti sayılır, başlık olarak işlenir
    }
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, "").trim(); continue; }
    if (raw.startsWith("--- ")) continue;
    const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) { oldLeft = h[1] === undefined ? 1 : Number(h[1]); line = Number(h[2]); newLeft = h[3] === undefined ? 1 : Number(h[3]); continue; }
    // Hunk dışında beklenmedik "+" satırı da (bozuk/kesilmiş diff) taranır: muhafazakâr davranış.
    if (raw.startsWith("+")) for (const kind of findSecretKinds(raw.slice(1))) hits.push({kind, file: file.slice(0, 500), line});
  }
  return hits;
}

// `git log --format=commit %H%n%B base..head` çıktısı: commit mesajlarının her satırı taranır; dosya alanı "commit-message:<sha>" olur.
export function scanCommitMessagesForSecrets(log: string): SecretHit[] {
  const hits: SecretHit[] = [];
  let sha = "", line = 0;
  for (const raw of log.split("\n")) {
    const m = /^commit ([0-9a-f]{40})\r?$/.exec(raw);
    if (m) { sha = m[1]; line = 0; continue; }
    line += 1;
    for (const kind of findSecretKinds(raw)) hits.push({kind, file: `commit-message:${sha}`, line});
  }
  return hits;
}

// Yalnız REDAKSİYON için (findSecretKinds / diff taraması bunları KULLANMAZ; tarama davranışı değişmez).
// ÖNCE: PEM bloğu BEGIN..END dahil tümüyle; END yoksa (kırpılmış/kesik çıktı) metnin sonuna kadar her şey (başlık deseninden önce: yoksa gövde açıkta kalırdı).
const REDACT_BEFORE: ReadonlyArray<readonly [string, RegExp, string?]> = [
  ["PRIVATE_KEY", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$(?![\s\S]))/g]
];
// SONRA (PATTERNS türlerini koruyarak, ör. `Bearer ghp_...` GITHUB_TOKEN olarak kalır): JWT biçimi, HTTP `Bearer <değer>` / `Basic <base64>`
// (önek korunur, değer gizlenir; değer en az bir rakam taşımalı: "missing Bearer token" / "basic validation" gibi düz metin gizlenmez) ve
// satır sonuyla bölünmüş sk- / sk-ant- anahtarı (önek parçası tam anahtardan kısa {0,19}; devam satırları en az 8 karakterlik anahtar parçası).
const REDACT_AFTER: ReadonlyArray<readonly [string, RegExp, string?]> = [
  ["JWT", /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g],
  ["AUTH_TOKEN", /\b(Bearer)\s+(?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{8,}=*/gi, "$1 "],
  ["AUTH_TOKEN", /\b(Basic)\s+(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{8,}={0,2}/gi, "$1 "],
  ["SPLIT_KEY", /\bsk-(?:ant-)?[A-Za-z0-9_-]{0,19}(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9_-]{8,})+/g]
];
const applyRedact = (text: string, list: ReadonlyArray<readonly [string, RegExp, string?]>) =>
  list.reduce((out, [kind, re, keep]) => out.replace(re, keep ? `${keep}[REDACTED:${kind}]` : `[REDACTED:${kind}]`), text);

// Log'lara yazmadan önce eşleşen her değer sabit bir etiketle değiştirilir.
export function redactSecrets(text: string): string {
  let out = applyRedact(text, REDACT_BEFORE);
  for (const [kind, re] of PATTERNS) out = out.replace(new RegExp(re.source, "g"), `[REDACTED:${kind}]`);
  return applyRedact(out, REDACT_AFTER);
}
