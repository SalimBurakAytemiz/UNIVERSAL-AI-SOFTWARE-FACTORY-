#!/usr/bin/env node
// //TR: Bu teşhis betiği reviewer OAuth token'ının (CLAUDE_CODE_OAUTH_TOKEN) temiz, başsız (headless) bir Claude CLI oturumunda gerçekten bir model çağrısı yapıp yapamadığını sınar ve sonucu CI'daki reviewer-diagnose ile AYNI sınıflandırıcıyla (review-gate.mjs diagnoseReviewerOutput) raporlar. Token argv'ye, diske ve çıktıya asla yazılmaz; uzunluğu, öneki, özeti yazdırılmaz. Önbellekteki başka bir kimlik bilgisinin sonucu etkilememesi için CLI boş bir ortamla (yalnız PATH + geçici HOME/yapılandırma dizinleri, hiçbir ANTHROPIC_* / CLAUDE_* değişkeni yok) ve depo dışındaki geçici bir dizinde çalışır; önce token'sız bir kontrol çalıştırması "giriş yapılmamış" sonucunu kanıtlamak zorundadır, aksi halde test durur.
// Usage (local, interactive; the token is read from a hidden prompt):
//   node scripts/ci/uasco-review/oauth-probe.mjs [--cli-version 2.1.304 | --claude-bin <path>] [--model claude-sonnet-5-5] [--http]
// Non-interactive: the token is taken from CLAUDE_CODE_OAUTH_TOKEN in this process's environment (never echoed).
// Self-check of the isolation without any real token: --control-only.
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {fileURLToPath} from "node:url";
import {diagnoseReviewerOutput} from "./review-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const flag = name => args.includes(name);
const CLI_VERSION = opt("--cli-version", "2.1.304"); // the version claude-code-action v1.0.254 installs in the ai-review job
const CLAUDE_BIN = opt("--claude-bin", null);
const MODEL = opt("--model", "claude-sonnet-5-5"); // the model the ai-review job initialised with
if (!/^\d+\.\d+\.\d+$/.test(CLI_VERSION) || !/^[a-z0-9][a-z0-9.-]{2,60}$/.test(MODEL)) { console.error("PROBE_USAGE: invalid --cli-version or --model"); process.exit(2); }

let secret = "";
// Every line this script prints goes through here: the token can never appear, even inside an unexpected CLI message.
const say = line => { let s = String(line); if (secret.length >= 8) s = s.split(secret).join("[REDACTED]"); console.log(s); };

const readHidden = prompt => new Promise(resolve => {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
  rl._writeToOutput = s => { if (s.includes(prompt)) process.stdout.write(prompt); }; // nothing typed is echoed
  rl.question(prompt, v => { rl.close(); process.stdout.write("\n"); resolve(v); });
});

// A fresh, empty identity: HOME and every config/cache location point into a new temp dir; nothing from this shell's environment is inherited
// except PATH (and SystemRoot/ComSpec on Windows, which processes need to start) and the TLS trust settings NODE_EXTRA_CA_CERTS/SSL_CERT_FILE. No ANTHROPIC_*, CLAUDE_* or proxy variables reach the CLI.
function cleanEnv(root, token) {
  const home = path.join(root, "home");
  for (const d of ["home", "config", "cache", "tmp", "appdata", "localappdata"]) fs.mkdirSync(path.join(root, d), {recursive: true});
  const e = {PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"), TMPDIR: path.join(root, "tmp"), TEMP: path.join(root, "tmp"), TMP: path.join(root, "tmp"),
    APPDATA: path.join(root, "appdata"), LOCALAPPDATA: path.join(root, "localappdata"), npm_config_cache: path.join(root, "cache", "npm"), NO_COLOR: "1",
    DISABLE_AUTOUPDATER: "1"};
  for (const k of ["SystemRoot", "ComSpec", "PATHEXT", "WINDIR"]) if (process.env[k]) e[k] = process.env[k];
  // TLS trust only (a corporate or sandbox CA bundle); these carry no credential.
  for (const k of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) if (process.env[k]) e[k] = process.env[k];
  if (token) e.CLAUDE_CODE_OAUTH_TOKEN = token;
  return e;
}

function runCli(root, token) {
  const env = cleanEnv(root, token), cwd = path.join(root, "tmp");
  const cliArgs = ["-p", "Reply with exactly: OK", "--output-format", "json", "--max-turns", "1", "--model", MODEL];
  const win = process.platform === "win32";
  const [cmd, argv] = CLAUDE_BIN ? [CLAUDE_BIN, cliArgs] : [win ? "npx.cmd" : "npx", ["-y", `@anthropic-ai/claude-code@${CLI_VERSION}`, ...cliArgs]];
  const r = cp.spawnSync(cmd, argv, {cwd, env, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024, shell: win && !CLAUDE_BIN, windowsHide: true});
  let res = null;
  for (const chunk of [r.stdout, r.stderr]) { if (res) break; for (const l of String(chunk ?? "").split(/\r?\n/).reverse()) { try { const j = JSON.parse(l); if (j && j.type === "result") { res = j; break; } } catch {} } }
  if (!res) { try { const j = JSON.parse(String(r.stdout ?? "").trim()); if (j && j.type === "result") res = j; } catch {} }
  return {exit: r.status, spawnError: r.error ? r.error.code ?? "SPAWN_FAILED" : null, res,
    // Only a fixed class of a non-JSON failure is reported, never its text.
    stderrClass: res ? null : /not logged in|\/login|log ?in/i.test(String(r.stderr) + String(r.stdout)) ? "NOT_LOGGED_IN_TEXT" : (String(r.stderr ?? "").trim() ? "OTHER_STDERR" : "NO_OUTPUT")};
}

function report(phase, run) {
  const d = run.res ? diagnoseReviewerOutput(JSON.stringify([run.res])) : null;
  const okText = run.res && run.res.is_error === false && typeof run.res.result === "string" && run.res.result.trim().replace(/[.!]$/, "") === "OK";
  const modelCall = !!(run.res && ((run.res.modelUsage && Object.keys(run.res.modelUsage).length > 0) || (typeof run.res.total_cost_usd === "number" && run.res.total_cost_usd > 0)));
  // REVIEWER_NO_STRUCTURED_OUTPUT is expected here (the probe asks for plain text): with is_error false and modelUsed true it means the model answered.
  say(`PROBE ${phase}: exit=${run.exit} spawnError=${run.spawnError ?? "-"} subtype=${run.res?.subtype ?? "-"} is_error=${run.res?.is_error ?? "-"} num_turns=${run.res?.num_turns ?? "-"} model_call=${modelCall} answered_OK=${okText} diagnosis=${d ? `${d.code}${d.authSubcode ? " " + d.authSubcode : ""}${d.httpStatus ? " http=" + d.httpStatus : ""}` : run.stderrClass}`);
  return {d, modelCall, okText};
}

async function httpProbe(token) {
  // Raw request with the same OAuth bearer, to separate a 401 from a hidden 429 (the CLI envelope looks the same for both). Only the status, the
  // error type and the rate-limit/request-id headers are printed; no body text.
  const r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers: {"authorization": `Bearer ${token}`, "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json"},
    body: JSON.stringify({model: MODEL, max_tokens: 8, system: "You are Claude Code, Anthropic's official CLI for Claude.", messages: [{role: "user", content: "Reply with exactly: OK"}]})}).catch(e => ({error: e.cause?.code ?? e.name}));
  if (r.error) { say(`PROBE http: network_error=${r.error}`); return; }
  let type = "-"; try { const j = await r.json(); type = j?.error?.type ?? (j?.type === "message" ? `message stop_reason=${j.stop_reason}` : "-"); } catch {}
  const hdr = [...r.headers.entries()].filter(([k]) => /^(anthropic-ratelimit-unified-|retry-after$|request-id$|x-should-retry$)/.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`);
  say(`PROBE http: status=${r.status} type=${type} ${hdr.join(" ")}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-oauth-probe-"));
try {
  say(`PROBE setup: cli=${CLAUDE_BIN ? "custom-bin" : CLI_VERSION} model=${MODEL} platform=${process.platform} isolated_home=yes inherited_env=PATH+TLS-trust-only`);
  // Control: the same isolated CLI with NO token must report "not logged in". If it reaches the model, a cached credential leaked in and the test is void.
  const control = report("control(no token)", runCli(path.join(root, "c"), null));
  if (control.modelCall || control.okText) { say("PROBE RESULT: ISOLATION_BROKEN (the control run without a token reached the model); the comparison is void"); process.exit(3); }
  if (flag("--control-only")) { say("PROBE RESULT: CONTROL_ONLY"); process.exit(0); }
  secret = String(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").trim() || (process.stdin.isTTY ? String(await readHidden("Paste the reviewer OAuth token (hidden): ")).trim() : "");
  if (!secret) { say("PROBE RESULT: NO_TOKEN_GIVEN"); process.exit(2); }
  const real = report("token", runCli(path.join(root, "t"), secret));
  if (flag("--http")) await httpProbe(secret);
  const verdict = real.modelCall && real.okText ? "TOKEN_WORKS_IN_CLEAN_HEADLESS_CLI" : real.d ? `TOKEN_FAILS_IN_CLEAN_HEADLESS_CLI:${real.d.code}${real.d.authSubcode ? ":" + real.d.authSubcode : ""}` : "TOKEN_RESULT_UNREADABLE";
  say(`PROBE RESULT: ${verdict}`);
} finally {
  secret = "";
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 3}); // the isolated home holds no saved credential, but it is removed regardless
}
