// //TR: Bu test C-RDY-1 Rol Hazırlık Denetçisini (core/agents/readiness-audit.ts) doğrular: gerçek kayıtlarda katman toplamları (T1), eski beş sayaçla uzlaşma (T2), aşama bağlantısının ayrı ve asla varsayılmaması (T3), değerlendirme kanıtı (T4), RUNNING için günlük şartı (T5), bilgi katmanında boş-doğru olmaması ve tam kaynak izi (T6), PROFILED'ın yalnız kanonik kayıttan gelmesi (T7), lonca/küme paydaları ve belirlilik (T8), araç hazırlığında kod yolu + gözlenmiş yoklama (T9), anomalilerin katmanı terfi ettirmemesi (T10) ve girdi yükleyicinin kapalı başarısızlığı (T11). Hiçbir test kayıt dosyasına yazmaz; kanıt ve yükleyici testleri geçici depo kökü kullanır.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {computeRoleReadiness, loadReadinessInputFromRepo, reconcileLegacyStatusSummary, PROMOTED_TECHNOLOGY_STATUSES, READINESS_LAYERS} from "../core/agents/readiness-audit.js";
import type {AdapterRealityEntry, KnowledgeUnitLike, LayerCount, ProposedProfileLike, ReadinessAudit, ReadinessInput, ReadinessLayer, ReadinessRole, RoleReadiness} from "../core/agents/readiness-audit.js";
import {computeRoleStatusSummary, createEvidenceVerifier} from "../core/agents/role-lifecycle.js";
import type {RunsObservation} from "../core/agents/role-lifecycle.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {TERMINAL_RUN_STATUSES} from "../core/workos/run-state.js";

const REPO = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const STATES = ["TRUE", "FALSE", "UNKNOWN", "NOT_APPLICABLE"] as const;
const BOUND = FIRST_DELIVERY_BINDINGS.map(b => b.roleId).sort();
const EXECUTABLE_IDS = ["UASCO-0019", "UASCO-0022", "UASCO-0023", "UASCO-0031", "UASCO-0043", "UASCO-0085", "UASCO-0252", "UASCO-0313"];

// //TR: Gerçek girdi bir kez yüklenir (yükleyici salt okunurdur; denetim girdiyi değiştirmez), varyantlar yayılımla üretilir.
let REAL: ReadinessInput | null = null;
const realInput = (over: Partial<ReadinessInput> = {}): ReadinessInput => {
  REAL ??= loadReadinessInputFromRepo(REPO, {runs: {journal: "ABSENT"}, now: NOW});
  return {...REAL, ...over};
};
const reasonsOf = (a: ReadinessAudit, layer: ReadinessLayer) => a.reasonCounts[layer];
const roleOf = (a: ReadinessAudit, id: string): RoleReadiness => a.roles.find(r => r.roleId === id)!;
const countOnly = (c: LayerCount) => ({TRUE: c.TRUE, FALSE: c.FALSE, UNKNOWN: c.UNKNOWN});

// //TR: Her çıktının yapısal değişmezleri: nedenler sıralı/tekil ve YALNIZ TRUE iken boş, dört durum paydayı toplar, measured === (payda > 0 && UNKNOWN === 0), özet 64 onaltılık.
function expectWellFormed(a: ReadinessAudit): void {
  for (const r of a.roles) for (const l of READINESS_LAYERS) {
    const x = r.layers[l];
    expect(x.reasons.length === 0, `${r.roleId}.${l}`).toBe(x.state === "TRUE");
    expect([...x.reasons], `${r.roleId}.${l}`).toEqual([...new Set(x.reasons)].sort());
  }
  const checks: LayerCount[] = [...Object.values(a.totals), a.stageWired, ...[...a.byGuild, ...a.byCluster].flatMap(g => [...Object.values(g.layers), g.stageWired])];
  for (const c of checks) {
    expect(c.TRUE + c.FALSE + c.UNKNOWN + c.NOT_APPLICABLE).toBe(c.denominator);
    expect(c.measured).toBe(c.denominator > 0 && c.UNKNOWN === 0);
  }
  expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
}

// ---- küçük, bellek içi girdi (fixture) ----
const PROV = {
  requiredFields: ["sourceId", "uriOrLocator", "sourceClass", "effectiveVersion", "fetchedAt", "digestOrRevision", "supersedes"],
  certifiableClasses: new Set(["OFFICIAL_DOCUMENTATION", "OFFICIAL_SPEC_STANDARD", "OFFICIAL_RELEASE_NOTES", "OFFICIAL_SECURITY_ADVISORY", "AUTHORITATIVE_VENDOR_GUIDE"])
};
const goodRef = (over: Record<string, unknown> = {}) => ({sourceId: "src-1", uriOrLocator: "https://docs.example.test/a", sourceClass: "OFFICIAL_DOCUMENTATION", effectiveVersion: "1.2.3", fetchedAt: "2026-10-01", digestOrRevision: "sha256:abc", supersedes: null, ...over});
const goodUnit = (over: Partial<KnowledgeUnitLike> = {}): KnowledgeUnitLike => ({facet: "fundamentals", state: "RESEARCHED", sourceRefs: [goodRef()], lastValidatedAt: "2026-10-01T00:00:00Z", ...over});
const notExecuted = () => ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06"].map(evaluationId => ({evaluationId, status: "NOT_EXECUTED", evaluatorEvidenceRef: null}));
const fxRole = (over: Record<string, unknown> = {}): ReadinessRole => ({
  roleId: "UASCO-0001", title: "Fixture role", guildId: "G01", clusterId: "CL01", requiredSkillIds: ["SK2-A"], requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}],
  knowledgeSourceRefs: ["x"], evaluationSpecs: notExecuted(), proficiencyStatus: "NOT_EVALUATED", runtimeStatus: "UNKNOWN", ...over
} as ReadinessRole);
const fxInput = (roleOver: Record<string, unknown> = {}, over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  roles: [fxRole(roleOver)], guilds: [{guildId: "G01", clusterId: "CL01"}], clusters: [{clusterId: "CL01"}], roleDefinitionsSha256: "0".repeat(64), bindings: [], verify: () => "missing",
  runs: {journal: "ABSENT"}, skillIds: new Set(["SK2-A"]), technologies: new Map([["tech-a", {status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]]),
  knowledgeProfiles: new Map([["tech-a", [goodUnit()]]]), sourceProvenance: PROV, now: NOW, ...over
});
const only = (i: ReadinessInput) => computeRoleReadiness(i).roles[0];
// //TR: Eski beş sayaç, denetimle AYNI girdi üzerinde (aynı roller, doğrulayıcı, now); uzlaştırma testleri için.
const legacyOf = (i: ReadinessInput) => computeRoleStatusSummary({roles: i.roles, guildIds: i.guilds.map(g => g.guildId), roleDefinitionsSha256: i.roleDefinitionsSha256, bindings: i.bindings, verify: i.verify, runs: i.runs?.journal === "PRESENT" ? i.runs.runs : [], now: i.now});

describe("C-RDY-1 readiness-audit", () => {
  // //TR: Kanıt ve yükleyici testleri geçici depo kökü kullanır (gerçek depoya yazılmaz).
  let tmp = "";
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rdy1-")); });
  afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

  it("real registries: layer totals at the branch tip", () => {
    const a = computeRoleReadiness(realInput());
    expectWellFormed(a);
    expect(a.schemaVersion).toBe("1.0.0");
    expect(a.authority).toBe("AUTHORITATIVE_READINESS_MEASUREMENT");
    expect(a.denominator).toBe(599);
    for (const l of READINESS_LAYERS) expect(a.totals[l].denominator, l).toBe(599);
    expect(countOnly(a.totals.DEFINED)).toEqual({TRUE: 599, FALSE: 0, UNKNOWN: 0});
    expect(countOnly(a.totals.PROFILED)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(reasonsOf(a, "PROFILED")).toEqual({NO_CANONICAL_SKILLS: 599, TECHNOLOGY_STATUS_NOT_PROMOTED: 599});
    expect(countOnly(a.totals.KNOWLEDGE_READY)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(reasonsOf(a, "KNOWLEDGE_READY")).toEqual({ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY: 599, NO_RESEARCHED_SOURCED_UNIT: 599});
    expect(countOnly(a.totals.TOOL_READY)).toEqual({TRUE: 0, FALSE: 590, UNKNOWN: 9});
    expect(reasonsOf(a, "TOOL_READY")).toEqual({ADAPTER_REALITY_NOT_SUPPLIED: 9, ROLE_HAS_NO_BINDING: 590});
    expect(countOnly(a.totals.EXECUTABLE)).toEqual({TRUE: 8, FALSE: 591, UNKNOWN: 0});
    expect(reasonsOf(a, "EXECUTABLE")).toEqual({ROLE_HAS_NO_BINDING: 590, ROUTE_NOT_PRODUCTION_EXECUTOR: 1, STAGE_NOT_CONSUMED: 1});
    expect(roleOf(a, "UASCO-0232").layers.EXECUTABLE.reasons).toEqual(["ROUTE_NOT_PRODUCTION_EXECUTOR", "STAGE_NOT_CONSUMED"]);
    expect(a.roles.filter(r => r.layers.EXECUTABLE.state === "TRUE").map(r => r.roleId)).toEqual(EXECUTABLE_IDS);
    expect(countOnly(a.stageWired)).toEqual({TRUE: 0, FALSE: 591, UNKNOWN: 8});
    expect(a.reasonCounts["EXECUTABLE.stageWired"]).toEqual({NO_CODE_PATH: 591, REACHABLE_STAGES_NOT_SUPPLIED: 8});
    expect(countOnly(a.totals.EVALUATED)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(reasonsOf(a, "EVALUATED")).toEqual({NO_SPEC_EXECUTED: 599});
    expect(countOnly(a.totals.INTERNALLY_CERTIFIED)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(reasonsOf(a, "INTERNALLY_CERTIFIED")).toEqual({NOT_CERTIFIED_STATUS: 599});
    expect(countOnly(a.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 0, UNKNOWN: 599});
    expect(a.totals.RUNNING.measured).toBe(false);
    expect(reasonsOf(a, "RUNNING")).toEqual({NO_RUN_JOURNAL: 599});
    expect(a.proposedOnly).toEqual({source: "PROPOSED_DERIVED_NOT_RUNTIME", profiles: 599, withCandidateSkills: 197, withCandidateToolAdapters: 164});
    expect(a.anomalies).toBe(0);
    expect(a.inputs).toEqual({journal: "ABSENT", adapterReality: "NOT_SUPPLIED", reachableStages: "NOT_SUPPLIED", backendEnabled: "UNKNOWN",
      roleDefinitionsSha256: sha(fs.readFileSync(path.join(REPO, "registries", "role-definitions.json"))), bindingsCount: 9, skillIds: 425, technologies: 415, knowledgeProfiles: 415, promotedTechnologyStatuses: "DEFAULT"});
    // //TR: Gerçek kayıtta PROFILED=0 ve KNOWLEDGE_READY=0 YAPISAL: kanonik requiredSkillIds boş, hiçbir teknoloji doğrulanmış durumda değil, hiçbir bilgi birimi araştırılmış değil.
    expect(PROMOTED_TECHNOLOGY_STATUSES.size).toBe(0);
    expect(a.computedAt).toBe(NOW.toISOString());
  });

  it("legacy parity and reconciliation", () => {
    const i = realInput();
    const legacy = computeRoleStatusSummary({roles: i.roles, guildIds: i.guilds.map(g => g.guildId), roleDefinitionsSha256: i.roleDefinitionsSha256, bindings: i.bindings, verify: i.verify, runs: [], now: NOW});
    expect(legacy).toMatchObject({registered: 599, implemented: 8, tested: 0, certified: 0, running: 0});
    const a = computeRoleReadiness(i);
    expect(reconcileLegacyStatusSummary(legacy, a)).toEqual({status: "DEPRECATED_LEGACY_PROJECTION", authority: "readiness", consistent: true, mismatches: [], runningMeasured: false,
      implementedMeaning: "EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES", implementedStageWired: "UNKNOWN"});
    const total = reconcileLegacyStatusSummary({...legacy, implemented: 9}, a);
    expect(total.consistent).toBe(false);
    expect(total.mismatches).toEqual(["total.implemented:9!=8"]);
    const g08 = legacy.byGuild.find(g => g.guildId === "G08")!;
    expect(g08.implemented).toBe(1);
    const guild = reconcileLegacyStatusSummary({...legacy, byGuild: legacy.byGuild.map(g => g.guildId === "G08" ? {...g, implemented: 0} : g)}, a);
    expect(guild.consistent).toBe(false);
    expect(guild.mismatches).toEqual(["G08.implemented:0!=1"]);
    // //TR: Her sayaç ayrı eşitlik: bozulan sayaç tam olarak kendi uyuşmazlığını üretir.
    for (const k of ["registered", "tested", "certified", "running"] as const) expect(reconcileLegacyStatusSummary({...legacy, [k]: 1}, a).mismatches).toEqual([`total.${k}:1!=${k === "registered" ? 599 : 0}`]);
    // //TR: Bir lonca satırı iki taraftan birinde yoksa da uyuşmazlıktır (sessizce atlanmaz).
    expect(reconcileLegacyStatusSummary({...legacy, byGuild: legacy.byGuild.filter(g => g.guildId !== "G08")}, a).mismatches).toEqual(["G08.row:absent!=present"]);
    expect(reconcileLegacyStatusSummary({...legacy, byGuild: [...legacy.byGuild, {guildId: "G99", registered: 0, implemented: 0, tested: 0, certified: 0, running: 0}]}, a).mismatches).toEqual(["G99.row:present!=absent"]);
    // //TR: Günlük VARSA running ölçülmüştür; aşama bağlantısı verilirse implementedStageWired sayıdır ve implemented'dan ayrıdır.
    const withJournal = computeRoleReadiness(realInput({runs: {journal: "PRESENT", runs: []}, reachableStages: new Set(["IMPLEMENT", "REVIEW"])}));
    const r2 = reconcileLegacyStatusSummary(legacy, withJournal);
    expect(r2).toMatchObject({consistent: true, runningMeasured: true, implementedStageWired: 3});
    expect(withJournal.totals.RUNNING.measured).toBe(true);
  });

  it("stage wiring is separate and never defaulted", () => {
    const three = computeRoleReadiness(realInput({reachableStages: new Set(["IMPLEMENT", "REVIEW"])}));
    expectWellFormed(three);
    expect(countOnly(three.stageWired)).toEqual({TRUE: 3, FALSE: 596, UNKNOWN: 0});
    expect(three.roles.filter(r => r.executable.stageWired.state === "TRUE").map(r => r.roleId)).toEqual(["UASCO-0085", "UASCO-0252", "UASCO-0313"]);
    expect(three.reasonCounts["EXECUTABLE.stageWired"]).toEqual({STAGE_NOT_WIRED: 5, NO_CODE_PATH: 591});
    const none = computeRoleReadiness(realInput({reachableStages: new Set<string>()}));
    expect(countOnly(none.stageWired)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(none.reasonCounts["EXECUTABLE.stageWired"]).toEqual({STAGE_NOT_WIRED: 8, NO_CODE_PATH: 591});
    const undef = computeRoleReadiness(realInput());
    expect(countOnly(undef.stageWired)).toEqual({TRUE: 0, FALSE: 591, UNKNOWN: 8});
    // //TR: EXECUTABLE (kod yolu) üç durumda da 8'dir; aşama bağlantısı onu ne artırır ne azaltır.
    for (const a of [three, none, undef]) expect(a.totals.EXECUTABLE.TRUE).toBe(8);
    expect(three.inputs.reachableStages).toBe("SUPPLIED");
    expect(undef.inputs.reachableStages).toBe("NOT_SUPPLIED");
    // //TR: Aşama adı sözlüğü: PREDEV_PRODUCE tüketicileri yalnız PREDEV_PRODUCE verilirse bağlıdır.
    const predev = computeRoleReadiness(realInput({reachableStages: new Set(["PREDEV_PRODUCE"])}));
    expect(predev.roles.filter(r => r.executable.stageWired.state === "TRUE").map(r => r.roleId)).toEqual(["UASCO-0019", "UASCO-0022", "UASCO-0023", "UASCO-0031", "UASCO-0043"]);
    expect(roleOf(predev, "UASCO-0085").executable.consumingStages).toEqual(["IMPLEMENT"]);
    expect(roleOf(predev, "UASCO-0232").executable.consumingStages).toEqual([]);
    expect(roleOf(predev, "UASCO-0001").executable.consumingStages).toEqual([]);
  });

  const ROLE = "UASCO-0085";
  // //TR: Doğrulayıcı biçiminde kanıt dosyası + artefakt yazar; sabitlenmiş ref döner (verifier: bayt hash'i, rol dizininde artefakt, FAKE reddi).
  const evidence = (root: string, role: string, extra: Record<string, unknown> = {}, wrongSha = false, evalId = "EV-01", verdict = "PASSED"): string => {
    const dir = path.join(root, "audit", "evidence", "role-evaluations", role); fs.mkdirSync(dir, {recursive: true});
    const artifactRel = `audit/evidence/role-evaluations/${role}/${evalId}.artifact.txt`, art = Buffer.from(`artifact ${evalId}`);
    fs.writeFileSync(path.join(root, artifactRel), art);
    const body = Buffer.from(JSON.stringify({roleId: role, evaluationId: evalId, verdict, artifactPath: artifactRel, artifactSha256: sha(art), ...extra}));
    const file = `audit/evidence/role-evaluations/${role}/${evalId}.json`; fs.writeFileSync(path.join(root, file), body);
    return `${file}#sha256=${wrongSha ? "0".repeat(64) : sha(body)}`;
  };
  const withSpecs = (role: string, specs: unknown[]) => realInput().roles.map(r => r.roleId === role ? {...r, evaluationSpecs: specs} : r) as ReadinessRole[];
  const spec1 = (ref: string | null, status = "PASSED") => [{evaluationId: "EV-01", status, evaluatorEvidenceRef: ref}, ...notExecuted().slice(1)];
  const inputWith = (root: string, role: string, specs: unknown[], over: Partial<ReadinessInput> = {}) => realInput({roles: withSpecs(role, specs), verify: createEvidenceVerifier(root), ...over});
  const audit = (root: string, role: string, specs: unknown[]) => computeRoleReadiness(inputWith(root, role, specs));

  it("evaluation evidence", () => {
    const root = fs.mkdtempSync(path.join(tmp, "r-"));
    const good = audit(root, ROLE, spec1(evidence(root, ROLE)));
    expect(roleOf(good, ROLE).layers.EVALUATED).toEqual({state: "TRUE", reasons: []});
    expect(good.totals.EVALUATED.TRUE).toBe(1);
    expect(roleOf(good, ROLE).anomalies).toEqual([]);
    // //TR: Bir spec'in doğrulanmış kanıtı INTERNALLY_CERTIFIED YAPMAZ (1/6 değil 6/6 + reviewer + süre gerekir) ve eski sayaçlarla uzlaşır: tested 1, certified 0.
    expect(roleOf(good, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["NOT_CERTIFIED_STATUS"]});
    expect(good.totals.INTERNALLY_CERTIFIED.TRUE).toBe(0);
    const goodInput = inputWith(root, ROLE, spec1(evidence(root, ROLE)));
    const goodLegacy = legacyOf(goodInput);
    expect(goodLegacy).toMatchObject({tested: 1, certified: 0});
    expect(reconcileLegacyStatusSummary(goodLegacy, computeRoleReadiness(goodInput))).toMatchObject({consistent: true, mismatches: []});
    // //TR: FAKE etiketli kanıt (fake:true ve executorKind:FAKE) hash'i doğru olsa bile reddedilir.
    for (const extra of [{fake: true}, {executorKind: "FAKE"}]) {
      const root2 = fs.mkdtempSync(path.join(tmp, "f-"));
      const a = audit(root2, ROLE, spec1(evidence(root2, ROLE, extra)));
      expect(roleOf(a, ROLE).layers.EVALUATED).toEqual({state: "FALSE", reasons: ["EVIDENCE_REJECTED"]});
      expect(a.totals.EVALUATED.TRUE).toBe(0);
    }
    const root3 = fs.mkdtempSync(path.join(tmp, "w-"));
    expect(roleOf(audit(root3, ROLE, spec1(evidence(root3, ROLE, {}, true))), ROLE).layers.EVALUATED).toEqual({state: "FALSE", reasons: ["EVIDENCE_REJECTED"]});
    // //TR: Başka bir role ait kanıt ve dosyası olmayan ref de reddedilir.
    const root4 = fs.mkdtempSync(path.join(tmp, "o-"));
    expect(roleOf(audit(root4, "UASCO-0313", spec1(evidence(root4, ROLE))), "UASCO-0313").layers.EVALUATED.reasons).toEqual(["EVIDENCE_REJECTED"]);
    expect(roleOf(audit(root4, ROLE, spec1(`audit/evidence/role-evaluations/${ROLE}/EV-01.json#sha256=${"1".repeat(64)}`)), ROLE).layers.EVALUATED.reasons).toEqual(["EVIDENCE_REJECTED"]);
    const none = audit(root, ROLE, notExecuted());
    expect(roleOf(none, ROLE).layers.EVALUATED).toEqual({state: "FALSE", reasons: ["NO_SPEC_EXECUTED"]});
    // //TR: Boş spec listesi FALSE'tur (sahte doğru yok).
    expect(roleOf(audit(root, ROLE, []), ROLE).layers.EVALUATED).toEqual({state: "FALSE", reasons: ["NO_EVALUATION_SPECS"]});
    // //TR: Bağlamasız bir rolde doğrulanmış kanıt EVALUATED yapar ama katman sırası anomalisi işaretlenir; EXECUTABLE yine FALSE kalır (terfi yok).
    const root5 = fs.mkdtempSync(path.join(tmp, "l-"));
    const lo = roleOf(audit(root5, "UASCO-0001", spec1(evidence(root5, "UASCO-0001"))), "UASCO-0001");
    expect(lo.layers.EVALUATED.state).toBe("TRUE");
    expect(lo.layers.EXECUTABLE.state).toBe("FALSE");
    expect(lo.anomalies).toEqual([{kind: "LAYER_ORDER", detail: "EVALUATED_TRUE_WITHOUT_EXECUTABLE"}]);
  });

  it("internally certified: 6/6 verified evidence, reviewer approval and expiry against the injected now", () => {
    const root = fs.mkdtempSync(path.join(tmp, "c-"));
    const IDS = ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06"];
    const refs = IDS.map(id => evidence(root, ROLE, {}, false, id, "PASSED"));
    const reviewer = evidence(root, ROLE, {}, false, "REVIEWER", "APPROVED");
    const specs = IDS.map((id, n) => ({evaluationId: id, status: "PASSED", evaluatorEvidenceRef: refs[n]}));
    const claim = (over: Record<string, unknown> = {}) => ({evaluationSpecs: specs, proficiencyStatus: "CERTIFIED", certifiedScope: {scope: "fixture"}, evaluatorEvidenceRefs: refs, reviewerEvidenceRef: reviewer, expiresAt: "2027-06-01T00:00:00Z", ...over});
    const run = (over: Record<string, unknown> = {}, now = NOW, verify = createEvidenceVerifier(root)) => {
      const i = realInput({roles: realInput().roles.map(r => r.roleId === ROLE ? {...r, ...claim(over)} : r) as ReadinessRole[], verify, now});
      return {i, a: computeRoleReadiness(i)};
    };
    // //TR: TRUE yolu: 6/6 doğrulanmış PASSED + reviewer APPROVED + kapsam + kanıt listesi + süresi dolmamış; EVALUATED ve EXECUTABLE da TRUE, anomali yok, eski sayaçla uzlaşır (certified 1).
    const ok = run();
    expect(roleOf(ok.a, ROLE).layers).toMatchObject({EXECUTABLE: {state: "TRUE"}, EVALUATED: {state: "TRUE"}, INTERNALLY_CERTIFIED: {state: "TRUE", reasons: []}});
    expect(roleOf(ok.a, ROLE).anomalies).toEqual([]);
    expect(ok.a.totals.INTERNALLY_CERTIFIED.TRUE).toBe(1);
    expect(legacyOf(ok.i)).toMatchObject({tested: 1, certified: 1});
    expect(reconcileLegacyStatusSummary(legacyOf(ok.i), ok.a)).toMatchObject({consistent: true, mismatches: []});
    expectWellFormed(ok.a);
    // //TR: Süre ENJEKTE edilen now'a göre denetlenir (gerçek saate değil): geçmişte süresi dolmamış / gelecekte dolmuş, iki yönde de.
    expect(roleOf(run({expiresAt: "2021-01-01T00:00:00Z"}, new Date("2020-06-01T00:00:00Z")).a, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "TRUE", reasons: []});
    const expired = run({expiresAt: "2034-01-01T00:00:00Z"}, new Date("2035-01-01T00:00:00Z"));
    expect(roleOf(expired.a, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["CERTIFICATION_EVIDENCE_INVALID"]});
    expect(roleOf(expired.a, ROLE).layers.EVALUATED.state).toBe("TRUE");
    expect(expired.a.totals.INTERNALLY_CERTIFIED.TRUE).toBe(0);
    expect(reconcileLegacyStatusSummary(legacyOf(expired.i), expired.a).consistent).toBe(true);
    // //TR: CERTIFIED iddiası kanıtı aşıyorsa YALNIZ o anomali (EVALUATED TRUE olduğundan başka kural tetiklenmez): bu kural silinirse bu test ölür.
    expect(roleOf(expired.a, ROLE).anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: "CERTIFIED"}]);
    const oneOfSix = run({evaluationSpecs: [specs[0], ...notExecuted().slice(1)]});
    expect(roleOf(oneOfSix.a, ROLE).layers.EVALUATED.state).toBe("TRUE");
    expect(roleOf(oneOfSix.a, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["CERTIFICATION_EVIDENCE_INVALID"]});
    expect(roleOf(oneOfSix.a, ROLE).anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: "CERTIFIED"}]);
    // //TR: Her eksik parça tek başına FALSE yapar: reviewer kanıtı yok/yanlış, 5 spec, kapsam yok, kanıt listesi boş, süre yok/dize değil, bir spec PASSED değil.
    const broken: Array<[string, Record<string, unknown>]> = [
      ["no reviewer evidence", {reviewerEvidenceRef: null}], ["reviewer ref names another verdict file", {reviewerEvidenceRef: refs[0]}], ["five specs", {evaluationSpecs: specs.slice(0, 5)}], ["no certifiedScope", {certifiedScope: null}],
      ["empty evaluatorEvidenceRefs", {evaluatorEvidenceRefs: []}], ["no expiresAt", {expiresAt: null}], ["expiresAt not an ISO string", {expiresAt: 4102444800000}],
      ["one spec FAILED", {evaluationSpecs: [...specs.slice(0, 5), {...specs[5], status: "FAILED"}]}], ["one spec without a ref", {evaluationSpecs: [...specs.slice(0, 5), {...specs[5], evaluatorEvidenceRef: null}]}]
    ];
    for (const [name, over] of broken) expect(roleOf(run(over).a, ROLE).layers.INTERNALLY_CERTIFIED, name).toEqual({state: "FALSE", reasons: ["CERTIFICATION_EVIDENCE_INVALID"]});
    const fakeRoot = fs.mkdtempSync(path.join(tmp, "cf-"));
    const fakeRefs = IDS.map(id => evidence(fakeRoot, ROLE, id === "EV-03" ? {executorKind: "FAKE"} : {}, false, id, "PASSED"));
    const fake = run({evaluationSpecs: IDS.map((id, n) => ({evaluationId: id, status: "PASSED", evaluatorEvidenceRef: fakeRefs[n]})), evaluatorEvidenceRefs: fakeRefs, reviewerEvidenceRef: evidence(fakeRoot, ROLE, {}, false, "REVIEWER", "APPROVED")}, NOW, createEvidenceVerifier(fakeRoot));
    expect(roleOf(fake.a, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["CERTIFICATION_EVIDENCE_INVALID"]});
    // //TR: Her şey tam ama proficiencyStatus CERTIFIED değilse neden NOT_CERTIFIED_STATUS'tur (CERTIFICATION_EVIDENCE_INVALID değil).
    expect(roleOf(run({proficiencyStatus: "NOT_EVALUATED"}).a, ROLE).layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["NOT_CERTIFIED_STATUS"]});
  });

  it("running needs a journal", () => {
    const trace = (note: string) => ({kind: "AGENT_TRACE", note, evidenceId: "e", step: "IMPLEMENT", cycle: 0, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null});
    const run = (status: string, ...ev: unknown[]) => ({status, evidence: ev} as never);
    const observe = (runs: unknown[]): RunsObservation => ({journal: "PRESENT", runs: runs as never});
    const open = computeRoleReadiness(realInput({runs: observe([run("RUNNING", trace("agent=a1 role=UASCO-0085 state=RUNNING"))])}));
    expectWellFormed(open);
    expect(countOnly(open.totals.RUNNING)).toEqual({TRUE: 1, FALSE: 598, UNKNOWN: 0});
    expect(open.totals.RUNNING.measured).toBe(true);
    expect(roleOf(open, "UASCO-0085").layers.RUNNING).toEqual({state: "TRUE", reasons: []});
    expect(roleOf(open, "UASCO-0252").layers.RUNNING).toEqual({state: "FALSE", reasons: ["NOT_IN_OPEN_RUN"]});
    expect(open.inputs.journal).toBe("PRESENT");
    const terminal = computeRoleReadiness(realInput({runs: observe([run(TERMINAL_RUN_STATUSES[0], trace("agent=a1 role=UASCO-0085 state=COMPLETED"))])}));
    expect(countOnly(terminal.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    // //TR: Başka kanıt türü ve kayıtsız rol kimliği RUNNING yapmaz; günlük boş ama VAR ise 599 ölçülmüş FALSE'tur.
    const noise = computeRoleReadiness(realInput({runs: observe([run("RUNNING", {...trace("agent=a1 role=UASCO-0085"), kind: "IMPLEMENT"}), run("RUNNING", trace("agent=a2 role=UASCO-9999"))])}));
    expect(countOnly(noise.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    const empty = computeRoleReadiness(realInput({runs: observe([])}));
    expect(countOnly(empty.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
    expect(empty.totals.RUNNING.measured).toBe(true);
    // //TR: AÇIKÇA PRESENT olmayan her günlük gözlemi UNKNOWN'dur: undefined, bilinmeyen değer, büyük/küçük harf farkı, runs dizisi olmayan PRESENT; hiçbiri ölçülmüş 0 raporlamaz.
    for (const runs of [undefined, {}, {journal: "UNKNOWN"}, {journal: "present"}, {journal: "PRESENT"}, {journal: "PRESENT", runs: "none"}]) {
      const a = computeRoleReadiness(realInput({runs: runs as never}));
      expect(countOnly(a.totals.RUNNING), JSON.stringify(runs)).toEqual({TRUE: 0, FALSE: 0, UNKNOWN: 599});
      expect(a.totals.RUNNING.measured, JSON.stringify(runs)).toBe(false);
      expect(reasonsOf(a, "RUNNING"), JSON.stringify(runs)).toEqual({NO_RUN_JOURNAL: 599});
      expect(a.inputs.journal, JSON.stringify(runs)).toBe("ABSENT");
    }
    const absent = computeRoleReadiness(realInput({runs: {journal: "ABSENT"}}));
    expect(countOnly(absent.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 0, UNKNOWN: 599});
    expect(absent.totals.RUNNING.measured).toBe(false);
    expect(absent.inputs.journal).toBe("ABSENT");
    // //TR: KARAR (B1, koordinatör): runningRoleIdsFromRuns artık run-state.isOpenRun ile tutarlıdır; AWAITING_APPROVAL açık run DEĞİLDİR, onay bekleyen run'daki rol RUNNING sayılmaz (eskiden sayılıyor ve bu test o davranışı sabitliyordu).
    const awaiting = computeRoleReadiness(realInput({runs: observe([run("AWAITING_APPROVAL", trace("agent=a3 role=UASCO-0043 state=COMPLETED"))])}));
    expect(roleOf(awaiting, "UASCO-0043").layers.RUNNING).toEqual({state: "FALSE", reasons: ["NOT_IN_OPEN_RUN"]});
    expect(countOnly(awaiting.totals.RUNNING)).toEqual({TRUE: 0, FALSE: 599, UNKNOWN: 0});
  });

  it("knowledge: no vacuous truth and full provenance", () => {
    const k = (units: readonly KnowledgeUnitLike[], roleOver: Record<string, unknown> = {}, techs: Map<string, readonly KnowledgeUnitLike[]> = new Map([["tech-a", units]])) =>
      only(fxInput(roleOver, {knowledgeProfiles: techs})).layers.KNOWLEDGE_READY;
    expect(k([goodUnit()])).toEqual({state: "TRUE", reasons: []});
    expect(k([goodUnit({sourceRefs: []})])).toEqual({state: "FALSE", reasons: ["NO_RESEARCHED_SOURCED_UNIT"]});
    const {effectiveVersion: _v, ...noVersion} = goodRef();
    expect(k([goodUnit({sourceRefs: [noVersion]})])).toEqual({state: "FALSE", reasons: ["NO_RESEARCHED_SOURCED_UNIT"]});
    expect(k([goodUnit({sourceRefs: [goodRef({sourceClass: "REPUTABLE_SECONDARY"})]})]).state).toBe("FALSE");
    expect(k([goodUnit({sourceRefs: [goodRef({sourceClass: "UNVERIFIED_COMMUNITY"})]})]).state).toBe("FALSE");
    expect(k([goodUnit({lastValidatedAt: "2026-10-01T12:30:00.000Z"})]).state).toBe("TRUE");
    expect(k([], {requiredTechnologies: []})).toEqual({state: "UNKNOWN", reasons: ["NO_REQUIRED_TECHNOLOGIES"]});
    expect(k([goodUnit()], {knowledgeSourceRefs: []})).toEqual({state: "FALSE", reasons: ["ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY"]});
    expect(k([goodUnit()], {}, new Map())).toEqual({state: "FALSE", reasons: ["KNOWLEDGE_PROFILE_MISSING"]});
    // //TR: Her eksik/bozuk kaynak izi alanı tek başına FALSE yapar (bir birim yeterli ama o birim TAM olmalı).
    const bad: Array<[string, Partial<KnowledgeUnitLike>]> = [
      ["state NOT_RESEARCHED", {state: "NOT_RESEARCHED"}], ["state empty", {state: ""}], ["lastValidatedAt null", {lastValidatedAt: null}], ["lastValidatedAt prose", {lastValidatedAt: "yesterday"}],
      ["lastValidatedAt date only", {lastValidatedAt: "2026-10-01"}], ["lastValidatedAt offset (not UTC)", {lastValidatedAt: "2026-10-01T00:00:00+02:00"}], ["lastValidatedAt impossible date", {lastValidatedAt: "2026-13-45T00:00:00Z"}],
      ["sourceId empty", {sourceRefs: [goodRef({sourceId: ""})]}], ["sourceId blank", {sourceRefs: [goodRef({sourceId: "   "})]}], ["uriOrLocator not a string", {sourceRefs: [goodRef({uriOrLocator: 7})]}],
      ["digestOrRevision empty", {sourceRefs: [goodRef({digestOrRevision: ""})]}], ["effectiveVersion empty", {sourceRefs: [goodRef({effectiveVersion: ""})]}], ["fetchedAt prose", {sourceRefs: [goodRef({fetchedAt: "last week"})]}],
      ["fetchedAt missing", {sourceRefs: [(({fetchedAt: _f, ...r}) => r)(goodRef())]}], ["supersedes key missing", {sourceRefs: [(({supersedes: _s, ...r}) => r)(goodRef())]}], ["sourceClass unknown", {sourceRefs: [goodRef({sourceClass: "BLOG"})]}],
      ["a ref that is not an object", {sourceRefs: ["https://docs.example.test"]}], ["one good ref plus one bad ref", {sourceRefs: [goodRef(), goodRef({sourceClass: "REPUTABLE_SECONDARY"})]}]
    ];
    for (const [name, over] of bad) expect(k([goodUnit(over)]), name).toEqual({state: "FALSE", reasons: ["NO_RESEARCHED_SOURCED_UNIT"]});
    // //TR: Birimler bağımsızdır: kötü birimin yanında tam bir birim varsa TRUE; iki teknolojiden biri eksikse FALSE ve yalnız o neden.
    expect(k([goodUnit({state: "NOT_RESEARCHED", sourceRefs: [], lastValidatedAt: null}), goodUnit({facet: "debugging"})]).state).toBe("TRUE");
    const two = k([], {requiredTechnologies: [{technologyId: "tech-a", status: "X"}, {technologyId: "tech-b", status: "X"}]}, new Map([["tech-a", [goodUnit()]], ["tech-b", [goodUnit({sourceRefs: []})]]]));
    expect(two).toEqual({state: "FALSE", reasons: ["NO_RESEARCHED_SOURCED_UNIT"]});
    expect(k([], {requiredTechnologies: [{technologyId: "tech-a", status: "X"}, {technologyId: "tech-b", status: "X"}]}, new Map([["tech-a", [goodUnit()]]]))).toEqual({state: "FALSE", reasons: ["KNOWLEDGE_PROFILE_MISSING"]});
    expect(k([goodUnit()], {knowledgeSourceRefs: [], requiredTechnologies: [{technologyId: "tech-a", status: "X"}, {technologyId: "tech-b", status: "X"}]}, new Map([["tech-a", []]])).reasons)
      .toEqual(["KNOWLEDGE_PROFILE_MISSING", "NO_RESEARCHED_SOURCED_UNIT", "ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY"]);
  });

  it("defined: id shape, uniqueness, guild and cluster membership", () => {
    const d = (roleOver: Record<string, unknown> = {}, over: Partial<ReadinessInput> = {}) => only(fxInput(roleOver, over)).layers.DEFINED;
    expect(d()).toEqual({state: "TRUE", reasons: []});
    for (const bad of ["UASCO-12", "UASCO-12345", "uasco-0001", "UASCO-000A", "UASCO-0001 ", "UASCO-0001\n", "XUASCO-0001"]) expect(d({roleId: bad}), JSON.stringify(bad)).toEqual({state: "FALSE", reasons: ["BAD_ROLE_ID"]});
    expect(d({guildId: "G77"})).toEqual({state: "FALSE", reasons: ["GUILD_NOT_IN_REGISTRY"]});
    expect(d({clusterId: "CL09"})).toEqual({state: "FALSE", reasons: ["CLUSTER_MISMATCH"]});
    // //TR: Yinelenen kimlik İKİ satırı da FALSE yapar (biri "ilk" sayılıp TRUE kalmaz); her uygulanabilir neden birlikte yazılır, DEFINED asla UNKNOWN olmaz.
    const dup = computeRoleReadiness({...fxInput(), roles: [fxRole(), fxRole({title: "Second"})]});
    expect(dup.roles.map(r => r.layers.DEFINED)).toEqual([{state: "FALSE", reasons: ["DUPLICATE_ROLE_ID"]}, {state: "FALSE", reasons: ["DUPLICATE_ROLE_ID"]}]);
    expect(dup.totals.DEFINED).toMatchObject({TRUE: 0, FALSE: 2, UNKNOWN: 0, denominator: 2});
    expect(d({roleId: "BAD", guildId: "G77"}).reasons).toEqual(["BAD_ROLE_ID", "GUILD_NOT_IN_REGISTRY"]);
    expect(computeRoleReadiness({...fxInput({roleId: "UASCO-0002"}), roles: [fxRole(), fxRole({roleId: "UASCO-0002", clusterId: "CL02"})]}).roles.map(r => r.layers.DEFINED.state)).toEqual(["TRUE", "FALSE"]);
  });

  it("profiled: canonical only, no vacuous truth", () => {
    const p = (roleOver: Record<string, unknown> = {}, over: Partial<ReadinessInput> = {}) => only(fxInput(roleOver, over));
    const tech = (status: string) => [{technologyId: "tech-a", status}];
    expect(p({requiredSkillIds: ["SK2-NOPE"]}).layers.PROFILED).toEqual({state: "FALSE", reasons: ["SKILL_NOT_IN_SK2", "TECHNOLOGY_STATUS_NOT_PROMOTED"]});
    const proposed: ProposedProfileLike[] = [{roleId: "UASCO-0001", candidateSkills: {value: Array.from({length: 72}, (_, n) => `SK2-C${n}`)}, candidateToolAdapterIds: {value: ["a1", "a2"]}}];
    const withProposed = p({requiredSkillIds: []}, {proposedProfiles: proposed, skillIds: new Set(["SK2-A", ...proposed[0].candidateSkills.value])});
    expect(withProposed.layers.PROFILED.state).toBe("FALSE");
    expect(withProposed.layers.PROFILED.reasons).toContain("NO_CANONICAL_SKILLS");
    expect(withProposed.proposedOnly).toEqual({candidateSkills: 72, candidateToolAdapterIds: 2});
    const promoted = new Set(["FIXTURE_VERIFIED"]);
    expect(p({requiredTechnologies: tech("FIXTURE_VERIFIED")}).layers.PROFILED).toEqual({state: "FALSE", reasons: ["TECHNOLOGY_STATUS_NOT_PROMOTED"]});
    expect(p({requiredTechnologies: tech("FIXTURE_VERIFIED")}, {promotedTechnologyStatuses: promoted}).layers.PROFILED).toEqual({state: "TRUE", reasons: []});
    expect(p({requiredTechnologies: []}, {promotedTechnologyStatuses: promoted}).layers.PROFILED).toEqual({state: "FALSE", reasons: ["NO_REQUIRED_TECHNOLOGIES"]});
    expect(p({requiredTechnologies: [{technologyId: "no-such-slug", status: "FIXTURE_VERIFIED"}]}, {promotedTechnologyStatuses: promoted}).layers.PROFILED).toEqual({state: "FALSE", reasons: ["TECHNOLOGY_NOT_IN_REGISTRY"]});
    expect(p({requiredSkillIds: [], requiredTechnologies: tech("FIXTURE_VERIFIED")}, {promotedTechnologyStatuses: promoted}).layers.PROFILED.reasons).toEqual(["NO_CANONICAL_SKILLS"]);
    // //TR: Önerilen adaptör/yetenek sayıları PROFILED/TOOL_READY'yi terfi ettirmez; kayıtlı olmayan terfi durumu sınıfı sabittir.
    expect(PROMOTED_TECHNOLOGY_STATUSES.has("CANDIDATE_NOT_VERIFIED")).toBe(false);
    expect(PROMOTED_TECHNOLOGY_STATUSES.has("NAME_NOT_VERIFIED_IN_REGISTRY")).toBe(false);
    // //TR: Gerçek kayıtta önerilen 197 rol adayı yetenek taşır ama hiçbiri PROFILED değildir.
    const real = computeRoleReadiness(realInput());
    expect(real.roles.filter(r => r.proposedOnly.candidateSkills > 0)).toHaveLength(197);
    expect(real.roles.filter(r => r.proposedOnly.candidateSkills > 0 && r.layers.PROFILED.state === "TRUE")).toHaveLength(0);
  });

  it("groups, denominators, determinism", () => {
    const a = computeRoleReadiness(realInput());
    expectWellFormed(a);
    expect(a.byGuild).toHaveLength(51);
    expect(a.byCluster).toHaveLength(10);
    expect(a.byGuild.map(g => g.id)).toEqual([...a.byGuild.map(g => g.id)].sort());
    expect(a.byCluster.map(g => g.id)).toEqual([...a.byCluster.map(g => g.id)].sort());
    for (const l of READINESS_LAYERS) {
      expect(a.totals[l].denominator).toBe(599);
      for (const s of STATES) {
        expect(a.byGuild.reduce((n, g) => n + g.layers[l][s], 0), `byGuild ${l} ${s}`).toBe(a.totals[l][s]);
        expect(a.byCluster.reduce((n, g) => n + g.layers[l][s], 0), `byCluster ${l} ${s}`).toBe(a.totals[l][s]);
      }
    }
    for (const s of STATES) {
      expect(a.byGuild.reduce((n, g) => n + g.stageWired[s], 0)).toBe(a.stageWired[s]);
      expect(a.byCluster.reduce((n, g) => n + g.stageWired[s], 0)).toBe(a.stageWired[s]);
    }
    const g = (id: string) => a.byGuild.find(x => x.id === id)!;
    expect(["G35", "G36", "G37", "G38"].map(id => g(id).layers.DEFINED.denominator)).toEqual([13, 13, 14, 13]);
    expect(a.byCluster.find(c => c.id === "CL07")!.layers.DEFINED.denominator).toBe(53);
    expect(g("G35").roles + g("G36").roles + g("G37").roles + g("G38").roles).toBe(53);
    const executable = Object.fromEntries(a.byGuild.map(x => [x.id, x.layers.EXECUTABLE.TRUE]).filter(([, n]) => n !== 0));
    expect(executable).toEqual({G03: 3, G04: 1, G05: 1, G08: 1, G22: 1, G27: 1});
    expect(g("G20").layers.EXECUTABLE.TRUE).toBe(0);
    expect(g("G08")).toMatchObject({kind: "GUILD", clusterId: "CL02"});
    expect(a.byCluster[0]).toMatchObject({kind: "CLUSTER", clusterId: null});
    // //TR: Rolü olmayan lonca da satırdır (payda 0, ölçülmüş); kayıtta olmayan bir rolün loncası da satır olur ve clusterId null kalır.
    const g99 = computeRoleReadiness(fxInput({}, {guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G99", clusterId: "CL01"}]}));
    expect(g99.byGuild.map(x => x.id)).toEqual(["G01", "G99"]);
    expect(g99.byGuild[1]).toMatchObject({id: "G99", roles: 0, clusterId: "CL01"});
    // //TR: Boş grup (payda 0) hiçbir şeyi ÖLÇMEMİŞTİR: measured false (koordinatör şartname değişikliği); tüm katmanlar ve aşama bağlantısı için geçerli.
    expect(g99.byGuild[1].layers.DEFINED).toEqual({TRUE: 0, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 0, denominator: 0, measured: false});
    for (const l of READINESS_LAYERS) expect(g99.byGuild[1].layers[l].measured, l).toBe(false);
    expect(g99.byGuild[1].stageWired.measured).toBe(false);
    expect(g99.byGuild[0].layers.DEFINED.measured).toBe(true);
    const nobody = computeRoleReadiness(fxInput({}, {roles: []}));
    expect(nobody.denominator).toBe(0);
    for (const l of READINESS_LAYERS) expect(nobody.totals[l], l).toEqual({TRUE: 0, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 0, denominator: 0, measured: false});
    expect(nobody.stageWired.measured).toBe(false);
    const stray = computeRoleReadiness(fxInput({guildId: "G77"}));
    expect(stray.byGuild.map(x => x.id)).toEqual(["G01", "G77"]);
    expect(stray.byGuild[1]).toMatchObject({id: "G77", roles: 1, clusterId: null});
    expect(stray.roles[0].layers.DEFINED).toEqual({state: "FALSE", reasons: ["GUILD_NOT_IN_REGISTRY"]});
    expect(computeRoleReadiness(fxInput({clusterId: "CL09"})).byCluster.map(x => x.id)).toEqual(["CL01", "CL09"]);
    // //TR: Belirlilik: now ve girdi dizisi sırası özeti değiştirmez; bir rolün proficiencyStatus'u değişirse özet değişir.
    const base = realInput();
    const d1 = computeRoleReadiness({...base, now: new Date("2030-01-01T00:00:00Z")}).digest;
    expect(d1).toBe(a.digest);
    expect(computeRoleReadiness({...base, roles: [...base.roles].reverse(), guilds: [...base.guilds].reverse(), clusters: [...base.clusters].reverse(), bindings: [...base.bindings].reverse()}).digest).toBe(a.digest);
    expect(computeRoleReadiness({...base, roles: base.roles.map((r, n) => n === 7 ? {...r, proficiencyStatus: "CERTIFIED"} : r)}).digest).not.toBe(a.digest);
    expect(computeRoleReadiness({...base, now: new Date("2030-01-01T00:00:00Z")}).computedAt).toBe("2030-01-01T00:00:00.000Z");
    expect(computeRoleReadiness({...base, roleDefinitionsSha256: "1".repeat(64)}).digest).not.toBe(a.digest);
    expect(computeRoleReadiness({...base, reachableStages: new Set(["IMPLEMENT"])}).digest).not.toBe(a.digest);
  });

  it("group rows match an independent oracle (per guild and per cluster)", () => {
    const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO, "registries", f), "utf8"));
    const roles = rd("role-definitions.json").roles as Array<{roleId: string; guildId: string; clusterId: string}>;
    const profiles = rd("role-execution-profiles.json").profiles as ProposedProfileLike[];
    const withSkills = new Set(profiles.filter(p => p.candidateSkills.value.length > 0).map(p => p.roleId));
    const withAdapters = new Set(profiles.filter(p => p.candidateToolAdapterIds.value.length > 0).map(p => p.roleId));
    const wired = new Set(["UASCO-0085", "UASCO-0252", "UASCO-0313"]);
    const a = computeRoleReadiness(realInput({reachableStages: new Set(["IMPLEMENT", "REVIEW"])}));
    type Pos = {guildId: string; clusterId: string};
    for (const [rows, pick] of [[a.byGuild, (r: Pos) => r.guildId], [a.byCluster, (r: Pos) => r.clusterId]] as const) {
      expect(rows.reduce((n, g) => n + g.roles, 0)).toBe(599);
      for (const g of rows) {
        const inGroup = roles.filter(r => pick(r) === g.id);
        expect(g.roles, g.id).toBe(inGroup.length);
        expect(g.proposedOnly, g.id).toEqual({withCandidateSkills: inGroup.filter(r => withSkills.has(r.roleId)).length, withCandidateToolAdapters: inGroup.filter(r => withAdapters.has(r.roleId)).length});
        expect(g.layers.DEFINED.TRUE, g.id).toBe(inGroup.length);
        expect(g.layers.EXECUTABLE.TRUE, g.id).toBe(inGroup.filter(r => EXECUTABLE_IDS.includes(r.roleId)).length);
        expect(g.layers.TOOL_READY.UNKNOWN, g.id).toBe(inGroup.filter(r => BOUND.includes(r.roleId)).length);
        expect(g.layers.RUNNING.UNKNOWN, g.id).toBe(inGroup.length);
        expect(g.stageWired.TRUE, g.id).toBe(inGroup.filter(r => wired.has(r.roleId)).length);
        expect(g.stageWired.FALSE, g.id).toBe(inGroup.length - inGroup.filter(r => wired.has(r.roleId)).length);
        expect(g.layers.EVALUATED.FALSE, g.id).toBe(inGroup.length);
      }
    }
    // //TR: Oracle gerçekten ayırt eder: adaylı roller loncalar/kümeler arasında dağılmıştır (hepsi aynı satırda değil) ve toplamla eşleşir.
    expect(a.byGuild.filter(g => g.proposedOnly.withCandidateSkills > 0).length).toBeGreaterThan(5);
    expect(a.byGuild.reduce((n, g) => n + g.proposedOnly.withCandidateSkills, 0)).toBe(197);
    expect(a.byCluster.reduce((n, g) => n + g.proposedOnly.withCandidateToolAdapters, 0)).toBe(164);
  });

  it("duplicate guild, binding and proposed-profile keys are rejected, never first-wins", () => {
    expect(() => computeRoleReadiness(fxInput({}, {guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G01", clusterId: "CL01"}]}))).toThrow("READINESS_INPUT_INVALID:DUPLICATE_GUILD_ID:G01");
    expect(() => computeRoleReadiness(fxInput({}, {guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G01", clusterId: "CL02"}]}))).toThrow("READINESS_INPUT_INVALID:DUPLICATE_GUILD_ID:G01");
    expect(() => computeRoleReadiness(realInput({bindings: [...FIRST_DELIVERY_BINDINGS, {...FIRST_DELIVERY_BINDINGS[0], adapters: []}]}))).toThrow("READINESS_INPUT_INVALID:DUPLICATE_BINDING_ROLE_ID:UASCO-0022");
    const profile = (adapters: string[]): ProposedProfileLike => ({roleId: "UASCO-0001", candidateSkills: {value: []}, candidateToolAdapterIds: {value: adapters}});
    expect(() => computeRoleReadiness(fxInput({}, {proposedProfiles: [profile(["a"]), profile([])]}))).toThrow("READINESS_INPUT_INVALID:DUPLICATE_PROPOSED_PROFILE_ROLE_ID:UASCO-0001");
    // //TR: Yinelenen ROL kimliği hata değil bulgudur (DEFINED FALSE) ve özeti dizi sırasına bağlı değildir; yinelenmeyen girdide sıra özeti değiştirmez.
    const a = fxRole({title: "A"}), b = fxRole({title: "B", evaluationSpecs: []});
    const d1 = computeRoleReadiness({...fxInput(), roles: [a, b]}), d2 = computeRoleReadiness({...fxInput(), roles: [b, a]});
    expect(d1.digest).toBe(d2.digest);
    expect(d1.roles.map(r => r.layers.DEFINED.reasons)).toEqual([["DUPLICATE_ROLE_ID"], ["DUPLICATE_ROLE_ID"]]);
    const g2 = {guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G02", clusterId: "CL01"}]};
    expect(computeRoleReadiness(fxInput({}, g2)).digest).toBe(computeRoleReadiness(fxInput({}, {guilds: [...g2.guilds].reverse()})).digest);
  });

  it("a non-default promoted set is disclosed and never labelled AUTHORITATIVE", () => {
    const tech = [{technologyId: "tech-a", status: "FIXTURE_VERIFIED"}];
    const plain = computeRoleReadiness(fxInput({requiredTechnologies: tech}));
    expect(plain.authority).toBe("AUTHORITATIVE_READINESS_MEASUREMENT");
    expect(plain.inputs.promotedTechnologyStatuses).toBe("DEFAULT");
    // //TR: Açıkça verilen ama varsayılanla AYNI (boş) küme varsayılan sayılır: etiket AUTHORITATIVE kalır.
    for (const same of [new Set<string>(), new Set(PROMOTED_TECHNOLOGY_STATUSES)]) {
      const a = computeRoleReadiness(fxInput({requiredTechnologies: tech}, {promotedTechnologyStatuses: same}));
      expect(a.authority).toBe("AUTHORITATIVE_READINESS_MEASUREMENT");
      expect(a.inputs.promotedTechnologyStatuses).toBe("DEFAULT");
      expect(a.digest).toBe(plain.digest);
    }
    const over = computeRoleReadiness(fxInput({requiredTechnologies: tech}, {promotedTechnologyStatuses: new Set(["FIXTURE_VERIFIED", "ANOTHER"])}));
    expect(over.authority).toBe("NON_AUTHORITATIVE_PROMOTED_STATUS_OVERRIDE");
    expect(over.inputs.promotedTechnologyStatuses).toEqual(["ANOTHER", "FIXTURE_VERIFIED"]);
    expect(over.roles[0].layers.PROFILED.state).toBe("TRUE");
    expect(over.digest).not.toBe(plain.digest);
    expect(computeRoleReadiness(fxInput({requiredTechnologies: tech}, {promotedTechnologyStatuses: new Set(["ANOTHER", "FIXTURE_VERIFIED"])})).digest).toBe(over.digest);
    // //TR: Gerçek kayıtta üretim çağıranı küme vermez; bu yüzden sonuç AUTHORITATIVE'dir.
    expect(computeRoleReadiness(realInput()).authority).toBe("AUTHORITATIVE_READINESS_MEASUREMENT");
  });

  it("tool readiness needs code and an observed probe", () => {
    const ready = (adapterId: string): AdapterRealityEntry => ({adapterId, codePath: "PRESENT", probe: "READY"});
    const allAdapters = [...new Set(FIRST_DELIVERY_BINDINGS.flatMap(b => b.adapters))];
    const reality = (over: Record<string, AdapterRealityEntry | null> = {}) => {
      const m = new Map<string, AdapterRealityEntry>(allAdapters.map(id => [id, ready(id)]));
      for (const [id, e] of Object.entries(over)) { if (e === null) m.delete(id); else m.set(id, e); }
      return m;
    };
    const tool = (over: Record<string, AdapterRealityEntry | null> = {}, bindings = FIRST_DELIVERY_BINDINGS) => computeRoleReadiness(realInput({adapterReality: reality(over), bindings}));
    const all = tool();
    expectWellFormed(all);
    expect(countOnly(all.totals.TOOL_READY)).toEqual({TRUE: 9, FALSE: 590, UNKNOWN: 0});
    expect(all.inputs.adapterReality).toBe("SUPPLIED");
    const notObserved = tool({"workos-predev-plan": {adapterId: "workos-predev-plan", codePath: "PRESENT", probe: "NOT_OBSERVED"}});
    expect(roleOf(notObserved, "UASCO-0019").layers.TOOL_READY).toEqual({state: "UNKNOWN", reasons: ["PROBE_NOT_OBSERVED"]});
    expect(notObserved.totals.TOOL_READY.TRUE).toBe(8);
    expect(roleOf(tool({"workos-predev-plan": null}), "UASCO-0019").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["ADAPTER_UNRESOLVED"]});
    expect(roleOf(tool({"workos-predev-plan": {adapterId: "workos-predev-plan", codePath: "ABSENT", probe: "READY"}}), "UASCO-0019").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["ADAPTER_CODE_ABSENT"]});
    expect(roleOf(tool({"workos-predev-plan": {adapterId: "workos-predev-plan", codePath: "PRESENT", probe: "FAILED"}}), "UASCO-0019").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["PROBE_FAILED"]});
    // //TR: Bir adaptör FAILED, diğeri NOT_OBSERVED ise FALSE kazanır ve TÜM nedenler yazılır; yalnız NOT_OBSERVED UNKNOWN'dur.
    const mixed = tool({"local-claude-implementer": {adapterId: "local-claude-implementer", codePath: "PRESENT", probe: "FAILED"}, "workos-runner": {adapterId: "workos-runner", codePath: "PRESENT", probe: "NOT_OBSERVED"}});
    expect(roleOf(mixed, "UASCO-0085").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["PROBE_FAILED", "PROBE_NOT_OBSERVED"]});
    // //TR: Bağlamada adaptör listesi boşsa TOOL_READY FALSE (ADAPTERS_MISSING) ve kod yolu da çözümleyici nedeniyle FALSE'tur; adaptör dizeleri tek başına asla TRUE yapmaz.
    const noAdapters = FIRST_DELIVERY_BINDINGS.map(b => b.roleId === "UASCO-0085" ? {...b, adapters: []} : b);
    const empty = tool({}, noAdapters);
    expect(roleOf(empty, "UASCO-0085").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["ADAPTERS_MISSING"]});
    expect(roleOf(empty, "UASCO-0085").layers.EXECUTABLE).toEqual({state: "FALSE", reasons: ["ADAPTERS_MISSING"]});
    expect(empty.totals.TOOL_READY.TRUE).toBe(8);
    // //TR: Roller için bağlama yoksa gerçek bir adaptör haritası bile onu TRUE yapmaz; erişilebilir her adaptör haritada olsa da.
    expect(roleOf(all, "UASCO-0001").layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["ROLE_HAS_NO_BINDING"]});
    const absent = computeRoleReadiness(realInput());
    expect(absent.totals.TOOL_READY.TRUE).toBe(0);
    expect(absent.inputs.adapterReality).toBe("NOT_SUPPLIED");
    expect(reasonsOf(absent, "TOOL_READY").ADAPTER_REALITY_NOT_SUPPLIED).toBe(9);
  });

  it("anomalies are flagged, never promote", () => {
    const real = (roleId: string, over: Record<string, unknown>) => computeRoleReadiness(realInput({roles: realInput().roles.map(r => r.roleId === roleId ? {...r, ...over} : r) as ReadinessRole[]}));
    const running = real("UASCO-0001", {runtimeStatus: "RUNNING"});
    expect(roleOf(running, "UASCO-0001").layers.RUNNING).toEqual({state: "UNKNOWN", reasons: ["NO_RUN_JOURNAL"]});
    expect(roleOf(running, "UASCO-0001").anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "runtimeStatus", value: "RUNNING"}]);
    expect(running.anomalies).toBe(1);
    expect(running.totals.RUNNING.TRUE).toBe(0);
    const certified = real("UASCO-0001", {proficiencyStatus: "CERTIFIED"});
    expect(roleOf(certified, "UASCO-0001").layers.INTERNALLY_CERTIFIED).toEqual({state: "FALSE", reasons: ["CERTIFICATION_EVIDENCE_INVALID"]});
    expect(roleOf(certified, "UASCO-0001").anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: "CERTIFIED"}]);
    expect(certified.totals.INTERNALLY_CERTIFIED.TRUE).toBe(0);
    expect(certified.totals.EVALUATED.TRUE).toBe(0);
    const specs = [{evaluationId: "EV-01", status: "PASSED", evaluatorEvidenceRef: null}, ...notExecuted().slice(1)];
    const claimed = real("UASCO-0001", {evaluationSpecs: specs});
    expect(roleOf(claimed, "UASCO-0001").layers.EVALUATED).toEqual({state: "FALSE", reasons: ["EVIDENCE_REJECTED"]});
    expect(roleOf(claimed, "UASCO-0001").anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "evaluationSpecs.status", value: "PASSED"}]);
    expect(claimed.totals.EVALUATED.TRUE).toBe(0);
    // //TR: Bozuk kayıt iddiası (proficiencyStatus başka bir değer) da anomalidir ama katmanı terfi ettirmez; yalnız doğru kayıt değerleri anomalisizdir.
    const other = real("UASCO-0001", {proficiencyStatus: "IN_PROGRESS"});
    expect(roleOf(other, "UASCO-0001").anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: "IN_PROGRESS"}]);
    expect(roleOf(other, "UASCO-0001").layers.EVALUATED.state).toBe("FALSE");
    // //TR: Gerçek günlükte RUNNING ve runtimeStatus RUNNING birlikte ise anomali yoktur; çoklu iddia aynı (alan, değer) için tek sayılır.
    const trace = {kind: "AGENT_TRACE", note: "agent=a1 role=UASCO-0085 state=RUNNING", evidenceId: "e", step: "IMPLEMENT", cycle: 0, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null};
    const ok = computeRoleReadiness(realInput({runs: {journal: "PRESENT", runs: [{status: "RUNNING", evidence: [trace]}] as never}, roles: realInput().roles.map(r => r.roleId === "UASCO-0085" ? {...r, runtimeStatus: "RUNNING"} : r) as ReadinessRole[]}));
    expect(roleOf(ok, "UASCO-0085").anomalies).toEqual([]);
    const dup = real("UASCO-0001", {evaluationSpecs: [{evaluationId: "EV-01", status: "PASSED", evaluatorEvidenceRef: null}, {evaluationId: "EV-02", status: "PASSED", evaluatorEvidenceRef: null}, ...notExecuted().slice(2)]});
    expect(roleOf(dup, "UASCO-0001").anomalies).toEqual([{kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "evaluationSpecs.status", value: "PASSED"}]);
    // //TR: Anomali katman sırası: gerçek günlük bir rolü EXECUTABLE olmadan RUNNING yapabilir (bağlamasız rol); bu da RUNNING_TRUE_WITHOUT_EXECUTABLE olarak işaretlenir ama RUNNING TRUE kalır (denetim ölçümü gizlemez).
    const stray = computeRoleReadiness(realInput({runs: {journal: "PRESENT", runs: [{status: "RUNNING", evidence: [{...trace, note: "agent=a1 role=UASCO-0001 state=RUNNING"}]}] as never}}));
    expect(roleOf(stray, "UASCO-0001").layers.RUNNING.state).toBe("TRUE");
    expect(roleOf(stray, "UASCO-0001").anomalies).toEqual([{kind: "LAYER_ORDER", detail: "RUNNING_TRUE_WITHOUT_EXECUTABLE"}]);
  });

  // //TR: Küçük ama geçerli bir depo kökü yazar (altı dosya grubu); tweak() belirli bir dosyayı bozmak/silmek içindir.
  const MINI: Record<string, unknown> = {
    "registries/role-definitions.json": {roles: [{roleId: "UASCO-0001", title: "T", guildId: "G01", clusterId: "CL01", requiredSkillIds: ["SK2-A"], requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}], knowledgeSourceRefs: [], evaluationSpecs: []}],
      guilds: [{guildId: "G01", clusterId: "CL01"}], clusters: [{clusterId: "CL01"}]},
    "registries/skills-v2.json": {skills: [{id: "SK2-A"}]},
    "registries/technologies.json": {technologies: [{slug: "tech-a", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]},
    "knowledge/technologies/tech-a.json": {knowledgeUnits: [{facet: "fundamentals", state: "NOT_RESEARCHED", sourceRefs: [], lastValidatedAt: null}]},
    "registries/technology-source-registry.json": {requiredProvenance: ["sourceId"], sourceClasses: [{class: "OFFICIAL_DOCUMENTATION", allowedForCertification: true}, {class: "REPUTABLE_SECONDARY", allowedForCertification: false}]},
    "registries/role-execution-profiles.json": {profiles: [{roleId: "UASCO-0001", candidateSkills: {value: ["S"]}, candidateToolAdapterIds: {value: []}}]}
  };
  const mini = (name: string, tweak: (files: Record<string, string | null>) => void = () => {}): string => {
    const root = fs.mkdtempSync(path.join(tmp, `${name}-`));
    const files: Record<string, string | null> = Object.fromEntries(Object.entries(MINI).map(([k, v]) => [k, JSON.stringify(v)]));
    tweak(files);
    for (const [rel, body] of Object.entries(files)) if (body !== null) { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), body); }
    return root;
  };
  const load = (root: string) => loadReadinessInputFromRepo(root, {runs: {journal: "ABSENT"}, now: NOW});
  const snapshot = (root: string): string => JSON.stringify(fs.readdirSync(root, {recursive: true}).sort().map(f => { const p = path.join(root, String(f)); return fs.statSync(p).isFile() ? [f, sha(fs.readFileSync(p))] : [f]; }));

  it("input loader fails closed", () => {
    const noSkills = mini("noskills", f => { f["registries/skills-v2.json"] = null; });
    expect(() => load(noSkills)).toThrow("READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json");
    // //TR: Gerçek depoda skills-v2.json'u olmayan KOPYA da aynı kapalı hatayı verir (yükleyici boş küme döndürmez).
    const realLike = fs.mkdtempSync(path.join(tmp, "reallike-"));
    fs.mkdirSync(path.join(realLike, "registries"), {recursive: true});
    fs.copyFileSync(path.join(REPO, "registries", "role-definitions.json"), path.join(realLike, "registries", "role-definitions.json"));
    expect(() => load(realLike)).toThrow("READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json");
    for (const rel of Object.keys(MINI)) expect(() => load(mini("missing", f => { f[rel] = null; })), `missing ${rel}`).toThrow(`READINESS_INPUT_UNAVAILABLE:${rel}`);
    for (const rel of Object.keys(MINI)) expect(() => load(mini("garbage", f => { f[rel] = "{not json"; })), `unparsable ${rel}`).toThrow(`READINESS_INPUT_UNAVAILABLE:${rel}`);
    // //TR: Boş roles/guilds/clusters/skills dizisi ölçüm değil bozuk girdidir (payda 0): tipli hatayla reddedilir, boş küme döndürülmez.
    const roleDoc = (over: Record<string, unknown>) => JSON.stringify({...(MINI["registries/role-definitions.json"] as Record<string, unknown>), ...over});
    for (const key of ["roles", "guilds", "clusters"]) expect(() => load(mini(`empty-${key}`, f => { f["registries/role-definitions.json"] = roleDoc({[key]: []}); })), key).toThrow("READINESS_INPUT_UNAVAILABLE:registries/role-definitions.json");
    expect(() => load(mini("empty-skills", f => { f["registries/skills-v2.json"] = JSON.stringify({skills: []}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json");
    // //TR: Şekli bozuk (dizi değil / alan eksik) dosya da fail-closed: boş veri ikame edilmez.
    expect(() => load(mini("shape1", f => { f["registries/skills-v2.json"] = JSON.stringify({skills: "none"}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json");
    expect(() => load(mini("shape2", f => { f["registries/role-definitions.json"] = JSON.stringify({roles: [{roleId: "UASCO-0001"}], guilds: [], clusters: []}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:registries/role-definitions.json");
    expect(() => load(mini("shape3", f => { f["knowledge/technologies/tech-a.json"] = JSON.stringify({knowledgeUnits: [{facet: "x"}]}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:knowledge/technologies/tech-a.json");
    expect(() => load(mini("shape4", f => { f["registries/technology-source-registry.json"] = JSON.stringify({requiredProvenance: [1], sourceClasses: []}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:registries/technology-source-registry.json");
    // //TR: Slug yol kaçışı (../) kayıt dosyasının kendisini suçlar; knowledge dizini dışına asla okunmaz.
    expect(() => load(mini("slug", f => { f["registries/technologies.json"] = JSON.stringify({technologies: [{slug: "../../registries/skills-v2", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:registries/technologies.json");
    // //TR: Eksik bilgi dosyası: technologies.json'daki HER slug için dosya gerekir.
    expect(() => load(mini("noknow", f => { f["registries/technologies.json"] = JSON.stringify({technologies: [{slug: "tech-a", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}, {slug: "tech-b", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]}); }))).toThrow("READINESS_INPUT_UNAVAILABLE:knowledge/technologies/tech-b.json");
  });

  it("loader maps the six inputs, binds the production bindings and never writes", () => {
    const root = mini("ok");
    const before = snapshot(root);
    const reachable = new Set(["IMPLEMENT"]), adapters = new Map<string, AdapterRealityEntry>();
    const i = loadReadinessInputFromRepo(root, {runs: {journal: "PRESENT", runs: []}, adapterReality: adapters, reachableStages: reachable, now: NOW});
    expect(snapshot(root)).toBe(before);
    expect(i.roles.map(r => r.roleId)).toEqual(["UASCO-0001"]);
    expect(i.guilds).toEqual([{guildId: "G01", clusterId: "CL01"}]);
    expect(i.clusters).toEqual([{clusterId: "CL01"}]);
    expect(i.roleDefinitionsSha256).toBe(sha(fs.readFileSync(path.join(root, "registries", "role-definitions.json"))));
    expect(i.bindings).toBe(FIRST_DELIVERY_BINDINGS);
    expect([...i.skillIds]).toEqual(["SK2-A"]);
    expect([...i.technologies]).toEqual([["tech-a", {status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]]);
    expect([...i.knowledgeProfiles.keys()]).toEqual(["tech-a"]);
    expect(i.sourceProvenance.requiredFields).toEqual(["sourceId"]);
    expect([...i.sourceProvenance.certifiableClasses]).toEqual(["OFFICIAL_DOCUMENTATION"]);
    expect(i.proposedProfiles).toEqual([{roleId: "UASCO-0001", candidateSkills: {value: ["S"]}, candidateToolAdapterIds: {value: []}}]);
    expect(i.runs).toEqual({journal: "PRESENT", runs: []});
    expect(i.adapterReality).toBe(adapters);
    expect(i.reachableStages).toBe(reachable);
    expect(i.promotedTechnologyStatuses).toBeUndefined();
    const bare = load(root);
    expect("adapterReality" in bare).toBe(false);
    expect("reachableStages" in bare).toBe(false);
    // //TR: Gerçek depo: beş sertifikalanabilir kaynak sınıfı, yedi zorunlu alan, 599 rol, 425 yetenek, 415 teknoloji ve 415 bilgi profili.
    const r = realInput();
    expect([r.roles.length, r.guilds.length, r.clusters.length, r.skillIds.size, r.technologies.size, r.knowledgeProfiles.size]).toEqual([599, 51, 10, 425, 415, 415]);
    expect([...r.sourceProvenance.certifiableClasses].sort()).toEqual(["AUTHORITATIVE_VENDOR_GUIDE", "OFFICIAL_DOCUMENTATION", "OFFICIAL_RELEASE_NOTES", "OFFICIAL_SECURITY_ADVISORY", "OFFICIAL_SPEC_STANDARD"]);
    expect(r.sourceProvenance.requiredFields).toEqual(["sourceId", "uriOrLocator", "sourceClass", "effectiveVersion", "fetchedAt", "digestOrRevision", "supersedes"]);
    expect(r.proposedProfiles).toHaveLength(599);
    expect(BOUND).toHaveLength(9);
  });
});
