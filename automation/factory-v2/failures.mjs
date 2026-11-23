// //TR: Factory V2 hata sınıflandırıcı ve sınırlı yeniden deneme: hatalar TEMPORARY/PERMANENT/AUTHORIZATION/SECURITY olarak ayrılır; yalnız geçici hatalar üstel geri çekilmeyle sınırlı sayıda yeniden denenir, yetki/güvenlik hataları yeniden denenmez ve görevi BLOCKED yapar (sonsuz döngü yok).
const RULES = [
  ["SECURITY", /SECRET_LEAK|SANDBOX_ESCAPE|TRUST_ROOT|PROTECTED_PATH_WRITE|INJECTION/],
  ["AUTHORIZATION", /AUTH_REJECTED|REVIEWER_AUTH|\b401\b|\b403\b|FORBIDDEN|FOUNDER_REQUIRED|PERMISSION_DENIED/],
  ["TEMPORARY", /RATE_LIMIT|\b429\b|\b5\d\d\b|ETIMEDOUT|ECONNRESET|EAI_AGAIN|TIMEOUT|LEASE_LOST|WORKER_CRASH|SESSION_TERMINATED|FLAKE|BASE_MOVED|UNAVAILABLE|OVERLOADED/],
  ["PERMANENT", /.*/]
];
export function classify(err) {
  const s = String(err?.code ?? "") + " " + String(err?.message ?? err ?? "");
  for (const [k, re] of RULES) if (re.test(s)) return k;
  return "PERMANENT";
}
/** Next action for a failed attempt. attempt is 1-based count of attempts already made. */
export function nextRetry(err, attempt, {maxAttempts = 3, baseMs = 2_000, capMs = 120_000} = {}) {
  const kind = classify(err);
  if (kind === "SECURITY" || kind === "AUTHORIZATION") return {kind, action: "BLOCK", delayMs: null};
  if (kind === "PERMANENT" || attempt >= maxAttempts) return {kind, action: "FAIL", delayMs: null};
  return {kind, action: "RETRY", delayMs: Math.min(capMs, baseMs * 2 ** (attempt - 1))};
}
