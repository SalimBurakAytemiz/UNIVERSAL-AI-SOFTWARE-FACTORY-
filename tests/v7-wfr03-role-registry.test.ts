// //TR: Bu test WFR-03 tek kanonik 599 RoleDefinition kaydını doğrular: WFR-AT-001 (599/51, benzersiz kimlik, başlık/kaynak izi), WFR-AT-002 (bilinen kötü eşleme asla SEMANTIC_VERIFIED değil, eksik legacy UNMAPPED/MISSING_SOURCE), WFR-AT-004 (/v1/agents, /v1/roles, /v1/cockpit 599 kayıtlı ve 0 worker'ı tutarlı gösterir), WFR-AT-012 (3594 NOT_EXECUTED spec yeşil sayılamaz), validator negatif fixture'ları, API sayfalama/filtreleri ve legacy agents.json bayt kimliği.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {buildServer} from "../apps/control-api/src/server.js";

const REPO = path.resolve(import.meta.dirname, "..");
const REG_FILE = path.join(REPO, "registries", "role-definitions.json");
const AGENTS_FILE = path.join(REPO, "registries", "agents.json");
const WFR02 = path.join(REPO, "registries", "sources", "wfr02");
const BASE_COMMIT = "06677f715a076740762825e838bb277e683fb812";
const LEGACY_SHA = "cbe7abf00b4c1e7d989f8478f4d3aacb21d8daabedead45e44d892aa8332f5e3";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const reg = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
type Alias = {legacyId: string; status: string; approval: string; evidenceRef: string};
type Role = {roleId: string; title: string; guildId: string; clusterId: string; legacyAliases: Alias[]; [k: string]: any};
const roles = reg.roles as Role[];
const aliasOf = (roleId: string, legacyId: string) => roles.find((r) => r.roleId === roleId)!.legacyAliases.find((a) => a.legacyId === legacyId);

let tmp = "";
beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-wfr03-")); });
afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

const runValidator = (args: string[] = []) => {
  const r = cp.spawnSync(process.execPath, ["scripts/validate-role-registry.mjs", ...args], {cwd: REPO, encoding: "utf8"});
  return {status: r.status, out: `${r.stdout}\n${r.stderr}`};
};
let fixtureN = 0;
const withFixture = (mutate: (d: any) => void) => {
  const d = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  mutate(d);
  const f = path.join(tmp, `registry-fixture-${++fixtureN}.json`);
  fs.writeFileSync(f, JSON.stringify(d));
  return runValidator(["--registry", f]);
};

describe("WFR-AT-001 canonical registry: 599 roles, 51 guilds, unique ids, title/source trace", () => {
  it("has 599 unique contiguous role ids in 51 guilds and 10 clusters", () => {
    expect(reg.status).toBe("CANONICAL_ROLE_REGISTRY_TARGET_NOT_RUNTIME");
    expect(reg.notice).toBe("599 REGISTERED ≠ certified ≠ running");
    expect(roles.length).toBe(599);
    expect(new Set(roles.map((r) => r.roleId)).size).toBe(599);
    roles.forEach((r, i) => expect(r.roleId).toBe(`UASCO-${String(i + 1).padStart(4, "0")}`));
    expect(reg.guilds.length).toBe(51);
    expect(reg.clusters.length).toBe(10);
    expect(reg.guilds.reduce((n: number, g: {roleCount: number}) => n + g.roleCount, 0)).toBe(599);
    for (const g of reg.guilds) { expect(g.ownerRoleId).toBeNull(); expect(g.gapIds).toContain(`WFR-GAP-GUILD-OWNER-${g.guildId}`); }
  });
  it("traces every title to the Master V2 roster row and genome contract by file, sha256 and line", () => {
    const roster = reg.source.lineRanges.find((x: {what: string}) => x.what.startsWith("role roster"));
    const gen = reg.source.lineRanges.find((x: {what: string}) => x.what.startsWith("genome contracts"));
    expect(reg.source.sha256).toBe("35d00e292d89bad59316e8f9b31ee39f4aaf7a34c9eba1e3077763f962512a1d");
    for (const r of roles) {
      expect(r.title.length).toBeGreaterThan(0);
      const [row, genome] = r.provenance;
      for (const p of r.provenance) { expect(p.source).toBe(reg.source.file); expect(p.sha256).toBe(reg.source.sha256); }
      expect(row.line).toBeGreaterThanOrEqual(roster.from); expect(row.line).toBeLessThanOrEqual(roster.to);
      expect(genome.line).toBeGreaterThanOrEqual(gen.from); expect(genome.toLine).toBeLessThanOrEqual(gen.to);
      for (const e of r.evaluationSpecs) { const ln = Number(e.specRef.split("#L")[1]); expect(ln).toBeGreaterThan(genome.line); expect(ln).toBeLessThan(genome.toLine); }
    }
  });
  it("carries every RoleDefinition field of contract section 3 with honest defaults", () => {
    const fields = ["roleId", "roleDefinitionVersion", "title", "guildId", "clusterId", "priority", "specializationBoundaries", "requiredSkillIds", "desiredMasteryLevels", "requiredTechnologies", "optionalTechnologies", "toolAdapterIds", "domainPacks", "responsibilities", "forbiddenActions", "evaluationSpecs", "knowledgeSourceRefs", "learningCandidates", "allowedWorkerScope", "permissionGrants", "runtimeStatus", "proficiencyStatus", "certifiedScope", "evaluatorEvidenceRefs", "reviewerEvidenceRef", "provenance", "lastVerifiedAt", "expiresAt", "gapIds", "legacyAliases"];
    for (const r of roles) {
      for (const f of fields) expect(r, `${r.roleId}.${f}`).toHaveProperty(f);
      expect([r.runtimeStatus, r.proficiencyStatus, r.certifiedScope, r.reviewerEvidenceRef, r.lastVerifiedAt, r.expiresAt]).toEqual(["UNKNOWN", "NOT_EVALUATED", null, null, null, null]);
      expect(r.gapIds).toEqual(expect.arrayContaining([`WFR-GAP-SKILLS-${r.roleId}`, `WFR-GAP-TOOL-ADAPTERS-${r.roleId}`, `WFR-GAP-EVALUATION-${r.roleId}`]));
      expect(r.responsibilities.length).toBeGreaterThan(0);
      expect(r.forbiddenActions.length).toBeGreaterThan(0);
    }
  });
});

describe("WFR-AT-002 legacy aliases are PROPOSED, known bad pairs are never verified", () => {
  it("keeps the contract's known-bad pair 3D Modeling -> Audio Design as REJECTED, never SEMANTIC_VERIFIED", () => {
    const bad = aliasOf("UASCO-0458", "221");
    expect(bad?.status).toBe("REJECTED");
    expect(roles.find((r) => r.roleId === "UASCO-0458")!.title).toMatch(/Audio Design/);
    for (const r of roles) for (const a of r.legacyAliases) if (a.legacyId === "221") expect(a.status).not.toBe("SEMANTIC_VERIFIED");
  });
  it("records every pair the independent verifier judged wrong as REJECTED", () => {
    const c2 = JSON.parse(fs.readFileSync(path.join(WFR02, "chunk-2-verified.json"), "utf8"));
    const c3 = JSON.parse(fs.readFileSync(path.join(WFR02, "chunk-3-verified.json"), "utf8"));
    const pairs = [...c2.heuristicCrossDomainNotAdopted.map((x: {legacyId: string; targetRoleId: string}) => [x.targetRoleId, x.legacyId]),
      ...c3.heuristicPairsJudgedWrong.map((x: {pair: string}) => [x.pair.match(/UASCO-\d{4}/)![0], x.pair.slice(0, 3)])];
    expect(pairs.length).toBeGreaterThan(10);
    for (const [roleId, legacyId] of pairs) expect(aliasOf(roleId, legacyId)?.status).toBe("REJECTED");
  });
  it("puts missing/unmapped legacy roles in legacyUnmapped and never as a primary alias", () => {
    const missing = reg.legacyUnmapped.find((u: {legacyId: string}) => u.legacyId === "021");
    expect(missing?.status).toBe("MISSING_SOURCE");
    const unmapped = reg.legacyUnmapped.filter((u: {status: string}) => u.status === "UNMAPPED");
    expect(unmapped.length).toBe(32);
    const primary = new Set(["EXACT_ID", "SEMANTIC_VERIFIED", "SUSPECTED"]);
    for (const u of reg.legacyUnmapped)
      for (const r of roles) {
        expect(r.legacyAliases.some((a) => a.legacyId === u.legacyId && primary.has(a.status))).toBe(false);
        // an unmapped legacy role may only appear as a CONFLICT candidate or a REJECTED pair
        for (const a of r.legacyAliases.filter((x) => x.legacyId === u.legacyId)) expect(["CONFLICT", "REJECTED"]).toContain(a.status);
      }
    for (const r of roles) for (const a of r.legacyAliases) expect(a.approval).toBe("PROPOSED");
    expect(reg.counts.legacyAliases.byStatus.SEMANTIC_VERIFIED).toBe(214);
  });
  it("stores WFR-02 evidence that verifies against its SHA256SUMS once the //TR line is removed", () => {
    const sums = new Map(fs.readFileSync(path.join(WFR02, "SHA256SUMS"), "utf8").split("\n").filter(Boolean).map((l) => { const [h, f] = l.split(/ \*?/); return [f, h]; }));
    for (const f of ["chunk-1-verified.json", "chunk-2-verified.json", "chunk-3-verified.json", "SUMMARY.json"]) {
      const ls = fs.readFileSync(path.join(WFR02, f), "utf8").split("\n");
      expect(ls[1]).toMatch(/^ {2}"\/\/TR": /);
      expect(sha([ls[0], ...ls.slice(2)].join("\n"))).toBe(sums.get(f));
    }
  });
});

describe("WFR-AT-012 3594 NOT_EXECUTED specs cannot be green; validator anti-fake-green", () => {
  it("has 3594 evaluation specs, all NOT_EXECUTED, 0 certified, 0 ready", () => {
    const specs = roles.flatMap((r) => r.evaluationSpecs);
    expect(specs.length).toBe(3594);
    expect(specs.every((e: {status: string; evaluatorEvidenceRef: unknown}) => e.status === "NOT_EXECUTED" && e.evaluatorEvidenceRef === null)).toBe(true);
    expect(reg.counts).toEqual(expect.objectContaining({evaluationSpecs: 3594, evaluationSpecsExecuted: 0, certified: 0, runtimeReady: 0}));
  });
  it("passes on the committed registry", () => {
    const r = runValidator();
    expect(r.out).toContain("ROLE_REGISTRY_VALIDATION: PASS");
    expect(r.status).toBe(0);
  });
  it("fails on a fake CERTIFIED / READY role", () => {
    const r = withFixture((d) => { d.roles[0].proficiencyStatus = "CERTIFIED"; d.roles[0].runtimeStatus = "READY"; d.roles[0].certifiedScope = {scope: "all"}; d.counts.certified = 1; d.counts.runtimeReady = 1; });
    expect(r.status).toBe(2);
    expect(r.out).toContain("CLAIM_WITHOUT_CERTIFICATION_EVIDENCE: UASCO-0001");
  });
  it("fails on a PASSED evaluation spec without evaluator evidence", () => {
    const r = withFixture((d) => { d.roles[5].evaluationSpecs[0].status = "PASSED"; d.counts.evaluationSpecsExecuted = 1; });
    expect(r.status).toBe(2);
    expect(r.out).toContain("FAKE_GREEN_EVALUATION: UASCO-0006 EV-01");
  });
});

describe("role-registry validator negative fixtures", () => {
  const cases: Array<[string, (d: any) => void, string]> = [
    ["auto-approved alias", (d) => { d.roles.find((r: Role) => r.legacyAliases.length).legacyAliases[0].approval = "APPROVED"; }, "ALIAS_AUTO_APPROVED"],
    ["unknown alias status", (d) => { d.roles.find((r: Role) => r.legacyAliases.length).legacyAliases[0].status = "MAPPED"; }, "ALIAS_STATUS"],
    ["known-bad pair promoted", (d) => { d.roles[457].legacyAliases.find((a: Alias) => a.legacyId === "221").status = "SEMANTIC_VERIFIED"; }, "ALIAS_LEGACY_MULTI_PRIMARY: 221"],
    ["598 roles", (d) => { d.roles.pop(); }, "ROLE_COUNT"],
    ["duplicate id", (d) => { d.roles[1].roleId = "UASCO-0001"; }, "ROLE_ID_DUPLICATE"],
    ["unknown guild", (d) => { d.roles[3].guildId = "G99"; }, "ROLE_GUILD: UASCO-0004"],
    ["cluster mismatch", (d) => { d.roles[3].clusterId = d.roles[3].clusterId === "CL01" ? "CL02" : "CL01"; }, "ROLE_CLUSTER: UASCO-0004"],
    ["50 guilds", (d) => { d.guilds.pop(); }, "GUILDS"],
    ["missing mandatory field", (d) => { delete d.roles[7].forbiddenActions; }, "ROLE_FIELD: UASCO-0008.forbiddenActions"],
    ["empty group without gap", (d) => { d.roles[8].gapIds = d.roles[8].gapIds.filter((g: string) => !g.startsWith("WFR-GAP-SKILLS-")); }, "MANDATORY_GROUP_EMPTY_WITHOUT_GAP: UASCO-0009.requiredSkillIds"],
    ["missing provenance", (d) => { d.roles[9].provenance = []; }, "ROLE_PROVENANCE: UASCO-0010"],
    ["legacy id dropped from disposition", (d) => { d.legacyUnmapped = d.legacyUnmapped.filter((u: {legacyId: string}) => u.legacyId !== "021"); }, "LEGACY_DISPOSITION: 021"],
    ["only 5 evaluation specs", (d) => { d.roles[10].evaluationSpecs.pop(); }, "ROLE_EVALUATION_SPECS: UASCO-0011"],
  ];
  for (const [name, mutate, code] of cases) it(`rejects ${name}`, () => { const r = withFixture(mutate); expect(r.status).toBe(2); expect(r.out).toContain(code); });

  it("rejects a changed legacy agents.json (byte identity)", () => {
    const f = path.join(tmp, "agents-mutated.json");
    fs.writeFileSync(f, fs.readFileSync(AGENTS_FILE, "utf8") + " ");
    const r = runValidator(["--agents", f]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("LEGACY_AGENTS_BYTES_CHANGED");
  });
  it("grep gate rejects runtime code that reads registries/agents.json for decisions", () => {
    const scan = path.join(tmp, "scan");
    fs.mkdirSync(path.join(scan, "core", "routing"), {recursive: true});
    fs.mkdirSync(path.join(scan, "apps", "control-api", "src"), {recursive: true});
    fs.writeFileSync(path.join(scan, "core", "routing", "pick.ts"), "// //TR: test\nexport const pick=()=>JSON.parse(require('fs').readFileSync('registries/agents.json','utf8'));\n");
    fs.writeFileSync(path.join(scan, "apps", "control-api", "src", "server.ts"), "const a=\"registries/agents.json\";\n");
    const r = runValidator(["--scan-root", scan]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("RUNTIME_READS_LEGACY_AGENTS: core/routing/pick.ts:2");
    expect(r.out).toContain("RUNTIME_READS_LEGACY_AGENTS: apps/control-api/src/server.ts:1");
  });
});

describe("legacy agents.json stays byte-identical (LEGACY_REFERENCE_ONLY)", () => {
  it("matches the fixture hash, the registry header and the B11A base commit", () => {
    const raw = fs.readFileSync(AGENTS_FILE);
    expect(sha(raw)).toBe(LEGACY_SHA);
    expect(reg.authority.legacyRegistry).toEqual(expect.objectContaining({path: "registries/agents.json", authority: "LEGACY_REFERENCE_ONLY", count: 363, sha256: LEGACY_SHA}));
    expect(JSON.parse(raw.toString("utf8")).agents.length).toBe(363);
    const base = cp.spawnSync("git", ["show", `${BASE_COMMIT}:registries/agents.json`], {cwd: REPO, encoding: "buffer"});
    if (base.status === 0) expect(sha(base.stdout)).toBe(LEGACY_SHA);
    const ra = JSON.parse(fs.readFileSync(path.join(REPO, "registries", "registry-authority-v2.json"), "utf8"));
    expect(ra.authorities.roleDefinitions).toBe("registries/role-definitions.json");
    expect(ra.authorities.legacyAgents).toBe("registries/agents.json");
    expect(ra.legacyAgentsAuthority).toBe("LEGACY_REFERENCE_ONLY");
  });
});

describe("WFR-AT-004 and /v1/roles API", () => {
  const token = crypto.randomBytes(16).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  const mk = () => {
    const runtime = path.join(tmp, `rt-${crypto.randomBytes(4).toString("hex")}`);
    fs.mkdirSync(runtime, {recursive: true});
    return buildServer({controlToken: token, runtime, repoRoot: REPO, dataDir: path.join(runtime, "workos"), port: 3210, logger: false});
  };
  const get = async (app: ReturnType<typeof buildServer>, url: string) => app.inject({method: "GET", url, headers: hdr});

  it("shows 599 registered and 0 workers consistently in /v1/agents, /v1/roles and /v1/cockpit", async () => {
    const app = mk();
    expect((await app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: {name: "wfr03", environmentId: "dev"}})).statusCode).toBe(201);
    const agents = (await get(app, "/v1/agents")).json();
    const list = (await get(app, "/v1/roles")).json();
    const cockpit = (await get(app, "/v1/cockpit")).json();
    expect(agents.registeredRoles).toBe(599);
    expect(list.registeredRoles).toBe(599);
    expect(list.total).toBe(599);
    expect(cockpit.workforce.targetRoles).toBe(599);
    expect(agents.activeWorkerRuns).toBe(0);
    expect(cockpit.workforce.activeWorkerRuns).toBe(0);
    expect(agents.certified).toBe(0);
    expect(agents.legacyRoles).toBe(363);
    expect(cockpit.workforce.registeredRoles).toBe(agents.legacyRoles);
    expect(Object.keys(cockpit.workforce).sort()).toEqual(["activeWorkerRuns", "registeredRoles", "source", "state", "targetRoles"]);
    // backward compatible legacy payload
    expect(agents.count).toBe(363);
    expect(agents.agents.length).toBe(363);
    expect(agents.schemaVersion).toBeDefined();
    expect(agents.roleRegistry).toEqual(expect.objectContaining({path: "registries/role-definitions.json", status: "CANONICAL_ROLE_REGISTRY_TARGET_NOT_RUNTIME", legacyAuthority: "LEGACY_REFERENCE_ONLY"}));
    await app.close();
  });
  it("requires the control token", async () => {
    const app = mk();
    expect((await app.inject({method: "GET", url: "/v1/roles", headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
    expect((await app.inject({method: "GET", url: "/v1/roles/UASCO-0001", headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
    await app.close();
  });
  it("paginates all 599 roles in stable roleId order with limit <= 100", async () => {
    const app = mk();
    const seen: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const j: any = (await get(app, `/v1/roles?limit=100${cursor ? `&cursor=${cursor}` : ""}`)).json();
      expect(j.items.length).toBeLessThanOrEqual(100);
      seen.push(...j.items.map((x: {roleId: string}) => x.roleId));
      cursor = j.nextCursor; pages++;
    } while (cursor && pages < 20);
    expect(pages).toBe(6);
    expect(seen).toEqual(roles.map((r) => r.roleId));
    const first = (await get(app, "/v1/roles")).json();
    expect(first.limit).toBe(50);
    expect(first.items.length).toBe(50);
    expect(first.nextCursor).toBe("UASCO-0050");
    expect(first.items[0]).toEqual(expect.objectContaining({roleId: "UASCO-0001", runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED", certifiedScope: null}));
    for (const bad of ["limit=101", "limit=0", "limit=abc", "limit=-1", "cursor=x", "guildId=G1", "clusterId=C1", "guildId=G01&guildId=G02", `q=${"a".repeat(201)}`])
      expect((await get(app, `/v1/roles?${bad}`)).statusCode, bad).toBe(400);
    await app.close();
  });
  it("filters by guildId, clusterId and q", async () => {
    const app = mk();
    const g = reg.guilds[0];
    const byGuild = (await get(app, `/v1/roles?guildId=${g.guildId}&limit=100`)).json();
    expect(byGuild.total).toBe(g.roleCount);
    expect(byGuild.items.every((x: {guildId: string}) => x.guildId === g.guildId)).toBe(true);
    const byCluster = (await get(app, "/v1/roles?clusterId=CL07&limit=100")).json();
    expect(byCluster.total).toBe(roles.filter((r) => r.clusterId === "CL07").length);
    expect(byCluster.items.every((x: {clusterId: string}) => x.clusterId === "CL07")).toBe(true);
    const q = (await get(app, "/v1/roles?q=kill%20switch")).json();
    expect(q.items.map((x: {roleId: string}) => x.roleId)).toContain("UASCO-0594");
    expect((await get(app, "/v1/roles?guildId=G99")).json().total).toBe(0);
    const combined = (await get(app, `/v1/roles?guildId=${g.guildId}&clusterId=${g.clusterId === "CL01" ? "CL02" : "CL01"}`)).json();
    expect(combined.total).toBe(0);
    await app.close();
  });
  it("returns the full definition with legacy aliases and gaps for one role", async () => {
    const app = mk();
    const j = (await get(app, "/v1/roles/UASCO-0458")).json();
    expect(j.role.roleId).toBe("UASCO-0458");
    expect(j.role.evaluationSpecs.length).toBe(6);
    expect(j.legacyAliases.find((a: Alias) => a.legacyId === "221")).toEqual(expect.objectContaining({status: "REJECTED", approval: "PROPOSED"}));
    expect(j.gaps.role).toContain("WFR-GAP-SKILLS-UASCO-0458");
    expect(j.gaps.guild).toContain(`WFR-GAP-GUILD-OWNER-${j.role.guildId}`);
    expect(j.guild.guildId).toBe(j.role.guildId);
    expect(j.cluster.clusterId).toBe(j.role.clusterId);
    expect(j.notice).toBe("599 REGISTERED ≠ certified ≠ running");
    expect((await get(app, "/v1/roles/UASCO-9999")).statusCode).toBe(404);
    expect((await get(app, "/v1/roles/abc")).statusCode).toBe(400);
    await app.close();
  });
  it("returns 503 instead of invented counts when the registry is missing", async () => {
    const repo = path.join(tmp, "empty-repo"), runtime = path.join(repo, ".ai", "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    const app = buildServer({controlToken: token, runtime, repoRoot: repo, port: 3210, logger: false});
    expect((await get(app, "/v1/roles")).statusCode).toBe(503);
    expect((await get(app, "/v1/roles/UASCO-0001")).statusCode).toBe(503);
    await app.close();
  });
});
