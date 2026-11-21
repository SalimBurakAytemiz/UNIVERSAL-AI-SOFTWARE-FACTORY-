// //TR: OAuth katman teşhisi sınıflandırıcısı: uasco-oauth-layer-diagnose workflow'unun her denemesi için tek bir sabit satır üretir. Token'ın değeri, öneki, uzunluğu, özeti veya parmak izi asla okunmaz; varlık yalnız workflow ifadesinden gelen "true"/"false" bilgisidir. Model metni ve hata metni asla yazılmaz: hata metni yalnız sabit desenlerle eşleştirilir. Hiçbir kapıya bağlı değildir.
// One-time OAuth layer diagnostic classifier (not read by any gate). Builds on the #341 approach (oauth-diagnose.mjs): inputs from env only, the secret's
// presence only from the workflow expression, a size cap, one fixed line, never fails the job. It adds a finer server-text code, the credential source
// and the CLI version the CLI itself reports, and the production gate's own classification (diagnoseReviewerOutput) of the same output for comparison.
// Usage: node scripts/ci/uasco-review/oauth-layer-classify.mjs   (env: PROBE, SECRET_PRESENT, OUTPUT_FILE, INSTALL_OK, EXPECT_CLI, GITHUB_STEP_SUMMARY)
// Output line: <probe> <SECRET_PRESENT|SECRET_ABSENT|SECRET_UNKNOWN> <CODE> http=<status|-> keySource=<enum|-> cli=<x.y.z|-> model=<id|-> gate=<code|-> turns=<n|-> modelUsed=<bool>
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {diagnoseReviewerOutput, EXECUTION_FILE_MAX_BYTES} from "./review-gate.mjs";

export const PROBES = Object.freeze(["cli-304-plain", "cli-304-actionenv", "cli-323-plain", "action-pinned", "action-pinned-323"]);
export const CODES = Object.freeze(["SECRET_ABSENT", "CLI_INSTALL_FAILED", "CLI_VERSION_MISMATCH", "NO_RESULT", "AUTH_OK", "OAUTH_METHOD_MISMATCH",
  "CRED_REVOKED", "CRED_EXPIRED", "CRED_OAUTH_INVALID", "CRED_BEARER_INVALID", "CRED_APIKEY_PATH", "CRED_FORBIDDEN", "MODEL_ACCESS", "QUOTA",
  "CRED_NOT_OAUTH_FORMAT", "CRED_REJECTED_OTHER", "FAILED_AFTER_MODEL", "UNCLASSIFIED"]);
// The credential sources Claude Code reports in its init record. Any other value is printed as "other", never echoed.
const KEY_SOURCES = new Set(["none", "ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key"]);
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/, MODEL_ID_RE = /^[a-z0-9][a-z0-9.:-]{0,63}$/;

// Ordered; the first match wins. Matched only against error text of a failed result. Observed from Claude Code 2.1.304 itself on 2026-11-21 with
// throwaway non-credentials in CLAUDE_CODE_OAUTH_TOKEN (keySource=none in every case):
//   OAuth access-token format (also truncated, or with a trailing space/newline) => "401 OAuth access token is invalid."  (the #1613/#1614 text)
//   arbitrary text, a quoted value, or a value with a leading label             => "401 Invalid bearer token"
//   API-key or refresh-token format                                            => "Not logged in · Please run /login"
// The production gate (review-gate.mjs) maps "Invalid bearer token" to AUTH_TOKEN_INVALID but "OAuth access token is invalid." to AUTH_UNSPECIFIED; the
// gate= field prints that mapping so a probe line can be compared with the App check's subcode.
export const RULES = Object.freeze([
  ["OAUTH_METHOD_MISMATCH", /only authori[sz]ed for use with claude code|oauth[^\n]{0,60}?(?:not (?:currently )?supported|unsupported|not allowed|not permitted)|(?:not (?:currently )?supported|unsupported)[^\n]{0,60}?oauth/i],
  ["CRED_REVOKED", /(?:token|credential|key)[^\n]{0,40}?\brevoked\b|token_revoked/i],
  ["CRED_EXPIRED", /(?:token|credential|session)[^\n]{0,40}?\bexpired\b|token_expired/i],
  ["CRED_OAUTH_INVALID", /oauth access token is invalid|invalid[ _-]oauth[ _-]token|oauth[^\n]{0,40}?\binvalid\b/i],
  ["CRED_BEARER_INVALID", /invalid bearer token/i],
  ["CRED_APIKEY_PATH", /invalid[ _-]?x-api-key|invalid[ _-]api[ _-]?key|incorrect[ _-]api[ _-]?key/i],
  ["CRED_FORBIDDEN", /\b403\b|forbidden|permission_error/i],
  ["MODEL_ACCESS", /\bmodel\b[^\n]{0,160}?(?:not[ _]found|not available|unavailable|does(?: not|n't) exist|may not exist|not have access)|not_found_error|issue with the selected model/i],
  ["QUOTA", /credit balance|\bquota\b|usage limit|rate[ _-]?limit|too many requests|limit reached|out_of_credits|overloaded|\b429\b|\b529\b/i],
  ["CRED_NOT_OAUTH_FORMAT", /not logged in/i],
  ["CRED_REJECTED_OTHER", /authenticat|unauthori[sz]ed|\b401\b|\/login\b/i],
]);

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = v => typeof v === "string";
const intOr = v => (Number.isSafeInteger(v) && v >= 0 ? String(v) : "-");

// A regular file of at most max bytes, as text; anything else is null (from #341).
export function readCapped(file, max = EXECUTION_FILE_MAX_BYTES) {
  if (!isStr(file) || file === "") return null;
  try { const st = fs.statSync(file); if (!st.isFile() || st.size > max) return null; return fs.readFileSync(file, "utf8"); } catch { return null; }
}

// The Action's execution file is one JSON array of SDK messages; `claude -p --output-format stream-json` writes one JSON object per line.
export function parseRecords(raw) {
  if (!isStr(raw) || raw.trim() === "") return [];
  try { const j = JSON.parse(raw); return Array.isArray(j) ? j.filter(isObj) : isObj(j) ? [j] : []; } catch { /* stream-json */ }
  const out = [];
  for (const line of raw.split(/\r?\n/)) { if (line.trim() === "") continue; try { const j = JSON.parse(line); if (isObj(j)) out.push(j); } catch { /* not JSON */ } }
  return out;
}

// Only error strings of the result record and of the CLI's synthetic API-error messages; never assistant text of a run that did not fail.
function errorText(res, records) {
  const parts = [];
  const push = v => { if (isStr(v)) parts.push(v); };
  push(res.result); push(res.error);
  if (Array.isArray(res.errors)) res.errors.forEach(e => (isObj(e) ? (push(e.message), push(e.type)) : push(e)));
  for (const r of records) {
    if (r.type === "system" && r.subtype === "api_retry") push(r.error);
    if (r.type === "assistant" && isStr(r.error) && isObj(r.message) && r.message.model === "<synthetic>" && Array.isArray(r.message.content))
      r.message.content.forEach(c => isObj(c) && push(c.text));
  }
  return parts.join("\n").slice(0, 65536);
}

function httpStatus(res, records, text) {
  const ok = n => Number.isSafeInteger(n) && n >= 400 && n <= 599;
  if (ok(res.api_error_status)) return String(res.api_error_status);
  const retry = records.find(r => r.type === "system" && r.subtype === "api_retry" && ok(r.error_status));
  if (retry) return String(retry.error_status);
  const m = /api error:? (\d{3})\b/i.exec(text);
  return m && ok(Number(m[1])) ? m[1] : "-";
}

// env = {PROBE, SECRET_PRESENT ("true"/"false"), INSTALL_OK ("true"/"false"), EXPECT_CLI (x.y.z or ""), OUTPUT_FILE}; raw overrides the file (tests).
// Returns the fixed line without a newline. Never throws.
export function classifyLine(env, raw = undefined) {
  const e = isObj(env) ? env : {};
  const probe = PROBES.includes(e.PROBE) ? e.PROBE : "UNKNOWN_PROBE";
  const presence = e.SECRET_PRESENT === "true" ? "SECRET_PRESENT" : e.SECRET_PRESENT === "false" ? "SECRET_ABSENT" : "SECRET_UNKNOWN";
  const f = {http: "-", keySource: "-", cli: "-", model: "-", gate: "-", turns: "-", modelUsed: false};
  const line = code => `${probe} ${presence} ${code} http=${f.http} keySource=${f.keySource} cli=${f.cli} model=${f.model} gate=${f.gate} turns=${f.turns} modelUsed=${f.modelUsed}`;
  try {
    if (presence === "SECRET_ABSENT") return line("SECRET_ABSENT");
    if (e.INSTALL_OK === "false") return line("CLI_INSTALL_FAILED");
    const text0 = raw !== undefined ? (isStr(raw) && raw.length <= EXECUTION_FILE_MAX_BYTES ? raw : null) : readCapped(e.OUTPUT_FILE);
    const records = parseRecords(text0);
    const init = records.find(r => r.type === "system" && r.subtype === "init");
    if (init) {
      f.keySource = isStr(init.apiKeySource) ? (KEY_SOURCES.has(init.apiKeySource) ? init.apiKeySource.replace(/\s+/g, "_") : "other") : "-";
      f.cli = isStr(init.claude_code_version) && VERSION_RE.test(init.claude_code_version) ? init.claude_code_version : "-";
      f.model = isStr(init.model) && MODEL_ID_RE.test(init.model) ? init.model : "-";
    }
    const d = diagnoseReviewerOutput(JSON.stringify(records));
    f.gate = d.code === "REVIEWER_AUTH_REJECTED" && isStr(d.authSubcode) ? d.authSubcode : d.code;
    let res = null;
    for (let i = records.length - 1; i >= 0 && res === null; i--) if (records[i].type === "result") res = records[i];
    if (res === null) return line("NO_RESULT");
    f.turns = intOr(res.num_turns);
    f.modelUsed = (isObj(res.modelUsage) && Object.keys(res.modelUsage).length > 0) || (typeof res.total_cost_usd === "number" && res.total_cost_usd > 0);
    // The probe must have run the CLI version it was meant to test; otherwise its outcome says nothing about that version.
    if (isStr(e.EXPECT_CLI) && VERSION_RE.test(e.EXPECT_CLI) && f.cli !== e.EXPECT_CLI) return line("CLI_VERSION_MISMATCH");
    const failed = res.is_error === true || (isStr(res.subtype) && res.subtype.startsWith("error"));
    if (!failed) return line("AUTH_OK");
    const text = errorText(res, records);
    f.http = httpStatus(res, records, text);
    // An API-key source while only the OAuth token was given means the CLI took the API-key path, not OAuth.
    if (f.keySource === "ANTHROPIC_API_KEY" || f.keySource === "apiKeyHelper") return line("OAUTH_METHOD_MISMATCH");
    for (const [code, re] of RULES) if (re.test(text)) return line(code);
    return line(f.modelUsed ? "FAILED_AFTER_MODEL" : "UNCLASSIFIED");
  } catch {
    return line("UNCLASSIFIED");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let out;
  try { out = classifyLine(process.env); } catch { out = "UNKNOWN_PROBE SECRET_UNKNOWN UNCLASSIFIED"; }
  try { const s = process.env.GITHUB_STEP_SUMMARY; if (s) fs.appendFileSync(s, out + "\n"); } catch { /* never fails the job */ }
  try { process.stdout.write(out + "\n"); } catch { /* never fails the job */ }
}
