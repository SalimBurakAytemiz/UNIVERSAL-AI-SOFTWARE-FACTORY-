// //TR: Factory V2 deterministik test/kanıt işçisi (model çağrısı yok): BUILD işinde kendi izole worktree'sinde görev dosyası yazar ve kendi dalına commit eder; REVIEW işinde bağlandığı SHA'ya verdict döner. FACTORY_FAIL ile çökme/auth/çakışma enjeksiyonu yapılır. Gerçek üretim işi değildir; eşzamanlılık ve izolasyon kanıtı içindir.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
const job = JSON.parse(process.env.FACTORY_JOB);
const g = (...a) => { const r = spawnSync("git", a, {encoding: "utf8"}); if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(3); } return r.stdout.trim(); };
const holdMs = Number(process.env.FACTORY_HOLD_MS ?? 1200);
const fail = JSON.parse(process.env.FACTORY_FAIL ?? "{}")[job.taskId];
await new Promise(r => setTimeout(r, holdMs));
if (job.kind === "REVIEW") {
  const remediated = g("log", "-1", "--format=%s", job.headSha).startsWith("REMEDIATE");
  const status = fail?.review === "auth" ? "REVIEWER_AUTH_REJECTED" : fail?.review === "changes" && !remediated ? "CHANGES_REQUESTED" : "CLEAN";
  process.stdout.write(JSON.stringify({status, headSha: job.headSha, baseSha: job.baseSha, reviewerIdentity: job.slotId, blockers: status === "CHANGES_REQUESTED" ? [{id: `B-${job.taskId}`}] : [], resolves: remediated ? [`B-${job.taskId}`] : []}) + "\n");
  process.exit(0);
}
if (fail?.crash && (job.attempt ?? 0) < fail.crash) process.kill(process.pid, "SIGKILL");
if (fail?.auth) { process.stderr.write("REVIEWER_AUTH_REJECTED: builder credentials refused"); process.exit(7); }
const base = g("rev-parse", "HEAD");
const rel = (job.paths?.[0] && !job.paths[0].endsWith("/")) ? job.paths[0] : `work/${job.taskId}.txt`;
fs.mkdirSync(path.dirname(rel), {recursive: true});
fs.writeFileSync(rel, `${job.taskId} by ${job.slotId} pid ${process.pid} kind ${job.kind}\n`);
g("add", rel);
g("-c", "user.name=factory-v2-demo", "-c", "user.email=factory-v2@invalid", "commit", "-q", "-m", `${job.kind} ${job.taskId} (${job.slotId})`);
process.stdout.write(JSON.stringify({headSha: g("rev-parse", "HEAD"), baseSha: base, changedPaths: [rel], builderIdentity: job.slotId, pid: process.pid}) + "\n");
