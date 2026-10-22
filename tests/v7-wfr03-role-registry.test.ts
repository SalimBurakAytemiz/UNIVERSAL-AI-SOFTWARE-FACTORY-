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
import {EvaluationStaging, EvaluationStagingError, EVALUATION_PROCEDURES, planFor, runRoleEvaluation, verdictOf} from "../core/competency/evaluation-pipeline.js";
import type {EvaluationOutcome} from "../core/competency/evaluation-pipeline.js";
import {executeBlockers, parseArgs, runCli} from "../core/competency/evaluation-cli.js";
import {FakeExecutors, reviewerArgv} from "../core/workos/executors.js";
import type {ExecutorPair, FakeScript, ProcResult} from "../core/workos/executors.js";
import {ClaudePreDevBuilder} from "../core/workos/predev/claude-builder.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
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
  const DEV = "UASCO-0085", REVIEWER = "UASCO-0252", BA = "UASCO-0022";
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

  it("regular_file oracle: the right bytes committed as an executable file or as a symlink are FAILED, not PASSED", { timeout: 120_000 }, async () => {
    const mode = (kind: "exec" | "symlink"): ExecutorPair => {
      const fake = fakePair();
      return {...fake, implementer: {identity: "MODE_IMPL", async implement(ws, _spec, _ctx) {
        const at = new Date().toISOString(), g = (args: string[]) => cp.spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "-c", "commit.gpgsign=false", ...args], {cwd: ws, encoding: "utf8"});
        if (kind === "exec") { fs.writeFileSync(path.join(ws, "greeting.txt"), "hello\n"); g(["add", "-A"]); g(["update-index", "--chmod=+x", "greeting.txt"]); }
        else { fs.writeFileSync(path.join(ws, "target.txt"), "hello\n"); fs.symlinkSync("target.txt", path.join(ws, "greeting.txt")); g(["add", "-A"]); }
        g(["commit", "-q", "-m", "mode"]);
        return {exitCode: 0, log: "", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false};
      }}};
    };
    const exec = evaluated(await evaluate(mode("exec"), DEV));
    expect([exec.verdict, exec.checks.filter(c => !c.passed).map(c => c.id)]).toEqual(["FAILED", ["regular_file"]]);
    if (process.platform !== "win32") {
      const link = evaluated(await evaluate(mode("symlink"), DEV));
      expect(link.verdict).toBe("FAILED"); expect(link.checks.find(c => !c.passed)?.id).toBeDefined();
    }
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

  it("only procedures that exist are run: tester, delivery, unknown roles, other evaluation ids, malformed ids and unsafe bindings are refused before anything starts", async () => {
    const dev = FIRST_DELIVERY_BINDINGS.find(b => b.roleId === DEV)!;
    const widened = FIRST_DELIVERY_BINDINGS.map(b => b.roleId === DEV ? {...b, allowedTools: [...dev.allowedTools, "WebFetch"]} : b);
    let started = 0;
    const counting: ExecutorPair = {...fakePair(), implementer: {identity: "I", implement: async () => { started++; throw new Error("must not start"); }}, reviewer: {identity: "R", review: async () => { started++; throw new Error("must not start"); }}};
    const table: Array<[string, string, string, string, typeof FIRST_DELIVERY_BINDINGS?]> = [
      ["tester has no procedure", "UASCO-0313", "EV-01", "NO_PROCEDURE:tester"], ["delivery has no procedure", "UASCO-0232", "EV-01", "NO_PROCEDURE:delivery"],
      ["unbound role", "UASCO-0001", "EV-01", "ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING"], ["EV-02 has no procedure", DEV, "EV-02", "NO_PROCEDURE:EV-02"], ["EV-06", REVIEWER, "EV-06", "NO_PROCEDURE:EV-06"],
      ["malformed role", "../UASCO-0085", "EV-01", "EVALUATION_BAD_IDS"], ["malformed evaluation", DEV, "EV-01/../x", "EVALUATION_BAD_IDS"], ["empty", "", "", "EVALUATION_BAD_IDS"],
      ["widened tool list", DEV, "EV-01", "ROLE_NOT_EXECUTABLE:TOOL_NOT_ALLOWED", widened]
    ];
    for (const [label, role, ev, reason, bindings] of table) {
      const r = await runRoleEvaluation({repoRoot: REPO, stagingRoot: stagingOf(), pair: counting, ...(bindings ? {bindings} : {})}, role, ev);
      expect([label, r]).toEqual([label, {status: "REFUSED", reason}]);
    }
    expect(started).toBe(0);
    expect(EVALUATION_PROCEDURES.flatMap(p => p.functions).sort()).toEqual(["architect", "business-analyst", "developer", "planner", "requirements-engineer", "security-reviewer", "ux-designer"]);
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
    const named = evaluated(await evaluate(fakePair({implement: () => ({files: {"greeting.txt": "hello\n", [`a\n${KEY}.txt`]: "x\n"}})}), DEV));
    expect(JSON.stringify(named)).not.toContain(KEY);
    for (const f of [named.artifactFile, named.evidenceFile]) expect(fs.readFileSync(f, "utf8")).not.toContain(KEY);
    // the evidence hash binds the redacted bytes, so the staged file still verifies when the pair is non-FAKE
    expect(createEvidenceVerifier(path.resolve(path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(dev.evidenceFile)))))))(dev.evidenceRef, DEV, "EV-01", "FAILED")).toBe("FAKE_EVIDENCE");
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
    const keep: Record<string, string | undefined> = {GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE};
    process.env.GIT_DIR = decoy; process.env.GIT_WORK_TREE = workDir(); process.env.GIT_INDEX_FILE = path.join(workDir(), "idx");
    let dev: EvaluationOutcome, rev: EvaluationOutcome;
    try { dev = await evaluate(fakePair(), DEV); rev = await evaluate(fakePair(), REVIEWER); }
    finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    expect([dev.status, rev.status]).toEqual(["EVALUATED", "EVALUATED"]);
    expect(evaluated(dev).verdict).toBe("PASSED"); expect(evaluated(rev).verdict).toBe("PASSED");
    expect(cp.spawnSync("git", ["--git-dir", decoy, "rev-list", "--all", "--count"], {encoding: "utf8"}).stdout.trim()).toBe("0");
    const control = workDir();
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {GIT_DIR: decoy}})).toContain("GIT_ENVIRONMENT_OVERRIDE");
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {git_work_tree: "/x"}})).toContain("GIT_ENVIRONMENT_OVERRIDE");
    expect(executeBlockers({repoRoot: REPO, dataDir: workDir(), controlRoot: control, env: {GIT_DIR: ""}})).not.toContain("GIT_ENVIRONMENT_OVERRIDE");
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

    it("tampering after staging is caught by the verifier: evidence bytes, artifact bytes, a swapped role directory, a symlinked artifact", { timeout: 180_000 }, async () => {
      const root = stagingOf();
      const r = evaluated(await evaluate({...fakePair(), kind: "LOCAL_CLAUDE"}, DEV, {stagingRoot: root}));
      const base = (mutate: (repo: string) => void) => { const p = promote(root, DEV, "PASSED"); mutate(p.repo); return life(p.repo, withRef(p.role, r)).tested; };
      const dir = (repo: string) => path.join(repo, "audit", "evidence", "role-evaluations", DEV);
      expect(base(() => undefined)).toBe(true);
      expect(base(repo => fs.appendFileSync(path.join(dir(repo), "EV-01.json"), " "))).toBe(false);
      expect(base(repo => fs.appendFileSync(path.join(dir(repo), "EV-01.artifact.json"), " "))).toBe(false);
      expect(base(repo => { const d = path.join(repo, "audit", "evidence", "role-evaluations"); fs.renameSync(path.join(d, DEV), path.join(d, "UASCO-0313")); })).toBe(false);
      if (process.platform !== "win32") expect(base(repo => { const f = path.join(dir(repo), "EV-01.artifact.json"), o = path.join(workDir(), "art.json"); fs.copyFileSync(f, o); fs.rmSync(f); fs.symlinkSync(o, f); })).toBe(false);
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
      for (const args of [[], ["--role", DEV], ["--role", DEV, "--data-dir", "relative/dir"], ["--role", DEV, "--data-dir", d, "--staging", "/tmp/x"], ["--role", DEV, "--data-dir", d, "--evaluation"], ["--role", "UASCO-0313", "--data-dir", d], ["--role", DEV, "--evaluation", "EV-04", "--data-dir", d]]) expect([args, sh(args).status]).toEqual([args, 2]);
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
  });
});
