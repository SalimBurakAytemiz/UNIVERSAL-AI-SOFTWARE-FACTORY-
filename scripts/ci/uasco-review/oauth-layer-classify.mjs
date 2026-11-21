#!/usr/bin/env node
// OAuth layer diagnostic classifier (local review draft; not wired into any gate).
// Reads one Claude Code output file (stream-json lines, a JSON array or one JSON result object) and prints EXACTLY one line:
//   <probe> <SECRET_PRESENT|SECRET_ABSENT> <CODE> http=<status|-> keySource=<enum|-> isError=<bool|-> subtype=<enum|-> turns=<n|-> modelUsed=<bool>
// It never prints the token, its length, prefix or hash, and never prints model text: error text is only matched against fixed patterns.
// Usage: node oauth-layer-classify.mjs <probe> <secretPresent 0|1> <outputFile> [installOk 0|1]
import {readFileSync, existsSync} from "node:fs";

const KEY_SOURCES = new Set(["none", "ANTHROPIC_API_KEY", "apiKeyHelper", "/login managed key", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"]);
const SUBTYPES = new Set(["success", "error_max_turns", "error_during_execution", "error_max_budget_usd", "error_max_structured_output_retries"]);
const PROBE_RE = /^[a-z0-9-]{1,40}$/;

// Ordered: the first match wins. Matched only against error text of a record that says is_error or failed.
export const RULES = Object.freeze([
  ["OAUTH_METHOD_MISMATCH", /only authorized for use with claude code|oauth authentication is currently not supported|oauth[^\n]{0,80}not (?:supported|allowed)|this credential is not (?:supported|authorized)/i],
  ["CRED_REVOKED", /token (?:has )?been revoked|revoked/i],
  ["CRED_EXPIRED", /token (?:has )?expired|expired (?:oauth )?token/i],
  ["CRED_OAUTH_INVALID", /oauth access token is invalid|invalid oauth|oauth[^\n]{0,40}invalid/i],
  ["CRED_BEARER_REJECTED", /invalid bearer token|invalid authorization|bearer/i],
  ["CRED_APIKEY_PATH", /invalid x-api-key|invalid api key|x-api-key/i],
  ["MODEL_ACCESS", /\bmodel\b[^\n]{0,160}?(?:not[ _]found|not available|unavailable|does(?: not|n't) exist|may not exist|not have access)|not_found_error|issue with the selected model/i],
  ["QUOTA", /credit balance|\bquota\b|usage limit|rate[ _-]?limit|too many requests|limit reached|out_of_credits|overloaded/i],
  ["CRED_REJECTED_OTHER", /authenticat|unauthori[sz]ed|authentication_error|authentication_failed|not logged in|\/login\b/i],
]);

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const intOr = v => (Number.isSafeInteger(v) && v >= 0 ? String(v) : "-");

export function parseRecords(raw) {
  const t = raw.trim();
  if (t === "") return [];
  try { const j = JSON.parse(t); return Array.isArray(j) ? j.filter(isObj) : isObj(j) ? [j] : []; } catch { /* stream-json */ }
  const out = [];
  for (const line of t.split(/\r?\n/)) { try { const j = JSON.parse(line); if (isObj(j)) out.push(j); } catch { /* skip non-JSON lines */ } }
  return out;
}

// Collect only error-ish strings from the result record (never assistant content of a successful run).
function errorText(res, records) {
  const parts = [];
  const push = v => { if (typeof v === "string") parts.push(v); };
  push(res.result); push(res.error); push(res.terminal_reason);
  if (isObj(res.error)) { push(res.error.type); push(res.error.message); }
  if (Array.isArray(res.errors)) res.errors.forEach(e => (isObj(e) ? (push(e.message), push(e.type)) : push(e)));
  // assistant messages flagged as API errors (synthetic error messages from the CLI)
  for (const r of records) if (r.type === "assistant" && (r.error || r.isApiErrorMessage) && isObj(r.message) && Array.isArray(r.message.content))
    r.message.content.forEach(c => isObj(c) && push(c.text));
  return parts.join("\n").slice(0, 20000);
}

function httpStatus(res, text) {
  for (const k of ["api_error_status", "status", "http_status"]) if (Number.isSafeInteger(res[k]) && res[k] >= 100 && res[k] < 600) return String(res[k]);
  const m = /API Error: (\d{3})\b/.exec(text) || /\b(401|403|404|429|529)\b/.exec(text);
  return m ? m[1] : "-";
}

export function classify(probe, secretPresent, raw, installOk = true) {
  const head = `${PROBE_RE.test(probe) ? probe : "invalid-probe"} ${secretPresent ? "SECRET_PRESENT" : "SECRET_ABSENT"}`;
  const tail = (code, f = {}) => `${head} ${code} http=${f.http ?? "-"} keySource=${f.keySource ?? "-"} isError=${f.isError ?? "-"} subtype=${f.subtype ?? "-"} turns=${f.turns ?? "-"} modelUsed=${f.modelUsed ?? false}`;
  if (!secretPresent) return tail("SECRET_ABSENT");
  if (!installOk) return tail("CLI_INSTALL_FAILED");
  const records = parseRecords(raw ?? "");
  const init = records.find(r => r.type === "system" && r.subtype === "init");
  const keySource = init && typeof init.apiKeySource === "string" ? (KEY_SOURCES.has(init.apiKeySource) ? init.apiKeySource : "other") : "-";
  const res = [...records].reverse().find(r => r.type === "result") ?? records.find(r => "is_error" in r && "num_turns" in r);
  if (!res) return tail("ACTION_SDK_NO_RESULT", {keySource});
  const isError = res.is_error === true;
  const modelUsed = (isObj(res.modelUsage) && Object.keys(res.modelUsage).length > 0) || (typeof res.total_cost_usd === "number" && res.total_cost_usd > 0);
  const f = {keySource, isError, subtype: SUBTYPES.has(res.subtype) ? res.subtype : "other", turns: intOr(res.num_turns), modelUsed};
  const failed = isError || (typeof res.subtype === "string" && res.subtype.startsWith("error"));
  if (!failed) return tail(modelUsed ? "AUTH_OK" : "AUTH_OK_NO_USAGE", {...f, http: "-"});
  const text = errorText(res, records);
  const http = httpStatus(res, text);
  // An API-key credential source when only the OAuth token was provided means the CLI took the API-key path, not OAuth.
  if (keySource === "ANTHROPIC_API_KEY" || keySource === "apiKeyHelper") return tail("OAUTH_METHOD_MISMATCH", {...f, http});
  for (const [code, re] of RULES) if (re.test(text)) return tail(code, {...f, http});
  if (http === "401" || http === "403") return tail("CRED_REJECTED_OTHER", {...f, http});
  return tail(modelUsed ? "FAILED_AFTER_MODEL" : "UNCLASSIFIED", {...f, http});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [probe = "", present = "0", file = "", install = "1"] = process.argv.slice(2);
  const raw = file && existsSync(file) ? readFileSync(file, "utf8") : "";
  process.stdout.write(classify(probe, present === "1", raw, install === "1") + "\n");
}
