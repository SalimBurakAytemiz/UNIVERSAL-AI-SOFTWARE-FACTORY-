// //TR: Bu dosya (C-CTX-1) 599 rolden herhangi birine TİPLİ, KAYNAK ETİKETLİ ve BAYT SINIRLI bir rol bağlamı çözer: kanonik rol metni (başlık, lonca, sorumluluklar, yasaklı eylemler, uzmanlık sınırları), teknolojiler (rolün kendi durumu + kayıt defteri durumu + bilgi durumu; çözülemeyen ad kayıtsız etiketlenir), beceriler KANONİK (bugün 0) ve ÖNERİLEN (PROPOSED_DERIVED, yalnız SEMANTIC_VERIFIED takma ad üzerinden eski beceri matrisi), inceleme zinciri, bağlama durumu (çözümleyici etiketi, hazırlık EXECUTABLE katmanı DEĞİL) ve açık boşluk kimlikleri. verifiedKnowledge her zaman false'tur: hiçbir teknoloji/beceri "doğrulanmış" ya da "sertifikalı" yapılmaz (FD-9 açık), takma adlar onaylanmaz (FD-1), ÖNERİLEN beceri asla KANONİK altına girmez. Saf hesap: dosya okuma yalnız loadRoleContextInputFromRepo'dadır (salt okunur); modelin davranışını değiştirmez.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {resolveRoleExecution} from "./role-execution.js";
import type {NotExecutableReason, ProviderRoute, RoleExecutionProfile} from "./role-execution.js";
import {FIRST_DELIVERY_BINDINGS} from "./first-delivery-bindings.js";

export const ROLE_CONTEXT_SCHEMA_VERSION = "1.0.0";
// //TR: Varsayılan bayt sınırı: SON serileştirilmiş bağlam (bytes ve digest alanları DAHİL) bu sınırı aşarsa listeler öncelik sırasıyla kısaltılır ve kısaltma AÇIKÇA işaretlenir; kanonik metin asla kısaltılmaz (sığmıyorsa tipli ret). maxBytes sonlu ve pozitif bir sayı olmalıdır; NaN/sonsuz/sıfır/negatif sınırı sessizce kapatacağından ROLE_CONTEXT_INPUT_INVALID:MAX_BYTES:<değer> ile reddedilir.
export const ROLE_CONTEXT_DEFAULT_MAX_BYTES = 24_576;
export const NAME_NOT_VERIFIED = "NAME_NOT_VERIFIED_IN_REGISTRY";
// //TR: Profil dosyasının inceleme zinciri durumu için KABUL EDİLEN değerler (bugün yalnız PROPOSED_DERIVED): yükleyici başka bir değeri (ör. CERTIFIED, `PROPOSED_DERIVED_CERTIFIED`, sonunda boşluklu `PROPOSED_DERIVED `) TAM eşitlikle ve HER satırda kapalı başarısızlıkla reddeder, böylece daha güçlü bir etiket sessizce bağlama taşınamaz; liste dondurulmuştur (push/atama ile genişletilemez). Çözümleyici saf bir fonksiyondur ve kendisine verilen profilin durumunu olduğu gibi etiketler; doğrulama yükleyicidedir.
export const ROLE_CONTEXT_PROFILE_STATUSES: readonly string[] = Object.freeze(["PROPOSED_DERIVED"]);
const REGISTRY = "registries/role-definitions.json";
const PROFILES = "registries/role-execution-profiles.json";

export interface ContextAlias { legacyId: string; legacyTitle?: string; status: string; approval?: string }
export interface ContextRole {
  roleId: string; title: string; guildId: string; clusterId: string; priority?: string; lifecycle?: string;
  responsibilities: readonly string[]; forbiddenActions: readonly string[]; specializationBoundaries: readonly string[];
  requiredSkillIds: readonly string[];
  requiredTechnologies: readonly {technologyId: string; status: string}[]; optionalTechnologies: readonly {technologyId: string; status: string}[];
  legacyAliases: readonly ContextAlias[]; gapIds: readonly string[];
  evaluationSpecs?: readonly {evaluationId: string; status: string; evaluatorEvidenceRef?: string | null}[];
}
// //TR: Profil alanlarının KENDİ durumu (status) vardır (bugün hepsi PROPOSED_DERIVED); inceleme zincirinin kaynak etiketi bu durumdan gelir, çözümleyicide sabit yazılmaz.
export interface ContextProfileLike { roleId: string; reviewChain: {value: readonly string[]; gapId: string | null; status: string}; candidateSkills: {value: readonly string[]; gapId: string | null} }
export interface RoleContextInput {
  roles: readonly ContextRole[];
  guilds: readonly {guildId: string; name?: string; clusterId: string}[];
  skillIds: ReadonlySet<string>;
  technologies: ReadonlyMap<string, {id: string; status: string; knowledgeState: string}>;
  legacySkills: ReadonlyMap<string, readonly string[]>;
  profiles: readonly ContextProfileLike[];
  bindings: readonly RoleExecutionProfile[];
}

export interface ContextTechnology {
  technologyId: string; requirement: "REQUIRED" | "OPTIONAL"; registryId: string | null; status: string; registryStatus: string | null; knowledgeState: string | null;
}
export interface ContextProposedSkill { skillId: string; status: "PROPOSED_DERIVED"; viaLegacyIds: readonly string[] }
export interface ContextTruncation { field: "skills.proposed" | "technologies.optional" | "aliases"; kept: number; total: number }
export interface RoleContext {
  schemaVersion: typeof ROLE_CONTEXT_SCHEMA_VERSION; roleId: string; verifiedKnowledge: false;
  canonical: {origin: "CANONICAL_ROLE_REGISTRY"; ref: string; title: string; guildId: string; guildName: string | null; clusterId: string; priority: string | null; lifecycle: string | null;
    responsibilities: readonly string[]; forbiddenActions: readonly string[]; specializationBoundaries: readonly string[]};
  technologies: readonly ContextTechnology[];
  skills: {canonical: readonly {skillId: string; origin: "CANONICAL_ROLE_REGISTRY"}[]; canonicalNotInSk2: readonly string[]; proposed: readonly ContextProposedSkill[]; proposedOrigin: "PROPOSED_DERIVED"};
  aliases: readonly {legacyId: string; legacyTitle: string | null; status: string; approval: string | null; origin: "LEGACY_REFERENCE"; usedForProposedSkills: boolean}[];
  reviewChain: {origin: string; value: readonly string[]; gapId: string | null} | null;
  binding: {origin: "CODE_BINDING_TABLE"; resolverLabel: "EXECUTABLE" | "NOT_EXECUTABLE"; reason: NotExecutableReason | null; function: string | null; providerRoute: ProviderRoute | null; adapters: readonly string[]; note: "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER"};
  gapIds: readonly string[];
  truncation: readonly ContextTruncation[];
  bytes: number;
  digest: string;
}
export type RoleContextReason = "ROLE_NOT_IN_CATALOG" | "ROLE_ID_DUPLICATE" | "ROLE_CONTEXT_EXCEEDS_BYTE_CAP";
export type RoleContextResult = {status: "RESOLVED"; context: RoleContext} | {status: "NOT_RESOLVED"; roleId: string; reason: RoleContextReason};

const uniqSorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
// //TR: Kararlı JSON: anahtarlar sıralı, undefined atlanır; özet girdi dizisi sırasından bağımsızdır.
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

// //TR: Girdi doğrulaması: yinelenen kimlik yazılmaz-kazanır değil HATADIR (özet dizi sırasına bağlı olurdu).
function indexBy<T>(xs: readonly T[], key: (x: T) => string, code: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of xs) { if (m.has(key(x))) throw new Error(`ROLE_CONTEXT_INPUT_INVALID:${code}:${key(x)}`); m.set(key(x), x); }
  return m;
}

// //TR: Seçenek doğrulaması: geçersiz maxBytes bir VERİ sorunu değil çağıran hatasıdır ve (rol aranmadan önce) fırlatılır.
function checkMaxBytes(o: {maxBytes?: number}): number {
  const maxBytes = o.maxBytes ?? ROLE_CONTEXT_DEFAULT_MAX_BYTES;
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error(`ROLE_CONTEXT_INPUT_INVALID:MAX_BYTES:${String(maxBytes)}`);
  return maxBytes;
}
// //TR: SON serileştirilmiş biçimin bayt uzunluğu: `bytes` alanı kendi hanelerini de sayar (sabit nokta; en küçük tutarlı değer) ve özet yer tutucusu 64 onaltılık karakterdir; gövde ile bytes/digest alanlarının toplamı sınırı aşamaz.
const DIGEST_PLACEHOLDER = "0".repeat(64);
function finalSize(body: Omit<RoleContext, "bytes" | "digest">): number {
  const base = Buffer.byteLength(stable({...body, bytes: 0, digest: DIGEST_PLACEHOLDER}), "utf8") - 1;
  for (let digits = 1; ; digits++) { const x = base + digits; if (String(x).length === digits) return x; }
}

export function resolveRoleContext(i: RoleContextInput, roleId: string, o: {maxBytes?: number} = {}): RoleContextResult {
  const maxBytes = checkMaxBytes(o);
  const matches = i.roles.filter(r => r.roleId === roleId);
  if (matches.length === 0) return {status: "NOT_RESOLVED", roleId, reason: "ROLE_NOT_IN_CATALOG"};
  if (matches.length > 1) return {status: "NOT_RESOLVED", roleId, reason: "ROLE_ID_DUPLICATE"};
  const role = matches[0];
  const guild = i.guilds.find(g => g.guildId === role.guildId);

  // //TR: Teknolojiler: gerekli önce, sonra isteğe bağlı; ad kayıt defterinde yoksa registryId null ve durum NAME_NOT_VERIFIED_IN_REGISTRY (düşürülmez, gizlenmez). Durum rolün KENDİ durumudur, asla yükseltilmez.
  const tech = (t: {technologyId: string; status: string}, requirement: "REQUIRED" | "OPTIONAL"): ContextTechnology => {
    const reg = i.technologies.get(t.technologyId);
    return {technologyId: t.technologyId, requirement, registryId: reg?.id ?? null, status: reg ? t.status : NAME_NOT_VERIFIED, registryStatus: reg?.status ?? null, knowledgeState: reg?.knowledgeState ?? null};
  };
  const bySlug = (a: ContextTechnology, b: ContextTechnology) => (a.technologyId < b.technologyId ? -1 : a.technologyId > b.technologyId ? 1 : 0);
  const required = role.requiredTechnologies.map(t => tech(t, "REQUIRED")).sort(bySlug);
  const optional = role.optionalTechnologies.map(t => tech(t, "OPTIONAL")).sort(bySlug);

  // //TR: Beceriler: KANONİK = rolün kendi requiredSkillIds'i (SK2'de olanlar); ÖNERİLEN = yalnız SEMANTIC_VERIFIED takma adın eski beceri matrisi satırı (SK2'de olanlar), kanonikte zaten olanlar hariç. Önerilen asla kanonik olmaz.
  const canonicalIds = uniqSorted(role.requiredSkillIds);
  const canonical = canonicalIds.filter(s => i.skillIds.has(s)).map(skillId => ({skillId, origin: "CANONICAL_ROLE_REGISTRY" as const}));
  const canonicalSet = new Set(canonical.map(c => c.skillId));
  const via = new Map<string, Set<string>>();
  for (const a of role.legacyAliases) {
    if (a.status !== "SEMANTIC_VERIFIED") continue;
    for (const s of i.legacySkills.get(a.legacyId) ?? []) if (i.skillIds.has(s) && !canonicalSet.has(s)) via.set(s, (via.get(s) ?? new Set<string>()).add(a.legacyId));
  }
  const proposedAll: ContextProposedSkill[] = [...via.keys()].sort().map(skillId => ({skillId, status: "PROPOSED_DERIVED" as const, viaLegacyIds: uniqSorted(via.get(skillId)!)}));
  const aliases = [...role.legacyAliases].sort((a, b) => (a.legacyId < b.legacyId ? -1 : a.legacyId > b.legacyId ? 1 : 0)).map(a => ({
    legacyId: a.legacyId, legacyTitle: a.legacyTitle ?? null, status: a.status, approval: a.approval ?? null, origin: "LEGACY_REFERENCE" as const, usedForProposedSkills: a.status === "SEMANTIC_VERIFIED"
  }));

  const profile = i.profiles.find(p => p.roleId === role.roleId);
  const res = resolveRoleExecution(role.roleId, i.roles, i.bindings);
  const binding: RoleContext["binding"] = res.status === "EXECUTABLE"
    ? {origin: "CODE_BINDING_TABLE", resolverLabel: "EXECUTABLE", reason: null, function: res.profile.function, providerRoute: res.profile.providerRoute, adapters: [...res.profile.adapters], note: "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER"}
    : {origin: "CODE_BINDING_TABLE", resolverLabel: "NOT_EXECUTABLE", reason: res.reason, function: null, providerRoute: null, adapters: [], note: "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER"};
  const gapIds = uniqSorted([...role.gapIds, ...(profile ? [profile.reviewChain.gapId, profile.candidateSkills.gapId].filter((g): g is string => typeof g === "string") : [])]);

  const build = (keepProposed: number, keepOptional: number, keepAliases: number): Omit<RoleContext, "bytes" | "digest"> => ({
    schemaVersion: ROLE_CONTEXT_SCHEMA_VERSION, roleId: role.roleId, verifiedKnowledge: false,
    canonical: {origin: "CANONICAL_ROLE_REGISTRY", ref: `${REGISTRY}#roles[roleId=${role.roleId}]`, title: role.title, guildId: role.guildId, guildName: guild?.name ?? null, clusterId: role.clusterId, priority: role.priority ?? null, lifecycle: role.lifecycle ?? null,
      responsibilities: [...role.responsibilities], forbiddenActions: [...role.forbiddenActions], specializationBoundaries: [...role.specializationBoundaries]},
    technologies: [...required, ...optional.slice(0, keepOptional)],
    skills: {canonical, canonicalNotInSk2: canonicalIds.filter(s => !i.skillIds.has(s)), proposed: proposedAll.slice(0, keepProposed), proposedOrigin: "PROPOSED_DERIVED"},
    aliases: aliases.slice(0, keepAliases),
    reviewChain: profile ? {origin: profile.reviewChain.status, value: [...profile.reviewChain.value], gapId: profile.reviewChain.gapId} : null,
    binding, gapIds,
    truncation: [
      ...(keepProposed < proposedAll.length ? [{field: "skills.proposed" as const, kept: keepProposed, total: proposedAll.length}] : []),
      ...(keepOptional < optional.length ? [{field: "technologies.optional" as const, kept: keepOptional, total: optional.length}] : []),
      ...(keepAliases < aliases.length ? [{field: "aliases" as const, kept: keepAliases, total: aliases.length}] : [])
    ]
  });
  // //TR: Bayt sınırı: önce önerilen beceriler, sonra isteğe bağlı teknolojiler, sonra takma adlar yarıya indirilerek kısaltılır; her kısaltma truncation'da kayıtlıdır. Kanonik metin ve gerekli teknolojiler kısaltılmaz: hepsi atıldığında da sığmıyorsa tipli ret.
  let kp = proposedAll.length, ko = optional.length, ka = aliases.length;
  let body = build(kp, ko, ka);
  const shrink = (n: number) => (n === 0 ? 0 : Math.floor(n / 2));
  while (finalSize(body) > maxBytes) {
    if (kp > 0) kp = shrink(kp); else if (ko > 0) ko = shrink(ko); else if (ka > 0) ka = shrink(ka); else return {status: "NOT_RESOLVED", roleId, reason: "ROLE_CONTEXT_EXCEEDS_BYTE_CAP"};
    body = build(kp, ko, ka);
  }
  const bytes = finalSize(body);
  const digest = sha256(stable(body));
  return {status: "RESOLVED", context: {...body, bytes, digest}};
}

// //TR: Tüm roller için çözüm (roleId sırasıyla); veri sorunlarında hata fırlatmaz (rol başına tipli ret), geçersiz maxBytes ise çağıran hatasıdır ve ilk roldan önce fırlatılır.
export function resolveAllRoleContexts(i: RoleContextInput, o: {maxBytes?: number} = {}): RoleContextResult[] {
  checkMaxBytes(o);
  return uniqSorted(i.roles.map(r => r.roleId)).map(id => resolveRoleContext(i, id, o));
}

// //TR: Yükleyici YALNIZ şu dosyaları okur ve hiçbir şey yazmaz: registries/role-definitions.json, skills-v2.json, technologies.json, agent-skill-matrix.json, role-execution-profiles.json. Eksik/çözümlenemeyen/şekli bozuk/boş dosyada ROLE_CONTEXT_INPUT_UNAVAILABLE:<depo-göreli yol> fırlatır; boş veri ASLA yerine konmaz. Yinelenen anahtar ROLE_CONTEXT_INPUT_INVALID:<kod>:<anahtar> ile reddedilir. bindings = FIRST_DELIVERY_BINDINGS.
const unavailable = (rel: string): Error => new Error(`ROLE_CONTEXT_INPUT_UNAVAILABLE:${rel}`);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
// //TR: Profil boşluk kimliği (gapId) `string | null` olmalıdır: sayı, nesne, dizi, boolean ya da eksik alan kapalı başarısızlıktır (sessizce atlanmaz).
const gapRef = (v: unknown): boolean => v === null || typeof v === "string";
const techRefs = (v: unknown): boolean => Array.isArray(v) && v.every(t => isObject(t) && typeof t.technologyId === "string" && typeof t.status === "string");
function readArray(repoRoot: string, rel: string, key: string): unknown[] {
  let doc: unknown;
  try { doc = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8")); } catch { throw unavailable(rel); }
  if (!isObject(doc) || !Array.isArray(doc[key]) || (doc[key] as unknown[]).length === 0) throw unavailable(rel);
  return doc[key] as unknown[];
}

export function loadRoleContextInputFromRepo(repoRoot: string): RoleContextInput {
  const REL_SKILLS = "registries/skills-v2.json", REL_TECH = "registries/technologies.json", REL_MATRIX = "registries/agent-skill-matrix.json";
  const roles = readArray(repoRoot, REGISTRY, "roles"), guilds = readArray(repoRoot, REGISTRY, "guilds");
  for (const r of roles) if (!isObject(r) || typeof r.roleId !== "string" || typeof r.title !== "string" || typeof r.guildId !== "string" || typeof r.clusterId !== "string" || !strArr(r.responsibilities) || !strArr(r.forbiddenActions) || !strArr(r.specializationBoundaries)
    || !strArr(r.requiredSkillIds) || !techRefs(r.requiredTechnologies) || !techRefs(r.optionalTechnologies) || !strArr(r.gapIds)
    || !Array.isArray(r.legacyAliases) || !r.legacyAliases.every(a => isObject(a) && typeof a.legacyId === "string" && typeof a.status === "string")) throw unavailable(REGISTRY);
  for (const g of guilds) if (!isObject(g) || typeof g.guildId !== "string" || typeof g.clusterId !== "string") throw unavailable(REGISTRY);
  const skills = readArray(repoRoot, REL_SKILLS, "skills");
  for (const s of skills) if (!isObject(s) || typeof s.id !== "string") throw unavailable(REL_SKILLS);
  const techs = readArray(repoRoot, REL_TECH, "technologies");
  for (const t of techs) if (!isObject(t) || typeof t.id !== "string" || typeof t.slug !== "string" || typeof t.status !== "string" || typeof t.knowledgeState !== "string") throw unavailable(REL_TECH);
  const matrix = readArray(repoRoot, REL_MATRIX, "agents");
  for (const a of matrix) if (!isObject(a) || typeof a.agentId !== "string" || !strArr(a.requiredSkillIds)) throw unavailable(REL_MATRIX);
  const profiles = readArray(repoRoot, PROFILES, "profiles");
  for (const p of profiles) if (!isObject(p) || typeof p.roleId !== "string" || !isObject(p.reviewChain) || !strArr(p.reviewChain.value) || !ROLE_CONTEXT_PROFILE_STATUSES.includes(p.reviewChain.status as string) || !gapRef(p.reviewChain.gapId) || !isObject(p.candidateSkills) || !strArr(p.candidateSkills.value) || !gapRef(p.candidateSkills.gapId)) throw unavailable(PROFILES);
  const slug = indexBy(techs as {slug: string; id: string; status: string; knowledgeState: string}[], t => t.slug, "DUPLICATE_TECHNOLOGY_SLUG");
  const legacy = indexBy(matrix as {agentId: string; requiredSkillIds: string[]}[], a => a.agentId, "DUPLICATE_LEGACY_AGENT_ID");
  indexBy(profiles as {roleId: string}[], p => p.roleId, "DUPLICATE_PROFILE_ROLE_ID");
  indexBy(guilds as {guildId: string}[], g => g.guildId, "DUPLICATE_GUILD_ID");
  return {
    roles: roles as ContextRole[], guilds: guilds as RoleContextInput["guilds"],
    skillIds: new Set((skills as {id: string}[]).map(s => s.id)),
    technologies: new Map([...slug].map(([k, t]) => [k, {id: t.id, status: t.status, knowledgeState: t.knowledgeState}] as const)),
    legacySkills: new Map([...legacy].map(([k, a]) => [k, a.requiredSkillIds] as const)),
    profiles: profiles as ContextProfileLike[], bindings: FIRST_DELIVERY_BINDINGS
  };
}
