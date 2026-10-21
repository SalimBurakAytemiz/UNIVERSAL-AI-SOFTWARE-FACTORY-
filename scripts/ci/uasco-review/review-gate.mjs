// //TR: Bu modül "UASCO Independent Review" zorunlu kontrolünün saf ve deterministik karar çekirdeğidir: governed merge-gate'in CI/PR/diff/korumalı-yol/ruleset kontrollerini yeniden kullanır, bağımsız Claude Reviewer kararını PR head ve base SHA'sına bağlar, eski (stale) kanıtı reddeder ve yalnız her koşul sağlanırsa success döner; diğer her durum fail-closed failure'dır.
// Pure: no I/O, no network, no clock. Every reason is a fixed code; no evidence or verdict text is ever copied into a reason.
import crypto from "node:crypto";
import {evaluateMergeGate, INVISIBLE_RE} from "../../../docs/planning/merge-gate.mjs";

export const CHECK_NAME = "UASCO Independent Review";
export const FOUNDER_ENVIRONMENT = "uasco-founder-authority";
export const VERDICT_RESULTS = Object.freeze(["CLEAN", "BLOCKED", "INCONCLUSIVE"]);
export const SEVERITIES = Object.freeze(["P0", "P1", "P2", "P3"]);
export const CLASSIFICATIONS = Object.freeze(["BLOCKER", "ADVISORY"]);
export const CHECK_KEYS = Object.freeze(["security", "tests", "ciEvidence", "scope"]);
// "tests" may not be NOT_APPLICABLE: a code change without test evidence is never an independent CLEAN.
const CHECK_VALUES = Object.freeze({security: ["PASS", "FAIL", "NOT_APPLICABLE"], tests: ["PASS", "FAIL", "INSUFFICIENT"], ciEvidence: ["PASS", "FAIL"], scope: ["PASS", "FAIL"]});
export const LIMITS = Object.freeze({findings: 50, summary: 4000, text: 2000, file: 400, id: 32});
// The only keys a verdict, a finding and the checks object may carry (the schema's additionalProperties: false, enforced here independently).
export const VERDICT_KEYS = Object.freeze(["result", "reviewedHeadSha", "reviewedBaseSha", "summary", "findings", "checks"]);
export const FINDING_KEYS = Object.freeze(["id", "severity", "classification", "file", "line", "title", "evidence"]);
const knownKeysOnly = (o, keys) => Object.keys(o).every(k => keys.includes(k));

const SHA_RE = /^[0-9a-f]{40}$/;
const SESSION_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isSha = v => isStr(v) && SHA_RE.test(v);
const okText = (v, max) => isStr(v) && v.length <= max && !INVISIBLE_RE.test(v);
// Credential shapes. Verdict text is published in the check run, and a prompt injection could try to make the reviewer echo a token,
// so a verdict carrying any of these is rejected and never rendered.
export const SECRET_PATTERNS = Object.freeze([/sk-ant-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/]);
export const carriesSecret = v => SECRET_PATTERNS.some(re => re.test(JSON.stringify(v ?? null)));

// The merge gate's verdict codes judge a PR-review VERDICT-BINDING line; here the independent review verdict replaces them, so they are dropped.
// BASE_DRIFT is dropped too: pulls.base.sha only moves on a head push, so it would fail every PR after any merge into the base. The verdict is bound to the
// base tip read during the run (VERDICT_BASE_MISMATCH), the diff is computed against that SHA, and up-to-date merging is the ruleset's strict mode.
// Everything else it reports (PR state, base ref, CI, diff completeness, protected paths, ruleset) stays a blocker.
const MERGE_GATE_VERDICT_CODE = /^(?:VERDICT_|REVIEWER_NOT_INDEPENDENT_IDENTITY$|BASE_DRIFT$)/;
// A substantive negative verdict. Re-reviewing the same head or the same tree after one needs Founder authority, so a rejection cannot be re-rolled away.
// INCONCLUSIVE counts (a re-roll could turn it CLEAN), and so does a run that failed only because such a record already exists (the marker stays sticky).
const NEGATIVE_VERDICT_CODE = /^(?:VERDICT_BLOCKED|VERDICT_INCONCLUSIVE|VERDICT_HAS_BLOCKERS|VERDICT_HIGH_SEVERITY|VERDICT_CHECK_NOT_PASS:.+|VERDICT_REJECTED_NEGATIVE|PRIOR_NEGATIVE_VERDICT|DECISION_MISSING_NEGATIVE_VERDICT)$/;
export const negativeVerdict = d => isObj(d) && Array.isArray(d.reasons) && d.reasons.some(x => isStr(x) && NEGATIVE_VERDICT_CODE.test(x));
// Placeholders the ai-review job writes instead of a verdict it cannot publish or read (credential-shaped text; output it could not hand over). Each carries
// whether the replaced verdict was negative (unreadable is counted as negative: its content is unknown).
export const REJECTED_VERDICTS = Object.freeze(["VERDICT_CONTAINS_SECRET_PATTERN", "VERDICT_UNREADABLE"]);
// Is a raw reviewer verdict negative, even when it can never be accepted (malformed, credential-shaped, or no decision was made)? Used so that losing the
// decision, or rejecting the verdict text, never lowers the App's negative record. The credential placeholder carries the flag computed before replacement.
export function verdictIsNegative(v) {
  if (!isObj(v)) return false;
  if (REJECTED_VERDICTS.includes(v.rejected)) return v.negative === true;
  if (v.result === "BLOCKED" || v.result === "INCONCLUSIVE") return true;
  if (Array.isArray(v.findings) && v.findings.some(f => isObj(f) && (f.classification === "BLOCKER" || f.severity === "P0" || f.severity === "P1"))) return true;
  return isObj(v.checks) && CHECK_KEYS.some(k => isStr(v.checks[k]) && v.checks[k] !== "PASS" && v.checks[k] !== "NOT_APPLICABLE");
}
const AUTHORITY_CODE = /^(?:PROTECTED_PATH$|CI_EXECUTED_PATH:)/;

// Canonical JSON (sorted keys) so a digest can be recomputed by anyone from the published evidence file.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

// //TR: Kapı şemaya güvenmez: reviewer'a giden API şeması desteklenmeyen uzunluk/sayı/dizi boyutu anahtar sözcüklerini taşımadığı için şemanın her kısıtı (bilinmeyen anahtar yasağı, boş olmayan id ve özet, uzunluk ve sayı sınırları, satır >= 0) burada bağımsız olarak uygulanır.
// Structural verdict check. Returns a list of fixed codes; empty means the verdict is well formed. It enforces every constraint of verdict.schema.json itself
// (unknown keys, lengths, counts, ranges, patterns), because the schema sent to the reviewer API omits the keywords the API does not support.
export function validateVerdict(v) {
  const r = [];
  if (!isObj(v)) return ["VERDICT_MALFORMED:root"];
  if (!knownKeysOnly(v, VERDICT_KEYS)) r.push("VERDICT_MALFORMED:unknownKey");
  if (!VERDICT_RESULTS.includes(v.result)) r.push("VERDICT_MALFORMED:result");
  if (!isSha(v.reviewedHeadSha)) r.push("VERDICT_MALFORMED:reviewedHeadSha");
  if (!isSha(v.reviewedBaseSha)) r.push("VERDICT_MALFORMED:reviewedBaseSha");
  if (!okText(v.summary, LIMITS.summary) || v.summary.trim() === "") r.push("VERDICT_MALFORMED:summary");
  if (!Array.isArray(v.findings) || v.findings.length > LIMITS.findings) r.push("VERDICT_MALFORMED:findings");
  else for (const f of v.findings) {
    if (!isObj(f) || !knownKeysOnly(f, FINDING_KEYS) || !okText(f.id, LIMITS.id) || f.id.trim() === "" || !SEVERITIES.includes(f.severity) || !CLASSIFICATIONS.includes(f.classification)
      || !okText(f.file, LIMITS.file) || !okText(f.title, LIMITS.text) || !okText(f.evidence, LIMITS.text)
      || !(f.line === null || (Number.isSafeInteger(f.line) && f.line >= 0))) { r.push("VERDICT_MALFORMED:finding"); break; }
  }
  if (!isObj(v.checks) || !knownKeysOnly(v.checks, CHECK_KEYS)) r.push("VERDICT_MALFORMED:checks");
  else for (const k of CHECK_KEYS) if (!CHECK_VALUES[k].includes(v.checks[k])) r.push(`VERDICT_MALFORMED:checks.${k}`);
  return r;
}

// Founder authority for protected or CI-executed paths: an APPROVED review of THIS workflow run's deployment to the Founder-only
// environment, by the configured Founder login. The run itself is bound to one head SHA, so the approval cannot be reused for another commit.
export function founderAuthorityOk(approvals, founderLogin) {
  if (!isStr(founderLogin) || !LOGIN_RE.test(founderLogin) || !Array.isArray(approvals)) return false;
  return approvals.some(a => isObj(a) && a.state === "approved" && isObj(a.user) && isStr(a.user.login) && a.user.login.toLowerCase() === founderLogin.toLowerCase()
    && Array.isArray(a.environments) && a.environments.some(e => isObj(e) && e.name === FOUNDER_ENVIRONMENT));
}

// Deterministic pre-gates only (no verdict): used before the reviewer runs, so a red or incomplete PR never spends review tokens.
export function preGate(evidence) {
  let mg;
  try { mg = evaluateMergeGate(evidence, {mode: "process"}); } catch { return {blockers: ["INTERNAL_ERROR"], authority: [], headSha: null, baseSha: null}; }
  const reasons = Array.isArray(mg.reasons) ? mg.reasons : ["INTERNAL_ERROR"];
  const kept = reasons.filter(x => !MERGE_GATE_VERDICT_CODE.test(x));
  return {blockers: kept.filter(x => !AUTHORITY_CODE.test(x)), authority: kept.filter(x => AUTHORITY_CODE.test(x)), headSha: mg.expectedHeadSha, baseSha: mg.expectedBaseSha};
}

// //TR: Reviewer teşhisi: claude-code-action'ın yürütme kaydındaki son "result" mesajı yalnız bellekte, sabit desenlerle tek bir sabit koda sınıflandırılır; kaydın hiçbir metni (PR içeriği, prompt injection veya sır taşıyabilir) kopyalanmaz, yazılmaz ya da yayımlanmaz. Teşhis yalnız geçmeyen bir karara ek bir blokaj nedeni ve sabit bir çözüm cümlesi ekler; hiçbir nedeni silemez, geçerli olumlu bir kararı etkilemez ve bir başarısızlığı asla başarıya çeviremez.
// Reviewer diagnosis: why the reviewer step gave no usable verdict, as one fixed code. Only these codes and the remedies below are ever written or published;
// no text of the execution record leaves memory. REVIEWER_OK is never a blocking reason.
export const REVIEWER_DIAGNOSTIC_CODES = Object.freeze(["REVIEWER_OK", "REVIEWER_AUTH_REJECTED", "REVIEWER_MODEL_UNAVAILABLE", "REVIEWER_QUOTA_OR_RATE_LIMIT",
  "REVIEWER_SCHEMA_REJECTED", "REVIEWER_NO_STRUCTURED_OUTPUT", "REVIEWER_ERROR_UNCLASSIFIED", "REVIEWER_OUTPUT_UNREADABLE"]);
export const REVIEWER_DIAGNOSTIC_KEYS = Object.freeze(["code", "isError", "turns", "durationMs", "modelUsed"]);
export const EXECUTION_FILE_MAX_BYTES = 4 * 1024 * 1024;
const RERUN = "then start a new review (Re-run all jobs, or Run workflow with the PR number).";
export const REVIEWER_REMEDIES = Object.freeze({
  REVIEWER_AUTH_REJECTED: `The reviewer credential was rejected. Regenerate the reviewer token (claude setup-token) into the review environment secret CLAUDE_CODE_OAUTH_TOKEN, ${RERUN}`,
  REVIEWER_MODEL_UNAVAILABLE: `The requested reviewer model is not available to this credential. Correct or clear the repository variable UASCO_REVIEW_MODEL, ${RERUN}`,
  REVIEWER_QUOTA_OR_RATE_LIMIT: `The reviewer hit a usage, quota or rate limit, or the service was overloaded. Wait until the limit resets, ${RERUN}`,
  // The workflow runs from the default branch, so the schema fix must be merged into v7/integration before a new review can use it.
  REVIEWER_SCHEMA_REJECTED: "The reviewer API refused the verdict schema passed with --json-schema. Fix the schema in scripts/ci/uasco-review (verdict.schema.json) and merge the fix; no credential change is needed. Then start a new review (Re-run all jobs, or Run workflow with the PR number).",
  REVIEWER_NO_STRUCTURED_OUTPUT: "The reviewer ran but returned no schema-valid verdict (for example it reached its turn limit). Start a new review; if this repeats, split the PR into smaller changes.",
  REVIEWER_ERROR_UNCLASSIFIED: `The reviewer failed with an error that matches no known cause. Check the ai-review job log of this run (the reviewer output itself is never published), ${RERUN}`,
  REVIEWER_OUTPUT_UNREADABLE: `The reviewer's execution record was missing or unreadable (the reviewer may not have started). Check the ai-review job log of this run, ${RERUN}`});
// Error texts of the CLI and the API. They are matched only when the record says is_error: the final text of a run without an error is the model's own
// output (shaped by the reviewed PR), so it is never used. Every quantifier is bounded.
const AUTH_RE = /invalid[ _-]?(?:api[ _-]?key|x-api-key|bearer|token|credential|auth)|authenticat|unauthori[sz]ed|\b401\b|oauth|token (?:has )?(?:expired|been revoked|revoked)|(?:expired|revoked) (?:oauth )?token|\/login\b|\blog ?in\b|not logged in/i;
const MODEL_RE = /\bmodel\b[^\n]{0,160}?(?:not[ _]found|not available|unavailable|does(?: not|n't) exist|may not exist|not supported|unsupported|not have access)|(?:unknown|invalid|unsupported|unavailable) model\b|issue with the selected model|not_found_error[\s\S]{0,300}?\bmodel\b|\bmodel\b[\s\S]{0,300}?not_found_error|\b404\b[\s\S]{0,300}?\bmodel\b|\bmodel\b[\s\S]{0,300}?\b404\b/i;
const QUOTA_RE = /credit balance|\bquota\b|usage limit|rate[ _-]?limit|\b429\b|overloaded|\b529\b|too many requests|limit reached/i;
// The request's verdict schema refused by the API (for example 400 invalid_request_error on the JSON schema): a schema term near a refusal word.
const SCHEMA_TERM = "(?:json[ _-]?schema|input_schema|output_format|structured[ _-]?output)", SCHEMA_REFUSAL = "(?:invalid|not supported|unsupported|not allowed|rejected|error)";
const SCHEMA_RE = new RegExp(`${SCHEMA_TERM}[\\s\\S]{0,200}?${SCHEMA_REFUSAL}|${SCHEMA_REFUSAL}[\\s\\S]{0,200}?${SCHEMA_TERM}`, "i");
const count = v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12 ? Math.round(v) : null;
const diagnosis = (code, isError, turns, durationMs, modelUsed) => ({code, isError, turns, durationMs, modelUsed});
// raw = the execution file's text (a JSON array of SDK messages) or null. The LAST {"type":"result"} message is classified. Never throws.
export function diagnoseReviewerOutput(raw) {
  const unreadable = diagnosis("REVIEWER_OUTPUT_UNREADABLE", true, null, null, false);
  try {
    if (!isStr(raw) || raw.trim() === "" || raw.length > EXECUTION_FILE_MAX_BYTES) return unreadable;
    let msgs;
    try { msgs = JSON.parse(raw); } catch { return unreadable; }
    if (!Array.isArray(msgs)) return unreadable;
    let res = null;
    for (let i = msgs.length - 1; i >= 0 && res === null; i--) if (isObj(msgs[i]) && msgs[i].type === "result") res = msgs[i];
    if (res === null) return unreadable;
    const isError = res.is_error === true;
    const modelUsed = (isObj(res.modelUsage) && Object.keys(res.modelUsage).length > 0) || (typeof res.total_cost_usd === "number" && res.total_cost_usd > 0);
    const at = code => diagnosis(code, isError, count(res.num_turns), count(res.duration_ms), modelUsed);
    if (!isError) return at(res.subtype === "success" && res.structured_output !== undefined && res.structured_output !== null ? "REVIEWER_OK" : "REVIEWER_NO_STRUCTURED_OUTPUT");
    const text = [res.result, ...(Array.isArray(res.errors) ? res.errors : [])].filter(isStr).join("\n").slice(0, 65536);
    if (AUTH_RE.test(text)) return at("REVIEWER_AUTH_REJECTED");
    if (MODEL_RE.test(text)) return at("REVIEWER_MODEL_UNAVAILABLE");
    if (QUOTA_RE.test(text)) return at("REVIEWER_QUOTA_OR_RATE_LIMIT");
    // A run that used the model or hit a retry/turn limit got as far as answering: its failure is the missing output, never a refused schema.
    if (modelUsed || (isStr(res.subtype) && res.subtype.startsWith("error_max"))) return at("REVIEWER_NO_STRUCTURED_OUTPUT");
    if (SCHEMA_RE.test(text)) return at("REVIEWER_SCHEMA_REJECTED");
    return at("REVIEWER_ERROR_UNCLASSIFIED");
  } catch {
    return unreadable;
  }
}
// The failure code a diagnostics record carries, or null: an unknown, malformed or REVIEWER_OK code counts as no diagnosis.
export const reviewerFailureCode = d => isObj(d) && isStr(d.code) && d.code !== "REVIEWER_OK" && REVIEWER_DIAGNOSTIC_CODES.includes(d.code) ? d.code : null;

// Final decision. input = {evidence, verdict, currentHeadSha, approvals, policy:{founderLogin, reviewerSession}, reviewerDiagnostics?}.
// reviewerDiagnostics (the ai-review job's fixed-shape record) only adds its failure code after the other reasons when the verdict did not pass.
export function decide(input) {
  try {
    const r = [];
    if (!isObj(input) || !isObj(input.evidence)) return finish(["EVIDENCE_MALFORMED:root"], null, null, input);
    const ev = input.evidence, pol = isObj(input.policy) ? input.policy : {};
    const pre = preGate(ev);
    r.push(...pre.blockers);
    const headSha = isObj(ev.pr) && isObj(ev.pr.head) && isSha(ev.pr.head.sha) ? ev.pr.head.sha : null;
    const baseSha = isSha(ev.currentBaseSha) ? ev.currentBaseSha : null;
    // Staleness: the PR head re-read just before concluding must still be the reviewed head. A newer commit gets its own run and check.
    if (!isSha(input.currentHeadSha)) r.push("EVIDENCE_MALFORMED:currentHeadSha");
    else if (headSha !== null && input.currentHeadSha !== headSha) r.push("STALE_HEAD");
    if (pre.authority.length && !founderAuthorityOk(input.approvals, pol.founderLogin)) r.push("FOUNDER_AUTHORITY_REQUIRED", ...pre.authority);
    // The App's own earlier check on this head or tree ended in a negative verdict (collected from App-written external_id). Unknown is fail-closed.
    if (ev.priorNegativeVerdict !== true && ev.priorNegativeVerdict !== false) r.push("PRIOR_VERDICT_UNKNOWN");
    else if (ev.priorNegativeVerdict && !founderAuthorityOk(input.approvals, pol.founderLogin)) r.push("FOUNDER_AUTHORITY_REQUIRED", "PRIOR_NEGATIVE_VERDICT");
    const v = input.verdict, verdictFrom = r.length;
    if (v === null || v === undefined) r.push("VERDICT_MISSING");
    else if (isObj(v) && REJECTED_VERDICTS.includes(v.rejected)) r.push(v.rejected, ...(v.negative === true ? ["VERDICT_REJECTED_NEGATIVE"] : []));
    else if (carriesSecret(v)) { r.push("VERDICT_CONTAINS_SECRET_PATTERN", ...(verdictIsNegative(v) ? ["VERDICT_REJECTED_NEGATIVE"] : [])); input = {...input, verdict: null}; }
    else {
      const bad = validateVerdict(v);
      // A verdict refused only for its form (an invisible character, an empty summary) still counts as a rejection when its content is negative.
      if (bad.length) r.push(...bad, ...(verdictIsNegative(v) ? ["VERDICT_REJECTED_NEGATIVE"] : []));
      else {
        if (headSha !== null && v.reviewedHeadSha !== headSha) r.push("VERDICT_HEAD_MISMATCH");
        if (baseSha !== null && v.reviewedBaseSha !== baseSha) r.push("VERDICT_BASE_MISMATCH");
        if (v.result !== "CLEAN") r.push(`VERDICT_${v.result}`);
        if (v.findings.some(f => f.classification === "BLOCKER")) r.push("VERDICT_HAS_BLOCKERS");
        if (v.findings.some(f => f.severity === "P0" || f.severity === "P1")) r.push("VERDICT_HIGH_SEVERITY");
        for (const k of CHECK_KEYS) if (!["PASS", "NOT_APPLICABLE"].includes(v.checks[k])) r.push(`VERDICT_CHECK_NOT_PASS:${k}`);
      }
    }
    // Did the verdict itself fail (missing, unreadable, rejected, malformed, unbound or negative)? Only then may a diagnosis add its code.
    const verdictFailed = r.length > verdictFrom;
    // The reviewer must not be one of the PR's implementer sessions (taken from the commits' Claude-Session trailers).
    const impl = new Set(Array.isArray(ev.implementerSessions) ? ev.implementerSessions.filter(isStr) : []);
    if (!isStr(pol.reviewerSession) || !SESSION_RE.test(pol.reviewerSession)) r.push("REVIEWER_SESSION_UNKNOWN");
    else if (impl.has(pol.reviewerSession)) r.push("REVIEWER_IS_IMPLEMENTER");
    // Append-only: the code goes after every other reason, so it can neither remove a reason nor reach a decision that already passed the verdict.
    const diag = verdictFailed ? reviewerFailureCode(input.reviewerDiagnostics) : null;
    if (diag !== null) r.push(diag);
    return finish([...new Set(r)], headSha, baseSha, input);
  } catch {
    return finish(["INTERNAL_ERROR"], null, null, input);
  }
}

function finish(reasons, headSha, baseSha, input) {
  const conclusion = reasons.length === 0 ? "success" : "failure";
  const verdict = isObj(input) && isObj(input.verdict) ? input.verdict : null;
  const ev = isObj(input) && isObj(input.evidence) ? input.evidence : null;
  const record = {check: CHECK_NAME, conclusion, reasons, headSha, baseSha, headTree: ev && isSha(ev.headTree) ? ev.headTree : null, pr: ev && isObj(ev.pr) ? ev.pr.number ?? null : null,
    verdict, reviewerSession: isObj(input) && isObj(input.policy) && isStr(input.policy.reviewerSession) ? input.policy.reviewerSession : null};
  return {...record, digest: sha256(canonical(record))};
}

// Check-run text. Verdict strings are model output from a review of untrusted code: they are flattened, length-bounded and escaped.
const flat = (s, n) => String(s).replace(/[\r\n\t]+/g, " ").replace(/[|`<>]/g, "'").replace(/@/g, "(at)").slice(0, n);
export function renderSummary(d, runUrl) {
  const lines = [`**${d.conclusion === "success" ? "PASS" : "FAIL"}**: ${CHECK_NAME} for head \`${d.headSha ?? "unknown"}\` (base \`${d.baseSha ?? "unknown"}\`).`, "",
    `Evidence digest (sha256 of the canonical decision record): \`${d.digest}\``];
  if (isStr(runUrl) && /^https:\/\/github\.com\/[^\s)]+$/.test(runUrl)) lines.push(`Run and evidence artifact: ${runUrl}`);
  lines.push("", d.reasons.length ? `Blocking reasons: ${d.reasons.map(x => `\`${x}\``).join(", ")}` : "Blocking reasons: none.");
  // A reviewer diagnosis among the reasons gets its fixed remedy sentence (never any text of the reviewer's output).
  for (const c of d.reasons.filter(x => isStr(x) && Object.hasOwn(REVIEWER_REMEDIES, x))) lines.push("", `Reviewer diagnosis \`${c}\`: ${REVIEWER_REMEDIES[c]}`);
  if (d.verdict && Array.isArray(d.verdict.findings)) {
    lines.push("", `Reviewer result: ${flat(d.verdict.result, 20)}. ${flat(d.verdict.summary ?? "", 1500)}`);
    if (d.verdict.findings.length) {
      lines.push("", "| id | severity | class | file:line | title |", "|---|---|---|---|---|");
      for (const f of d.verdict.findings.slice(0, LIMITS.findings)) lines.push(`| ${flat(f.id, 32)} | ${flat(f.severity, 4)} | ${flat(f.classification, 10)} | ${flat(f.file, 200)}:${f.line ?? "-"} | ${flat(f.title, 300)} |`);
    }
  }
  lines.push("", "This check is posted only by the UASCO reviewer GitHub App from the trusted workflow on the default branch (v7/integration). A new commit has no such check until it is reviewed again.");
  return lines.join("\n").slice(0, 60000);
}
