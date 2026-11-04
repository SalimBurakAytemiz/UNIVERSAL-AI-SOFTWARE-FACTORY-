// //TR: OAuth teşhis betiği: uasco-oauth-diagnose workflow'unun her işi (repo kapsamı ve uasco-review environment kapsamı) için tek bir sabit satır üretir: "<kapsam> <varlık> <kod> <httpDurumu>". Sırrın değeri, öneki, uzunluğu, özeti veya parmak izi asla okunmaz, yazılmaz veya hash'lenmez; varlık yalnız workflow ifadesinden gelen true/false bilgisidir ve yürütme kaydının hiçbir metni dışarı çıkmaz.
// Usage: node scripts/ci/uasco-review/oauth-diagnose.mjs   (inputs only from env: PROBE_SCOPE, SECRET_PRESENT, EXECUTION_FILE, GITHUB_STEP_SUMMARY)
// Output, and the only thing written anywhere: one line "<scope> <presence> <code> <httpStatus|->" to the step summary and stdout. Never fails the job.
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {diagnoseReviewerOutput, EXECUTION_FILE_MAX_BYTES} from "./review-gate.mjs";

export const SCOPES = Object.freeze(["repo-scope", "env-scope"]);
// PROBE_SKIPPED: no secret in this scope, so no probe ran. The other codes are diagnoseReviewerOutput codes; an AUTH code is replaced by its subcode.
export const PROBE_SKIPPED = "PROBE_SKIPPED";

// A regular file of at most max bytes, as text; anything else is null.
function readCapped(file, max) {
  if (typeof file !== "string" || file === "") return null;
  try { const st = fs.statSync(file); if (!st.isFile() || st.size > max) return null; return fs.readFileSync(file, "utf8"); } catch { return null; }
}

// env = {PROBE_SCOPE, SECRET_PRESENT ("true"/"false" from the workflow expression), EXECUTION_FILE}. Returns the fixed line (no newline). Never throws.
export function diagnoseLine(env) {
  const e = env && typeof env === "object" ? env : {};
  const scope = SCOPES.includes(e.PROBE_SCOPE) ? e.PROBE_SCOPE : "UNKNOWN_SCOPE";
  // Only the exact strings "true" and "false" count; anything else is unknown (fail-closed, never echoed).
  const presence = e.SECRET_PRESENT === "true" ? "SECRET_PRESENT" : e.SECRET_PRESENT === "false" ? "SECRET_ABSENT" : "SECRET_UNKNOWN";
  if (presence === "SECRET_ABSENT") return `${scope} ${presence} ${PROBE_SKIPPED} -`;
  let d;
  try { d = diagnoseReviewerOutput(readCapped(e.EXECUTION_FILE, EXECUTION_FILE_MAX_BYTES)); } catch { d = diagnoseReviewerOutput(null); }
  const code = d.code === "REVIEWER_AUTH_REJECTED" && typeof d.authSubcode === "string" ? d.authSubcode : d.code;
  const status = Number.isSafeInteger(d.httpStatus) && d.httpStatus >= 400 && d.httpStatus <= 599 ? String(d.httpStatus) : "-";
  return `${scope} ${presence} ${code} ${status}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  let line;
  try { line = diagnoseLine(process.env); } catch { line = "UNKNOWN_SCOPE SECRET_UNKNOWN REVIEWER_OUTPUT_UNREADABLE -"; }
  try { const f = process.env.GITHUB_STEP_SUMMARY; if (f) fs.appendFileSync(f, line + "\n"); } catch { /* never fails the job */ }
  try { process.stdout.write(line + "\n"); } catch { /* never fails the job */ }
}
