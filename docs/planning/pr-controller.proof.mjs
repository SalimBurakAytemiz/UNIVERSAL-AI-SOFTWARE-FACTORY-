// //TR: Bu betik PR denetleyicisi (docs/planning/pr-controller.mjs) için ağsız mutasyon kanıtıdır (COORD-TRANSITION-AUTONOMY): önce gerçek modüle karşı kısa bir senaryo takımı tamamen geçmeli; sonra denetleyiciyi zayıflatan her mutant (FAIL denetiminden önce filtreleme, bozuk kaydı yok sayma, base kuralını düşürme, eski base'e bağlı kararı kabul, push öncesi auto-merge kapatmayı atlama, head'e bağlı olmayan risk sınıfını kabul, bağımsızlık denetimini atlama, ...) geçici bir kopyada uygulanır ve en az bir senaryo tarafından öldürülmelidir. Mutantın kaynak metni bulunamazsa (kod değişti) kanıt başarısız olur.
// Run: node docs/planning/pr-controller.proof.mjs   (Node >= 22; no network; temp files only). Last line: "PR_CONTROLLER_PROOF: PASS n/n cases, k/k mutants killed".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "pr-controller.mjs");
const HEAD = "a".repeat(40), BASE = "b".repeat(40), NEWBASE = "c".repeat(40), OLDHEAD = "d".repeat(40);

// ---- The case suite: each case is a boolean over a controller module C (the real one, or a mutant). ----
function suite(C) {
  const v = (o = {}) => ({status: "PASS", headSha: HEAD, baseSha: BASE, kind: "APP", ...o});
  const proc = v({kind: "PROCESS", independentSession: true});
  const pr = (o = {}) => ({pr: 7, lane: "B", draft: false, headSha: HEAD, baseSha: BASE, prBaseSha: BASE, mergeable_state: "clean", ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: HEAD},
    independentVerification: v(), riskTier: "ROUTINE", riskTierHeadSha: HEAD, autoMerge: false, merged: false, priorNegative: false, priorNegativeHeadSha: HEAD, ...o});
  const a = s => C.nextActions(s).actions.map(x => x.action).join(",");
  const r = s => C.nextActions(s).actions.map(x => x.reason).join(",");
  const merges = s => C.nextActions(s).actions.some(x => x.action === "MERGE_HEAD");
  return [
    ["K1 all conditions met => MERGE_HEAD carrying the head SHA", JSON.stringify(C.nextActions(pr()).actions) === JSON.stringify([{action: "MERGE_HEAD", lane: null, reason: "ALL_CONDITIONS_MET", headSha: HEAD}])],
    ["K2 a FAIL with base null next to a PASS => Founder + remediation", a(pr({independentVerification: [v({status: "FAIL", baseSha: null}), proc]})) === "FOUNDER_REQUIRED,REMEDIATE_REVIEW"],
    ["K3 a FAIL with an upper-case head SHA counts on this head", a(pr({independentVerification: [v({status: "FAIL", headSha: HEAD.toUpperCase()}), proc]})) === "FOUNDER_REQUIRED,REMEDIATE_REVIEW"],
    ["K4 a FAIL of an unknown kind counts", a(pr({independentVerification: [v({status: "FAIL", kind: "HUMAN"}), v()]})) === "FOUNDER_REQUIRED,REMEDIATE_REVIEW"],
    ["K5 an unknown status next to a PASS stops the merge", r(pr({independentVerification: [v({status: "BLOCKED"}), v()]})) === "VERIFICATION_MALFORMED"],
    ["K6 a PASS without base stops the merge", r(pr({independentVerification: [v({baseSha: undefined})]})) === "VERIFICATION_MALFORMED"],
    ["K7 a FAIL on another head does not block", a(pr({independentVerification: [v({status: "FAIL", headSha: OLDHEAD}), v()]})) === "MERGE_HEAD"],
    ["K8 base moved => UPDATE_BRANCH", r(pr({baseSha: NEWBASE})) === "BASE_MOVED"],
    ["K9 verdict re-bound to the new tip but CI on the old base => UPDATE_BRANCH", r(pr({baseSha: NEWBASE, independentVerification: v({baseSha: NEWBASE})})) === "BASE_MOVED"],
    ["K10 pulls.base.sha at the tip, verdict on another base => REVERIFY", r(pr({baseSha: NEWBASE, prBaseSha: NEWBASE})) === "VERIFICATION_STALE_BASE"],
    ["K11 FOUNDER tier is not updated on a base move", a(pr({baseSha: NEWBASE, riskTier: "FOUNDER"})) === "FOUNDER_REQUIRED"],
    ["K12 an arm on this head is removed before a lane push", r(pr({autoMerge: true, autoMergeArmedHead: HEAD, ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}})) === "AUTO_MERGE_BEFORE_PUSH,CI_FAILED"],
    ["K13 an arm on this head without a push is kept", a(pr({autoMerge: true, autoMergeArmedHead: HEAD})) === "MERGE_HEAD"],
    ["K14 an arm on another head is removed", a(pr({autoMerge: true, autoMergeArmedHead: OLDHEAD})) === "DISABLE_AUTO_MERGE,MERGE_HEAD"],
    ["K15 a tier computed for another head never merges", r(pr({riskTierHeadSha: OLDHEAD})) === "RISK_TIER_STALE"],
    ["K16 a prior record computed for another head never merges", r(pr({priorNegativeHeadSha: OLDHEAD})) === "PRIOR_VERDICT_STALE"],
    ["K17 a process PASS without an independent session never merges", !merges(pr({independentVerification: v({kind: "PROCESS"})}))],
    ["K18 CI of another head => WAIT_CI", r(pr({ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: OLDHEAD}})) === "CI_STALE"],
    ["K19 FOUNDER tier never merges", a(pr({riskTier: "FOUNDER"})) === "FOUNDER_REQUIRED"],
    ["K20 a prior negative never merges", a(pr({priorNegative: true})) === "FOUNDER_REQUIRED"],
    ["K21 a missing pulls.base.sha is malformed", r(pr({prBaseSha: undefined})) === "STATE_MALFORMED"],
    ["K22 FAIL + PASS on the same head => Founder", a(pr({independentVerification: [v({status: "FAIL"}), v()]})) === "FOUNDER_REQUIRED,REMEDIATE_REVIEW"],
    ["K23 an auth failure alone => BLOCK_REVIEW_AUTH", a(pr({independentVerification: v({status: "AUTH_FAILED", baseSha: null})})) === "BLOCK_REVIEW_AUTH"],
    ["K24 a conflict goes to the lane", JSON.stringify(C.nextActions(pr({mergeable_state: "dirty"})).actions) === JSON.stringify([{action: "RESOLVE_CONFLICT", lane: "B", reason: "MERGE_CONFLICT"}])],
    ["K25 unknown mergeability waits", r(pr({mergeable_state: "unknown"})) === "MERGEABILITY_UNKNOWN"],
    ["K26 a draft is marked ready first", a(pr({draft: true})) === "MARK_READY,MERGE_HEAD"],
    ["K27 an unreadable record of another head is ignored", a(pr({independentVerification: [v({status: "BLOCKED", headSha: OLDHEAD}), v()]})) === "MERGE_HEAD"],
    ["K28 a non-object record stops the merge", r(pr({independentVerification: ["PASS", v()]})) === "VERIFICATION_MALFORMED"],
    ["K29 a CI failure goes to the lane", r(pr({ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}})) === "CI_FAILED"],
  ];
}

// ---- Mutants: each is one textual change in pr-controller.mjs, and must make at least one case fail. ----
const MUTANTS = [
  ["filter the records before the FAIL check (round 2 finding)", "const entries = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];",
    "const entries = (raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw]).filter(wellFormed);"],
  ["count a FAIL only with an exact head", 'if (entries.some(v => isObj(v) && v.status === "FAIL" && !otherHead(v))) {', 'if (entries.some(v => isObj(v) && v.status === "FAIL" && v.headSha === s.headSha)) {'],
  ["let any FAIL block, even of another head", 'if (entries.some(v => isObj(v) && v.status === "FAIL" && !otherHead(v))) {', 'if (entries.some(v => isObj(v) && v.status === "FAIL")) {'],
  ["ignore unreadable records", 'if (entries.some(v => !wellFormed(v) && !otherHead(v))) { act("NOOP", "VERIFICATION_MALFORMED"); return done(); }', ""],
  ["let unreadable records of another head block", 'if (entries.some(v => !wellFormed(v) && !otherHead(v))) {', "if (entries.some(v => !wellFormed(v))) {"],
  ["accept a PASS without a base", '(v.status === "PASS" ? isSha(v.baseSha) :', '(v.status === "PASS" ? true :'],
  ["drop the base rule (pulls.base.sha == tip)", 'if (mayMerge && s.prBaseSha !== s.baseSha) { act("UPDATE_BRANCH", "BASE_MOVED"); return done(); }', ""],
  ["accept a verdict bound to any base", "onHead(v) && v.baseSha === s.baseSha);", "onHead(v));"],
  ["update FOUNDER-tier PRs on a base move", "if (mayMerge && s.prBaseSha !== s.baseSha) {", "if (s.prBaseSha !== s.baseSha) {"],
  ["keep an arm on this head before a push", "(!armedOnHead || out.some(a => PUSHES.has(a.action)))", "!armedOnHead"],
  ["keep every arm", "(!armedOnHead || out.some(a => PUSHES.has(a.action)))", "out.some(a => PUSHES.has(a.action))"],
  ["accept a tier of any head", "const tierBound = isSha(s.riskTierHeadSha) && s.riskTierHeadSha === s.headSha;", "const tierBound = true;"],
  ["accept a prior record of any head", "const priorBound = isSha(s.priorNegativeHeadSha) && s.priorNegativeHeadSha === s.headSha;", "const priorBound = true;"],
  ["accept a process PASS without an independent session", '(v.kind === "PROCESS" && v.independentSession === true)', '(v.kind === "PROCESS")'],
  ["accept CI of another head", 'if (ci.headSha !== s.headSha) { act("WAIT_CI", "CI_STALE"); return done(); }', ""],
  ["merge FOUNDER tier", 'const blockedByAuthority = tier === null || tier === "FOUNDER" || prior !== false;', "const blockedByAuthority = tier === null || prior !== false;"],
  ["ignore a prior negative", 'const blockedByAuthority = tier === null || tier === "FOUNDER" || prior !== false;', 'const blockedByAuthority = tier === null || tier === "FOUNDER";'],
  ["accept a missing pulls.base.sha", "if (!isSha(s.prBaseSha)) return true;", ""],
  ["let a PASS outvote a FAIL on the same head", 'if (entries.some(v => isObj(v) && v.status === "PASS" && v.headSha === s.headSha)) act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT");\n    act("REMEDIATE_REVIEW", "VERIFICATION_FAILED");\n    return done();', ""],
  ["merge without the head SHA", 'act("MERGE_HEAD", "ALL_CONDITIONS_MET", {headSha: s.headSha});', 'act("MERGE_HEAD", "ALL_CONDITIONS_MET");'],
  ["merge with unknown mergeability", 'if (ms === "unknown") { act("NOOP", "MERGEABILITY_UNKNOWN"); return done(); }', ""],
  ["skip the conflict check", 'if (ms === "dirty") { act("RESOLVE_CONFLICT", "MERGE_CONFLICT"); return done(); }', ""],
];

let n = 0, caseFail = 0;
const line = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); };
const C0 = await import("./pr-controller.mjs");
for (const [name, ok] of suite(C0)) { n++; if (!ok) caseFail++; line(ok, name); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-controller-mut-"));
const src = fs.readFileSync(SRC, "utf8");
const load = async (dir, text) => { fs.mkdirSync(dir, {recursive: true}); const f = path.join(dir, "pr-controller.mjs"); fs.writeFileSync(f, text); return import(pathToFileURL(f).href); };
// The harness itself: an unmutated copy must pass every case, so a killed mutant is killed by its change and not by the copy.
const controlOk = suite(await load(path.join(tmp, "control"), src)).every(([, ok]) => ok);
n++; if (!controlOk) caseFail++; line(controlOk, "H1 the unmutated copy passes every case");
let killed = 0;
for (const [i, [name, from, to]] of MUTANTS.entries()) {
  const count = src.split(from).length - 1;
  if (count !== 1) { line(false, `MUTANT ${i + 1} ${name}: source text found ${count} times (stale mutant)`); continue; }
  let res;
  try { res = suite(await load(path.join(tmp, `m${i + 1}`), src.replace(from, () => to))); } catch { res = [["IMPORT_FAILED", false]]; }
  const by = res.filter(([, ok]) => !ok).map(([c]) => c.split(" ")[0]);
  if (by.length && !by.includes("IMPORT_FAILED")) killed++;
  line(by.length > 0 && !by.includes("IMPORT_FAILED"), `MUTANT ${i + 1} ${name}: killed by ${by.join(",") || "nothing"}`);
}
fs.rmSync(tmp, {recursive: true, force: true});
const pass = caseFail === 0 && killed === MUTANTS.length;
console.log(`PR_CONTROLLER_PROOF: ${pass ? "PASS" : "FAIL"} ${n - caseFail}/${n} cases, ${killed}/${MUTANTS.length} mutants killed`);
process.exit(pass ? 0 : 1);
