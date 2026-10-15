// //TR: Bu test 599 rollu hedef katalogun (WFR-03 ile registries/role-definitions.json olarak kanonik kayda terfi etti; 51 guild, 10 cluster) bütünlüğünü, dürüst durum alanlarını ve 363 legacy rolün (eski uzlaştırma dosyası WFR-03'te legacyAliases/legacyUnmapped ile temsil edilip kaldırıldı) geçerli kimlik referanslarını doğrular.
import {describe, it, expect} from "vitest";
import fs from "node:fs";

const read = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const cat = read("registries/role-definitions.json");
const agents = read("registries/agents.json").agents as Array<{id: string}>;

describe("target role catalog", () => {
  it("has the honest status string", () => {
    expect(cat.status).toBe("CANONICAL_ROLE_REGISTRY_TARGET_NOT_RUNTIME");
    expect(cat.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("has exactly 599 unique contiguous ids 0001..0599", () => {
    expect(cat.roles.length).toBe(599);
    const ids = cat.roles.map((r: {roleId: string}) => r.roleId);
    expect(new Set(ids).size).toBe(599);
    ids.forEach((id: string, i: number) => expect(id).toBe("UASCO-" + String(i + 1).padStart(4, "0")));
  });
  it("has 51 guilds and 10 clusters with unique ids", () => {
    expect(cat.guilds.length).toBe(51);
    expect(cat.clusters.length).toBe(10);
    expect(new Set(cat.guilds.map((g: {guildId: string}) => g.guildId)).size).toBe(51);
    expect(new Set(cat.clusters.map((c: {clusterId: string}) => c.clusterId)).size).toBe(10);
  });
  it("every role references an existing guild whose cluster matches", () => {
    const guilds = new Map<string, {clusterId: string}>(cat.guilds.map((g: {guildId: string; clusterId: string}) => [g.guildId, g]));
    const clusters = new Set(cat.clusters.map((c: {clusterId: string}) => c.clusterId));
    for (const g of guilds.values()) expect(clusters.has(g.clusterId)).toBe(true);
    for (const r of cat.roles) {
      expect(guilds.has(r.guildId)).toBe(true);
      expect(guilds.get(r.guildId)!.clusterId).toBe(r.clusterId);
      expect(typeof r.title).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
    }
  });
  it("claims no runtime or certification state", () => {
    for (const r of cat.roles) {
      expect(r.lifecycle).toBe("TARGET");
      expect(r.runtimeStatus).toBe("UNKNOWN");
      expect(r.proficiencyStatus).toBe("NOT_EVALUATED");
      expect(r.certifiedScope).toBeNull();
    }
  });
});

describe("target role reconciliation (superseded by legacyAliases)", () => {
  const targets = new Set(cat.roles.map((r: {roleId: string}) => r.roleId));
  const regIds = new Set(agents.map((a) => a.id));
  const aliases = cat.roles.flatMap((r: {roleId: string; legacyAliases: Array<{legacyId: string; status: string; approval: string}>}) => r.legacyAliases.map((a) => ({...a, roleId: r.roleId})));
  it("references only valid ids on both sides and confirms nothing", () => {
    expect(cat.authority.legacyRegistry.count).toBe(363);
    expect(regIds.size).toBe(363);
    expect(aliases.length).toBeGreaterThan(0);
    for (const m of aliases) {
      expect(regIds.has(m.legacyId)).toBe(true);
      expect(targets.has(m.roleId)).toBe(true);
      expect(["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED", "CONFLICT", "MISSING_SOURCE", "REJECTED", "UNMAPPED"]).toContain(m.status);
      expect(m.approval).toBe("PROPOSED");
    }
    for (const u of cat.legacyUnmapped) expect(regIds.has(u.legacyId)).toBe(true);
    expect(fs.existsSync("registries/target-role-reconciliation.json")).toBe(false);
    expect(cat.reconciliationSupersession.candidatePairsRepresentedAsLegacyAlias).toBe(cat.reconciliationSupersession.candidatePairs);
  });
  it("accounts for every registered role exactly once", () => {
    const primary = aliases.filter((a: {status: string}) => ["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED"].includes(a.status)).map((a: {legacyId: string}) => a.legacyId);
    const seen = [...primary, ...cat.legacyUnmapped.map((u: {legacyId: string}) => u.legacyId)];
    expect(seen.length).toBe(363);
    expect(new Set(seen).size).toBe(363);
  });
  it("does not modify the registered roles (still 363)", () => {
    expect(agents.length).toBe(363);
  });
});
