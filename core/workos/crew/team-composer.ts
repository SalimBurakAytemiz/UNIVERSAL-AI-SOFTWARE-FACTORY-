// //TR: Bu dosya CORE-7 "Agent Team Composer" çekirdeğini tanımlar: bir projenin onaylı pre-dev Plan/Requirements/Architecture çıktıları + MEVCUT 599 rol kataloğu üzerinden, KURAL TABANLI ve DETERMINISTIK bir ekip (crew) KOMPOZISYONU ÖNERISI üretir. Canlı model/ağ/shell YOKTUR; hiçbir rol UYDURULMAZ, hiçbir headcount uydurulmaz, hiçbir rol certified yapılmaz ve katalog DEĞİŞTİRİLMEZ (salt-okunur referans). Çıktı bir ÖNERIDIR (advisory): N canlı ajan veya certified worker İMA ETMEZ; her seçilen rol katalogdaki gerçek runtimeStatus (UNKNOWN) ve proficiencyStatus (NOT_EVALUATED) değerini aynen taşır. Eşlenemeyen bir yetenek için GERÇEK bir GAP girdisi üretilir (uydurma rol değil). Saf fonksiyon: aynı girdi -> aynı çıktı.
import {buildCrewPlan} from "./assignment.js";
import {PRE_DEV_ROLE_MAP} from "../predev/types.js";
import type {ArtifactKind, PlanContent, RequirementsContent, ArchitectureContent} from "../predev/types.js";
import type {ProjectBrief} from "../predev/driver.js";

// //TR: Composer'ın beklediği salt-okunur katalog yüzeyi. Alanlar registries/role-definitions.json'daki GERÇEK alanlardır; composer bunları YALNIZ okur (hiçbir alan yazılmaz/certified edilmez). Test gerçek kataloğu enjekte eder (stub yok).
export interface CatalogRole {
  readonly roleId: string;
  readonly title: string;
  readonly guildId: string;
  readonly clusterId: string;
  readonly specializationBoundaries?: readonly string[];
  readonly responsibilities?: readonly string[];
  readonly toolClassCandidates?: readonly string[];
  readonly runtimeStatus?: string;
  readonly proficiencyStatus?: string;
  readonly certifiedScope?: unknown;
}
export interface CatalogGuild {
  readonly guildId: string;
  readonly name: string;
  readonly clusterId: string;
}
export interface CatalogCluster {
  readonly clusterId: string;
  readonly name: string;
}
export interface RoleCatalog {
  readonly roles: readonly CatalogRole[];
  readonly guilds: readonly CatalogGuild[];
  readonly clusters: readonly CatalogCluster[];
}

// //TR: composeTeam'in ikinci argümanı: projenin ONAYLI pre-dev çıktıları (plan/requirements/architecture). Hepsi opsiyoneldir; composer yalnız verilen içeriklerden türetim yapar (olmayan içerik türetim üretmez). Katalog dışı hiçbir rol bu içerikten DE üretilmez.
export interface PreDevInputs {
  readonly requirements?: RequirementsContent;
  readonly plan?: PlanContent;
  readonly architecture?: ArchitectureContent;
}

// //TR: Önerilen bir rol SEÇIMI (rol TANIMI, canlı ajan DEĞIL). source seçimin neden önerildiğini söyler: PREDEV_FIRST_RELEASE (her zaman dahil edilen ~13 ilk-sürüm pre-dev rolü) ya da DERIVED (plan/requirements/architecture'daki somut bir öğeden türetilmiş). refs seçimin HIZMET ETTIĞI GERÇEK öğe kimlikleri/pre-dev artefakt türleridir. runtimeStatus/proficiencyStatus katalogdan AYNEN taşınır (bu paket bunları değiştirmez).
export type SelectionSource = "PREDEV_FIRST_RELEASE" | "DERIVED";
export interface RoleSelection {
  readonly roleId: string;
  readonly title: string;
  readonly guildId: string;
  readonly clusterId: string;
  readonly source: SelectionSource;
  readonly rationale: string;
  readonly refs: readonly string[];
  readonly runtimeStatus: string;
  readonly proficiencyStatus: string;
}

// //TR: Projenin ihtiyaç duyduğu ama katalogda EŞLEŞEN ROL BULUNMAYAN bir yetenek. Burada ASLA uydurma bir roleId üretilmez; dürüst bir boşluk bildirilir (refs: boşluğu tetikleyen gerçek öğe kimlikleri).
export interface CapabilityGap {
  readonly capabilityId: string;
  readonly label: string;
  readonly refs: readonly string[];
  readonly note: string;
}

// //TR: Önerilen ekip kompozisyonu. advisory=true: bu bir AKTIVASYON değil ÖNERIdir. liveAgentCount/certifiedWorkerCount SABIT 0'dır ve honestyNotice çıktının N canlı ajan ya da certified worker ima ETMEDIĞINI açıkça söyler. proposedRoleDefinitionCount seçilen rol TANIMI sayısıdır (ajan sayısı değil) ve plandan türeyen ölçeğe eşittir; uydurma headcount yoktur.
export interface ProposedTeam {
  readonly projectName: string;
  readonly isReference: boolean;
  readonly advisory: true;
  readonly activation: "NONE_PROPOSAL_ONLY";
  readonly selections: readonly RoleSelection[];
  readonly gaps: readonly CapabilityGap[];
  readonly proposedRoleDefinitionCount: number;
  readonly liveAgentCount: 0;
  readonly certifiedWorkerCount: 0;
  readonly honestyNotice: string;
}

export class TeamComposerError extends Error {
  constructor(message: string) { super(message); this.name = "TeamComposerError"; }
}

// //TR: Kural tabanlı yetenek tablosu (katalogdan BAĞIMSIZ, sabit ve dürüst). Her kural bir projede somut bir öğe metnine (triggers alt-dizgeleri) bakar; tetiklendiğinde katalogda roleMatch alt-dizgelerini içeren GERÇEK rolü arar. Eşleşme bulunursa o rol DETERMINISTIK seçilir; bulunamazsa dürüst bir GAP üretilir. triggers/roleMatch küçük harfe indirgenmiş alt-dizge eşleşmesidir (dil-bağımsız, uydurma yok).
interface CapabilityRule {
  readonly capabilityId: string;
  readonly label: string;
  readonly triggers: readonly string[];
  readonly roleMatch: readonly string[];
}
// //TR: Bu liste tipik yazılım projelerinin somut yeteneklerini kapsar. "mainframe/COBOL modernizasyonu" bilinçli olarak dürüst bir BOŞLUK adayıdır: 599 rollük katalog bu niş eski-sistem yeteneğini içermez, dolayısıyla bir proje bunu gerektirirse composer uydurma rol değil GAP üretir.
export const CAPABILITY_RULES: readonly CapabilityRule[] = [
  {capabilityId: "AUTHENTICATION", label: "Authentication & session management", triggers: ["auth", "login", "logout", "session", "oturum", "parola", "password", "hash", "kimlik doğrulama"], roleMatch: ["authentication", "session"]},
  {capabilityId: "AUTHORIZATION", label: "Authorization & tenant isolation", triggers: ["authoriz", "yetkilendirme", "tenant", "izolasyon", "workspace", "guard", "access control", "erişim"], roleMatch: ["authorization"]},
  {capabilityId: "BACKEND_API", label: "Backend API & application services", triggers: ["api", "backend", "http", "endpoint", "crud", "servis", "service", "uç"], roleMatch: ["backend"]},
  {capabilityId: "DATA_PERSISTENCE", label: "Relational data persistence & modeling", triggers: ["veritaban", "database", "persist", "kalıcı", "relational", "ilişkisel", "postgresql", "sql", "data model", "veri model", "store"], roleMatch: ["database"]},
  {capabilityId: "FRONTEND_WEB", label: "Frontend & responsive web UI", triggers: ["web", "ui", "arayüz", "responsive", "istemci", "client", "pano", "board", "frontend", "front-end"], roleMatch: ["frontend"]},
  {capabilityId: "LEGACY_MAINFRAME", label: "Legacy mainframe / COBOL modernization", triggers: ["mainframe", "cobol", "as/400", "z/os"], roleMatch: ["mainframe", "cobol"]}
];

// //TR: Bir öğeyi (projedeki somut kaynak) temsil eder: gerçek kimlik + aranabilir metin. kind yalnız izlenebilirlik içindir.
interface SourceElement {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
}

// //TR: Verilen pre-dev içeriklerinden GERÇEK kimlikli kaynak öğeleri deterministik sırayla toplar (requirements -> plan -> architecture). Yalnız gerçek id taşıyan öğeler alınır (techChoices gibi id'siz öğeler türetim ANCHOR'u olarak kullanılmaz).
function collectSourceElements(inputs: PreDevInputs): SourceElement[] {
  const els: SourceElement[] = [];
  if (inputs.requirements) {
    for (const r of inputs.requirements.functional) els.push({id: r.id, kind: "requirement.functional", text: `${r.statement} ${r.acceptanceCriteria.join(" ")}`});
    for (const r of inputs.requirements.nonFunctional) els.push({id: r.id, kind: "requirement.nonFunctional", text: `${r.statement} ${r.acceptanceCriteria.join(" ")}`});
  }
  if (inputs.plan) {
    for (const s of inputs.plan.scope) els.push({id: s.id, kind: "plan.scope", text: s.statement});
    for (const w of inputs.plan.workPackages) els.push({id: w.id, kind: "plan.workPackage", text: w.title});
  }
  if (inputs.architecture) {
    for (const c of inputs.architecture.components) els.push({id: c.id, kind: "architecture.component", text: `${c.name} ${c.responsibility}`});
  }
  return els;
}

// //TR: Bir kural teriminin bir katalog rolündeki ağırlıklı skoru: TITLE eşleşmesi en güçlü sinyaldir (10), specializationBoundaries orta (3), responsibilities/toolClassCandidates zayıf (1). Böylece ör. "authorization" terimi, başlığında taşıyan Authorization Policy Engineer'ı; yalnız sorumluluk metninde geçiren bir rolden önce seçer. Terim bulunmazsa 0.
function roleTermScore(role: CatalogRole, term: string): number {
  const m = term.toLowerCase();
  const title = role.title.toLowerCase();
  if (title.includes(m)) return 10;
  const spec = (role.specializationBoundaries ?? []).join(" ").toLowerCase();
  if (spec.includes(m)) return 3;
  const rest = [...(role.responsibilities ?? []), ...(role.toolClassCandidates ?? [])].join(" ").toLowerCase();
  if (rest.includes(m)) return 1;
  return 0;
}

// //TR: Bir kural için katalogdaki EN IYI rolü deterministik seçer. Skor = kuralın her roleMatch terimi için ağırlıklı skorların toplamı. En yüksek skor kazanır; eşitlikte roleId sözlüksel artan sıra belirler. Hiç aday yoksa null (-> dürüst GAP).
function bestRoleForRule(rule: CapabilityRule, roles: readonly CatalogRole[]): CatalogRole | null {
  let best: CatalogRole | null = null;
  let bestScore = 0;
  for (const role of roles) {
    let score = 0;
    for (const m of rule.roleMatch) score += roleTermScore(role, m);
    if (score === 0) continue;
    if (score > bestScore || (score === bestScore && best !== null && role.roleId < best.roleId)) {
      best = role; bestScore = score;
    }
  }
  return best;
}

function sortedUnique(xs: readonly string[]): string[] { return [...new Set(xs)].sort(); }

// //TR: Çekirdek: composeTeam. (1) Her zaman ~13 ilk-sürüm pre-dev rolünü (MEVCUT CrewPlan/PRE_DEV_ROLE_MAP) ekler; her birinin rationale'ı hizmet ettiği pre-dev artefakt türlerine referans verir. (2) Plan/requirements/architecture'daki somut öğelerden kural tabanlı ek roller türetir; her türetilmiş seçimin rationale'ı o öğenin GERÇEK kimliğine referans verir. (3) Eşleşmeyen yetenek için dürüst GAP üretir. Ölçek plandan türer (tetiklenen yetenek sayısı); uydurma headcount yoktur. Katalog salt-okunur; hiçbir rol eklenmez/certified edilmez; runtimeStatus/proficiencyStatus aynen taşınır. Deterministik + kararlı sıralama.
export function composeTeam(brief: ProjectBrief, inputs: PreDevInputs, catalog: RoleCatalog): ProposedTeam {
  if (!catalog || !Array.isArray(catalog.roles) || catalog.roles.length === 0) throw new TeamComposerError("TEAM_COMPOSER_EMPTY_CATALOG");
  const byId = new Map<string, CatalogRole>();
  for (const r of catalog.roles) byId.set(r.roleId, r);

  // //TR: roleId -> biriken seçim gerekçeleri. Pre-dev ve türetilmiş nedenler aynı rolde birleşir (tekilleştirme).
  interface Acc { source: SelectionSource; refs: Set<string>; reasons: string[] }
  const acc = new Map<string, Acc>();
  const ensure = (roleId: string, source: SelectionSource): Acc => {
    let a = acc.get(roleId);
    if (!a) { a = {source, refs: new Set<string>(), reasons: []}; acc.set(roleId, a); }
    return a;
  };

  // (1) Her zaman dahil edilen ~13 ilk-sürüm pre-dev rolü.
  const plan = buildCrewPlan();
  const kindOfRole = new Map<string, ArtifactKind[]>();
  for (const [kind, ids] of Object.entries(PRE_DEV_ROLE_MAP) as [ArtifactKind, readonly string[]][]) {
    for (const id of ids) { const arr = kindOfRole.get(id) ?? []; arr.push(kind); kindOfRole.set(id, arr); }
  }
  for (const roleId of plan.roleIds) {
    if (!byId.has(roleId)) throw new TeamComposerError(`TEAM_COMPOSER_PREDEV_ROLE_MISSING:${roleId}`);
    const a = ensure(roleId, "PREDEV_FIRST_RELEASE");
    const kinds = [...(kindOfRole.get(roleId) ?? [])].sort();
    for (const k of kinds) a.refs.add(k);
    a.reasons.push(`first-release pre-dev role for ${kinds.join("/")}`);
  }

  // (2) Plan/requirements/architecture öğelerinden kural tabanlı türetim.
  const elements = collectSourceElements(inputs);
  const triggered = new Map<string, Set<string>>(); // capabilityId -> tetikleyen öğe id'leri
  for (const el of elements) {
    const text = el.text.toLowerCase();
    for (const rule of CAPABILITY_RULES) {
      if (rule.triggers.some(t => text.includes(t.toLowerCase()))) {
        const set = triggered.get(rule.capabilityId) ?? new Set<string>();
        set.add(el.id); triggered.set(rule.capabilityId, set);
      }
    }
  }
  const gaps: CapabilityGap[] = [];
  // Kuralları sabit tanım sırasında işle (determinizm); içindeki refs her zaman sıralanır.
  for (const rule of CAPABILITY_RULES) {
    const refSet = triggered.get(rule.capabilityId);
    if (!refSet || refSet.size === 0) continue;
    const refs = sortedUnique([...refSet]);
    const role = bestRoleForRule(rule, catalog.roles);
    if (!role) {
      gaps.push({capabilityId: rule.capabilityId, label: rule.label, refs, note: `NO_CATALOG_ROLE_MATCHES_CAPABILITY: ${rule.capabilityId} (honest gap; no fabricated role proposed)`});
      continue;
    }
    const a = ensure(role.roleId, "DERIVED");
    for (const r of refs) a.refs.add(r);
    a.reasons.push(`${rule.label} required by ${refs.join(", ")}`);
  }

  // Seçimleri roleId'ye göre kararlı sırada üret; status'ları katalogdan AYNEN taşı.
  const selections: RoleSelection[] = [...acc.entries()].sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0).map(([roleId, a]) => {
    const role = byId.get(roleId)!;
    return {
      roleId,
      title: role.title,
      guildId: role.guildId,
      clusterId: role.clusterId,
      source: a.source,
      rationale: a.reasons.join("; "),
      refs: sortedUnique([...a.refs]),
      runtimeStatus: role.runtimeStatus ?? "UNKNOWN",
      proficiencyStatus: role.proficiencyStatus ?? "NOT_EVALUATED"
    };
  });
  gaps.sort((x, y) => x.capabilityId < y.capabilityId ? -1 : x.capabilityId > y.capabilityId ? 1 : 0);

  return {
    projectName: brief.projectName,
    isReference: brief.isReference,
    advisory: true,
    activation: "NONE_PROPOSAL_ONLY",
    selections,
    gaps,
    proposedRoleDefinitionCount: selections.length,
    liveAgentCount: 0,
    certifiedWorkerCount: 0,
    honestyNotice: "PROPOSAL of role DEFINITIONS only; references the real catalog read-only. This implies NO live/active agents and NO certified workers: every role keeps its catalog runtimeStatus (UNKNOWN) and proficiencyStatus (NOT_EVALUATED); no role is added to the catalog and none is certified. Advisory composition, not an activation."
  };
}
