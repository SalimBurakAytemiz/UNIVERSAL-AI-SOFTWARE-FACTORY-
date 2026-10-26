// //TR: docs/planning/merge-risk.mjs risk sınıflandırıcısı ve Autonomous Authority Engine dar sınıfları için senaryolar (COORD-TRANSITION-AUTONOMY): gerçek PR diff'leri (#225 batch 4a d813d34, batch 4b fee6cef, #214 a4fb2ee, 9f0018d) pozitif fikstür; yasak ifade, silme, bölge dışı, çapasız desen, eksik içerik, sandbox kablosu, test silme negatif fikstür. Ayrıca merge-gate kanıtı ve sınıflandırıcı mutasyon kanıtı bu kayıtlı dosyadan çalışır (korunan validation.json kaydı gerekmez).
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import * as R from "../../docs/planning/merge-risk.mjs";
import * as G from "../../core/authority/protected-change-grammar.mjs";
import * as A from "../../core/authority/autonomous-authority.mjs";

type Fx = {commit: string; base: string; diff: string; registered?: string};
const FX = JSON.parse(fs.readFileSync("tests/support/merge-risk.fixtures.json", "utf8")) as Record<string, Fx>;
const SRV = "apps/control-api/src/server.ts", MAIN = "apps/desktop/main.mjs", VAL = "config/validation.json", MAN = "config/trust-root-manifest.json";
const REAL_PP = JSON.parse(fs.readFileSync("config/protected-paths.json", "utf8"));
const H = (t: string) => crypto.createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

// //TR: Gerçek git hunk'larını baz alıntısına bağlamdan eşleyerek uygular (satır numarası değil; her eski blok tam bir kez bulunmalıdır). keep: uygulanacak hunk indeksleri; drop: atlanacak eklenen satırlar.
function applyDiff(base: string, diff: string, keep?: (i: number) => boolean, drop?: RegExp): string {
  let lines = base.split("\n");
  const hunks = diff.split("\n").reduce<string[][]>((acc, l) => { if (l.startsWith("@@")) acc.push([]); else if (acc.length && !l.startsWith("\\")) acc[acc.length - 1].push(l); return acc; }, []);
  hunks.forEach((h, i) => {
    if (keep && !keep(i)) return;
    const body = h[h.length - 1] === "" ? h.slice(0, -1) : h;
    const old = body.filter(l => l[0] === " " || l[0] === "-").map(l => l.slice(1));
    const neu = body.filter(l => l[0] === " " || (l[0] === "+" && !(drop && drop.test(l)))).map(l => l.slice(1));
    const at = lines.findIndex((_, k) => old.every((o, j) => lines[k + j] === o));
    const again = lines.findIndex((_, k) => k > at && old.every((o, j) => lines[k + j] === o));
    if (at < 0 || again >= 0) throw new Error(`HUNK_CONTEXT_NOT_UNIQUE:${i}`);
    lines = [...lines.slice(0, at), ...neu, ...lines.slice(at + old.length)];
  });
  return lines.join("\n");
}
const mod = (filename: string, baseText: string | null, headText: string | null) => ({filename, status: "modified", baseText, headText});
const classify = (files: unknown[], extra: Record<string, unknown> = {}) => R.classifyChange({files, protectedPaths: REAL_PP, ...extra});
const tierOf = (file: string, base: string, head: string) => classify([mod(file, base, head)]).files[0];
const s4b = () => ({base: FX.server4b.base, head: applyDiff(FX.server4b.base, FX.server4b.diff)});
const m4b = () => ({base: FX.main4b.base, head: applyDiff(FX.main4b.base, FX.main4b.diff)});
// Batch 4a without its sandbox hook: the two registrations and their imports only (hunks 1-2), the Linux provider import dropped.
const s4aRoutes = () => applyDiff(FX.server4a.base, FX.server4a.diff, i => i < 2, /LinuxUnshareSandboxProvider|linux-sandbox-provider/);
const m4aAllow = () => applyDiff(FX.main4a.base, FX.main4a.diff, i => i < 2);
const addRegister = (head: string, line: string) => head.replace("registerTaskRoutes(app,laneDeps);", `${line}\nregisterTaskRoutes(app,laneDeps);`);
const routeImport = 'import {registerWidgetStatusRoutes} from "./routes/widget-status.js";';
const withImport = (t: string) => t.replace('import {registerRunSummaryRoutes} from "./routes/run-summaries.js";', `import {registerRunSummaryRoutes} from "./routes/run-summaries.js";\n${routeImport}`);

export function registerMergeRiskCases() {
  describe("merge risk classifier (COORD-TRANSITION-AUTONOMY)", () => {
    it("the real fixtures apply cleanly to their real base excerpts", () => {
      for (const k of ["server4a", "server4b", "main4a", "main4b", "validation214", "validation9f"]) expect(() => applyDiff(FX[k].base, FX[k].diff), k).not.toThrow();
      expect(s4b().head).toContain("registerProductRunRoutes(app,{...laneDeps,devruns:()=>getDevRuns()});");
      expect(m4b().head).toContain("WORK_RUN_PRODUCT_RE");
    });

    describe("ROUTE_REGISTRATION_APPEND (apps/control-api/src/server.ts)", () => {
      it("batch 4b (fee6cef: product-run and analysis registrations with lazy dependencies) is PREAUTHORIZED", () => {
        const {base, head} = s4b();
        expect(G.routeRegistrationViolations(base, head)).toEqual([]);
        expect(tierOf(SRV, base, head)).toEqual({file: SRV, tier: "PREAUTHORIZED", code: "ROUTE_REGISTRATION_APPEND"});
      });
      it("batch 4a registrations (d813d34 readiness + run summaries, sandbox hook left out) are PREAUTHORIZED", () => {
        expect(G.routeRegistrationViolations(FX.server4a.base, s4aRoutes())).toEqual([]);
        expect(tierOf(SRV, FX.server4a.base, s4aRoutes()).tier).toBe("PREAUTHORIZED");
      });
      it("the full batch 4a diff (ExecutionGate default provider = sandbox wiring) is FOUNDER, and so is its provider import alone", () => {
        const full = applyDiff(FX.server4a.base, FX.server4a.diff);
        expect(G.routeRegistrationViolations(FX.server4a.base, full)).toContain("NOT_PURELY_ADDITIVE");
        expect(tierOf(SRV, FX.server4a.base, full)).toEqual({file: SRV, tier: "FOUNDER", code: "PROTECTED_CLASS_MISMATCH"});
        const importOnly = applyDiff(FX.server4a.base, FX.server4a.diff, i => i < 2);
        expect(G.routeRegistrationViolations(FX.server4a.base, importOnly)).toContain("CORE_IMPORT_DENIED");
      });
      it("every deny token makes a lazy dependency expression FOUNDER (the same expression without it passes)", () => {
        const head0 = withImport(s4aRoutes());
        const ok = addRegister(head0, "registerWidgetStatusRoutes(app,{...laneDeps,widgets:()=>getStore().widgets(zz)});");
        expect(G.routeRegistrationViolations(FX.server4a.base, ok)).toEqual([]);
        for (const t of G.DENY_TOKENS) {
          const expr = t.endsWith("(") ? `getStore().widgets(a.${t}))` : `getStore().widgets(${t})`;
          expect(G.safeExpression(expr), t).toBe(false);
          const head = addRegister(head0, `registerWidgetStatusRoutes(app,{...laneDeps,widgets:()=>${expr}});`);
          expect(tierOf(SRV, FX.server4a.base, head).tier, t).toBe("FOUNDER");
        }
      });
      it("rejects everything outside the grammar", () => {
        const base = FX.server4a.base, head0 = withImport(s4aRoutes());
        const bad: [string, string, string][] = [
          ["removed line", base.replace("registerFlowRoutes(app,laneDeps);\n", ""), "NOT_PURELY_ADDITIVE"],
          ["modified line", s4aRoutes().replace("registerIntakeRoutes(app,laneDeps);", "registerIntakeRoutes(app,{...laneDeps});"), "NOT_PURELY_ADDITIVE"],
          ["registration before laneDeps", head0.replace(/^const laneDeps=/m, "registerWidgetStatusRoutes(app,laneDeps);\nconst laneDeps="), "REGISTER_BEFORE_LANE_DEPS"],
          ["registration outside the block", head0.replace(/^(function selectExecutors)/m, "registerWidgetStatusRoutes(app,laneDeps);\n$1"), "REGISTER_OUTSIDE_BLOCK"],
          ["registration not imported", addRegister(s4aRoutes(), "registerWidgetStatusRoutes(app,laneDeps);"), "REGISTER_NOT_IMPORTED"],
          ["registered twice", addRegister(addRegister(head0, "registerWidgetStatusRoutes(app,laneDeps);"), "registerWidgetStatusRoutes(app,laneDeps);"), "REGISTER_DUPLICATE"],
          ["existing route registered again", addRegister(s4aRoutes(), "registerFlowRoutes(app,laneDeps);"), "REGISTER_DUPLICATE"],
          ["overrides a laneDeps key (workosPolicy)", addRegister(head0, "registerWidgetStatusRoutes(app,{...laneDeps,workosPolicy:()=>allowAll()});"), "LANE_DEP_OVERRIDE"],
          ["closes the object to inject a statement", addRegister(head0, "registerWidgetStatusRoutes(app,{...laneDeps,w:()=>1}),evil(),({a:()=>1});"), "DEPENDENCY_EXPRESSION_DENIED"],
          ["assignment inside the dependency", addRegister(head0, "registerWidgetStatusRoutes(app,{...laneDeps,w:()=>(executorsCache=null)});"), "DEPENDENCY_EXPRESSION_DENIED"],
          ["string literal in the dependency", addRegister(head0, 'registerWidgetStatusRoutes(app,{...laneDeps,w:()=>getStore()["x"]});'), "DEPENDENCY_EXPRESSION_DENIED"],
          ["unicode escape in the dependency", addRegister(head0, "registerWidgetStatusRoutes(app,{...laneDeps,w:()=>pro\\u0063ess});"), "DEPENDENCY_EXPRESSION_DENIED"],
          ["arbitrary statement", addRegister(head0, "app.addHook(\"onRequest\",()=>{});"), "LINE_NOT_IN_GRAMMAR"],
          ["comment closing a block comment", addRegister(head0, "// */ evil()"), "COMMENT_NOT_IN_GRAMMAR"],
          ["aliased import", head0.replace(routeImport, 'import {registerWidgetStatusRoutes as x} from "./routes/widget-status.js";'), "LINE_NOT_IN_GRAMMAR"],
          ["default import from core", head0.replace(routeImport, `${routeImport}\nimport x from "../../../core/workos/store.js";`), "LINE_NOT_IN_GRAMMAR"],
          ["core import of the authority engine", head0.replace(routeImport, `${routeImport}\nimport {decide} from "../../../core/authority/autonomous-authority.js";`), "CORE_IMPORT_DENIED"],
          ["core import of the execution gate", head0.replace(routeImport, `${routeImport}\nimport {Gate} from "../../../core/workos/execution-gate.js";`), "CORE_IMPORT_DENIED"],
          ["import placed after laneDeps", addRegister(head0.replace(`\n${routeImport}`, ""), `${routeImport}\nregisterWidgetStatusRoutes(app,laneDeps);`), "IMPORT_AFTER_LANE_DEPS"],
          ["only a comment added", base.replace("registerTaskRoutes(app,laneDeps);", "// note\nregisterTaskRoutes(app,laneDeps);"), "NO_REGISTRATION_ADDED"],
        ];
        for (const [name, head, code] of bad) {
          expect(G.routeRegistrationViolations(base, head), name).toContain(code);
          expect(tierOf(SRV, base, head).tier, name).toBe("FOUNDER");
        }
        expect(G.routeRegistrationViolations(base, base)).toEqual(["NO_CHANGE"]);
        expect(G.routeRegistrationViolations(null, base)).toEqual(["CONTENT_MISSING"]);
      });
    });

    describe("DESKTOP_ALLOWLIST_APPEND (apps/desktop/main.mjs)", () => {
      it("batch 4b (fee6cef: GET product status, POST analysis step/plan and product start/stop) is PREAUTHORIZED", () => {
        const {base, head} = m4b();
        expect(G.desktopAllowlistViolations(base, head)).toEqual([]);
        expect(tierOf(MAIN, base, head)).toEqual({file: MAIN, tier: "PREAUTHORIZED", code: "DESKTOP_ALLOWLIST_APPEND"});
      });
      it("batch 4a allow-list hunks (d813d34: run tasks, readiness, run summaries) are PREAUTHORIZED; the full 4a diff (QUERY_RULES object and a listQueryAllowed call inside a function) is FOUNDER", () => {
        expect(G.desktopAllowlistViolations(FX.main4a.base, m4aAllow())).toEqual([]);
        expect(tierOf(MAIN, FX.main4a.base, m4aAllow()).tier).toBe("PREAUTHORIZED");
        const full = applyDiff(FX.main4a.base, FX.main4a.diff);
        expect(G.desktopAllowlistViolations(FX.main4a.base, full)).toContain("LINE_NOT_IN_GRAMMAR");
        expect(tierOf(MAIN, FX.main4a.base, full).tier).toBe("FOUNDER");
      });
      it("rejects everything outside the grammar", () => {
        const {base, head} = m4b();
        const decl = "const WORK_RUN_PRODUCT_RE=/^\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product$/;";
        expect(head).toContain(decl);
        const re = (body: string) => head.replace(decl, `const WORK_RUN_PRODUCT_RE=/${body}/;`);
        const bad: [string, string, string][] = [
          ["unanchored start", re("\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product$"), "REGEX_NOT_ANCHORED_PATH"],
          ["unanchored end", re("^\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product"), "REGEX_NOT_ANCHORED_PATH"],
          ["wildcard", re("^\\/v1\\/work-runs\\/.*$"), "REGEX_NOT_ANCHORED_PATH"],
          ["one-or-more", re("^\\/v1\\/work-runs\\/[a-z]+$"), "REGEX_NOT_ANCHORED_PATH"],
          ["negated class", re("^\\/v1\\/work-runs\\/[^/]{24}$"), "REGEX_NOT_ANCHORED_PATH"],
          ["optional group", re("^\\/v1\\/work-runs(?:\\/x)?$"), "REGEX_NOT_ANCHORED_PATH"],
          ["backreference", re("^\\/v1\\/(a)\\/\\1$"), "REGEX_NOT_ANCHORED_PATH"],
          ["upper-case segment", re("^\\/v1\\/Work$"), "REGEX_NOT_ANCHORED_PATH"],
          ["flags", head.replace(decl, decl.replace("$/;", "$/i;")), "LINE_NOT_IN_GRAMMAR"],
          ["existing regex changed", head.replace("const TASK_RUNS_RE=/^\\/v1\\/tasks\\/tsk_[0-9a-f]{24}\\/runs$/;", "const TASK_RUNS_RE=/^\\/v1\\/tasks\\/.*$/;"), "EXISTING_CONTENT_REMOVED"],
          ["existing regex removed", head.replace("const TASK_RUNS_RE=/^\\/v1\\/tasks\\/tsk_[0-9a-f]{24}\\/runs$/;\n", ""), "EXISTING_CONTENT_REMOVED"],
          ["array element removed", head.replace("TASK_DETAIL_RE,TASK_RUNS_RE,", "TASK_DETAIL_RE,"), "ARRAY_NOT_APPEND_ONLY"],
          ["array elements reordered", head.replace("TASK_DETAIL_RE,TASK_RUNS_RE,", "TASK_RUNS_RE,TASK_DETAIL_RE,"), "ARRAY_NOT_APPEND_ONLY"],
          ["array element replaced", head.replace(",WORK_RUN_PRODUCT_RE];", ",EXTRA_GET_ROUTES];"), "ARRAY_APPENDS_UNKNOWN_IDENTIFIER"],
          ["unanchored regex appended to POST", head.replace("\\/product\\/(?:start|stop)$/];", "\\/product\\/(?:start|stop)$/,/^\\/v1\\/[a-z]+$/];"), "REGEX_NOT_ANCHORED_PATH"],
          ["a regex that reads as a block-comment end", head.replace("\\/product\\/(?:start|stop)$/];", "\\/product\\/(?:start|stop)$/,/^\\/v1\\/.*/];"), "REGION_UNREADABLE"],
          ["Set of exact routes grown", head.replace('"/v1/cockpit",', '"/v1/cockpit","/v1/admin",'), "EXISTING_CONTENT_REMOVED"],
          ["function body changed", head.replace("return typeof value===\"string\"&&value.length<=128&&POST_ROUTE_RES", "return typeof value===\"string\"&&value.length<=4096&&POST_ROUTE_RES"), "EXISTING_CONTENT_REMOVED"],
          ["new listQueryAllowed call", head.replace("listQueryAllowed(value,\"/v1/reviews\",[\"missionId\",\"runId\"])", "listQueryAllowed(value,\"/v1/reviews\",[\"missionId\",\"runId\"])||listQueryAllowed(value,\"/v1/x\",[\"q\"])"), "EXISTING_CONTENT_REMOVED"],
          ["change outside the allow-list region", head.replace("// B4-ALLOWLIST-BEGIN", "const x=1;\n// B4-ALLOWLIST-BEGIN"), "CHANGE_OUTSIDE_ALLOWLIST"],
          ["markers removed", head.replace("// B5-POST-ALLOWLIST-END", ""), "ALLOWLIST_MARKERS_INVALID"],
          ["markers duplicated", head.replace("// B4-ALLOWLIST-END", "// B4-ALLOWLIST-END\n// B4-ALLOWLIST-END"), "ALLOWLIST_MARKERS_INVALID"],
          ["regex name reused", head.replace(decl, `${decl}\nconst TASK_RUNS_RE=/^\\/v1\\/x$/;`), "REGEX_NAME_NOT_NEW"],
          ["template literal", head.replace(decl, `${decl}\n// \`x\``), "REGION_UNREADABLE"],
          ["comment closing a block comment", head.replace(decl, `${decl}\n// */ x`), "COMMENT_NOT_IN_GRAMMAR"],
        ];
        for (const [name, h, code] of bad) {
          expect(G.desktopAllowlistViolations(base, h), name).toContain(code);
          expect(tierOf(MAIN, base, h).tier, name).toBe("FOUNDER");
        }
        // An Electron security setting is outside both regions.
        const electron = `${base}\nnew BrowserWindow({webPreferences:{contextIsolation:false}});`;
        expect(G.desktopAllowlistViolations(base, electron)).toContain("CHANGE_OUTSIDE_ALLOWLIST");
        expect(G.pathRegexBodyOk("^\\/v1\\/missions\\/msn_[0-9a-f]{24}\\/analysis\\/(?:step|plan)$")).toBe(true);
      });
    });

    describe("TEST_REGISTRATION_APPEND (config/validation.json)", () => {
      it("#214 (a4fb2ee: a split runner test added to tests-3) is PREAUTHORIZED when the file is known at head, FOUNDER when it is not", () => {
        const f = FX.validation214, head = applyDiff(f.base, f.diff);
        expect(classify([mod(VAL, f.base, head)], {headFiles: [f.registered]}).files[0]).toEqual({file: VAL, tier: "PREAUTHORIZED", code: "TEST_REGISTRATION_APPEND"});
        expect(classify([mod(VAL, f.base, head)]).files[0].tier).toBe("FOUNDER");
      });
      it("9f0018d (a new test appended to the last test step) is PREAUTHORIZED with the new test file in the same PR", () => {
        const f = FX.validation9f, head = applyDiff(f.base, f.diff);
        const r = classify([mod(VAL, f.base, head), {filename: f.registered!, status: "added"}]);
        expect(r.tier).toBe("PREAUTHORIZED");
        expect(r.classes).toEqual(["ROUTINE", "TEST_REGISTRATION_APPEND"]);
      });
      it("moving, removing or re-registering a test, shardPlan or command changes, a non-test file or a Windows-only step are FOUNDER", () => {
        const base = FX.validation214.base, v = JSON.parse(base);
        const edit = (fn: (x: any) => void) => { const x = structuredClone(v); fn(x); return JSON.stringify(x, null, 2); };
        const step = (x: any, id: string) => x.steps.find((s: any) => s.id === id);
        const NEW = "tests/zz-new.test.ts", present = {headFiles: [NEW, "tests/zz-other.test.ts"]};
        const okHead = edit(x => step(x, "tests-2").command.push(NEW));
        expect(classify([mod(VAL, base, okHead)], present).tier).toBe("PREAUTHORIZED");
        const bad: [string, string][] = [
          ["test moved between steps", edit(x => { const t = step(x, "tests").command.pop(); step(x, "tests-2").command.push(t); })],
          ["test removed", edit(x => { step(x, "tests").command.pop(); })],
          ["already registered test added again", edit(x => step(x, "tests-2").command.push(step(x, "tests").command[4]))],
          ["shardPlan changed", edit(x => { step(x, "tests-2").command.push(NEW); x.shardPlan.win32.count = 4; })],
          ["runner prefix changed", edit(x => { step(x, "tests-2").command.splice(2, 1, "run", "--bail"); step(x, "tests-2").command.push(NEW); })],
          ["non-test file added", edit(x => step(x, "tests-2").command.push("scripts/x.mjs"))],
          ["Windows-only step changed", edit(x => step(x, "tests-bs1-a").command.push(NEW))],
          ["validator step changed", edit(x => { step(x, "tests-2").command.push(NEW); step(x, "secret-sanity").command = ["node", "-e", "0"]; })],
          ["same test added twice", edit(x => { step(x, "tests-2").command.push(NEW); step(x, "tests-3").command.push(NEW); })],
          ["nothing added", edit(() => {})],
        ];
        for (const [name, head] of bad) expect(classify([mod(VAL, base, head)], present).files[0].tier, name).toBe("FOUNDER");
      });
    });

    describe("TRUST_ROOT_RESEAL (config/trust-root-manifest.json)", () => {
      const {base: sb, head: sh} = s4b(), {base: mb, head: mh} = m4b();
      const man = (entries: [string, string][], at: string, extra: Record<string, unknown> = {}) => JSON.stringify({"//TR": "x", schemaVersion: "1.0.0", generatedAt: at, sealStatus: "SEALED",
        files: entries.map(([path, text]) => ({path, sha256: H(text)})), ...extra}, null, 2) + "\n";
      const B = man([[MAIN, mb], [SRV, sb], ["scripts/secret-sanity.mjs", "x"]], "t1");
      it("resealing exactly the PREAUTHORIZED files of the same PR (batch 4b shape: server.ts + main.mjs) is PREAUTHORIZED", () => {
        const r = classify([mod(SRV, sb, sh), mod(MAIN, mb, mh), mod(MAN, B, man([[MAIN, mh], [SRV, sh], ["scripts/secret-sanity.mjs", "x"]], "t2"))]);
        expect(r.tier).toBe("PREAUTHORIZED");
        expect(r.classes).toEqual(["DESKTOP_ALLOWLIST_APPEND", "ROUTE_REGISTRATION_APPEND", "TRUST_ROOT_RESEAL"]);
      });
      it("a reseal that covers a FOUNDER file, a file not in the PR, a hash not from the head bytes, a removed or added entry, or an unsealed manifest is FOUNDER", () => {
        const badSrv = sh.replace("devruns:()=>getDevRuns()", "devruns:()=>process.env");
        const cases: [string, unknown[]][] = [
          ["covers a FOUNDER-tier server.ts", [mod(SRV, sb, badSrv), mod(MAN, B, man([[MAIN, mb], [SRV, badSrv], ["scripts/secret-sanity.mjs", "x"]], "t2"))]],
          ["reseals a file the PR does not change", [mod(SRV, sb, sh), mod(MAN, B, man([[MAIN, mb], [SRV, sh], ["scripts/secret-sanity.mjs", "y"]], "t2"))]],
          ["hash not computed from the head bytes", [mod(SRV, sb, sh), mod(MAN, B, man([[MAIN, mb], [SRV, sh + "x"], ["scripts/secret-sanity.mjs", "x"]], "t2"))]],
          ["entry removed", [mod(SRV, sb, sh), mod(MAN, B, man([[SRV, sh], ["scripts/secret-sanity.mjs", "x"]], "t2"))]],
          ["entry added", [mod(SRV, sb, sh), mod(MAN, B, man([[MAIN, mb], [SRV, sh], ["scripts/secret-sanity.mjs", "x"], ["scripts/x.mjs", "z"]], "t2"))]],
          ["seal status changed", [mod(SRV, sb, sh), mod(MAN, B, man([[MAIN, mb], [SRV, sh], ["scripts/secret-sanity.mjs", "x"]], "t2", {sealStatus: "UNSEALED"}))]],
          ["manifest contents missing", [mod(SRV, sb, sh), mod(MAN, null, null)]],
        ];
        for (const [name, files] of cases) {
          const r = classify(files);
          expect(r.tier, name).toBe("FOUNDER");
          expect(r.files.find(f => f.file === MAN)?.tier, name).toBe("FOUNDER");
        }
      });
    });

    describe("path tiers", () => {
      const names = (files: [string, string?, string?][]) => classify(files.map(([filename, status = "modified", previous_filename]) => ({filename, status, ...(previous_filename ? {previous_filename} : {})})));
      it("routine product code, tests and docs are ROUTINE", () => {
        const r = names([["apps/control-api/src/routes/widget.ts", "added"], ["core/workos/crew/analysis.ts"], ["tests/v7-new.test.ts", "added"], ["docs/planning/MERGE_GATE.md"],
          ["apps/desktop/renderer/views/flow.js"], ["tests/support/production-lanes.cases.ts"]]);
        expect(r.tier).toBe("ROUTINE");
        expect(r.classes).toEqual(["ROUTINE"]);
      });
      it("the high-risk set and the floors are FOUNDER even when protectedPaths does not list them", () => {
        const thin = {exactPaths: ["x"], protectedPrefixes: ["y/"]};
        for (const f of [".github/workflows/ci.yml", ".github/CODEOWNERS", "scripts/ci/uasco-review/run.mjs", "package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc", "tsconfig.json",
          "vitest.config.mts", "scripts/run-validation.mjs", "scripts/validate-shards.mjs", "scripts/generate-trust-root.mjs", "scripts/verify-trust-root.mjs", "scripts/secret-sanity.mjs",
          "scripts/ensure-dependencies.mjs", "automation/lib/trust-root.mjs", "config/automation.json", "prompts/AUTO-BUILDER.md", "CLAUDE.md", "AGENTS.md", "docs/planning/merge-gate.mjs",
          "docs/planning/merge-risk.mjs", "docs/planning/pr-controller.mjs", "docs/planning/merge-gate.proof.mjs", "core/authority/approval.ts", "core/sandbox/policy.ts",
          "core/agents/linux-unshare-sandbox.ts", "core/workos/execution-gate.ts", "apps/desktop/preload.mjs", "apps/desktop/renderer/index.html", "apps/desktop/renderer/app.js",
          "tests/review-governance.test.ts", "tests/support/autonomous-authority.cases.ts", "tests/support/merge-risk.cases.ts", "tests/support/merge-risk.fixtures.json",
          "tests/support/pr-controller.cases.ts"]) {
          const r = R.classifyChange({files: [{filename: f, status: "modified"}], protectedPaths: thin});
          expect(r.tier, f).toBe("FOUNDER");
        }
      });
      it("removing or renaming away a protected, high-risk or test file is FOUNDER; a missing or malformed entry is FOUNDER", () => {
        expect(names([["apps/control-api/src/server.ts", "removed"]]).files[0].code).toBe("PROTECTED_PATH_REMOVED");
        expect(names([["docs/x.ts", "renamed", "docs/planning/merge-gate.mjs"]]).files[0].code).toBe("PROTECTED_PATH_REMOVED");
        expect(names([["tests/v7-b1-workos.test.ts", "removed"]]).files[0].code).toBe("TEST_FILE_REMOVED");
        expect(names([["tests/b.test.ts", "renamed", "tests/a.test.ts"]]).files[0].code).toBe("TEST_FILE_REMOVED");
        expect(names([["tests/x.test.ts", "copied", "tests/a.test.ts"]]).tier).toBe("ROUTINE");
        expect(classify([{filename: SRV, status: "modified"}]).files[0].code).toBe("PROTECTED_CONTENT_MISSING");
        expect(classify([{filename: SRV, status: "added", baseText: "", headText: "x"}]).files[0].tier).toBe("FOUNDER");
        expect(classify([{filename: "a.ts", status: "moved"}]).files[0].code).toBe("FILE_ENTRY_MALFORMED");
        expect(classify([{filename: "a.ts", status: "renamed"}]).files[0].code).toBe("FILE_ENTRY_MALFORMED");
        expect(classify([{filename: "a.ts", status: "modified"}, {filename: "A.ts", status: "modified"}]).tier).toBe("FOUNDER");
        expect(R.classifyChange({files: "x", protectedPaths: REAL_PP})).toEqual({tier: "FOUNDER", files: [], classes: ["FILES_MALFORMED"]});
        expect(R.classifyChange({files: [{filename: "a.ts", status: "modified"}], protectedPaths: {exactPaths: [], protectedPrefixes: []}}).tier).toBe("FOUNDER");
      });
      it("the PR tier is the highest file tier and every output code is a fixed code (no PR text is echoed)", () => {
        const marker = "ZQX-MARKER";
        const r = classify([{filename: `docs/${marker}.md`, status: "added"}, mod(SRV, s4b().base, s4b().head), {filename: "package.json", status: "modified", baseText: marker, headText: marker}]);
        expect(r.tier).toBe("FOUNDER");
        expect(r.classes).toEqual(["CI_EXECUTED_PATH", "ROUTE_REGISTRATION_APPEND", "ROUTINE"]);
        expect(r.classes.every(c => R.FILE_CODES.includes(c))).toBe(true);
        expect(JSON.stringify(r.classes)).not.toContain(marker);
      });
      it("one canonical matcher (raw lower-cased startsWith) covers the trust-root boundary matcher: every sealed file is protected, and validate-/run-validation prefixes match by string", () => {
        const m = R.pathMatcher(REAL_PP);
        const manifest = JSON.parse(fs.readFileSync(MAN, "utf8")) as {files: {path: string}[]};
        const missed = manifest.files.map(f => f.path).filter(p => !m.protectedHit(R.normPath(p)!));
        expect(missed).toEqual([]);
        for (const p of ["scripts/validate-role-registry.mjs", "scripts/run-validation.mjs.bak", "Config/Validation.JSON", "automation/lib/x.mjs"]) expect(m.protectedHit(R.normPath(p)!), p).toBe(true);
        for (const p of ["configx/a.json", "automation/libx/a.mjs", "docs/config/a.md"]) expect(m.protectedHit(R.normPath(p)!), p).toBe(false);
        // The trust-root boundary rule would not seal scripts/validate-role-registry.mjs; the gate still classes it FOUNDER.
        expect(classify([{filename: "scripts/validate-role-registry.mjs", status: "modified"}]).tier).toBe("FOUNDER");
      });
      it("the new gate files are FOUNDER by both lists: config/protected-paths.json and the high-risk set", () => {
        const m = R.pathMatcher(REAL_PP);
        for (const f of ["docs/planning/merge-gate.mjs", "docs/planning/merge-risk.mjs", "docs/planning/merge-risk.d.mts", "docs/planning/pr-controller.mjs", "docs/planning/pr-controller.d.mts",
          "docs/planning/merge-gate.proof.mjs", "docs/planning/merge-risk.proof.mjs", "core/authority/autonomous-authority.mjs", "core/authority/protected-change-grammar.mjs",
          "tests/review-governance.test.ts", "tests/support/merge-risk.cases.ts", "tests/support/merge-risk.fixtures.json", "tests/support/pr-controller.cases.ts",
          "tests/support/autonomous-authority.cases.ts", "scripts/ci/uasco-review/review-gate.mjs", "scripts/ci/uasco-review/review-gate.proof.mjs"]) {
          expect(m.protectedHit(f), f).toBe(true);
          expect(R.isHighRisk(f), f).toBe(true);
        }
      });
    });

    it("the narrow classes stay engine classes: AAE evaluateProtectedChange decides them, merge-risk only maps the target files", () => {
      expect(A.PROTECTED_CHANGE_CLASSES).toEqual(["TEST_REGISTRATION_APPEND", "TRUST_ROOT_RESEAL", "ROUTE_REGISTRATION_APPEND", "DESKTOP_ALLOWLIST_APPEND"]);
      expect(R.PREAUTHORIZED_CLASSES).toEqual({[VAL]: "TEST_REGISTRATION_APPEND", [MAN]: "TRUST_ROOT_RESEAL", [SRV]: "ROUTE_REGISTRATION_APPEND", [MAIN]: "DESKTOP_ALLOWLIST_APPEND"});
      const d = A.evaluateProtectedChange({classId: "ROUTE_REGISTRATION_APPEND", file: SRV, headSha: "a".repeat(40), baseText: s4b().base, headText: s4b().head});
      expect(d.status).toBe(A.AUTO);
      expect(A.evaluateProtectedChange({classId: "ROUTE_REGISTRATION_APPEND", file: MAIN, headSha: "a".repeat(40), baseText: s4b().base, headText: s4b().head}).status).toBe(A.BLOCKED);
      // The policy genesis is not activated by this change: the real repository still has no sealed authority policy.
      expect(A.loadSealedPolicy(process.cwd()).seal.ok).toBe(false);
    });

    it("the merge-gate proof passes (run from this registered file)", {timeout: 120000}, () => {
      const r = spawnSync(process.execPath, ["docs/planning/merge-gate.proof.mjs"], {encoding: "utf8", timeout: 110000});
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const m = /^MERGE_GATE_PROOF: PASS \((\d+)\/(\d+) checks\)$/.exec(r.stdout.trim().split(/\r?\n/).pop() ?? "");
      expect(m?.[1]).toBe(m?.[2]);
      expect(Number(m?.[1])).toBeGreaterThanOrEqual(200);
    });

    it("every classifier mutant is killed by a case (merge-risk mutation proof)", {timeout: 170000}, () => {
      const r = spawnSync(process.execPath, ["docs/planning/merge-risk.proof.mjs"], {encoding: "utf8", timeout: 160000});
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const m = /^MERGE_RISK_PROOF: PASS (\d+)\/(\d+) cases, (\d+)\/(\d+) mutants killed$/.exec(r.stdout.trim().split(/\r?\n/).pop() ?? "");
      expect(m, r.stdout.slice(-2000)).not.toBeNull();
      expect(m?.[1]).toBe(m?.[2]);
      expect(m?.[3]).toBe(m?.[4]);
      expect(Number(m?.[4])).toBeGreaterThanOrEqual(15);
    });
  });
}
