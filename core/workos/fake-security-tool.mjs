// //TR: Bu küçük script yalnız testlerde kullanılan deterministik FAKE gitleaks/trivy/semgrep taklitçisidir: argv'yi ve cwd'yi calls.jsonl'e kaydeder, direktif dosyasındaki bulguları gerçek araçların rapor biçiminde yazar; ağ erişimi veya gerçek tarama yapmaz.
import fs from "node:fs";

const [tool, directiveFile, callsFile, startedFlag, ...args] = process.argv.slice(2);
if (args.includes("--version") || args[0] === "version") { console.log(`${tool} fake 0.0.0-test`); process.exit(0); }
let all = {};
try { all = JSON.parse(fs.readFileSync(directiveFile, "utf8")); } catch { console.error("FAKE_DIRECTIVE_INVALID"); process.exit(2); }
const d = all[tool] ?? {};
fs.appendFileSync(callsFile, JSON.stringify({tool, argv: args, cwd: process.cwd()}) + "\n");
fs.writeFileSync(startedFlag, tool);
if (Number.isInteger(d.sleepMs) && d.sleepMs > 0) await new Promise(r => setTimeout(r, Math.min(d.sleepMs, 120_000)));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

if (tool === "gitleaks") {
  const findings = (d.findings ?? []).map(f => ({RuleID: f.ruleId, File: f.file, StartLine: f.line, Commit: f.commit ?? "0".repeat(40), Match: "REDACTED", Secret: d.plantedSecret ?? "REDACTED", Message: d.plantedSecret ? `leaked ${d.plantedSecret}` : "msg"}));
  // Gerçek gitleaks --redact altında stderr'e secret yazmaz; burada redaksiyon katmanını sınamak için isteğe bağlı olarak yazılır.
  if (d.plantedSecret) console.error(`fake gitleaks log: ${d.plantedSecret}`);
  fs.writeFileSync(opt("--report-path"), JSON.stringify(findings));
  process.exit(d.exitCode ?? (findings.length ? 1 : 0));
} else if (tool === "trivy") {
  if (d.dbError) { console.error("FATAL\tFatal error\trun error: init error: DB error: database error: --skip-db-update cannot be specified on the first run"); process.exit(1); }
  if (d.raw !== undefined) { fs.writeFileSync(opt("--output"), d.raw); process.exit(d.exitCode ?? 0); }
  const vulns = (d.vulns ?? []).map(v => ({VulnerabilityID: v.id, PkgName: v.pkg, InstalledVersion: v.version, FixedVersion: v.fixed, Severity: v.severity, Title: "fake"}));
  fs.writeFileSync(opt("--output"), JSON.stringify({SchemaVersion: 2, Results: vulns.length ? [{Target: "package-lock.json", Class: "lang-pkgs", Type: "npm", Vulnerabilities: vulns}] : [{Target: "package-lock.json", Class: "lang-pkgs", Type: "npm", Vulnerabilities: null}]}));
  process.exit(d.exitCode ?? 0);
} else {
  console.error("FAKE_TOOL_UNKNOWN");
  process.exit(2);
}
