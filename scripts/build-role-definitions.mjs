// //TR: Bu script Master V2 kaynak dosyasından ve depodaki WFR-02 doğrulanmış eşleme kanıtından tek kanonik 599 RoleDefinition kaydını (registries/role-definitions.json) bayt-bayt yeniden üretilebilir şekilde oluşturur; runtime, yeterlilik veya sertifika durumu iddia etmez ve hiçbir eşlemeyi onaylamaz.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const MASTER_V2_SHA256 = "35d00e292d89bad59316e8f9b31ee39f4aaf7a34c9eba1e3077763f962512a1d";
const REGISTRY = "registries/role-definitions.json";
const RECON = "registries/target-role-reconciliation.json";
const LEGACY = "registries/agents.json";
const WFR02_DIR = "registries/sources/wfr02";
const WFR02_FILES = ["chunk-1-verified.json", "chunk-2-verified.json", "chunk-3-verified.json", "SUMMARY.json"];
const ALIAS_STATUSES = ["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED", "CONFLICT", "MISSING_SOURCE", "REJECTED", "UNMAPPED"];
// //TR: Zorunlu grup boşsa somut gap kimliği yazılır; validator aynı eşlemeyi bağımsız olarak denetler.
const MANDATORY_GROUPS = [
  ["requiredSkillIds", "SKILLS"], ["desiredMasteryLevels", "MASTERY"], ["requiredTechnologies", "TECHNOLOGIES"],
  ["toolAdapterIds", "TOOL-ADAPTERS"], ["domainPacks", "DOMAIN-PACKS"], ["responsibilities", "RESPONSIBILITIES"],
  ["forbiddenActions", "FORBIDDEN-ACTIONS"], ["knowledgeSourceRefs", "KNOWLEDGE-SOURCES"], ["allowedWorkerScope", "WORKER-SCOPE"],
  ["permissionGrants", "PERMISSION-GRANTS"], ["evaluatorEvidenceRefs", "EVALUATION"],
];

const src = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!src) { console.error("usage: node scripts/build-role-definitions.mjs <master.md> [--check]"); process.exit(2); }
const check = process.argv.includes("--check");
const fail = (m) => { console.error("ROLE_DEFINITIONS_BUILD: FAIL " + m); process.exit(2); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const raw = fs.readFileSync(src);
const sha256 = sha(raw);
if (sha256 !== MASTER_V2_SHA256) fail(`master sha256 ${sha256} != ${MASTER_V2_SHA256}`);
const SRC = path.basename(src);
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
  guilds.push({ guildId: c[0], name: c[2], clusterId: cl ? cl.clusterId : null, declaredRoleCount: Number(c[3]), sourceLine: i + 1 });
  guildPrio[c[0]] = c[4];
}
const gEnd = gS + 3 + guilds.length;

// Roster (section 12)
const rS = at(/^### G01 — /);
const roster = []; let cur = null; let rEnd = rS; const headCount = {};
for (let i = rS; i < lines.length; i++) {
  const l = lines[i];
  const h = l.match(/^### (G\d+) — (.+?) \((\d+) profil\)/);
  if (h) { cur = guilds.find((g) => g.guildId === h[1]); headCount[h[1]] = Number(h[3]); if (!cur || cur.name !== h[2]) conflicts.push({ type: "GUILD_NAME_MISMATCH", guildId: h[1], detail: `roster heading "${h[2]}" vs table "${cur && cur.name}"` }); continue; }
  if (/^## /.test(l) || /^### /.test(l)) break;
  const m = l.match(/^\| `(UASCO-\d{4})` \| (.+?) \| (.+?) \|$/);
  if (m && cur) { rEnd = i; roster.push({ roleId: m[1], title: m[2], guildId: cur.guildId, clusterId: cur.clusterId, priority: m[3] || null, line: i + 1 }); }
}
roster.sort((a, b) => a.roleId.localeCompare(b.roleId));
for (const g of guilds) {
  const n = roster.filter((r) => r.guildId === g.guildId).length;
  if (n !== g.declaredRoleCount || n !== headCount[g.guildId]) conflicts.push({ type: "GUILD_COUNT_MISMATCH", guildId: g.guildId, detail: `rows=${n} table=${g.declaredRoleCount} heading=${headCount[g.guildId]}` });
  if (guildPrio[g.guildId] && roster.some((r) => r.guildId === g.guildId && r.priority !== guildPrio[g.guildId]))
    conflicts.push({ type: "PRIORITY_DIFFERS_FROM_GUILD_TABLE", guildId: g.guildId, detail: `guild table says ${guildPrio[g.guildId]}; role rows carry per-role priority (role-row value kept per role)` });
}
for (const c of clusters) {
  const gs = guilds.filter((g) => g.clusterId === c.clusterId);
  const rn = roster.filter((r) => r.clusterId === c.clusterId).length;
  if (gs.length !== clusterCounts[c.name].guilds || rn !== clusterCounts[c.name].roles) conflicts.push({ type: "CLUSTER_COUNT_MISMATCH", clusterId: c.clusterId, detail: `guilds=${gs.length}/${clusterCounts[c.name].guilds} roles=${rn}/${clusterCounts[c.name].roles}` });
}
// Cross-check: pilot table (section 5.3) title and guild name vs roster
const pS = at(/^### 5\.3 27 pilot/);
let pilotChecked = 0;
for (let i = pS + 3; /^\|/.test(lines[i]); i++) {
  const c = cells(lines[i]); const r = roster.find((x) => x.roleId === c[1]);
  const g = r && guilds.find((x) => x.guildId === r.guildId);
  pilotChecked++;
  if (!r || r.title !== c[2] || g.name !== c[3]) conflicts.push({ type: "PILOT_TABLE_DISAGREES", roleId: c[1], detail: `pilot: "${c[2]}" / "${c[3]}"; roster: "${r && r.title}" / "${g && g.name}"` });
}

// Genome contracts ("# UASCO-nnnn | title" ... "---"), sections A-H
const genome = new Map(); let genomeFirst = -1, genomeLast = -1;
const list = (s) => { const t = s.trim().replace(/\.$/, ""); return t === "Yok" || t === "" ? [] : t.split(/,\s*/).map((x) => x.trim()).filter(Boolean); };
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^# (UASCO-\d{4}) \| (.+)$/);
  if (!m) continue;
  let end = i + 1; while (end < lines.length && lines[end] !== "---") end++;
  if (end >= lines.length) fail(`genome ${m[1]} has no terminating ---`);
  if (genome.has(m[1])) conflicts.push({ type: "GENOME_DUPLICATE", roleId: m[1], detail: `second heading at line ${i + 1}` });
  const g = { roleId: m[1], title: m[2], line: i + 1, toLine: end, sections: {}, A: [], C: [], D: [], F: [], evs: [], required: null, optional: null, unverified: null, modules: [] };
  let sec = null;
  for (let j = i + 1; j < end; j++) {
    const l = lines[j]; let x;
    if ((x = l.match(/^## ([A-H])\. /))) { sec = x[1]; g.sections[sec] = j + 1; continue; }
    if (sec === null) {
      if ((x = l.match(/^- \*\*Departman:\*\* `(G\d+)` (.+)$/))) { g.guildId = x[1]; g.guildName = x[2]; }
      else if ((x = l.match(/^- \*\*Ana organizasyon:\*\* (.+?); \*\*Öncelik:\*\* (\S+)$/))) { g.clusterName = x[1]; g.priority = x[2]; }
      else if ((x = l.match(/^- \*\*Özelleşme:\*\* (.+)$/))) g.specialization = x[1].trim();
      else if ((x = l.match(/^- \*\*Rolüne özgü modüller:\*\* (.+)$/))) g.modules = list(x[1]);
      continue;
    }
    if (sec === "B") {
      if ((x = l.match(/^\*\*Zorunlu değerlendirme adayı[^:]*:\*\* (.*)$/))) g.required = list(x[1]);
      else if ((x = l.match(/^\*\*Tamamlayıcı adaylar:\*\* (.*)$/))) g.optional = x[1].trim() === "İlgili projeye göre seçilir." ? [] : list(x[1]);
      else if ((x = l.match(/^\*\*Yeni\/eski kayıtta doğrulanmayan teknoloji adları:\*\* (.*)$/))) g.unverified = list(x[1]);
      continue;
    }
    if (sec === "E") { if ((x = l.match(/^### (EV-0[1-6]) \| ([A-Z_]+)$/))) g.evs.push({ evaluationId: x[1], kind: x[2], line: j + 1 }); continue; }
    if ((x = l.match(/^- (.+)$/)) && "ACDF".includes(sec)) g[sec].push({ text: x[1].trim(), line: j + 1 });
  }
  genome.set(m[1], g);
  if (genomeFirst < 0) genomeFirst = i + 1;
  genomeLast = end;
}

// Legacy registry (frozen, LEGACY_REFERENCE_ONLY) and WFR-02 verified mapping evidence
const legacyRaw = fs.readFileSync(LEGACY);
const legacy = JSON.parse(legacyRaw.toString("utf8")).agents;
const legacyById = new Map(legacy.map((a) => [a.id, a]));
const sums = new Map(fs.readFileSync(path.join(WFR02_DIR, "SHA256SUMS"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => { const m = l.match(/^([0-9a-f]{64}) \*?(.+)$/); if (!m) fail(`bad SHA256SUMS line ${l}`); return [m[2], m[1]]; }));
const evidenceFiles = [];
const wfr02 = {};
for (const f of WFR02_FILES) {
  const stored = fs.readFileSync(path.join(WFR02_DIR, f), "utf8");
  const ls = stored.split("\n");
  if (!/^ {2}"\/\/TR": ".*",$/.test(ls[1])) fail(`${f}: expected the injected //TR line at line 2`);
  const original = [ls[0], ...ls.slice(2)].join("\n");
  const want = sums.get(f);
  if (!want || sha(Buffer.from(original, "utf8")) !== want) fail(`${f}: sha256 after removing the //TR line does not match SHA256SUMS`);
  evidenceFiles.push({ path: `${WFR02_DIR}/${f}`, originalSha256: want, storedSha256: sha(Buffer.from(stored, "utf8")) });
  wfr02[f] = JSON.parse(stored);
}
const roleIds = new Set(roster.map((r) => r.roleId));
const aliasesByRole = new Map(); const legacyUnmapped = []; const pairSeen = new Map();
const addAlias = (roleId, alias) => {
  if (!roleIds.has(roleId)) fail(`alias target ${roleId} is not a catalog role (legacy ${alias.legacyId})`);
  const k = `${alias.legacyId}>${roleId}`;
  if (pairSeen.has(k)) { conflicts.push({ type: "LEGACY_ALIAS_PAIR_DUPLICATE", roleId, legacyId: alias.legacyId, detail: `${pairSeen.get(k)} and ${alias.status}; first kept` }); return; }
  pairSeen.set(k, alias.status);
  aliasesByRole.set(roleId, [...(aliasesByRole.get(roleId) || []), alias]);
};
const legacyTitle = (id, wfrTitle, ref) => {
  const a = legacyById.get(id);
  if (!a) fail(`legacy id ${id} from ${ref} is not in ${LEGACY}`);
  if (wfrTitle && wfrTitle !== a.name) conflicts.push({ type: "LEGACY_TITLE_MISMATCH", legacyId: id, detail: `wfr02 "${wfrTitle}" vs agents.json "${a.name}"` });
  return a.name;
};
const seenLegacy = new Set();
for (const f of WFR02_FILES.slice(0, 3)) {
  for (const e of wfr02[f].entries) {
    const ref = `${WFR02_DIR}/${f}#entries[legacyId=${e.legacyId}]`;
    if (seenLegacy.has(e.legacyId)) fail(`legacy id ${e.legacyId} appears twice in wfr02 entries`);
    seenLegacy.add(e.legacyId);
    const title = legacyTitle(e.legacyId, e.legacyTitle ?? e.legacyName, ref);
    if (!ALIAS_STATUSES.includes(e.finalStatus)) fail(`${ref}: status ${e.finalStatus} not allowed`);
    if (e.finalTargetRoleId) {
      const r = roster.find((x) => x.roleId === e.finalTargetRoleId);
      if (r && e.finalTargetTitle && e.finalTargetTitle !== r.title) conflicts.push({ type: "WFR02_TARGET_TITLE_MISMATCH", roleId: r.roleId, legacyId: e.legacyId, detail: `wfr02 "${e.finalTargetTitle}" vs catalog "${r.title}"` });
      addAlias(e.finalTargetRoleId, { legacyId: e.legacyId, legacyTitle: title, status: e.finalStatus, approval: "PROPOSED", evidenceRef: ref });
    } else {
      const u = { legacyId: e.legacyId, legacyTitle: title, status: e.finalStatus, approval: "PROPOSED", evidenceRef: ref };
      if (Array.isArray(e.conflictCandidates) && e.conflictCandidates.length) {
        u.conflictCandidates = [...e.conflictCandidates].sort();
        for (const c of u.conflictCandidates) addAlias(c, { legacyId: e.legacyId, legacyTitle: title, status: "CONFLICT", approval: "PROPOSED", evidenceRef: ref });
      }
      legacyUnmapped.push(u);
    }
  }
}
if (seenLegacy.size !== legacy.length) fail(`wfr02 covers ${seenLegacy.size} legacy ids, agents.json has ${legacy.length}`);
// //TR: Bağımsız doğrulayıcının açıkça reddettiği sezgisel çiftler REJECTED takma adı olarak kaydedilir; böylece bilinen kötü eşleme hiçbir zaman doğrulanmış görünemez.
const rejected = [];
for (const [i, x] of wfr02["chunk-1-verified.json"].crossDomainHeuristicPairsObservedNotProposed.entries()) rejected.push({ f: "chunk-1-verified.json", field: "crossDomainHeuristicPairsObservedNotProposed", i, legacyId: x.legacyId, roleId: (x.pair.match(/UASCO-\d{4}/) || [])[0] });
for (const [i, x] of wfr02["chunk-2-verified.json"].heuristicCrossDomainNotAdopted.entries()) rejected.push({ f: "chunk-2-verified.json", field: "heuristicCrossDomainNotAdopted", i, legacyId: x.legacyId, roleId: x.targetRoleId });
for (const [i, x] of wfr02["chunk-3-verified.json"].heuristicPairsJudgedWrong.entries()) rejected.push({ f: "chunk-3-verified.json", field: "heuristicPairsJudgedWrong", i, legacyId: (x.pair.match(/^(\d{3}) /) || [])[1], roleId: (x.pair.match(/UASCO-\d{4}/) || [])[0] });
for (const x of rejected) {
  if (!x.legacyId || !x.roleId) fail(`unparseable rejected pair ${x.f}#${x.field}[${x.i}]`);
  const ref = `${WFR02_DIR}/${x.f}#${x.field}[${x.i}]`;
  addAlias(x.roleId, { legacyId: x.legacyId, legacyTitle: legacyTitle(x.legacyId, null, ref), status: "REJECTED", approval: "PROPOSED", evidenceRef: ref });
}
legacyUnmapped.sort((a, b) => a.legacyId.localeCompare(b.legacyId));

// RoleDefinitions (contract section 3)
const ref = (line) => `${SRC}#L${line}`;
const prioDiff = new Map();
const roles = roster.map((r) => {
  const g = genome.get(r.roleId);
  if (!g) fail(`no genome contract for ${r.roleId}`);
  const gd = guilds.find((x) => x.guildId === r.guildId); const cl = clusters.find((x) => x.clusterId === r.clusterId);
  const dis = [];
  if (g.title !== r.title) dis.push(`title "${g.title}"`);
  if (g.guildId !== r.guildId || g.guildName !== gd.name) dis.push(`guild ${g.guildId} "${g.guildName}"`);
  if (g.clusterName !== cl.name) dis.push(`cluster "${g.clusterName}"`);
  if (g.priority !== r.priority) { const k = `${r.guildId}|${g.priority}|${r.priority}`; prioDiff.set(k, [...(prioDiff.get(k) || []), r.roleId]); }
  if (g.evs.length !== 6 || g.evs.some((e, i) => e.evaluationId !== `EV-0${i + 1}`)) dis.push(`evaluation specs ${g.evs.map((e) => e.evaluationId).join(",")}`);
  if (!g.required || !g.optional || !g.unverified || !g.specialization) dis.push("missing header/technology lines");
  if (dis.length) conflicts.push({ type: "GENOME_DISAGREES_WITH_ROSTER", roleId: r.roleId, detail: dis.join("; ") });
  const spec = [g.specialization, ...g.modules.filter((m) => !/^EXACT-GENOME-/.test(m))].filter(Boolean);
  const role = {
    roleId: r.roleId,
    roleDefinitionVersion: "1.0.0",
    title: r.title,
    guildId: r.guildId,
    clusterId: r.clusterId,
    priority: r.priority,
    lifecycle: "TARGET",
    specializationBoundaries: [...new Set(spec)],
    requiredSkillIds: [],
    desiredMasteryLevels: [],
    requiredTechnologies: (g.required || []).map((t) => ({ technologyId: t, status: "CANDIDATE_NOT_VERIFIED" })),
    optionalTechnologies: [...(g.optional || []).map((t) => ({ technologyId: t, status: "CANDIDATE_NOT_VERIFIED" })), ...(g.unverified || []).map((t) => ({ technologyId: t, status: "NAME_NOT_VERIFIED_IN_REGISTRY" }))],
    toolAdapterIds: [],
    toolClassCandidates: g.C.map((x) => x.text),
    domainPacks: [],
    responsibilities: g.D.map((x) => x.text),
    forbiddenActions: g.F.map((x) => x.text),
    evaluationSpecs: g.evs.map((e) => ({ evaluationId: e.evaluationId, kind: e.kind, specRef: ref(e.line), status: "NOT_EXECUTED", evaluatorEvidenceRef: null })),
    knowledgeSourceRefs: [],
    learningCandidates: g.A.map((x) => ({ topic: x.text, status: "PROPOSED", sourceRef: ref(x.line) })),
    allowedWorkerScope: [],
    permissionGrants: [],
    runtimeStatus: "UNKNOWN",
    proficiencyStatus: "NOT_EVALUATED",
    certifiedScope: null,
    evaluatorEvidenceRefs: [],
    reviewerEvidenceRef: null,
    provenance: [
      { source: SRC, sha256, line: r.line, what: "role roster row (section 12)" },
      { source: SRC, sha256, line: g.line, toLine: g.toLine, what: "genome contract sections A-H", sectionLines: g.sections },
    ],
    lastVerifiedAt: null,
    expiresAt: null,
    gapIds: [],
    legacyAliases: (aliasesByRole.get(r.roleId) || []).sort((a, b) => a.legacyId.localeCompare(b.legacyId) || a.status.localeCompare(b.status)),
  };
  for (const [field, kind] of MANDATORY_GROUPS) if (role[field].length === 0) role.gapIds.push(`WFR-GAP-${kind}-${r.roleId}`);
  return role;
});

// //TR: Genome sözleşmesi ile roster satırı arasındaki öncelik farkı guild başına tek çatışma kaydı olarak taşınır; roster değeri korunur.
for (const [k, ids] of prioDiff) { const [guildId, genomeP, rosterP] = k.split("|"); conflicts.push({ type: "GENOME_PRIORITY_DIFFERS_FROM_ROSTER", guildId, roleIds: ids, detail: `genome contract says ${genomeP}; roster row says ${rosterP} (roster value kept per role)` }); }
const aliasCount = {}; let aliasTotal = 0;
for (const r of roles) for (const a of r.legacyAliases) { aliasCount[a.status] = (aliasCount[a.status] || 0) + 1; aliasTotal++; }

// Superseded B9 reconciliation (title heuristic) and its representation proof
const norm = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["and", "principal", "expert", "engineer", "architect", "agent", "specialist", "senior", "lead", "the", "of"]);
const toks = (s) => new Set(norm(s).split(" ").filter((t) => t && !STOP.has(t)));
const jac = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
const byNorm = new Map();
for (const r of roster) { const k = norm(r.title); byNorm.set(k, [...(byNorm.get(k) || []), r]); }
const mappings = []; const usedT = new Set(); const unmatchedReg = [];
for (const a of legacy) {
  const ex = byNorm.get(norm(a.name));
  if (ex && ex.length === 1) { mappings.push({ registeredId: a.id, registeredName: a.name, targetRoleId: ex[0].roleId, targetTitle: ex[0].title, status: "EXACT", basis: "normalized title equality" }); usedT.add(ex[0].roleId); continue; }
  const ta = toks(a.name); let best = null;
  for (const r of roster) { const s = jac(ta, toks(r.title)); if (s > 0 && (!best || s > best.s)) best = { s, r }; }
  if (best && best.s >= 0.6) { mappings.push({ registeredId: a.id, registeredName: a.name, targetRoleId: best.r.roleId, targetTitle: best.r.title, status: "CANDIDATE_NEEDS_REVIEW", basis: `token Jaccard ${best.s.toFixed(3)} after dropping seniority/generic words` }); usedT.add(best.r.roleId); }
  else unmatchedReg.push({ registeredId: a.id, registeredName: a.name });
}
const representedIds = new Set([...roles.flatMap((r) => r.legacyAliases.map((a) => a.legacyId)), ...legacyUnmapped.map((u) => u.legacyId)]);
const pairsRepresented = mappings.filter((m) => pairSeen.has(`${m.registeredId}>${m.targetRoleId}`)).length;
const unmatchedTarget = roster.filter((r) => !usedT.has(r.roleId)).map((r) => ({ roleId: r.roleId, title: r.title }));
const unmatchedTargetRepresented = unmatchedTarget.filter((u) => roles.some((r) => r.roleId === u.roleId && r.title === u.title)).length;
const reconRepresented = legacy.every((a) => representedIds.has(a.id)) && pairsRepresented === mappings.length && unmatchedTargetRepresented === unmatchedTarget.length;
const supersession = {
  file: RECON,
  decision: reconRepresented ? "REMOVED_ALL_ENTRIES_REPRESENTED" : "KEPT_SUPERSEDED_NOT_ALL_ENTRIES_REPRESENTED",
  registeredIdsTotal: legacy.length,
  registeredIdsRepresented: legacy.filter((a) => representedIds.has(a.id)).length,
  candidatePairs: mappings.length,
  candidatePairsRepresentedAsLegacyAlias: pairsRepresented,
  unmatchedRegistered: unmatchedReg.length,
  unmatchedRegisteredRepresented: unmatchedReg.filter((u) => representedIds.has(u.registeredId)).length,
  unmatchedTarget: unmatchedTarget.length,
  unmatchedTargetRepresentedAsRole: unmatchedTargetRepresented,
};

const registry = {
  "//TR": "Bu dosya UASCO'nun tek kanonik 599 RoleDefinition kaydıdır; hedef envanterdir, runtime/yeterlilik/sertifika iddia etmez ve eski 363 kayıt yalnız LEGACY_REFERENCE_ONLY takma adı olarak bağlanır.",
  schemaVersion: "2.0.0",
  status: "CANONICAL_ROLE_REGISTRY_TARGET_NOT_RUNTIME",
  notice: "599 REGISTERED ≠ certified ≠ running",
  authority: {
    canonical: true,
    decision: "FA-WFR-03-2026-10-15",
    promotedFrom: "registries/target-role-catalog.json",
    legacyRegistry: { path: LEGACY, authority: "LEGACY_REFERENCE_ONLY", count: legacy.length, sha256: sha(legacyRaw), frozen: "byte-identical; not edited by this registry" },
  },
  source: {
    file: SRC, sha256,
    lineRanges: [
      { what: "cluster table (section 4)", from: cS + 1, to: cS + 3 + clusters.length },
      { what: "guild table (section 4.1)", from: gS + 1, to: gEnd },
      { what: "role roster (section 12)", from: rS + 1, to: rEnd + 1 },
      { what: "pilot cross-check (section 5.3)", from: pS + 1, to: pS + 3 + pilotChecked },
      { what: "genome contracts (599 x sections A-H)", from: genomeFirst, to: genomeLast },
    ],
    crossChecked: { pilotRows: pilotChecked, genomeContracts: genome.size },
  },
  legacyAliasEvidence: {
    directory: WFR02_DIR,
    files: evidenceFiles,
    sha256sums: `${WFR02_DIR}/SHA256SUMS`,
    integrity: "Each JSON file equals the WFR-02 original except one inserted //TR line (line 2); removing it reproduces the SHA256SUMS digest. Proposal files listed in SHA256SUMS are not copied.",
    approval: "PROPOSED",
    notice: wfr02["SUMMARY.json"].notice,
  },
  counts: {
    roles: roles.length,
    guilds: guilds.length,
    clusters: clusters.length,
    evaluationSpecs: roles.reduce((n, r) => n + r.evaluationSpecs.length, 0),
    evaluationSpecsExecuted: 0,
    runtimeReady: 0,
    certified: 0,
    legacyAgents: legacy.length,
    legacyAliases: { total: aliasTotal, byStatus: Object.fromEntries(ALIAS_STATUSES.map((s) => [s, aliasCount[s] || 0])) },
    legacyUnmapped: legacyUnmapped.length,
    gapIds: roles.reduce((n, r) => n + r.gapIds.length, 0) + guilds.length,
  },
  reconciliationSupersession: supersession,
  clusters: clusters.map((c) => ({ ...c, guildCount: guilds.filter((g) => g.clusterId === c.clusterId).length, roleCount: roles.filter((r) => r.clusterId === c.clusterId).length })),
  guilds: guilds.map((g) => ({ guildId: g.guildId, name: g.name, clusterId: g.clusterId, roleCount: roles.filter((r) => r.guildId === g.guildId).length, ownerRoleId: null, gapIds: [`WFR-GAP-GUILD-OWNER-${g.guildId}`], sourceLine: g.sourceLine })),
  legacyUnmapped,
  conflicts,
  roles: "__ROLES__",
};
// //TR: Her rol tek satırda yazılır (deterministik ve satır bazlı diff); başlık alanları girintili JSON'dur.
const out = JSON.stringify(registry, null, 2).replace('"roles": "__ROLES__"', () => `"roles": [\n${roles.map((r) => "    " + JSON.stringify(r)).join(",\n")}\n  ]`) + "\n";

const recon = {
  "//TR": "Bu dosya 363 kayitli rolun hedef rollerle baslik bazli aday eslesmesidir; hicbir eslesme otomatik onaylanmamistir.",
  schemaVersion: "1.0.0",
  status: "SUPERSEDED",
  supersededBy: `${REGISTRY}#roles[].legacyAliases and #legacyUnmapped (WFR-02 independently verified, PROPOSED)`,
  supersededReason: `kept: ${supersession.candidatePairsRepresentedAsLegacyAlias}/${supersession.candidatePairs} title-heuristic candidate pairs are represented as legacy aliases; ${supersession.registeredIdsRepresented}/${supersession.registeredIdsTotal} registered ids are represented`,
  sourceCatalog: REGISTRY,
  registeredCount: legacy.length,
  rule: "EXACT = equal after case/punctuation/ampersand normalization and unique; CANDIDATE_NEEDS_REVIEW = token Jaccard >= 0.6 (generic seniority words dropped). Nothing is confirmed; every row needs human review.",
  mappings,
  unmatchedRegistered: unmatchedReg,
  unmatchedTarget,
  summary: { exact: mappings.filter((m) => m.status === "EXACT").length, candidate: mappings.filter((m) => m.status === "CANDIDATE_NEEDS_REVIEW").length, unmatchedRegistered: unmatchedReg.length, unmatchedTarget: roster.length - usedT.size },
};
const out2 = JSON.stringify(recon, null, 2) + "\n";

const files = [[REGISTRY, out], [RECON, reconRepresented ? null : out2]];
if (check) {
  const bad = files.filter(([f, c]) => (c === null ? fs.existsSync(f) : !fs.existsSync(f) || fs.readFileSync(f, "utf8") !== c));
  if (bad.length) { console.error("ROLE_DEFINITIONS_REPRODUCE: FAIL " + bad.map((b) => b[0]).join(",")); process.exit(2); }
  console.log(`ROLE_DEFINITIONS_REPRODUCE: PASS ${REGISTRY} sha256=${sha(Buffer.from(out, "utf8"))} reconciliation=${supersession.decision}`);
} else {
  for (const [f, c] of files) { if (c === null) { if (fs.existsSync(f)) fs.rmSync(f); } else fs.writeFileSync(f, c); }
  console.log(`roles=${roles.length} guilds=${guilds.length} clusters=${clusters.length} conflicts=${conflicts.length} aliases=${aliasTotal} ${JSON.stringify(aliasCount)} legacyUnmapped=${legacyUnmapped.length} reconciliation=${supersession.decision} pairs=${pairsRepresented}/${mappings.length} ids=${supersession.registeredIdsRepresented}/${legacy.length}`);
}
