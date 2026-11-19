// //TR: uasco-oauth-diagnose için ağsız kanıt: tek satırlık çıktı yalnız sabit kodlardan oluşur, sır yoksa deneme atlanır, subtype=success ile is_error=true asla başarı sayılmaz ve workflow yalnız elle, boş izinlerle, artifact'sız çalışır; sır yalnız varlık ifadesinde ve token girdisinde geçer.
// Run: node scripts/ci/uasco-review/oauth-diagnose.proof.mjs   (Node >= 22; no network). Last line: "UASCO_OAUTH_DIAG_PROOF: PASS n/n".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {diagnoseLine, SCOPES, PROBE_SKIPPED} from "./oauth-diagnose.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../..");
let n = 0, failures = 0;
const check = (name, cond) => { n++; if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-oauth-diag-"));
let k = 0;
const exec = result => { const f = path.join(tmp, `e${k++}.json`); fs.writeFileSync(f, JSON.stringify([{type: "system", subtype: "init"}, {type: "result", ...result}])); return f; };
const err = (text, o = {}) => exec({subtype: "success", is_error: true, num_turns: 1, duration_ms: 2100, total_cost_usd: 0, modelUsage: {}, result: text, ...o});
// A credential-shaped string planted in the error text (built at run time; not a real credential).
const PLANT = ["sk", "ant", "oat01", "Z".repeat(40)].join("-");
const LINE_RE = /^(repo-scope|env-scope|UNKNOWN_SCOPE) SECRET_(PRESENT|ABSENT|UNKNOWN) [A-Z][A-Z_]{2,40} (\d{3}|-)$/;
const L = (scope, present, file) => diagnoseLine({PROBE_SCOPE: scope, SECRET_PRESENT: present, EXECUTION_FILE: file});

check("O1 the observed failure (Invalid API key, 401) => '<scope> SECRET_PRESENT AUTH_TOKEN_INVALID 401'",
  L("env-scope", "true", err(`Failed to authenticate. API Error: 401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}} ${PLANT}`)) === "env-scope SECRET_PRESENT AUTH_TOKEN_INVALID 401"
  && L("repo-scope", "true", err("OAuth token has expired")) === "repo-scope SECRET_PRESENT AUTH_TOKEN_EXPIRED -");
check("O2 a schema-valid structured output => REVIEWER_OK; subtype=success with is_error=true is never OK; success without structured output is not OK",
  L("repo-scope", "true", exec({subtype: "success", is_error: false, num_turns: 2, modelUsage: {m: {}}, structured_output: {ok: true}})) === "repo-scope SECRET_PRESENT REVIEWER_OK -"
  && !L("repo-scope", "true", err("")).includes("REVIEWER_OK") && !L("repo-scope", "true", exec({subtype: "success", is_error: true, structured_output: {ok: true}, result: "x"})).includes("REVIEWER_OK")
  && L("repo-scope", "true", exec({subtype: "success", is_error: false, num_turns: 1})) === "repo-scope SECRET_PRESENT REVIEWER_NO_STRUCTURED_OUTPUT -");
check("O3 no secret in scope => PROBE_SKIPPED with no status, whatever execution file is named",
  L("env-scope", "false", err("Invalid API key")) === `env-scope SECRET_ABSENT ${PROBE_SKIPPED} -` && L("repo-scope", "false", undefined) === `repo-scope SECRET_ABSENT ${PROBE_SKIPPED} -`);
check("O4 a missing, unset or unreadable execution file (the probe never ran) => REVIEWER_OUTPUT_UNREADABLE",
  ["", undefined, path.join(tmp, "absent.json"), tmp].every(f => L("env-scope", "true", f) === "env-scope SECRET_PRESENT REVIEWER_OUTPUT_UNREADABLE -"));
const weird = [L("x; rm -rf /", "yes", err("x")), L(undefined, undefined, undefined), diagnoseLine(null), diagnoseLine("env-scope"), L("ENV-SCOPE", "TRUE", err("x"))];
check("O5 an unknown scope or presence is normalised (UNKNOWN_SCOPE, SECRET_UNKNOWN) and never echoed", weird.every(l => LINE_RE.test(l) && !/rm -rf|yes|TRUE|ENV-SCOPE/.test(l))
  && weird[0].startsWith("UNKNOWN_SCOPE SECRET_UNKNOWN") && JSON.stringify(SCOPES) === JSON.stringify(["repo-scope", "env-scope"]));
{
  const texts = [`${PLANT} Invalid API key`, `Authorization: Bearer ${PLANT}`, `not logged in ${PLANT}`, `API Error: 429 ${PLANT}`, PLANT, `model x not found ${PLANT}`];
  const lines = texts.flatMap(t => SCOPES.flatMap(s => ["true", "false"].map(p => L(s, p, err(t)))));
  check("O6 every line has the fixed shape '<scope> <presence> <code> <httpStatus|->' and carries none of the error text or the planted credential",
    lines.every(l => LINE_RE.test(l) && !l.includes("sk-ant") && !l.includes("Bearer") && !l.includes("ZZZZ") && !/[a-z]{3,}/.test(l.replace(/^(repo|env)-scope/, ""))));
}
{
  const sum = path.join(tmp, "summary.md");
  const r = spawnSync(process.execPath, [path.join(HERE, "oauth-diagnose.mjs"), err(`Invalid API key ${PLANT}`)], {encoding: "utf8",
    env: {PATH: process.env.PATH, PROBE_SCOPE: "env-scope", SECRET_PRESENT: "true", EXECUTION_FILE: err(`API Error: 401 invalid x-api-key ${PLANT}`), GITHUB_STEP_SUMMARY: sum}});
  const s = fs.readFileSync(sum, "utf8");
  check("O7 the real script writes exactly one fixed line to the step summary and stdout, exits 0, takes nothing from argv, and logs no error text",
    r.status === 0 && s === "env-scope SECRET_PRESENT AUTH_TOKEN_INVALID 401\n" && r.stdout === s && r.stderr === "" && ![s, r.stdout, r.stderr].some(x => x.includes("sk-ant") || x.includes("x-api-key")));
}
// ---- The workflow ----
const WF = ".github/workflows/uasco-oauth-diagnose.yml";
const text = fs.readFileSync(path.join(ROOT, WF), "utf8"), review = fs.readFileSync(path.join(ROOT, ".github/workflows/uasco-independent-review.yml"), "utf8");
let wf = null;
// Real YAML parse (js-yaml, as in review-gate.proof.mjs). Unavailable or unparseable fails every W check (JOBS is then empty and W0 fails).
try { wf = createRequire(import.meta.url)("js-yaml").load(text); } catch { wf = null; }
const jobs = wf?.jobs ?? {}, steps = j => jobs[j]?.steps ?? [];
check("W0 the workflow parses as YAML into the two jobs", wf !== null && Object.keys(jobs).length === 2);
check("W1 workflow_dispatch only, with no inputs; top-level permissions {}; exactly the jobs repo-scope and env-scope, each pinned to v7/integration with contents: read only",
  wf !== null && JSON.stringify(Object.keys(wf.on ?? {})) === JSON.stringify(["workflow_dispatch"]) && (wf.on.workflow_dispatch === null || Object.keys(wf.on.workflow_dispatch).length === 0)
  && JSON.stringify(wf.permissions) === "{}" && JSON.stringify(Object.keys(jobs)) === JSON.stringify(["repo-scope", "env-scope"])
  && Object.values(jobs).every(j => j.if === "github.ref == 'refs/heads/v7/integration'" && JSON.stringify(j.permissions) === JSON.stringify({contents: "read"})));
check("W2 repo-scope has no environment; env-scope runs in uasco-review (the environment ai-review uses)",
  !("environment" in (jobs["repo-scope"] ?? {})) && jobs["env-scope"]?.environment === "uasco-review" && /\n {4}environment: uasco-review\n/.test(review));
const usesOf = j => steps(j).map(s => s.uses).filter(Boolean);
const pin = (review.match(/anthropics\/claude-code-action@[0-9a-f]{40}/) ?? [""])[0];
check("W3 no artifact upload or download, no cache, no extra actions: only the review workflow's pinned checkout, setup-node and claude-code-action",
  Object.keys(jobs).length === 2 && Object.keys(jobs).every(j => usesOf(j).length === 3 && usesOf(j).every(u => /@[0-9a-f]{40}$/.test(u) && review.includes(u))) && pin !== "" && Object.keys(jobs).every(j => usesOf(j)[2] === pin)
  && !/upload-artifact|download-artifact|actions\/cache|show_full_output/.test(text));
const secretRefs = text.match(/secrets\.[A-Za-z_]+/g) ?? [];
check("W4 the secret appears only in the presence expression (secrets.X != '') and in the action's claude_code_oauth_token input; no run step references any secret",
  Object.keys(jobs).length === 2 && secretRefs.length === 4 && secretRefs.every(x => x === "secrets.CLAUDE_CODE_OAUTH_TOKEN")
  && Object.keys(jobs).every(j => steps(j).filter(s => s.run).every(s => !/secrets\./.test(s.run) && !/secrets\./.test(JSON.stringify(s.env ?? {}).replace(/"\$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN != '' \}\}"/, "")))
    && steps(j).find(s => s.id === "probe")?.with?.claude_code_oauth_token === "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}" && steps(j).at(-1)?.run === "node scripts/ci/uasco-review/oauth-diagnose.mjs")
  && (text.match(/\$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN != '' \}\}/g) ?? []).length === 2 && !/anthropic_api_key|use_bedrock|use_vertex|use_foundry/.test(text));
check("W5 the probe is minimal and read-only: at most 3 turns, a tiny schema, no shell, edit or web tools; it never fails the job; the diagnose step always runs",
  Object.keys(jobs).length === 2 && Object.keys(jobs).every(j => { const p = steps(j).find(s => s.id === "probe"), d = steps(j).at(-1); return p?.["continue-on-error"] === true && p?.if === "steps.presence.outputs.present == 'true'"
    && /--max-turns 3"?$/.test(p.with.claude_args) && /--disallowedTools Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task/.test(p.with.claude_args) && p.with.prompt.length < 40
    && d?.if === "always()" && d.env?.PROBE_SCOPE === j && d.env?.EXECUTION_FILE === "${{ steps.probe.outputs.execution_file }}"; }));
fs.rmSync(tmp, {recursive: true, force: true});
console.log(`UASCO_OAUTH_DIAG_PROOF: ${failures === 0 ? "PASS" : "FAIL"} ${n - failures}/${n}`);
process.exit(failures === 0 ? 0 : 1);
