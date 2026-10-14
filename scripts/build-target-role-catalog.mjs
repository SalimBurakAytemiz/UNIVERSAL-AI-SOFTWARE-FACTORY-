// //TR: Bu script Master V2 kaynak dosyasindan 599 rollu hedef katalogu ve 363 kayitli rol uzlastirmasini deterministik uretir; runtime durumu iddia etmez.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-target-role-catalog.mjs <master.md> [--check]"); process.exit(2); }
const check = process.argv.includes("--check");
const raw = fs.readFileSync(src);
const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
const lines = raw.toString("utf8").split(/\r?\n/);
const at = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
const cells = (l) => l.split("|").slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ""));
const conflicts = [];

// Cluster table (section 4) and guild table (section 4.1)
const cS = at(/^## 4\. Dünya ölçeğinde uzman ekip mimarisi/);
const clusters = []; const clusterCounts = {};
for (let i = cS + 3; /^\|/.test(lines[i]); i++) {
  const c = cells(lines[i]);
  if (c[0].startsWith("**")) break;
  clusters.push({ clusterId: "CL" + String(clusters.length + 1).padStart(2, "0"), name: c[0] });
  clusterCounts[c[0]] = { guilds: Number(c[1]), roles: Number(c[2]) };
}
conflicts.push({ type: "DERIVED_ID", field: "clusters[].clusterId", detail: "Source names clusters but defines no cluster id; CL01..CL10 are assigned in source table order (derived, not source-defined)." });
const gS = at(/^### 4\.1 51 guild tam envanteri/);
const guilds = []; const guildPrio = {};
for (let i = gS + 3; /^\|/.test(lines[i]); i++) {
  const c = cells(lines[i]);
  const cl = clusters.find((x) => x.name === c[1]);
  if (!cl) conflicts.push({ type: "UNKNOWN_CLUSTER", guildId: c[0], detail: c[1] });
  guilds.push({ guildId: c[0], name: c[2], clusterId: cl ? cl.clusterId : null, declaredRoleCount: Number(c[3]) });
  guildPrio[c[0]] = c[4];
}
const gEnd = gS + 3 + guilds.length;

// Roster (section 12)
const rS = at(/^### G01 — /);
const roles = []; let cur = null; let rEnd = rS; const headCount = {};
for (let i = rS; i < lines.length; i++) {
  const l = lines[i];
  const h = l.match(/^### (G\d+) — (.+?) \((\d+) profil\)/);
  if (h) { cur = guilds.find((g) => g.guildId === h[1]); headCount[h[1]] = Number(h[3]); if (!cur || cur.name !== h[2]) conflicts.push({ type: "GUILD_NAME_MISMATCH", guildId: h[1], detail: `roster heading "${h[2]}" vs table "${cur && cur.name}"` }); continue; }
  if (/^## /.test(l) || /^### /.test(l)) break;
  const m = l.match(/^\| `(UASCO-\d{4})` \| (.+?) \| (.+?) \|$/);
  if (m && cur) {
    rEnd = i;
    roles.push({ roleId: m[1], title: m[2], guildId: cur.guildId, clusterId: cur.clusterId, priority: m[3] || null, lifecycle: "TARGET", runtimeStatus: "NOT_IMPLEMENTED", certification: "NOT_EVALUATED" });
  }
}
roles.sort((a, b) => a.roleId.localeCompare(b.roleId));
for (const g of guilds) {
  const n = roles.filter((r) => r.guildId === g.guildId).length;
  if (n !== g.declaredRoleCount || n !== headCount[g.guildId]) conflicts.push({ type: "GUILD_COUNT_MISMATCH", guildId: g.guildId, detail: `rows=${n} table=${g.declaredRoleCount} heading=${headCount[g.guildId]}` });
  if (guildPrio[g.guildId] && roles.some((r) => r.guildId === g.guildId && r.priority !== guildPrio[g.guildId]))
    conflicts.push({ type: "PRIORITY_DIFFERS_FROM_GUILD_TABLE", guildId: g.guildId, detail: `guild table says ${guildPrio[g.guildId]}; role rows carry per-role priority (role-row value kept per role)` });
}
for (const c of clusters) {
  const gs = guilds.filter((g) => g.clusterId === c.clusterId);
  const rn = roles.filter((r) => r.clusterId === c.clusterId).length;
  if (gs.length !== clusterCounts[c.name].guilds || rn !== clusterCounts[c.name].roles) conflicts.push({ type: "CLUSTER_COUNT_MISMATCH", clusterId: c.clusterId, detail: `guilds=${gs.length}/${clusterCounts[c.name].guilds} roles=${rn}/${clusterCounts[c.name].roles}` });
}
// Cross-check: pilot table (section 5.3) title and guild name vs roster
const pS = at(/^### 5\.3 27 pilot/);
let pilotChecked = 0;
for (let i = pS + 3; /^\|/.test(lines[i]); i++) {
  const c = cells(lines[i]); const r = roles.find((x) => x.roleId === c[1]);
  const g = r && guilds.find((x) => x.guildId === r.guildId);
  pilotChecked++;
  if (!r || r.title !== c[2] || g.name !== c[3]) conflicts.push({ type: "PILOT_TABLE_DISAGREES", roleId: c[1], detail: `pilot: "${c[2]}" / "${c[3]}"; roster: "${r && r.title}" / "${g && g.name}"` });
}
const catalog = {
  "//TR": "Bu dosya Master V2 hedef 599 rol katalogudur; yalnizca hedef envanterdir, runtime/sertifika durumu iddia etmez.",
  schemaVersion: "1.0.0",
  status: "TARGET_CATALOG_NOT_RUNTIME",
  source: {
    file: path.basename(src), sha256,
    lineRanges: [
      { what: "cluster table (section 4)", from: cS + 1, to: cS + 3 + clusters.length },
      { what: "guild table (section 4.1)", from: gS + 1, to: gEnd },
      { what: "role roster (section 12)", from: rS + 1, to: rEnd + 1 },
      { what: "pilot cross-check (section 5.3)", from: pS + 1, to: pS + 3 + pilotChecked },
    ],
    crossChecked: { pilotRows: pilotChecked },
  },
  clusters,
  guilds: guilds.map(({ declaredRoleCount, ...g }) => g),
  roles,
  conflicts,
};
const out = JSON.stringify(catalog, null, 2) + "\n";

// Reconciliation vs registries/agents.json
const reg = JSON.parse(fs.readFileSync("registries/agents.json", "utf8")).agents;
const norm = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["and", "principal", "expert", "engineer", "architect", "agent", "specialist", "senior", "lead", "the", "of"]);
const toks = (s) => new Set(norm(s).split(" ").filter((t) => t && !STOP.has(t)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const byNorm = new Map();
for (const r of roles) { const k = norm(r.title); byNorm.set(k, [...(byNorm.get(k) || []), r]); }
const mappings = []; const usedT = new Set(); const unmatchedReg = [];
for (const a of reg) {
  const ex = byNorm.get(norm(a.name));
  if (ex && ex.length === 1) { mappings.push({ registeredId: a.id, registeredName: a.name, targetRoleId: ex[0].roleId, targetTitle: ex[0].title, status: "EXACT", basis: "normalized title equality" }); usedT.add(ex[0].roleId); continue; }
  const ta = toks(a.name); let best = null;
  for (const r of roles) { const s = jac(ta, toks(r.title)); if (s > 0 && (!best || s > best.s)) best = { s, r }; }
  if (best && best.s >= 0.6) { mappings.push({ registeredId: a.id, registeredName: a.name, targetRoleId: best.r.roleId, targetTitle: best.r.title, status: "CANDIDATE_NEEDS_REVIEW", basis: `token Jaccard ${best.s.toFixed(3)} after dropping seniority/generic words` }); usedT.add(best.r.roleId); }
  else unmatchedReg.push({ registeredId: a.id, registeredName: a.name });
}
const recon = {
  "//TR": "Bu dosya 363 kayitli rolun hedef rollerle baslik bazli aday eslesmesidir; hicbir eslesme otomatik onaylanmamistir.",
  schemaVersion: "1.0.0",
  status: "RECONCILIATION_CANDIDATES_NOT_CONFIRMED",
  sourceCatalog: "registries/target-role-catalog.json",
  registeredCount: reg.length,
  rule: "EXACT = equal after case/punctuation/ampersand normalization and unique; CANDIDATE_NEEDS_REVIEW = token Jaccard >= 0.6 (generic seniority words dropped). Nothing is confirmed; every row needs human review.",
  mappings,
  unmatchedRegistered: unmatchedReg,
  unmatchedTarget: roles.filter((r) => !usedT.has(r.roleId)).map((r) => ({ roleId: r.roleId, title: r.title })),
  summary: { exact: mappings.filter((m) => m.status === "EXACT").length, candidate: mappings.filter((m) => m.status === "CANDIDATE_NEEDS_REVIEW").length, unmatchedRegistered: unmatchedReg.length, unmatchedTarget: roles.length - usedT.size },
};
const out2 = JSON.stringify(recon, null, 2) + "\n";

const files = [["registries/target-role-catalog.json", out], ["registries/target-role-reconciliation.json", out2]];
if (check) {
  const bad = files.filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, "utf8") !== c);
  if (bad.length) { console.error("CATALOG_REPRODUCE: FAIL " + bad.map((b) => b[0]).join(",")); process.exit(2); }
  console.log("CATALOG_REPRODUCE: PASS");
} else {
  for (const [f, c] of files) fs.writeFileSync(f, c);
  console.log(`roles=${roles.length} guilds=${guilds.length} clusters=${clusters.length} conflicts=${conflicts.length} exact=${recon.summary.exact} candidate=${recon.summary.candidate}`);
}
