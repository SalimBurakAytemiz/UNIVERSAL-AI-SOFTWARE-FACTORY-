// //TR: Bu test WFR-04a c2 düzeltmelerini gerçek geçici Work OS journal'ı ile doğrular: F1 kanonik kimlik (ayırıcısız, camel-case, Unicode tire, sıfır genişlikli ve homoglif varyantlarla kendi kendini onay reddi), F2 yaşam döngüsü aktörlerinin (lab'ı yazan öğrenen dahil) reviewer/terfi aktörü olamaması, F3 TTL sınırında enjekte saatle ön-deneme ve kalıcı girdinin aynı zamanı kullanması (journal bozulmaz), F4 global kaynağın diğer tenant'a yalnız izdüşümle görünmesi (WFR-AT-011) ve belgelenmiş çapraz-tenant iptal etkisi.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {SkillAcademy} from "../core/academy/academy.js";
import type {SourceInput} from "../core/academy/academy.js";
import {verifyReviewerEvidence} from "../core/academy/evidence.js";
import {distinctIdentity, identityKey, sameIdentity} from "../core/academy/rules.js";
import type {LearningRecord} from "../core/academy/types.js";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (test geçerli hash zincirli sahte journal satırı üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";

const canonicalSha = sha256Untyped as (v: unknown) => string;
const sha = (b: string | Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const REGISTRY = path.resolve("registries/role-definitions.json");
const DAY = 86_400_000;
const ROLE = "UASCO-0001", GUILD = "G01";
const IMPL = "claude-builder", REVIEWER = "claude-reviewer-fresh";
const A = {tenantId: "tenant-a"}, B = {tenantId: "tenant-b"};
const TEXT = "Node.js fs.realpathSync resolves symbolic links; call it before a path containment check.";
const LAB = {passed: true, deterministicTestRefs: ["tests/lab/realpath.test.ts#sha256=" + "1".repeat(64)], negativeEvalRefs: ["neg/symlink-escape#case-1"], modelVersion: "model-a", toolAdapters: {node: "22.11.0"}};
const SAME_FORMAT_VARIANTS = ["claudebuilder", "ClaudeBuilder", "CLAUDE.BUILDER", " CLAUDE_BUILDER ", "claude--builder"];
const NON_ASCII_VARIANTS = ["claude–builder", "claude​-builder", "clаude-builder", "ｃlaude-builder", "claude-builderé"];

let tmp = "", repoRoot = "";
let store: WorkOsStore; let academy: SkillAcademy;
let clock: (() => number) | null = null;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-wfr04a-c2-"));
  repoRoot = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repoRoot, "audit", "evidence", "skill-academy"), {recursive: true});
  clock = null;
  store = new WorkOsStore(path.join(tmp, "data"), {now: () => (clock ? clock() : Date.now())});
  academy = new SkillAcademy(store, {repoRoot, registryFile: REGISTRY});
});
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

const journalFile = () => path.join(tmp, "data", "journal.jsonl");
const lines = () => (fs.existsSync(journalFile()) ? fs.readFileSync(journalFile(), "utf8").split("\n").filter(Boolean) : []);
const fresh = () => new WorkOsStore(path.join(tmp, "data"));
function source(scope = A, over: Partial<SourceInput> = {}, actor = "researcher") {
  return academy.registerSource(scope, {url: "https://nodejs.org/api/fs.html", fetchedAt: new Date(Date.now() - DAY).toISOString(), version: "22.11.0", publisher: "OpenJS Foundation",
    sourceTrust: "OFFICIAL", license: "MIT", sha256: sha(TEXT), freshnessTTLDays: 30, ...over}, actor).entity;
}
function evidence(rec: Pick<LearningRecord, "learningId" | "roleId">, over: Record<string, unknown> = {}): string {
  const dir = path.join(repoRoot, "audit", "evidence", "skill-academy", rec.learningId);
  fs.mkdirSync(dir, {recursive: true});
  const raw = JSON.stringify({learningId: rec.learningId, roleId: rec.roleId, verdict: "APPROVED", reviewerIdentity: REVIEWER, implementerIdentity: IMPL, promotionKind: "KNOWLEDGE", scope: "TENANT", ...over}, null, 2) + "\n";
  fs.writeFileSync(path.join(dir, "REVIEWER.json"), raw);
  return `audit/evidence/skill-academy/${rec.learningId}/REVIEWER.json#sha256=${sha(raw)}`;
}
// opener: openGap aktörü; implementer: beyan edilen implementerIdentity; learner: geri kalan tüm yaşam döngüsü adımlarının aktörü.
function toReview(scope = A, o: {opener?: string; implementer?: string; learner?: string; sourceId?: string} = {}): LearningRecord {
  const opener = o.opener ?? IMPL, implementer = o.implementer ?? IMPL, learner = o.learner ?? IMPL;
  const sid = o.sourceId ?? source(scope).sourceId;
  const l = academy.openGap(scope, {roleId: ROLE, guildId: GUILD, trigger: "CAPABILITY_GAP", hypothesis: "realpath before containment prevents symlink escape", implementerIdentity: implementer}, opener).entity;
  academy.attachSources(scope, l.learningId, [sid], learner);
  academy.screenSources(scope, l.learningId, {[sid]: TEXT}, learner);
  academy.draftCurriculum(scope, l.learningId, {prerequisites: [], steps: ["read official docs"]}, learner);
  academy.proposeCandidate(scope, l.learningId, learner);
  academy.startLab(scope, l.learningId, ["run_lab_0001"], learner);
  academy.recordLabResult(scope, l.learningId, LAB, learner);
  return academy.requestReview(scope, l.learningId, learner);
}
const tryPromote = (rec: LearningRecord, reviewer: string, actor: string, evOver: Record<string, unknown> = {}, scope = A, over: Record<string, unknown> = {}) =>
  academy.promote(scope, rec.learningId, {kind: "KNOWLEDGE", reviewerIdentity: reviewer, reviewerRunRef: "review_run_0001", reviewerEvidenceRef: evidence(rec, {reviewerIdentity: reviewer, ...evOver}), ...over}, actor);

describe("WFR04A-C1-F1 canonical identity", () => {
  it("identityKey folds case and every separator, strips format characters and rejects non-ASCII", () => {
    for (const v of SAME_FORMAT_VARIANTS) expect(identityKey(v)).toBe("claudebuilder");
    expect(identityKey("claude​-builder")).toBe("claudebuilder");
    expect(identityKey("claude⁠builder﻿")).toBe("claudebuilder");
    for (const v of ["claude–builder", "clаude-builder", "claude-builderé"]) expect(identityKey(v)).toBeNull();
    expect(identityKey("ｃlaude-builder")).toBe("claudebuilder");
    for (const v of ["", "   ", "---", "​", 42, null]) expect(identityKey(v)).toBeNull();
    expect(sameIdentity("clаude-builder", "clаude-builder")).toBe(false);
    expect(distinctIdentity("clаude-builder", "someone-else")).toBe(false);
    expect(distinctIdentity(REVIEWER, IMPL)).toBe(true);
  });

  it("reviewer identity in a different format or with Unicode tricks cannot approve the implementer's own learning", () => {
    const rec = toReview();
    const n = lines().length;
    for (const who of SAME_FORMAT_VARIANTS) {
      expect(() => tryPromote(rec, who, "supervisor")).toThrow(/REVIEWER_NOT_INDEPENDENT/);
      expect(() => tryPromote(rec, who, who)).toThrow(/PROMOTER_IS_IMPLEMENTER/);
    }
    for (const who of NON_ASCII_VARIANTS) expect(() => tryPromote(rec, who, "supervisor")).toThrow(/WORKOS_INVALID_INPUT: promotion/);
    expect(lines().length).toBe(n);
    expect(academy.getLearning(A, rec.learningId)?.status).toBe("AWAITING_INDEPENDENT_REVIEW");
  });

  it("promote actor variants of the implementer are rejected (format variants as self, non-ASCII as invalid)", () => {
    const rec = toReview();
    const n = lines().length;
    expect(() => tryPromote(rec, REVIEWER, "claude​-builder")).toThrow(/PROMOTER_IS_IMPLEMENTER/);
    for (const actor of ["claude–builder", "clаude-builder", "claude-builderé"]) expect(() => tryPromote(rec, REVIEWER, actor)).toThrow(/PROMOTER_IDENTITY_INVALID/);
    expect(lines().length).toBe(n);
    // Gerçekten bağımsız reviewer + farklı aktör hâlâ terfi eder.
    expect(tryPromote(rec, REVIEWER, "supervisor").status).toBe("PROMOTED_KNOWLEDGE");
  });

  it("non-ASCII implementer identity or actor is refused at open time", () => {
    for (const who of NON_ASCII_VARIANTS) {
      expect(() => academy.openGap(A, {roleId: ROLE, guildId: GUILD, trigger: "REAL_MISSION", hypothesis: "h", implementerIdentity: who}, "supervisor")).toThrow(/WORKOS_INVALID_INPUT: learning/);
    }
    for (const actor of ["claude–builder", "clаude-builder", "​"]) {
      expect(() => academy.openGap(A, {roleId: ROLE, guildId: GUILD, trigger: "REAL_MISSION", hypothesis: "h", implementerIdentity: IMPL}, actor)).toThrow(/ACTOR_IDENTITY_INVALID/);
    }
    const l = academy.openGap(A, {roleId: ROLE, guildId: GUILD, trigger: "REAL_MISSION", hypothesis: "h", implementerIdentity: IMPL}, IMPL).entity;
    expect(() => academy.attachSources(A, l.learningId, [source().sourceId], "clаude-builder")).toThrow(/ACTOR_IDENTITY_INVALID/);
  });

  it("verifyReviewerEvidence uses the same canonical rule (self-review in the file, homoglyph reviewer)", () => {
    const rec = toReview();
    const r = {learningId: rec.learningId, roleId: rec.roleId, implementerIdentity: IMPL};
    expect(verifyReviewerEvidence(repoRoot, evidence(rec, {reviewerIdentity: "ClaudeBuilder"}), r, {reviewerIdentity: "ClaudeBuilder", kind: "KNOWLEDGE", global: false})).toEqual({ok: false, problem: "CONTENT_SELF_REVIEW"});
    expect(verifyReviewerEvidence(repoRoot, evidence(rec, {reviewerIdentity: "claude​builder"}), r, {reviewerIdentity: "claudebuilder", kind: "KNOWLEDGE", global: false})).toEqual({ok: false, problem: "CONTENT_SELF_REVIEW"});
    expect(verifyReviewerEvidence(repoRoot, evidence(rec, {reviewerIdentity: "clаude-reviewer-fresh"}), r, {reviewerIdentity: REVIEWER, kind: "KNOWLEDGE", global: false})).toEqual({ok: false, problem: "CONTENT_REVIEWER_MISMATCH"});
    expect(verifyReviewerEvidence(repoRoot, evidence(rec, {reviewerIdentity: REVIEWER, implementerIdentity: "Claude_Builder"}), r, {reviewerIdentity: "CLAUDE-REVIEWER-FRESH", kind: "KNOWLEDGE", global: false}).ok).toBe(true);
  });
});

describe("WFR04A-C1-F2 lifecycle actors are learners", () => {
  it("the actor that ran the lab cannot review or promote, even when a different implementer was declared", () => {
    const rec = toReview(A, {opener: "supervisor", implementer: "nominal-impl", learner: IMPL});
    expect(rec.lifecycleActors).toEqual(["supervisor", IMPL]);
    const n = lines().length;
    const ev = {implementerIdentity: "nominal-impl"};
    // Bulgu senaryosu: lab'ı yazan öğrenen kendini reviewer ve terfi aktörü olarak bildiriyor.
    expect(() => tryPromote(rec, IMPL, IMPL, ev)).toThrow(/PROMOTER_IS_IMPLEMENTER/);
    expect(() => tryPromote(rec, IMPL, "release-manager", ev)).toThrow(/REVIEWER_NOT_INDEPENDENT/);
    expect(() => tryPromote(rec, "Claude_Builder", "release-manager", ev)).toThrow(/REVIEWER_NOT_INDEPENDENT/);
    // Kaydı açan aktör de öğrenendir: ne reviewer ne terfi aktörü olabilir.
    expect(() => tryPromote(rec, "Supervisor", "release-manager", ev)).toThrow(/REVIEWER_NOT_INDEPENDENT/);
    expect(() => tryPromote(rec, REVIEWER, "supervisor", ev)).toThrow(/PROMOTER_IS_IMPLEMENTER/);
    expect(lines().length).toBe(n);
    const ok = tryPromote(rec, REVIEWER, "release-manager", ev);
    expect(ok.status).toBe("PROMOTED_KNOWLEDGE");
    // Replay aynı aktör kümesini journal'dan yeniden türetir.
    const replayed = new SkillAcademy(fresh(), {repoRoot, registryFile: REGISTRY}).getLearning(A, rec.learningId);
    expect(replayed?.lifecycleActors).toEqual(["supervisor", IMPL]);
    expect(replayed?.status).toBe("PROMOTED_KNOWLEDGE");
  });

  it("a forged promotion whose reviewer is a lifecycle actor makes replay fail closed", () => {
    const rec = toReview(A, {opener: "supervisor", implementer: "nominal-impl", learner: IMPL});
    const raw = lines(); const last = JSON.parse(raw[raw.length - 1]) as {seq: number; hash: string};
    const ref = evidence(rec, {reviewerIdentity: IMPL, implementerIdentity: "nominal-impl"});
    const at = new Date().toISOString();
    const body = {seq: last.seq + 1, prevHash: last.hash, type: "ACADEMY_LEARNING_PROMOTED", actor: "release-manager", at, payload: {
      learningId: rec.learningId, tenantId: A.tenantId, from: "AWAITING_INDEPENDENT_REVIEW", to: "PROMOTED_KNOWLEDGE", reviewerIdentity: IMPL, reviewerRunRef: "rr",
      promotion: {kind: "KNOWLEDGE", knowledgeStatus: "READONLY_KNOWLEDGE", executable: false, authorityEffect: "NONE", global: false, anonymized: false,
        reviewerEvidence: {ref, sha256: ref.slice(-64), verifiedAt: at}, supportingSourceIds: rec.sourceIds, promotedAt: at, promotedBy: "release-manager"}
    }};
    fs.appendFileSync(journalFile(), JSON.stringify({...body, hash: canonicalSha(body)}) + "\n");
    const f = fresh();
    expect(f.isTampered).toBe(true);
    expect(() => new SkillAcademy(f, {repoRoot, registryFile: REGISTRY}).getLearning(A, rec.learningId)).toThrow(/ACADEMY_PROMOTION_INVALID:REVIEWER_NOT_INDEPENDENT/);
  });

  it("a forged OPENED entry whose createdBy differs from the writing actor makes replay fail closed", () => {
    const l = academy.openGap(A, {roleId: ROLE, guildId: GUILD, trigger: "REAL_MISSION", hypothesis: "h", implementerIdentity: IMPL}, IMPL).entity;
    const raw = lines(); const last = JSON.parse(raw[raw.length - 1]) as {seq: number; hash: string};
    const entity = {...l, learningId: "lrn_" + "a".repeat(24), createdBy: "ghost", lifecycleActors: ["ghost"]};
    const body = {seq: last.seq + 1, prevHash: last.hash, type: "ACADEMY_LEARNING_OPENED", actor: IMPL, at: new Date().toISOString(), payload: {entity}};
    fs.appendFileSync(journalFile(), JSON.stringify({...body, hash: canonicalSha(body)}) + "\n");
    expect(() => new SkillAcademy(fresh(), {repoRoot, registryFile: REGISTRY}).listLearnings(A)).toThrow(/ACADEMY_CREATOR_MISMATCH/);
  });
});

describe("WFR04A-C1-F3 one timestamp for dry-run and persisted entry", () => {
  it("promotion at a source TTL boundary under an injected clock persists the checked timestamp and the store reloads clean", () => {
    // Saat gerçek zamandan 60 gün geride: kaynak gerçek zamana göre bayat, enjekte saate göre son milisaniyede taze.
    const base = Date.now() - 60 * DAY;
    clock = () => base;
    const fetchedAt = new Date(base - 30 * DAY + 10 * 60_000).toISOString();
    const expiry = Date.parse(fetchedAt) + 30 * DAY;
    const s = source(A, {fetchedAt});
    const rec = toReview(A, {sourceId: s.sourceId});
    // İlk okuma süresi dolmadan 1 ms önce; sonraki her okuma (varsa) süre dolduktan sonra.
    let reads = 0;
    clock = () => (reads++ === 0 ? expiry - 1 : expiry + DAY);
    const p = tryPromote(rec, REVIEWER, "supervisor");
    expect(p.status).toBe("PROMOTED_KNOWLEDGE");
    const lastEntry = JSON.parse(lines()[lines().length - 1]) as {type: string; at: string};
    expect(lastEntry.type).toBe("ACADEMY_LEARNING_PROMOTED");
    expect(lastEntry.at).toBe(new Date(expiry - 1).toISOString());
    expect(p.promotion?.promotedAt).toBe(lastEntry.at);
    const f = fresh();
    expect(f.isTampered).toBe(false);
    expect(new SkillAcademy(f, {repoRoot, registryFile: REGISTRY}).getLearning(A, rec.learningId)?.status).toBe("PROMOTED_KNOWLEDGE");
  });

  it("past the TTL boundary the promotion is refused before anything is written and the store stays clean", () => {
    const base = Date.now() - 60 * DAY;
    clock = () => base;
    const fetchedAt = new Date(base - 30 * DAY + 10 * 60_000).toISOString();
    const expiry = Date.parse(fetchedAt) + 30 * DAY;
    const rec = toReview(A, {sourceId: source(A, {fetchedAt}).sourceId});
    const n = lines().length;
    clock = () => expiry;
    expect(() => tryPromote(rec, REVIEWER, "supervisor")).toThrow(/NO_SUPPORTING_SOURCE/);
    expect(lines().length).toBe(n);
    expect(fresh().isTampered).toBe(false);
  });

  it("an academy append without an explicit time reads the store clock once for both dry-run and persisted entry", () => {
    const base = Date.now();
    let reads = 0;
    clock = () => base + (reads++) * DAY;
    const s = source(A);
    const entry = JSON.parse(lines()[lines().length - 1]) as {at: string};
    // registerSource: tx.now() (createdAt) bir okuma, append bir okuma; kalıcı at yalnız append okumasıdır ve journal replay'i temizdir.
    expect(reads).toBe(2);
    expect(entry.at).toBe(new Date(base + DAY).toISOString());
    expect(s.createdAt).toBe(new Date(base).toISOString());
    expect(fresh().isTampered).toBe(false);
  });
});

describe("WFR04A-C1-F4 global sources across tenants (WFR-AT-011)", () => {
  it("another tenant sees only a projection without owner tenant, actor, status reason or contradiction text", () => {
    const g = source(A, {global: true, contradictions: ["tenant-a internal note"]}, "alice@tenant-a");
    const ownerView = academy.getSource(A, g.sourceId) as unknown as Record<string, unknown>;
    expect(ownerView).toMatchObject({tenantId: "tenant-a", createdBy: "alice@tenant-a", contradictions: ["tenant-a internal note"]});
    const bView = academy.getSource(B, g.sourceId) as unknown as Record<string, unknown>;
    expect(Object.keys(bView).sort()).toEqual(["contradictionCount", "fetchedAt", "freshnessTTLDays", "global", "license", "publishedAt", "publisher", "recordKind", "sha256", "sourceId", "sourceTrust", "status", "url", "version"]);
    expect(bView).toMatchObject({recordKind: "globalSource", sourceId: g.sourceId, global: true, contradictionCount: 1});
    const bList = JSON.stringify(academy.listSources(B));
    for (const leak of ["tenant-a", "alice", "internal note", "statusReason", "createdBy"]) {
      expect(JSON.stringify(bView)).not.toContain(leak);
      expect(bList).not.toContain(leak);
    }
    // B'nin kendi kaydının taraması da A'nın çelişki metnini kopyalamaz.
    const bRec = toReview(B, {sourceId: g.sourceId});
    expect(bRec.screen?.conflicts).toEqual([{sourceId: g.sourceId, contradictions: ["REDACTED_CROSS_TENANT_CONTRADICTIONS:1"]}]);
    expect(JSON.stringify(academy.getLearning(B, bRec.learningId))).not.toContain("internal note");
    const aRec = toReview(A, {sourceId: g.sourceId});
    expect(aRec.screen?.conflicts).toEqual([{sourceId: g.sourceId, contradictions: ["tenant-a internal note"]}]);
  });

  it("documented cross-tenant effect: only the owner can revoke a global source; revocation only removes support from other tenants' learnings", () => {
    const g = source(A, {global: true}, "alice@tenant-a");
    const bRec = toReview(B, {sourceId: g.sourceId});
    const promoted = tryPromote(bRec, REVIEWER, "supervisor", {}, B);
    expect(promoted.status).toBe("PROMOTED_KNOWLEDGE");
    expect(() => academy.revokeSource(B, g.sourceId, "REVOKED", "x", "bob@tenant-b")).toThrow(/WORKOS_NOT_FOUND: source/);
    academy.revokeSource(A, g.sourceId, "POISONED", "mirror poisoned", "alice@tenant-a");
    expect((academy.getSource(B, g.sourceId) as unknown as Record<string, unknown>).status).toBe("POISONED");
    expect(JSON.stringify(academy.getSource(B, g.sourceId))).not.toContain("mirror poisoned");
    const d = academy.applyDrift({now: Date.now(), modelVersion: "model-a", toolAdapters: {node: "22.11.0"}}, "drift-monitor");
    expect(d.find(x => x.learningId === bRec.learningId)).toMatchObject({to: "REVOKED", reasons: [`SOURCE_POISONED:${g.sourceId}`]});
    const after = academy.getLearning(B, bRec.learningId);
    expect(after?.status).toBe("REVOKED");
    expect(after?.permissionDelta).toEqual([]);
    expect(academy.getLearning(A, bRec.learningId)).toBeUndefined();
  });
});
