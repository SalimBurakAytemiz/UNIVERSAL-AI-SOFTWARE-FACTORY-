// //TR: Bu test 599 rollu hedef katalogun (51 guild, 10 cluster) bütünlüğünü, dürüst durum alanlarını ve 363 rol uzlaştırmasının geçerli kimlik referanslarını doğrular.
import {describe, it, expect} from "vitest";
import fs from "node:fs";

const read = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const cat = read("registries/target-role-catalog.json");
const rec = read("registries/target-role-reconciliation.json");
const agents = read("registries/agents.json").agents as Array<{id: string}>;

describe("target role catalog", () => {
  it("has the honest status string", () => {
    expect(cat.status).toBe("TARGET_CATALOG_NOT_RUNTIME");
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
      expect(r.runtimeStatus).toBe("NOT_IMPLEMENTED");
      expect(r.certification).toBe("NOT_EVALUATED");
    }
  });
});

describe("target role reconciliation", () => {
  const targets = new Set(cat.roles.map((r: {roleId: string}) => r.roleId));
  const regIds = new Set(agents.map((a) => a.id));
  it("references only valid ids on both sides and confirms nothing", () => {
    expect(rec.registeredCount).toBe(363);
    expect(regIds.size).toBe(363);
    for (const m of rec.mappings) {
      expect(regIds.has(m.registeredId)).toBe(true);
      expect(targets.has(m.targetRoleId)).toBe(true);
      expect(["EXACT", "CANDIDATE_NEEDS_REVIEW"]).toContain(m.status);
    }
    for (const u of rec.unmatchedRegistered) expect(regIds.has(u.registeredId)).toBe(true);
    for (const u of rec.unmatchedTarget) expect(targets.has(u.roleId)).toBe(true);
  });
  it("accounts for every registered role exactly once", () => {
    const seen = [...rec.mappings.map((m: {registeredId: string}) => m.registeredId), ...rec.unmatchedRegistered.map((u: {registeredId: string}) => u.registeredId)];
    expect(seen.length).toBe(363);
    expect(new Set(seen).size).toBe(363);
  });
  it("does not modify the registered roles (still 363)", () => {
    expect(agents.length).toBe(363);
  });
});
