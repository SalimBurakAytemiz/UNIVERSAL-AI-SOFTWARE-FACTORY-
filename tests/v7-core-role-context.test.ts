// //TR: Bu test C-CTX-1 Rol Bağlamı Çözümleyicisini (core/agents/role-context.ts) doğrular: 599 rolün hepsi hata fırlatmadan çözülür (T1); UASCO-0085 önerilen 72 beceri, kanonik 0, çözümleyici etiketi EXECUTABLE (T2); UASCO-0424 önerilen 0, boşluk kimliği ve ROLE_HAS_NO_BINDING (T3); UASCO-0450 autosar CANDIDATE_NOT_VERIFIED olarak görünür (T4); bilinmeyen rol ROLE_NOT_IN_CATALOG (T5); önerilen beceri hiçbir rolde kanonik altında değildir (T6); özet belirlidir ve kanonik metne duyarlıdır (T7); 41 çözülemeyen teknoloji referansı registryId null ve NAME_NOT_VERIFIED_IN_REGISTRY taşır (T8). Ek olarak bayt sınırı, hiçbir doğrulanmış/sertifikalı durum uydurulmaması, takma ad kuralları ve yükleyicinin kapalı başarısızlığı sınanır. Hiçbir test kayıt dosyasına yazmaz.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {NAME_NOT_VERIFIED, ROLE_CONTEXT_DEFAULT_MAX_BYTES, loadRoleContextInputFromRepo, resolveAllRoleContexts, resolveRoleContext} from "../core/agents/role-context.js";
import type {ContextRole, RoleContext, RoleContextInput} from "../core/agents/role-context.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";

const REPO = path.resolve(import.meta.dirname, "..");
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
const REG = readJson("registries/role-definitions.json") as {roles: Array<Record<string, any>>; guilds: Array<Record<string, any>>};
const PROFILES = (readJson("registries/role-execution-profiles.json").profiles as Array<Record<string, any>>);
let INPUT: RoleContextInput | null = null;
const input = (): RoleContextInput => (INPUT ??= loadRoleContextInputFromRepo(REPO));
const ctx = (id: string, i: RoleContextInput = input(), o: {maxBytes?: number} = {}): RoleContext => {
  const r = resolveRoleContext(i, id, o);
  if (r.status !== "RESOLVED") throw new Error(`not resolved: ${id} ${r.reason}`);
  return r.context;
};

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

describe("C-CTX-1 role-context", () => {
  let tmp = "";
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ctx1-")); });
  afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

  it("all 599 roles resolve without throwing; title and guildId equal the registry", () => {
    const all = resolveAllRoleContexts(input());
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
    }
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
    for (const r of resolveAllRoleContexts(input())) {
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
    const a = ctx("UASCO-0085"), b = ctx("UASCO-0085");
    expect(a.digest).toBe(b.digest);
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
    for (const r of resolveAllRoleContexts(input())) if (r.status === "RESOLVED") for (const t of r.context.technologies) if (t.registryId === null) unresolved.push([r.context.roleId, t.technologyId, t.status]);
    expect(unresolved).toHaveLength(41);
    expect([...new Set(unresolved.map(u => u[1]))].sort()).toEqual(["openxr", "postgis", "qgis", "schemathesis"]);
    expect(unresolved.every(u => u[2] === NAME_NOT_VERIFIED)).toBe(true);
    expect(NAME_NOT_VERIFIED).toBe("NAME_NOT_VERIFIED_IN_REGISTRY");
    // //TR: Bir referansın gizlenmediğinin bağımsız kanıtı: bağlamdaki (gerekli + isteğe bağlı) teknoloji sayısı kayıttakiyle birebir aynıdır.
    const raw = REG.roles.reduce((n, r) => n + r.requiredTechnologies.length + r.optionalTechnologies.length, 0);
    let seen = 0;
    for (const r of resolveAllRoleContexts(input())) if (r.status === "RESOLVED") seen += r.context.technologies.length;
    expect(seen).toBe(raw);
    expect(raw).toBe(4236);
    // //TR: Kayıtta olmayan ad, rolün kendi durumu başka olsa bile NAME_NOT_VERIFIED_IN_REGISTRY olur; kayıtlı ad rolün KENDİ durumunu korur.
    const fx = ctx("UASCO-0001", fxInput({requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}, {technologyId: "ghost-tech", status: "CANDIDATE_NOT_VERIFIED"}], optionalTechnologies: [{technologyId: "ghost-opt", status: "CANDIDATE_NOT_VERIFIED"}]}));
    expect(fx.technologies.map(t => [t.technologyId, t.requirement, t.registryId, t.status])).toEqual([["ghost-tech", "REQUIRED", null, NAME_NOT_VERIFIED], ["tech-a", "REQUIRED", "TECH-A", "CANDIDATE_NOT_VERIFIED"], ["ghost-opt", "OPTIONAL", null, NAME_NOT_VERIFIED]]);
  });

  it("no verified or certified status is ever produced", () => {
    const statuses = new Set<string>(), registry = new Set<string>(), approvals = new Set<string>();
    for (const r of resolveAllRoleContexts(input())) if (r.status === "RESOLVED") {
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
    expect(resolveAllRoleContexts(input()).filter(r => r.status === "RESOLVED" && r.context.binding.resolverLabel === "EXECUTABLE")).toHaveLength(9);
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
    expect(multi.bytes).toBe(Buffer.byteLength(JSON.stringify(rest), "utf8"));
    expect(multi.bytes).toBeGreaterThan(JSON.stringify(rest).length);
    // //TR: Sığan bağlam kısaltılmaz; varsayılan sınır 599/599'u kısaltmadan karşılar (T1).
    expect(ctx("UASCO-0424").truncation).toEqual([]);
  });

  it("the input loader fails closed and never writes", () => {
    const MINI: Record<string, unknown> = {
      "registries/role-definitions.json": {roles: [{roleId: "UASCO-0001", title: "T", guildId: "G01", clusterId: "CL01", responsibilities: ["r"], forbiddenActions: ["f"], specializationBoundaries: ["b"], requiredSkillIds: [],
        requiredTechnologies: [{technologyId: "tech-a", status: "CANDIDATE_NOT_VERIFIED"}], optionalTechnologies: [], legacyAliases: [], gapIds: []}], guilds: [{guildId: "G01", name: "G", clusterId: "CL01"}]},
      "registries/skills-v2.json": {skills: [{id: "SK2-A"}]},
      "registries/technologies.json": {technologies: [{id: "TECH-A", slug: "tech-a", status: "REGISTERED", knowledgeState: "SEED_PROFILE"}]},
      "registries/agent-skill-matrix.json": {agents: [{agentId: "001", requiredSkillIds: ["SK2-A"]}]},
      "registries/role-execution-profiles.json": {profiles: [{roleId: "UASCO-0001", reviewChain: {value: ["UASCO-0002"], gapId: null}, candidateSkills: {value: [], gapId: "WFR-GAP-SKILLS-UASCO-0001"}}]}
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
    const p = {roleId: "UASCO-0001", reviewChain: {value: [], gapId: null}, candidateSkills: {value: [], gapId: null}};
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/role-execution-profiles.json"] = JSON.stringify({profiles: [p, p]}); }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_PROFILE_ROLE_ID:UASCO-0001");
    expect(() => loadRoleContextInputFromRepo(mini("dup", f => { f["registries/role-definitions.json"] = JSON.stringify({...(MINI["registries/role-definitions.json"] as object), guilds: [{guildId: "G01", clusterId: "CL01"}, {guildId: "G01", clusterId: "CL01"}]}); }))).toThrow("ROLE_CONTEXT_INPUT_INVALID:DUPLICATE_GUILD_ID:G01");
    // //TR: Gerçek depo: 599 rol, 51 lonca, 425 beceri, 415 teknoloji, 363 eski ajan, 599 profil.
    const real = input();
    expect([real.roles.length, real.guilds.length, real.skillIds.size, real.technologies.size, real.legacySkills.size, real.profiles.length]).toEqual([599, 51, 425, 415, 363, 599]);
  });
});
