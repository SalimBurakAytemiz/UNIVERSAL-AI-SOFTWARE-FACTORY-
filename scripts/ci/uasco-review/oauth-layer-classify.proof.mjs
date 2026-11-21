// //TR: OAuth katman teşhisi için ağsız kanıt: sınıflandırıcının kodları, gizlilik garantileri (token, model metni, hata metni yazılmaz) ve workflow'un statik güvenlik özellikleri (salt okunur izinler, yalnız elle tetikleme, sabitlenmiş Action, API anahtarı ve tam çıktı yok).
// Network-free proof for the one-time OAuth layer diagnostic. Last line: "UASCO_OAUTH_LAYER_PROOF: PASS n/n" or "... FAIL k/n".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {classifyLine, parseRecords, readCapped, PROBES, CODES, RULES} from "./oauth-layer-classify.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
let pass = 0, total = 0;
const check = (name, ok) => { total++; if (ok) pass++; else console.log(`FAIL ${name}`); };

// Record shapes as Claude Code 2.1.304 wrote them on 2026-11-21 (stream-json, throwaway non-credential), trimmed to the fields the classifier reads.
const init = (o = {}) => ({type: "system", subtype: "init", apiKeySource: "none", claude_code_version: "2.1.304", model: "claude-sonnet-5-5", ...o});
const retry = status => ({type: "system", subtype: "api_retry", attempt: 1, error_status: status, error: "authentication_failed"});
const synth = text => ({type: "assistant", error: "authentication_failed", message: {model: "<synthetic>", role: "assistant", content: [{type: "text", text}]}});
const result = (text, o = {}) => ({type: "result", subtype: "success", is_error: true, num_turns: 1, total_cost_usd: 0, modelUsage: {}, terminal_reason: "api_error", api_error_status: 401, result: text, ...o});
const failRun = (text, o = {}, i = {}) => [init(i), retry(o.api_error_status ?? 401), synth(text), result(text, o)];
const jsonl = recs => recs.map(r => JSON.stringify(r)).join("\n") + "\n";
const ENV = {PROBE: "cli-304-plain", SECRET_PRESENT: "true", INSTALL_OK: "true", EXPECT_CLI: "2.1.304"};
const run = (recs, env = {}) => classifyLine({...ENV, ...env}, typeof recs === "string" ? recs : jsonl(recs));
const codeOf = l => l.split(" ")[2];
const field = (l, k) => (new RegExp(`\\b${k}=(\\S+)`).exec(l) ?? [])[1];
const LINE_RE = /^(?:cli-304-plain|cli-304-actionenv|cli-323-plain|action-pinned|action-pinned-323|UNKNOWN_PROBE) SECRET_(?:PRESENT|ABSENT|UNKNOWN) [A-Z_]+ http=(?:[45]\d\d|-) keySource=(?:none|ANTHROPIC_API_KEY|apiKeyHelper|\/login_managed_key|other|-) cli=(?:\d+\.\d+\.\d+|-) model=(?:[a-z0-9][a-z0-9.:-]{0,63}|-) gate=(?:[A-Z_]+|-) turns=(?:\d+|-) modelUsed=(?:true|false)$/;

// C1-C2b: the three texts observed from the real CLI are told apart, and the production gate's different mapping of them is printed.
const oauthInvalid = run(failRun("Failed to authenticate. API Error: 401 OAuth access token is invalid."));
const bearerInvalid = run(failRun("Failed to authenticate. API Error: 401 Invalid bearer token"));
check("C1 OAuth-format token refused => CRED_OAUTH_INVALID, http=401, keySource=none, gate=AUTH_UNSPECIFIED",
  codeOf(oauthInvalid) === "CRED_OAUTH_INVALID" && field(oauthInvalid, "http") === "401" && field(oauthInvalid, "keySource") === "none" && field(oauthInvalid, "gate") === "AUTH_UNSPECIFIED");
check("C2 non-OAuth string refused => CRED_BEARER_INVALID, gate=AUTH_TOKEN_INVALID", codeOf(bearerInvalid) === "CRED_BEARER_INVALID" && field(bearerInvalid, "gate") === "AUTH_TOKEN_INVALID");
const notLogged = run(failRun("Not logged in · Please run /login"));
check("C2b API-key/refresh-token format in the OAuth variable => CRED_NOT_OAUTH_FORMAT, gate=AUTH_NOT_LOGGED_IN", codeOf(notLogged) === "CRED_NOT_OAUTH_FORMAT" && field(notLogged, "gate") === "AUTH_NOT_LOGGED_IN");
check("C3 init fields: cli and model from the CLI's own init record", field(oauthInvalid, "cli") === "2.1.304" && field(oauthInvalid, "model") === "claude-sonnet-5-5");
// C4-C12: each failure class.
const cases = [
  ["API Error: 401 OAuth access token has been revoked.", "CRED_REVOKED"], ["OAuth token has expired", "CRED_EXPIRED"],
  ["This credential is only authorized for use with Claude Code and cannot be used for other API requests.", "OAUTH_METHOD_MISMATCH"],
  ["OAuth authentication is currently not supported.", "OAUTH_METHOD_MISMATCH"],
  ['API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', "CRED_APIKEY_PATH"],
  ['API Error: 403 {"type":"error","error":{"type":"permission_error"}}', "CRED_FORBIDDEN"],
  ["There's an issue with the selected model (x). It may not exist or you may not have access to it.", "MODEL_ACCESS"],
  ["Claude AI usage limit reached|1760000000", "QUOTA"], ['API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', "QUOTA"],
  ["Failed to authenticate.", "CRED_REJECTED_OTHER"], ["something else entirely", "UNCLASSIFIED"]];
for (const [t, want] of cases) check(`C4 ${want}: ${t.slice(0, 40)}`, codeOf(run([init(), result(t, {api_error_status: undefined})])) === want);
check("C5 an API-key credential source => OAUTH_METHOD_MISMATCH even with an auth text", codeOf(run(failRun("Invalid bearer token", {}, {apiKeySource: "ANTHROPIC_API_KEY"}))) === "OAUTH_METHOD_MISMATCH");
const ok = run([init(), {type: "result", subtype: "success", is_error: false, num_turns: 1, modelUsage: {m: {inputTokens: 3}}, result: "OK"}]);
check("C6 a run that answered => AUTH_OK, modelUsed=true, http=-", codeOf(ok) === "AUTH_OK" && field(ok, "modelUsed") === "true" && field(ok, "http") === "-");
check("C7 a different CLI than the probe expects => CLI_VERSION_MISMATCH", codeOf(run(failRun("Invalid bearer token"), {EXPECT_CLI: "2.1.323"})) === "CLI_VERSION_MISMATCH");
check("C8 the Action's execution file (one JSON array) is read like stream-json", codeOf(run(JSON.stringify(failRun("OAuth access token is invalid."), null, 2), {PROBE: "action-pinned"})) === "CRED_OAUTH_INVALID");
check("C9 no result record, empty, non-JSON or oversized input => NO_RESULT",
  ["", "garbage", jsonl([init()]), "x".repeat(4 * 1024 * 1024 + 1)].every(r => codeOf(run(r)) === "NO_RESULT"));
check("C10 secret absent => SECRET_ABSENT; install failed => CLI_INSTALL_FAILED", codeOf(run([], {SECRET_PRESENT: "false"})) === "SECRET_ABSENT" && codeOf(run([], {INSTALL_OK: "false"})) === "CLI_INSTALL_FAILED");
check("C11 presence and probe are enums: anything else is SECRET_UNKNOWN / UNKNOWN_PROBE", run([], {SECRET_PRESENT: "1", PROBE: "x; rm -rf"}).startsWith("UNKNOWN_PROBE SECRET_UNKNOWN "));
check("C12 every rule code and result code is declared", RULES.every(([c]) => CODES.includes(c)) && PROBES.length === 5);

// S1-S6: nothing but fixed tokens is ever printed.
const SECRETISH = "sk-ant-oat01-THISISNOTAREALTOKENxxxxxxxxxxxxxxxxxxxxxxxx";
const leaky = [init({model: SECRETISH, apiKeySource: SECRETISH, claude_code_version: SECRETISH}), synth(`401 ${SECRETISH} OAuth access token is invalid`),
  result(`Failed to authenticate. API Error: 401 OAuth access token is invalid. ${SECRETISH}`)];
const leakLine = run(leaky);
check("S1 no input text reaches the line (token-like value in every string field)", !leakLine.includes(SECRETISH) && !leakLine.includes("sk-ant") && field(leakLine, "keySource") === "other" && field(leakLine, "model") === "-");
check("S2 model text of a successful run is never printed", !run([init(), {type: "result", subtype: "success", is_error: false, num_turns: 1, result: "MODEL_SAYS_SECRET"}]).includes("MODEL_SAYS_SECRET"));
const all = [oauthInvalid, bearerInvalid, ok, leakLine, ...cases.map(([t]) => run([init(), result(t)])), run(""), run([], {SECRET_PRESENT: "false"})];
check("S3 every line has the fixed shape and a declared code", all.every(l => LINE_RE.test(l) && CODES.includes(codeOf(l))));
check("S4 assistant text that is not a synthetic CLI error is not used as error text",
  codeOf(run([init(), {type: "assistant", message: {model: "claude-x", content: [{type: "text", text: "OAuth access token is invalid"}]}}, result("odd")])) === "UNCLASSIFIED");
check("S5 never throws on hostile input", [null, 1, {}, [], "[null,1,\"x\"]", "{\"type\":\"result\",\"num_turns\":-1,\"result\":{}}"].every(r => { try { return typeof classifyLine(ENV, r) === "string"; } catch { return false; } }));
check("S6 readCapped refuses directories, missing files and oversize files", readCapped(os.tmpdir()) === null && readCapped(path.join(os.tmpdir(), "nope-" + process.pid)) === null && readCapped("x", 1) === null && parseRecords(null).length === 0);

// E1: the entrypoint as the workflow runs it: one line on stdout and in the step summary, exit 0, the token env never echoed.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-layer-"));
const out = path.join(tmp, "o.jsonl"), sum = path.join(tmp, "summary.md");
fs.writeFileSync(out, jsonl(failRun("Failed to authenticate. API Error: 401 OAuth access token is invalid.")));
const env = {PATH: process.env.PATH, ...ENV, OUTPUT_FILE: out, GITHUB_STEP_SUMMARY: sum, CLAUDE_CODE_OAUTH_TOKEN: SECRETISH, TOK: SECRETISH};
const r = spawnSync(process.execPath, [path.join(HERE, "oauth-layer-classify.mjs")], {env, encoding: "utf8", timeout: 30000});
const s = fs.existsSync(sum) ? fs.readFileSync(sum, "utf8") : "";
check("E1 entrypoint: exit 0, exactly one fixed line, same line in the step summary, no token", r.status === 0 && r.stdout.trim().split("\n").length === 1
  && LINE_RE.test(r.stdout.trim()) && s.trim() === r.stdout.trim() && !(r.stdout + r.stderr + s).includes(SECRETISH));
fs.rmSync(tmp, {recursive: true, force: true});

// W1-W12: static properties of the workflow.
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/uasco-oauth-layer-diagnose.yml"), "utf8");
const code = wf.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
check("W1 manual trigger only", /^on:\n  workflow_dispatch: \{\}\n/m.test(code) && !/pull_request|push:|schedule:|workflow_run|issue_comment/.test(code));
check("W2 top-level permissions {} and every job contents: read only", /^permissions: \{\}$/m.test(code) && (code.match(/^ {4}permissions: (.*)$/gm) ?? []).every(l => l.trim() === "permissions: {contents: read}")
  && (code.match(/^ {4}permissions:/gm) ?? []).length === 2 && !/: write\b/.test(code));
check("W3 every job is gated to v7/integration and the uasco-review environment", (code.match(/^ {4}if: github\.ref == 'refs\/heads\/v7\/integration'$/gm) ?? []).length === 2
  && (code.match(/^ {4}environment: uasco-review$/gm) ?? []).length === 2);
check("W4 the action is the pinned commit and every uses: is pinned to a full SHA", /anthropics\/claude-code-action@db77d4d3c98f3f6380e7cd45ffba2342a3dbde3c /.test(code)
  && (code.match(/uses: \S+/g) ?? []).every(u => /@[0-9a-f]{40}$/.test(u)));
check("W5 no API key, no full output, no report, no artifact upload", !/anthropic_api_key|show_full_output|display_report|upload-artifact|ANTHROPIC_API_KEY: \$\{\{/.test(code));
check("W6 the only secret is CLAUDE_CODE_OAUTH_TOKEN, used in the probe step, the action input and presence expressions",
  (code.match(/secrets\.[A-Z_]+/g) ?? []).every(x => x === "secrets.CLAUDE_CODE_OAUTH_TOKEN") && (code.match(/secrets\.CLAUDE_CODE_OAUTH_TOKEN/g) ?? []).length === 4);
check("W7 the install command is the pinned action's own (buildInstallCommand)", (code.match(/set -o pipefail; curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash -s -- \$VERSION/g) ?? []).length === 2);
check("W8 the probes match the classifier's probe list", PROBES.every(p => code.includes(`probe: ${p},`)));
check("W9 one turn, no tools, the same prompt for the CLI and the action", (code.match(/--max-turns 1/g) ?? []).length === 2 && (code.match(/--disallowedTools/g) ?? []).length === 2
  && /claude" -p "\$PROMPT"/.test(code.replace(/\$HOME\/\.local\/bin\/claude/, "claude")) && /prompt: \$\{\{ env\.PROMPT \}\}/.test(code));
check("W10 no untrusted event text is interpolated", !/github\.event\.|inputs\./.test(code));
check("W11 raw output is deleted and never cat/echoed", (code.match(/rm -f "\$RUNNER_TEMP\//g) ?? []).length === 2 && !/\bcat\b|::debug|set -x/.test(code));
check("W12 the action runs before any checkout (empty workspace)", code.indexOf("anthropics/claude-code-action@") < code.lastIndexOf("actions/checkout@"));

console.log(`UASCO_OAUTH_LAYER_PROOF: ${pass === total ? "PASS" : "FAIL"} ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
