// //TR: Bu validator tek kanonik 599 RoleDefinition kaydını (registries/role-definitions.json) kanıt temelli denetler: kimlik/guild/cluster bütünlüğü, zorunlu §3 alanları, sahte READY/CERTIFIED ve sahte yeşil değerlendirme yasağı, PROPOSED legacy takma adları, dondurulmuş 363 legacy agents.json bayt kimliği ve runtime kodunun legacy kaydı karar için okumaması.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// //TR: Fixture: dondurulmuş legacy kayıt ve Master V2 kaynağının master değerleri (FA-WFR-03); değişirse validator kırmızıdır.
const FIXTURE = Object.freeze({
  legacyAgentsPath: "registries/agents.json",
  legacyAgentsSha256: "cbe7abf00b4c1e7d989f8478f4d3aacb21d8daabedead45e44d892aa8332f5e3",
  legacyAgentsCount: 363,
  masterV2File: "UASCO_NIHAI_TEK_SISTEM_MASTER_V2_DESKTOP_UX001-071_2026-10-14.md",
  masterV2Sha256: "35d00e292d89bad59316e8f9b31ee39f4aaf7a34c9eba1e3077763f962512a1d",
  roles: 599, guilds: 51, clusters: 10, evaluationSpecsPerRole: 6,
  status: "CANONICAL_ROLE_REGISTRY_TARGET_NOT_RUNTIME",
  notice: "599 REGISTERED ≠ certified ≠ running",
  // //TR: Runtime kodunda legacy kayda yalnız bu dosyadaki, LEGACY_REFERENCE_ONLY işaretli satırlar (belgelenmiş legacy projeksiyon) izinlidir.
  legacyProjectionFiles: ["apps/control-api/src/server.ts"],
  legacyProjectionMarker: "LEGACY_REFERENCE_ONLY",
});
const REQUIRED_FIELDS = {
  roleId: "string", roleDefinitionVersion: "string", title: "string", guildId: "string", clusterId: "string", priority: "string",
  specializationBoundaries: "array", requiredSkillIds: "array", desiredMasteryLevels: "array", requiredTechnologies: "array",
  optionalTechnologies: "array", toolAdapterIds: "array", domainPacks: "array", responsibilities: "array", forbiddenActions: "array",
  evaluationSpecs: "array", knowledgeSourceRefs: "array", learningCandidates: "array", allowedWorkerScope: "array", permissionGrants: "array",
  runtimeStatus: "string", proficiencyStatus: "string", certifiedScope: "nullable", evaluatorEvidenceRefs: "array", reviewerEvidenceRef: "nullable",
  provenance: "array", lastVerifiedAt: "nullable", expiresAt: "nullable", gapIds: "array", legacyAliases: "array",
};
const MANDATORY_GROUPS = [
  ["requiredSkillIds", "SKILLS"], ["desiredMasteryLevels", "MASTERY"], ["requiredTechnologies", "TECHNOLOGIES"],
  ["toolAdapterIds", "TOOL-ADAPTERS"], ["domainPacks", "DOMAIN-PACKS"], ["responsibilities", "RESPONSIBILITIES"],
  ["forbiddenActions", "FORBIDDEN-ACTIONS"], ["knowledgeSourceRefs", "KNOWLEDGE-SOURCES"], ["allowedWorkerScope", "WORKER-SCOPE"],
  ["permissionGrants", "PERMISSION-GRANTS"], ["evaluatorEvidenceRefs", "EVALUATION"],
];
const ALIAS_STATUSES = new Set(["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED", "CONFLICT", "MISSING_SOURCE", "REJECTED", "UNMAPPED"]);
const UNMAPPED_STATUSES = new Set(["UNMAPPED", "MISSING_SOURCE", "CONFLICT"]);
const PRIMARY_ALIAS = new Set(["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED"]);
const EVAL_STATUSES = new Set(["NOT_EXECUTED", "PASSED", "FAILED"]);

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const root = path.resolve(arg("--root") ?? process.cwd());
const scanRoot = path.resolve(arg("--scan-root") ?? root);
const registryFile = path.resolve(root, arg("--registry") ?? "registries/role-definitions.json");
const agentsFile = path.resolve(root, arg("--agents") ?? FIXTURE.legacyAgentsPath);
const errors = [];
const fail = (code, detail) => { if (errors.length < 200) errors.push(`${code}: ${detail}`); else if (errors.length === 200) errors.push("... more errors suppressed"); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const typeOk = (v, t) => (t === "array" ? Array.isArray(v) : t === "nullable" ? true : typeof v === t && v.length > 0);
// //TR: Kanıt referansı yalnız depo kökü altındaki gerçek bir dosyaya çözülüyorsa geçerlidir (yol kaçışı reddedilir).
const resolvable = (ref) => {
  if (typeof ref !== "string" || !ref) return false;
  const rel = ref.split("#")[0];
  const abs = path.resolve(root, rel), r = path.relative(root, abs);
  if (!r || r.startsWith("..") || path.isAbsolute(r)) return false;
  try { return fs.statSync(abs).isFile(); } catch { return false; }
};

let reg = null, agentsRaw = null, agents = null;
try { reg = JSON.parse(fs.readFileSync(registryFile, "utf8")); } catch (e) { fail("REGISTRY_UNREADABLE", e.message); }
try { agentsRaw = fs.readFileSync(agentsFile); agents = JSON.parse(agentsRaw.toString("utf8")); } catch (e) { fail("LEGACY_AGENTS_UNREADABLE", e.message); }

// 1. Legacy agents.json frozen (byte identity + count)
if (agents) {
  if (sha(agentsRaw) !== FIXTURE.legacyAgentsSha256) fail("LEGACY_AGENTS_BYTES_CHANGED", `sha256 ${sha(agentsRaw)} != fixture ${FIXTURE.legacyAgentsSha256}`);
  if (!Array.isArray(agents.agents) || agents.agents.length !== FIXTURE.legacyAgentsCount || agents.count !== FIXTURE.legacyAgentsCount) fail("LEGACY_AGENTS_COUNT", `expected ${FIXTURE.legacyAgentsCount}`);
}
const legacyIds = new Set(agents?.agents?.map((a) => a.id) ?? []);

if (reg) {
  // 2. Header
  if (reg.status !== FIXTURE.status) fail("REGISTRY_STATUS", String(reg.status));
  if (reg.notice !== FIXTURE.notice) fail("REGISTRY_NOTICE", String(reg.notice));
  if (reg.source?.file !== FIXTURE.masterV2File || reg.source?.sha256 !== FIXTURE.masterV2Sha256) fail("REGISTRY_SOURCE", "Master V2 file/sha256 mismatch");
  const lr = reg.authority?.legacyRegistry;
  if (lr?.path !== FIXTURE.legacyAgentsPath || lr?.authority !== "LEGACY_REFERENCE_ONLY" || lr?.sha256 !== FIXTURE.legacyAgentsSha256 || lr?.count !== FIXTURE.legacyAgentsCount) fail("REGISTRY_LEGACY_AUTHORITY", "legacyRegistry must be agents.json, LEGACY_REFERENCE_ONLY, fixture sha256 and count");
  if (!Array.isArray(reg.conflicts) || reg.conflicts.some((c) => typeof c?.type !== "string")) fail("REGISTRY_CONFLICTS", "conflicts[] must be an array of typed records");
  if (!Array.isArray(reg.legacyUnmapped)) fail("REGISTRY_LEGACY_UNMAPPED", "legacyUnmapped[] missing");

  // 3. Clusters / guilds
  const clusters = Array.isArray(reg.clusters) ? reg.clusters : [], guilds = Array.isArray(reg.guilds) ? reg.guilds : [];
  const clusterIds = new Set(clusters.map((c) => c.clusterId));
  if (clusters.length !== FIXTURE.clusters || clusterIds.size !== FIXTURE.clusters || clusters.some((c, i) => c.clusterId !== `CL${String(i + 1).padStart(2, "0")}`)) fail("CLUSTERS", `expected ${FIXTURE.clusters} unique CL01..CL10`);
  const guildById = new Map(guilds.map((g) => [g.guildId, g]));
  if (guilds.length !== FIXTURE.guilds || guildById.size !== FIXTURE.guilds) fail("GUILDS", `expected ${FIXTURE.guilds} unique guilds, got ${guilds.length}/${guildById.size}`);
  for (const g of guilds) {
    if (!/^G\d{2}$/.test(String(g.guildId))) fail("GUILD_ID", String(g.guildId));
    if (!clusterIds.has(g.clusterId)) fail("GUILD_CLUSTER", `${g.guildId} -> ${g.clusterId}`);
    if (g.ownerRoleId === null) { if (!Array.isArray(g.gapIds) || !g.gapIds.includes(`WFR-GAP-GUILD-OWNER-${g.guildId}`)) fail("GUILD_OWNER_GAP", `${g.guildId} has no owner and no WFR-GAP-GUILD-OWNER gap`); }
    else if (!/^UASCO-\d{4}$/.test(String(g.ownerRoleId))) fail("GUILD_OWNER", `${g.guildId} owner ${g.ownerRoleId}`);
  }

  // 4. Roles
  const roles = Array.isArray(reg.roles) ? reg.roles : [];
  if (roles.length !== FIXTURE.roles) fail("ROLE_COUNT", `expected ${FIXTURE.roles}, got ${roles.length}`);
  const seen = new Set(); const primaryByLegacy = new Map(); const aliasLegacy = new Set(); const pairs = new Set();
  let specs = 0, executed = 0, certified = 0, ready = 0;
  roles.forEach((r, i) => {
    const want = `UASCO-${String(i + 1).padStart(4, "0")}`, id = r?.roleId;
    if (id !== want) fail("ROLE_ID_NOT_CONTIGUOUS", `index ${i}: ${id} != ${want}`);
    if (seen.has(id)) fail("ROLE_ID_DUPLICATE", id); seen.add(id);
    for (const [f, t] of Object.entries(REQUIRED_FIELDS)) if (!(f in (r ?? {})) || !typeOk(r[f], t)) fail("ROLE_FIELD", `${id}.${f} missing or not ${t}`);
    if (!r || typeof r !== "object") return;
    const g = guildById.get(r.guildId);
    if (!g) fail("ROLE_GUILD", `${id} -> ${r.guildId}`); else if (g.clusterId !== r.clusterId) fail("ROLE_CLUSTER", `${id} cluster ${r.clusterId} != guild ${g.clusterId}`);
    if (!clusterIds.has(r.clusterId)) fail("ROLE_CLUSTER_UNKNOWN", `${id} -> ${r.clusterId}`);
    // provenance: Master V2 source trace
    const prov = Array.isArray(r.provenance) ? r.provenance : [];
    if (!prov.length || prov.some((p) => p?.source !== FIXTURE.masterV2File || p?.sha256 !== FIXTURE.masterV2Sha256 || !Number.isInteger(p?.line) || p.line < 1)) fail("ROLE_PROVENANCE", `${id} needs Master V2 file + sha256 + line`);
    // evaluation specs: EV-01..EV-06, anti-fake-green
    const evs = Array.isArray(r.evaluationSpecs) ? r.evaluationSpecs : [];
    if (evs.length !== FIXTURE.evaluationSpecsPerRole || evs.some((e, k) => e?.evaluationId !== `EV-0${k + 1}`)) fail("ROLE_EVALUATION_SPECS", `${id} needs EV-01..EV-06`);
    for (const e of evs) {
      specs++;
      if (!EVAL_STATUSES.has(e?.status)) fail("EVALUATION_STATUS", `${id} ${e?.evaluationId} ${e?.status}`);
      if (typeof e?.specRef !== "string" || !e.specRef.startsWith(`${FIXTURE.masterV2File}#L`)) fail("EVALUATION_SPEC_REF", `${id} ${e?.evaluationId}`);
      if (e?.status === "NOT_EXECUTED") { if (e.evaluatorEvidenceRef !== null) fail("EVALUATION_EVIDENCE_WITHOUT_RUN", `${id} ${e.evaluationId}`); }
      else { executed++; if (!resolvable(e?.evaluatorEvidenceRef)) fail("FAKE_GREEN_EVALUATION", `${id} ${e?.evaluationId} status ${e?.status} without a resolvable evaluatorEvidenceRef`); }
    }
    // runtime / proficiency defaults: no READY/CERTIFIED/RUNNING without resolvable certification + evaluation evidence
    const claims = r.runtimeStatus !== "UNKNOWN" || r.proficiencyStatus !== "NOT_EVALUATED" || r.certifiedScope !== null || r.lastVerifiedAt !== null || r.expiresAt !== null;
    if (r.proficiencyStatus === "CERTIFIED") certified++;
    if (["READY", "RUNNING", "ACTIVE"].includes(r.runtimeStatus)) ready++;
    if (claims) {
      const refs = Array.isArray(r.evaluatorEvidenceRefs) ? r.evaluatorEvidenceRefs : [];
      const ok = r.certifiedScope && typeof r.certifiedScope === "object" && refs.length > 0 && refs.every(resolvable) && resolvable(r.reviewerEvidenceRef)
        && evs.length === 6 && evs.every((e) => e.status === "PASSED" && resolvable(e.evaluatorEvidenceRef)) && typeof r.expiresAt === "string" && Date.parse(r.expiresAt) > Date.now();
      if (!ok) fail("CLAIM_WITHOUT_CERTIFICATION_EVIDENCE", `${id} runtimeStatus=${r.runtimeStatus} proficiencyStatus=${r.proficiencyStatus} certifiedScope=${JSON.stringify(r.certifiedScope)}`);
    } else if ((r.evaluatorEvidenceRefs ?? []).length || r.reviewerEvidenceRef !== null) {
      for (const x of [...(r.evaluatorEvidenceRefs ?? []), ...(r.reviewerEvidenceRef ? [r.reviewerEvidenceRef] : [])]) if (!resolvable(x)) fail("EVIDENCE_REF_UNRESOLVABLE", `${id} ${x}`);
    }
    // gaps for empty mandatory groups
    const gaps = Array.isArray(r.gapIds) ? r.gapIds : [];
    if (new Set(gaps).size !== gaps.length) fail("GAP_DUPLICATE", id);
    for (const gp of gaps) if (!/^WFR-GAP-[A-Z]+(?:-[A-Z]+)*-UASCO-\d{4}$/.test(String(gp)) || !String(gp).endsWith(id)) fail("GAP_ID", `${id} ${gp}`);
    for (const [f, kind] of MANDATORY_GROUPS) if (Array.isArray(r[f]) && r[f].length === 0 && !gaps.includes(`WFR-GAP-${kind}-${id}`)) fail("MANDATORY_GROUP_EMPTY_WITHOUT_GAP", `${id}.${f}`);
    // legacy aliases: allowed status, PROPOSED only, valid legacy id, resolvable evidence
    for (const a of Array.isArray(r.legacyAliases) ? r.legacyAliases : []) {
      if (!ALIAS_STATUSES.has(a?.status)) fail("ALIAS_STATUS", `${id} ${a?.legacyId} ${a?.status}`);
      if (a?.approval !== "PROPOSED") fail("ALIAS_AUTO_APPROVED", `${id} ${a?.legacyId} approval=${a?.approval}`);
      if (!legacyIds.has(a?.legacyId)) fail("ALIAS_LEGACY_ID", `${id} ${a?.legacyId}`);
      if (!resolvable(a?.evidenceRef)) fail("ALIAS_EVIDENCE", `${id} ${a?.legacyId} ${a?.evidenceRef}`);
      const k = `${a?.legacyId}>${id}`; if (pairs.has(k)) fail("ALIAS_PAIR_DUPLICATE", k); pairs.add(k);
      aliasLegacy.add(a?.legacyId);
      if (PRIMARY_ALIAS.has(a?.status)) primaryByLegacy.set(a.legacyId, [...(primaryByLegacy.get(a.legacyId) ?? []), id]);
    }
  });
  for (const [lid, ids] of primaryByLegacy) if (ids.length > 1) fail("ALIAS_LEGACY_MULTI_PRIMARY", `${lid} -> ${ids.join(",")}`);
  const unmapped = Array.isArray(reg.legacyUnmapped) ? reg.legacyUnmapped : [];
  for (const u of unmapped) {
    if (!UNMAPPED_STATUSES.has(u?.status)) fail("UNMAPPED_STATUS", `${u?.legacyId} ${u?.status}`);
    if (u?.approval !== "PROPOSED") fail("UNMAPPED_AUTO_APPROVED", String(u?.legacyId));
    if (!legacyIds.has(u?.legacyId)) fail("UNMAPPED_LEGACY_ID", String(u?.legacyId));
    if (!resolvable(u?.evidenceRef)) fail("UNMAPPED_EVIDENCE", `${u?.legacyId} ${u?.evidenceRef}`);
    if (primaryByLegacy.has(u?.legacyId)) fail("UNMAPPED_ALSO_MAPPED", String(u?.legacyId));
  }
  const unmappedIds = new Set(unmapped.map((u) => u?.legacyId));
  for (const lid of legacyIds) {
    const n = (primaryByLegacy.has(lid) ? 1 : 0) + (unmappedIds.has(lid) ? 1 : 0);
    if (n !== 1) fail("LEGACY_DISPOSITION", `${lid} must have exactly one primary alias or one legacyUnmapped entry (has ${n})`);
  }
  // 5. Counts consistent with content
  const c = reg.counts ?? {};
  if (c.roles !== roles.length || c.guilds !== guilds.length || c.clusters !== clusters.length) fail("COUNTS", "roles/guilds/clusters");
  if (c.evaluationSpecs !== specs || specs !== FIXTURE.roles * FIXTURE.evaluationSpecsPerRole) fail("COUNTS_EVALUATION_SPECS", `${c.evaluationSpecs} vs ${specs}`);
  if (c.evaluationSpecsExecuted !== executed || c.certified !== certified || c.runtimeReady !== ready) fail("COUNTS_CLAIMS", `executed=${executed} certified=${certified} ready=${ready} vs header`);
  if (c.legacyAgents !== legacyIds.size) fail("COUNTS_LEGACY", String(c.legacyAgents));
}

// 6. Registry authority: canonical role definitions + legacy agents marked
try {
  const ra = JSON.parse(fs.readFileSync(path.join(root, "registries/registry-authority-v2.json"), "utf8"));
  if (ra.authorities?.roleDefinitions !== "registries/role-definitions.json") fail("AUTHORITY_ROLE_DEFINITIONS", String(ra.authorities?.roleDefinitions));
  if (ra.legacyAgentsAuthority !== "LEGACY_REFERENCE_ONLY") fail("AUTHORITY_LEGACY_AGENTS", String(ra.legacyAgentsAuthority));
} catch (e) { fail("AUTHORITY_UNREADABLE", e.message); }

// 7. Grep gate: runtime code (apps/, core/) must not read the legacy registry except the documented projection
const CODE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html"]);
const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
let scanned = 0;
const walk = (dir) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const a = path.join(dir, e.name); if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(a); continue; }
    if (!CODE.has(path.extname(e.name).toLowerCase())) continue; scanned++;
    const rel = path.relative(scanRoot, a).replaceAll("\\", "/");
    fs.readFileSync(a, "utf8").split(/\r?\n/).forEach((l, n) => {
      if (!/agents\.json/.test(l)) return;
      if (!FIXTURE.legacyProjectionFiles.includes(rel) || !l.includes(FIXTURE.legacyProjectionMarker)) fail("RUNTIME_READS_LEGACY_AGENTS", `${rel}:${n + 1}`);
    });
  } };
for (const d of ["apps", "core"]) walk(path.join(scanRoot, d));
if (scanned === 0) fail("GREP_GATE_SCANNED_NOTHING", scanRoot);

if (errors.length) { console.error("ROLE_REGISTRY_VALIDATION: FAIL"); for (const e of errors) console.error(" - " + e); process.exit(2); }
console.log(`ROLE_REGISTRY_VALIDATION: PASS roles=${reg.roles.length} guilds=${reg.guilds.length} clusters=${reg.clusters.length} evaluationSpecs=${reg.counts.evaluationSpecs} executed=0 certified=0 legacyAgents=${FIXTURE.legacyAgentsCount} (byte-identical) aliases=${reg.counts.legacyAliases.total} legacyUnmapped=${reg.legacyUnmapped.length} runtimeFilesScanned=${scanned}`);
