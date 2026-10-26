// //TR: Bu dosya (C-RDY-1) 599 rol için sekiz hazırlık katmanını (DEFINED, PROFILED, KNOWLEDGE_READY, TOOL_READY, EXECUTABLE, EVALUATED, INTERNALLY_CERTIFIED, RUNNING) üç durumlu (TRUE/FALSE/UNKNOWN) ve sabit neden kodlu hesaplar; 51 lonca ve 10 küme için gerçek paydalarla toplar. TEK yetkili hazırlık ölçümüdür: JSON durum alanı hiçbir zaman kanıt sayılmaz, PROPOSED veri PROFILED sayılmaz, girdi yoksa 0 raporlanmaz (UNKNOWN), boş liste TRUE üretmez. EXECUTABLE/EVALUATED/INTERNALLY_CERTIFIED roleLifecycle() çağrısından türetilir (eski beş sayaçla ayrışamaz). Kullanıcıya görünen hiçbir sayıyı değiştirmez; yalnız ölçümü ekler. Saf hesap; dosya okuma yalnız loadReadinessInputFromRepo'dadır (salt okunur).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {resolveRoleExecution} from "./role-execution.js";
import type {NotExecutableReason, RoleExecutionProfile} from "./role-execution.js";
import {FIRST_DELIVERY_BINDINGS, STAGE_CONSUMERS} from "./first-delivery-bindings.js";
import {PRODUCTION_EXECUTOR_ROUTES, consumedFunctions, createEvidenceVerifier, roleLifecycle, runningRoleIdsFromRuns} from "./role-lifecycle.js";
import type {EvidenceVerifier, LifecycleContext, LifecycleRole, RoleStatusSummary, RunsObservation} from "./role-lifecycle.js";

export const READINESS_LAYERS = ["DEFINED", "PROFILED", "KNOWLEDGE_READY", "TOOL_READY", "EXECUTABLE", "EVALUATED", "INTERNALLY_CERTIFIED", "RUNNING"] as const;
export type ReadinessLayer = typeof READINESS_LAYERS[number];
// //TR: NOT_APPLICABLE bu pakette kanonik roller için KULLANILMAZ; C-RDY-2b varlık denetimleri için ayrılmıştır.
export type LayerState = "TRUE" | "FALSE" | "UNKNOWN" | "NOT_APPLICABLE";

export type DefinedReason = "BAD_ROLE_ID" | "DUPLICATE_ROLE_ID" | "GUILD_NOT_IN_REGISTRY" | "CLUSTER_MISMATCH";
export type ProfiledReason = "NO_CANONICAL_SKILLS" | "SKILL_NOT_IN_SK2" | "NO_REQUIRED_TECHNOLOGIES" | "TECHNOLOGY_NOT_IN_REGISTRY" | "TECHNOLOGY_STATUS_NOT_PROMOTED";
export type KnowledgeReason = "NO_REQUIRED_TECHNOLOGIES" | "ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY" | "KNOWLEDGE_PROFILE_MISSING" | "NO_RESEARCHED_SOURCED_UNIT";
export type ToolReason = "ROLE_HAS_NO_BINDING" | "ADAPTERS_MISSING" | "ADAPTER_REALITY_NOT_SUPPLIED" | "ADAPTER_UNRESOLVED" | "ADAPTER_CODE_ABSENT" | "PROBE_FAILED" | "PROBE_NOT_OBSERVED";
export type ExecutableReason = NotExecutableReason | "ROUTE_NOT_PRODUCTION_EXECUTOR" | "STAGE_NOT_CONSUMED";
export type StageWiredReason = "NO_CODE_PATH" | "REACHABLE_STAGES_NOT_SUPPLIED" | "STAGE_NOT_WIRED";
export type EvaluatedReason = "NO_EVALUATION_SPECS" | "NO_SPEC_EXECUTED" | "EVIDENCE_REJECTED";
export type CertifiedReason = "NOT_CERTIFIED_STATUS" | "CERTIFICATION_EVIDENCE_INVALID";
export type RunningReason = "NO_RUN_JOURNAL" | "NOT_IN_OPEN_RUN";
// //TR: Kapalı birleşim: bunun dışındaki herhangi bir dize tip hatasıdır.
export type ReadinessReason = DefinedReason | ProfiledReason | KnowledgeReason | ToolReason | ExecutableReason | StageWiredReason | EvaluatedReason | CertifiedReason | RunningReason;

// //TR: reasons sıralı ve tekilleştirilmiş; YALNIZ state === "TRUE" iken boştur.
export interface LayerResult { state: LayerState; reasons: readonly ReadinessReason[] }
// //TR: Dört durum payda'yı toplar; measured === (UNKNOWN === 0). Ölçülmemiş toplam asla 0 olarak sunulmamalıdır.
export interface LayerCount { TRUE: number; FALSE: number; UNKNOWN: number; NOT_APPLICABLE: number; denominator: number; measured: boolean }
export interface AdapterRealityEntry { adapterId: string; codePath: "PRESENT" | "ABSENT"; probe: "READY" | "FAILED" | "NOT_OBSERVED" }
export interface KnowledgeUnitLike { facet: string; state: string; sourceRefs: readonly unknown[]; lastValidatedAt: string | null }
export interface ReadinessRole extends LifecycleRole { clusterId: string; requiredSkillIds: readonly string[]; requiredTechnologies: readonly {technologyId: string; status: string}[]; knowledgeSourceRefs: readonly unknown[]; runtimeStatus?: string }
export interface ProposedProfileLike { roleId: string; candidateSkills: {value: readonly string[]}; candidateToolAdapterIds: {value: readonly string[]} }

// //TR: Terfi ettirilmiş teknoloji durumları BİLEREK boş küme: kayıt defterinde yalnız CANDIDATE_NOT_VERIFIED ve NAME_NOT_VERIFIED_IN_REGISTRY vardır (scripts/build-role-definitions.mjs), doğrulanmış bir durumu hiçbir şema/kod/yetki tanımlamaz. PROFILED bu yüzden 599/599 FALSE'tur; FD-1 (takma ad onayı) ve FD-9 (teknoloji doğrulama yetkisi) olmadan değişmez. Kümeye değer eklemek docs/authority-requests/ altında kayıtlı karar ister; üretim çağıranları promotedTechnologyStatuses VERMEMELİDİR (yalnız testler).
export const PROMOTED_TECHNOLOGY_STATUSES: ReadonlySet<string> = new Set<string>();

export interface ReadinessInput {
  roles: readonly ReadinessRole[];
  guilds: readonly {guildId: string; clusterId: string}[];
  clusters: readonly {clusterId: string}[];
  roleDefinitionsSha256: string;
  bindings: readonly RoleExecutionProfile[];
  verify: EvidenceVerifier;
  runs: RunsObservation;
  skillIds: ReadonlySet<string>;
  technologies: ReadonlyMap<string, {status: string; knowledgeState: string}>;
  knowledgeProfiles: ReadonlyMap<string, readonly KnowledgeUnitLike[]>;
  sourceProvenance: {requiredFields: readonly string[]; certifiableClasses: ReadonlySet<string>};
  proposedProfiles?: readonly ProposedProfileLike[];
  adapterReality?: ReadonlyMap<string, AdapterRealityEntry>;
  reachableStages?: ReadonlySet<string>;
  promotedTechnologyStatuses?: ReadonlySet<string>;
  now: Date;
}

export type ReadinessAnomaly =
  | {kind: "LAYER_ORDER"; detail: string}
  | {kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE"; field: "runtimeStatus" | "proficiencyStatus" | "evaluationSpecs.status"; value: string};

export interface RoleReadiness {
  roleId: string; guildId: string; clusterId: string;
  layers: Readonly<Record<ReadinessLayer, LayerResult>>;
  executable: {codePath: LayerResult; stageWired: LayerResult; consumingStages: readonly string[]};
  proposedOnly: {candidateSkills: number; candidateToolAdapterIds: number};
  anomalies: readonly ReadinessAnomaly[];
}
// //TR: GUILD satırında clusterId = loncanın kayıttaki kümesi (kayıtta yoksa null); CLUSTER satırında id zaten küme kimliğidir, clusterId null.
export interface ReadinessGroupRow {
  id: string; kind: "GUILD" | "CLUSTER"; clusterId: string | null; roles: number;
  layers: Readonly<Record<ReadinessLayer, LayerCount>>; stageWired: LayerCount;
  proposedOnly: {withCandidateSkills: number; withCandidateToolAdapters: number};
}
export interface ReadinessAudit {
  schemaVersion: "1.0.0"; authority: "AUTHORITATIVE_READINESS_MEASUREMENT";
  denominator: number;
  totals: Readonly<Record<ReadinessLayer, LayerCount>>; stageWired: LayerCount;
  byGuild: readonly ReadinessGroupRow[];
  byCluster: readonly ReadinessGroupRow[];
  reasonCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
  proposedOnly: {source: "PROPOSED_DERIVED_NOT_RUNTIME" | "ABSENT"; profiles: number; withCandidateSkills: number; withCandidateToolAdapters: number};
  inputs: {journal: "PRESENT" | "ABSENT"; adapterReality: "SUPPLIED" | "NOT_SUPPLIED"; reachableStages: "SUPPLIED" | "NOT_SUPPLIED"; backendEnabled: "UNKNOWN";
           roleDefinitionsSha256: string; bindingsCount: number; skillIds: number; technologies: number; knowledgeProfiles: number};
  anomalies: number;
  roles: readonly RoleReadiness[];
  computedAt: string;
  digest: string;
}

const ROLE_ID = /^UASCO-\d{4}$/;
const ISO_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

// //TR: Sonuç oluşturucu: nedenler sıralı + tekil; TRUE için boş, değilse en az bir neden (çağıranlar bunu korur).
const result = (state: LayerState, reasons: readonly ReadinessReason[]): LayerResult => ({state, reasons: [...new Set(reasons)].sort()});
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// //TR: Takvimde var olan bir tarih mi (2026-13-45 reddedilir): yuvarlak gidiş-dönüş ile doğrulanır.
const realDate = (y: string, mo: string, d: string): boolean => { const dt = new Date(Date.UTC(+y, +mo - 1, +d)); return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d; };
const isUtcTimestamp = (v: unknown): boolean => { const m = typeof v === "string" ? ISO_UTC_TIMESTAMP.exec(v) : null; return !!m && realDate(m[1], m[2], m[3]) && +m[4] < 24 && +m[5] < 60 && +m[6] < 60; };
const isIso8601 = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  const d = ISO_DATE.exec(v); if (d) return realDate(d[1], d[2], d[3]);
  const t = ISO_OFFSET_TIMESTAMP.exec(v); return !!t && realDate(t[1], t[2], t[3]) && +t[4] < 24 && +t[5] < 60 && +t[6] < 60;
};

// //TR: Bir kaynak referansı sertifikalanabilir mi: tüm zorunlu alanlar mevcut, sourceId/uriOrLocator/effectiveVersion/digestOrRevision boş olmayan dize, fetchedAt ISO-8601, sourceClass sertifikalanabilir sınıf.
function sourceRefQualifies(ref: unknown, p: ReadinessInput["sourceProvenance"]): boolean {
  if (!isObject(ref)) return false;
  if (!p.requiredFields.every(k => Object.hasOwn(ref, k))) return false;
  if (!isNonEmptyString(ref.sourceId) || !isNonEmptyString(ref.uriOrLocator) || !isNonEmptyString(ref.effectiveVersion) || !isNonEmptyString(ref.digestOrRevision)) return false;
  return isIso8601(ref.fetchedAt) && typeof ref.sourceClass === "string" && p.certifiableClasses.has(ref.sourceClass);
}
// //TR: Bir bilgi birimi "araştırılmış ve kaynaklı" mı: durum NOT_RESEARCHED değil, lastValidatedAt ISO-8601 UTC zaman damgası, kaynak referansları boş değil ve HEPSİ sertifikalanabilir.
function unitQualifies(u: KnowledgeUnitLike, p: ReadinessInput["sourceProvenance"]): boolean {
  if (!isObject(u) || typeof u.state !== "string" || u.state === "" || u.state === "NOT_RESEARCHED") return false;
  if (!isUtcTimestamp(u.lastValidatedAt)) return false;
  return Array.isArray(u.sourceRefs) && u.sourceRefs.length > 0 && u.sourceRefs.every(ref => sourceRefQualifies(ref, p));
}

interface Ctx {
  i: ReadinessInput; guildCluster: Map<string, string>; idCount: Map<string, number>; bindingBy: Map<string, RoleExecutionProfile>;
  proposedBy: Map<string, ProposedProfileLike>; promoted: ReadonlySet<string>; lifeCtx: LifecycleContext; runningIds: ReadonlySet<string>; consumed: ReadonlySet<string>;
}

function definedLayer(r: ReadinessRole, c: Ctx): LayerResult {
  const reasons: ReadinessReason[] = [];
  if (!ROLE_ID.test(String(r.roleId))) reasons.push("BAD_ROLE_ID");
  if ((c.idCount.get(r.roleId) ?? 0) !== 1) reasons.push("DUPLICATE_ROLE_ID");
  const cluster = c.guildCluster.get(r.guildId);
  if (cluster === undefined) reasons.push("GUILD_NOT_IN_REGISTRY");
  else if (cluster !== r.clusterId) reasons.push("CLUSTER_MISMATCH");
  return reasons.length === 0 ? result("TRUE", []) : result("FALSE", reasons);
}

// //TR: PROFILED YALNIZ kanonik kayıttan: önerilen (PROPOSED_DERIVED) profil ASLA etkilemez. Boş liste TRUE üretmez.
function profiledLayer(r: ReadinessRole, c: Ctx): LayerResult {
  const reasons: ReadinessReason[] = [];
  const skills = r.requiredSkillIds ?? [];
  const techs = r.requiredTechnologies ?? [];
  if (skills.length === 0) reasons.push("NO_CANONICAL_SKILLS");
  if (skills.some(id => !c.i.skillIds.has(id))) reasons.push("SKILL_NOT_IN_SK2");
  if (techs.length === 0) reasons.push("NO_REQUIRED_TECHNOLOGIES");
  if (techs.some(t => !c.i.technologies.has(t.technologyId))) reasons.push("TECHNOLOGY_NOT_IN_REGISTRY");
  if (techs.some(t => !c.promoted.has(t.status))) reasons.push("TECHNOLOGY_STATUS_NOT_PROMOTED");
  return reasons.length === 0 ? result("TRUE", []) : result("FALSE", reasons);
}

// //TR: Teknoloji yoksa UNKNOWN (asla TRUE): "her teknoloji" boş kümede sahte doğru olurdu.
function knowledgeLayer(r: ReadinessRole, c: Ctx): LayerResult {
  const techs = r.requiredTechnologies ?? [];
  if (techs.length === 0) return result("UNKNOWN", ["NO_REQUIRED_TECHNOLOGIES"]);
  const reasons: ReadinessReason[] = [];
  if ((r.knowledgeSourceRefs ?? []).length === 0) reasons.push("ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY");
  for (const t of techs) {
    const units = c.i.knowledgeProfiles.get(t.technologyId);
    if (units === undefined) reasons.push("KNOWLEDGE_PROFILE_MISSING");
    else if (!units.some(u => unitQualifies(u, c.i.sourceProvenance))) reasons.push("NO_RESEARCHED_SOURCED_UNIT");
  }
  return reasons.length === 0 ? result("TRUE", []) : result("FALSE", reasons);
}

// //TR: Araç hazırlığı kod yolu VE gözlenmiş bir yoklama ister; boş olmayan adaptör dizeleri asla TRUE yapmaz, registries/tool-adapters.json implementation alanı okunmaz.
function toolLayer(r: ReadinessRole, c: Ctx): LayerResult {
  const binding = c.bindingBy.get(r.roleId);
  if (!binding) return result("FALSE", ["ROLE_HAS_NO_BINDING"]);
  if (binding.adapters.length === 0) return result("FALSE", ["ADAPTERS_MISSING"]);
  if (!c.i.adapterReality) return result("UNKNOWN", ["ADAPTER_REALITY_NOT_SUPPLIED"]);
  const falses: ReadinessReason[] = [], unknowns: ReadinessReason[] = [];
  for (const a of binding.adapters) {
    const e = c.i.adapterReality.get(a);
    if (!e) falses.push("ADAPTER_UNRESOLVED");
    else if (e.codePath === "ABSENT") falses.push("ADAPTER_CODE_ABSENT");
    else if (e.probe === "FAILED") falses.push("PROBE_FAILED");
    else if (e.probe === "NOT_OBSERVED") unknowns.push("PROBE_NOT_OBSERVED");
  }
  if (falses.length > 0) return result("FALSE", [...falses, ...unknowns]);
  return unknowns.length > 0 ? result("UNKNOWN", unknowns) : result("TRUE", []);
}

interface ExecutablePart { codePath: LayerResult; stageWired: LayerResult; consumingStages: string[]; evaluated: LayerResult; certified: LayerResult }

// //TR: Kod yolu, EVALUATED ve INTERNALLY_CERTIFIED tek bir roleLifecycle() çağrısından türer: kural kopyası yok, eski sayaçlardan ayrışamaz. Çözümleyicinin EXECUTABLE etiketi bu katman DEĞİLDİR (9 rol); üretim rotası ve tüketici aşama da gerekir (8 rol).
function lifecycleLayers(r: ReadinessRole, c: Ctx): ExecutablePart {
  const lc = roleLifecycle(r, c.i.roles, c.lifeCtx);
  const res = resolveRoleExecution(r.roleId, c.i.roles, c.i.bindings);
  const codePathTrue = lc.implemented;
  const reasons: ReadinessReason[] = [];
  if (res.status === "NOT_EXECUTABLE") reasons.push(res.reason);
  else {
    if (!PRODUCTION_EXECUTOR_ROUTES.includes(res.profile.providerRoute)) reasons.push("ROUTE_NOT_PRODUCTION_EXECUTOR");
    if (!c.consumed.has(res.profile.function)) reasons.push("STAGE_NOT_CONSUMED");
  }
  const codePath = codePathTrue ? result("TRUE", []) : result("FALSE", reasons);
  const binding = c.bindingBy.get(r.roleId);
  const consumingStages = binding ? Object.entries(STAGE_CONSUMERS).filter(([, fns]) => fns.includes(binding.function)).map(([stage]) => stage).sort() : [];
  // //TR: Aşama bağlantısı AYRI raporlanır, EXECUTABLE'a karıştırılmaz; reachableStages yoksa asla varsayılan verilmez (UNKNOWN).
  let stageWired: LayerResult;
  if (!codePathTrue) stageWired = result("FALSE", ["NO_CODE_PATH"]);
  else if (!c.i.reachableStages) stageWired = result("UNKNOWN", ["REACHABLE_STAGES_NOT_SUPPLIED"]);
  else stageWired = consumingStages.some(s => c.i.reachableStages!.has(s)) ? result("TRUE", []) : result("FALSE", ["STAGE_NOT_WIRED"]);
  const specs = r.evaluationSpecs ?? [];
  const evalTrue = lc.tested;
  let evaluated: LayerResult;
  if (specs.length === 0) evaluated = result("FALSE", ["NO_EVALUATION_SPECS"]);
  else if (evalTrue) evaluated = result("TRUE", []);
  else evaluated = specs.every(s => s.status === "NOT_EXECUTED") ? result("FALSE", ["NO_SPEC_EXECUTED"]) : result("FALSE", ["EVIDENCE_REJECTED"]);
  const certTrue = lc.certified;
  const certified = certTrue ? result("TRUE", []) : result("FALSE", [r.proficiencyStatus === "CERTIFIED" ? "CERTIFICATION_EVIDENCE_INVALID" : "NOT_CERTIFIED_STATUS"]);
  return {codePath, stageWired, consumingStages, evaluated, certified};
}

// //TR: Günlük yoksa RUNNING her rol için UNKNOWN'dur (0 değil); günlük varsa yalnız açık bir run'ın AGENT_TRACE'indeki rol TRUE olur.
function runningLayer(r: ReadinessRole, c: Ctx): LayerResult {
  if (c.i.runs.journal === "ABSENT") return result("UNKNOWN", ["NO_RUN_JOURNAL"]);
  return c.runningIds.has(r.roleId) ? result("TRUE", []) : result("FALSE", ["NOT_IN_OPEN_RUN"]);
}

// //TR: Anomaliler kayıt iddiasının kanıtı aştığını veya katman sırasının bozulduğunu işaretler; HİÇBİR katmanı değiştirmez. Aynı (tür, alan, değer) tek kez sayılır.
function anomaliesOf(r: ReadinessRole, layers: Readonly<Record<ReadinessLayer, LayerResult>>): ReadinessAnomaly[] {
  const out = new Map<string, ReadinessAnomaly>();
  const add = (a: ReadinessAnomaly) => { out.set(JSON.stringify(a), a); };
  const is = (l: ReadinessLayer) => layers[l].state === "TRUE";
  if (is("EVALUATED") && !is("EXECUTABLE")) add({kind: "LAYER_ORDER", detail: "EVALUATED_TRUE_WITHOUT_EXECUTABLE"});
  if (is("INTERNALLY_CERTIFIED") && !is("EVALUATED")) add({kind: "LAYER_ORDER", detail: "INTERNALLY_CERTIFIED_TRUE_WITHOUT_EVALUATED"});
  if (is("RUNNING") && !is("EXECUTABLE")) add({kind: "LAYER_ORDER", detail: "RUNNING_TRUE_WITHOUT_EXECUTABLE"});
  if (typeof r.runtimeStatus === "string" && r.runtimeStatus !== "UNKNOWN" && !is("RUNNING")) add({kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "runtimeStatus", value: r.runtimeStatus});
  if (typeof r.proficiencyStatus === "string" && r.proficiencyStatus !== "NOT_EVALUATED" && !is("EVALUATED")) add({kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: r.proficiencyStatus});
  if (r.proficiencyStatus === "CERTIFIED" && !is("INTERNALLY_CERTIFIED")) add({kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "proficiencyStatus", value: "CERTIFIED"});
  if (!is("EVALUATED")) for (const s of r.evaluationSpecs ?? []) if (s.status !== "NOT_EXECUTED") add({kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE", field: "evaluationSpecs.status", value: String(s.status)});
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, a]) => a);
}

const countOf = (xs: readonly LayerResult[]): LayerCount => {
  const n = {TRUE: 0, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 0};
  for (const x of xs) n[x.state]++;
  return {...n, denominator: xs.length, measured: n.UNKNOWN === 0};
};
const layerCounts = (rs: readonly RoleReadiness[]): Readonly<Record<ReadinessLayer, LayerCount>> =>
  Object.fromEntries(READINESS_LAYERS.map(l => [l, countOf(rs.map(r => r.layers[l]))])) as Record<ReadinessLayer, LayerCount>;

// //TR: Kararlı JSON: anahtarlar sıralı, undefined alanlar atlanır; özet (digest) girdi dizisi sırasından ve now'dan bağımsızdır.
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

const firstWins = <T>(xs: readonly T[], key: (x: T) => string): Map<string, T> => { const m = new Map<string, T>(); for (const x of xs) if (!m.has(key(x))) m.set(key(x), x); return m; };

export function computeRoleReadiness(i: ReadinessInput): ReadinessAudit {
  const knownRoleIds = new Set(i.roles.map(r => r.roleId));
  const idCount = new Map<string, number>();
  for (const r of i.roles) idCount.set(r.roleId, (idCount.get(r.roleId) ?? 0) + 1);
  const guildCluster = new Map<string, string>();
  for (const g of i.guilds) if (!guildCluster.has(g.guildId)) guildCluster.set(g.guildId, g.clusterId);
  const runningIds = i.runs.journal === "PRESENT" ? runningRoleIdsFromRuns(i.runs.runs, knownRoleIds) : new Set<string>();
  const c: Ctx = {
    i, guildCluster, idCount, bindingBy: firstWins(i.bindings, b => b.roleId),
    proposedBy: firstWins(i.proposedProfiles ?? [], p => p.roleId), promoted: i.promotedTechnologyStatuses ?? PROMOTED_TECHNOLOGY_STATUSES,
    lifeCtx: {bindings: i.bindings, verify: i.verify, runningRoleIds: runningIds, nowMs: i.now.getTime()}, runningIds, consumed: consumedFunctions()
  };
  const computedAt = i.now.toISOString();

  const perRole: RoleReadiness[] = i.roles.map(r => {
    const x = lifecycleLayers(r, c);
    const layers: Record<ReadinessLayer, LayerResult> = {
      DEFINED: definedLayer(r, c), PROFILED: profiledLayer(r, c), KNOWLEDGE_READY: knowledgeLayer(r, c), TOOL_READY: toolLayer(r, c),
      EXECUTABLE: x.codePath, EVALUATED: x.evaluated, INTERNALLY_CERTIFIED: x.certified, RUNNING: runningLayer(r, c)
    };
    const p = c.proposedBy.get(r.roleId);
    return {
      roleId: r.roleId, guildId: r.guildId, clusterId: r.clusterId, layers,
      executable: {codePath: x.codePath, stageWired: x.stageWired, consumingStages: x.consumingStages},
      proposedOnly: {candidateSkills: p?.candidateSkills?.value?.length ?? 0, candidateToolAdapterIds: p?.candidateToolAdapterIds?.value?.length ?? 0},
      anomalies: anomaliesOf(r, layers)
    };
  }).sort((a, b) => (a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0));

  const row = (id: string, kind: "GUILD" | "CLUSTER", clusterId: string | null, group: readonly RoleReadiness[]): ReadinessGroupRow => ({
    id, kind, clusterId, roles: group.length, layers: layerCounts(group), stageWired: countOf(group.map(g => g.executable.stageWired)),
    proposedOnly: {withCandidateSkills: group.filter(g => g.proposedOnly.candidateSkills > 0).length, withCandidateToolAdapters: group.filter(g => g.proposedOnly.candidateToolAdapterIds > 0).length}
  });
  const guildIds = [...new Set([...i.guilds.map(g => g.guildId), ...perRole.map(r => r.guildId)])].sort();
  const clusterIds = [...new Set([...i.clusters.map(k => k.clusterId), ...perRole.map(r => r.clusterId)])].sort();
  const byGuild = guildIds.map(id => row(id, "GUILD", c.guildCluster.get(id) ?? null, perRole.filter(r => r.guildId === id)));
  const byCluster = clusterIds.map(id => row(id, "CLUSTER", null, perRole.filter(r => r.clusterId === id)));

  const reasonCounts: Record<string, Record<string, number>> = {};
  const tally = (key: string, pick: (r: RoleReadiness) => LayerResult) => {
    const m: Record<string, number> = {};
    for (const r of perRole) for (const reason of pick(r).reasons) m[reason] = (m[reason] ?? 0) + 1;
    reasonCounts[key] = m;
  };
  for (const l of READINESS_LAYERS) tally(l, r => r.layers[l]);
  tally("EXECUTABLE.stageWired", r => r.executable.stageWired);

  const body = {
    schemaVersion: "1.0.0" as const, authority: "AUTHORITATIVE_READINESS_MEASUREMENT" as const,
    denominator: perRole.length, totals: layerCounts(perRole), stageWired: countOf(perRole.map(r => r.executable.stageWired)),
    byGuild, byCluster, reasonCounts,
    proposedOnly: {
      source: i.proposedProfiles ? "PROPOSED_DERIVED_NOT_RUNTIME" as const : "ABSENT" as const, profiles: i.proposedProfiles?.length ?? 0,
      withCandidateSkills: perRole.filter(r => r.proposedOnly.candidateSkills > 0).length, withCandidateToolAdapters: perRole.filter(r => r.proposedOnly.candidateToolAdapterIds > 0).length
    },
    inputs: {
      journal: i.runs.journal, adapterReality: i.adapterReality ? "SUPPLIED" as const : "NOT_SUPPLIED" as const, reachableStages: i.reachableStages ? "SUPPLIED" as const : "NOT_SUPPLIED" as const,
      backendEnabled: "UNKNOWN" as const, roleDefinitionsSha256: i.roleDefinitionsSha256, bindingsCount: i.bindings.length, skillIds: i.skillIds.size, technologies: i.technologies.size, knowledgeProfiles: i.knowledgeProfiles.size
    },
    anomalies: perRole.reduce((n, r) => n + r.anomalies.length, 0), roles: perRole
  };
  const digest = sha256(stable(body));
  return {...body, computedAt, digest};
}

// //TR: Yükleyici YALNIZ şu dosyaları okur ve hiçbir şey yazmaz: registries/role-definitions.json, skills-v2.json, technologies.json, knowledge/technologies/<slug>.json (her slug için), technology-source-registry.json, role-execution-profiles.json. Eksik/çözümlenemeyen/şekli bozuk dosyada READINESS_INPUT_UNAVAILABLE:<depo-göreli yol> fırlatır; boş veri ASLA yerine konmaz. bindings = FIRST_DELIVERY_BINDINGS, verify = createEvidenceVerifier(repoRoot).
const unavailable = (rel: string): Error => new Error(`READINESS_INPUT_UNAVAILABLE:${rel}`);
const SLUG = /^[a-z0-9][a-z0-9._+-]*$/;
function readDoc(repoRoot: string, rel: string): {raw: Buffer; doc: Record<string, unknown>} {
  let raw: Buffer, doc: unknown;
  try { raw = fs.readFileSync(path.join(repoRoot, rel)); doc = JSON.parse(raw.toString("utf8")); } catch { throw unavailable(rel); }
  if (!isObject(doc)) throw unavailable(rel);
  return {raw, doc};
}
const arrayOf = (doc: Record<string, unknown>, key: string, rel: string): unknown[] => { const v = doc[key]; if (!Array.isArray(v)) throw unavailable(rel); return v; };

export function loadReadinessInputFromRepo(repoRoot: string, o: {runs: RunsObservation; adapterReality?: ReadonlyMap<string, AdapterRealityEntry>; reachableStages?: ReadonlySet<string>; now: Date}): ReadinessInput {
  const REL_ROLES = "registries/role-definitions.json", REL_SKILLS = "registries/skills-v2.json", REL_TECH = "registries/technologies.json", REL_SRC = "registries/technology-source-registry.json", REL_PROFILES = "registries/role-execution-profiles.json";
  const {raw, doc: rd} = readDoc(repoRoot, REL_ROLES);
  const roles = arrayOf(rd, "roles", REL_ROLES), guilds = arrayOf(rd, "guilds", REL_ROLES), clusters = arrayOf(rd, "clusters", REL_ROLES);
  const strArr = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
  for (const r of roles) if (!isObject(r) || typeof r.roleId !== "string" || typeof r.guildId !== "string" || typeof r.clusterId !== "string" || !strArr(r.requiredSkillIds) || !Array.isArray(r.knowledgeSourceRefs) || !Array.isArray(r.evaluationSpecs)
    || !Array.isArray(r.requiredTechnologies) || !r.requiredTechnologies.every(t => isObject(t) && typeof t.technologyId === "string" && typeof t.status === "string")) throw unavailable(REL_ROLES);
  for (const g of guilds) if (!isObject(g) || typeof g.guildId !== "string" || typeof g.clusterId !== "string") throw unavailable(REL_ROLES);
  for (const k of clusters) if (!isObject(k) || typeof k.clusterId !== "string") throw unavailable(REL_ROLES);

  const skills = arrayOf(readDoc(repoRoot, REL_SKILLS).doc, "skills", REL_SKILLS);
  for (const s of skills) if (!isObject(s) || typeof s.id !== "string") throw unavailable(REL_SKILLS);
  const techs = arrayOf(readDoc(repoRoot, REL_TECH).doc, "technologies", REL_TECH);
  for (const t of techs) if (!isObject(t) || typeof t.slug !== "string" || !SLUG.test(t.slug) || typeof t.status !== "string" || typeof t.knowledgeState !== "string") throw unavailable(REL_TECH);

  const knowledgeProfiles = new Map<string, readonly KnowledgeUnitLike[]>();
  for (const t of techs as {slug: string}[]) {
    const rel = `knowledge/technologies/${t.slug}.json`;
    const units = arrayOf(readDoc(repoRoot, rel).doc, "knowledgeUnits", rel);
    for (const u of units) if (!isObject(u) || typeof u.facet !== "string" || typeof u.state !== "string" || !Array.isArray(u.sourceRefs) || !(u.lastValidatedAt === null || typeof u.lastValidatedAt === "string")) throw unavailable(rel);
    knowledgeProfiles.set(t.slug, units as KnowledgeUnitLike[]);
  }

  const src = readDoc(repoRoot, REL_SRC).doc;
  const requiredFields = src.requiredProvenance, classes = arrayOf(src, "sourceClasses", REL_SRC);
  if (!strArr(requiredFields)) throw unavailable(REL_SRC);
  for (const k of classes) if (!isObject(k) || typeof k.class !== "string") throw unavailable(REL_SRC);
  const profiles = arrayOf(readDoc(repoRoot, REL_PROFILES).doc, "profiles", REL_PROFILES);
  for (const p of profiles) if (!isObject(p) || typeof p.roleId !== "string" || !isObject(p.candidateSkills) || !strArr(p.candidateSkills.value) || !isObject(p.candidateToolAdapterIds) || !strArr(p.candidateToolAdapterIds.value)) throw unavailable(REL_PROFILES);

  return {
    roles: roles as ReadinessRole[], guilds: guilds as {guildId: string; clusterId: string}[], clusters: clusters as {clusterId: string}[], roleDefinitionsSha256: sha256(raw),
    bindings: FIRST_DELIVERY_BINDINGS, verify: createEvidenceVerifier(repoRoot), runs: o.runs,
    skillIds: new Set((skills as {id: string}[]).map(s => s.id)),
    technologies: new Map((techs as {slug: string; status: string; knowledgeState: string}[]).map(t => [t.slug, {status: t.status, knowledgeState: t.knowledgeState}] as [string, {status: string; knowledgeState: string}])),
    knowledgeProfiles,
    sourceProvenance: {requiredFields: requiredFields as string[], certifiableClasses: new Set((classes as {class: string; allowedForCertification?: unknown}[]).filter(k => k.allowedForCertification === true).map(k => k.class))},
    proposedProfiles: profiles as ProposedProfileLike[],
    ...(o.adapterReality ? {adapterReality: o.adapterReality} : {}), ...(o.reachableStages ? {reachableStages: o.reachableStages} : {}), now: o.now
  };
}

// //TR: Eski beş sayaç (computeRoleStatusSummary) DEPRECATED_LEGACY_PROJECTION olarak denetimle uzlaştırılır: registered=DEFINED, implemented=EXECUTABLE(kod yolu, aşama bağlantısı DEĞİL), tested=EVALUATED, certified=INTERNALLY_CERTIFIED, running=RUNNING toplamı; toplam VE her lonca satırı için. Uyuşmazlık "<total|loncaId>.<sayaç>:<eski>!=<denetim>" biçimindedir; lonca satırı iki taraftan birinde yoksa "<loncaId>.row:..." yazılır. running günlük yoksa ölçülmüş DEĞİLDİR (runningMeasured=false).
export interface LegacyReconciliation {
  status: "DEPRECATED_LEGACY_PROJECTION"; authority: "readiness"; consistent: boolean; mismatches: readonly string[];
  runningMeasured: boolean; implementedMeaning: "EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES"; implementedStageWired: number | "UNKNOWN";
}
const LEGACY_COUNTERS = [["registered", "DEFINED"], ["implemented", "EXECUTABLE"], ["tested", "EVALUATED"], ["certified", "INTERNALLY_CERTIFIED"], ["running", "RUNNING"]] as const;

export function reconcileLegacyStatusSummary(legacy: RoleStatusSummary, audit: ReadinessAudit): LegacyReconciliation {
  const mismatches: string[] = [];
  const cmp = (scope: string, l: Record<string, number>, layers: Readonly<Record<ReadinessLayer, LayerCount>>) => {
    for (const [counter, layer] of LEGACY_COUNTERS) if (l[counter] !== layers[layer].TRUE) mismatches.push(`${scope}.${counter}:${l[counter]}!=${layers[layer].TRUE}`);
  };
  cmp("total", legacy as unknown as Record<string, number>, audit.totals);
  const legacyRows = new Map(legacy.byGuild.map(g => [g.guildId, g] as const));
  for (const g of audit.byGuild) {
    const lr = legacyRows.get(g.id);
    if (!lr) mismatches.push(`${g.id}.row:absent!=present`);
    else cmp(g.id, lr as unknown as Record<string, number>, g.layers);
  }
  const auditIds = new Set(audit.byGuild.map(g => g.id));
  for (const g of legacy.byGuild) if (!auditIds.has(g.guildId)) mismatches.push(`${g.guildId}.row:present!=absent`);
  return {
    status: "DEPRECATED_LEGACY_PROJECTION", authority: "readiness", consistent: mismatches.length === 0, mismatches,
    runningMeasured: audit.inputs.journal === "PRESENT", implementedMeaning: "EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES",
    implementedStageWired: audit.inputs.reachableStages === "SUPPLIED" ? audit.stageWired.TRUE : "UNKNOWN"
  };
}
