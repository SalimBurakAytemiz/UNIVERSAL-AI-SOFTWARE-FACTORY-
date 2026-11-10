// //TR: FV2 korumalı executor otorite çiti (tests/v7-cloud-contracts.test.ts altında kayıtlı, tests-8 adımı): kanonik executeMerge, tek yazısından (PUT pulls/<n>/merge) ÖNCE doğrulanmış otorite kaydını kontrol eder; kayıt yokken bugünkü davranış sürer, V2 otoritedeyken/devir ortasında/doğrulanamayan kayıtta sıfır yazı ile BLOCK döner.
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped governance module
import {executeMerge, runCli} from "../../docs/planning/autonomy/executor.mjs";
// @ts-expect-error untyped governance module
import {GOVERNANCE_PREFIXES, GOVERNANCE_EXACT, GOVERNANCE_EXEMPT, TRUST_FILES, FV2_AUTHORITY_ROOTS, FV2_AUTHORITY_FILES, FV2_AUTHORITY_DEPS, isGovernancePath, decideAutoMerge, loadPolicy, loadIndex} from "../../docs/planning/autonomy/autonomy.mjs";
// @ts-expect-error untyped governance module
import {PROTECTED_FLOOR, CI_EXECUTED_FLOOR} from "../../docs/planning/merge-gate.mjs";
// @ts-expect-error untyped module
import {CANONICAL_KEYRING_PATH} from "../../automation/factory-v2/identity.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function registerFv2ExecutorFenceCases(): void {
  const H = "a".repeat(40), B = "b".repeat(40);
  const run = (authority: unknown) => {
    let writes = 0;
    const r = executeMerge({pr: 7, implementerSessions: ["s"], authority,
      collect: () => ({policy: {mergeMethod: "merge"}, evidence: {pr: {base: {ref: "v7/integration"}}}}),
      decide: () => ({gate: {decision: "MERGE"}, result: {decision: "AUTO_MERGE", task: "X-T0001", expectedHeadSha: H, expectedBaseSha: B, reasons: []}}),
      api: (p: string) => (p.startsWith("branches/") ? {commit: {sha: B}} : {}), write: () => { writes++; return {merged: false}; }});
    return {r, writes};
  };
  describe("FV2 protected change: authority fence before the canonical merge write", () => {
    it("no authority record: today's behaviour (proceeds to the write)", () => { expect(run(() => ({allowed: true, by: "V4.1"})).writes).toBe(1); });
    it.each([["V2 authoritative", "V41_FENCED_BY_V2_AUTHORITY"], ["mid-handover", "HANDOVER_IN_PROGRESS:V41_DRAINED"], ["unverifiable", "AUTHORITY_UNVERIFIABLE:x"], ["unprotected registry", "REGISTRY_NOT_PROTECTED"]])
      ("%s: BLOCK with zero writes", (_n, reason) => { const {r, writes} = run(() => ({allowed: false, reason})); expect(r).toMatchObject({decision: "BLOCK", reasons: [`AUTHORITY:${reason}`]}); expect(writes).toBe(0); });
    it("the authority check throwing: BLOCK, zero writes", () => { const {r, writes} = run(() => { throw new Error("boom"); }); expect(r.reasons).toEqual(["AUTHORITY:AUTHORITY_CHECK_FAILED"]); expect(writes).toBe(0); });
    it("the guard and its import closure are trust files (byte-identical to the base before any decision)", () => {
      for (const f of ["v41-guard", "bridge", "identity", "shared-registry", "ownership", "scheduler", "topology"]) expect(TRUST_FILES).toContain(`automation/factory-v2/${f}.mjs`);
      for (const f of ["task-lease", "task-lease-git-store"]) expect(TRUST_FILES).toContain(`automation/lib/${f}.mjs`);
      for (const f of TRUST_FILES) expect(fs.existsSync(f)).toBe(true);
    });
    it("--v2-intent: more than one is refused before anything runs; an unreadable or unparseable file never reaches executeMerge", () => {
      expect(runCli(["merge", "--pr", "7", "--v2-intent", "a.json", "--v2-intent", "b.json"])).toMatchObject({res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}});
      expect(() => runCli(["merge", "--pr", "7", "--v2-intent", path.join(os.tmpdir(), "fv2-no-such-intent.json")])).toThrow();
      const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fv2-intent-")), "i.json"); fs.writeFileSync(bad, "{not json");
      expect(() => runCli(["merge", "--pr", "7", "--v2-intent", bad])).toThrow();
    });
    it("the authority check receives exactly the PR, the head being merged and the V2 intent", () => {
      const seen: unknown[] = [];
      let writes = 0;
      executeMerge({pr: 7, implementerSessions: ["s"], v2Intent: {signed: "intent"}, authority: (a: unknown) => { seen.push(a); return {allowed: false, reason: "X"}; },
        collect: () => ({policy: {mergeMethod: "merge"}, evidence: {pr: {base: {ref: "v7/integration"}}}}),
        decide: () => ({gate: {decision: "MERGE"}, result: {decision: "AUTO_MERGE", task: "X-T0001", expectedHeadSha: H, expectedBaseSha: B, reasons: []}}),
        api: (p: string) => (p.startsWith("branches/") ? {commit: {sha: B}} : {}), write: () => { writes++; return {merged: false}; }});
      expect(seen).toEqual([{pr: 7, headSha: H, v2Intent: {signed: "intent"}}]);
      expect(writes).toBe(0);
    });
  });
  // Founder decision C on #355: protect exactly the Factory V2 authority code (computed), not the whole folder; routine code stays AUTO_MERGE-able.
  describe("FV2 authority files: evidence-based protection list (import closure of the authority entry points)", () => {
    const SPEC = /(?:^|[^.\w$])(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|(?:^|[^.\w$])import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;
    // Anything that can load code the static scan cannot see; such a line in a protected file fails closed.
    const OPAQUE = /import\(\s*(?!["'][^"']+["']\s*\))|\brequire\s*\(|createRequire|\beval\s*\(|new\s+Function\b|\bFunction\s*\(/;
    type Read = (f: string) => string | null;
    const disk: Read = f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
    const closure = (roots: readonly string[], read: Read = disk) => {
      const seen = new Set<string>(), q = [...roots];
      while (q.length) { const f = q.shift()!; if (seen.has(f)) continue; seen.add(f); const src = read(f); if (src === null) continue;
        for (const m of src.matchAll(SPEC)) { const sp = m[1] ?? m[2] ?? m[3]; if (sp?.startsWith(".")) q.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), sp))); } }
      return [...seen].sort();
    };
    const opaque = (files: readonly string[], read: Read = disk) => files.filter(f => (read(f) ?? "").split("\n").some(l => !/^\s*\/\//.test(l) && OPAQUE.test(l)));
    const floor = (f: string) => PROTECTED_FLOOR.some((x: string) => f.startsWith(x)) || CI_EXECUTED_FLOOR.some(([m, , pre]: [string, string, boolean]) => (pre ? f.startsWith(m) : f === m));
    const protectedPath = (f: string) => isGovernancePath(f) || floor(f);
    const drift = (read: Read = disk) => closure(FV2_AUTHORITY_ROOTS, read).filter(f => !protectedPath(f));
    const fv2Of = (c: string[]) => c.filter(f => f.startsWith("automation/factory-v2/"));
    it("G1 the protected list equals the computed closure of the authority roots; closure files elsewhere are already Founder paths", () => {
      const c = closure(FV2_AUTHORITY_ROOTS);
      expect(fv2Of(c)).toEqual([...FV2_AUTHORITY_FILES].sort());
      for (const f of c) { expect(fs.existsSync(f), f).toBe(true); expect(protectedPath(f), f).toBe(true); }
      expect(drift()).toEqual([]);
      expect(GOVERNANCE_PREFIXES).not.toContain("automation/factory-v2/");
      for (const f of FV2_AUTHORITY_ROOTS) expect(FV2_AUTHORITY_FILES).toContain(f);
    });
    it("G2 no protected file loads code the scan cannot see (non-literal import(), require, createRequire, eval, Function)", () => {
      expect(opaque(closure(FV2_AUTHORITY_ROOTS))).toEqual([]);
    });
    it("G3 the executor fence: the closure of v41-guard is in TRUST_FILES (base-blob identical) and every trust file is a Founder path", () => {
      for (const f of closure(["automation/factory-v2/v41-guard.mjs"])) expect(TRUST_FILES, f).toContain(f);
      for (const f of TRUST_FILES) expect(protectedPath(f), f).toBe(true);
      for (const f of ["automation/lib/task-lease.mjs", "automation/lib/task-lease-git-store.mjs"]) { expect(floor(f), f).toBe(true); expect(isGovernancePath(f), f).toBe(true); }
      expect(isGovernancePath(CANONICAL_KEYRING_PATH)).toBe(true);
    });
    // Decisions with the real policy and task index: a T2 FV2 task, merge-gate MERGE, a CLEAN attestation. Only the diff varies.
    const policy = loadPolicy(), index = loadIndex();
    const rev = {id: 1, user: {login: policy.trustedReviewerLogins[0]}, state: "COMMENTED", commit_id: H, submitted_at: "2026-11-10T00:00:00Z",
      body: `x\nAUTONOMY-EXCEPTIONS: none\nVERDICT-BINDING: verdict=CLEAN head=${H} base=${B} reviewer-session=session_rev`};
    const decide = (files: Array<Record<string, string>>) => decideAutoMerge({gate: {decision: "MERGE", reasons: [], expectedHeadSha: H, expectedBaseSha: B},
      body: "UASCO-TASK: FV2-T0004\n", policy, index, evidence: {implementerSessions: ["session_builder"], diffFiles: files, reviews: [rev], pr: {user: {login: policy.trustedReviewerLogins[0]}}}});
    it.each([...FV2_AUTHORITY_FILES])("G4 a T2 PR modifying, deleting or renaming %s is FOUNDER_REQUIRED (GOVERNANCE_PATH)", f => {
      for (const d of [[{filename: f, status: "modified"}], [{filename: f, status: "removed"}], [{filename: "automation/factory-v2/x-moved.mjs", previous_filename: f, status: "renamed"}],
        [{filename: f.toUpperCase(), status: "modified"}]]) { const r = decide(d); expect(r.decision).toBe("FOUNDER_REQUIRED"); expect(r.reasons).toContain("GOVERNANCE_PATH"); }
    });
    it("G5 automation/lib lease files are governance paths AND merge-gate floor: FOUNDER_REQUIRED either way (never routine)", () => {
      for (const f of ["automation/lib/task-lease.mjs", "automation/lib/task-lease-git-store.mjs"]) { const r = decide([{filename: f, status: "modified"}]); expect(r.decision).toBe("FOUNDER_REQUIRED"); expect(r.reasons).toContain("GOVERNANCE_PATH"); }
      const r = decideAutoMerge({gate: {decision: "BLOCK", reasons: ["PROTECTED_PATH"], expectedHeadSha: H, expectedBaseSha: B}, body: "UASCO-TASK: FV2-T0004\n", policy, index,
        evidence: {implementerSessions: ["session_builder"], diffFiles: [{filename: "automation/lib/task-lease.mjs", status: "modified"}], reviews: [rev], pr: {user: {login: "x"}}}});
      expect(r.decision).toBe("FOUNDER_REQUIRED"); expect(r.reasons).toContain("PROTECTED_GOVERNANCE:PROTECTED_PATH");
    });
    it("G6 routine Factory V2 work outside the closure stays AUTO_MERGE (T2, CLEAN, merge-gate MERGE)", () => {
      for (const d of [[{filename: "automation/factory-v2/demo-worker.mjs", status: "modified"}], [{filename: "automation/factory-v2/new-module.mjs", status: "added"}],
        [{filename: "tests/factory-v2/model-router.test.mjs", status: "modified"}], [{filename: "docs/factory-v2/CONTROL-SESSION.md", status: "modified"}]])
        expect(decide(d)).toMatchObject({decision: "AUTO_MERGE", reasons: []});
    });
    it("G8 every repo file the protected code names (data, config, keyrings, acceptance) is a Founder path; STATE.json is the one documented exemption", () => {
      const LIT = /["'`]((?:docs|config|automation|scripts|tests|governance|schemas|\.github)\/[A-Za-z0-9._\/-]+)["'`]/g;
      const named = new Set<string>();
      for (const f of closure(FV2_AUTHORITY_ROOTS)) for (const m of (disk(f) ?? "").matchAll(LIT)) named.add(m[1]);
      expect(named.size).toBeGreaterThan(5);
      // STATE.json: routine by design (GOVERNANCE_EXEMPT); its done entries only count after verifiedState checks the merged PR that declares the task.
      // Directory literals are scope patterns, not reads: gate-verifier's FACTORY_SCOPE_PREFIX locates the PR that brought V2 code (cutover gate); authority/ is governance.
      const SCOPE_PATTERNS = ["automation/factory-v2/", "docs/planning/authority/"];
      const unprotected = [...named].filter(p => !protectedPath(p) && !GOVERNANCE_EXEMPT.includes(p.toLowerCase()) && !SCOPE_PATTERNS.includes(p));
      expect(unprotected).toEqual([]);
      for (const p of ["docs/factory-v2/CUTOVER-ACCEPTANCE.md", "docs/factory-v2/probe/PROBE-ROLE-KEYS.json"]) expect(decide([{filename: p, status: "modified"}]).decision).toBe("FOUNDER_REQUIRED");
    });
    it("G7 bypasses are detected: a new import, a re-export, a literal dynamic import, an opaque loader in a protected file", () => {
      const patched = (f: string, add: string): Read => g => (g === f ? (disk(g) ?? "") + "\n" + add + "\n" : g.endsWith("/evil.mjs") ? "export const x = 1;" : disk(g));
      expect(drift(patched("automation/factory-v2/bridge.mjs", 'import "./evil.mjs";'))).toEqual(["automation/factory-v2/evil.mjs"]);
      expect(drift(patched("automation/factory-v2/identity.mjs", 'export * from "./evil.mjs";'))).toEqual(["automation/factory-v2/evil.mjs"]);
      expect(drift(patched("automation/factory-v2/v41-guard.mjs", 'const m = await import("./evil.mjs");'))).toEqual(["automation/factory-v2/evil.mjs"]);
      expect(drift(patched("automation/factory-v2/control.mjs", 'import {x} from "../factory-v2/evil.mjs";'))).toEqual(["automation/factory-v2/evil.mjs"]);
      for (const add of ["const m = await import(name);", "const r = require('./x.cjs');", "import {createRequire} from 'node:module';", "eval(code);", "const f = new Function(src);"])
        expect(opaque(closure(FV2_AUTHORITY_ROOTS), patched("automation/factory-v2/supervisor.mjs", add)), add).toEqual(["automation/factory-v2/supervisor.mjs"]);
      // the drift test itself only runs on Founder-tier changes: wiring a new file into authority code means editing a protected file
      expect(isGovernancePath("automation/factory-v2/evil.mjs")).toBe(false);
      expect(GOVERNANCE_EXACT.length).toBe(3 + FV2_AUTHORITY_FILES.length + FV2_AUTHORITY_DEPS.length);
    });
  });
}
