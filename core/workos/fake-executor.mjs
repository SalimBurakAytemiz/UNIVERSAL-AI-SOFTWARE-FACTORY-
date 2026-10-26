// //TR: Bu küçük script yalnız testlerde kullanılan deterministik FAKE executor'dır: implement modunda stdin yönergesindeki dosyaları workspace'e yazıp izole git ile commit eder, review modunda yönergedeki kararı JSON satırı olarak basar; hiçbir sağlayıcı çağırmaz.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";

const [mode, dir] = process.argv.slice(2);
let d = {};
try { d = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { console.error("FAKE_DIRECTIVE_INVALID"); process.exit(2); }
const root = path.resolve(dir ?? ".");
// //TR: C-PAR-1 testleri: implementer'ın bir TORUNU (aynı grupta veya setsid ile kendi oturumunda) delayMs sonra bir dosya yazar. Çöken engine'in yazarının torunları da durdurulmalıdır (grup öldürme + lease işaretli tarama); torun ortamı (lease işareti) miras alır.
if (d.grandchild && typeof d.grandchild.file === "string") {
  const g = d.grandchild;
  const code = `const fs = require("node:fs"); ${typeof g.pidFile === "string" ? `fs.writeFileSync(${JSON.stringify(g.pidFile)}, String(process.pid));` : ""} setTimeout(() => { fs.writeFileSync(${JSON.stringify(g.file)}, "written by a descendant of the crashed engine's implementer\\n"); }, ${Number(g.delayMs) || 0});`;
  cp.spawn(process.execPath, ["-e", code], {detached: g.detached === true, stdio: "ignore", ...(typeof g.cwd === "string" ? {cwd: g.cwd} : {})}).unref();
}
if (Number.isInteger(d.sleepMs) && d.sleepMs > 0) await new Promise(r => setTimeout(r, Math.min(d.sleepMs, 120_000)));
const git = (args) => { const r = spawnGitSync(root, args); if (r.status !== 0) { console.error(`FAKE_GIT_FAILED ${args[0]}: ${r.stderr}`); process.exit(3); } return r.stdout.trim(); };

if (mode === "implement") {
  if (d.stderr) console.error(String(d.stderr));
  for (const [rel, content] of Object.entries(d.files ?? {})) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep) || target.split(path.sep).includes(".git")) { console.error("FAKE_PATH_ESCAPE"); process.exit(2); }
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, String(content));
  }
  for (const rel of d.deleteFiles ?? []) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep) || target.split(path.sep).includes(".git")) { console.error("FAKE_PATH_ESCAPE"); process.exit(2); }
    fs.rmSync(target, {force: true});
  }
  if (!d.noCommit && (d.exitCode ?? 0) === 0) {
    git(["add", "-A"]);
    git(["-c", "user.name=FAKE_IMPLEMENTER", "-c", "user.email=fake-implementer@local.invalid", "commit", "-q", "--allow-empty", "-m", String(d.message ?? "fake implement")]);
    console.log(`FAKE_IMPLEMENT_COMMIT ${git(["rev-parse", "HEAD"])}`);
  }
  process.exit(d.exitCode ?? 0);
} else if (mode === "review") {
  if (d.mutate) fs.writeFileSync(path.join(root, "REVIEWER_WAS_HERE.txt"), "mutated\n");
  console.log(`FAKE_REVIEW diff=${d.diffSha256 ?? "none"}`);
  console.log(d.raw ?? JSON.stringify({verdict: d.verdict ?? "CLEAN", findings: d.findings ?? []}));
  process.exit(d.exitCode ?? 0);
} else {
  console.error("FAKE_MODE_UNKNOWN");
  process.exit(2);
}
