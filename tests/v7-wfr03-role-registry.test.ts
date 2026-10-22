// //TR: Bu test WFR-03 tek kanonik 599 RoleDefinition kaydını doğrular: WFR-AT-001 (599/51, benzersiz kimlik, başlık/kaynak izi), WFR-AT-002 (bilinen kötü eşleme asla SEMANTIC_VERIFIED değil, eksik legacy UNMAPPED/MISSING_SOURCE), WFR-AT-004 (/v1/agents, /v1/roles, /v1/cockpit 599 kayıtlı ve 0 worker'ı tutarlı gösterir), WFR-AT-012 (3594 NOT_EXECUTED spec yeşil sayılamaz), validator negatif fixture'ları, API sayfalama/filtreleri ve legacy agents.json bayt kimliği.
import {describe, it, expect, beforeAll, afterAll, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {buildServer} from "../apps/control-api/src/server.js";
import Fastify from "fastify";
import {FIRST_DELIVERY_BINDINGS, STAGE_CONSUMERS} from "../core/agents/first-delivery-bindings.js";
import {computeRoleStatusSummary, createEvidenceVerifier, runningRoleIdsFromRuns, roleLifecycle, TARGET_ROLE_COUNT} from "../core/agents/role-lifecycle.js";
import {registerRoleStatusRoutes} from "../apps/control-api/src/routes/role-status.js";
import {deriveRoleProfiles, buildDerivationInputs, NEVER_GRANTED, ROUTE_TOOL_ALLOWLIST, PERMISSION_READ, PERMISSION_WRITE_SCRATCH} from "../core/agents/role-profile-derivation.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

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
// //TR: Ayrı kök: legacy kayıt, otorite dosyası ve WFR-02 kanıtı kopyalanır; kanıt fixture'ları depoyu kirletmeden bu kökte üretilir.
const mkRoot = (name: string) => {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, "registries", "sources"), {recursive: true});
  fs.copyFileSync(AGENTS_FILE, path.join(root, "registries", "agents.json"));
  fs.copyFileSync(path.join(REPO, "registries", "registry-authority-v2.json"), path.join(root, "registries", "registry-authority-v2.json"));
  fs.cpSync(WFR02, path.join(root, "registries", "sources", "wfr02"), {recursive: true});
  return root;
};
const withFixtureAt = (root: string, mutate: (d: any) => void) => {
  const d = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  mutate(d);
  const f = path.join(tmp, `registry-fixture-${++fixtureN}.json`);
  fs.writeFileSync(f, JSON.stringify(d));
  return runValidator(["--root", root, "--registry", f, "--scan-root", REPO]);
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
    expect(r.out).toContain("executed=0 certified=0 runtimeReadyOrRunning=0");
    expect(r.out).toContain("aliases=443 (bound to WFR-02, SHA256SUMS verified)");
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
    // computed counts, not hardcoded: one executed spec is reported and is a hard FA-WFR-03 failure
    expect(r.out).toContain("ROLE_REGISTRY_COUNTS (computed): executed=1 certified=0 runtimeReadyOrRunning=0");
    expect(r.out).toContain("FA_WFR03_EVALUATIONS_EXECUTED");
  });
});

// //TR: WFR03-C1-F1: depo dosyaları (README.md, package.json) veya kayıt dosyasının kendisi kanıt sayılamaz; FA-WFR-03 altında executed/certified/runtimeReady sıfır değişmezdir ve sayılar hesaplanarak raporlanır.
describe("WFR03-C1-F1 validator: no repo-file or self-referential evidence, FA-WFR-03 zero invariants, computed counts", () => {
  const claim = (d: any, evRefs: unknown[], roleRefs: unknown[], reviewer: unknown) => {
    const r = d.roles[0];
    Object.assign(r, {proficiencyStatus: "CERTIFIED", runtimeStatus: "RUNNING", certifiedScope: {scope: "fixture"}, lastVerifiedAt: "2026-10-15T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", evaluatorEvidenceRefs: roleRefs, reviewerEvidenceRef: reviewer});
    r.evaluationSpecs.forEach((e: any, k: number) => { e.status = "PASSED"; e.evaluatorEvidenceRef = evRefs[k]; });
    Object.assign(d.counts, {evaluationSpecsExecuted: 6, certified: 1, runtimeReady: 1});
  };
  const expectClaimRejected = (out: string) => {
    expect(out).toContain("ROLE_REGISTRY_COUNTS (computed): executed=6 certified=1 runtimeReadyOrRunning=1");
    expect(out).toContain("CLAIM_WITHOUT_CERTIFICATION_EVIDENCE: UASCO-0001");
    for (const k of ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06"]) expect(out).toContain(`FAKE_GREEN_EVALUATION: UASCO-0001 ${k}`);
    expect(out).toContain("FA_WFR03_EVALUATIONS_EXECUTED");
    expect(out).toContain("FA_WFR03_CERTIFIED");
    expect(out).toContain("FA_WFR03_RUNTIME_READY");
    expect(out).not.toContain("ROLE_REGISTRY_VALIDATION: PASS");
  };
  it("fixture A: README.md / package.json cited as evaluation, certification and reviewer evidence fails", () => {
    const r = withFixture((d) => claim(d, Array(6).fill("README.md"), ["package.json"], "README.md"));
    expect(r.status).toBe(2);
    expectClaimRejected(r.out);
    expect(r.out).toContain("EVIDENCE_REF_INVALID: UASCO-0001 package.json");
    expect(r.out).toContain("EVIDENCE_REF_INVALID: UASCO-0001 README.md");
  });
  it("fixture A3: the registry citing itself as evidence fails", () => {
    const self = "registries/role-definitions.json";
    const r = withFixture((d) => claim(d, Array(6).fill(self), [self, `${self}#roles[0]`], self));
    expect(r.status).toBe(2);
    expectClaimRejected(r.out);
    expect(r.out).toContain(`EVIDENCE_REF_INVALID: UASCO-0001 ${self}`);
  });

  // //TR: Gelecek yolu: kanıt yalnız audit/evidence/role-evaluations/<roleId>/<evaluationId>.json#sha256=<hex> olabilir; biçimce geçerli kanıt bile FA-WFR-03 sıfır değişmezlerini aşamaz.
  const writeEvidence = (root: string, roleId: string, evaluationId: string, verdict: string, record: Record<string, unknown> = {}) => {
    const rel = `audit/evidence/role-evaluations/${roleId}`, dir = path.join(root, rel);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, `${evaluationId}.artifact.txt`), `fixture artifact ${roleId} ${evaluationId}\n`);
    const rec = Buffer.from(JSON.stringify({roleId, evaluationId, verdict, artifactPath: `${rel}/${evaluationId}.artifact.txt`, artifactSha256: sha(fs.readFileSync(path.join(dir, `${evaluationId}.artifact.txt`))), ...record}));
    fs.writeFileSync(path.join(dir, `${evaluationId}.json`), rec);
    return `${rel}/${evaluationId}.json#sha256=${sha(rec)}`;
  };
  it("accepts well-formed pinned evidence under the evidence root, but the FA-WFR-03 invariants still fail the claim", () => {
    const root = mkRoot("evidence-ok");
    const evs = ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06"].map((k) => writeEvidence(root, "UASCO-0001", k, "PASSED"));
    const rev = writeEvidence(root, "UASCO-0001", "REVIEWER", "APPROVED");
    const r = withFixtureAt(root, (d) => claim(d, evs, [evs[0]], rev));
    expect(r.status).toBe(2);
    expect(r.out).not.toContain("FAKE_GREEN_EVALUATION");
    expect(r.out).not.toContain("EVIDENCE_REF_INVALID");
    expect(r.out).not.toContain("CLAIM_WITHOUT_CERTIFICATION_EVIDENCE");
    expect(r.out).toContain("ROLE_REGISTRY_COUNTS (computed): executed=6 certified=1 runtimeReadyOrRunning=1");
    expect(r.out).toContain("FA_WFR03_EVALUATIONS_EXECUTED");
    expect(r.out).toContain("FA_WFR03_CERTIFIED");
    expect(r.out).toContain("FA_WFR03_RUNTIME_READY");
  });
  it("rejects evidence with a wrong pinned sha256, another role, a mismatched verdict, a forged roleId, or an artifact outside the role directory", () => {
    const root = mkRoot("evidence-bad");
    const good = writeEvidence(root, "UASCO-0001", "EV-01", "PASSED");
    const wrongSha = good.replace(/#sha256=[0-9a-f]{64}$/, `#sha256=${"0".repeat(64)}`);
    const otherRole = writeEvidence(root, "UASCO-0002", "EV-02", "PASSED");
    const wrongVerdict = writeEvidence(root, "UASCO-0001", "EV-03", "FAILED");
    const outside = writeEvidence(root, "UASCO-0001", "EV-04", "PASSED", {artifactPath: "registries/agents.json", artifactSha256: LEGACY_SHA});
    const forgedRole = writeEvidence(root, "UASCO-0001", "EV-05", "PASSED", {roleId: "UASCO-0009"});
    const r = withFixtureAt(root, (d) => {
      const e = d.roles[0].evaluationSpecs;
      [wrongSha, otherRole, wrongVerdict, outside, forgedRole].forEach((ref, k) => { e[k].status = "PASSED"; e[k].evaluatorEvidenceRef = ref; });
      d.counts.evaluationSpecsExecuted = 5;
    });
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/FAKE_GREEN_EVALUATION: UASCO-0001 EV-01 .*sha256 does not match the pinned value/);
    expect(r.out).toMatch(/FAKE_GREEN_EVALUATION: UASCO-0001 EV-02 .*names role UASCO-0002/);
    expect(r.out).toMatch(/FAKE_GREEN_EVALUATION: UASCO-0001 EV-03 .*content does not name/);
    expect(r.out).toMatch(/FAKE_GREEN_EVALUATION: UASCO-0001 EV-04 .*artifactPath must be another file in the same role evidence directory/);
    expect(r.out).toMatch(/FAKE_GREEN_EVALUATION: UASCO-0001 EV-05 .*content does not name/);
    expect(r.out).toContain("ROLE_REGISTRY_COUNTS (computed): executed=5 certified=0 runtimeReadyOrRunning=0");
  });
});

// //TR: WFR03-C1-F2: takma adlar WFR-02 kanıtından birebir yeniden türetilir; durum sahteciliği, takas, CONFLICT/REJECTED'in doğrulanmışa çevrilmesi ve WFR-02 dışı kanıt referansı reddedilir.
describe("WFR03-C1-F2 validator binds legacy aliases to the cited WFR-02 evidence", () => {
  const bump = (d: any, from: string, to: string) => { d.counts.legacyAliases.byStatus[from]--; d.counts.legacyAliases.byStatus[to]++; };
  const roleOf = (d: any, roleId: string) => d.roles.find((r: Role) => r.roleId === roleId);
  it("rejects a forged SUSPECTED -> SEMANTIC_VERIFIED status (counts kept consistent)", () => {
    const r = withFixture((d) => { const a = roleOf(d, "UASCO-0001").legacyAliases.find((x: Alias) => x.legacyId === "001"); expect(a.status).toBe("SUSPECTED"); a.status = "SEMANTIC_VERIFIED"; bump(d, "SUSPECTED", "SEMANTIC_VERIFIED"); });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_NOT_BOUND_TO_WFR02: UASCO-0001.legacyAliases not derivable from WFR-02");
    expect(r.out).not.toContain("COUNTS_ALIASES");
  });
  it("rejects promoting the REJECTED heuristic pair 337 Sales Operations -> UASCO-0568 SEO to verified", () => {
    const r = withFixture((d) => {
      const a = roleOf(d, "UASCO-0568").legacyAliases.find((x: Alias) => x.legacyId === "337"); expect(a.status).toBe("REJECTED");
      a.status = "SEMANTIC_VERIFIED"; a.evidenceRef = "registries/sources/wfr02/chunk-3-verified.json#entries[legacyId=337]"; bump(d, "REJECTED", "SEMANTIC_VERIFIED");
      d.legacyUnmapped = d.legacyUnmapped.filter((u: {legacyId: string}) => u.legacyId !== "337"); d.counts.legacyUnmapped = d.legacyUnmapped.length;
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_NOT_BOUND_TO_WFR02: UASCO-0568.legacyAliases");
    expect(r.out).toContain("UNMAPPED_NOT_BOUND_TO_WFR02: legacyUnmapped missing WFR-02 record");
  });
  it("rejects resolving a CONFLICT row into a verified alias", () => {
    const r = withFixture((d) => {
      const u = d.legacyUnmapped.find((x: {legacyId: string}) => x.legacyId === "003"); expect(u.status).toBe("CONFLICT");
      const [keep, ...drop] = u.conflictCandidates as string[];
      roleOf(d, keep).legacyAliases.find((x: Alias) => x.legacyId === "003").status = "SEMANTIC_VERIFIED"; bump(d, "CONFLICT", "SEMANTIC_VERIFIED");
      for (const id of drop) { const r0 = roleOf(d, id); r0.legacyAliases = r0.legacyAliases.filter((x: Alias) => x.legacyId !== "003"); d.counts.legacyAliases.byStatus.CONFLICT--; d.counts.legacyAliases.total--; }
      d.legacyUnmapped = d.legacyUnmapped.filter((x: {legacyId: string}) => x.legacyId !== "003"); d.counts.legacyUnmapped = d.legacyUnmapped.length;
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_NOT_BOUND_TO_WFR02: UASCO-0003.legacyAliases");
    expect(r.out).toContain("UNMAPPED_NOT_BOUND_TO_WFR02");
  });
  it("rejects swapping a SEMANTIC_VERIFIED and a SUSPECTED status between two aliases (counts unchanged)", () => {
    const r = withFixture((d) => {
      const all = d.roles.flatMap((x: Role) => x.legacyAliases);
      const v = all.find((a: Alias) => a.status === "SEMANTIC_VERIFIED"), s2 = all.find((a: Alias) => a.status === "SUSPECTED");
      [v.status, s2.status] = [s2.status, v.status];
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_NOT_BOUND_TO_WFR02");
    expect(r.out).not.toContain("COUNTS_ALIASES");
  });
  it("rejects an alias or legacyUnmapped evidenceRef pointing to package.json", () => {
    const r = withFixture((d) => { roleOf(d, "UASCO-0001").legacyAliases[0].evidenceRef = "package.json"; d.legacyUnmapped[0].evidenceRef = "package.json"; });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_EVIDENCE: UASCO-0001 001 package.json");
    expect(r.out).toContain("ALIAS_NOT_BOUND_TO_WFR02: UASCO-0001.legacyAliases");
    expect(r.out).toContain(`UNMAPPED_EVIDENCE: ${reg.legacyUnmapped[0].legacyId} package.json`);
  });
  it("rejects an alias evidenceRef pointing to another legacy id's WFR-02 entry", () => {
    const r = withFixture((d) => { roleOf(d, "UASCO-0001").legacyAliases[0].evidenceRef = "registries/sources/wfr02/chunk-1-verified.json#entries[legacyId=002]"; });
    expect(r.status).toBe(2);
    expect(r.out).toContain("ALIAS_EVIDENCE: UASCO-0001 001");
  });
  it("rejects tampered WFR-02 evidence and a re-generated SHA256SUMS", () => {
    const root = mkRoot("wfr02-tamper");
    const c1 = path.join(root, "registries", "sources", "wfr02", "chunk-1-verified.json");
    const text = fs.readFileSync(c1, "utf8");
    fs.writeFileSync(c1, text.replace('"finalStatus": "SUSPECTED"', '"finalStatus": "SEMANTIC_VERIFIED"'));
    expect(fs.readFileSync(c1, "utf8")).not.toBe(text);
    let r = runValidator(["--root", root, "--registry", REG_FILE, "--scan-root", REPO]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("WFR02_SHA256_MISMATCH: chunk-1-verified.json");
    expect(r.out).toContain("ALIAS_BINDING_NOT_EVALUATED");
    // the forger also rewrites SHA256SUMS to match: the pinned SHA256SUMS hash rejects it
    const ls = fs.readFileSync(c1, "utf8").split("\n");
    const sumsFile = path.join(root, "registries", "sources", "wfr02", "SHA256SUMS");
    fs.writeFileSync(sumsFile, fs.readFileSync(sumsFile, "utf8").replace(/^[0-9a-f]{64}(?= \*chunk-1-verified\.json)/m, sha([ls[0], ...ls.slice(2)].join("\n"))));
    r = runValidator(["--root", root, "--registry", REG_FILE, "--scan-root", REPO]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("WFR02_SHA256SUMS_CHANGED");
    expect(r.out).not.toContain("WFR02_SHA256_MISMATCH");
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
    expect(Object.keys(cockpit.workforce).sort()).toEqual(["activeWorkerRuns", "canonicalRegisteredRoles", "registeredRoles", "registeredRolesAuthority", "source", "state", "targetRoles"]);
    // WFR03-C1-F3: the legacy count is labelled, and the canonical count equals /v1/agents.registeredRoles
    expect(cockpit.workforce.registeredRolesAuthority).toBe("LEGACY_REFERENCE_ONLY");
    expect(cockpit.workforce.canonicalRegisteredRoles).toBe(599);
    expect(cockpit.workforce.canonicalRegisteredRoles).toBe(agents.registeredRoles);
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

// //TR: LANE-C C1: rol yaşam döngüsü YALNIZ kanıttan hesaplanır; beş sayaç bağımsızdır; FAKE/bozuk/eksik kanıt TESTED/CERTIFIED saymaz.
describe("LANE-C C1 role lifecycle computed only from evidence", () => {
  const NOW = new Date("2026-10-22T12:00:00.000Z");
  const doc = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
  const real = createEvidenceVerifier(REPO);
  const base = (over: Partial<Parameters<typeof computeRoleStatusSummary>[0]> = {}) => computeRoleStatusSummary({
    roles: doc.roles, guildIds: doc.guilds.map((g: any) => g.guildId), roleDefinitionsSha256: sha(fs.readFileSync(REG_FILE)),
    bindings: FIRST_DELIVERY_BINDINGS, verify: real, runs: [], now: NOW, ...over
  });

  it("real registry today: 599 registered, only bound+consumed production roles implemented, 0 tested/certified/running; guild rows add up", () => {
    const sum = base();
    expect(sum).toMatchObject({target: 599, registered: 599, implemented: 3, tested: 0, certified: 0, running: 0, computedAt: NOW.toISOString()});
    expect(TARGET_ROLE_COUNT).toBe(599);
    expect(sum.basis).toEqual({roleDefinitionsSha256: sha(fs.readFileSync(REG_FILE)), bindingsCount: FIRST_DELIVERY_BINDINGS.length});
    expect(sum.byGuild).toHaveLength(51);
    expect(sum.byGuild.map(g => g.guildId)).toEqual([...sum.byGuild.map(g => g.guildId)].sort());
    for (const k of ["registered", "implemented", "tested", "certified", "running"] as const) expect(sum.byGuild.reduce((a, g) => a + g[k], 0)).toBe(sum[k]);
    // implemented roles are exactly those whose binding function a stage consumes: IMPLEMENT => developer UASCO-0085 + tester UASCO-0313, REVIEW => security-reviewer UASCO-0252 (runner gate)
    const impl = doc.roles.filter((r: any) => roleLifecycle(r, doc.roles, {bindings: FIRST_DELIVERY_BINDINGS, verify: real, runningRoleIds: new Set(), nowMs: NOW.getTime()}).implemented).map((r: any) => r.roleId).sort();
    expect(impl).toEqual(["UASCO-0085", "UASCO-0252", "UASCO-0313"]);
    expect(STAGE_CONSUMERS).toEqual({IMPLEMENT: ["developer", "tester"], REVIEW: ["security-reviewer"]});
    for (const fn of Object.values(STAGE_CONSUMERS).flat()) expect(FIRST_DELIVERY_BINDINGS.some(b => b.function === fn)).toBe(true);
  });

  it("implemented requires a complete binding: an unsafe/incomplete binding never counts", () => {
    const dev = FIRST_DELIVERY_BINDINGS.find(b => b.function === "developer")!;
    const broken = FIRST_DELIVERY_BINDINGS.map(b => b === dev ? {...b, allowedTools: [...b.allowedTools, "Bash"]} : b);
    expect(base({bindings: broken}).implemented).toBe(2); // tester + security-reviewer remain
    expect(base({bindings: []}).implemented).toBe(0);
  });

  describe("tested / certified need verified, non-FAKE evidence", () => {
    let tmp = "";
    beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-c1-")); });
    afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });
    const ROLE = "UASCO-0085";
    // writes an evidence file + artifact in the tmp repo root; returns the pinned ref
    const evidence = (root: string, evalId: string, verdict: string, extra: Record<string, unknown> = {}, corrupt = false) => {
      const dir = path.join(root, "audit", "evidence", "role-evaluations", ROLE); fs.mkdirSync(dir, {recursive: true});
      const artifactRel = `audit/evidence/role-evaluations/${ROLE}/${evalId}.artifact.txt`, art = Buffer.from(`artifact ${evalId}`);
      fs.writeFileSync(path.join(root, artifactRel), art);
      const body = Buffer.from(JSON.stringify({roleId: ROLE, evaluationId: evalId, verdict, artifactPath: artifactRel, artifactSha256: corrupt ? "0".repeat(64) : sha(art), ...extra}));
      const file = `audit/evidence/role-evaluations/${ROLE}/${evalId}.json`; fs.writeFileSync(path.join(root, file), body);
      return `${file}#sha256=${sha(body)}`;
    };
    const roleWith = (specs: any[], over: Record<string, unknown> = {}) => ({...doc.roles.find((r: any) => r.roleId === ROLE), evaluationSpecs: specs, ...over});
    const spec = (id: string, status: string, ref: string | null) => ({evaluationId: id, status, evaluatorEvidenceRef: ref, kind: "X", specRef: "x"});
    const sumFor = (root: string, role: any) => computeRoleStatusSummary({roles: [role], guildIds: [role.guildId], roleDefinitionsSha256: "0".repeat(64), bindings: FIRST_DELIVERY_BINDINGS, verify: createEvidenceVerifier(root), runs: [], now: NOW});
    const ids = ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06"];

    it("NOT_EXECUTED, missing, tampered, wrong-verdict and FAKE evidence never count; one verified spec = TESTED but not CERTIFIED", () => {
      const root = fs.mkdtempSync(path.join(tmp, "r-"));
      const good = evidence(root, "EV-01", "PASSED");
      expect(sumFor(root, roleWith(ids.map(i => spec(i, "NOT_EXECUTED", null)))).tested).toBe(0);
      expect(sumFor(root, roleWith([spec("EV-01", "PASSED", null)])).tested).toBe(0);               // claims PASSED without evidence
      expect(sumFor(root, roleWith([spec("EV-01", "PASSED", good.replace(/sha256=.*/, "sha256=" + "a".repeat(64)))])).tested).toBe(0); // hash mismatch
      expect(sumFor(root, roleWith([spec("EV-01", "FAILED", good)])).tested).toBe(0);              // verdict in file is PASSED, spec says FAILED
      const fake = evidence(root, "EV-02", "PASSED", {executorKind: "FAKE"});
      expect(sumFor(root, roleWith([spec("EV-02", "PASSED", fake)])).tested).toBe(0);              // FAKE executor evidence
      const badArt = evidence(root, "EV-03", "PASSED", {}, true);
      expect(sumFor(root, roleWith([spec("EV-03", "PASSED", badArt)])).tested).toBe(0);            // artifact hash mismatch
      expect(sumFor(root, roleWith([spec("EV-01", "PASSED", good), ...ids.slice(1).map(i => spec(i, "NOT_EXECUTED", null))]))).toMatchObject({tested: 1, certified: 0});
    });

    it("CERTIFIED needs CERTIFIED status + scope + 6 verified PASSED + APPROVED reviewer evidence + unexpired; any missing piece blocks it", () => {
      const root = fs.mkdtempSync(path.join(tmp, "c-"));
      const refs = ids.map(i => evidence(root, i, "PASSED"));
      const reviewer = evidence(root, "REVIEWER", "APPROVED");
      const specs = ids.map((i, k) => spec(i, "PASSED", refs[k]));
      const full = {proficiencyStatus: "CERTIFIED", certifiedScope: {scope: "x"}, evaluatorEvidenceRefs: refs, reviewerEvidenceRef: reviewer, expiresAt: "2027-01-01T00:00:00.000Z"};
      expect(sumFor(root, roleWith(specs, full))).toMatchObject({tested: 1, certified: 1});
      expect(sumFor(root, roleWith(specs, {...full, expiresAt: "2026-01-01T00:00:00.000Z"})).certified).toBe(0);        // expired
      expect(sumFor(root, roleWith(specs, {...full, reviewerEvidenceRef: null})).certified).toBe(0);                    // no independent reviewer
      expect(sumFor(root, roleWith(specs, {...full, certifiedScope: null})).certified).toBe(0);
      expect(sumFor(root, roleWith(specs, {...full, proficiencyStatus: "NOT_EVALUATED"})).certified).toBe(0);           // status alone/evidence alone is not enough
      expect(sumFor(root, roleWith([...specs.slice(0, 5), spec("EV-06", "NOT_EXECUTED", null)], full)).certified).toBe(0); // 5/6
      expect(sumFor(root, roleWith(specs, {...full, proficiencyStatus: "CERTIFIED"})).certified).toBe(1);
    });
  });

  it("running = AGENT_TRACE in an open (non-terminal) run for a registered role; terminal runs, unknown roles and other evidence do not count", () => {
    const known = new Set<string>(doc.roles.map((r: any) => r.roleId));
    const trace = (note: string, kind = "AGENT_TRACE") => ({kind, note, evidenceId: "e", step: "IMPLEMENT", cycle: 0, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null} as any);
    const run = (status: string, ...ev: any[]) => ({status, evidence: ev} as any);
    const runs = [
      run("AWAITING_APPROVAL", trace("agent=a1 role=UASCO-0085 state=COMPLETED")),
      run("RUNNING", trace("agent=a2 role=UASCO-0252 state=COMPLETED verdict=CLEAN")),
      run("BLOCKED", trace("agent=a3 role=UASCO-0313 state=FAILED")),          // terminal
      run("SUCCEEDED", trace("agent=a4 role=UASCO-0019 state=COMPLETED")),     // terminal
      run("RUNNING", trace("agent=a5 role=UASCO-9999 state=COMPLETED")),       // unknown role
      run("RUNNING", trace("agent=a6 role=UASCO-0043 state=COMPLETED", "IMPLEMENT")), // not an AGENT_TRACE
      run("RUNNING")
    ];
    expect([...runningRoleIdsFromRuns(runs, known)].sort()).toEqual(["UASCO-0085", "UASCO-0252"]);
    const sum = base({runs});
    expect(sum.running).toBe(2);
    expect(sum).toMatchObject({implemented: 3, tested: 0, certified: 0}); // running does not promote anything else
  });

  it("GET /v1/roles/status-summary serves exactly the agreed shape from evidence, honest 503 without the registry, no mutation", async () => {
    const deps = (root: string) => ({repoRoot: root, now: () => NOW, getStore: () => ({hasJournal: false, listRuns: () => []}) as any, scope: {tenantId: "t"} as any, orgId: "o", actor: "a", audit: () => {}, workosStopped: () => false, workosPolicy: () => ({allowed: true}), workosFail: (reply: any) => reply.code(500).send({error: "X"})});
    const app = Fastify(); registerRoleStatusRoutes(app, deps(REPO)); await app.ready();
    const r = await app.inject({method: "GET", url: "/v1/roles/status-summary"});
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Object.keys(body)).toEqual(["statusSummary"]);
    expect(Object.keys(body.statusSummary).sort()).toEqual(["basis", "byGuild", "certified", "computedAt", "implemented", "registered", "running", "target", "tested"]);
    expect(body.statusSummary).toMatchObject({target: 599, registered: 599, implemented: 3, tested: 0, certified: 0, running: 0});
    expect(Object.keys(body.statusSummary.byGuild[0]).sort()).toEqual(["certified", "guildId", "implemented", "registered", "running", "tested"]);
    expect(Object.keys(body.statusSummary.basis).sort()).toEqual(["bindingsCount", "roleDefinitionsSha256"]);
    expect((await app.inject({method: "POST", url: "/v1/roles/status-summary"})).statusCode).toBe(404);
    await app.close();
    const empty = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-c1-empty-"));
    try { const a2 = Fastify(); registerRoleStatusRoutes(a2, deps(empty)); await a2.ready(); expect((await a2.inject({method: "GET", url: "/v1/roles/status-summary"})).statusCode).toBe(503); await a2.close(); } finally { fs.rmSync(empty, {recursive: true, force: true}); }
  });
});

// //TR: LANE-C C2: yürütme profili ÖNERİLERİ (PROPOSED_DERIVED) deterministik üretilir, en az yetkilidir, kaynak yoksa gap kimliği yazar; hiçbir şey yürütülebilir/certified yapmaz.
describe("LANE-C C2 role execution profiles (derived, proposal only)", () => {
  const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO, f), "utf8"));
  const PROFILES_FILE = path.join(REPO, "registries", "role-execution-profiles.json");
  const inputsOf = () => buildDerivationInputs({
    roleDefinitions: rd("registries/role-definitions.json"), skills: rd("registries/skills-v2.json"), technologies: rd("registries/technologies.json"), competency: rd("registries/agent-competency-v2.json"),
    skillMatrix: rd("registries/agent-skill-matrix.json"), toolPolicy: rd("registries/agent-tool-policy-v2.json"), reviewGraph: rd("registries/agent-review-graph-v2.json"),
    evaluationFileNames: fs.readdirSync(path.join(REPO, "evaluations", "agents")).filter(n => n.endsWith(".json")).sort()
  });
  const committed = rd("registries/role-execution-profiles.json");
  const registryIds: string[] = rd("registries/role-definitions.json").roles.map((r: any) => r.roleId);

  it("the committed file is a byte-identical rebuild (script --check), 599 profiles, status PROPOSED_DERIVED_NOT_RUNTIME", () => {
    const r = cp.spawnSync(process.execPath, ["scripts/build-role-execution-profiles.mjs", "--check"], {cwd: REPO, encoding: "utf8"});
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("byte-identical rebuild");
    expect(committed.status).toBe("PROPOSED_DERIVED_NOT_RUNTIME");
    expect(committed.profiles).toHaveLength(599);
    expect(committed.profiles.map((p: any) => p.roleId)).toEqual([...registryIds].sort());
    expect(committed.neverGranted).toEqual([...NEVER_GRANTED]);
    expect(committed.inputs["registries/role-definitions.json"]).toBe(crypto.createHash("sha256").update(fs.readFileSync(REG_FILE)).digest("hex"));
  });

  it("every field is PROPOSED_DERIVED; every empty field has a gap id; every non-empty field has provenance; nothing claims execution or certification", () => {
    const FIELDS = ["route", "allowedTools", "candidateToolAdapterIds", "candidateSkills", "workerScope", "permissionGrants", "reviewChain", "limits", "knowledgeSources", "evaluationRefs"];
    for (const p of committed.profiles) {
      expect(Object.keys(p).sort()).toEqual([...FIELDS, "bound", "clusterId", "guildId", "roleId", "semanticVerifiedLegacyIds", "title"].sort());
      for (const f of FIELDS) {
        const x = p[f];
        expect(x.status, `${p.roleId}.${f}`).toBe("PROPOSED_DERIVED");
        const empty = Array.isArray(x.value) ? x.value.length === 0 : x.value == null;
        if (empty && f !== "allowedTools" && f !== "workerScope" && f !== "permissionGrants") expect(x.gapId, `${p.roleId}.${f} empty without gap id`).toMatch(/^WFR-GAP-[A-Z-]+-UASCO-\d{4}$/);
        if (!empty) expect(x.provenance.length, `${p.roleId}.${f} has no provenance`).toBeGreaterThan(0);
      }
    }
    expect(JSON.stringify(committed)).not.toMatch(/"(EXECUTABLE|CERTIFIED|RUNNING|READY)"/);
  });

  it("least privilege: tools subset of the route allow-list, grants match tools, never a production/network/secret/payment/deployment grant", () => {
    const allowedGrants = new Set([PERMISSION_READ, PERMISSION_WRITE_SCRATCH]);
    for (const p of committed.profiles) {
      const route = p.route.value as keyof typeof ROUTE_TOOL_ALLOWLIST;
      expect(Object.keys(ROUTE_TOOL_ALLOWLIST)).toContain(route);
      for (const t of p.allowedTools.value) expect(ROUTE_TOOL_ALLOWLIST[route], `${p.roleId} tool ${t}`).toContain(t);
      for (const g of p.permissionGrants.value) { expect(allowedGrants.has(g), `${p.roleId} grant ${g}`).toBe(true); for (const bad of NEVER_GRANTED) expect(g).not.toContain(bad); }
      expect(p.permissionGrants.value.includes(PERMISSION_WRITE_SCRATCH)).toBe(p.allowedTools.value.some((t: string) => t === "Edit" || t === "Write"));
      if (p.route.value === "CLAUDE_REVIEWER") expect(p.limits.value.maxFilesWritten).toBe(0);
    }
  });

  it("review chain: reviewer is never the role itself and always a registered role", () => {
    const ids = new Set(registryIds);
    for (const p of committed.profiles) {
      expect(p.reviewChain.value.length).toBeGreaterThan(0);
      for (const r of p.reviewChain.value) { expect(r).not.toBe(p.roleId); expect(ids.has(r), `${p.roleId} -> ${r}`).toBe(true); }
    }
  });

  it("bound first-delivery roles carry exactly their binding (route, tools, limits); only SEMANTIC_VERIFIED legacy evidence feeds candidates", () => {
    for (const b of FIRST_DELIVERY_BINDINGS) {
      const p = committed.profiles.find((x: any) => x.roleId === b.roleId);
      expect(p.bound).toBe(true);
      expect(p.route.value).toBe(b.providerRoute);
      expect(p.allowedTools.value).toEqual([...b.allowedTools]);
      expect(p.limits.value).toEqual(b.limits);
    }
    expect(committed.profiles.filter((p: any) => p.bound)).toHaveLength(FIRST_DELIVERY_BINDINGS.length);
    const roles = rd("registries/role-definitions.json").roles;
    for (const p of committed.profiles) {
      const r = roles.find((x: any) => x.roleId === p.roleId);
      expect(p.semanticVerifiedLegacyIds).toEqual([...new Set(r.legacyAliases.filter((a: any) => a.status === "SEMANTIC_VERIFIED").map((a: any) => a.legacyId))].sort());
      if (p.semanticVerifiedLegacyIds.length === 0) { expect(p.candidateSkills.value).toEqual([]); expect(p.candidateToolAdapterIds.value).toEqual([]); }
    }
  });

  it("derivation is deterministic and order-independent; duplicate roles are refused", () => {
    const inp = inputsOf();
    const a = JSON.stringify(deriveRoleProfiles(inp)), b = JSON.stringify(deriveRoleProfiles({...inp, roles: [...inp.roles].reverse()}));
    expect(a).toBe(b);
    expect(() => deriveRoleProfiles({...inp, roles: [inp.roles[0], inp.roles[0]]})).toThrow("PROFILE_DERIVATION_DUPLICATE_ROLE");
  });

  it("rules on synthetic inputs: write route only with SEMANTIC_VERIFIED technical evidence; CONFLICT/SUSPECTED aliases are ignored; self review dropped; skills limited to skills-v2", () => {
    const role = (roleId: string, aliases: any[]) => ({roleId, guildId: "G99", clusterId: "CL99", title: roleId, requiredTechnologies: [{technologyId: "nodejs"}], optionalTechnologies: [], evaluationSpecs: [{evaluationId: "EV-01", status: "NOT_EXECUTED"}], legacyAliases: aliases, gapIds: []});
    const inp = {
      roles: [role("UASCO-9001", [{legacyId: "L1", status: "SEMANTIC_VERIFIED"}]), role("UASCO-9002", [{legacyId: "L1", status: "CONFLICT"}]), role("UASCO-9003", [{legacyId: "L2", status: "SUSPECTED"}]), role("UASCO-9004", [])],
      skillIds: new Set(["SK2-A"]), technologySlugToId: new Map([["nodejs", "TECH-NODEJS"]]),
      legacy: {technicalAgent: new Map([["L1", true], ["L2", true]]), requiredSkills: new Map([["L1", ["SK2-A", "SK2-NOT-IN-CATALOG"]]]), candidateAdapters: new Map([["L1", ["eslint"]]]),
        principalReviewers: new Map([["L1", ["L1"]]]), evaluationFiles: new Set(["L1"])},
      bindings: []
    } as any;
    const [ok, conflict, suspected, none] = deriveRoleProfiles(inp);
    expect(ok.route.value).toBe("CLAUDE_IMPLEMENTER");
    expect(ok.allowedTools.value).toEqual([...ROUTE_TOOL_ALLOWLIST.CLAUDE_IMPLEMENTER]);
    expect(ok.permissionGrants.value).toEqual([PERMISSION_READ, PERMISSION_WRITE_SCRATCH].sort());
    expect(ok.candidateSkills.value).toEqual(["SK2-A"]);
    expect(ok.candidateToolAdapterIds.value).toEqual(["eslint"]);
    expect(ok.reviewChain.value).not.toContain("UASCO-9001");       // L1's only reviewer maps to the role itself -> dropped -> default independent reviewer
    expect(ok.reviewChain.gapId).toMatch(/^WFR-GAP-PROFILE-REVIEW-CHAIN-UASCO-9001$/);
    for (const x of [conflict, suspected, none]) {
      expect(x.route.value).toBe("CLAUDE_REVIEWER");
      expect(x.allowedTools.value).toEqual([...ROUTE_TOOL_ALLOWLIST.CLAUDE_REVIEWER]);
      expect(x.permissionGrants.value).toEqual([PERMISSION_READ]);
      expect(x.candidateSkills.value).toEqual([]);
      expect(x.candidateSkills.gapId).toBe(`WFR-GAP-PROFILE-SKILLS-${x.roleId}`);
      expect(x.knowledgeSources.value).toEqual(["registries/technologies.json#TECH-NODEJS"]);
    }
  });
});
