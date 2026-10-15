// //TR: Bu validator tek kanonik 599 RoleDefinition kaydını (registries/role-definitions.json) kanıt temelli denetler: kimlik/guild/cluster bütünlüğü, zorunlu §3 alanları, sahte READY/CERTIFIED ve sahte yeşil değerlendirme yasağı (FA-WFR-03 altında executed/certified/runtimeReady sıfır olmak zorundadır), legacy takma adların WFR-02 kanıtından birebir yeniden türetilmesi, dondurulmuş 363 legacy agents.json bayt kimliği ve runtime kodunun legacy kaydı karar için okumaması.
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
  // //TR: WFR-02 bağımsız doğrulanmış eşleme kanıtı; SHA256SUMS dosyasının kendisi de sabitlenir, böylece kanıt ve özet birlikte değiştirilemez.
  wfr02Dir: "registries/sources/wfr02",
  wfr02Files: ["chunk-1-verified.json", "chunk-2-verified.json", "chunk-3-verified.json", "SUMMARY.json"],
  wfr02Sha256SumsSha256: "eeb7e04ead9d3a65a0ded54e70302cd7d3f3bdd30ae2e948ee65053bbd13edc7",
  // //TR: FA-WFR-03 kapsamında yönetilen bir sertifikasyon hattı yoktur; bu sayılar sıfırdan farklıysa kayıt reddedilir.
  faWfr03Invariants: { evaluationSpecsExecuted: 0, certified: 0, runtimeReadyOrRunning: 0 },
  // //TR: Gelecekteki değerlendirme/inceleme kanıtı yalnız bu kök altında, rol+değerlendirme adlı ve sha256 ile sabitlenmiş JSON kaydı olabilir.
  evidenceRoot: "audit/evidence/role-evaluations",
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
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v));
const inside = (base, p) => { const r = path.relative(base, p); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
// //TR: Kanıt referansı yalnız audit/evidence/role-evaluations/<roleId>/<evaluationId>.json#sha256=<hex> biçiminde kabul edilir: dosya bu kökün içinde gerçek bir dosya olmalı (sembolik bağ kaçışı reddedilir), bayt sha256'sı referanstaki değere eşit olmalı, JSON aynı roleId/evaluationId/verdict değerlerini taşımalı ve aynı rol dizinindeki artifact dosyasını artifactSha256 ile bağlamalıdır. Kayıt dosyası veya keyfi depo dosyaları (README.md, package.json) asla kanıt değildir.
const EVIDENCE_REF = /^audit\/evidence\/role-evaluations\/(UASCO-\d{4})\/(EV-0[1-6]|REVIEWER)\.json#sha256=([0-9a-f]{64})$/;
const registryReal = realOrNull(registryFile);
const evidenceProblem = (ref, roleId, evaluationId, verdict) => {
  if (typeof ref !== "string" || !ref) return "missing";
  const m = ref.match(EVIDENCE_REF);
  if (!m) return `not of the form ${FIXTURE.evidenceRoot}/<roleId>/<evaluationId>.json#sha256=<hex>`;
  if (m[1] !== roleId) return `names role ${m[1]}`;
  if (evaluationId && m[2] !== evaluationId) return `names ${m[2]} instead of ${evaluationId}`;
  const base = realOrNull(path.resolve(root, FIXTURE.evidenceRoot)), real = realOrNull(path.resolve(root, ref.split("#")[0]));
  if (!base || !real) return "file does not exist";
  if (!inside(base, real)) return "resolves outside the evidence root";
  if (registryReal && real === registryReal) return "is the registry itself";
  let raw; try { if (!fs.statSync(real).isFile()) return "not a file"; raw = fs.readFileSync(real); } catch { return "unreadable"; }
  if (sha(raw) !== m[3]) return "sha256 does not match the pinned value";
  let j; try { j = JSON.parse(raw.toString("utf8")); } catch { return "not JSON"; }
  if (j?.roleId !== roleId || j?.evaluationId !== m[2] || j?.verdict !== verdict) return `content does not name roleId=${roleId} evaluationId=${m[2]} verdict=${verdict}`;
  const roleDir = realOrNull(path.resolve(base, roleId));
  const art = typeof j.artifactPath === "string" ? realOrNull(path.resolve(root, j.artifactPath)) : null;
  if (!roleDir || !art || !inside(roleDir, art) || art === real || (registryReal && art === registryReal)) return "artifactPath must be another file in the same role evidence directory";
  try { if (sha(fs.readFileSync(art)) !== j.artifactSha256) return "artifactSha256 does not match the artifact"; } catch { return "artifact unreadable"; }
  return null;
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
const legacyName = new Map(agents?.agents?.map((a) => [a.id, a.name]) ?? []);

// 1b. WFR-02 evidence: SHA256SUMS pinned, each file verified after removing its inserted //TR line 2, expected aliases re-derived
// //TR: Takma adlar ve legacyUnmapped, build-role-definitions.mjs ile aynı kuralla WFR-02 kanıtından yeniden türetilir; kayıt bununla birebir eşit olmalıdır (durum sahteciliği, takas veya başka dosyaya kanıt referansı reddedilir).
const wfr02 = {}; const wfr02Refs = new Map(); const expectedAliases = new Map(); let expectedUnmapped = null;
try {
  const sumsRaw = fs.readFileSync(path.join(root, FIXTURE.wfr02Dir, "SHA256SUMS"));
  if (sha(sumsRaw) !== FIXTURE.wfr02Sha256SumsSha256) fail("WFR02_SHA256SUMS_CHANGED", `sha256 ${sha(sumsRaw)} != fixture ${FIXTURE.wfr02Sha256SumsSha256}`);
  const sums = new Map(sumsRaw.toString("utf8").split("\n").filter(Boolean).map((l) => { const m = l.match(/^([0-9a-f]{64}) \*?(.+)$/); return m ? [m[2], m[1]] : [l, null]; }));
  for (const f of FIXTURE.wfr02Files) {
    const ls = fs.readFileSync(path.join(root, FIXTURE.wfr02Dir, f), "utf8").split("\n");
    if (!/^ {2}"\/\/TR": ".*",$/.test(ls[1] ?? "")) { fail("WFR02_TR_LINE", `${f}: expected the inserted //TR line at line 2`); continue; }
    const original = [ls[0], ...ls.slice(2)].join("\n");
    if (!sums.get(f) || sha(Buffer.from(original, "utf8")) !== sums.get(f)) { fail("WFR02_SHA256_MISMATCH", `${f}: sha256 without the //TR line does not match SHA256SUMS`); continue; }
    wfr02[f] = JSON.parse(ls.join("\n"));
  }
} catch (e) { fail("WFR02_UNREADABLE", e.message); }
if (FIXTURE.wfr02Files.every((f) => wfr02[f]) && agents) {
  const pairSeen = new Set(), seenLegacy = new Set(); expectedUnmapped = [];
  const add = (roleId, alias) => { const k = `${alias.legacyId}>${roleId}`; if (pairSeen.has(k)) return; pairSeen.add(k); expectedAliases.set(roleId, [...(expectedAliases.get(roleId) ?? []), alias]); };
  for (const f of FIXTURE.wfr02Files.slice(0, 3)) {
    for (const e of Array.isArray(wfr02[f].entries) ? wfr02[f].entries : []) {
      const ref = `${FIXTURE.wfr02Dir}/${f}#entries[legacyId=${e.legacyId}]`;
      if (seenLegacy.has(e.legacyId)) fail("WFR02_LEGACY_DUPLICATE", e.legacyId); seenLegacy.add(e.legacyId);
      if (!legacyName.has(e.legacyId)) fail("WFR02_LEGACY_UNKNOWN", `${ref}`);
      if (!ALIAS_STATUSES.has(e.finalStatus)) fail("WFR02_STATUS", `${ref} ${e.finalStatus}`);
      wfr02Refs.set(ref, e.legacyId);
      const base = { legacyId: e.legacyId, legacyTitle: legacyName.get(e.legacyId), approval: "PROPOSED", evidenceRef: ref };
      if (e.finalTargetRoleId) add(e.finalTargetRoleId, { ...base, status: e.finalStatus });
      else {
        const u = { ...base, status: e.finalStatus };
        if (Array.isArray(e.conflictCandidates) && e.conflictCandidates.length) { u.conflictCandidates = [...e.conflictCandidates].sort(); for (const c of u.conflictCandidates) add(c, { ...base, status: "CONFLICT" }); }
        expectedUnmapped.push(u);
      }
    }
  }
  if (seenLegacy.size !== legacyIds.size) fail("WFR02_COVERAGE", `WFR-02 covers ${seenLegacy.size} legacy ids, agents.json has ${legacyIds.size}`);
  // //TR: Doğrulayıcının açıkça yanlış bulduğu sezgisel çiftler yalnız REJECTED olarak beklenir.
  const rejectedLists = [
    ["chunk-1-verified.json", "crossDomainHeuristicPairsObservedNotProposed", (x) => [x?.legacyId, (String(x?.pair).match(/UASCO-\d{4}/) || [])[0]]],
    ["chunk-2-verified.json", "heuristicCrossDomainNotAdopted", (x) => [x?.legacyId, x?.targetRoleId]],
    ["chunk-3-verified.json", "heuristicPairsJudgedWrong", (x) => [(String(x?.pair).match(/^(\d{3}) /) || [])[1], (String(x?.pair).match(/UASCO-\d{4}/) || [])[0]]],
  ];
  for (const [f, field, parse] of rejectedLists) {
    if (!Array.isArray(wfr02[f][field])) { fail("WFR02_REJECTED_LIST", `${f}#${field} missing`); continue; }
    wfr02[f][field].forEach((x, i) => {
      const [lid, rid] = parse(x), ref = `${FIXTURE.wfr02Dir}/${f}#${field}[${i}]`;
      if (!lid || !rid || !legacyName.has(lid)) { fail("WFR02_REJECTED_UNPARSEABLE", ref); return; }
      wfr02Refs.set(ref, lid);
      add(rid, { legacyId: lid, legacyTitle: legacyName.get(lid), status: "REJECTED", approval: "PROPOSED", evidenceRef: ref });
    });
  }
}
// //TR: Takma ad kanıt referansı yalnız yüklenmiş WFR-02 dosyasındaki, aynı legacy kimliği taşıyan bir girdiye (veya reddedilen çift satırına) işaret edebilir.
const wfr02RefOk = (ref, legacyId) => typeof ref === "string" && wfr02Refs.has(ref) && wfr02Refs.get(ref) === legacyId;
let computed = null;

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
      else { executed++; const p = evidenceProblem(e?.evaluatorEvidenceRef, id, e?.evaluationId, e?.status); if (p) fail("FAKE_GREEN_EVALUATION", `${id} ${e?.evaluationId} status ${e?.status} without valid evaluator evidence (${e?.evaluatorEvidenceRef}: ${p})`); }
    }
    // runtime / proficiency defaults: no READY/CERTIFIED/RUNNING without pinned certification + evaluation evidence under the evidence root
    const claims = r.runtimeStatus !== "UNKNOWN" || r.proficiencyStatus !== "NOT_EVALUATED" || r.certifiedScope !== null || r.lastVerifiedAt !== null || r.expiresAt !== null;
    if (r.proficiencyStatus === "CERTIFIED") certified++;
    if (["READY", "RUNNING", "ACTIVE"].includes(r.runtimeStatus)) ready++;
    // //TR: Rol düzeyi değerlendirici kanıtı ilgili EV spec'inin durumunu, inceleme kanıtı REVIEWER/APPROVED kaydını göstermelidir.
    const refs = Array.isArray(r.evaluatorEvidenceRefs) ? r.evaluatorEvidenceRefs : [];
    const refProblems = [];
    for (const x of refs) { const ev = evs.find((e) => typeof x === "string" && x.includes(`/${e?.evaluationId}.json#`)); const p = ev ? evidenceProblem(x, id, ev.evaluationId, ev.status) : `names no evaluation spec of ${id}`; if (p) refProblems.push(`${x}: ${p}`); }
    if (r.reviewerEvidenceRef !== null) { const p = evidenceProblem(r.reviewerEvidenceRef, id, "REVIEWER", "APPROVED"); if (p) refProblems.push(`${r.reviewerEvidenceRef}: ${p}`); }
    for (const p of refProblems) fail("EVIDENCE_REF_INVALID", `${id} ${p}`);
    if (claims) {
      const ok = r.certifiedScope && typeof r.certifiedScope === "object" && refs.length > 0 && r.reviewerEvidenceRef !== null && refProblems.length === 0
        && evs.length === 6 && evs.every((e) => e.status === "PASSED" && !evidenceProblem(e.evaluatorEvidenceRef, id, e.evaluationId, "PASSED")) && typeof r.expiresAt === "string" && Date.parse(r.expiresAt) > Date.now();
      if (!ok) fail("CLAIM_WITHOUT_CERTIFICATION_EVIDENCE", `${id} runtimeStatus=${r.runtimeStatus} proficiencyStatus=${r.proficiencyStatus} certifiedScope=${JSON.stringify(r.certifiedScope)}`);
    }
    // gaps for empty mandatory groups
    const gaps = Array.isArray(r.gapIds) ? r.gapIds : [];
    if (new Set(gaps).size !== gaps.length) fail("GAP_DUPLICATE", id);
    for (const gp of gaps) if (!/^WFR-GAP-[A-Z]+(?:-[A-Z]+)*-UASCO-\d{4}$/.test(String(gp)) || !String(gp).endsWith(id)) fail("GAP_ID", `${id} ${gp}`);
    for (const [f, kind] of MANDATORY_GROUPS) if (Array.isArray(r[f]) && r[f].length === 0 && !gaps.includes(`WFR-GAP-${kind}-${id}`)) fail("MANDATORY_GROUP_EMPTY_WITHOUT_GAP", `${id}.${f}`);
    // legacy aliases: allowed status, PROPOSED only, valid legacy id, evidenceRef to the WFR-02 record of the same legacy id
    for (const a of Array.isArray(r.legacyAliases) ? r.legacyAliases : []) {
      if (!ALIAS_STATUSES.has(a?.status)) fail("ALIAS_STATUS", `${id} ${a?.legacyId} ${a?.status}`);
      if (a?.approval !== "PROPOSED") fail("ALIAS_AUTO_APPROVED", `${id} ${a?.legacyId} approval=${a?.approval}`);
      if (!legacyIds.has(a?.legacyId)) fail("ALIAS_LEGACY_ID", `${id} ${a?.legacyId}`);
      if (expectedUnmapped && !wfr02RefOk(a?.evidenceRef, a?.legacyId)) fail("ALIAS_EVIDENCE", `${id} ${a?.legacyId} ${a?.evidenceRef} is not a WFR-02 record for this legacy id`);
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
    if (expectedUnmapped && (!wfr02RefOk(u?.evidenceRef, u?.legacyId) || !String(u?.evidenceRef).includes("#entries["))) fail("UNMAPPED_EVIDENCE", `${u?.legacyId} ${u?.evidenceRef} is not a WFR-02 entry for this legacy id`);
    if (primaryByLegacy.has(u?.legacyId)) fail("UNMAPPED_ALSO_MAPPED", String(u?.legacyId));
  }
  // exact binding to the WFR-02 derivation (order-insensitive, field-exact)
  if (expectedUnmapped) {
    const bind = (code, label, got, want) => {
      const g = got.map(canon).sort(), w = want.map(canon).sort();
      if (g.join("\n") === w.join("\n")) return;
      const gs = new Set(g), ws = new Set(w); let n = 0;
      for (const x of g) if (!ws.has(x)) { fail(code, `${label} not derivable from WFR-02: ${x}`); n++; }
      for (const x of w) if (!gs.has(x)) { fail(code, `${label} missing WFR-02 record: ${x}`); n++; }
      if (!n) fail(code, `${label} has duplicate entries (${g.length} vs ${w.length})`);
    };
    const roleIdSet = new Set(roles.map((r) => r?.roleId));
    for (const rid of expectedAliases.keys()) if (!roleIdSet.has(rid)) fail("ALIAS_NOT_BOUND_TO_WFR02", `WFR-02 target ${rid} is not a role`);
    for (const r of roles) if (r && typeof r === "object") bind("ALIAS_NOT_BOUND_TO_WFR02", `${r.roleId}.legacyAliases`, Array.isArray(r.legacyAliases) ? r.legacyAliases : [], expectedAliases.get(r.roleId) ?? []);
    bind("UNMAPPED_NOT_BOUND_TO_WFR02", "legacyUnmapped", unmapped, expectedUnmapped);
  } else fail("ALIAS_BINDING_NOT_EVALUATED", "WFR-02 evidence could not be loaded and verified");
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
  const byStatus = Object.fromEntries([...ALIAS_STATUSES].map((st) => [st, 0])); let aliasTotal = 0;
  for (const r of roles) for (const a of Array.isArray(r?.legacyAliases) ? r.legacyAliases : []) { aliasTotal++; if (a?.status in byStatus) byStatus[a.status]++; }
  if (c.legacyAliases?.total !== aliasTotal || canon(c.legacyAliases?.byStatus) !== canon(byStatus)) fail("COUNTS_ALIASES", `header ${canon(c.legacyAliases)} vs computed total=${aliasTotal} ${canon(byStatus)}`);
  if (c.legacyUnmapped !== unmapped.length) fail("COUNTS_LEGACY_UNMAPPED", `${c.legacyUnmapped} vs ${unmapped.length}`);
  // //TR: FA-WFR-03 değişmezleri: yönetilen sertifikasyon hattı olmadığından hiçbir değerlendirme yürütülmüş, hiçbir rol sertifikalı veya READY/RUNNING sayılamaz (kanıt geçerli görünse bile).
  computed = { executed, certified, runtimeReadyOrRunning: ready, aliases: aliasTotal };
  const inv = FIXTURE.faWfr03Invariants;
  if (executed !== inv.evaluationSpecsExecuted) fail("FA_WFR03_EVALUATIONS_EXECUTED", `${executed} evaluation specs are not NOT_EXECUTED; no governed evaluation pipeline exists under FA-WFR-03`);
  if (certified !== inv.certified) fail("FA_WFR03_CERTIFIED", `${certified} roles claim CERTIFIED; no governed certification pipeline exists under FA-WFR-03`);
  if (ready !== inv.runtimeReadyOrRunning) fail("FA_WFR03_RUNTIME_READY", `${ready} roles claim READY/RUNNING/ACTIVE; no worker runtime is certified under FA-WFR-03`);
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

const countsLine = computed ? `executed=${computed.executed} certified=${computed.certified} runtimeReadyOrRunning=${computed.runtimeReadyOrRunning}` : "executed=? certified=? runtimeReadyOrRunning=? (registry not evaluated)";
if (errors.length) { console.error("ROLE_REGISTRY_VALIDATION: FAIL"); console.error(`ROLE_REGISTRY_COUNTS (computed): ${countsLine}`); for (const e of errors) console.error(" - " + e); process.exit(2); }
console.log(`ROLE_REGISTRY_VALIDATION: PASS roles=${reg.roles.length} guilds=${reg.guilds.length} clusters=${reg.clusters.length} evaluationSpecs=${reg.counts.evaluationSpecs} ${countsLine} legacyAgents=${FIXTURE.legacyAgentsCount} (byte-identical) aliases=${computed.aliases} (bound to WFR-02, SHA256SUMS verified) legacyUnmapped=${reg.legacyUnmapped.length} runtimeFilesScanned=${scanned}`);
