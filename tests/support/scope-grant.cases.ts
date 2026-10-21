// //TR: Coordinator Scope Grant senaryolari: saf degerlendiricinin (core/authority/scope-grant.mjs) her ihlal kodu icin pozitif/negatif davranisi, asla throw etmemesi ve scripts/check-scope-grant.mjs CLI'sinin gecici bir git deposunda PASS/FAIL uretmesi. Kayitli bir test dosyasindan cagrilir (korunan validation.json kaydi gerektirmez); hicbir PASS uydurmaz, hicbir kapiyi gevsetmez.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {evaluateScopeGrant, NEVER_DELEGABLE_EXACT, NEVER_DELEGABLE_PREFIXES, SCOPE_GRANT_CODES} from "../../core/authority/scope-grant.mjs";
import type {ScopeGrantInput} from "../../core/authority/scope-grant.mjs";

const NOW = Date.parse("2026-10-22T00:00:00Z");
const SERVER = "apps/control-api/src/server.ts", MAIN = "apps/desktop/main.mjs", MANIFEST = "config/trust-root-manifest.json";
const POLICY = {
  exactPaths: [SERVER, MAIN, "AGENTS.md", "config/protected-paths.json", MANIFEST, ".github/workflows/ci.yml", "scripts/generate-trust-root.mjs", "scripts/verify-trust-root.mjs", "config/environment-policy.json", "config/builder-execution-policy.json"],
  protectedPrefixes: ["automation/lib/", "config/", "prompts/", "scripts/validate-", "scripts/run-validation.mjs"],
};
const grant = (over: Record<string, unknown> = {}, scope: Record<string, unknown> = {}): any => ({
  grantId: "G-TEST", status: "ACTIVE",
  founderStatement: {quote: "test statement", at: "2026-10-21", channel: "unit test"},
  scope: {protectedFiles: [{path: SERVER, allowedChange: "register routes"}, {path: MAIN, allowedChange: "allow-list entries"}], allowTrustRootReseal: true, ...scope},
  expiresAt: "2026-11-21T00:00:00Z", reference: "docs/authority-requests/TEST.md", ...over,
});
const man = (entries: Record<string, string>, extra: Record<string, unknown> = {}): any => ({
  schemaVersion: "1.0.0", generatedAt: "2026-10-19T00:00:00.000Z", sealStatus: "SEALED",
  files: Object.entries(entries).map(([p, sha256]) => ({path: p, sha256})), ...extra,
});
const BEFORE = man({[SERVER]: "a1", [MAIN]: "b1", "AGENTS.md": "c1", "config/other.json": "d1"});
const RESEALED = man({[SERVER]: "a2", [MAIN]: "b2", "AGENTS.md": "c1", "config/other.json": "d1"}, {generatedAt: "2026-10-21T00:00:00.000Z"});
const base = (): ScopeGrantInput => ({grant: grant(), protectedPolicy: POLICY, changedFiles: [SERVER, MAIN, MANIFEST], manifestBefore: BEFORE, manifestAfter: RESEALED, now: NOW});
const ev = (over: Partial<ScopeGrantInput> = {}) => evaluateScopeGrant({...base(), ...over});
const codes = (r: {violations: {code: string}[]}) => r.violations.map((v) => v.code);
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === "object") { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); } return o; };

export function registerScopeGrantCases() {
  describe("scope grant evaluator: allowed", () => {
    it("accepts exactly the granted protected files plus a reseal of only those manifest entries (generatedAt may change)", () => {
      expect(ev()).toEqual({ok: true, violations: []});
    });
    it("accepts unprotected changes next to the granted ones", () => {
      expect(ev({changedFiles: [SERVER, MAIN, MANIFEST, "apps/control-api/src/routes/intake.ts", "tests/v7-x.test.ts", "docs/authority-requests/X.md"]}).ok).toBe(true);
    });
    it("accepts a manifest whose only change is generatedAt", () => {
      expect(ev({changedFiles: [MANIFEST], manifestAfter: {...BEFORE, generatedAt: "2026-10-22T00:00:00.000Z"}}).ok).toBe(true);
    });
    it("allows removing a granted file's own manifest entry", () => {
      expect(ev({manifestAfter: man({[MAIN]: "b1", "AGENTS.md": "c1", "config/other.json": "d1"})}).ok).toBe(true);
    });
    it("treats now === expiresAt as still valid and accepts Date / ISO-string clocks", () => {
      expect(ev({now: Date.parse("2026-11-21T00:00:00Z")}).ok).toBe(true);
      expect(ev({now: new Date(NOW)}).ok).toBe(true);
      expect(ev({now: "2026-10-22T00:00:00Z"}).ok).toBe(true);
    });
    it("matches the grant case-insensitively and normalizes ./ and backslashes", () => {
      expect(ev({changedFiles: ["Apps/Desktop/Main.mjs", "./" + SERVER, MANIFEST.replaceAll("/", "\\")]}).ok).toBe(true);
    });
    it("is deterministic, order independent and never mutates its (frozen) inputs", () => {
      const input = deepFreeze({...base(), changedFiles: ["tests/z.test.ts", "AGENTS.md", "config/zzz.json", "config/aaa.json"]});
      const a = evaluateScopeGrant(input), b = evaluateScopeGrant({...input, changedFiles: [...(input.changedFiles as string[])].reverse()});
      expect(a).toEqual(b);
      expect(a.violations.map((v) => v.path)).toEqual(["AGENTS.md", "config/aaa.json", "config/zzz.json"]);
    });
    it("accepts the real FIRST-DELIVERY-WIRING grant once its status is (hypothetically) ACTIVE and rejects it while PROPOSED", () => {
      const real = JSON.parse(fs.readFileSync("docs/authority-grants/FIRST-DELIVERY-WIRING.json", "utf8"));
      const policy = JSON.parse(fs.readFileSync("config/protected-paths.json", "utf8"));
      const at = Date.parse("2026-10-22T00:00:00Z");
      const files = real.scope.protectedFiles.map((f: {path: string}) => f.path);
      const sh = (s: string) => man({[files[0]]: "x1" + s, [files[1]]: "y1" + s});
      const input = (g: unknown, s: string): ScopeGrantInput => ({grant: g, protectedPolicy: policy, changedFiles: [...files, MANIFEST], manifestBefore: sh(""), manifestAfter: sh(s), now: at});
      expect(evaluateScopeGrant(input({...real, status: "ACTIVE"}, "z"))).toEqual({ok: true, violations: []});
      if (real.status !== "ACTIVE") expect(codes(evaluateScopeGrant(input(real, "z")))).toEqual(["GRANT_NOT_ACTIVE"]);
      expect(real.founderStatement).toEqual({quote: "COORD-FIRST-DELIVERY-WIRING.md belgesindeki ilk teslim entegrasyonunu prensipte onaylıyorum. Bu onay yalnızca ilgili API kayıtlarının, gerekli Electron izinlerinin, güven kökü manifestinin ve bunların testlerinin güvenli biçimde uygulanmasını kapsar.", at: "2026-10-21", channel: "Founder directive in the coordinator session"});
    });
  });

  describe("scope grant evaluator: violations", () => {
    it("exposes the six fixed codes", () => {
      expect([...SCOPE_GRANT_CODES]).toEqual(["GRANT_INVALID", "GRANT_NOT_ACTIVE", "GRANT_EXPIRED", "NEVER_DELEGABLE_PATH", "PROTECTED_CHANGE_OUTSIDE_GRANT", "RESEAL_OUTSIDE_GRANT"]);
    });
    for (const status of ["PROPOSED", "REVOKED", "EXPIRED", "active", "ACTIVE "]) {
      it(`GRANT_NOT_ACTIVE for status ${JSON.stringify(status)}`, () => {
        const r = ev({grant: grant({status})});
        expect(r.ok).toBe(false);
        expect(codes(r)).toEqual(["GRANT_NOT_ACTIVE"]);
      });
    }
    it("GRANT_EXPIRED one millisecond after expiresAt", () => {
      expect(codes(ev({now: Date.parse("2026-11-21T00:00:00Z") + 1}))).toEqual(["GRANT_EXPIRED"]);
      expect(codes(ev({grant: grant({status: "PROPOSED", expiresAt: "2020-01-01T00:00:00Z"})}))).toEqual(["GRANT_NOT_ACTIVE", "GRANT_EXPIRED"]);
    });
    it("PROTECTED_CHANGE_OUTSIDE_GRANT for unlisted exact, prefix and case-variant protected files", () => {
      for (const p of ["AGENTS.md", "automation/lib/new-helper.mjs", "config/new-policy.json", "prompts/NEW.md", "CONFIG/Other.json"]) {
        const r = ev({changedFiles: [SERVER, p]});
        expect(r.violations, p).toEqual([{code: "PROTECTED_CHANGE_OUTSIDE_GRANT", path: p}]);
      }
    });
    it("does not flag unprotected paths, but flags a protected file the grant does not list even when only a sibling is listed", () => {
      expect(ev({changedFiles: ["apps/control-api/src/routes/intake.ts", "core/workos/intake.ts"]}).ok).toBe(true);
      const onlyServer = man({[SERVER]: "a2", [MAIN]: "b1", "AGENTS.md": "c1", "config/other.json": "d1"});
      expect(ev({grant: grant({}, {protectedFiles: [{path: SERVER, allowedChange: "x"}]}), changedFiles: [SERVER, MAIN], manifestAfter: onlyServer}).violations).toEqual([{code: "PROTECTED_CHANGE_OUTSIDE_GRANT", path: MAIN}]);
    });
    it("the trust-root manifest is refused unless allowTrustRootReseal === true", () => {
      for (const flag of [false, undefined, "true", 1]) {
        const r = ev({grant: grant({}, {allowTrustRootReseal: flag}), changedFiles: [MANIFEST], manifestAfter: BEFORE});
        expect(codes(r), String(flag)).toEqual(flag === "true" || flag === 1 ? ["GRANT_INVALID"] : ["NEVER_DELEGABLE_PATH", "PROTECTED_CHANGE_OUTSIDE_GRANT"]);
      }
    });
    it("NEVER_DELEGABLE_PATH even when the grant lists the path and it changed", () => {
      const r = ev({grant: grant({}, {protectedFiles: [{path: SERVER, allowedChange: "x"}, {path: ".github/workflows/ci.yml", allowedChange: "x"}]}), changedFiles: [SERVER, ".github/workflows/ci.yml"], manifestAfter: BEFORE, });
      expect(r.ok).toBe(false);
      expect(r.violations).toEqual([{code: "NEVER_DELEGABLE_PATH", path: ".github/workflows/ci.yml"}]);
    });
    it("an unlisted never-delegable protected path yields both NEVER_DELEGABLE_PATH and PROTECTED_CHANGE_OUTSIDE_GRANT", () => {
      expect(codes(ev({changedFiles: [".github/workflows/ci.yml"]}))).toEqual(["NEVER_DELEGABLE_PATH", "PROTECTED_CHANGE_OUTSIDE_GRANT"]);
    });
    it("a grant that merely lists a never-delegable path is a violation even if nothing changed there", () => {
      const r = ev({grant: grant({}, {protectedFiles: [{path: "scripts/verify-trust-root.mjs", allowedChange: "x"}]}), changedFiles: ["tests/a.test.ts"], manifestBefore: BEFORE, manifestAfter: BEFORE});
      expect(r.violations).toEqual([{code: "NEVER_DELEGABLE_PATH", path: "scripts/verify-trust-root.mjs"}]);
    });
    const NEVER = [...new Set([...NEVER_DELEGABLE_EXACT, ".github/workflows/ci.yml", ".github/workflows/uasco-review.yml", ".github/CODEOWNERS", ".github/rulesets/main.json", "scripts/ci/uasco-review/review-gate.mjs", "scripts/ci/uasco-review/deep/x.mjs", "docs/authority-grants/FIRST-DELIVERY-WIRING.json", "docs/authority-grants/NEW.json", ".GitHub/Workflows/CI.yml", "CODEOWNERS"])];
    for (const p of NEVER) {
      it(`NEVER_DELEGABLE_PATH: ${p} (listed and changed)`, () => {
        const r = ev({grant: grant({}, {protectedFiles: [{path: p, allowedChange: "x"}]}), changedFiles: [p], manifestAfter: BEFORE});
        expect(r.violations.find((v) => v.code === "NEVER_DELEGABLE_PATH"), p).toBeTruthy();
        expect(r.ok).toBe(false);
      });
    }
    it("the spec's never-delegable set is present in the exported lists", () => {
      for (const p of ["config/protected-paths.json", "CODEOWNERS", ".github/CODEOWNERS", "scripts/generate-trust-root.mjs", "scripts/verify-trust-root.mjs", "config/environment-policy.json", "config/builder-execution-policy.json", "docs/governance/COORDINATOR-SCOPE-GRANTS.md"]) expect(NEVER_DELEGABLE_EXACT).toContain(p);
      for (const p of [".github/", "scripts/ci/uasco-review/", "docs/authority-grants/"]) expect(NEVER_DELEGABLE_PREFIXES).toContain(p);
    });
    it("RESEAL_OUTSIDE_GRANT when another file's hash changes, an entry is added, or an entry is removed", () => {
      const other = man({[SERVER]: "a2", [MAIN]: "b2", "AGENTS.md": "c2", "config/other.json": "d1"});
      expect(ev({manifestAfter: other}).violations).toEqual([{code: "RESEAL_OUTSIDE_GRANT", path: "AGENTS.md"}]);
      expect(ev({manifestAfter: man({[SERVER]: "a2", [MAIN]: "b2", "AGENTS.md": "c1", "config/other.json": "d1", "config/brand-new.json": "n1"})}).violations).toEqual([{code: "RESEAL_OUTSIDE_GRANT", path: "config/brand-new.json"}]);
      expect(ev({manifestAfter: man({[SERVER]: "a2", [MAIN]: "b2", "config/other.json": "d1"})}).violations).toEqual([{code: "RESEAL_OUTSIDE_GRANT", path: "AGENTS.md"}]);
    });
    it("RESEAL_OUTSIDE_GRANT when sealStatus or schemaVersion changes", () => {
      expect(codes(ev({manifestAfter: {...RESEALED, sealStatus: "UNSEALED"}}))).toEqual(["RESEAL_OUTSIDE_GRANT"]);
      expect(codes(ev({manifestAfter: {...RESEALED, schemaVersion: "9.9.9"}}))).toEqual(["RESEAL_OUTSIDE_GRANT"]);
    });
    it("RESEAL_OUTSIDE_GRANT is evaluated on manifest content even when the manifest is absent from changedFiles", () => {
      expect(codes(ev({changedFiles: [SERVER], manifestAfter: man({[SERVER]: "a1", [MAIN]: "b1", "AGENTS.md": "ZZ", "config/other.json": "d1"})}))).toEqual(["RESEAL_OUTSIDE_GRANT"]);
    });
    it("a missing (null) manifest on the base side counts as empty: every after-entry of a non-granted file is outside the grant", () => {
      const r = ev({manifestBefore: null});
      expect(r.violations.map((v) => v.path)).toEqual(["AGENTS.md", "config/other.json"]);
    });
    it("collects several violations in fixed code order", () => {
      const r = ev({grant: grant({status: "PROPOSED"}), now: Date.parse("2030-01-01T00:00:00Z"), changedFiles: [SERVER, "AGENTS.md", ".github/workflows/ci.yml"], manifestAfter: man({[SERVER]: "a2", [MAIN]: "b1", "AGENTS.md": "c9", "config/other.json": "d1"})});
      expect(codes(r)).toEqual(["GRANT_NOT_ACTIVE", "GRANT_EXPIRED", "NEVER_DELEGABLE_PATH", "PROTECTED_CHANGE_OUTSIDE_GRANT", "PROTECTED_CHANGE_OUTSIDE_GRANT", "RESEAL_OUTSIDE_GRANT"]);
    });
  });

  describe("scope grant evaluator: malformed input is GRANT_INVALID and never throws", () => {
    const g = () => grant();
    const cases: Array<[string, Partial<ScopeGrantInput>]> = [
      ["null grant", {grant: null}], ["array grant", {grant: []}], ["string grant", {grant: "ACTIVE"}],
      ["missing status", {grant: (({status, ...r}) => r)(g())}], ["numeric status", {grant: grant({status: 1})}],
      ["missing founderStatement", {grant: (({founderStatement, ...r}) => r)(g())}],
      ["founderStatement without channel", {grant: grant({founderStatement: {quote: "q", at: "2026-10-21"}})}],
      ["founderStatement with empty quote", {grant: grant({founderStatement: {quote: " ", at: "2026-10-21", channel: "c"}})}],
      ["missing scope", {grant: (({scope, ...r}) => r)(g())}], ["protectedFiles not an array", {grant: grant({}, {protectedFiles: "x"})}],
      ["protectedFiles entry without allowedChange", {grant: grant({}, {protectedFiles: [{path: SERVER}]})}],
      ["protectedFiles entry that is not an object", {grant: grant({}, {protectedFiles: [SERVER]})}],
      ["absolute granted path", {grant: grant({}, {protectedFiles: [{path: "/etc/passwd", allowedChange: "x"}]})}],
      ["granted path with ..", {grant: grant({}, {protectedFiles: [{path: "apps/../.github/x.yml", allowedChange: "x"}]})}],
      ["granted glob path", {grant: grant({}, {protectedFiles: [{path: "apps/**", allowedChange: "x"}]})}],
      ["granted directory path", {grant: grant({}, {protectedFiles: [{path: "apps/desktop/", allowedChange: "x"}]})}],
      ["granted backslash path", {grant: grant({}, {protectedFiles: [{path: "apps\\desktop\\main.mjs", allowedChange: "x"}]})}],
      ["allowTrustRootReseal not boolean", {grant: grant({}, {allowTrustRootReseal: "yes"})}],
      ["missing reference", {grant: (({reference, ...r}) => r)(g())}],
      ["expiresAt without Z", {grant: grant({expiresAt: "2026-11-21T00:00:00"})}], ["expiresAt prose", {grant: grant({expiresAt: "tomorrow"})}], ["expiresAt missing", {grant: grant({expiresAt: undefined})}],
      ["null policy", {protectedPolicy: null}], ["policy without exactPaths", {protectedPolicy: {protectedPrefixes: ["config/"]}}],
      ["empty policy", {protectedPolicy: {exactPaths: [], protectedPrefixes: []}}], ["policy with non-string path", {protectedPolicy: {exactPaths: [1]}}],
      ["changedFiles not an array", {changedFiles: "a.ts"}], ["changed file not a string", {changedFiles: [SERVER, 7]}],
      ["absolute changed file", {changedFiles: ["/etc/passwd"]}], ["changed file with ..", {changedFiles: ["a/../.github/x"]}], ["empty changed file", {changedFiles: [""]}],
      ["manifest without files", {manifestAfter: {schemaVersion: "1.0.0"}}], ["manifest entry without sha256", {manifestAfter: {files: [{path: SERVER}]}}],
      ["manifest string", {manifestAfter: "{}"}],
      ["duplicate manifest entry hides a change", {manifestAfter: {...RESEALED, files: [...RESEALED.files, {path: "AGENTS.md", sha256: "evil"}, {path: "agents.md", sha256: "evil"}]}}],
      ["manifest changed but manifestBefore not supplied", {manifestBefore: undefined}], ["manifest changed but manifestAfter not supplied", {manifestAfter: undefined}],
      ["now undefined", {now: undefined}], ["now NaN", {now: NaN}], ["now prose", {now: "yesterday"}], ["now invalid Date", {now: new Date("x")}],
    ];
    for (const [name, over] of cases) {
      it(`GRANT_INVALID: ${name}`, () => {
        let r: ReturnType<typeof evaluateScopeGrant> | undefined;
        expect(() => { r = ev(over); }).not.toThrow();
        expect(r?.ok).toBe(false);
        expect(codes(r!).every((c) => c === "GRANT_INVALID")).toBe(true);
        expect(codes(r!).length).toBeGreaterThan(0);
      });
    }
    it("GRANT_INVALID for a non-object call argument and for hostile objects", () => {
      for (const bad of [undefined, null, 5, "x", [], () => 1]) expect(codes(evaluateScopeGrant(bad as any))).toEqual(["GRANT_INVALID"]);
      const hostile = new Proxy({}, {get() { throw new Error("boom"); }, has() { throw new Error("boom"); }});
      expect(codes(evaluateScopeGrant(hostile as any))).toEqual(["GRANT_INVALID"]);
      expect(codes(evaluateScopeGrant({...base(), grant: hostile as any}))).toEqual(["GRANT_INVALID"]);
    });
    it("reports the offending path for a bad changed file or granted path", () => {
      expect(ev({changedFiles: ["a/../b"]}).violations).toEqual([{code: "GRANT_INVALID", path: "a/../b"}]);
      expect(ev({grant: grant({}, {protectedFiles: [{path: "apps/**", allowedChange: "x"}]})}).violations).toEqual([{code: "GRANT_INVALID", path: "apps/**"}]);
    });
  });

  // //TR: CLI senaryolari gecici bir git deposunda calisir: c0 (bos), c1 (taban: politika + manifest + dosyalar), sonra c1'den dallanan ok / bad-ci / bad-reseal / bad-rename dallari.
  describe("scripts/check-scope-grant.mjs", {timeout: 120000}, () => {
    const cli = path.resolve("scripts/check-scope-grant.mjs");
    let dir = "", tmp = "";
    const GIT_ENV = {...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0"};
    const git = (...a: string[]) => { const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", ...a], {cwd: dir, encoding: "utf8", env: GIT_ENV}); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
    const put = (p: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, p)), {recursive: true}); fs.writeFileSync(path.join(dir, p), text); };
    const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
    const commit = (msg: string) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };
    const run = (args: string[]) => { const r = spawnSync(process.execPath, [cli, ...args], {cwd: dir, encoding: "utf8", timeout: 60000}); const lines = r.stdout.trim().split(/\r?\n/); return {status: r.status, out: r.stdout, err: r.stderr, last: lines[lines.length - 1]}; };
    const grantFile = (name: string, over: Record<string, unknown> = {}) => { const f = path.join(tmp, name); fs.writeFileSync(f, json(grant({expiresAt: "2099-01-01T00:00:00Z", ...over}))); return f; };
    let c0 = "";

    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-scopegrant-"));
      dir = path.join(tmp, "repo"); fs.mkdirSync(dir);
      git("init", "-q");
      put("README.md", "x\n"); c0 = commit("c0");
      put("config/protected-paths.json", json(POLICY)); put(MANIFEST, json(BEFORE));
      put(SERVER, "v1\n"); put(MAIN, "v1\n"); put("AGENTS.md", "v1\n"); put(".github/workflows/ci.yml", "v1\n"); put("apps/control-api/src/routes/intake.ts", "v1\n");
      commit("c1 base"); git("branch", "base");
      git("checkout", "-q", "-b", "ok", "base");
      put(SERVER, "v2\n"); put(MAIN, "v2\n"); put("apps/control-api/src/routes/intake.ts", "v2\n"); put(MANIFEST, json(RESEALED)); commit("ok");
      git("checkout", "-q", "-b", "bad-ci", "ok"); put(".github/workflows/ci.yml", "v2\n"); commit("bad-ci");
      git("checkout", "-q", "-b", "bad-reseal", "base"); put(SERVER, "v2\n"); put(MANIFEST, json(man({[SERVER]: "a2", [MAIN]: "b1", "AGENTS.md": "EVIL", "config/other.json": "d1"}))); commit("bad-reseal");
      git("checkout", "-q", "-b", "bad-rename", "base"); fs.mkdirSync(path.join(dir, "docs")); git("mv", ".github/workflows/ci.yml", "docs/ci.yml"); commit("bad-rename");
      git("checkout", "-q", "ok");
    }, 120000);
    afterAll(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* temp cleanup is best effort */ } });

    it("prints PASS and exits 0 for exactly the granted change and reseal", () => {
      const r = run([grantFile("g.json"), "base", "ok"]);
      expect(r.last).toBe("SCOPE_GRANT_CHECK: PASS");
      expect(r.status, r.out + r.err).toBe(0);
      expect(r.out).toContain("SCOPE_GRANT_CHANGED_FILES: 4");
    });
    it("works with a triple-dot range, HEAD-relative refs and commit ids", () => {
      expect(run([grantFile("g.json"), "HEAD~1", "HEAD"]).last).toBe("SCOPE_GRANT_CHECK: PASS");
      expect(run([grantFile("g.json"), git("rev-parse", "base"), git("rev-parse", "ok")]).last).toBe("SCOPE_GRANT_CHECK: PASS");
    });
    it("FAIL NEVER_DELEGABLE_PATH,PROTECTED_CHANGE_OUTSIDE_GRANT when a workflow changes", () => {
      const r = run([grantFile("g.json"), "ok", "bad-ci"]);
      expect(r.status).toBe(1);
      expect(r.last).toBe("SCOPE_GRANT_CHECK: FAIL NEVER_DELEGABLE_PATH,PROTECTED_CHANGE_OUTSIDE_GRANT");
      expect(r.out).toContain("VIOLATION NEVER_DELEGABLE_PATH .github/workflows/ci.yml");
    });
    it("FAIL RESEAL_OUTSIDE_GRANT when the manifest reseals another file's hash", () => {
      const r = run([grantFile("g.json"), "base", "bad-reseal"]);
      expect(r.status).toBe(1);
      expect(r.last).toBe("SCOPE_GRANT_CHECK: FAIL RESEAL_OUTSIDE_GRANT");
      expect(r.out).toContain("VIOLATION RESEAL_OUTSIDE_GRANT AGENTS.md");
    });
    it("a renamed protected file cannot hide: both the old and new path are checked", () => {
      const r = run([grantFile("g.json"), "base", "bad-rename"]);
      expect(r.status).toBe(1);
      expect(r.out).toContain("VIOLATION NEVER_DELEGABLE_PATH .github/workflows/ci.yml");
    });
    it("treats a PROPOSED grant as GRANT_NOT_ACTIVE, and only passes it with --assume-active-for-dry-run (clearly labelled)", () => {
      const f = grantFile("p.json", {status: "PROPOSED"});
      const r = run([f, "base", "ok"]);
      expect(r.status).toBe(1);
      expect(r.last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_NOT_ACTIVE");
      const d = run([f, "base", "ok", "--assume-active-for-dry-run"]);
      expect(d.status, d.out + d.err).toBe(0);
      expect(d.out).toContain("SCOPE_GRANT_DRY_RUN");
      expect(d.out).toContain("NOT an authorization");
      expect(d.last).toBe("SCOPE_GRANT_CHECK: PASS");
      expect(run(["--assume-active-for-dry-run", f, "base", "ok"]).last).toBe("SCOPE_GRANT_CHECK: PASS");
    });
    it("the dry-run flag never hides violations or expiry", () => {
      expect(run([grantFile("p.json", {status: "PROPOSED"}), "ok", "bad-ci", "--assume-active-for-dry-run"]).last).toBe("SCOPE_GRANT_CHECK: FAIL NEVER_DELEGABLE_PATH,PROTECTED_CHANGE_OUTSIDE_GRANT");
      expect(run([grantFile("e.json", {status: "PROPOSED", expiresAt: "2020-01-01T00:00:00Z"}), "base", "ok", "--assume-active-for-dry-run"]).last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_EXPIRED");
    });
    it("FAIL GRANT_EXPIRED for an expired ACTIVE grant", () => {
      const r = run([grantFile("e.json", {expiresAt: "2020-01-01T00:00:00Z"}), "base", "ok"]);
      expect(r.status).toBe(1);
      expect(r.last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_EXPIRED");
    });
    it("FAIL GRANT_INVALID for an unreadable or malformed grant file and for a missing protected policy at the base ref", () => {
      const bad = path.join(tmp, "bad.json"); fs.writeFileSync(bad, "{not json");
      expect(run([bad, "base", "ok"]).last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_INVALID");
      expect(run([path.join(tmp, "nope.json"), "base", "ok"]).last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_INVALID");
      expect(run([grantFile("g.json"), c0, "ok"]).last).toBe("SCOPE_GRANT_CHECK: FAIL GRANT_INVALID");
    });
    it("rejects wrong usage, option-looking refs (no file is written) and unknown refs", () => {
      const g = grantFile("g.json");
      expect(run([g, "base"]).last).toBe("SCOPE_GRANT_CHECK: FAIL USAGE");
      expect(run([]).status).toBe(1);
      const injected = run([g, "--output=pwned.txt", "ok"]);
      expect(injected.last).toBe("SCOPE_GRANT_CHECK: FAIL USAGE");
      expect(fs.existsSync(path.join(dir, "pwned.txt"))).toBe(false);
      expect(run([g, "base; echo x", "ok"]).last).toBe("SCOPE_GRANT_CHECK: FAIL USAGE");
      const missing = run([g, "base", "no-such-branch"]);
      expect(missing.status).toBe(1);
      expect(missing.last).toBe("SCOPE_GRANT_CHECK: FAIL GIT_ERROR");
    });
  });
}
