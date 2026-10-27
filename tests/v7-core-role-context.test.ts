// //TR: Bu test C-CTX-1 Rol Bağlamı Çözümleyicisini (core/agents/role-context.ts) doğrular: 599 rolün hepsi hata fırlatmadan çözülür (T1); UASCO-0085 önerilen 72 beceri, kanonik 0, çözümleyici etiketi EXECUTABLE (T2); UASCO-0424 önerilen 0, boşluk kimliği ve ROLE_HAS_NO_BINDING (T3); UASCO-0450 autosar CANDIDATE_NOT_VERIFIED olarak görünür (T4); bilinmeyen rol ROLE_NOT_IN_CATALOG (T5); önerilen beceri hiçbir rolde kanonik altında değildir (T6); özet belirlidir ve kanonik metne duyarlıdır (T7); 41 çözülemeyen teknoloji referansı registryId null ve NAME_NOT_VERIFIED_IN_REGISTRY taşır (T8). Ek olarak bayt sınırı (her kısaltma aşamasında korumalı alanların bütünlüğü, kademeli yarılama, kısaltma kayıtları, son serileştirilmiş biçimin ölçülmesi, geçersiz maxBytes'in reddi, varsayılan sınırın zorlanması), registryStatus/knowledgeState'in kayıt satırını izlemesi ve yükseltme jetonu süpürmesi, profil verisinden bağımsız yeniden türetme (parite fixture'ı), özetin her alanı kapsaması, kaynak etiketleri, hiçbir doğrulanmış/sertifikalı durum uydurulmaması, takma ad kuralları ve yükleyicinin kapalı başarısızlığı sınanır. 599 rolün bağlamları beforeAll'da BİR kez hesaplanıp paylaşılır. Hiçbir test kayıt dosyasına yazmaz.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {NAME_NOT_VERIFIED, ROLE_CONTEXT_DEFAULT_MAX_BYTES, ROLE_CONTEXT_PROFILE_STATUSES, ROLE_CONTEXT_SCHEMA_VERSION, loadRoleContextInputFromRepo, resolveAllRoleContexts, resolveRoleContext} from "../core/agents/role-context.js";
import type {ContextProfileLike, ContextRole, RoleContext, RoleContextInput, RoleContextResult} from "../core/agents/role-context.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";

const REPO = path.resolve(import.meta.dirname, "..");
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
const REG = readJson("registries/role-definitions.json") as {roles: Array<Record<string, any>>; guilds: Array<Record<string, any>>};
const PROFILES = (readJson("registries/role-execution-profiles.json").profiles as Array<Record<string, any>>);
let INPUT: RoleContextInput | null = null;
const input = (): RoleContextInput => (INPUT ??= loadRoleContextInputFromRepo(REPO));
// //TR: 599 rolün bağlamı beforeAll'da BİR kez hesaplanır ve testler arasında paylaşılır (zaman aşımı yükseltilmez); fresh her çağrıda yeniden çözer (belirlilik/özet testleri paylaşılan nesneyle kıyaslanmaz), ctx varsayılan girdi ve seçeneklerde paylaşılan sonucu verir.
let ALL_RESULTS: RoleContextResult[] = [];
let ALL: RoleContext[] = [];
let ALL_BY_ID = new Map<string, RoleContext>();
const fresh = (id: string, i: RoleContextInput = input(), o: {maxBytes?: number} = {}): RoleContext => {
  const r = resolveRoleContext(i, id, o);
  if (r.status !== "RESOLVED") throw new Error(`not resolved: ${id} ${r.reason}`);
  return r.context;
};
const ctx = (id: string, i: RoleContextInput = input(), o: {maxBytes?: number} = {}): RoleContext => (i === INPUT && o.maxBytes === undefined && ALL_BY_ID.has(id) ? ALL_BY_ID.get(id)! : fresh(id, i, o));

// //TR: Küçük, bellek içi girdi (fixture): bir rol, bir lonca, birkaç beceri/teknoloji, eski beceri matrisi, bağlama yok.
const fxRole = (over: Partial<ContextRole> = {}): ContextRole => ({
  roleId: "UASCO-0001", title: "Fixture role", guildId: "G01", clusterId: "CL01", priority: "P0", lifecycle: "TARGET",
  responsibilities: ["R1", "R2"], forbiddenActions: ["F1"], specializationBoundaries: ["B1"], requiredSkillIds: [],
  requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}], optionalTechnologies: [], legacyAliases: [], gapIds: ["WFR-GAP-SKILLS-UASCO-0001"], evaluationSpecs: [], ...over
});
const fxInput = (roleOver: Partial<ContextRole> = {}, over: Partial<RoleContextInput> = {}): RoleContextInput => ({
  roles: [fxRole(roleOver)], guilds: [{guildId: "G01", name: "Guild One", clusterId: "CL01"}], skillIds: new Set(["SK2-A", "SK2-B", "SK2-C"]),
  technologies: new Map([["tech-a", {id: "TECH-A", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]]),
  legacySkills: new Map([["001", ["SK2-A", "SK2-B", "SK2-NOT-IN-SK2"]], ["002", ["SK2-C"]], ["003", ["SK2-A"]]]), profiles: [], bindings: [], ...over
});
const alias = (legacyId: string, status: string) => ({legacyId, legacyTitle: `Legacy ${legacyId}`, status, approval: "PROPOSED"});
const strip = ({bytes: _b, digest: _d, ...rest}: RoleContext) => rest;
const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
// //TR: Özetin ŞARTNAMESİ (çözümleyici koduna bağlı değil): sha256(anahtarları sıralı JSON; undefined atlanır) bytes ve digest dışındaki HER alanın üzerinde.
const canon = (v: unknown): string => v === null || typeof v !== "object" ? (JSON.stringify(v) ?? "null") : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;

const deepFreeze = <T>(v: T): T => { if (v !== null && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };

// //TR: Zengin fixture: tek rolde HER korumalı alan dolu (kanonik beceri, SK2'de olmayan kanonik beceri, iki gerekli teknoloji, 41 isteğe bağlı teknoloji (biri kayıtsız), 12 önerilen beceri, 9 takma ad, inceleme zinciri + boşluk, EXECUTABLE bağlama, boşluk kimlikleri); bayt sınırı her aşamada bu alanların bütünlüğünü korumalıdır.
const DEV_BINDING = FIRST_DELIVERY_BINDINGS.find(b => b.roleId === "UASCO-0085")!;
const OPT_SLUGS = Array.from({length: 40}, (_, k) => `opt-${String(k).padStart(2, "0")}`);
const PSK = Array.from({length: 12}, (_, k) => `SK2-P${String(k).padStart(2, "0")}`);
const techRow = (slug: string) => ({id: `TECH-${slug.toUpperCase()}`, status: "REGISTERED", knowledgeState: "SEED_PROFILE"});
const richProfile = (): ContextProfileLike => ({roleId: "UASCO-0001", reviewChain: {value: ["UASCO-0002"], gapId: "WFR-GAP-REVIEW-UASCO-0001", status: "PROPOSED_DERIVED"}, candidateSkills: {value: PSK, gapId: "WFR-GAP-CAND-UASCO-0001"}});
const richInput = (roleOver: Partial<ContextRole> = {}, over: Partial<RoleContextInput> = {}): RoleContextInput => fxInput({
  requiredSkillIds: ["SK2-A", "SK2-MISSING"],
  requiredTechnologies: [{technologyId: "tech-b", status: "CANDIDATE_NOT_VERIFIED"}, {technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}],
  optionalTechnologies: [...OPT_SLUGS, "ghost-opt"].map(technologyId => ({technologyId, status: "CANDIDATE_NOT_VERIFIED"})),
  legacyAliases: [alias("101", "SEMANTIC_VERIFIED"), alias("102", "SEMANTIC_VERIFIED"), alias("103", "SEMANTIC_VERIFIED"), alias("104", "SUSPECTED"), alias("105", "CONFLICT"), alias("106", "REJECTED"), alias("107", "SUSPECTED"), alias("108", "CONFLICT"), alias("109", "REJECTED")],
  gapIds: ["WFR-GAP-SKILLS-UASCO-0001", "WFR-GAP-TECH-UASCO-0001"], ...roleOver
}, {
  skillIds: new Set(["SK2-A", "SK2-B", "SK2-C", ...PSK]),
  technologies: new Map([["tech-a", techRow("tech-a")], ["tech-b", techRow("tech-b")], ...OPT_SLUGS.map(slug => [slug, techRow(slug)] as const)]),
  legacySkills: new Map([["101", PSK.slice(0, 5)], ["102", PSK.slice(4, 9)], ["103", PSK.slice(8)]]),
  profiles: [richProfile()], bindings: [{...DEV_BINDING, roleId: "UASCO-0001"}], ...over
});
// //TR: Kısaltma zinciri: sınır her adımda (önceki bağlamın bytes'ı − 1) yapılır, böylece çözümleyicinin ziyaret ettiği HER durum sırayla görülür; zincir tipli retle biter. Beklenen sıra bağımsız yazılmıştır: önerilen beceriler, sonra isteğe bağlı teknolojiler, sonra takma adlar; her liste yarıya (aşağı yuvarlanarak) iner ve 0'da biter.
const halves = (n: number): number[] => { const out = [n]; for (let k = n; k > 0;) { k = Math.floor(k / 2); out.push(k); } return out; };
function checkChain(i: RoleContextInput, id: string) {
  const full = fresh(id, i, {maxBytes: 10_000_000});
  const P = full.skills.proposed.length, O = full.technologies.filter(t => t.requirement === "OPTIONAL").length, A = full.aliases.length;
  expect(full.truncation).toEqual([]);
  const states: RoleContext[] = [full];
  let end: RoleContextResult;
  // //TR: Döngü SINIRLIDIR: kısaltmayı bırakan (reddi hiç vermeyen) bir çözümleyici sonsuz döngü değil, açık bir test hatası üretir (eşzamanlı sonsuz döngüyü vitest zaman aşımı kesemez).
  for (let guard = 0; ; guard++) {
    if (guard > 64) throw new Error(`ROLE_CONTEXT_CHAIN_DID_NOT_TERMINATE:${id}`);
    const r = resolveRoleContext(i, id, {maxBytes: states[states.length - 1].bytes - 1});
    if (r.status !== "RESOLVED") { end = r; break; }
    states.push(r.context);
  }
  const expected = [...halves(P).map(kp => [kp, O, A]), ...halves(O).slice(1).map(ko => [0, ko, A]), ...halves(A).slice(1).map(ka => [0, 0, ka])];
  const lists = (c: RoleContext) => [c.skills.proposed.length, c.technologies.filter(t => t.requirement === "OPTIONAL").length, c.aliases.length];
  expect(states.map(lists), `${id} cut order and halving`).toEqual(expected);
  const required = full.technologies.filter(t => t.requirement === "REQUIRED"), optional = full.technologies.filter(t => t.requirement === "OPTIONAL");
  states.forEach((c, k) => {
    const [kp, ko, ka] = expected[k];
    const records = [...(kp < P ? [{field: "skills.proposed", kept: kp, total: P}] : []), ...(ko < O ? [{field: "technologies.optional", kept: ko, total: O}] : []), ...(ka < A ? [{field: "aliases", kept: ka, total: A}] : [])];
    // //TR: HER durumda (zemin dahil) kısaltılmayan her alan sınırsız bağlamla AYNIDIR; kısaltılan listeler onun ön ekidir; kayıt tam olarak kesileni ve sayılarını söyler.
    expect(strip(c), `${id} state ${k} [${kp},${ko},${ka}]`).toEqual({...strip(full), technologies: [...required, ...optional.slice(0, ko)], skills: {...full.skills, proposed: full.skills.proposed.slice(0, kp)}, aliases: full.aliases.slice(0, ka), truncation: records});
    expect(c.bytes, `${id} state ${k} bytes`).toBe(Buffer.byteLength(JSON.stringify(c), "utf8"));
    if (k > 0) { expect(c.bytes).toBeLessThan(states[k - 1].bytes); expect(c.digest).not.toBe(states[k - 1].digest); }
    // //TR: Tam sığan sınır (bytes) bu durumu verir: sınır SON serileştirilmiş biçime uygulanır.
    expect(fresh(id, i, {maxBytes: c.bytes}).digest, `${id} state ${k} exact fit`).toBe(c.digest);
  });
  expect(end, `${id} floor`).toEqual({status: "NOT_RESOLVED", roleId: id, reason: "ROLE_CONTEXT_EXCEEDS_BYTE_CAP"});
  return {full, states, P, O, A};
}
// //TR: Parite denetimi: bağlamın önerilen becerileri profil dosyasının candidateSkills'iyle aynı mı? Bağlam profilden KOPYALANMAZ (SEMANTIC_VERIFIED takma ad + eski beceri matrisinden yeniden türetilir); fark yüksek sesle bildirilir.
function assertCandidateSkillsParity(i: RoleContextInput, contexts: readonly RoleContext[]): void {
  const byId = new Map(contexts.map(c => [c.roleId, c] as const)), bad: string[] = [];
  for (const p of i.profiles) {
    const c = byId.get(p.roleId);
    if (c === undefined) bad.push(`${p.roleId}:NO_CONTEXT`);
    else if (JSON.stringify(c.skills.proposed.map(x => x.skillId)) !== JSON.stringify(p.candidateSkills.value)) bad.push(`${p.roleId}:CANDIDATE_SKILLS`);
  }
  if (bad.length > 0) throw new Error(`PROFILE_PARITY_MISMATCH:${bad.join(",")}`);
}

describe("C-CTX-1 role-context", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ctx1-"));
    ALL_RESULTS = resolveAllRoleContexts(input());
    ALL = ALL_RESULTS.flatMap(r => (r.status === "RESOLVED" ? [r.context] : []));
    ALL_BY_ID = new Map(ALL.map(c => [c.roleId, c] as const));
  });
  afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

  it("all 599 roles resolve without throwing; title and guildId equal the registry", () => {
    const all = ALL_RESULTS;
    expect(all).toHaveLength(599);
    expect(all.filter(r => r.status === "RESOLVED")).toHaveLength(599);
    const byId = new Map(REG.roles.map(r => [r.roleId as string, r]));
    const guildName = new Map(REG.guilds.map(g => [g.guildId as string, g.name as string]));
    for (const r of all) {
      if (r.status !== "RESOLVED") continue;
      const c = r.context, raw = byId.get(c.roleId)!;
      expect(c.canonical.title, c.roleId).toBe(raw.title);
      expect(c.canonical.guildId, c.roleId).toBe(raw.guildId);
      expect(c.canonical.guildName, c.roleId).toBe(guildName.get(raw.guildId));
      expect(c.canonical.clusterId, c.roleId).toBe(raw.clusterId);
      // //TR: Kanonik metin 599/599 rolde dolu ve kayıtla birebir aynıdır.
      expect(c.canonical.responsibilities.length, c.roleId).toBeGreaterThan(0);
      expect(c.canonical.forbiddenActions.length, c.roleId).toBeGreaterThan(0);
      expect(c.canonical.specializationBoundaries.length, c.roleId).toBeGreaterThan(0);
      expect([...c.canonical.responsibilities], c.roleId).toEqual(raw.responsibilities);
      expect([...c.canonical.forbiddenActions], c.roleId).toEqual(raw.forbiddenActions);
      expect([...c.canonical.specializationBoundaries], c.roleId).toEqual(raw.specializationBoundaries);
      expect(c.canonical.origin).toBe("CANONICAL_ROLE_REGISTRY");
      expect(c.canonical.ref).toBe(`registries/role-definitions.json#roles[roleId=${c.roleId}]`);
      expect(c.verifiedKnowledge).toBe(false);
      expect(c.truncation, c.roleId).toEqual([]);
      expect(c.bytes, c.roleId).toBeLessThanOrEqual(ROLE_CONTEXT_DEFAULT_MAX_BYTES);
      expect(c.digest).toMatch(/^[0-9a-f]{64}$/);
      // //TR: priority ve lifecycle de kayıtla birebir aynıdır (KANONİK etiketi altında durum yükseltmesi olamaz); bytes SON serileştirilmiş biçimin bayt uzunluğudur.
      expect(c.canonical.priority, c.roleId).toBe(raw.priority ?? null);
      expect(c.canonical.lifecycle, c.roleId).toBe(raw.lifecycle ?? null);
      expect(c.bytes, c.roleId).toBe(Buffer.byteLength(JSON.stringify(c), "utf8"));
    }
    expect([...new Set(ALL.map(c => c.canonical.lifecycle))]).toEqual(["TARGET"]);
    expect(Object.fromEntries([...new Set(ALL.map(c => c.canonical.priority))].sort().map(pr => [pr, ALL.filter(c => c.canonical.priority === pr).length]))).toEqual({BACKLOG: 88, P0: 247, P1: 154, P2: 110});
    expect(Math.max(...ALL.map(c => c.bytes))).toBe(17_522);
    expect(all.map(r => (r.status === "RESOLVED" ? r.context.roleId : ""))).toEqual([...byId.keys()].sort());
  });

  it("UASCO-0085: proposed skills equal the profile candidateSkills, canonical is empty, resolver label EXECUTABLE", () => {
    const c = ctx("UASCO-0085");
    const profile = PROFILES.find(p => p.roleId === "UASCO-0085")!;
    expect(c.skills.proposed).toHaveLength(72);
    expect(c.skills.proposed.map(s => s.skillId)).toEqual(profile.candidateSkills.value);
    expect(c.skills.proposed.every(s => s.status === "PROPOSED_DERIVED" && s.viaLegacyIds.join() === "039")).toBe(true);
    expect(c.skills.proposedOrigin).toBe("PROPOSED_DERIVED");
    expect(c.skills.canonical).toEqual([]);
    expect(c.binding).toMatchObject({resolverLabel: "EXECUTABLE", reason: null, function: "developer", providerRoute: "CLAUDE_IMPLEMENTER", adapters: ["local-claude-implementer", "workos-runner"], note: "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER"});
    // //TR: Yalnız SEMANTIC_VERIFIED takma ad (039) kullanılır; aynı rolün CONFLICT takma adı (250) listelenir ama beceri üretmez.
    expect(c.aliases.map(a => [a.legacyId, a.status, a.usedForProposedSkills, a.origin])).toEqual([["039", "SEMANTIC_VERIFIED", true, "LEGACY_REFERENCE"], ["250", "CONFLICT", false, "LEGACY_REFERENCE"]]);
    expect(c.reviewChain).toEqual({origin: "PROPOSED_DERIVED", value: profile.reviewChain.value, gapId: profile.reviewChain.gapId});
  });

  it("UASCO-0424: no proposed skills, the skills gap is present, no binding", () => {
    const c = ctx("UASCO-0424");
    expect(c.skills.proposed).toEqual([]);
    expect(c.skills.canonical).toEqual([]);
    expect(c.gapIds).toContain("WFR-GAP-SKILLS-UASCO-0424");
    expect(c.binding).toMatchObject({resolverLabel: "NOT_EXECUTABLE", reason: "ROLE_HAS_NO_BINDING", function: null, providerRoute: null, adapters: []});
    expect(c.aliases).toEqual([]);
  });

  it("UASCO-0450: autosar is surfaced as CANDIDATE_NOT_VERIFIED, never upgraded", () => {
    const t = ctx("UASCO-0450").technologies.find(x => x.technologyId === "autosar")!;
    // //TR: Kayıt defteri autosar'ı REGISTERED/SEED_PROFILE gösterir ama rol onu CANDIDATE_NOT_VERIFIED ister: üç değer yan yana görünür, durum yükseltilmez.
    expect(t).toEqual({technologyId: "autosar", requirement: "REQUIRED", registryId: "TECH-AUTOSAR", status: "CANDIDATE_NOT_VERIFIED", registryStatus: "REGISTERED", knowledgeState: "SEED_PROFILE"});
  });

  it("an unknown role gives ROLE_NOT_IN_CATALOG", () => {
    expect(resolveRoleContext(input(), "UASCO-9999")).toEqual({status: "NOT_RESOLVED", roleId: "UASCO-9999", reason: "ROLE_NOT_IN_CATALOG"});
    expect(resolveRoleContext(input(), "")).toMatchObject({status: "NOT_RESOLVED", reason: "ROLE_NOT_IN_CATALOG"});
    expect(resolveRoleContext(fxInput({}, {roles: []}), "UASCO-0001")).toMatchObject({status: "NOT_RESOLVED", reason: "ROLE_NOT_IN_CATALOG"});
    // //TR: Yinelenen rol kimliği belirsizdir: ilk satır seçilmez, tipli ret.
    expect(resolveRoleContext(fxInput({}, {roles: [fxRole(), fxRole({title: "Second"})]}), "UASCO-0001")).toEqual({status: "NOT_RESOLVED", roleId: "UASCO-0001", reason: "ROLE_ID_DUPLICATE"});
  });

  it("proposed skills never appear under canonical, for any of the 599", () => {
    let withProposed = 0;
    for (const r of ALL_RESULTS) {
      if (r.status !== "RESOLVED") continue;
      const canonical = new Set(r.context.skills.canonical.map(s => s.skillId));
      if (r.context.skills.proposed.length > 0) withProposed++;
      expect(r.context.skills.canonical, r.context.roleId).toEqual([]);
      for (const p of r.context.skills.proposed) { expect(canonical.has(p.skillId), `${r.context.roleId} ${p.skillId}`).toBe(false); expect(p.status).toBe("PROPOSED_DERIVED"); }
    }
    expect(withProposed).toBe(197);
    // //TR: Fixture: bir beceri hem kanonik hem eski matriste ise YALNIZ kanonikte görünür; kanonik/önerilen kümeleri ayrık kalır.
    const c = ctx("UASCO-0001", fxInput({requiredSkillIds: ["SK2-A"], legacyAliases: [alias("001", "SEMANTIC_VERIFIED")]}));
    expect(c.skills.canonical.map(s => s.skillId)).toEqual(["SK2-A"]);
    expect(c.skills.proposed.map(s => s.skillId)).toEqual(["SK2-B"]);
  });

  it("the digest is deterministic and covers the canonical text", () => {
    const a = fresh("UASCO-0085"), b = fresh("UASCO-0085");
    expect(a).not.toBe(b);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toBe(ctx("UASCO-0085").digest);
    const base = input();
    // //TR: Girdi dizilerinin sırası (roller, loncalar, profiller, takma adlar) özeti değiştirmez.
    const shuffled: RoleContextInput = {...base, roles: [...base.roles].reverse().map(r => ({...r, legacyAliases: [...r.legacyAliases].reverse(), requiredTechnologies: [...r.requiredTechnologies].reverse()})), guilds: [...base.guilds].reverse(), profiles: [...base.profiles].reverse()};
    expect(ctx("UASCO-0085", shuffled).digest).toBe(a.digest);
    const edit = (over: (r: ContextRole) => Partial<ContextRole>): RoleContextInput => ({...base, roles: base.roles.map(r => (r.roleId === "UASCO-0085" ? {...r, ...over(r)} : r))});
    expect(ctx("UASCO-0085", edit(r => ({responsibilities: [`${r.responsibilities[0]} (edited)`, ...r.responsibilities.slice(1)]}))).digest).not.toBe(a.digest);
    expect(ctx("UASCO-0085", edit(r => ({forbiddenActions: [...r.forbiddenActions, "extra"]}))).digest).not.toBe(a.digest);
    expect(ctx("UASCO-0085", edit(r => ({specializationBoundaries: [...r.specializationBoundaries, "extra"]}))).digest).not.toBe(a.digest);
    expect(ctx("UASCO-0085", edit(() => ({title: "Another title"}))).digest).not.toBe(a.digest);
    expect(ctx("UASCO-0085", edit(r => ({gapIds: [...r.gapIds, "WFR-GAP-X"]}))).digest).not.toBe(a.digest);
    expect(ctx("UASCO-0001").digest).not.toBe(a.digest);
    // //TR: Bir rolü değiştirmek başka rolün özetini değiştirmez.
    expect(ctx("UASCO-0252", edit(() => ({title: "Another title"}))).digest).toBe(ctx("UASCO-0252").digest);
  });

  it("the 41 unresolved technology refs carry registryId null and NAME_NOT_VERIFIED_IN_REGISTRY", () => {
    const unresolved: Array<[string, string, string]> = [];
    for (const r of ALL_RESULTS) if (r.status === "RESOLVED") for (const t of r.context.technologies) if (t.registryId === null) unresolved.push([r.context.roleId, t.technologyId, t.status]);
    expect(unresolved).toHaveLength(41);
    expect([...new Set(unresolved.map(u => u[1]))].sort()).toEqual(["openxr", "postgis", "qgis", "schemathesis"]);
    expect(unresolved.every(u => u[2] === NAME_NOT_VERIFIED)).toBe(true);
    expect(NAME_NOT_VERIFIED).toBe("NAME_NOT_VERIFIED_IN_REGISTRY");
    // //TR: Bir referansın gizlenmediğinin bağımsız kanıtı: bağlamdaki (gerekli + isteğe bağlı) teknoloji sayısı kayıttakiyle birebir aynıdır.
    const raw = REG.roles.reduce((n, r) => n + r.requiredTechnologies.length + r.optionalTechnologies.length, 0);
    let seen = 0;
    for (const r of ALL_RESULTS) if (r.status === "RESOLVED") seen += r.context.technologies.length;
    expect(seen).toBe(raw);
    expect(raw).toBe(4236);
    // //TR: Kayıtta olmayan ad, rolün kendi durumu başka olsa bile NAME_NOT_VERIFIED_IN_REGISTRY olur; kayıtlı ad rolün KENDİ durumunu korur.
    const fx = ctx("UASCO-0001", fxInput({requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}, {technologyId: "ghost-tech", status: "CANDIDATE_NOT_VERIFIED"}], optionalTechnologies: [{technologyId: "ghost-opt", status: "CANDIDATE_NOT_VERIFIED"}]}));
    expect(fx.technologies.map(t => [t.technologyId, t.requirement, t.registryId, t.status])).toEqual([["ghost-tech", "REQUIRED", null, NAME_NOT_VERIFIED], ["tech-a", "REQUIRED", "TECH-A", "CANDIDATE_NOT_VERIFIED"], ["ghost-opt", "OPTIONAL", null, NAME_NOT_VERIFIED]]);
  });

  it("no verified or certified status is ever produced", () => {
    const statuses = new Set<string>(), registry = new Set<string>(), approvals = new Set<string>();
    for (const r of ALL_RESULTS) if (r.status === "RESOLVED") {
      expect(r.context.verifiedKnowledge).toBe(false);
      for (const t of r.context.technologies) { statuses.add(t.status); if (t.registryStatus) registry.add(t.registryStatus); }
      for (const a of r.context.aliases) if (a.approval) approvals.add(a.approval);
      expect(r.context.skills.proposed.every(s => s.status === "PROPOSED_DERIVED")).toBe(true);
    }
    expect([...statuses].sort()).toEqual(["CANDIDATE_NOT_VERIFIED", "NAME_NOT_VERIFIED_IN_REGISTRY"]);
    expect([...registry]).toEqual(["REGISTERED"]);
    expect([...approvals]).toEqual(["PROPOSED"]);
  });

  it("alias rules: only SEMANTIC_VERIFIED aliases propose skills, skills outside SK2 are dropped", () => {
    const c = ctx("UASCO-0001", fxInput({legacyAliases: [alias("001", "SEMANTIC_VERIFIED"), alias("002", "SUSPECTED"), alias("003", "CONFLICT"), alias("004", "REJECTED")]}));
    expect(c.skills.proposed).toEqual([{skillId: "SK2-A", status: "PROPOSED_DERIVED", viaLegacyIds: ["001"]}, {skillId: "SK2-B", status: "PROPOSED_DERIVED", viaLegacyIds: ["001"]}]);
    expect(c.aliases.map(a => [a.legacyId, a.status, a.usedForProposedSkills])).toEqual([["001", "SEMANTIC_VERIFIED", true], ["002", "SUSPECTED", false], ["003", "CONFLICT", false], ["004", "REJECTED", false]]);
    // //TR: İki SEMANTIC_VERIFIED takma ad: beceri birleşimi, her becerinin hangi eski kimliklerden geldiği (via) sıralı yazılır.
    const two = ctx("UASCO-0001", fxInput({legacyAliases: [alias("003", "SEMANTIC_VERIFIED"), alias("001", "SEMANTIC_VERIFIED")]}));
    expect(two.skills.proposed).toEqual([{skillId: "SK2-A", status: "PROPOSED_DERIVED", viaLegacyIds: ["001", "003"]}, {skillId: "SK2-B", status: "PROPOSED_DERIVED", viaLegacyIds: ["001"]}]);
    // //TR: Kanonik beceri kimliği SK2'de yoksa kanonik SAYILMAZ, canonicalNotInSk2'de açıkça görünür.
    const bad = ctx("UASCO-0001", fxInput({requiredSkillIds: ["SK2-A", "SK2-MISSING"]}));
    expect(bad.skills.canonical.map(s => s.skillId)).toEqual(["SK2-A"]);
    expect(bad.skills.canonicalNotInSk2).toEqual(["SK2-MISSING"]);
    expect(bad.skills.proposed).toEqual([]);
  });

  it("binding and review chain come from the code table and the profile, with profile gaps", () => {
    const bound = [...new Set(FIRST_DELIVERY_BINDINGS.map(b => b.roleId))];
    expect(bound).toHaveLength(9);
    for (const id of bound) expect(ctx(id).binding.resolverLabel, id).toBe("EXECUTABLE");
    expect(ctx("UASCO-0232").binding).toMatchObject({resolverLabel: "EXECUTABLE", providerRoute: "DETERMINISTIC_STUDIO", function: "delivery"});
    // //TR: Bağlaması olmayan rol NOT_EXECUTABLE etiketi taşır; etiket hazırlık EXECUTABLE katmanı DEĞİLDİR (not alanı).
    expect(ALL_RESULTS.filter(r => r.status === "RESOLVED" && r.context.binding.resolverLabel === "EXECUTABLE")).toHaveLength(9);
    // //TR: 599/599 rolde önerilen beceriler ve inceleme zinciri, kayıtlı profil verisiyle birebir aynıdır; profil boşluk kimlikleri bağlamın gapIds'inde bulunur.
    for (const p of PROFILES) {
      const c = ctx(p.roleId);
      expect(c.skills.proposed.map(s => s.skillId), p.roleId).toEqual(p.candidateSkills.value);
      expect(c.reviewChain?.value, p.roleId).toEqual(p.reviewChain.value);
      for (const g of [p.reviewChain.gapId, p.candidateSkills.gapId]) if (g) expect(c.gapIds, p.roleId).toContain(g);
      expect(c.gapIds, p.roleId).toEqual([...new Set(c.gapIds)].sort());
    }
    expect(ctx("UASCO-0001", fxInput()).reviewChain).toBeNull();
    // //TR: Çözülmüş ama kusurlu bağlama: kusur nedeni bağlama durumunda görünür.
    const defect = ctx("UASCO-0001", fxInput({}, {bindings: [{...FIRST_DELIVERY_BINDINGS[0], roleId: "UASCO-0001", adapters: []}]}));
    expect(defect.binding).toMatchObject({resolverLabel: "NOT_EXECUTABLE", reason: "ADAPTERS_MISSING"});
  });

  it("the byte cap shrinks lists in a fixed order, marks every cut and never cuts canonical text", () => {
    const heavy = ctx("UASCO-0085");
    expect(heavy.bytes).toBeGreaterThan(8_000);
    const optionalCount = heavy.technologies.filter(t => t.requirement === "OPTIONAL").length;
    expect(optionalCount).toBeGreaterThan(0);
    // //TR: Yarıya indirme: 72 -> 36 -> 18 ... ; kısaltma truncation'da (kept/total) kayıtlıdır, bayt sınırı aşılmaz, kanonik metin ve gerekli teknolojiler bütündür.
    const mid = ctx("UASCO-0085", input(), {maxBytes: 8_000});
    expect(mid.bytes).toBeLessThanOrEqual(8_000);
    expect(mid.truncation[0]).toMatchObject({field: "skills.proposed", total: 72});
    expect(mid.skills.proposed.length).toBe(mid.truncation[0].kept);
    // //TR: Yarıya indirme KADEMELİDİR (tek seferde sıfırlama değil): 8 000 baytta bir kısmı korunur; tam sığan sınırda aynı kesme, bir bayt eksiğinde bir sonraki yarılama (kept en çok yarısı) görülür.
    const kept = mid.truncation[0].kept;
    expect([36, 18, 9, 4, 2, 1]).toContain(kept);
    expect(ctx("UASCO-0085", input(), {maxBytes: mid.bytes}).truncation[0].kept).toBe(kept);
    expect(ctx("UASCO-0085", input(), {maxBytes: mid.bytes - 1}).truncation[0].kept).toBe(Math.floor(kept / 2));
    expect(mid.technologies.filter(t => t.requirement === "OPTIONAL")).toHaveLength(optionalCount);
    expect(mid.canonical).toEqual(heavy.canonical);
    expect(mid.technologies.filter(t => t.requirement === "REQUIRED")).toEqual(heavy.technologies.filter(t => t.requirement === "REQUIRED"));
    expect(mid.digest).not.toBe(heavy.digest);
    expect(mid.skills.proposed.map(s => s.skillId)).toEqual(heavy.skills.proposed.slice(0, mid.skills.proposed.length).map(s => s.skillId));
    // //TR: Daha küçük sınır: önce tüm önerilen beceriler, sonra isteğe bağlı teknolojiler, sonra takma adlar kısaltılır; en küçük sığan sınırda hepsi sıfırdır.
    const tiny = ctx("UASCO-0085", input(), {maxBytes: heavy.bytes - heavy.skills.proposed.reduce((n, s) => n + JSON.stringify(s).length, 0) + 10});
    expect(tiny.skills.proposed).toHaveLength(0);
    expect(tiny.truncation.map(t => t.field)[0]).toBe("skills.proposed");
    // //TR: En küçük sığan sınır (ikili arama): orada tüm kısaltılabilir listeler sıfırlanmıştır; bir bayt eksiği tipli ret verir. Kanonik metin ve gerekli teknolojiler yine bütündür.
    const fits = (n: number) => resolveRoleContext(input(), "UASCO-0085", {maxBytes: n}).status === "RESOLVED";
    let lo = 100, hi = heavy.bytes;
    while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (fits(m)) hi = m; else lo = m + 1; }
    const floor = ctx("UASCO-0085", input(), {maxBytes: lo});
    expect(fits(lo - 1)).toBe(false);
    expect(floor.bytes).toBeLessThanOrEqual(lo);
    expect(floor.truncation.map(t => t.field)).toEqual(["skills.proposed", "technologies.optional", "aliases"]);
    expect(floor.truncation.every(t => t.kept === 0)).toBe(true);
    expect(floor.skills.proposed).toEqual([]);
    expect(floor.technologies.every(t => t.requirement === "REQUIRED")).toBe(true);
    expect(floor.aliases).toEqual([]);
    expect(floor.canonical).toEqual(heavy.canonical);
    // //TR: Kanonik metin sığmıyorsa tipli ret (sessiz kırpma yok).
    expect(resolveRoleContext(input(), "UASCO-0085", {maxBytes: 100})).toEqual({status: "NOT_RESOLVED", roleId: "UASCO-0085", reason: "ROLE_CONTEXT_EXCEEDS_BYTE_CAP"});
    // //TR: Bayt sınırı UTF-8 BAYTIDIR (karakter sayısı değil): çok baytlı metinde bytes, serileştirilmiş bağlamın bayt uzunluğuna eşittir ve karakter sayısından büyüktür.
    const multi = ctx("UASCO-0001", fxInput({responsibilities: ["çalışma ğüşiöç ✓ 日本語"]}));
    const {bytes: _b, digest: _d, ...rest} = multi;
    // //TR: L3 (değişen sabitleme): bytes artık SON serileştirilmiş biçimin (bytes ve digest alanları dahil) UTF-8 bayt uzunluğudur; gövde baytı + `,"bytes":<n>,"digest":"<64>"` ek yükü (85 + hane sayısı) kadar büyüktür. Önceki sabitleme yalnız gövdeyi ölçüyordu ve sınır ~90 bayt aşılabiliyordu.
    expect(multi.bytes).toBe(Buffer.byteLength(JSON.stringify(multi), "utf8"));
    expect(multi.bytes).toBe(Buffer.byteLength(JSON.stringify(rest), "utf8") + 85 + String(multi.bytes).length);
    expect(multi.bytes).toBeGreaterThan(JSON.stringify(multi).length);
    // //TR: Sığan bağlam kısaltılmaz; varsayılan sınır 599/599'u kısaltmadan karşılar (T1).
    expect(ctx("UASCO-0424").truncation).toEqual([]);
  });

  it("technology labels follow the registry rows exactly; unresolved references carry null labels; no upgrade token exists anywhere", () => {
    const rows = new Map((readJson("registries/technologies.json").technologies as Array<{id: string; slug: string; status: string; knowledgeState: string}>).map(t => [t.slug, t] as const));
    const rawById = new Map(REG.roles.map(r => [r.roleId as string, r]));
    let refs = 0, unresolved = 0;
    for (const c of ALL) {
      const raw = rawById.get(c.roleId)!;
      const own = new Map<string, string>([...raw.requiredTechnologies.map((t: any) => [`REQUIRED:${t.technologyId}`, t.status] as const), ...raw.optionalTechnologies.map((t: any) => [`OPTIONAL:${t.technologyId}`, t.status] as const)]);
      for (const t of c.technologies) {
        refs++;
        const row = rows.get(t.technologyId);
        if (row === undefined) {
          unresolved++;
          expect([t.registryId, t.registryStatus, t.knowledgeState, t.status], `${c.roleId} ${t.technologyId}`).toEqual([null, null, null, NAME_NOT_VERIFIED]);
        } else {
          // //TR: Çözülen her başvuruda (4195) kayıt kimliği, kayıt durumu ve bilgi durumu technologies.json satırıyla birebir aynıdır; rolün KENDİ durumu korunur (yükseltilmez).
          expect([t.registryId, t.registryStatus, t.knowledgeState], `${c.roleId} ${t.technologyId}`).toEqual([row.id, row.status, row.knowledgeState]);
          expect(t.status, `${c.roleId} ${t.technologyId}`).toBe(own.get(`${t.requirement}:${t.technologyId}`));
        }
      }
    }
    expect([refs, unresolved]).toEqual([4236, 41]);
    // //TR: Bağlamdaki HER dize değerinin büyük harfli sözcüğü (kimlikler, öncelik kodları P0-P2 (ayrıca pinlidir) ve serbest metin hariç) bilinen durum sözlüğünde olmalıdır; VERIFIED/CERTIFIED gibi bir yükseltme jetonu ya da sözlük dışı herhangi bir jeton testi bozar.
    const FREE = new Set(["title", "responsibilities", "forbiddenActions", "specializationBoundaries", "legacyTitle", "guildName"]);
    const upperTokens = (root: unknown): Set<string> => {
      const found = new Set<string>();
      const walk = (v: unknown, key: string): void => {
        if (typeof v === "string") { if (!FREE.has(key) && /^[A-Z][A-Z0-9_]*$/.test(v) && !/^[A-Z]{1,3}\d+$/.test(v)) found.add(v); return; }
        if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
        if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
      };
      walk(root, "");
      return found;
    };
    const found = upperTokens(ALL);
    const VOCABULARY = ["BACKLOG", "CANDIDATE_NOT_VERIFIED", "CANONICAL_ROLE_REGISTRY", "CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER", "CODE_BINDING_TABLE", "CONFLICT", "DETERMINISTIC_STUDIO", "EXECUTABLE", "LEGACY_REFERENCE", "NAME_NOT_VERIFIED_IN_REGISTRY", "NOT_EXECUTABLE", "OPTIONAL", "PROPOSED", "PROPOSED_DERIVED", "REGISTERED", "REJECTED", "REQUIRED", "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER", "ROLE_HAS_NO_BINDING", "SEED_PROFILE", "SEMANTIC_VERIFIED", "SUSPECTED", "TARGET"];
    expect([...found].sort(), "a status token outside the known vocabulary appeared in a context").toEqual(VOCABULARY);
    for (const upgrade of ["VERIFIED", "CERTIFIED", "INTERNALLY_CERTIFIED", "PROMOTED", "APPROVED", "READY", "TESTED", "IMPLEMENTED"]) expect(found.has(upgrade), upgrade).toBe(false);
    // //TR: Süpürme sahte bir yükseltmeyi gerçekten yakalar: VERIFIED jetonu bulunur ve sözlük dışıdır.
    const forged = {...ALL[0], technologies: [{...ALL[0].technologies[0], knowledgeState: "VERIFIED"}]};
    expect(upperTokens(forged).has("VERIFIED")).toBe(true);
    expect(VOCABULARY.includes("VERIFIED")).toBe(false);
  });

  it("proposed skills are re-derived from aliases and the legacy matrix, never copied from the profile file", () => {
    // //TR: 599/599 parite (gerçek veri): türetme ile profil dosyası aynıdır; parite denetimi bunu bildirir.
    expect(input().profiles).toHaveLength(599);
    expect(() => assertCandidateSkillsParity(input(), ALL)).not.toThrow();
    // //TR: Fixture: profil dosyasının candidateSkills'i takma ad + eski matrisin türettiğinden KASTEN farklıdır. Bağlam türetmeyi izler (profili değil) ve parite denetimi yüksek sesle başarısız olur.
    const profile = (skills: string[]): ContextProfileLike => ({roleId: "UASCO-0001", reviewChain: {value: ["UASCO-0002"], gapId: null, status: "PROPOSED_DERIVED"}, candidateSkills: {value: skills, gapId: null}});
    const aliases = [alias("001", "SEMANTIC_VERIFIED")];
    const diverged = fxInput({legacyAliases: aliases}, {profiles: [profile(["SK2-C"])]});
    const c = fresh("UASCO-0001", diverged);
    expect(c.skills.proposed.map(x => x.skillId)).toEqual(["SK2-A", "SK2-B"]);
    expect(() => assertCandidateSkillsParity(diverged, [c])).toThrow("PROFILE_PARITY_MISMATCH:UASCO-0001:CANDIDATE_SKILLS");
    // //TR: Profil boşken de türetme geçerlidir; profil türetmeyle aynıysa parite geçer; bağlamsız profil de bildirilir.
    expect(fresh("UASCO-0001", fxInput({legacyAliases: aliases}, {profiles: [profile([])]})).skills.proposed.map(x => x.skillId)).toEqual(["SK2-A", "SK2-B"]);
    const agreed = fxInput({legacyAliases: aliases}, {profiles: [profile(["SK2-A", "SK2-B"])]});
    expect(() => assertCandidateSkillsParity(agreed, [fresh("UASCO-0001", agreed)])).not.toThrow();
    expect(() => assertCandidateSkillsParity(agreed, [])).toThrow("PROFILE_PARITY_MISMATCH:UASCO-0001:NO_CONTEXT");
    // //TR: Profilde olup türetmede olmayan beceri (profil kirlenirse) bağlama GİRMEZ.
    const extra = fxInput({legacyAliases: aliases}, {profiles: [profile(["SK2-A", "SK2-B", "SK2-C"])]});
    expect(fresh("UASCO-0001", extra).skills.proposed.map(x => x.skillId)).toEqual(["SK2-A", "SK2-B"]);
    expect(() => assertCandidateSkillsParity(extra, [fresh("UASCO-0001", extra)])).toThrow("PROFILE_PARITY_MISMATCH:UASCO-0001:CANDIDATE_SKILLS");
  });

  it("provenance labels: canonical skill origin, binding origin, review chain origin and gap come from their sources", () => {
    const rich = fresh("UASCO-0001", richInput());
    expect(rich.skills.canonical).toEqual([{skillId: "SK2-A", origin: "CANONICAL_ROLE_REGISTRY"}]);
    expect(rich.skills.canonicalNotInSk2).toEqual(["SK2-MISSING"]);
    expect(rich.skills.proposedOrigin).toBe("PROPOSED_DERIVED");
    expect(rich.binding).toEqual({origin: "CODE_BINDING_TABLE", resolverLabel: "EXECUTABLE", reason: null, function: "developer", providerRoute: "CLAUDE_IMPLEMENTER", adapters: ["local-claude-implementer", "workos-runner"], note: "RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER"});
    expect(rich.reviewChain).toEqual({origin: "PROPOSED_DERIVED", value: ["UASCO-0002"], gapId: "WFR-GAP-REVIEW-UASCO-0001"});
    expect(rich.gapIds).toEqual(["WFR-GAP-CAND-UASCO-0001", "WFR-GAP-REVIEW-UASCO-0001", "WFR-GAP-SKILLS-UASCO-0001", "WFR-GAP-TECH-UASCO-0001"]);
    expect(rich.aliases.every(a => a.origin === "LEGACY_REFERENCE" && a.approval === "PROPOSED")).toBe(true);
    // //TR: İnceleme zinciri etiketi profilin KENDİ durumundan gelir (çözümleyicide sabit değildir).
    const other = {...richProfile(), reviewChain: {...richProfile().reviewChain, status: "SOME_OTHER_STATUS"}};
    expect(fresh("UASCO-0001", richInput({}, {profiles: [other]})).reviewChain?.origin).toBe("SOME_OTHER_STATUS");
    expect(fresh("UASCO-0001", richInput({}, {profiles: [{...other, reviewChain: {...other.reviewChain, gapId: null}}]})).reviewChain).toEqual({origin: "SOME_OTHER_STATUS", value: ["UASCO-0002"], gapId: null});
    // //TR: 599/599 rolde bağlama kaynağı, takma ad kaynağı ve inceleme zinciri (kaynak + boşluk) profil/kod tablosuyla aynıdır.
    for (const c of ALL) {
      expect(c.binding.origin, c.roleId).toBe("CODE_BINDING_TABLE");
      expect(c.binding.note, c.roleId).toBe("RESOLVER_LABEL_NOT_THE_READINESS_EXECUTABLE_LAYER");
      expect(c.aliases.every(a => a.origin === "LEGACY_REFERENCE"), c.roleId).toBe(true);
      expect(c.skills.proposedOrigin, c.roleId).toBe("PROPOSED_DERIVED");
    }
    for (const p of PROFILES) {
      const c = ALL_BY_ID.get(p.roleId)!;
      expect(c.reviewChain, p.roleId).toEqual({origin: p.reviewChain.status, value: p.reviewChain.value, gapId: p.reviewChain.gapId});
    }
    expect(ALL_BY_ID.get("UASCO-0424")!.binding).toMatchObject({origin: "CODE_BINDING_TABLE", resolverLabel: "NOT_EXECUTABLE"});
  });

  it("the byte cap keeps every protected field intact at every truncation stage and records every cut", () => {
    // //TR: Sentetik zengin rol: 12 önerilen beceri, 41 isteğe bağlı teknoloji, 9 takma ad; zincir 5 + 6 + 4 durumdan oluşur ve her durumda HER korumalı alan sınırsız bağlamla aynıdır.
    const rich = checkChain(richInput(), "UASCO-0001");
    expect([rich.P, rich.O, rich.A]).toEqual([12, 41, 9]);
    expect(rich.states).toHaveLength(halves(12).length + halves(41).length - 1 + halves(9).length - 1);
    const floor = rich.states[rich.states.length - 1];
    expect(floor.truncation).toEqual([{field: "skills.proposed", kept: 0, total: 12}, {field: "technologies.optional", kept: 0, total: 41}, {field: "aliases", kept: 0, total: 9}]);
    expect(floor.technologies.map(t => t.technologyId)).toEqual(["tech-a", "tech-b"]);
    expect(floor.skills.canonical).toEqual(rich.full.skills.canonical);
    expect(floor.reviewChain).toEqual(rich.full.reviewChain);
    expect(floor.binding).toEqual(rich.full.binding);
    expect(floor.gapIds).toEqual(rich.full.gapIds);
    // //TR: Gerçek roller: en ağır rol (0085: 72 önerilen beceri) ve en büyük bağlam (0043) aynı zincirden geçer.
    const heavy = checkChain(input(), "UASCO-0085");
    expect(heavy.P).toBe(72);
    expect(heavy.O).toBeGreaterThan(0);
    expect(heavy.A).toBe(2);
    const biggest = checkChain(input(), "UASCO-0043");
    expect(biggest.full.bytes).toBe(17_522);
    expect(biggest.states.length).toBeGreaterThan(1);
  });

  it("the default 24 576-byte cap is enforced; invalid caps are rejected; bytes measure the final serialized form", () => {
    expect(ROLE_CONTEXT_DEFAULT_MAX_BYTES).toBe(24_576);
    // //TR: Gerçek roller varsayılan sınırın altındadır (en büyük 17 522 bayt); sentetik rol (260 isteğe bağlı teknoloji) sınırsız hâlde sınırı aşar ve VARSAYILAN seçeneklerle kısaltılır.
    expect(Math.max(...ALL.map(c => c.bytes))).toBeLessThan(ROLE_CONTEXT_DEFAULT_MAX_BYTES);
    const many = Array.from({length: 260}, (_, k) => `many-${String(k).padStart(3, "0")}`);
    const hugeInput = richInput({optionalTechnologies: many.map(technologyId => ({technologyId, status: "CANDIDATE_NOT_VERIFIED"}))}, {technologies: new Map([["tech-a", techRow("tech-a")], ["tech-b", techRow("tech-b")], ...many.map(slug => [slug, techRow(slug)] as const)])});
    const uncapped = fresh("UASCO-0001", hugeInput, {maxBytes: 10_000_000});
    expect(uncapped.bytes).toBeGreaterThan(ROLE_CONTEXT_DEFAULT_MAX_BYTES);
    expect(uncapped.truncation).toEqual([]);
    const capped = fresh("UASCO-0001", hugeInput);
    expect(capped.bytes).toBeLessThanOrEqual(ROLE_CONTEXT_DEFAULT_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(capped), "utf8")).toBe(capped.bytes);
    expect(capped.truncation.map(t => t.field)).toEqual(["skills.proposed", "technologies.optional"]);
    expect(capped.truncation[1]).toMatchObject({field: "technologies.optional", total: 260});
    expect(capped.truncation[1].kept).toBeLessThan(260);
    expect(fresh("UASCO-0001", hugeInput, {maxBytes: ROLE_CONTEXT_DEFAULT_MAX_BYTES}).digest).toBe(capped.digest);
    expect(fresh("UASCO-0001", hugeInput, {maxBytes: 20_000}).bytes).toBeLessThanOrEqual(20_000);
    // //TR: Geçersiz maxBytes (NaN, sonsuz, sıfır, negatif, sayı olmayan) sınırı sessizce kapatacağından tipli hatayla reddedilir; rol aranmadan ve boş girdide de.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, -8_000]) {
      const code = `ROLE_CONTEXT_INPUT_INVALID:MAX_BYTES:${String(bad)}`;
      expect(() => resolveRoleContext(input(), "UASCO-0085", {maxBytes: bad}), String(bad)).toThrow(code);
      expect(() => resolveRoleContext(input(), "UASCO-9999", {maxBytes: bad}), `unknown role ${String(bad)}`).toThrow(code);
      expect(() => resolveAllRoleContexts(input(), {maxBytes: bad}), `all ${String(bad)}`).toThrow(code);
      expect(() => resolveAllRoleContexts(fxInput({}, {roles: []}), {maxBytes: bad}), `all empty ${String(bad)}`).toThrow(code);
    }
    expect(() => resolveRoleContext(input(), "UASCO-0085", {maxBytes: "8000" as unknown as number})).toThrow("ROLE_CONTEXT_INPUT_INVALID:MAX_BYTES:8000");
    expect(fresh("UASCO-0085", input(), {maxBytes: 8_000.5}).bytes).toBeLessThanOrEqual(8_000.5);
    expect(fresh("UASCO-0085", input(), {maxBytes: 100_000}).truncation).toEqual([]);
    // //TR: bytes SON serileştirilmiş biçimdir: tam sığan sınırda aynı bağlam, bir bayt eksiğinde daha küçük bir bağlam (ya da ret) gelir; sınır bytes/digest alanlarını da kapsar.
    const small = fresh("UASCO-0001", richInput());
    expect(small.bytes).toBe(Buffer.byteLength(JSON.stringify(small), "utf8"));
    expect(fresh("UASCO-0001", richInput(), {maxBytes: small.bytes}).digest).toBe(small.digest);
    const tighter = fresh("UASCO-0001", richInput(), {maxBytes: small.bytes - 1});
    expect(tighter.bytes).toBeLessThanOrEqual(small.bytes - 1);
    expect(tighter.truncation.length).toBeGreaterThan(0);
  });

  it("the digest covers every field of the context", () => {
    const base = richInput();
    const baseCtx = fresh("UASCO-0001", base);
    const profile = base.profiles[0];
    const withProfile = (over: (p: ContextProfileLike) => ContextProfileLike): RoleContextInput => ({...base, profiles: [over(profile)]});
    const withTech = (slug: string, over: Record<string, string>): RoleContextInput => ({...base, technologies: new Map(base.technologies).set(slug, {...base.technologies.get(slug)!, ...over})});
    const aliasOf = (legacyId: string, over: Record<string, string>): RoleContextInput => richInput({legacyAliases: base.roles[0].legacyAliases.map(a => (a.legacyId === legacyId ? {...a, ...over} : a))});
    const edits: Record<string, RoleContextInput> = {
      title: richInput({title: "Other title"}), guildId: richInput({guildId: "G99"}), clusterId: richInput({clusterId: "CL99"}), priority: richInput({priority: "P9"}), lifecycle: richInput({lifecycle: "OTHER"}),
      responsibilities: richInput({responsibilities: ["R1", "R2", "R3"]}), forbiddenActions: richInput({forbiddenActions: ["F1", "F2"]}), specializationBoundaries: richInput({specializationBoundaries: ["B1", "B2"]}),
      guildName: {...base, guilds: [{...base.guilds[0], name: "Other guild"}]},
      canonicalSkill: richInput({requiredSkillIds: ["SK2-A", "SK2-B", "SK2-MISSING"]}), canonicalNotInSk2: richInput({requiredSkillIds: ["SK2-A", "SK2-MISSING", "SK2-MISSING-2"]}),
      requiredTechStatus: richInput({requiredTechnologies: [{technologyId: "tech-b", status: "OTHER_STATUS"}, {technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}]}),
      optionalTechDropped: richInput({optionalTechnologies: base.roles[0].optionalTechnologies.slice(1)}),
      registryId: withTech("tech-a", {id: "TECH-OTHER"}), registryStatus: withTech("tech-a", {status: "OTHER_STATUS"}), knowledgeState: withTech("tech-a", {knowledgeState: "OTHER_STATE"}),
      optionalRegistryStatus: withTech("opt-05", {status: "OTHER_STATUS"}),
      aliasTitle: aliasOf("104", {legacyTitle: "Other"}), aliasApproval: aliasOf("104", {approval: "OTHER"}), aliasStatus: aliasOf("103", {status: "SUSPECTED"}),
      skillIdsRemoved: {...base, skillIds: new Set([...base.skillIds].filter(x => x !== "SK2-A"))},
      legacySkills: {...base, legacySkills: new Map(base.legacySkills).set("102", PSK.slice(4, 8))},
      gapIds: richInput({gapIds: ["WFR-GAP-SKILLS-UASCO-0001"]}),
      reviewChainValue: withProfile(p => ({...p, reviewChain: {...p.reviewChain, value: ["UASCO-0003"]}})), reviewChainGap: withProfile(p => ({...p, reviewChain: {...p.reviewChain, gapId: "WFR-GAP-OTHER"}})),
      reviewChainStatus: withProfile(p => ({...p, reviewChain: {...p.reviewChain, status: "OTHER_STATUS"}})), candidateGap: withProfile(p => ({...p, candidateSkills: {...p.candidateSkills, gapId: "WFR-GAP-OTHER"}})),
      noProfile: {...base, profiles: []},
      bindingFunction: {...base, bindings: [{...base.bindings[0], function: "other-function" as never}]}, bindingRoute: {...base, bindings: [{...base.bindings[0], providerRoute: "CLAUDE_REVIEWER" as never}]},
      bindingAdapters: {...base, bindings: [{...base.bindings[0], adapters: ["workos-runner"]}]}, noBinding: {...base, bindings: []}
    };
    for (const [name, i] of Object.entries(edits)) expect(fresh("UASCO-0001", i).digest, `edit ${name}`).not.toBe(baseCtx.digest);
    // //TR: truncation alanı da özette: aynı girdi, daha küçük sınır -> kısaltma kaydı -> farklı özet.
    expect(fresh("UASCO-0001", base, {maxBytes: baseCtx.bytes - 1}).digest).not.toBe(baseCtx.digest);
    // //TR: Şartname: özet, bytes ve digest DIŞINDAKİ her alanın (schemaVersion, roleId, verifiedKnowledge dahil) kararlı JSON'unun sha256'sıdır; 599/599 rolde ve sentetik rolde.
    for (const c of [...ALL, baseCtx]) expect(c.digest, c.roleId).toBe(sha(canon(strip(c))));
    expect(Object.keys(strip(baseCtx)).sort()).toEqual(["aliases", "binding", "canonical", "gapIds", "reviewChain", "roleId", "schemaVersion", "skills", "technologies", "truncation", "verifiedKnowledge"]);
  });

  it("contract details: code-point ordering, duplicates kept, null defaults, case sensitivity, copies and option forwarding", () => {
    expect(ROLE_CONTEXT_SCHEMA_VERSION).toBe("1.0.0");
    expect(ALL.every(c => c.schemaVersion === "1.0.0")).toBe(true);
    // //TR: Sıralama kod noktasına göredir (yerel ayara göre DEĞİL); kanonik beceri kimlikleri sıralı ve tekilleştirilmiş; tekrarlı gerekli/isteğe bağlı başvurular ve tekrarlı metinler GİZLENMEZ; eksik alanlar null olur (uydurma varsayılan yok).
    const techs = new Map(["B-req", "a-req", "B-opt", "a-opt", "dup-t"].map(slug => [slug, techRow(slug)] as const));
    const odd = fresh("UASCO-0001", fxInput({
      priority: undefined, lifecycle: undefined, guildId: "G99", requiredSkillIds: ["SK2-B", "SK2-A", "SK2-B"],
      responsibilities: ["R1", "R1"], forbiddenActions: ["F1", "F1"],
      requiredTechnologies: [{technologyId: "a-req", status: "S"}, {technologyId: "dup-t", status: "S"}, {technologyId: "B-req", status: "S"}, {technologyId: "dup-t", status: "S"}],
      optionalTechnologies: [{technologyId: "dup-t", status: "S"}, {technologyId: "a-opt", status: "S"}, {technologyId: "B-opt", status: "S"}],
      legacyAliases: [{legacyId: "b1", status: "SUSPECTED"}, {legacyId: "a1", status: "SUSPECTED"}, {legacyId: "B1", status: "SUSPECTED"}]
    }, {technologies: techs}));
    expect(odd.technologies.map(t => `${t.requirement}:${t.technologyId}`)).toEqual(["REQUIRED:B-req", "REQUIRED:a-req", "REQUIRED:dup-t", "REQUIRED:dup-t", "OPTIONAL:B-opt", "OPTIONAL:a-opt", "OPTIONAL:dup-t"]);
    expect(odd.aliases.map(a => a.legacyId)).toEqual(["B1", "a1", "b1"]);
    expect(odd.aliases.every(a => a.legacyTitle === null && a.approval === null && a.usedForProposedSkills === false)).toBe(true);
    expect(odd.skills.canonical.map(x => x.skillId)).toEqual(["SK2-A", "SK2-B"]);
    expect([odd.canonical.priority, odd.canonical.lifecycle, odd.canonical.guildName]).toEqual([null, null, null]);
    expect([odd.canonical.responsibilities, odd.canonical.forbiddenActions]).toEqual([["R1", "R1"], ["F1", "F1"]]);
    // //TR: Büyük/küçük harf ve boşluk duyarlılığı: rol kimliği, teknoloji adı ve takma ad durumu tam eşleşir (yükseltme yolu yok).
    for (const bad of ["uasco-0085", " UASCO-0085", "UASCO-0085 "]) expect(resolveRoleContext(input(), bad), JSON.stringify(bad)).toMatchObject({status: "NOT_RESOLVED", reason: "ROLE_NOT_IN_CATALOG"});
    const cased = fresh("UASCO-0001", fxInput({requiredTechnologies: [{technologyId: "TECH-A", status: "S"}], legacyAliases: [alias("001", "semantic_verified")]}));
    expect(cased.technologies[0]).toMatchObject({registryId: null, status: NAME_NOT_VERIFIED, registryStatus: null, knowledgeState: null});
    expect(cased.skills.proposed).toEqual([]);
    expect(cased.aliases[0].usedForProposedSkills).toBe(false);
    // //TR: Matriste satırı olmayan SEMANTIC_VERIFIED takma ad hata fırlatmaz ve beceri üretmez; boş inceleme zinciri yine bir zincirdir (boşluk kimliğiyle); dize olmayan boşluk kimlikleri bağlama sızmaz.
    const noRow = fresh("UASCO-0001", fxInput({legacyAliases: [alias("999", "SEMANTIC_VERIFIED")]}));
    expect(noRow.skills.proposed).toEqual([]);
    const emptyChain = fresh("UASCO-0001", fxInput({gapIds: []}, {profiles: [{roleId: "UASCO-0001", reviewChain: {value: [], gapId: undefined as unknown as null, status: "PROPOSED_DERIVED"}, candidateSkills: {value: [], gapId: null}}]}));
    expect(emptyChain.reviewChain).toEqual({origin: "PROPOSED_DERIVED", value: [], gapId: undefined});
    expect(emptyChain.gapIds).toEqual([]);
    // //TR: Çıktı girdinin kopyasıdır: dondurulmuş girdi çözülür, girdi değişmez, çıktı dizileri girdi dizileriyle aynı nesne değildir ve dondurulmuş değildir.
    const frozen = deepFreeze(structuredClone(richInput()));
    const before = JSON.stringify([...Object.entries(frozen)].map(([k, v]) => [k, v instanceof Map ? [...v] : v instanceof Set ? [...v] : v]));
    const copy = fresh("UASCO-0001", frozen);
    expect(JSON.stringify([...Object.entries(frozen)].map(([k, v]) => [k, v instanceof Map ? [...v] : v instanceof Set ? [...v] : v]))).toBe(before);
    expect(copy.canonical.responsibilities).not.toBe(frozen.roles[0].responsibilities);
    expect(copy.canonical.forbiddenActions).not.toBe(frozen.roles[0].forbiddenActions);
    expect(copy.canonical.specializationBoundaries).not.toBe(frozen.roles[0].specializationBoundaries);
    expect(copy.reviewChain!.value).not.toBe(frozen.profiles[0].reviewChain.value);
    expect(copy.binding.adapters).not.toBe(frozen.bindings[0].adapters);
    for (const arr of [copy.canonical.responsibilities, copy.canonical.forbiddenActions, copy.canonical.specializationBoundaries, copy.reviewChain!.value, copy.binding.adapters]) expect(Object.isFrozen(arr)).toBe(false);
    // //TR: resolveAll rol kimliklerini sıralar ve tekilleştirir (yinelenen kimlik tek tipli ret), geçerli seçenekleri her role iletir; kesirli maxBytes yuvarlanmaz, 1'in altı tipli retle sonuçlanır (hata değil).
    const dupInput = fxInput({}, {roles: [fxRole({roleId: "UASCO-0002", title: "Two"}), fxRole(), fxRole({title: "Second"})]});
    expect(resolveAllRoleContexts(dupInput).map(r => (r.status === "RESOLVED" ? r.context.roleId : `${r.roleId}:${r.reason}`))).toEqual(["UASCO-0001:ROLE_ID_DUPLICATE", "UASCO-0002"]);
    const small = fresh("UASCO-0001", richInput());
    const batch = resolveAllRoleContexts(richInput(), {maxBytes: small.bytes - 1});
    expect(batch).toHaveLength(1);
    expect(batch[0].status === "RESOLVED" && batch[0].context.truncation.length > 0).toBe(true);
    expect(resolveRoleContext(input(), "UASCO-0085", {maxBytes: 0.5})).toEqual({status: "NOT_RESOLVED", roleId: "UASCO-0085", reason: "ROLE_CONTEXT_EXCEEDS_BYTE_CAP"});
    const half = fresh("UASCO-0001", richInput(), {maxBytes: small.bytes - 0.5});
    expect(half.truncation.length).toBeGreaterThan(0);
    expect(half.bytes).toBeLessThanOrEqual(small.bytes - 0.5);
  });

  it("registry labels follow each row exactly: a second REQUIRED row and OPTIONAL rows with their own id, status and knowledgeState; optional order is slug order", () => {
    // //TR: Satırlar KASTEN farklıdır (STALE bilgi durumu, standart olmayan kimlik, farklı kayıt durumu): bağlam her başvuruda KENDİ satırını izler; sabit "SEED_PROFILE"/tahmini TECH-<SLUG> kimliği/yalnız ilk başvuruyu izleyen kod bu değerleri tutturamaz.
    const rows = new Map<string, {id: string; status: string; knowledgeState: string}>([
      ["tech-a", {id: "TECH-A", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}],
      ["tech-b", {id: "ID-B-ODD", status: "DEPRECATED", knowledgeState: "STALE"}],
      ["tech-c", {id: "TECH-C", status: "REGISTERED", knowledgeState: "REVIEW_PENDING"}],
      ["opt-x", {id: "OPT-X-ODD", status: "REGISTERED", knowledgeState: "STALE-OPT"}],
      ["opt-y", {id: "TECH-OPT-Y", status: "BETA", knowledgeState: "SEED_PROFILE"}]
    ]);
    const ref = (technologyId: string) => ({technologyId, status: "CANDIDATE_NOT_VERIFIED"});
    const c = fresh("UASCO-0001", fxInput({requiredTechnologies: [ref("tech-c"), ref("tech-b"), ref("tech-a")], optionalTechnologies: [ref("opt-y"), ref("ghost-opt"), ref("opt-x")]}, {technologies: rows}));
    const label = (technologyId: string, requirement: "REQUIRED" | "OPTIONAL") => { const r = rows.get(technologyId); return {technologyId, requirement, registryId: r?.id ?? null, status: r ? "CANDIDATE_NOT_VERIFIED" : NAME_NOT_VERIFIED, registryStatus: r?.status ?? null, knowledgeState: r?.knowledgeState ?? null}; };
    expect(c.technologies).toEqual([label("tech-a", "REQUIRED"), label("tech-b", "REQUIRED"), label("tech-c", "REQUIRED"), label("ghost-opt", "OPTIONAL"), label("opt-x", "OPTIONAL"), label("opt-y", "OPTIONAL")]);
    expect(c.technologies.map(t => t.knowledgeState)).toEqual(["SEED_PROFILE", "STALE", "REVIEW_PENDING", null, "STALE-OPT", "SEED_PROFILE"]);
    expect(c.technologies.map(t => t.registryId)).toEqual(["TECH-A", "ID-B-ODD", "TECH-C", null, "OPT-X-ODD", "TECH-OPT-Y"]);
    // //TR: Sıralama slug sırasıdır ve kayıtsız ad (ghost-opt) yerinde kalır, sona itilmez: yarılama onu İLK kesmez. Zengin fixture'ın tam sırası sabit bir listedir; kısaltılmış her durumda ghost-opt ilk isteğe bağlıdır.
    const rich = checkChain(richInput(), "UASCO-0001");
    expect(rich.full.technologies.map(t => t.technologyId)).toEqual(["tech-a", "tech-b", "ghost-opt", ...OPT_SLUGS]);
    rich.states.forEach((st, k) => {
      const opt = st.technologies.filter(t => t.requirement === "OPTIONAL");
      if (opt.length > 0) expect(opt[0], `state ${k}`).toMatchObject({technologyId: "ghost-opt", registryId: null, status: NAME_NOT_VERIFIED});
    });
    const half = rich.states.find(st => st.skills.proposed.length === 0 && st.technologies.filter(t => t.requirement === "OPTIONAL").length === 20 && st.aliases.length === 9)!;
    expect(half.technologies.filter(t => t.requirement === "OPTIONAL").map(t => t.technologyId)).toEqual(["ghost-opt", ...OPT_SLUGS.slice(0, 19)]);
    // //TR: Gerçek roller: UASCO-0480/0484 isteğe bağlı [openxr (kayıtsız), ros2]; tek öğe kaldığında kalan openxr'dir (uyarı görünür bağlamdan kaybolmaz).
    for (const id of ["UASCO-0480", "UASCO-0484"]) {
      expect(ALL_BY_ID.get(id)!.technologies.filter(t => t.requirement === "OPTIONAL").map(t => t.technologyId), id).toEqual(["openxr", "ros2"]);
      const walk = checkChain(input(), id);
      const one = walk.states.find(st => st.technologies.filter(t => t.requirement === "OPTIONAL").length === 1);
      if (one !== undefined) expect(one.technologies.filter(t => t.requirement === "OPTIONAL")[0], id).toMatchObject({technologyId: "openxr", registryId: null, status: NAME_NOT_VERIFIED});
    }
  });

  it("the digest covers the truncation records; the default cap is exactly 24 576; the bytes fixed point holds across a power of ten", () => {
    // //TR: İki kısaltılmış bağlam yalnız kısaltma KAYDINDA farklıdır (aynı görünen liste, farklı total): özet farklı olmalıdır.
    const mk = (n: number) => { const slugs = Array.from({length: n}, (_, k) => `o-${String(k).padStart(2, "0")}`); return fxInput({optionalTechnologies: slugs.map(technologyId => ({technologyId, status: "CANDIDATE_NOT_VERIFIED"}))}, {technologies: new Map([["tech-a", techRow("tech-a")], ...slugs.map(slug => [slug, techRow(slug)] as const)])}); };
    const four = fresh("UASCO-0001", mk(4), {maxBytes: 10_000_000});
    const twoOfFour = fresh("UASCO-0001", mk(4), {maxBytes: four.bytes - 1});
    const twoOfFive = fresh("UASCO-0001", mk(5), {maxBytes: twoOfFour.bytes});
    expect(twoOfFour.truncation).toEqual([{field: "technologies.optional", kept: 2, total: 4}]);
    expect(twoOfFive.truncation).toEqual([{field: "technologies.optional", kept: 2, total: 5}]);
    expect(twoOfFive.technologies).toEqual(twoOfFour.technologies);
    expect(twoOfFive.bytes).toBe(twoOfFour.bytes);
    expect(twoOfFive.digest).not.toBe(twoOfFour.digest);
    // //TR: Varsayılan sınır TAM 24 576'dır: dolgu metniyle bağlam tam 24 576 bayta getirilir (kısaltılmaz), bir bayt fazlası varsayılan seçeneklerle kısaltılır; 26 112 gibi daha gevşek bir sınır bunu yakalayamazdı.
    const many = Array.from({length: 110}, (_, k) => `many-${String(k).padStart(3, "0")}`);
    const padded = (pad: number) => richInput({responsibilities: ["R1", "p".repeat(pad)], optionalTechnologies: many.map(technologyId => ({technologyId, status: "CANDIDATE_NOT_VERIFIED"}))}, {technologies: new Map([["tech-a", techRow("tech-a")], ["tech-b", techRow("tech-b")], ...many.map(slug => [slug, techRow(slug)] as const)])});
    const base = fresh("UASCO-0001", padded(0), {maxBytes: 10_000_000}).bytes;
    const need = ROLE_CONTEXT_DEFAULT_MAX_BYTES - base;
    expect(need).toBeGreaterThan(0);
    const exact = fresh("UASCO-0001", padded(need));
    expect(exact.bytes).toBe(24_576);
    expect(exact.truncation).toEqual([]);
    const over = fresh("UASCO-0001", padded(need + 1));
    expect(over.truncation.length).toBeGreaterThan(0);
    expect(over.bytes).toBeLessThanOrEqual(24_576);
    expect(fresh("UASCO-0001", padded(need + 1), {maxBytes: 26_112}).truncation).toEqual([]);
    // //TR: bytes kendi hanelerini sayan sabit noktadır; 10 000 sınırında (9 995 - 10 006) her bağlamda bytes gerçek serileştirilmiş uzunluktur ve tutarlı değerlerin en küçüğüdür.
    const small = (pad: number) => fresh("UASCO-0001", fxInput({responsibilities: ["R1", "p".repeat(pad)]}), {maxBytes: 10_000_000});
    const b0 = small(0).bytes;
    const seen: number[] = [];
    for (let target = 9_990; target <= 10_010; target++) {
      const c = small(target - b0 - 5);
      seen.push(c.bytes);
      expect(c.bytes, `pad for ${target}`).toBe(Buffer.byteLength(JSON.stringify(c), "utf8"));
      const { bytes: _b, digest: _d, ...rest } = c;
      const restLen = Buffer.byteLength(JSON.stringify(rest), "utf8");
      for (let x = c.bytes - 6; x < c.bytes; x++) expect(x === restLen + 85 + String(x).length, `smaller fixed point ${x} for ${c.bytes}`).toBe(false);
    }
    expect(seen.some(b => b < 10_000)).toBe(true);
    expect(seen.some(b => b > 10_000)).toBe(true);
  });

  it("the input loader fails closed and never writes", () => {
    const MINI: Record<string, unknown> = {
      "registries/role-definitions.json": {roles: [{roleId: "UASCO-0001", title: "T", guildId: "G01", clusterId: "CL01", responsibilities: ["r"], forbiddenActions: ["f"], specializationBoundaries: ["b"], requiredSkillIds: [],
        requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}], optionalTechnologies: [], legacyAliases: [], gapIds: []}], guilds: [{guildId: "G01", name: "G", clusterId: "CL01"}]},
      "registries/skills-v2.json": {skills: [{id: "SK2-A"}]},
      "registries/technologies.json": {technologies: [{id: "TECH-A", slug: "tech-a", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]},
      "registries/agent-skill-matrix.json": {agents: [{agentId: "001", requiredSkillIds: ["SK2-A"]}]},
      "registries/role-execution-profiles.json": {profiles: [{roleId: "UASCO-0001", reviewChain: {value: ["UASCO-0002"], gapId: null, status: "PROPOSED_DERIVED"}, candidateSkills: {value: [], gapId: "WFR-GAP-SKILLS-UASCO-0001"}}]}
    };
    const mini = (name: string, tweak: (f: Record<string, string | null>) => void = () => {}): string => {
      const root = fs.mkdtempSync(path.join(tmp, `${name}-`));
      const files: Record<string, string | null> = Object.fromEntries(Object.entries(MINI).map(([k, v]) => [k, JSON.stringify(v)]));
      tweak(files);
      for (const [rel, body] of Object.entries(files)) if (body !== null) { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), body); }
      return root;
    };
    const snapshot = (root: string) => JSON.stringify(fs.readdirSync(root, {recursive: true}).map(String).sort().map(f => [f, fs.statSync(path.join(root, f)).isFile() ? fs.readFileSync(path.join(root, f), "utf8") : null]));
    const ok = mini("ok");
    const before = snapshot(ok);
    const loaded = loadRoleContextInputFromRepo(ok);
    expect(snapshot(ok)).toBe(before);
    expect([loaded.roles.length, loaded.guilds.length, loaded.skillIds.size, loaded.technologies.size, loaded.legacySkills.size, loaded.profiles.length]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(loaded.bindings).toBe(FIRST_DELIVERY_BINDINGS);
    for (const rel of Object.keys(MINI)) {
      expect(() => loadRoleContextInputFromRepo(mini("missing", f => { f[rel] = null; })), `missing ${rel}`).toThrow(`ROLE_CONTEXT_INPUT_UNAVAILABLE:${rel}`);
      expect(() => loadRoleContextInputFromRepo(mini("garbage", f => { f[rel] = "{not json"; })), `garbage ${rel}`).toThrow(`ROLE_CONTEXT_INPUT_UNAVAILABLE:${rel}`);
    }
    // //TR: Boş diziler ve şekli bozuk satırlar ölçüm değil bozuk girdidir: tipli ret, boş küme ikame edilmez.
    const arrays: Array<[string, string]> = [["registries/skills-v2.json", "skills"], ["registries/technologies.json", "technologies"], ["registries/agent-skill-matrix.json", "agents"], ["registries/role-execution-profiles.json", "profiles"]];
    for (const [rel, key] of arrays) expect(() => loadRoleContextInputFromRepo(mini("empty", f => { f[rel] = JSON.stringify({[key]: []}); })), `empty ${rel}`).toThrow(`ROLE_CONTEXT_INPUT_UNAVAILABLE:${rel}`);
    for (const key of ["roles", "guilds"]) expect(() => loadRoleContextInputFromRepo(mini("empty", f => { f["registries/role-definitions.json"] = JSON.stringify({...(MINI["registries/role-definitions.json"] as object), [key]: []}); })), key).toThrow("ROLE_CONTEXT_INPUT_UNAVAILABLE:registries/role-definitions.json");
    expect(() => loadRoleContextInputFromRepo(mini("shape", f => { f["registries/role-definitions.json"] = JSON.stringify({roles: [{roleId: "UASCO-0001"}], guilds: [{guildId: "G01", clusterId: "CL01"}]}); }))).toThrow("ROLE_CONTEXT_INPUT_UNAVAILABLE:registries/role-definitions.json");
    // //TR: Yinelenen anahtar yazılır-kazanır değil hatadır.
    const dupTech = JSON.stringify({technologies: [{id: "TECH-A", slug: "tech-a", status: "REGISTERED", knowledgeState: "S"}, {id: "TECH-B", slug: "tech-a", status: "REGISTERED", knowledgeState: "S"}]});
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/technologies.json"] = dupTech; }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_TECHNOLOGY_SLUG:tech-a");
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/agent-skill-matrix.json"] = JSON.stringify({agents: [{agentId: "001", requiredSkillIds: []}, {agentId: "001", requiredSkillIds: []}]}); }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_LEGACY_AGENT_ID:001");
    const p = {roleId: "UASCO-0001", reviewChain: {value: [], gapId: null, status: "PROPOSED_DERIVED"}, candidateSkills: {value: [], gapId: null}};
    expect(ROLE_CONTEXT_PROFILE_STATUSES).toEqual(["PROPOSED_DERIVED"]);
    // //TR: Profil alanının kendi durumu (status) zorunludur: inceleme zinciri etiketi ondan gelir; durumsuz profil bozuk girdidir (tipli ret).
    expect(() => loadRoleContextInputFromRepo(mini("nostatus", f => { f["registries/role-execution-profiles.json"] = JSON.stringify({profiles: [{roleId: "UASCO-0001", reviewChain: {value: [], gapId: null}, candidateSkills: {value: [], gapId: null}}]}); }))).toThrow("ROLE_CONTEXT_INPUT_UNAVAILABLE:registries/role-execution-profiles.json");
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/role-execution-profiles.json"] = JSON.stringify({profiles: [p, p]}); }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_PROFILE_ROLE_ID:UASCO-0001");
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/role-definitions.json"] = JSON.stringify({...(MINI["registries/role-definitions.json"] as object), guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G01", clusterId: "CL01"}]}); }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_GUILD_ID:G01");
    // //TR: Gerçek depo: 599 rol, 51 lonca, 425 beceri, 415 teknoloji, 363 eski ajan, 599 profil.
    const real = input();
    expect([real.roles.length, real.guilds.length, real.skillIds.size, real.technologies.size, real.legacySkills.size, real.profiles.length]).toEqual([599, 51, 425, 415, 363, 599]);

    // //TR: Alan düzeyinde kapalı başarısızlık: her zorunlu alanın silinmesi ya da yanlış türde olması, DOĞRU dosya adıyla tipli hata verir (yanlış dosya adı, eksik denetim ya da null satır TypeError/yanlış ad olarak görünür).
    const RD = "registries/role-definitions.json", SK = "registries/skills-v2.json", TE = "registries/technologies.json", MX = "registries/agent-skill-matrix.json", PR = "registries/role-execution-profiles.json";
    const doc = (rel: string): any => JSON.parse(JSON.stringify(MINI[rel]));
    const cases: Array<[string, string, (d: any) => unknown]> = [];
    for (const f of ["roleId", "title", "guildId", "clusterId", "responsibilities", "forbiddenActions", "specializationBoundaries", "requiredSkillIds", "requiredTechnologies", "optionalTechnologies", "gapIds", "legacyAliases"]) cases.push([RD, `role without ${f}`, d => { delete d.roles[0][f]; return d; }]);
    for (const f of ["responsibilities", "forbiddenActions", "specializationBoundaries", "requiredSkillIds", "gapIds"]) cases.push([RD, `role ${f} not strings`, d => { d.roles[0][f] = [1]; return d; }]);
    for (const f of ["requiredTechnologies", "optionalTechnologies"]) for (const bad of [[{technologyId: 1, status: "S"}], [{technologyId: "t"}], [null]]) cases.push([RD, `role ${f} ${JSON.stringify(bad)}`, d => { d.roles[0][f] = bad; return d; }]);
    for (const bad of [[{status: "S"}], [{legacyId: "1"}], [null]]) cases.push([RD, `role legacyAliases ${JSON.stringify(bad)}`, d => { d.roles[0].legacyAliases = bad; return d; }]);
    cases.push([RD, "role row null", d => { d.roles[0] = null; return d; }], [RD, "guild row null", d => { d.guilds[0] = null; return d; }], [RD, "roles is not an array", d => { d.roles = {length: 1}; return d; }], [RD, "roles is a string", d => { d.roles = "x"; return d; }], [RD, "document is null", () => null]);
    for (const f of ["guildId", "clusterId"]) cases.push([RD, `guild without ${f}`, d => { delete d.guilds[0][f]; return d; }]);
    cases.push([SK, "skill without id", d => { delete d.skills[0].id; return d; }], [SK, "skill row null", d => { d.skills[0] = null; return d; }]);
    for (const f of ["id", "slug", "status", "knowledgeState"]) cases.push([TE, `technology without ${f}`, d => { delete d.technologies[0][f]; return d; }]);
    cases.push([TE, "technology row null", d => { d.technologies[0] = null; return d; }]);
    cases.push([MX, "agent without agentId", d => { delete d.agents[0].agentId; return d; }], [MX, "agent without requiredSkillIds", d => { delete d.agents[0].requiredSkillIds; return d; }], [MX, "agent requiredSkillIds not strings", d => { d.agents[0].requiredSkillIds = [1]; return d; }], [MX, "agent row null", d => { d.agents[0] = null; return d; }]);
    cases.push([PR, "profile without roleId", d => { delete d.profiles[0].roleId; return d; }], [PR, "profile row null", d => { d.profiles[0] = null; return d; }], [PR, "profile reviewChain missing", d => { delete d.profiles[0].reviewChain; return d; }], [PR, "profile reviewChain null", d => { d.profiles[0].reviewChain = null; return d; }],
      [PR, "reviewChain.value missing", d => { delete d.profiles[0].reviewChain.value; return d; }], [PR, "reviewChain.value not strings", d => { d.profiles[0].reviewChain.value = [1]; return d; }], [PR, "reviewChain.status not a string", d => { d.profiles[0].reviewChain.status = 1; return d; }], [PR, "reviewChain.status outside the allowed values", d => { d.profiles[0].reviewChain.status = "CERTIFIED"; return d; }],
      [PR, "candidateSkills missing", d => { delete d.profiles[0].candidateSkills; return d; }], [PR, "candidateSkills not an object", d => { d.profiles[0].candidateSkills = "x"; return d; }], [PR, "candidateSkills.value missing", d => { delete d.profiles[0].candidateSkills.value; return d; }], [PR, "candidateSkills.value not strings", d => { d.profiles[0].candidateSkills.value = [1]; return d; }]);
    expect(cases).toHaveLength(56);
    for (const [rel, name, edit] of cases) expect(() => loadRoleContextInputFromRepo(mini("field", f => { f[rel] = JSON.stringify(edit(doc(rel))); })), `${rel}: ${name}`).toThrow(`ROLE_CONTEXT_INPUT_UNAVAILABLE:${rel}`);
  });
});
