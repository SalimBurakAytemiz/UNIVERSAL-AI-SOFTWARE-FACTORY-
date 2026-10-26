// //TR: Bu test WFR-03 tek kanonik 599 RoleDefinition kaydını doğrular: WFR-AT-001 (599/51, benzersiz kimlik, başlık/kaynak izi), WFR-AT-002 (bilinen kötü eşleme asla SEMANTIC_VERIFIED değil, eksik legacy UNMAPPED/MISSING_SOURCE), WFR-AT-004 (/v1/agents, /v1/roles, /v1/cockpit 599 kayıtlı ve 0 worker'ı tutarlı gösterir), WFR-AT-012 (3594 NOT_EXECUTED spec yeşil sayılamaz), validator negatif fixture'ları, API sayfalama/filtreleri ve legacy agents.json bayt kimliği.
import {describe, it, expect, beforeAll, afterAll, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import vm from "node:vm";
import {buildServer} from "../apps/control-api/src/server.js";
import Fastify from "fastify";
import {FIRST_DELIVERY_BINDINGS, STAGE_CONSUMERS} from "../core/agents/first-delivery-bindings.js";
import {computeRoleStatusSummary, createEvidenceVerifier, runningRoleIdsFromRuns, roleLifecycle, TARGET_ROLE_COUNT} from "../core/agents/role-lifecycle.js";
import {registerRoleStatusRoutes} from "../apps/control-api/src/routes/role-status.js";
import {EvaluationStaging, EvaluationStagingError, EVALUATION_PROCEDURES, planFor, runRoleEvaluation, verdictOf} from "../core/competency/evaluation-pipeline.js";
import type {EvaluationOutcome} from "../core/competency/evaluation-pipeline.js";
import {GOLDEN_TESTS} from "../core/competency/evaluation-fixtures.js";
import {executeBlockers, parseArgs, resolveControlRoot, runCli} from "../core/competency/evaluation-cli.js";
import {MAX_TEST_SOURCE_BYTES, analyzeAddTest, tokenize, topLevelStatements} from "../core/competency/static-test-analysis.js";
import {FakeExecutors, reviewerArgv} from "../core/workos/executors.js";
import type {ExecutorPair, FakeScript, ProcResult} from "../core/workos/executors.js";
import {ClaudePreDevBuilder} from "../core/workos/predev/claude-builder.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import {deriveRoleProfiles, buildDerivationInputs, NEVER_GRANTED, ROUTE_TOOL_ALLOWLIST, PERMISSION_READ, PERMISSION_WRITE_SCRATCH} from "../core/agents/role-profile-derivation.js";
import {NO_REAL_WSL_ON_WIN32} from "./support/test-sandbox.js";
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
    return buildServer({...NO_REAL_WSL_ON_WIN32, controlToken: token, runtime, repoRoot: REPO, dataDir: path.join(runtime, "workos"), port: 3210, logger: false});
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
    const app = buildServer({...NO_REAL_WSL_ON_WIN32, controlToken: token, runtime, repoRoot: repo, port: 3210, logger: false});
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
    expect(sum).toMatchObject({target: 599, registered: 599, implemented: 8, tested: 0, certified: 0, running: 0, computedAt: NOW.toISOString()});
    expect(TARGET_ROLE_COUNT).toBe(599);
    expect(sum.basis).toEqual({roleDefinitionsSha256: sha(fs.readFileSync(REG_FILE)), bindingsCount: FIRST_DELIVERY_BINDINGS.length});
    expect(sum.byGuild).toHaveLength(51);
    expect(sum.byGuild.map(g => g.guildId)).toEqual([...sum.byGuild.map(g => g.guildId)].sort());
    for (const k of ["registered", "implemented", "tested", "certified", "running"] as const) expect(sum.byGuild.reduce((a, g) => a + g[k], 0)).toBe(sum[k]);
    // implemented roles are exactly those whose binding function a stage consumes: IMPLEMENT => developer UASCO-0085 + tester UASCO-0313, REVIEW => security-reviewer UASCO-0252 (runner gate), PREDEV_PRODUCE => the five pre-dev primaries (ClaudePreDevBuilder, POST /v1/missions/:id/predev/produce)
    const impl = doc.roles.filter((r: any) => roleLifecycle(r, doc.roles, {bindings: FIRST_DELIVERY_BINDINGS, verify: real, runningRoleIds: new Set(), nowMs: NOW.getTime()}).implemented).map((r: any) => r.roleId).sort();
    expect(impl).toEqual(["UASCO-0019", "UASCO-0022", "UASCO-0023", "UASCO-0031", "UASCO-0043", "UASCO-0085", "UASCO-0252", "UASCO-0313"]);
    // delivery 0232 (deterministic Studio, not a production model route) stays uncounted even though it is bound
    expect(impl).not.toContain("UASCO-0232");
    expect(STAGE_CONSUMERS).toEqual({IMPLEMENT: ["developer", "tester"], REVIEW: ["security-reviewer"], PREDEV_PRODUCE: ["business-analyst", "requirements-engineer", "planner", "architect", "ux-designer"]});
    for (const fn of Object.values(STAGE_CONSUMERS).flat()) expect(FIRST_DELIVERY_BINDINGS.some(b => b.function === fn)).toBe(true);
  });

  it("implemented requires a complete binding: an unsafe/incomplete binding never counts", () => {
    const dev = FIRST_DELIVERY_BINDINGS.find(b => b.function === "developer")!;
    const broken = FIRST_DELIVERY_BINDINGS.map(b => b === dev ? {...b, allowedTools: [...b.allowedTools, "Bash"]} : b);
    expect(base({bindings: broken}).implemented).toBe(7); // tester, security-reviewer and the five pre-dev primaries remain
    const ba = FIRST_DELIVERY_BINDINGS.find(b => b.function === "business-analyst")!;
    expect(base({bindings: FIRST_DELIVERY_BINDINGS.map(b => b === ba ? {...b, limits: {...b.limits, maxFilesWritten: 3}} : b)}).implemented).toBe(7); // a reviewer-route binding that may write files never counts
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
    expect(sum).toMatchObject({implemented: 8, tested: 0, certified: 0}); // running does not promote anything else
  });

  it("GET /v1/roles/status-summary serves exactly the agreed shape from evidence, honest 503 without the registry, no mutation", async () => {
    const deps = (root: string) => ({repoRoot: root, now: () => NOW, getStore: () => ({hasJournal: false, listRuns: () => []}) as any, scope: {tenantId: "t"} as any, orgId: "o", actor: "a", audit: () => {}, workosStopped: () => false, workosPolicy: () => ({allowed: true}), workosFail: (reply: any) => reply.code(500).send({error: "X"})});
    const app = Fastify(); registerRoleStatusRoutes(app, deps(REPO)); await app.ready();
    const r = await app.inject({method: "GET", url: "/v1/roles/status-summary"});
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Object.keys(body)).toEqual(["statusSummary"]);
    expect(Object.keys(body.statusSummary).sort()).toEqual(["basis", "byGuild", "certified", "computedAt", "implemented", "registered", "running", "target", "tested"]);
    expect(body.statusSummary).toMatchObject({target: 599, registered: 599, implemented: 8, tested: 0, certified: 0, running: 0});
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

// //TR: LANE-C C-EVAL-PIPELINE: değerlendirme hattı STAGING'e yazar, FAKE'i asla saydırmaz, altyapı sorunlarını sonuç saymaz ve depoya (audit/evidence, registries) dokunamaz. Gerçek claude çalışmaz; FAKE çiftler ve kayıtlı süreç çalıştırıcıları kullanılır.
describe("LANE-C C-EVAL-PIPELINE: governed role evaluation (staging only; FAKE and infrastructure never count)", () => {
  const DEV = "UASCO-0085", REVIEWER = "UASCO-0252", BA = "UASCO-0022", TESTER = "UASCO-0313";
  const bindingTools = (route: "CLAUDE_REVIEWER") => FIRST_DELIVERY_BINDINGS.find(b => b.providerRoute === route)!.allowedTools;
  const TESTER_GOOD = 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n';
  const workDir = () => fs.mkdtempSync(path.join(tmp, "eval-"));
  const script = (o: Partial<FakeScript> = {}): FakeScript => ({
    implement: () => ({files: {"greeting.txt": "hello\n"}}),
    review: n => (n === 1 ? {verdict: "CLEAN"} : {verdict: "BLOCKED", findings: [{severity: "HIGH", title: "command injection via unsanitised ref"}]}), ...o
  });
  const fakePair = (o: Partial<FakeScript> = {}): ExecutorPair => new FakeExecutors(script(o)).pair();
  const stagingOf = () => path.join(workDir(), "staging");
  const evaluate = (pair: ExecutorPair, role: string, extra: {stagingRoot?: string; timeoutMs?: number; shouldAbort?: () => boolean; bindings?: typeof FIRST_DELIVERY_BINDINGS} = {}): Promise<EvaluationOutcome> =>
    runRoleEvaluation({repoRoot: REPO, stagingRoot: extra.stagingRoot ?? stagingOf(), pair, ...(extra.timeoutMs ? {timeoutMs: extra.timeoutMs} : {}), ...(extra.shouldAbort ? {shouldAbort: extra.shouldAbort} : {}), ...(extra.bindings ? {bindings: extra.bindings} : {})}, role, "EV-01");
  const procResult = (argv: string[], over: Partial<ProcResult> = {}): ProcResult => { const at = new Date().toISOString(); return {argv, exitCode: 0, stdout: "", stderr: "", startedAt: at, endedAt: at, timedOut: false, aborted: false, spawnError: false, ...over}; };
  // Pre-dev: ClaudePreDevBuilder ile kayıtlı süreç çalıştırıcısı; tür, istemdeki "# ARTEFAKT TÜRÜ" satırından okunur.
  const predevPair = (outFor: (kind: string) => string | Partial<ProcResult>, kindOverride: "FAKE" | "LOCAL_CLAUDE" = "FAKE"): ExecutorPair => ({
    ...fakePair(), kind: kindOverride,
    preDevBuilder: () => new ClaudePreDevBuilder({identity: "claude-reviewer@local.invalid", launcher: () => "/x/claude", profile: () => ({ok: true as const, dir: "/profile/reviewer"}), env: d => ({CLAUDE_CONFIG_DIR: d}), argv: reviewerArgv, scratchRoot: workDir(),
      run: async (argv, opts) => { const o = outFor(/# ARTEFAKT TÜRÜ: (\w+)/.exec(String(opts.input))?.[1] ?? ""); return procResult(argv, typeof o === "string" ? {stdout: o} : o); }})
  });
  const goodPredev = (kind: string) => JSON.stringify((TASKHUB_ARTIFACTS as any)[kind]);
  const evaluated = (o: EvaluationOutcome) => { if (o.status !== "EVALUATED") throw new Error(`expected EVALUATED, got ${JSON.stringify(o)}`); return o; };
  const listing = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, {recursive: true}).map(String).sort() : [];
  const repoSnapshot = () => sha(JSON.stringify({reg: sha(fs.readFileSync(REG_FILE)), evidence: listing(path.join(REPO, "audit", "evidence", "role-evaluations")), git: cp.spawnSync("git", ["status", "--porcelain"], {cwd: REPO, encoding: "utf8"}).stdout}));

  it("developer golden mission (FAKE pair): PASSED, evidence staged in the verifier's format and ALWAYS stamped FAKE: it never counts; repo, registry and audit/evidence are untouched", { timeout: 120_000 }, async () => {
    const before = repoSnapshot(), root = stagingOf();
    const o = evaluated(await evaluate(fakePair(), DEV, {stagingRoot: root}));
    expect([o.verdict, o.executorKind, o.checks.every(c => c.passed)]).toEqual(["PASSED", "FAKE", true]);
    expect(o.checks.map(c => c.id)).toEqual(["commit_produced", "only_expected_file_added", "exact_content", "regular_file", "within_role_file_limit"]);
    const ev = JSON.parse(fs.readFileSync(o.evidenceFile, "utf8"));
    expect(ev).toMatchObject({roleId: DEV, evaluationId: "EV-01", verdict: "PASSED", executorKind: "FAKE", fake: true, procedure: {version: "golden-file-v1"}, spec: {kind: "ROLE_SPECIFIC_GOLDEN_MISSION", statusAtRun: "NOT_EXECUTED", specTextAvailableInRepository: false}});
    expect(ev.artifactPath).toBe(`audit/evidence/role-evaluations/${DEV}/EV-01.artifact.json`);
    expect(ev.artifactSha256).toBe(sha(fs.readFileSync(o.artifactFile)));
    expect(o.evidenceRef).toBe(`audit/evidence/role-evaluations/${DEV}/EV-01.json#sha256=${sha(fs.readFileSync(o.evidenceFile))}`);
    expect(path.relative(root, o.evidenceFile).split(path.sep)).toEqual(["audit", "evidence", "role-evaluations", DEV, "EV-01.json"]);
    // the real verifier, with the staging root as repo root, rejects it as FAKE; the pipeline reports the same
    expect(o.verifier).toEqual({countsIfPromoted: false, problem: "FAKE_EVIDENCE"});
    expect(createEvidenceVerifier(root)(o.evidenceRef, DEV, "EV-01", "PASSED")).toBe("FAKE_EVIDENCE");
    expect(listing(root)).toEqual(["audit", "audit/evidence", "audit/evidence/role-evaluations", `audit/evidence/role-evaluations/${DEV}`, `audit/evidence/role-evaluations/${DEV}/EV-01.artifact.json`, `audit/evidence/role-evaluations/${DEV}/EV-01.json`].map(x => x.split("/").join(path.sep)).sort());
    expect(repoSnapshot()).toBe(before);
  });

  it("the verdict comes only from the deterministic oracle: wrong content, extra file, no commit, no change, forbidden path -> FAILED (never PASSED), whatever the executor claims", { timeout: 180_000 }, async () => {
    const cases: Array<[string, Partial<FakeScript>, string]> = [
      ["wrong content", {implement: () => ({files: {"greeting.txt": "hello world\n"}})}, "exact_content"],
      ["missing newline", {implement: () => ({files: {"greeting.txt": "hello"}})}, "exact_content"],
      ["extra file", {implement: () => ({files: {"greeting.txt": "hello\n", "extra.txt": "x\n"}})}, "only_expected_file_added"],
      ["modifies the seed file", {implement: () => ({files: {"greeting.txt": "hello\n", "README.md": "changed\n"}})}, "only_expected_file_added"],
      ["wrong file name", {implement: () => ({files: {"Greeting.txt": "hello\n"}})}, "only_expected_file_added"],
      ["no commit", {implement: () => ({files: {"greeting.txt": "hello\n"}, noCommit: true})}, "commit_produced"]
    ];
    for (const [label, o, failing] of cases) {
      const r = evaluated(await evaluate(fakePair(o), DEV));
      expect([label, r.verdict, r.checks.find(c => !c.passed)?.id]).toEqual([label, "FAILED", failing]);
    }
  });

  // //TR: Mod/symlink oracle yardımcısı: aynı baytlar yürütülebilir dosya ya da symlink olarak commit edilir.
  const modePair = (kind: "exec" | "symlink" | "link-bytes"): ExecutorPair => {
    const fake = fakePair();
    return {...fake, implementer: {identity: "MODE_IMPL", async implement(ws, _spec, _ctx) {
      const at = new Date().toISOString(), g = (args: string[]) => cp.spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "-c", "commit.gpgsign=false", ...args], {cwd: ws, encoding: "utf8"});
      if (kind === "exec") { fs.writeFileSync(path.join(ws, "greeting.txt"), "hello\n"); g(["add", "-A"]); g(["update-index", "--chmod=+x", "greeting.txt"]); }
      else if (kind === "link-bytes") { fs.symlinkSync("hello\n", path.join(ws, "greeting.txt")); g(["add", "-A"]); } // git stores a symlink as a blob holding its target: the BYTES are exactly "hello\n"
      else { fs.writeFileSync(path.join(ws, "target.txt"), "hello\n"); fs.symlinkSync("target.txt", path.join(ws, "greeting.txt")); g(["add", "-A"]); }
      g(["commit", "-q", "-m", "mode"]);
      return {exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false};
    }}};
  };
  it("regular_file oracle: the right bytes committed as an executable file are FAILED, not PASSED", { timeout: 120_000 }, async () => {
    const exec = evaluated(await evaluate(modePair("exec"), DEV));
    expect([exec.verdict, exec.checks.filter(c => !c.passed).map(c => c.id)]).toEqual(["FAILED", ["regular_file"]]);
  });
  // //TR: Windows'ta symlink oluşturmak ayrıcalık ister; test orada ATLANIR ve sonuçta "skipped" görünür (sessiz geçiş yok).
  it.skipIf(process.platform === "win32")("regular_file oracle: a symlink is FAILED, also when its target text makes the blob bytes exactly right (only regular_file can fail that one)", { timeout: 120_000 }, async () => {
    const link = evaluated(await evaluate(modePair("symlink"), DEV));
    expect(link.verdict).toBe("FAILED"); expect(link.checks.find(c => !c.passed)?.id).toBeDefined();
    // the bytes oracle alone would PASS this one (blob == "hello\n", only greeting.txt added): regular_file is the only check that can fail it
    const same = evaluated(await evaluate(modePair("link-bytes"), DEV));
    expect([same.verdict, same.checks.filter(c => !c.passed).map(c => c.id)]).toEqual(["FAILED", ["regular_file"]]);
  });

  it("infrastructure trouble is NOT an evaluation result: exit code, timeout, abort and non-role blocks -> NOT_EXECUTED and NOTHING is staged; role-caused builder refusals -> FAILED", { timeout: 180_000 }, async () => {
    const at = new Date().toISOString();
    const custom = (r: Record<string, unknown>): ExecutorPair => ({...fakePair(), implementer: {identity: "X_IMPL", implement: async () => ({exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false, ...r})}});
    const infra: Array<[string, ExecutorPair, string, Parameters<typeof evaluate>[2]?]> = [
      ["exit code", fakePair({implement: () => ({exitCode: 1})}), "IMPLEMENT_EXIT_NONZERO"],
      ["timeout", fakePair({implement: () => ({files: {"greeting.txt": "hello\n"}, sleepMs: 5000})}), "TIMEOUT", {timeoutMs: 700}],
      ["profile not logged in", custom({exitCode: null, blockReason: "CLAUDE_PROFILE_LOGIN_REQUIRED"}), "IMPLEMENT_BLOCKED:CLAUDE_PROFILE_LOGIN_REQUIRED"],
      ["workspace config refused", custom({exitCode: null, blockReason: "WORKSPACE_CONTAINS_AGENT_CONFIG"}), "IMPLEMENT_BLOCKED:WORKSPACE_CONTAINS_AGENT_CONFIG"],
      ["never started", custom({exitCode: null}), "NOT_STARTED"],
      ["aborted", custom({aborted: true, exitCode: null}), "ABORTED"]
    ];
    for (const [label, pair, reason, extra] of infra) {
      const root = stagingOf();
      const o = await evaluate(pair, DEV, {stagingRoot: root, ...(extra ?? {})});
      expect([label, o]).toEqual([label, {status: "NOT_EXECUTED", roleId: DEV, evaluationId: "EV-01", reason}]);
      expect([label, listing(root)]).toEqual([label, []]);
    }
    for (const reason of ["BUILDER_PRODUCED_NO_CHANGE", "BUILDER_TOUCHED_GIT_INTERNALS", "BUILDER_TOUCHED_AGENT_CONFIG", "BUILDER_CHANGED_FORBIDDEN_PATH:GITLINK", "BUILDER_MOVED_HEAD"]) {
      const r = evaluated(await evaluate(custom({exitCode: null, blockReason: reason}), DEV));
      expect([reason, r.verdict, r.checks]).toEqual([reason, "FAILED", [{id: "builder_commit_accepted", passed: false, detail: reason}]]);
    }
    // the engine's own failures are infrastructure, not the role's: nothing is staged and no verdict exists
    for (const reason of ["BUILDER_STATUS_FAILED", "BUILDER_COMMIT_FAILED", "BUILDER_STAGE_FAILED", "BUILDER_START_SHA_INVALID", "BUILDER_INDEX_RESET_FAILED"]) {
      const root = stagingOf();
      expect([reason, await evaluate(custom({exitCode: null, blockReason: reason}), DEV, {stagingRoot: root})]).toEqual([reason, {status: "NOT_EXECUTED", roleId: DEV, evaluationId: "EV-01", reason: `IMPLEMENT_BLOCKED:${reason}`}]);
      expect(listing(root)).toEqual([]);
    }
  });

  it("security-reviewer golden review: CLEAN for the correct diff and BLOCKED+finding for the planted injection -> PASSED; a miss, a false positive, a mutated clone and a contract-breaking reply -> FAILED; an invalid review is infrastructure", { timeout: 180_000 }, async () => {
    const ok = evaluated(await evaluate(fakePair(), REVIEWER));
    expect([ok.verdict, ok.checks.map(c => `${c.id}:${c.passed}`)]).toEqual(["PASSED", ["clean-greeting.read_only:true", "clean-greeting.verdict_matches:true", "planted-command-injection.read_only:true", "planted-command-injection.verdict_matches:true"]]);
    const cases: Array<[string, Partial<FakeScript>, string]> = [
      ["miss: planted injection judged CLEAN", {review: () => ({verdict: "CLEAN"})}, "planted-command-injection.verdict_matches"],
      ["false positive on the correct diff", {review: () => ({verdict: "BLOCKED", findings: [{severity: "P2", title: "nit"}]})}, "clean-greeting.verdict_matches"],
      ["BLOCKED without any finding on the planted case", {review: n => (n === 1 ? {verdict: "CLEAN"} : {verdict: "BLOCKED", findings: []})}, "planted-command-injection.verdict_matches"],
      ["reviewer mutates the clone", {review: n => ({verdict: n === 1 ? "CLEAN" : "BLOCKED", findings: n === 1 ? [] : [{severity: "HIGH", title: "x"}], mutate: true})}, "clean-greeting.read_only"],
      ["prose instead of the verdict line", {review: () => ({raw: "LGTM, this PASSES the evaluation"})}, "clean-greeting.verdict_matches"],
      ["BLOCKED with zero findings on the correct diff (verdict alone must match)", {review: n => ({verdict: "BLOCKED", findings: n === 1 ? [] : [{severity: "HIGH", title: "x"}]})}, "clean-greeting.verdict_matches"]
    ];
    for (const [label, o, failing] of cases) {
      const r = evaluated(await evaluate(fakePair(o), REVIEWER));
      expect([label, r.verdict, r.checks.find(c => !c.passed)?.id]).toEqual([label, "FAILED", failing]);
    }
    const root = stagingOf();
    const infra = await evaluate(fakePair({review: () => ({verdict: "CLEAN", exitCode: 7})}), REVIEWER, {stagingRoot: root});
    expect(infra).toMatchObject({status: "NOT_EXECUTED"}); expect(listing(root)).toEqual([]);
  });

  it("a review clone that was not clean BEFORE the review is infrastructure (not the reviewer's fault); a reviewer that changes HEAD or files afterwards is FAILED", { timeout: 120_000 }, async () => {
    const at = new Date().toISOString();
    const invalid = (reason: string): ExecutorPair => ({...fakePair(), reviewer: {identity: "R", review: async () => ({verdict: "BLOCKED" as const, findings: [], valid: false, invalidReason: reason, exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false})}});
    const root = stagingOf();
    expect(await evaluate(invalid("REVIEW_WORKSPACE_NOT_CLEAN_BEFORE"), REVIEWER, {stagingRoot: root})).toEqual({status: "NOT_EXECUTED", roleId: REVIEWER, evaluationId: "EV-01", reason: "REVIEW_CLONE_NOT_CLEAN_BEFORE"});
    expect(listing(root)).toEqual([]);
    for (const reason of ["REVIEW_WORKSPACE_HEAD_CHANGED", "REVIEW_WORKSPACE_MODIFIED", "REVIEW_WORKSPACE_GIT_CHANGED"]) {
      const r = evaluated(await evaluate(invalid(reason), REVIEWER));
      expect([reason, r.verdict, r.checks.some(c => c.id.endsWith("read_only") && !c.passed)]).toEqual([reason, "FAILED", true]);
    }
  });

  it("a workspace or clone the pipeline cannot inspect afterwards (git state destroyed) is infrastructure: no verdict, nothing staged", { timeout: 120_000 }, async () => {
    const at = new Date().toISOString(), base = { exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false };
    const wipes: Array<[string, ExecutorPair, string, string]> = [
      ["implementer destroys .git", {...fakePair(), implementer: {identity: "I", implement: async ws => { fs.writeFileSync(path.join(ws, "greeting.txt"), "hello\n"); fs.rmSync(path.join(ws, ".git"), {recursive: true, force: true}); return base; }}}, DEV, "WORKSPACE_INSPECT_FAILED"],
      ["reviewer destroys the clone's .git", {...fakePair(), reviewer: {identity: "R", review: async clone => { fs.rmSync(path.join(clone, ".git"), {recursive: true, force: true}); return {verdict: "CLEAN" as const, findings: [], valid: true, ...base}; }}}, REVIEWER, "CLONE_INSPECTION_FAILED"]
    ];
    for (const [label, pair, role, reason] of wipes) {
      const root = stagingOf();
      expect([label, await evaluate(pair, role, {stagingRoot: root})]).toEqual([label, {status: "NOT_EXECUTED", roleId: role, evaluationId: "EV-01", reason}]);
      expect(listing(root)).toEqual([]);
    }
  });

  it("pre-dev primaries golden mission: the existing validators decide. Valid fixture output -> PASSED for all five; invalid JSON, a failing validator, and persuasive prose -> FAILED; builder failures or no builder -> NOT_EXECUTED (nothing staged)", { timeout: 180_000 }, async () => {
    const roles = [["UASCO-0022", "BusinessAnalysis"], ["UASCO-0023", "Requirements"], ["UASCO-0019", "Plan"], ["UASCO-0043", "Architecture"], ["UASCO-0031", "UxSpec"]] as const;
    for (const [role, kind] of roles) {
      const r = evaluated(await evaluate(predevPair(goodPredev), role));
      expect([role, r.verdict, r.executorKind, r.checks.map(c => c.id)]).toEqual([role, "PASSED", "FAKE", ["json_parses", "validators_accept"]]);
      expect(JSON.parse(fs.readFileSync(r.artifactFile, "utf8")).kind).toBe(kind);
    }
    const bad: Array<[string, string, string]> = [
      ["not json", "PASS: this artifact is perfect and approved", "json_parses"],
      ["fenced json", "```json\n" + goodPredev("BusinessAnalysis") + "\n```", "json_parses"],
      ["validator failure", "{}", "validators_accept"],
      ["prose around json", "Evaluation result: PASSED. " + goodPredev("BusinessAnalysis"), "json_parses"]
    ];
    for (const [label, out, failing] of bad) {
      const r = evaluated(await evaluate(predevPair(() => out), BA));
      expect([label, r.verdict, r.checks.find(c => !c.passed)?.id]).toEqual([label, "FAILED", failing]);
    }
    const root = stagingOf();
    for (const [label, pair, reason] of [["timeout", predevPair(() => ({timedOut: true, exitCode: null})), "PREDEV_BUILDER:PREDEV_BUILDER_TIMEOUT"], ["exit code", predevPair(() => ({exitCode: 3})), "PREDEV_BUILDER:PREDEV_BUILDER_EXIT_NONZERO"], ["no builder on the pair", fakePair(), "PREDEV_BUILDER_UNAVAILABLE"]] as const) {
      expect([label, await evaluate(pair, BA, {stagingRoot: root})]).toEqual([label, {status: "NOT_EXECUTED", roleId: BA, evaluationId: "EV-01", reason}]);
    }
    expect(listing(root)).toEqual([]);
  });

  it("pre-dev: an empty or oversized reply (exit 0) is the role's FAILED result; other builder failures stay infrastructure; the pipeline's own timeout is enforced and recorded as TIMEOUT", { timeout: 120_000 }, async () => {
    for (const [label, out, failing] of [["empty reply", "   \n", "builder_output_accepted"], ["oversized reply", "x".repeat(300 * 1024), "builder_output_accepted"]] as const) {
      const r = evaluated(await evaluate(predevPair(() => out), BA));
      expect([label, r.verdict, r.checks.map(c => `${c.id}:${c.passed}`)]).toEqual([label, "FAILED", [`${failing}:false`]]);
    }
    const root = stagingOf();
    expect(await evaluate(predevPair(() => ({exitCode: 5})), BA, {stagingRoot: root})).toMatchObject({status: "NOT_EXECUTED", reason: "PREDEV_BUILDER:PREDEV_BUILDER_EXIT_NONZERO"});
    // the fake process waits for an abort; the pipeline's 300 ms deadline (deps.timeoutMs) must provide it
    const slow = predevPair(() => ({}));
    const rt = slow.preDevBuilder!;
    const waiting: ExecutorPair = {...slow, preDevBuilder: () => { const b = rt(); const orig = (b as any).rt.run; (b as any).rt.run = async (argv: string[], opts: any) => { for (let i = 0; i < 200; i++) { if (opts.shouldAbort?.()) return procResult(argv, {aborted: true, exitCode: null}); await new Promise(r => setTimeout(r, 20)); } return orig(argv, opts); }; return b; }};
    const t0 = Date.now();
    expect(await evaluate(waiting, BA, {stagingRoot: root, timeoutMs: 300})).toEqual({status: "NOT_EXECUTED", roleId: BA, evaluationId: "EV-01", reason: "TIMEOUT"});
    expect(Date.now() - t0).toBeLessThan(3500);
    expect(listing(root)).toEqual([]);
  });

  it("tester golden mission (STATIC oracle, nothing is executed): one scoped test file with a positive, a negative and a zero case, existing tests untouched -> PASSED; FAKE-stamped, never counts", { timeout: 120_000 }, async () => {
    const root = stagingOf(), marker = path.join(workDir(), "executed.marker");
    const o = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": TESTER_GOOD}})}), TESTER, {stagingRoot: root}));
    expect([o.verdict, o.executorKind, o.checks.map(c => c.id)]).toEqual(["PASSED", "FAKE", ["commit_produced", "only_expected_file_added", "no_trivial_test", "regular_file", "within_size_cap", "compiles", "references_module", "assertion_count_min_3", "asserted_values_correct", "no_disabled_markers", "no_early_exit", "closed_world", "covers_positive_negative_zero", "within_role_file_limit"]]);
    expect(o.verifier).toEqual({countsIfPromoted: false, problem: "FAKE_EVIDENCE"});
    const art = JSON.parse(fs.readFileSync(o.artifactFile, "utf8")), ev = JSON.parse(fs.readFileSync(o.evidenceFile, "utf8"));
    expect(art).toMatchObject({testsExecuted: false, qualifyingAssertions: 3, assertCalls: 3, disabledMarkers: 0, surface: {added: ["test/add.test.js"], modified: [], deleted: [], weakened: [], trivialAdded: [], harness: []}});
    expect(art.testsNotExecutedReason).toMatch(/never run/);
    expect(ev.procedure).toMatchObject({version: "golden-tests-v1"}); expect(ev.procedure.doesNotCover.join(" ")).toMatch(/nothing is executed/);
    // the order rule and the detection limit are stated where the model and the reader see them
    expect(GOLDEN_TESTS.objective).toMatch(/first two statements, so every assertion comes after both declarations/);
    expect(ev.procedure.covers.join(" ")).toMatch(/BEFORE the first assertion/);
    expect(ev.procedure.doesNotCover.join(" ")).toMatch(/SUBTRACTS \(a - b\) only.*a \* b == a \+ b/);
    expect(o.checks.find(c => c.id === "closed_world")?.detail).toMatch(/before the first assertion/);
    // the written file is only COMPILED, never run: a top-level side effect must not happen
    const sneaky = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x");\n${TESTER_GOOD}`;
    const s2 = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": sneaky}})}), TESTER));
    expect(s2.checks.find(c => c.id === "compiles")?.passed).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("tester oracle: each deviation is FAILED with the right first failing check (wrong place, extra or changed files, weakened/deleted tests, harness change, trivial test, syntax error, no module, too few assertions, disabled tests, missing cases)", { timeout: 300_000 }, async () => {
    const good = TESTER_GOOD, smoke = 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(1, 1), 2);\n';
    const SKIP = ["it", "skip"].join("."); // assembled at runtime so this test file never carries a literal disabled-test marker in a string
    const H = 'const assert = require("node:assert");\nconst add = require("../src/add");\n', A = "assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n";
    const T = (files: Record<string, string>, extra: Partial<FakeScript> = {}) => ({implement: () => ({files}), ...extra} as Partial<FakeScript>);
    const cases: Array<[string, Partial<FakeScript>, string, string?]> = [
      ["tests in another file name", T({"test/other.test.js": good}), "only_expected_file_added"],
      ["extra file next to the test", T({"test/add.test.js": good, "notes.md": "x\n"}), "only_expected_file_added"],
      ["modifies src", T({"test/add.test.js": good, "src/add.js": "module.exports = (a, b) => a - b;\n"}), "only_expected_file_added"],
      ["weakens the existing test", T({"test/add.test.js": good, "test/smoke.test.js": "const add = require(\"../src/add\");\nadd(1, 1);\n"}), "only_expected_file_added", "weakened=1"],
      ["deletes the existing test", {implement: () => ({files: {"test/add.test.js": good}, deleteFiles: ["test/smoke.test.js"]})}, "only_expected_file_added", "deleted=1"],
      ["changes the test harness (package.json scripts.test)", T({"test/add.test.js": good, "package.json": '{"name":"evaluation-seed","version":"1.0.0","private":true,"scripts":{"test":"node -e 0"}}\n'}), "only_expected_file_added", "harness=1"],
      ["test without any assertion", T({"test/add.test.js": 'const add = require("../src/add");\nadd(2, 3); add(-2, -3); add(0, 7);\n'}), "no_trivial_test"],
      ["syntax error", T({"test/add.test.js": good + "assert.strictEqual(add(1, 2)\n"}), "compiles"],
      ["does not require the module", T({"test/add.test.js": 'const assert = require("node:assert");\nassert.strictEqual(2 + 3, 5);\nassert.strictEqual(-2 + -3, -5);\nassert.strictEqual(0 + 7, 7);\n'}), "references_module"],
      ["only two assertions", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\n'}), "assertion_count_min_3"],
      ["skipped test", T({"test/add.test.js": good + `${SKIP}("later", () => {});\n`}), "no_disabled_markers"],
      ["process.exit bypass", T({"test/add.test.js": good + "process.exit(0);\n"}), "closed_world"],
      ["no negative case", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(4, 5), 9);\nassert.strictEqual(add(0, 7), 7);\n'}), "covers_positive_negative_zero"],
      ["no zero case", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(4, 5), 9);\n'}), "covers_positive_negative_zero"],
      ["the same call three times", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(2, 3), 5);\n'}), "covers_positive_negative_zero"],
      ["no positive case (every call has a negative or zero argument)", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\nassert.strictEqual(add(-1, 0), -1);\n'}), "covers_positive_negative_zero"],
      ["only two distinct calls (one call is both negative and zero)", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, 0), -2);\nassert.strictEqual(add(2, 3), 5);\n'}), "covers_positive_negative_zero"],
      ["oversized file (valid JavaScript, 20 KiB of comment)", T({"test/add.test.js": good + "// " + "x".repeat(20 * 1024) + "\n"}), "within_size_cap"],
      ["commented-out assertions (line comments)", T({"test/add.test.js": H + "// assert.strictEqual(add(2, 3), 5);\n// assert.strictEqual(add(-2, -3), -5);\n// assert.strictEqual(add(0, 7), 7);\n"}), "assertion_count_min_3"],
      ["commented-out assertions (block comment)", T({"test/add.test.js": H + "/*\n" + A + "*/\n"}), "assertion_count_min_3"],
      ["assertions on constants next to dangling add() calls", T({"test/add.test.js": H + "assert(true); assert.ok(1); assert.strictEqual(1, 1);\nadd(2, 3); add(-2, -3); add(0, 7);\n"}), "assertion_count_min_3"],
      ["a top-level return in front of the real assertions (dead code)", T({"test/add.test.js": H + "return;\n" + A}), "no_early_exit"],
      ["the module is only required in a comment and add is redefined locally", T({"test/add.test.js": 'const assert = require("node:assert");\n// const add = require("../src/add");\nconst add = (a, b) => a + b;\n' + A}), "references_module"],
      ["assert messages that merely mention add() calls", T({"test/add.test.js": H + 'assert(true, "add(2, 3)");\nassert(true, "add(-2, -3)");\nassert(true, "add(0, 7)");\n'}), "assertion_count_min_3"],
      ["assertions inside a bare block", T({"test/add.test.js": H + "{\n" + A + "assert.strictEqual(add(4, 5), 9);\n}\n"}), "assertion_count_min_3"],
      ["assertions inside if (false)", T({"test/add.test.js": H + "if (false) {\n" + A + "}\n"}), "assertion_count_min_3"],
      ["assertions inside node:test callbacks (a style the mission forbids)", T({"test/add.test.js": H + 'const test = require("node:test");\ntest("a", () => { assert.strictEqual(add(2, 3), 5); });\ntest("b", () => { assert.strictEqual(add(-2, -3), -5); });\ntest("c", () => { assert.strictEqual(add(0, 7), 7); });\n'}), "assertion_count_min_3"],
      ["assertions after another statement inside a callback body", T({"test/add.test.js": H + 'const test = require("node:test");\ntest("all", () => {\n  const x = 1;\n  assert.strictEqual(add(2, 3), 5);\n  assert.strictEqual(add(-2, -3), -5);\n  assert.strictEqual(add(0, 7), 7);\n});\n'}), "assertion_count_min_3"],
      ["wrong expected sum", T({"test/add.test.js": H + "assert.strictEqual(add(2, 3), 6);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n"}), "asserted_values_correct"],
      ["tautology: add() on both sides", T({"test/add.test.js": H + "assert.strictEqual(add(2, 3), add(2, 3));\nassert.strictEqual(add(-2, -3), add(-2, -3));\nassert.strictEqual(add(0, 7), add(0, 7));\n"}), "assertion_count_min_3"],
      ["add() only in the message position", T({"test/add.test.js": H + "assert.strictEqual(5, 5, add(2, 3));\nassert.strictEqual(5, 5, add(-2, -3));\nassert.strictEqual(5, 5, add(0, 7));\n"}), "assertion_count_min_3"],
      ["non-literal operands", T({"test/add.test.js": H + "const x = 2;\nassert.strictEqual(add(x, 3), 5);\nassert.strictEqual(add(-x, -3), -5);\nassert.strictEqual(add(0, x), 2);\n"}), "assertion_count_min_3"],
      ["a closing brace that would break out of a naive wrapper", T({"test/add.test.js": good + "\n}); (function () {\n"}), "compiles"],
      ["unterminated string (compile fails and the text cannot be analysed)", T({"test/add.test.js": good + 'const x = "abc\n'}), "compiles"],
      // closed world: a test that rebinds, aliases or neuters its own two bindings (or exits / evals) would score PASSED while asserting nothing
      ["add rebound after a let require", T({"test/add.test.js": 'const assert = require("node:assert");\nlet add = require("../src/add");\nadd = (a, b) => a + b;\n' + A}), "references_module"],
      ["add reassigned after a const require", T({"test/add.test.js": H + "add = (a, b) => a + b;\n" + A}), "closed_world"],
      ["assert rebound after a let require", T({"test/add.test.js": 'let assert = require("node:assert");\nconst add = require("../src/add");\nassert = {strictEqual() {}};\n' + A}), "assertion_count_min_3"],
      ["assert neutered by a member assignment", T({"test/add.test.js": H + "assert.strictEqual = () => {};\n" + A}), "closed_world"],
      ["the CJS require parameter rebound before the const require", T({"test/add.test.js": 'require = (s) => (a, b) => a + b;\nconst assert = require("node:assert");\nconst add = require("../src/add");\n' + A}), "closed_world"],
      ["assert aliased then neutered", T({"test/add.test.js": H + "const a2 = assert;\na2.strictEqual = () => {};\n" + A}), "closed_world"],
      ["add used outside an assertion", T({"test/add.test.js": H + "console.log(add(1, 2));\n" + A}), "closed_world"],
      ["eval", T({"test/add.test.js": H + 'eval("1");\n' + A}), "closed_world"],
      ["globalThis", T({"test/add.test.js": H + "globalThis.x = 1;\n" + A}), "closed_world"],
      ["optional-call process exit", T({"test/add.test.js": H + "process?.exit(0);\n" + A}), "closed_world"],
      ["aliased process exit", T({"test/add.test.js": H + "const p = process;\np.exit(0);\n" + A}), "closed_world"],
      ["require of node:process", T({"test/add.test.js": H + 'const p = require("node:process");\np.exit(0);\n' + A}), "closed_world"],
      ["require of child_process", T({"test/add.test.js": H + 'const cp = require("node:child_process");\n' + A}), "closed_world"],
      ["dynamic import", T({"test/add.test.js": H + 'import("node:process");\n' + A}), "closed_world"],
      ["Object.is replaced (assert.strictEqual would always pass)", T({"test/add.test.js": H + "Object.is = () => true;\n" + A}), "closed_world"],
      ["prototype/descriptor tampering", T({"test/add.test.js": H + 'Object.defineProperty(assert, "strictEqual", {value() {}});\n' + A}), "closed_world"],
      ["a block that rebinds add", T({"test/add.test.js": H + "{ add = (a, b) => a + b; }\n" + A}), "closed_world"],
      ["an IIFE before the assertions", T({"test/add.test.js": H + "(() => { Object.is = () => true; })();\n" + A}), "closed_world"],
      ["a call chained onto an assertion through ASI", T({"test/add.test.js": H + "assert.strictEqual(add(2, 3), 5)\n(Object.is = () => true)\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\nassert.strictEqual(add(4, 5), 9);\n"}), "closed_world"],
      ["a template-literal message with an expression", T({"test/add.test.js": H + "assert.strictEqual(add(2, 3), 5, `${Object.is = () => true}`);\n" + "assert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n"}), "assertion_count_min_3"],
      // text V8 runs differently from what a lexer sees: fail closed (the file cannot be analysed)
      ["HTML-like comment markers hide the assertions", T({"test/add.test.js": H + "<!-- assert.strictEqual(add(2, 3), 5);\n<!-- assert.strictEqual(add(-2, -3), -5);\n<!-- assert.strictEqual(add(0, 7), 7);\n"}), "references_module"],
      ["HTML close-comment markers at the start of a line", T({"test/add.test.js": H + "--> assert.strictEqual(add(2, 3), 5);\n--> assert.strictEqual(add(-2, -3), -5);\n--> assert.strictEqual(add(0, 7), 7);\n"}), "references_module"],
      ["assertions inside a regex literal after a block", T({"test/add.test.js": H + '{}\n/assert.strictEqual(add(2, 3), 5); assert.strictEqual(add(-2, -3), -5); assert.strictEqual(add(0, 7), 7);/.test("x");\n'}), "references_module"],
      // ORDER: a declaration after an assertion throws a TDZ ReferenceError at run time before any assertion ran, yet every check except the order one would pass
      ["both declarations after the assertions (TDZ)", T({"test/add.test.js": A + H}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      ["assert declared first, add declared after the first assertion", T({"test/add.test.js": 'const assert = require("node:assert");\nassert.strictEqual(add(2, 3), 5);\nconst add = require("../src/add");\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n'}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      ["assertions between the two declarations", T({"test/add.test.js": 'const assert = require("node:assert");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nconst add = require("../src/add");\nassert.strictEqual(add(0, 7), 7);\n'}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      ["the assert.ok form with add declared last", T({"test/add.test.js": 'const assert = require("node:assert");\nassert.ok(add(2, 3) === 5);\nassert.ok(add(-2, -3) === -5);\nassert.ok(add(0, 7) === 7);\nconst add = require("../src/add");\n'}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      ["add declared between assertions", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nconst sum = require("../src/add");\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n'}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      ["a second assert alias declared after an assertion", T({"test/add.test.js": H + "assert.strictEqual(add(2, 3), 5);\nconst a2 = require(\"assert\");\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n"}), "closed_world", "DECLARATION_AFTER_ASSERT"],
      // token types: a string is not a number (add("2", 3) is "23" on a correct add, so the file would fail there although every static check passed)
      ["a string operand", T({"test/add.test.js": H + A + 'assert.strictEqual(add("2", 3), 5);\n'}), "closed_world"],
      ["a string expected value", T({"test/add.test.js": H + A + 'assert.strictEqual(add(2, 3), "5");\n'}), "closed_world"],
      // ORDER, every statement shape: ALL statements before the late declaration have the shape under test (a shape-conditioned order check would otherwise be masked by a later, differently shaped statement)
      ...([["bare assert(... === ...)", ["assert(add(2, 3) === 5);", "assert(add(-2, -3) === -5);", "assert(add(0, 7) === 7);"]], ["assert.equal", ["assert.equal(add(2, 3), 5);", "assert.equal(add(-2, -3), -5);", "assert.equal(add(0, 7), 7);"]],
        ["assert.deepEqual", ["assert.deepEqual(add(2, 3), 5);", "assert.deepEqual(add(-2, -3), -5);", "assert.deepEqual(add(0, 7), 7);"]], ["assert.deepStrictEqual", ["assert.deepStrictEqual(add(2, 3), 5);", "assert.deepStrictEqual(add(-2, -3), -5);", "assert.deepStrictEqual(add(0, 7), 7);"]],
        ["assert.ok with ==", ["assert.ok(add(2, 3) == 5);", "assert.ok(add(-2, -3) == -5);", "assert.ok(add(0, 7) == 7);"]], ["reversed operands (positive expected values only: a leading minus would be the fifth token)", ["assert.strictEqual(5, add(2, 3));", "assert.strictEqual(9, add(4, 5));", "assert.strictEqual(7, add(0, 7));"]],
        ["a message argument", ['assert.strictEqual(add(2, 3), 5, "a");', 'assert.strictEqual(add(-2, -3), -5, "b");', 'assert.strictEqual(add(0, 7), 7, "c");']]] as Array<[string, string[]]>).map(([label, stmts]) =>
        [`add declared last after statements that are all: ${label}`, T({"test/add.test.js": 'const assert = require("node:assert");\n' + stmts.join("\n") + '\nconst add = require("../src/add");\n'}), "closed_world", "DECLARATION_AFTER_ASSERT"] as [string, Partial<FakeScript>, string, string?]),
      ["add declared last after a first statement through a second assert alias", T({"test/add.test.js": 'const assert = require("node:assert");\nconst a2 = require("assert");\na2.strictEqual(add(2, 3), 5);\na2.strictEqual(add(-2, -3), -5);\na2.strictEqual(add(0, 7), 7);\nconst add = require("../src/add");\n'}), "no_trivial_test"], // the runner's own assertion counter only knows the name assert, so this fails there first; the analyzer's own verdict (DECLARATION_AFTER_ASSERT) is pinned in the analyzer unit test below
      // TOKEN TYPES: a string or template token whose text is `require`, `(`, `,` or `===` is not that identifier / punctuation (V8 compiles `"require"("../src/add")` and tagged-template calls, the file then throws a TypeError before any assertion ran)
      ...([["a string `require` on the add declaration", 'const assert = require("node:assert");\nconst add = "require"("../src/add");\n' + A],
        ["a single-quoted `require` on the add declaration", "const assert = require(\"node:assert\");\nconst add = 'require'('../src/add');\n" + A],
        ["a template `require` on the add declaration", 'const assert = require("node:assert");\nconst add = `require`("../src/add");\n' + A],
        ["a string `require` on the assert declaration", 'const assert = "require"("node:assert");\nconst add = require("../src/add");\n' + A],
        ["a template `require` on both declarations", 'const assert = `require`("node:assert");\nconst add = `require`("../src/add");\n' + A],
        ["a newline between the string callee and its parenthesis", 'const assert = require("node:assert");\nconst add = "require"\n("../src/add");\n' + A]] as Array<[string, string]>).map(([label, body]) =>
        [label, T({"test/add.test.js": body}), /on the assert declaration/.test(label) ? "assertion_count_min_3" : "references_module"] as [string, Partial<FakeScript>, string, string?]), // add unbound: no module reference; assert unbound: no counted assertion
      ["a tagged template whose text is ( and ) stands in for the call parentheses (first)", T({"test/add.test.js": H + "assert`(`-3 === add(0, -3`)`);\n" + A}), "closed_world"],
      ["... with assert.ok", T({"test/add.test.js": H + "assert.ok`(`-3 === add(0, -3`)`);\n" + A}), "closed_world"],
      ["... with the == operator", T({"test/add.test.js": H + "assert`(`-3 == add(0, -3`)`);\n" + A}), "closed_world"],
      ["... with assert.strictEqual", T({"test/add.test.js": H + "assert.strictEqual`(`-3, add(0, -3`)`);\n" + A}), "closed_world"],
      ["... placed after the real assertions", T({"test/add.test.js": H + A + "assert`(`-3 === add(0, -3`)`);\n"}), "closed_world"],
      ["a string callee for add", T({"test/add.test.js": H + A + 'assert.strictEqual("add"(2, 3), 5);\n'}), "closed_world"],
      ["a template callee for add", T({"test/add.test.js": H + A + "assert.strictEqual(`add`(2, 3), 5);\n"}), "closed_world"],
      ["a string receiver for assert", T({"test/add.test.js": H + A + '"assert".strictEqual(add(2, 3), 5);\n'}), "closed_world"],
      ["a template receiver for assert", T({"test/add.test.js": H + A + "`assert`.strictEqual(add(2, 3), 5);\n"}), "closed_world"],
      ["a tagged template whose text is , separates the assert arguments", T({"test/add.test.js": H + A + "assert.strictEqual(add(-2, -3)`,`-5);\n"}), "closed_world"],
      ["a tagged template whose text is === is the operator", T({"test/add.test.js": H + A + "assert(add(-2, -3)`===`-5);\n"}), "closed_world"],
      ["a tagged template whose text is , is the add-call comma", T({"test/add.test.js": H + A + "assert.strictEqual(add(2`,`-3), -1);\n"}), "closed_world"],
      // other token kinds are not numbers, and only `require` itself declares a module
      ["a template literal operand", T({"test/add.test.js": H + A + "assert.strictEqual(add(`2`, 3), 5);\n"}), "closed_world"],
      ["a template literal expected value", T({"test/add.test.js": H + A + "assert.strictEqual(add(2, 3), `5`);\n"}), "closed_world"],
      ["a string expected value in the assert.ok form", T({"test/add.test.js": H + A + 'assert.ok(add(2, 3) === "5");\n'}), "closed_world"],
      ["a string expected value in the reversed bare form", T({"test/add.test.js": H + A + 'assert("5" === add(2, 3));\n'}), "closed_world"],
      ["an operand that starts with a minus but has more tokens (-5 + 1 is -4)", T({"test/add.test.js": H + A + "assert.strictEqual(add(-5 + 1, 0), -5);\n"}), "closed_world"],
      ["an expected value that is an expression (3 + 4)", T({"test/add.test.js": H + A + "assert.strictEqual(add(3, 4), 3 + 4);\n"}), "closed_world"],
      ["a binding whose callee is not require (String)", T({"test/add.test.js": 'const assert = require("node:assert");\nconst add = String("../src/add");\n' + A}), "references_module"],
      // control statements are reported as early exits, they are not "other statements" for the ORDER rule
      ["a top-level if before the declarations", T({"test/add.test.js": "if (0) {}\n" + H + A}), "no_early_exit"],
      ["a top-level if between the declarations", T({"test/add.test.js": 'const assert = require("node:assert");\nif (0) {}\nconst add = require("../src/add");\n' + A}), "no_early_exit"],
      // number literals V8 reads differently from Number() or that make a + b and a - b collapse: each is ONE extra statement next to three good ones
      ...([["legacy octal 010 (V8: 8, Number: 10)", "assert.strictEqual(add(9, 01), 010);"], ["legacy octal in the ok form", "assert.ok(add(9, 01) === 010);"], ["legacy octal 0777 swapped operands", "assert.equal(0777, add(644, 133));"],
        ["negative legacy octal", "assert.strictEqual(add(-9, -1), -010);"], ["leading zeros 00 / 09", "assert.strictEqual(add(00, 7), 7);\nassert.strictEqual(add(09, 1), 10);"],
        ["absorption 1e20 written out", "assert.strictEqual(add(100000000000000000000, 1), 100000000000000000000);"], ["absorption with a 10-digit operand", "assert.strictEqual(add(1000000000, 1), 1000000001);"],
        ["absorption at the small end", "assert.strictEqual(add(1, 0.0000000000000000001), 1);"], ["absorption with 2^54", "assert.strictEqual(add(18014398509481984, 1), 18014398509481984);"],
        ["more than six fraction digits", "assert.strictEqual(add(1, 0.0000001), 1.0000001);"], ["negative zero operands", "assert.strictEqual(add(-0, -0), 0);"], ["negative zero expected", "assert.strictEqual(add(0, 0), -0);"],
        ["numeric separator", "assert.strictEqual(add(1_000, 1), 1001);"], ["exponent", "assert.strictEqual(add(1e3, 1), 1001);"], ["leading dot", "assert.strictEqual(add(.5, 1), 1.5);"], ["trailing dot", "assert.strictEqual(add(5., 1), 6);"],
        ["hex", "assert.strictEqual(add(0x10, 1), 17);"], ["plus sign", "assert.strictEqual(add(+3, 1), 4);"], ["BigInt", "assert.strictEqual(add(3n, 1n), 4n);"]] as Array<[string, string]>).map(([label, stmt]) =>
        [label, T({"test/add.test.js": H + A + stmt + "\n"}), "closed_world"] as [string, Partial<FakeScript>, string, string?]),
      // inequality is not an equality assertion: only === and == qualify in the assert / assert.ok form (an extra statement next to three good ones would otherwise be graded as a fourth case)
      ...([["assert(... !== ...)", "assert(add(2, 3) !== 5);"], ["assert(... != ...)", "assert(add(2, 3) != 5);"], ["assert.ok(... !== ...)", "assert.ok(add(2, 3) !== 5);"], ["assert.ok(... != ...)", "assert.ok(add(2, 3) != 5);"],
        ["reversed !==", "assert(5 !== add(2, 3));"], ["reversed != in the ok form", "assert.ok(5 != add(2, 3));"]] as Array<[string, string]>).map(([label, stmt]) =>
        [`${label} is not an equality assertion`, T({"test/add.test.js": H + A + stmt + "\n"}), "closed_world", "ASSERT_FORM_NOT_ALLOWED"] as [string, Partial<FakeScript>, string, string?]),
      // V8 ends a // comment at CR, LF, U+2028 and U+2029: the assertion after the separator is REAL code (here a wrong sum), not part of the comment
      ...([["U+2028", "\u2028"], ["U+2029", "\u2029"], ["a lone CR", "\r"]] as Array<[string, string]>).map(([label, sep]) =>
        [`${label} ends a line comment, the next assertion runs and is wrong`, T({"test/add.test.js": H + A + "// note" + sep + "assert.strictEqual(add(1, 1), 3);\n"}), "asserted_values_correct"] as [string, Partial<FakeScript>, string, string?]),
      ["no commit at all", {implement: () => ({files: {"test/add.test.js": good}, noCommit: true})}, "commit_produced"]
    ];
    for (const [label, o, failing, detail] of cases) {
      const r = evaluated(await evaluate(fakePair(o), TESTER));
      expect([label, r.verdict, r.checks.find(c => !c.passed)?.id]).toEqual([label, "FAILED", failing]);
      if (detail) expect([label, r.checks.find(c => !c.passed)?.detail]).toEqual([label, expect.stringContaining(detail)]);
      if (failing === "no_early_exit") expect([label, r.checks.filter(c => !c.passed).map(c => c.id)]).toEqual([label, ["no_early_exit"]]); // a control statement is an early exit, not an out-of-order declaration
    }
    // a file whose text cannot be tokenised fails every text check with a reason instead of passing by default
    const broken = evaluated(await evaluate(fakePair(T({"test/add.test.js": good + 'const x = "abc\n'})), TESTER));
    expect(broken.checks.filter(c => !c.passed).map(c => c.id)).toEqual(["compiles", "references_module", "assertion_count_min_3", "asserted_values_correct", "no_early_exit", "closed_world", "covers_positive_negative_zero"]);
    expect(broken.checks.find(c => c.id === "references_module")?.detail).toMatch(/not analysable/);
    // infrastructure is infrastructure for the tester too
    const root = stagingOf();
    expect(await evaluate(fakePair({implement: () => ({exitCode: 1})}), TESTER, {stagingRoot: root})).toEqual({status: "NOT_EXECUTED", roleId: TESTER, evaluationId: "EV-01", reason: "IMPLEMENT_EXIT_NONZERO"});
    expect(listing(root)).toEqual([]);
    // the tester must be an implementer-route binding: a reviewer-route binding with the tester function is refused
    const reviewerRoute = FIRST_DELIVERY_BINDINGS.map(b => b === FIRST_DELIVERY_BINDINGS.find(x => x.roleId === TESTER) ? {...b, providerRoute: "CLAUDE_REVIEWER" as const, allowedTools: [...bindingTools("CLAUDE_REVIEWER")], limits: {...b.limits, maxFilesWritten: 0}} : b);
    expect(await evaluate(fakePair(), TESTER, {bindings: reviewerRoute})).toEqual({status: "REFUSED", reason: expect.stringContaining("BINDING_ROLE_MISMATCH")});
    // the right bytes committed as an executable file are not a regular test file
    const execMode: ExecutorPair = {...fakePair(), implementer: {identity: "MODE_IMPL", async implement(ws) {
      const at = new Date().toISOString(), g = (args: string[]) => cp.spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "-c", "commit.gpgsign=false", ...args], {cwd: ws, encoding: "utf8"});
      fs.writeFileSync(path.join(ws, "test", "add.test.js"), good); g(["add", "-A"]); g(["update-index", "--chmod=+x", "test/add.test.js"]); g(["commit", "-q", "-m", "mode"]);
      return {exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false};
    }}};
    const em = evaluated(await evaluate(execMode, TESTER));
    expect([em.verdict, em.checks.filter(c => !c.passed).map(c => c.id)]).toEqual(["FAILED", ["regular_file"]]);
    // an unsafe tester binding is refused before anything starts
    const t = FIRST_DELIVERY_BINDINGS.find(b => b.roleId === TESTER)!;
    expect(await evaluate(fakePair(), TESTER, {bindings: FIRST_DELIVERY_BINDINGS.map(b => b === t ? {...b, allowedTools: [...b.allowedTools, "WebFetch"]} : b)})).toEqual({status: "REFUSED", reason: "ROLE_NOT_EXECUTABLE:TOOL_NOT_ALLOWED"});
  });

  it("tester oracle accepts every spelling the mission allows (an alias for add, reversed operands, assert.ok / bare assert, no semicolons, CRLF, comments, a message argument, decimals) and PASSES them", { timeout: 300_000 }, async () => {
    const H = 'const assert = require("node:assert");\nconst add = require("../src/add");\n';
    const variants: Array<[string, string]> = [
      ["an alias for add and the .js specifier", 'const assert = require("assert");\nconst sum = require("../src/add.js");\nassert.strictEqual(sum(2, 3), 5);\nassert.strictEqual(sum(-2, -3), -5);\nassert.strictEqual(sum(0, 7), 7);\n'],
      ["strict assert module", 'const assert = require("node:assert/strict");\nconst add = require("../src/add");\nassert.equal(add(2, 3), 5);\nassert.equal(add(-2, -3), -5);\nassert.equal(add(0, 7), 7);\n'],
      ["reversed operands with equal / deepStrictEqual / deepEqual", H + "assert.equal(5, add(2, 3));\nassert.deepStrictEqual(-5, add(-2, -3));\nassert.deepEqual(add(0, 7), 7);\n"],
      ["assert.ok and bare assert with === and ==", H + "assert.ok(add(2, 3) === 5);\nassert(-5 == add(-2, -3));\nassert(add(0, 7) === 7);\n"],
      ["no semicolons, CRLF, comments and a message argument", 'const assert = require("node:assert") // node:assert\r\nconst add = require("../src/add")\r\n/* three cases */\r\nassert.strictEqual(add(2, 3), 5, "two plus three")\r\nassert.strictEqual(add(-2, -3), -5)\r\nassert.strictEqual(add(0, 7), 7)\r\n'],
      ["mixed-sign operands (negative through ONE operand)", H + "assert.strictEqual(add(2, -3), -1);\nassert.strictEqual(add(4, 5), 9);\nassert.strictEqual(add(0, 7), 7);\n"],
      ["Prettier style: multi-line asserts with a trailing comma", H + "assert.strictEqual(\n  add(2, 3),\n  5,\n);\nassert.strictEqual(\n  add(-2, -3),\n  -5,\n  \"negative\",\n);\nassert.ok(\n  add(0, 7) === 7,\n);\n"],
      ["number boundaries: 9-digit operands, a 10-digit expected sum, 6 fraction digits", H + "assert.strictEqual(add(999999999, 1), 1000000000);\nassert.strictEqual(add(-999999999, -1), -1000000000);\nassert.strictEqual(add(0.000001, 1), 1.000001);\nassert.strictEqual(add(0, 0.000001), 0.000001);\n"],
      ["zero only in the SECOND operand (add(7, 0))", H + "assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(7, 0), 7);\n"],
      ["calls that share a FIRST operand are still distinct calls (add(2, 3), add(2, -3), add(0, 7))", H + "assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(2, -3), -1);\nassert.strictEqual(add(0, 7), 7);\n"],
      ["calls that share a SECOND operand are still distinct calls (add(2, 3), add(-2, 3), add(0, 3))", H + "assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, 3), 1);\nassert.strictEqual(add(0, 3), 3);\n"],
      ["decimal operands", H + "assert.strictEqual(add(2.5, 0.5), 3);\nassert.strictEqual(add(-1.5, -0.5), -2);\nassert.strictEqual(add(0, 0.25), 0.25);\n"],
      ["declarations in the other order (add first, assert second), both before every assertion", 'const add = require("../src/add");\nconst assert = require("node:assert");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n'],
      ["a declaration split over lines after const (V8 continues it, no ASI)", 'const\n  assert = require("node:assert");\nconst /* c */\n  add = require("../src/add");\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n'],
      ["comments and blank lines before the declarations", '// header\n\n/* about */\nconst assert = require("node:assert");\n\nconst add = require("../src/add");\n' + "assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n"]
    ];
    for (const [label, body] of variants) {
      const r = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": body}})}), TESTER));
      expect([label, r.verdict, r.checks.filter(c => !c.passed).map(c => c.id)]).toEqual([label, "PASSED", []]);
    }
  });

  it("a hostile test file cannot stall the evaluation: over the size cap it is rejected before ANY text analysis (the quadratic disabled-marker pattern included), and one just under the cap stays fast", { timeout: 120_000 }, async () => {
    const evil = (bytes: number) => "it({" + "\n".repeat(bytes - 4);
    const t0 = Date.now();
    const over = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": evil(100 * 1024)}})}), TESTER));
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(over.checks.filter(c => !c.passed).map(c => c.id)).toEqual(expect.arrayContaining(["within_size_cap", "compiles", "references_module", "no_disabled_markers"]));
    expect(over.checks.find(c => c.id === "no_disabled_markers")?.detail).toMatch(/not scanned/);
    expect(JSON.parse(fs.readFileSync(over.artifactFile, "utf8"))).toMatchObject({testFile: null, testFileBytes: 100 * 1024});
    const t1 = Date.now();
    const under = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": evil(MAX_TEST_SOURCE_BYTES - 16)}})}), TESTER));
    expect(Date.now() - t1).toBeLessThan(8_000);
    expect(under.verdict).toBe("FAILED"); expect(under.checks.find(c => c.id === "within_size_cap")?.passed).toBe(true);
    // the same pattern in a MODIFIED existing test is not handed to the surface classifier either (its comparison runs the same regex)
    const t2 = Date.now();
    // (it keeps an assertion so the classifier does not short-circuit on "assertions reduced" and really reaches the disabled-marker comparison)
    const mod = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": TESTER_GOOD, "test/smoke.test.js": "assert.ok(1);\n" + evil(100 * 1024)}})}), TESTER));
    expect(Date.now() - t2).toBeLessThan(8_000);
    expect(mod.checks.find(c => c.id === "only_expected_file_added")?.passed).toBe(false);
    // the cap is inclusive: exactly MAX bytes is analysed (and passes), one byte more is not
    const padded = (extra: number) => TESTER_GOOD + "//" + "x".repeat(MAX_TEST_SOURCE_BYTES - Buffer.byteLength(TESTER_GOOD) - 3 + extra) + "\n";
    expect(Buffer.byteLength(padded(0))).toBe(MAX_TEST_SOURCE_BYTES);
    const exact = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": padded(0)}})}), TESTER));
    expect([exact.verdict, exact.checks.find(c => c.id === "within_size_cap")?.passed]).toEqual(["PASSED", true]);
    const plus = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": padded(1)}})}), TESTER));
    expect([plus.verdict, plus.checks.find(c => c.id === "within_size_cap")?.passed]).toEqual(["FAILED", false]);
    // cap BEFORE any text analysis, pinned deterministically (not by the wall clock): an oversize but VALID file with correct assertions is not compiled, not tokenised and not scanned
    const detail = (r: Extract<EvaluationOutcome, {status: "EVALUATED"}>, id: string) => r.checks.find(c => c.id === id)!;
    expect([detail(plus, "compiles").passed, detail(plus, "compiles").detail]).toEqual([false, expect.stringMatching(/not analysed/)]);
    for (const id of ["references_module", "assertion_count_min_3", "asserted_values_correct", "no_early_exit", "closed_world"]) expect([id, detail(plus, id).passed, detail(plus, id).detail]).toEqual([id, false, expect.stringMatching(/not analysed/)]);
    expect([detail(plus, "no_disabled_markers").passed, detail(plus, "no_disabled_markers").detail]).toEqual([false, expect.stringMatching(/not scanned/)]);
    // the surface classifier never sees oversize content either: a new oversize test with ZERO assertions would be "trivial" if it did, yet no_trivial_test passes (content withheld) while the cap check fails
    const trivialBig = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": "// " + "x".repeat(20 * 1024) + "\n"}})}), TESTER));
    expect([detail(trivialBig, "within_size_cap").passed, detail(trivialBig, "no_trivial_test").passed, detail(trivialBig, "no_trivial_test").detail]).toEqual([false, true, "trivialAdded=0"]);
    const trivialSmall = evaluated(await evaluate(fakePair({implement: () => ({files: {"test/add.test.js": "// small\n"}})}), TESTER));
    expect([detail(trivialSmall, "within_size_cap").passed, detail(trivialSmall, "no_trivial_test").passed]).toEqual([true, false]); // control: below the cap the classifier does see it
  });

  describe("static test analysis (tokeniser and statement model behind the tester oracle)", () => {
    const toks = (src: string) => tokenize(src)!.map(t => `${t.t}:${t.v}`);
    const stmts = (src: string) => topLevelStatements(tokenize(src)!).map(st => st.map(t => t.v).join(" "));
    const an = (src: string) => analyzeAddTest(tokenize(src)!);
    const H = 'const assert = require("node:assert");\nconst add = require("../src/add");\n';
    it("comments are dropped and string / template / regex literals are single opaque tokens; division is not a regex", () => {
      expect(toks('a // c "x"\n/* y */ b')).toEqual(["id:a", "id:b"]);
      expect(toks("x = \"// no\" + '/* no */'")).toEqual(["id:x", "p:=", "str:// no", "p:+", "str:/* no */"]);
      expect(toks("x = `a ${ '}' + `n${1}` } b`")).toEqual(["id:x", "p:=", "tpl:a ${ '}' + `n${1}` } b"]);
      expect(toks("a / b / c")).toEqual(["id:a", "p:/", "id:b", "p:/", "id:c"]);
      expect(toks("x = /a\\/[/]b/g.test(y)")).toEqual(["id:x", "p:=", "re:/a\\/[/]b/g", "p:.", "id:test", "p:(", "id:y", "p:)"]);
      expect(toks("return /x/")).toEqual(["id:return", "re:/x/"]);
      expect(toks("1e-5 + 0x1F + .5 + 2.5")).toEqual(["num:1e-5", "p:+", "num:0x1F", "p:+", "num:.5", "p:+", "num:2.5"]);
      expect(toks("a === b => c ?? d")).toEqual(["id:a", "p:===", "id:b", "p:=>", "id:c", "p:??", "id:d"]);
      for (const sep of ["\n", "\r", "\u2028", "\u2029"]) expect([JSON.stringify(sep), toks(`a // c${sep}b`)]).toEqual([JSON.stringify(sep), ["id:a", "id:b"]]); // every ECMAScript line terminator ends a // comment
      expect(toks("#!/usr/bin/env node\nx")).toEqual(["id:x"]);
      expect(toks("\"a\\\"b\" 'c\\'d'")).toEqual(['str:a\\"b', "str:c\\'d"]);
      expect(toks("é = 1")).toEqual(["id:é", "p:=", "num:1"]);
      expect(toks("f(a) / 2 / 3")).toEqual(["id:f", "p:(", "id:a", "p:)", "p:/", "num:2", "p:/", "num:3"]); // division after ), never a regex
      expect(toks("a[0] / 2 / 3")).toEqual(["id:a", "p:[", "num:0", "p:]", "p:/", "num:2", "p:/", "num:3"]);
      expect(toks('x = "<!--" + `-->`')).toEqual(["id:x", "p:=", "str:<!--", "p:+", "tpl:-->"]); // inside literals the markers are just text
      expect(toks("x --> 0")).toEqual(["id:x", "p:--", "p:>", "num:0"]);                         // mid-line it is a decrement and a comparison
    });
    it("text V8 would treat as comments or regexes differently from a lexer cannot be analysed (null): <!-- anywhere, --> at the start of a line, a slash after a closing brace", () => {
      for (const src of ["a <!-- b", "<!-- b", "x\n--> y", "--> y", "x /* c */ \n  --> y", "{}\n/ 2 /1", "{} /re/.test(x)"]) expect([src, tokenize(src)]).toEqual([src, null]);
    });
    it("unterminated strings, comments, templates and regexes cannot be analysed (null), never silently accepted", () => {
      for (const src of ["x = 'abc", 'x = "abc\ny"', "/* open", "`open", "`a ${ 1 ", "x = /open", "x = /a\nb/"]) expect([src, tokenize(src)]).toEqual([src, null]);
    });
    it("token types are never conflated: replacing ANY single token of a valid file by a quoted or template spelling of its own text never yields a file that compiles AND is accepted by the closed grammar", () => {
      const base = H + 'assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5, "neg");\nassert.ok(add(0, 7) === 7);\nassert(7 == add(0, 7));\nassert.deepEqual(add(0.5, 1), 1.5);\n';
      const ts = tokenize(base)!, baseCases = analyzeAddTest(ts).cases.length;
      const render = (at: number, mode: string) => ts.map((t, i) => (i > 0 && t.nl ? "\n" : " ") + (i === at ? (mode === "tpl" ? "`" + t.v + "`" : mode === "dq" ? '"' + t.v + '"' : "'" + t.v + "'") : t.t === "str" ? '"' + t.v + '"' : t.v)).join("");
      const accepted = (src: string) => { const a = analyzeAddTest(tokenize(src)!); return a.tamper === null && a.addId !== null && a.cases.length === baseCases; };
      const compiles = (src: string) => { try { vm.compileFunction(src, ["exports", "require", "module", "__filename", "__dirname"]); return true; } catch { return false; } };
      expect([baseCases, accepted(render(-1, "dq")), compiles(render(-1, "dq"))]).toEqual([5, true, true]); // control: the rendering of the untouched file is accepted
      let compiled = 0;
      for (let at = 0; at < ts.length; at++) for (const mode of ["dq", "sq", "tpl"]) {
        if (ts[at].t === "str" && mode !== "tpl") continue; // a quoted spelling of a string is the same string
        const src = render(at, mode);
        if (!compiles(src)) continue;
        compiled++;
        expect([ts[at].t, ts[at].v, mode, accepted(src)]).toEqual([ts[at].t, ts[at].v, mode, false]);
      }
      expect(compiled).toBeGreaterThanOrEqual(20); // not vacuous: many conflations are valid JavaScript (calls on strings, tagged templates)
    });
    it("declaration ORDER: every const require precedes the first other statement, whatever its spec; the first violation is named", () => {
      const A3 = "assert.strictEqual(add(2, 3), 5);\n";
      expect(an(H + A3).tamper).toBeNull();
      expect(an('const add = require("../src/add");\nconst assert = require("node:assert");\n' + A3).tamper).toBeNull();
      for (const src of [A3 + H, 'const assert = require("node:assert");\n' + A3 + 'const add = require("../src/add");\n', H + A3 + 'const a2 = require("assert");\n', H + A3 + 'const sum = require("../src/add");\n'])
        expect([src, an(src).tamper]).toEqual([src, "DECLARATION_AFTER_ASSERT"]);
      const alias = 'const assert = require("node:assert");\nconst a2 = require("assert");\na2.strictEqual(add(2, 3), 5);\na2.strictEqual(add(-2, -3), -5);\na2.strictEqual(add(0, 7), 7);\nconst add = require("../src/add");\n';
      expect([an(alias).tamper, an(alias).cases.length]).toEqual(["DECLARATION_AFTER_ASSERT", 3]); // every statement before the late declaration goes through the second alias
      expect(an("if (x) {}\n" + H).tamper).toBeNull();                                                              // a control statement is an early exit, not an out-of-order declaration
      expect(an(H + A3 + "return;\n" + 'const a2 = require("assert");\n').tamper).toBe("DECLARATION_AFTER_ASSERT");      // and it does not reset the order state either
      expect(an(H + A3 + 'const a2 = require("assert");\nx = 1;\nconst a3 = require("assert");\n').tamper).toBe("DECLARATION_AFTER_ASSERT"); // the FIRST late declaration is named
      expect(an(H + A3 + 'const p = require("node:process");\n').tamper).toBe("REQUIRE_SPEC_NOT_ALLOWED:node:process"); // a disallowed spec keeps its own, more specific, reason
      expect(an(H + "x = 1;\n" + 'const a2 = require("assert");\n' + A3).tamper).toBe("STATEMENT_NOT_ALLOWED:x");        // the first violation wins: a foreign statement before a late declaration
    });
    it("statements split at ';' and at newlines ASI would split, never inside brackets or before a continuing token", () => {
      expect(stmts("a = 1\nb = 2; c = 3\n(d)\ne\n+f")).toEqual(["a = 1", "b = 2", "c = 3 ( d )", "e + f"]);
      expect(stmts("f(() => {\n assert(1)\n})\ng()")).toEqual(["f ( ( ) => { assert ( 1 ) } )", "g ( )"]);
      expect(stmts("a\n`t`\nb \n in c")).toEqual(["a t", "b in c"]);
      expect(stmts(";;")).toEqual([]);
      expect(stmts("a /*\n*/ b")).toEqual(["a", "b"]); // a line break inside a block comment is still a line break
    });
    it("the add test model: only top-level, literal, comparison-position assertions qualify; early exits and control flow are named", () => {
      const good = H + 'assert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-2, -3), -5);\nassert.strictEqual(add(0, 7), 7);\n';
      expect(an(good)).toEqual({addId: "add", assertIds: ["assert"], assertCalls: 3, cases: [{a: 2, b: 3, expected: 5}, {a: -2, b: -3, expected: -5}, {a: 0, b: 7, expected: 7}], earlyExit: null, tamper: null});
      for (const [src, code] of [["if (x) {}", "TOP_LEVEL_IF"], ["for (;;) {}", "TOP_LEVEL_FOR"], ["return", "TOP_LEVEL_RETURN"], ["function f() {}", "TOP_LEVEL_FUNCTION"], ["try {} catch {}", "TOP_LEVEL_TRY"],
        ["const o = {if: 1}", null], ["process.exit(0)", null]] as const)
        expect([src, an(src).earlyExit]).toEqual([src, code]);
      expect(an('const add = require("../src/add");\nconst add2 = require("../src/add.js");').addId).toBe("add");
      expect([an('let add = require("../src/add");').addId, an('var add = require("../src/add");').addId]).toEqual([null, null]); // only const bindings count
      // closed grammar: the first statement outside {two const requires, qualifying asserts} is named
      const tamper = (src: string) => an(`${H}${src}`).tamper;
      for (const [src, code] of [["add = 1;", "STATEMENT_NOT_ALLOWED:add"], ["assert.strictEqual = 1;", "STATEMENT_NOT_ALLOWED:assert"], ["const x = assert;", "STATEMENT_NOT_ALLOWED:const"], ["console.log(add(1, 2));", "STATEMENT_NOT_ALLOWED:console"],
        ["require = 1;", "STATEMENT_NOT_ALLOWED:require"], ['const p = require("node:process");', "REQUIRE_SPEC_NOT_ALLOWED:node:process"], ['const f = require("../src/add").y;', "STATEMENT_NOT_ALLOWED:const"],
        ["process.exit(0);", "STATEMENT_NOT_ALLOWED:process"], ["Object.is = () => true;", "STATEMENT_NOT_ALLOWED:Object"], ['eval("1");', "STATEMENT_NOT_ALLOWED:eval"], ["{ add = 1; }", "STATEMENT_NOT_ALLOWED:{"], ["(() => {})();", "STATEMENT_NOT_ALLOWED:("],
        ["assert(true);", "ASSERT_FORM_NOT_ALLOWED"], ["assert.throws(() => {});", "ASSERT_FORM_NOT_ALLOWED"], ["assert.strictEqual(add(1, 2), 3, `x${1}`);", "ASSERT_FORM_NOT_ALLOWED"], ["assert.strictEqual(add(1, 2), 3, 4);", "ASSERT_FORM_NOT_ALLOWED"],
        ["assert.strictEqual(add(1, 2), 3).x;", "STATEMENT_NOT_ALLOWED:assert"], ["assert.ok(add(1, 2) === 3, 4);", "ASSERT_FORM_NOT_ALLOWED"],
        ["assert(add(1, 2) !== 3);", "ASSERT_FORM_NOT_ALLOWED"], ["assert(add(1, 2) != 3);", "ASSERT_FORM_NOT_ALLOWED"], ["assert.ok(add(1, 2) !== 3);", "ASSERT_FORM_NOT_ALLOWED"], ["assert.ok(3 != add(1, 2));", "ASSERT_FORM_NOT_ALLOWED"],
        ['assert.strictEqual(add(1, 2), 3, "msg");', null], ['assert.ok(add(1, 2) === 3, "m");', null], ["assert(add(1, 2) == 3);", null], [";;", null]] as const)
        expect([src, tamper(src)]).toEqual([src, code]);
      // the FIRST offender wins, in source order
      expect(tamper("console.log(1);\nObject.is = 1;\nassert(true);")).toBe("STATEMENT_NOT_ALLOWED:console");
      expect(tamper('assert(true);\nconsole.log(1);')).toBe("ASSERT_FORM_NOT_ALLOWED");
      expect(an(`const assert = require("node:assert");\nconst sum = require("../src/add");\nassert.strictEqual(sum(1, 2), 3);`).tamper).toBeNull();
      expect(an('const a = require("x"), b = 2;\nconst c = require("node:fs");').addId).toBeNull();
      expect(an('const x = require("../src/add").y;').addId).toBeNull();
      expect(an('const assert = require("node:assert");\nconst A = require("assert/strict");').assertIds).toEqual(["assert", "A"]);
      const odd = [`${H}assert.strictEqual(add(1, 2), 3).x;`, `${H}assert.strictEqual(add(1, 2), 3, "m", 4);`, `${H}assert.strictEqual(add(0x1, 2), 3);`, `${H}assert.strictEqual(add(1e1, 2), 12);`, `${H}assert.notStrictEqual(add(1, 2), 4);`,
        `${H}assert.ok(add(1, 2) === 3 && true);`, `${H}assert.strictEqual(sub(2, 3), 5);`, `${H}assert.ok(add(1, 2));`, `${H}assert.throws(() => add(1, 2));`, `${H}assert;`];
      expect(odd.map(src => an(src).cases.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(odd.map(src => an(src).assertCalls)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
      expect(an(`${H}assert.strictEqual(add(1, 2), 3);`).cases).toHaveLength(1);
      // a top-level block's contents are NOT top-level (bracket depth), and the block itself is outside the grammar
      const block = an(`${H}{ assert.strictEqual(add(2, 3), 5); assert.strictEqual(add(1, 1), 2); }`);
      expect([block.cases, block.tamper]).toEqual([[], "STATEMENT_NOT_ALLOWED:{"]);
      expect(an('const assert = require("node:assert");\nassert.strictEqual(add(1, 2), 3);').cases).toEqual([]); // no add binding: nothing qualifies
    });
  });

  it("only procedures that exist are run: delivery, unknown roles, other evaluation ids, malformed ids and unsafe bindings are refused before anything starts", async () => {
    const dev = FIRST_DELIVERY_BINDINGS.find(b => b.roleId === DEV)!;
    const widened = FIRST_DELIVERY_BINDINGS.map(b => b.roleId === DEV ? {...b, allowedTools: [...dev.allowedTools, "WebFetch"]} : b);
    let started = 0;
    const counting: ExecutorPair = {...fakePair(), implementer: {identity: "I", implement: async () => { started++; throw new Error("must not start"); }}, reviewer: {identity: "R", review: async () => { started++; throw new Error("must not start"); }}};
    const table: Array<[string, string, string, string, typeof FIRST_DELIVERY_BINDINGS?]> = [
      ["delivery has no procedure", "UASCO-0232", "EV-01", "NO_PROCEDURE:delivery"],
      ["unbound role", "UASCO-0001", "EV-01", "ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING"], ["EV-02 has no procedure", DEV, "EV-02", "NO_PROCEDURE:EV-02"], ["EV-06", REVIEWER, "EV-06", "NO_PROCEDURE:EV-06"],
      ["malformed role", "../UASCO-0085", "EV-01", "EVALUATION_BAD_IDS"], ["malformed evaluation", DEV, "EV-01/../x", "EVALUATION_BAD_IDS"], ["empty", "", "", "EVALUATION_BAD_IDS"],
      ["widened tool list", DEV, "EV-01", "ROLE_NOT_EXECUTABLE:TOOL_NOT_ALLOWED", widened]
    ];
    for (const [label, role, ev, reason, bindings] of table) {
      const r = await runRoleEvaluation({repoRoot: REPO, stagingRoot: stagingOf(), pair: counting, ...(bindings ? {bindings} : {})}, role, ev);
      expect([label, r]).toEqual([label, {status: "REFUSED", reason}]);
    }
    expect(started).toBe(0);
    expect(EVALUATION_PROCEDURES.flatMap(p => p.functions).sort()).toEqual(["architect", "business-analyst", "developer", "planner", "requirements-engineer", "security-reviewer", "tester", "ux-designer"]);
    expect(planFor(DEV, "EV-01")).toMatchObject({procedure: {version: "golden-file-v1"}});
  });

  it("evidence is never overwritten: a second run is refused BEFORE the executor starts and the staged bytes are unchanged", { timeout: 120_000 }, async () => {
    const root = stagingOf();
    const first = evaluated(await evaluate(fakePair(), DEV, {stagingRoot: root}));
    const bytes = fs.readFileSync(first.evidenceFile);
    let started = 0;
    const second = await evaluate({...fakePair(), implementer: {identity: "I", implement: async () => { started++; throw new Error("no"); }}}, DEV, {stagingRoot: root});
    expect(second).toEqual({status: "REFUSED", reason: "STAGING_EVIDENCE_EXISTS"});
    expect(started).toBe(0);
    expect(fs.readFileSync(first.evidenceFile).equals(bytes)).toBe(true);
    // a leftover artifact alone (interrupted write) also blocks, again before the executor starts (no wasted call)
    const partial = stagingOf(); const p = new EvaluationStaging(partial, REPO);
    p.write(DEV, "EV-01", "artifact", "{}\n");
    started = 0;
    const third = await evaluate({...fakePair(), implementer: {identity: "I", implement: async () => { started++; throw new Error("no"); }}}, DEV, {stagingRoot: partial});
    expect(third).toEqual({status: "REFUSED", reason: "STAGING_EVIDENCE_EXISTS"});
    expect(started).toBe(0);
  });

  it("the verdict is a pure function of the checks: no checks is no verdict (an empty set never passes), one failing check fails", () => {
    expect([verdictOf([]), verdictOf([{id: "a", passed: true, detail: ""}]), verdictOf([{id: "a", passed: true, detail: ""}, {id: "b", passed: false, detail: ""}])]).toEqual([null, "PASSED", "FAILED"]);
  });

  it("secret-like text controlled by the model or agent (file names, logs, model output) is redacted in BOTH staged files", { timeout: 120_000 }, async () => {
    const KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join(""); // assembled at runtime so the repository secret scan never sees a literal key
    const dev = evaluated(await evaluate(fakePair({implement: () => ({files: {"greeting.txt": "hello\n", [`${KEY}.txt`]: "x\n"}})}), DEV));
    expect(dev.verdict).toBe("FAILED");
    for (const f of [dev.evidenceFile, dev.artifactFile]) expect(fs.readFileSync(f, "utf8")).not.toContain(KEY);
    expect(fs.readFileSync(dev.evidenceFile, "utf8")).toContain("[REDACTED:AWS_ACCESS_KEY]");
    const pre = evaluated(await evaluate(predevPair(() => `not json ${KEY}`), BA));
    expect(pre.verdict).toBe("FAILED");
    expect(fs.readFileSync(pre.artifactFile, "utf8")).not.toContain(KEY);
    expect(fs.readFileSync(pre.artifactFile, "utf8")).toContain("[REDACTED:AWS_ACCESS_KEY]");
    // secrets that START a line (serialized as backslash-n before the key, where a word boundary does not match) are redacted too, in values and in check details
    const nl = evaluated(await evaluate(predevPair(() => `{\n${KEY}\n}`), BA));
    for (const f of [nl.artifactFile, nl.evidenceFile]) expect(fs.readFileSync(f, "utf8")).not.toContain(KEY);
    expect(fs.readFileSync(nl.artifactFile, "utf8")).toContain("[REDACTED:AWS_ACCESS_KEY]");
    // redaction leaves a FAKE pair's evidence intact but it is still rejected as FAKE_EVIDENCE; that NON-FAKE redacted evidence verifies (hash bound to the redacted bytes) is pinned by the next test
    expect(createEvidenceVerifier(path.resolve(path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(dev.evidenceFile)))))))(dev.evidenceRef, DEV, "EV-01", "FAILED")).toBe("FAKE_EVIDENCE");
  });

  it("redacted evidence from a NON-FAKE pair still verifies: the verifier accepts it (null) and the evidence hash binds the redacted artifact bytes", { timeout: 120_000 }, async () => {
    const KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const root = stagingOf();
    // test-only: a pair object that claims LOCAL_CLAUDE (production builds it only from LocalClaudeExecutors)
    const claims: ExecutorPair = {...fakePair({implement: () => ({files: {"greeting.txt": "hello\n", [`${KEY}.txt`]: "x\n"}})}), kind: "LOCAL_CLAUDE"};
    const r = evaluated(await evaluate(claims, DEV, {stagingRoot: root}));
    expect([r.verdict, r.executorKind, r.verifier]).toEqual(["FAILED", "LOCAL_CLAUDE", {countsIfPromoted: true, problem: null}]);
    for (const f of [r.evidenceFile, r.artifactFile]) expect(fs.readFileSync(f, "utf8")).not.toContain(KEY);
    expect(fs.readFileSync(r.artifactFile, "utf8")).toContain("[REDACTED:AWS_ACCESS_KEY]");
    expect(JSON.parse(fs.readFileSync(r.evidenceFile, "utf8")).artifactSha256).toBe(sha(fs.readFileSync(r.artifactFile)));
    expect(createEvidenceVerifier(root)(r.evidenceRef, DEV, "EV-01", "FAILED")).toBeNull();
  });

  // //TR: Satır sonu içeren dosya adı Windows'ta VAR OLAMAZ (dolayısıyla tehdit de yoktur); bu durum orada ATLANIR ve sonuçta "skipped" görünür. Windows'ta dosya adındaki gizli anahtarın redaksiyonunu yukarıdaki `${KEY}.txt` durumu kapsar.
  it.skipIf(process.platform === "win32")("a secret on a line of its own INSIDE a file name (line break in the name, POSIX only) is redacted in both staged files too", { timeout: 120_000 }, async () => {
    const KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const named = evaluated(await evaluate(fakePair({implement: () => ({files: {"greeting.txt": "hello\n", [`a\n${KEY}.txt`]: "x\n"}})}), DEV));
    expect(JSON.stringify(named)).not.toContain(KEY);
    for (const f of [named.artifactFile, named.evidenceFile]) expect(fs.readFileSync(f, "utf8")).not.toContain(KEY);
    expect(fs.readFileSync(named.artifactFile, "utf8")).toContain("[REDACTED:AWS_ACCESS_KEY]");
  });

  describe("staging confinement", () => {
    it("never inside the repository (root, audit/, registries/, an ancestor of the repo) or relative; nothing is written there", async () => {
      const before = repoSnapshot();
      for (const [label, root, reason] of [["the repo root itself", REPO, "STAGING_INSIDE_REPOSITORY"], ["audit/", path.join(REPO, "audit"), "STAGING_INSIDE_REPOSITORY"], ["audit/evidence", path.join(REPO, "audit", "evidence"), "STAGING_INSIDE_REPOSITORY"],
        ["registries/", path.join(REPO, "registries", "evaluations-staging"), "STAGING_INSIDE_REPOSITORY"], ["a protected path", path.join(REPO, "config", "x"), "STAGING_INSIDE_REPOSITORY"],
        ["an ancestor of the repo", path.dirname(REPO), "STAGING_INSIDE_REPOSITORY"], ["relative", "evaluations/staging", "STAGING_ROOT_NOT_ABSOLUTE"]] as const) {
        expect([label, await evaluate(fakePair(), DEV, {stagingRoot: root})]).toEqual([label, {status: "REFUSED", reason}]);
      }
      expect(repoSnapshot()).toBe(before);
    });
    it("a directory merely NAMED like '..x' is not a parent escape: roots inside the repo (or above a repo whose directory starts with '..') are still refused", () => {
      for (const root of [path.join(REPO, "..x", "s"), path.join(REPO, "..data", "evaluations", "staging")]) expect(() => new EvaluationStaging(root, REPO)).toThrow(/STAGING_INSIDE_REPOSITORY/);
      const odd = path.join(workDir(), "..repo"); fs.mkdirSync(odd);
      expect(() => new EvaluationStaging(path.dirname(odd), odd)).toThrow(/STAGING_INSIDE_REPOSITORY/);      // staging root above a repo called '..repo'
      expect(() => new EvaluationStaging(path.join(odd, "..x"), odd)).toThrow(/STAGING_INSIDE_REPOSITORY/);  // inside it
      expect(() => new EvaluationStaging(path.join(workDir(), "sibling"), odd)).not.toThrow();                // a real sibling is fine
    });
    it("writability is probed BEFORE the executor starts and leaves no trace; an unwritable root is refused without a real run", async () => {
      let started = 0;
      const counting: ExecutorPair = {...fakePair(), implementer: {identity: "I", implement: async () => { started++; throw new Error("must not start"); }}};
      const blocker = path.join(workDir(), "a-file"); fs.writeFileSync(blocker, "x");
      const o = await evaluate(counting, DEV, {stagingRoot: path.join(blocker, "x", "evaluations", "staging")});
      expect(o.status).toBe("REFUSED"); expect((o as {reason: string}).reason).toMatch(/^STAGING_/);
      expect(started).toBe(0);
      const ok = stagingOf(), st = new EvaluationStaging(ok, REPO);
      st.preflight(DEV, "EV-01");
      expect(listing(ok)).toEqual([]); // the probe removed everything it created
      expect(() => st.write(DEV, "EV-01", "artifact", "{}\n")).not.toThrow();
    });
    it("the probe leaves no trace even when the root's own parents do not exist yet (<data dir>/evaluations is not left behind); a NOT_EXECUTED run leaves the data dir empty; a real write still creates the whole chain", async () => {
      const d = workDir(), root = path.join(d, "evaluations", "staging");
      new EvaluationStaging(root, REPO).preflight(DEV, "EV-01");
      expect(fs.readdirSync(d)).toEqual([]);
      const o = await evaluate(fakePair({implement: () => ({exitCode: 1})}), DEV, {stagingRoot: root});
      expect(o).toMatchObject({status: "NOT_EXECUTED", reason: "IMPLEMENT_EXIT_NONZERO"});
      expect(fs.readdirSync(d)).toEqual([]);
      const written = new EvaluationStaging(root, REPO).write(DEV, "EV-01", "artifact", "{}\n");
      expect(path.relative(d, written).split(path.sep)).toEqual(["evaluations", "staging", "audit", "evidence", "role-evaluations", DEV, "EV-01.artifact.json"]);
    });
    it.skipIf(process.platform === "win32")("a symlinked ANCESTOR of the staging root is refused too (writes could land outside the data dir); a real path is accepted", () => {
      const real = workDir(), alias = path.join(workDir(), "alias"); fs.symlinkSync(real, alias);
      expect(() => new EvaluationStaging(path.join(alias, "evaluations", "staging"), REPO)).toThrow(/STAGING_SYMLINK_REFUSED/);
      expect(() => new EvaluationStaging(path.join(real, "evaluations", "staging"), REPO)).not.toThrow();
    });
    it("names are fixed: path traversal in role or evaluation id is impossible", () => {
      const st = new EvaluationStaging(stagingOf(), REPO);
      for (const [r, e] of [["../x", "EV-01"], ["UASCO-0085", "../EV-01"], ["UASCO-0085/..", "EV-01"], ["uasco-0085", "EV-01"], ["UASCO-0085", "EV-07"], ["", ""]]) expect(() => st.evidencePaths(r, e)).toThrow(EvaluationStagingError);
      expect(() => st.write("UASCO-0085", "EV-01", "artifact" as const, "{}")).not.toThrow();
    });
    it.skipIf(process.platform === "win32")("symlinks are refused: the staging root, a component under it, the role dir and an existing target file", () => {
      const real = workDir(), repoAudit = path.join(REPO, "audit");
      // 1) the staging root is a symlink
      const link = path.join(workDir(), "link"); fs.symlinkSync(real, link);
      expect(() => new EvaluationStaging(link, REPO)).toThrow(/STAGING_SYMLINK_REFUSED/);
      // 2) a component under the root points at the repository's audit dir
      const root2 = stagingOf(); fs.mkdirSync(root2, {recursive: true}); fs.symlinkSync(repoAudit, path.join(root2, "audit"));
      expect(() => new EvaluationStaging(root2, REPO)).toThrow(/STAGING_SYMLINK_REFUSED|STAGING_INSIDE_REPOSITORY/);
      expect(listing(path.join(REPO, "audit", "evidence", "role-evaluations")).includes("UASCO-0085")).toBe(false);
      // 3) the role dir is a symlink to somewhere else
      const root3 = stagingOf(), elsewhere = workDir(); const st3 = new EvaluationStaging(root3, REPO);
      fs.mkdirSync(path.join(root3, "audit", "evidence", "role-evaluations"), {recursive: true});
      fs.symlinkSync(elsewhere, path.join(root3, "audit", "evidence", "role-evaluations", "UASCO-0085"));
      expect(() => st3.write("UASCO-0085", "EV-01", "artifact", "{}")).toThrow(/STAGING_SYMLINK_REFUSED/);
      expect(listing(elsewhere)).toEqual([]);
      // 4) the target file is a pre-existing symlink: counted as existing, never followed or replaced
      const root4 = stagingOf(), victim = path.join(workDir(), "victim.txt"); fs.writeFileSync(victim, "keep\n");
      const st4 = new EvaluationStaging(root4, REPO); st4.write("UASCO-0085", "EV-02", "artifact", "{}\n");
      fs.symlinkSync(victim, path.join(root4, "audit", "evidence", "role-evaluations", "UASCO-0085", "EV-01.json"));
      expect(st4.exists("UASCO-0085", "EV-01")).toBe(true);
      expect(() => st4.write("UASCO-0085", "EV-01", "evidence", "overwritten\n")).toThrow(/STAGING_EVIDENCE_EXISTS/);
      expect(fs.readFileSync(victim, "utf8")).toBe("keep\n");
    });
  });

  it("ambient GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE never redirect the temporary repositories: the pipeline works, a decoy repository stays untouched, and --execute is blocked while they are set", { timeout: 120_000 }, async () => {
    const decoy = workDir(); cp.spawnSync("git", ["init", "-q", "--bare", "-b", "main", decoy]);
    const objects = workDir(); // a decoy object store: with GIT_OBJECT_DIRECTORY leaking through, git would write the temporary repositories' objects here
    const keep: Record<string, string | undefined> = {GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY: process.env.GIT_OBJECT_DIRECTORY};
    process.env.GIT_DIR = decoy; process.env.GIT_WORK_TREE = workDir(); process.env.GIT_INDEX_FILE = path.join(workDir(), "idx"); process.env.GIT_OBJECT_DIRECTORY = objects;
    let dev: EvaluationOutcome, rev: EvaluationOutcome;
    try { dev = await evaluate(fakePair(), DEV); rev = await evaluate(fakePair(), REVIEWER); }
    finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    expect([dev.status, rev.status]).toEqual(["EVALUATED", "EVALUATED"]);
    expect(evaluated(dev).verdict).toBe("PASSED"); expect(evaluated(rev).verdict).toBe("PASSED");
    expect(cp.spawnSync("git", ["--git-dir", decoy, "rev-list", "--all", "--count"], {encoding: "utf8"}).stdout.trim()).toBe("0");
    expect(listing(objects)).toEqual([]);
    const control = workDir();
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {GIT_DIR: decoy}})).toContain("GIT_ENVIRONMENT_OVERRIDE");
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {git_work_tree: "/x"}})).toContain("GIT_ENVIRONMENT_OVERRIDE");
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {GIT_DIR: ""}})).not.toContain("GIT_ENVIRONMENT_OVERRIDE");
  });

  // Git configuration injected by the environment or a user-level config can make git RUN a program (hooks, core.fsmonitor): the temporary repositories must never see it.
  const hookScript = (dir: string, name: string, marker: string): string => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/bin/sh\necho ran >> "${marker}"\nexit 0\n`); fs.chmodSync(f, 0o755); return f; };
  const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
    const keep = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  // //TR: Bu test TEMİZLEME (scrub) katmanını sabitler: paylaşılan git izolasyonu (git-isolation.mjs) hooksPath'i ezer ve GIT_CONFIG_COUNT/KEY/VALUE'yu siler ama GIT_CONFIG_PARAMETERS'a DOKUNMAZ. Bir "clean filter" sürücüsü hattın kendi `git add -A` komutu sırasında çalışır; ortam değişkeni geçerse işaret dosyası yazılır.
  const filterScript = (dir: string, marker: string): string => { const f = path.join(dir, "clean.sh"); fs.writeFileSync(f, `#!/bin/sh\necho ran >> "${marker}"\ncat\n`); fs.chmodSync(f, 0o755); return f; };
  it.skipIf(process.platform === "win32")("GIT_CONFIG_PARAMETERS never reaches the temporary repositories: a clean-filter driver that would run during the pipeline's own `git add -A` stays unrun (the scrub is what stops it); --execute is blocked while GIT_CONFIG_* variables are set", { timeout: 180_000 }, async () => {
    const dir = workDir(), marker = path.join(workDir(), "ran"), attrs = path.join(dir, "attrs"), script = filterScript(dir, marker);
    fs.writeFileSync(attrs, "* filter=x\n");
    const vars = {GIT_CONFIG_PARAMETERS: `'core.attributesfile'='${attrs}' 'filter.x.clean'='${script}'`};
    await withEnv(vars, async () => {
      // the injection is real: a plain git add with this environment runs the filter (so the assertion below is not vacuous)
      const plain = workDir(); cp.spawnSync("git", ["init", "-q", plain]); fs.writeFileSync(path.join(plain, "f"), "x\n");
      cp.spawnSync("git", ["add", "-A"], {cwd: plain, env: process.env});
      expect(fs.existsSync(marker)).toBe(true); fs.rmSync(marker);
      const dev = evaluated(await evaluate(fakePair(), DEV)), rev = evaluated(await evaluate(fakePair(), REVIEWER));
      expect([dev.verdict, rev.verdict, fs.existsSync(marker)]).toEqual(["PASSED", "PASSED", false]);
    });
    const ok = {repoRoot: REPO, dataDir: workDir(), controlRoot: workDir()};
    for (const env of [{GIT_CONFIG_PARAMETERS: "'core.fsmonitor=x'"}, {GIT_CONFIG_COUNT: "1"}, {GIT_CONFIG_KEY_0: "core.hooksPath"}, {GIT_CONFIG_VALUE_12: "/x"}, {git_config_parameters: "'a=b'"}])
      expect([env, executeBlockers({...ok, env})]).toEqual([env, expect.arrayContaining(["GIT_ENVIRONMENT_OVERRIDE"])]);
    expect(executeBlockers({...ok, env: {GIT_CONFIG_NOSYSTEM: "1"}})).not.toContain("GIT_ENVIRONMENT_OVERRIDE"); // only variables that inject config or select the repository
  });
  // //TR: Aşağıdaki iki durum paylaşılan git izolasyonu tarafından sabitlenir (temizleme katmanından bağımsız): `-c core.hooksPath=<izole>` ve COUNT/KEY/VALUE silme. Uçtan uca bir gerileme sigortasıdır; temizleme mutantlarını ÖLDÜRMEZ.
  it.skipIf(process.platform === "win32")("hooksPath injected through GIT_CONFIG_PARAMETERS or GIT_CONFIG_COUNT stays unrun (pinned by the shared git isolation, end-to-end regression guard)", { timeout: 180_000 }, async () => {
    const hooks = workDir(), marker = path.join(workDir(), "ran"); hookScript(hooks, "post-commit", marker);
    const styles: Array<[string, Record<string, string>]> = [
      ["GIT_CONFIG_PARAMETERS", {GIT_CONFIG_PARAMETERS: `'core.hooksPath=${hooks}'`}],
      ["GIT_CONFIG_COUNT", {GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: hooks}]
    ];
    for (const [label, vars] of styles) {
      await withEnv(vars, async () => {
        const plain = workDir(); cp.spawnSync("git", ["init", "-q", plain]);
        cp.spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x"], {cwd: plain, env: process.env});
        expect([label, fs.existsSync(marker)]).toEqual([label, true]); fs.rmSync(marker);
        const dev = evaluated(await evaluate(fakePair(), DEV)), rev = evaluated(await evaluate(fakePair(), REVIEWER));
        expect([label, dev.verdict, rev.verdict, fs.existsSync(marker)]).toEqual([label, "PASSED", "PASSED", false]);
      });
    }
  });
  it.skipIf(process.platform === "win32")("a repo-local core.fsmonitor planted in the review clone by the reviewer cannot make the pipeline's own git calls run a program (core.fsmonitor=false is pinned)", { timeout: 120_000 }, async () => {
    const marker = path.join(workDir(), "ran"), hook = hookScript(workDir(), "fsm.sh", marker);
    const planted = `[core]\n\tfsmonitor = ${hook}\n`;
    const sane = workDir(); cp.spawnSync("git", ["init", "-q", sane]); fs.appendFileSync(path.join(sane, ".git", "config"), planted); fs.writeFileSync(path.join(sane, "f"), "x\n");
    cp.spawnSync("git", ["status", "--porcelain"], {cwd: sane});
    expect(fs.existsSync(marker)).toBe(true); fs.rmSync(marker); // the planted config really runs the hook for a plain git
    const base = fakePair();
    const hostile: ExecutorPair = {...base, reviewer: {identity: base.reviewer.identity, review: async (ws, spec, diff, ctx) => { const r = await base.reviewer.review(ws, spec, diff, ctx); fs.appendFileSync(path.join(ws, ".git", "config"), planted); return r; }}};
    const rev = await evaluate(hostile, REVIEWER);
    expect(rev.status).toBe("EVALUATED");
    expect(fs.existsSync(marker)).toBe(false);
  });
  it.skipIf(process.platform === "win32")("a user-level git config (core.fsmonitor in ~/.gitconfig) cannot run a program in the temporary repositories (the pipeline's git is isolated from it)", { timeout: 180_000 }, async () => {
    const home = workDir(), marker = path.join(workDir(), "ran"), hook = hookScript(workDir(), "fsm.sh", marker);
    fs.writeFileSync(path.join(home, ".gitconfig"), `[core]\n\tfsmonitor = ${hook}\n`);
    const vars = {HOME: home, XDG_CONFIG_HOME: path.join(home, ".config")};
    await withEnv(vars, async () => {
      const plain = workDir(); cp.spawnSync("git", ["init", "-q", plain]); fs.writeFileSync(path.join(plain, "f"), "x\n");
      cp.spawnSync("git", ["status", "--porcelain"], {cwd: plain, env: process.env});
      expect(fs.existsSync(marker)).toBe(true); fs.rmSync(marker); // the user-level config really runs the hook for a plain git
      const dev = evaluated(await evaluate(fakePair(), DEV)), rev = evaluated(await evaluate(fakePair(), REVIEWER));
      expect([dev.verdict, rev.verdict, fs.existsSync(marker)]).toEqual(["PASSED", "PASSED", false]);
    });
  });

  describe("lifecycle: staged evidence only counts when it is genuinely non-FAKE and intact", () => {
    // Promotion simulation (a protected step in reality): copy the staged tree verbatim into a throw-away "repo" with a registry copy.
    const promote = (stagingRoot: string, role: string, status: string) => {
      const repo = workDir(); fs.cpSync(path.join(stagingRoot, "audit"), path.join(repo, "audit"), {recursive: true});
      const r = JSON.parse(JSON.stringify(roles.find(x => x.roleId === role)!)); r.evaluationSpecs[0] = {...r.evaluationSpecs[0], status};
      return {repo, role: r};
    };
    const life = (repo: string, role: any) => roleLifecycle(role, roles as any, {bindings: FIRST_DELIVERY_BINDINGS, verify: createEvidenceVerifier(repo), runningRoleIds: new Set(), nowMs: Date.now()});
    const withRef = (role: any, o: Extract<EvaluationOutcome, {status: "EVALUATED"}>) => { role.evaluationSpecs[0].evaluatorEvidenceRef = o.evidenceRef; return role; };

    it("FAKE evidence promoted verbatim still does not make the role TESTED; the same pipeline output from a non-FAKE pair does (format compatible) - for PASSED and FAILED alike", { timeout: 180_000 }, async () => {
      const fake = stagingOf(), real = stagingOf();
      const f = evaluated(await evaluate(fakePair(), DEV, {stagingRoot: fake}));
      const pf = promote(fake, DEV, "PASSED");
      expect(life(pf.repo, withRef(pf.role, f)).tested).toBe(false);
      // test-only: a pair object that claims LOCAL_CLAUDE (production builds it only from LocalClaudeExecutors)
      const claims = (o: Partial<FakeScript> = {}): ExecutorPair => ({...fakePair(o), kind: "LOCAL_CLAUDE"});
      const r = evaluated(await evaluate(claims(), DEV, {stagingRoot: real}));
      expect([r.executorKind, r.verifier]).toEqual(["LOCAL_CLAUDE", {countsIfPromoted: true, problem: null}]);
      const pr = promote(real, DEV, "PASSED");
      expect(life(pr.repo, withRef(pr.role, r))).toMatchObject({tested: true, certified: false});
      const failedRoot = stagingOf();
      const bad = evaluated(await evaluate(claims({implement: () => ({files: {"greeting.txt": "nope\n"}})}), DEV, {stagingRoot: failedRoot}));
      expect(bad.verdict).toBe("FAILED");
      const pb = promote(failedRoot, DEV, "FAILED");
      expect(life(pb.repo, withRef(pb.role, bad)).tested).toBe(true); // TESTED = executed with verified evidence; the verdict is read separately
      // a PASSED claim on FAILED evidence, or a spec for another role / evaluation, is rejected by the verifier
      const lie = promote(failedRoot, DEV, "PASSED");
      expect(life(lie.repo, withRef(lie.role, bad)).tested).toBe(false);
    });

    it("the tester's staged evidence follows the same rule: FAKE never counts, a non-FAKE pair's counts (executed, not 'passed')", { timeout: 180_000 }, async () => {
      const good = {implement: () => ({files: {"test/add.test.js": TESTER_GOOD}})};
      const fake = stagingOf(), real = stagingOf();
      const f = evaluated(await evaluate(fakePair(good), TESTER, {stagingRoot: fake}));
      const pf = promote(fake, TESTER, "PASSED");
      expect(life(pf.repo, withRef(pf.role, f)).tested).toBe(false);
      const r = evaluated(await evaluate({...fakePair(good), kind: "LOCAL_CLAUDE"}, TESTER, {stagingRoot: real}));
      const pr = promote(real, TESTER, "PASSED");
      expect(life(pr.repo, withRef(pr.role, r))).toMatchObject({tested: true, certified: false});
    });

    it("tampering after staging is caught by the verifier: evidence bytes, artifact bytes, a swapped role directory", { timeout: 180_000 }, async () => {
      const root = stagingOf();
      const r = evaluated(await evaluate({...fakePair(), kind: "LOCAL_CLAUDE"}, DEV, {stagingRoot: root}));
      const base = (mutate: (repo: string) => void) => { const p = promote(root, DEV, "PASSED"); mutate(p.repo); return life(p.repo, withRef(p.role, r)).tested; };
      const dir = (repo: string) => path.join(repo, "audit", "evidence", "role-evaluations", DEV);
      expect(base(() => undefined)).toBe(true);
      expect(base(repo => fs.appendFileSync(path.join(dir(repo), "EV-01.json"), " "))).toBe(false);
      expect(base(repo => fs.appendFileSync(path.join(dir(repo), "EV-01.artifact.json"), " "))).toBe(false);
      expect(base(repo => { const d = path.join(repo, "audit", "evidence", "role-evaluations"); fs.renameSync(path.join(d, DEV), path.join(d, "UASCO-0313")); })).toBe(false);
    });

    // //TR: Windows'ta symlink oluşturmak ayrıcalık ister; test orada ATLANIR ve sonuçta "skipped" görünür (sessiz geçiş yok).
    it.skipIf(process.platform === "win32")("a symlinked artifact in the promoted copy is rejected by the verifier", { timeout: 180_000 }, async () => {
      const root = stagingOf();
      const r = evaluated(await evaluate({...fakePair(), kind: "LOCAL_CLAUDE"}, DEV, {stagingRoot: root}));
      const p = promote(root, DEV, "PASSED");
      expect(life(p.repo, withRef(JSON.parse(JSON.stringify(p.role)), r)).tested).toBe(true); // control: the untouched copy counts
      const f = path.join(p.repo, "audit", "evidence", "role-evaluations", DEV, "EV-01.artifact.json"), o = path.join(workDir(), "art.json");
      fs.copyFileSync(f, o); fs.rmSync(f); fs.symlinkSync(o, f);
      expect(life(p.repo, withRef(p.role, r)).tested).toBe(false);
    });
  });

  describe("command line: dry run by default, execute only under the Founder's existing authority, never in CI", () => {
    const script = path.join(REPO, "scripts", "run-role-evaluation.mjs");
    const sh = (args: string[], env: NodeJS.ProcessEnv = {}) => cp.spawnSync(process.execPath, [script, ...args], {cwd: REPO, encoding: "utf8", env: {...process.env, CI: "", GITHUB_ACTIONS: "", UASCO_WORKOS_EXECUTOR: "", GIT_DIR: "", GIT_WORK_TREE: "", GIT_INDEX_FILE: "", ...env}});
    const controlRootWithProvenance = () => {
      const c = workDir(), shaOf = sha(fs.readFileSync(process.execPath));
      fs.mkdirSync(path.join(c, ".ai", "runtime"), {recursive: true});
      fs.writeFileSync(path.join(c, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: shaOf, version: "fake"}}));
      return c;
    };
    const enable = (dataDir: string) => { fs.mkdirSync(path.join(dataDir, "settings"), {recursive: true}); fs.writeFileSync(path.join(dataDir, "settings", "executors.json"), JSON.stringify({localClaude: {enabled: true, enabledAt: "x", enabledBy: "FOUNDER_LOCAL", launcherSha256: null, provenanceCapturedAt: null}})); };

    it("default is a DRY RUN: it prints the plan and the execute blockers, spawns nothing and writes nothing (not even the staging directory)", () => {
      const d = workDir(), r = sh(["--role", DEV, "--data-dir", d]);
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out).toMatchObject({mode: "DRY_RUN", willSpawn: false, willWrite: false, role: DEV, function: "developer", evaluation: "EV-01", procedure: {version: "golden-file-v1"}, staging: {root: path.join(d, "evaluations", "staging"), existingEvidence: false, problem: null}});
      expect(out.executeBlockers).toEqual(expect.arrayContaining(["EXECUTOR_NOT_ENABLED"]));
      expect(fs.readdirSync(d)).toEqual([]);
    });
    it("usage errors and roles without a procedure exit 2 and write nothing", () => {
      const d = workDir();
      for (const args of [[], ["--role", DEV], ["--role", DEV, "--data-dir", "relative/dir"], ["--role", DEV, "--data-dir", d, "--staging", "/tmp/x"], ["--role", DEV, "--data-dir", d, "--evaluation"], ["--role", "UASCO-0232", "--data-dir", d], ["--role", DEV, "--evaluation", "EV-04", "--data-dir", d]]) expect([args, sh(args).status]).toEqual([args, 2]);
      expect(fs.readdirSync(d)).toEqual([]);
      expect(parseArgs(["--role", DEV, "--data-dir", d])).toMatchObject({role: DEV, evaluation: "EV-01", execute: false});
    });
    it("--execute is refused unless EVERY gate holds: not in CI / GitHub Actions, allowPaidApi false, executor enabled by the Founder, provenance PASS", async () => {
      const d = workDir(), control = controlRootWithProvenance(), ok = {repoRoot: REPO, dataDir: d, controlRoot: control, env: {} as NodeJS.ProcessEnv, findClaudeCli: () => process.execPath};
      expect(executeBlockers(ok)).toEqual(["EXECUTOR_NOT_ENABLED"]);
      enable(d);
      expect(executeBlockers(ok)).toEqual([]);
      expect(executeBlockers({...ok, env: {CI: "true"}})).toEqual(["CI_ENVIRONMENT"]);
      expect(executeBlockers({...ok, env: {GITHUB_ACTIONS: "true"}})).toEqual(["CI_ENVIRONMENT"]);
      expect(executeBlockers({...ok, env: {CI: "0"}})).toEqual([]); // explicit false is not CI
      expect(executeBlockers({...ok, controlRoot: workDir()})).toEqual(expect.arrayContaining(["EXECUTOR_PROVENANCE_MISSING"]));
      const paid = workDir(); fs.mkdirSync(path.join(paid, "config"), {recursive: true});
      fs.copyFileSync(path.join(REPO, "config", "environment-policy.json"), path.join(paid, "config", "environment-policy.json"));
      for (const content of ['{"allowPaidApi": true}', '{"allowPaidApi": "false"}', "{}", "not json"]) { fs.writeFileSync(path.join(paid, "config", "automation.json"), content); expect([content, executeBlockers({...ok, repoRoot: paid})]).toEqual([content, expect.arrayContaining(["PAID_API_NOT_DISABLED"])]); }
      // the CLI itself: nothing runs and nothing is staged when a gate fails
      let made = 0;
      const out: string[] = [], err: string[] = [];
      const base = {repoRoot: REPO, out: (s: string) => out.push(s), err: (s: string) => err.push(s), makePair: () => { made++; return fakePair(); }, findClaudeCli: () => process.execPath};
      const d2 = workDir();
      expect(await runCli(["--role", DEV, "--data-dir", d2, "--execute", "--control-root", control], {...base, env: {}})).toBe(2);
      expect(await runCli(["--role", DEV, "--data-dir", d, "--execute", "--control-root", control], {...base, env: {CI: "1"}})).toBe(2);
      expect(err.join("")).toContain("EXECUTE_NOT_ALLOWED"); expect(err.join("")).toContain("CI_ENVIRONMENT");
      expect(made).toBe(0); expect(fs.readdirSync(d2)).toEqual([]); expect(listing(path.join(d, "evaluations"))).toEqual([]);
    });
    it("--execute with every gate satisfied stages FAKE-stamped evidence for an injected FAKE pair (the CLI itself cannot select a pair)", { timeout: 120_000 }, async () => {
      const d = workDir(), control = controlRootWithProvenance(); enable(d);
      const out: string[] = [], err: string[] = [];
      const code = await runCli(["--role", DEV, "--data-dir", d, "--execute", "--control-root", control], {repoRoot: REPO, env: {}, out: s => out.push(s), err: s => err.push(s), makePair: () => fakePair(), findClaudeCli: () => process.execPath});
      expect([code, err.join(""), code === 0 ? "" : out.join("")]).toEqual([0, "", ""]);
      const res = JSON.parse(out.join(""));
      expect(res).toMatchObject({mode: "EXECUTED", status: "EVALUATED", verdict: "PASSED", executorKind: "FAKE", verifier: {countsIfPromoted: false, problem: "FAKE_EVIDENCE"}});
      expect(res.evidenceFile.startsWith(path.join(d, "evaluations", "staging"))).toBe(true);
      const again: string[] = [];
      expect(await runCli(["--role", DEV, "--data-dir", d, "--execute", "--control-root", control], {repoRoot: REPO, env: {}, out: s => again.push(s), err: s => again.push(s), makePair: () => fakePair(), findClaudeCli: () => process.execPath})).toBe(2);
      expect(again.join("")).toContain("STAGING_EVIDENCE_EXISTS");
    });
    const login = (control: string, role: "implementer" | "reviewer") => { const dir = path.join(control, "claude-profiles", role); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, ".credentials.json"), "{}"); };
    const cli = async (args: string[], o: {env?: NodeJS.ProcessEnv; makePair?: () => ExecutorPair} = {}) => {
      const out: string[] = [], err: string[] = [];
      const code = await runCli(args, {repoRoot: REPO, env: o.env ?? {}, out: s => out.push(s), err: s => err.push(s), findClaudeCli: () => process.execPath, ...(o.makePair ? {makePair: o.makePair} : {})});
      return {code, out: out.join(""), err: err.join("")};
    };
    it("the control root follows the server's ORDER (--control-root, then UASCO_CONTROL_ROOT, then the repo root) plus two deliberate differences (empty is unset, relative is refused; see the authority doc) and the dry run prints the root it used", async () => {
      expect([resolveControlRoot("/a", {UASCO_CONTROL_ROOT: "/b"}, "/r"), resolveControlRoot(null, {UASCO_CONTROL_ROOT: "/b"}, "/r"), resolveControlRoot(null, {}, "/r")]).toEqual(["/a", "/b", "/r"]);
      expect([resolveControlRoot(null, {UASCO_CONTROL_ROOT: ""}, "/r"), resolveControlRoot("", {UASCO_CONTROL_ROOT: "/b"}, "/r"), resolveControlRoot("", {}, "/r")]).toEqual(["/r", "/b", "/r"]);
      const d = workDir(), c = workDir(), other = workDir();
      const used = async (extra: string[], env: NodeJS.ProcessEnv) => JSON.parse((await cli(["--role", DEV, "--data-dir", d, ...extra], {env})).out).controlRoot;
      expect([await used([], {UASCO_CONTROL_ROOT: c}), await used(["--control-root", other], {UASCO_CONTROL_ROOT: c}), await used([], {}), await used([], {UASCO_CONTROL_ROOT: ""})]).toEqual([c, other, REPO, REPO]);
      // a relative value from the environment is refused like the flag (on the developer/tester route the broker would resolve it against the workspace, so --execute could never work there even though the dry run shows no blocker); nothing is written, no plan is printed
      for (const extra of [[], ["--execute"]]) {
        const rel = await cli(["--role", DEV, "--data-dir", d, ...extra], {env: {UASCO_CONTROL_ROOT: "relative/dir"}});
        expect([extra, rel.code, rel.out]).toEqual([extra, 2, ""]);
        expect(JSON.parse(rel.err)).toMatchObject({status: "USAGE", error: "CONTROL_ROOT_MUST_BE_ABSOLUTE"});
      }
      expect(fs.readdirSync(d)).toEqual([]);
      // the executor state is read under the SAME root: the provenance of UASCO_CONTROL_ROOT is what counts
      const control = controlRootWithProvenance(); enable(d);
      expect((JSON.parse((await cli(["--role", DEV, "--data-dir", d], {env: {UASCO_CONTROL_ROOT: control}})).out).executeBlockers as string[]).filter(b => b.startsWith("EXECUTOR_"))).toEqual([]);
      // an explicit, EMPTY control root (never the default repo root: a checkout may hold its own gitignored .ai/runtime/PROVIDER_PROVENANCE.json)
      expect(JSON.parse((await cli(["--role", DEV, "--data-dir", d, "--control-root", workDir()])).out).executeBlockers).toEqual(expect.arrayContaining(["EXECUTOR_PROVENANCE_MISSING"]));
    });
    it("the dry run lists the Claude profile blockers --execute would hit (profile inside a git worktree, login missing) per role route and clears them after login; an injected pair skips the check", async () => {
      const blockersFor = async (role: string, control: string, o: {makePair?: () => ExecutorPair} = {}) => JSON.parse((await cli(["--role", role, "--data-dir", workDir(), "--control-root", control], o)).out).executeBlockers as string[];
      const profileBlockers = (b: string[]) => b.filter(x => x.startsWith("CLAUDE_PROFILE_"));
      // 1) a control root inside a git worktree (the default when no control root is given and the repo root is a checkout)
      const inGit = workDir(); cp.spawnSync("git", ["init", "-q", inGit]);
      expect(profileBlockers(await blockersFor(DEV, inGit))).toEqual(["CLAUDE_PROFILE_IMPLEMENTER_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE"]);
      expect(profileBlockers(await blockersFor(REVIEWER, inGit))).toEqual(["CLAUDE_PROFILE_REVIEWER_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE"]);
      expect(profileBlockers(await blockersFor(DEV, inGit, {makePair: () => fakePair()}))).toEqual([]);
      // 2) outside any worktree: login missing, per route (pre-dev roles use the REVIEWER profile, developer and tester the IMPLEMENTER profile)
      const control = controlRootWithProvenance();
      expect(profileBlockers(await blockersFor(DEV, control))).toEqual(["CLAUDE_PROFILE_IMPLEMENTER_LOGIN_REQUIRED"]);
      expect(profileBlockers(await blockersFor(REVIEWER, control))).toEqual(["CLAUDE_PROFILE_REVIEWER_LOGIN_REQUIRED"]);
      expect(profileBlockers(await blockersFor(BA, control))).toEqual(["CLAUDE_PROFILE_REVIEWER_LOGIN_REQUIRED"]);
      // 3) after the Founder's login only the matching profile is cleared
      login(control, "implementer");
      expect([profileBlockers(await blockersFor(DEV, control)), profileBlockers(await blockersFor(REVIEWER, control))]).toEqual([[], ["CLAUDE_PROFILE_REVIEWER_LOGIN_REQUIRED"]]);
      login(control, "reviewer");
      expect(profileBlockers(await blockersFor(REVIEWER, control))).toEqual([]);
      // the same blockers refuse --execute (nothing runs, nothing is staged)
      const d = workDir(); enable(d);
      const r = await cli(["--role", BA, "--data-dir", d, "--execute", "--control-root", inGit]);
      expect([r.code, r.out]).toEqual([2, ""]);
      expect(JSON.parse(r.err)).toMatchObject({status: "REFUSED", reason: "EXECUTE_NOT_ALLOWED", blockers: expect.arrayContaining(["CLAUDE_PROFILE_REVIEWER_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE"])});
      expect(fs.readdirSync(d)).toEqual(["settings"]);
    });
    it("the real (non-injected) --execute path builds LocalClaudeExecutors, never the FAKE pair: a launcher that exits non-zero is NOT_EXECUTED (exit 1), nothing is staged and the data dir stays clean", { timeout: 120_000 }, async () => {
      const d = workDir(), control = controlRootWithProvenance(); enable(d); login(control, "implementer");
      const r = await cli(["--role", DEV, "--data-dir", d, "--execute", "--control-root", control]);
      expect(r.err).toBe("");
      expect(r.code).toBe(1);
      expect(JSON.parse(r.out)).toMatchObject({mode: "EXECUTED", status: "NOT_EXECUTED", roleId: DEV, evaluationId: "EV-01", reason: "IMPLEMENT_EXIT_NONZERO"});
      expect(listing(path.join(d, "evaluations"))).toEqual([]);
      expect(fs.readdirSync(d)).toEqual(["settings"]);
    });
  });
});
