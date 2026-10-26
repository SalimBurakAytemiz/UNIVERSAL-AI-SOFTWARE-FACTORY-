// //TR: Bu betik merge-gate.mjs için ağsız, bağımsız kanıttır: bir pozitif MERGE durumu, her biri tek bir koşulu bozan negatif/mutasyon durumları (head/base kayması, draft/merged PR, eksik/pending/başarısız CI, yanlış SHA/app, issue-comment verdict, eski commit verdict'i, sonraki BLOCKED, korumalı yol, eksik ruleset, strict+aynı hesap, bozuk alanlar, enjeksiyon), CLI çıkış kodları ve güvenilmeyen metnin hiç yankılanmadığını gösteren işaret taraması.
// Run: node docs/planning/merge-gate.proof.mjs   (Node >= 22; no network; writes temp files only)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {evaluateMergeGate, verifyPostMerge, parseBinding, REQUIRED_CONTEXTS, INVISIBLE_RE} from "./merge-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "merge-gate.mjs");
let failures = 0, n = 0;
const check = (name, cond, detail = "") => { n++; if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? " :: " + detail : ""}`); };
const ALL_OUT = []; // every result produced below, scanned for planted markers at the end
const run = (ev, pol = {}) => { const r = evaluateMergeGate(ev, pol); ALL_OUT.push(JSON.stringify(r)); return r; };

const HEAD = "a".repeat(40), BASE = "b".repeat(40), OLD = "c".repeat(40), OTHER = "d".repeat(40), MOVED_BASE = "e".repeat(40);
const [UBU, WIN] = REQUIRED_CONTEXTS;
const MK = "ZQX-MARKER-"; // planted in every untrusted text field
const bind = (o = {}) => `VERDICT-BINDING: verdict=${o.verdict ?? "CLEAN"} head=${o.head ?? HEAD} base=${o.base ?? BASE} reviewer-session=${o.session ?? "session_rev1"}`;
const review = (o = {}) => ({id: o.id ?? 100, user: {login: o.login ?? "owner1"}, state: o.state ?? "COMMENTED", commit_id: o.commit ?? HEAD,
  body: o.body ?? `${MK}body review notes\n${bind(o)}\n${MK}tail`, submitted_at: o.at ?? "2026-10-19T10:00:00Z"});
const run_ = (name, o = {}) => ({name, status: "completed", conclusion: "success", head_sha: HEAD, app_slug: "github-actions", completed_at: "2026-10-19T09:00:00Z",
  workflowPath: ".github/workflows/ci.yml", workflowRunEvent: "pull_request", ...o});
// Embedded fixture (shape of config/protected-paths.json), so the proof does not depend on the checkout. It omits CLAUDE.md/AGENTS.md
// and .github/workflows/ on purpose: those must still be caught by the gate's built-in floor.
const PROTECTED_FIXTURE = {exactPaths: ["config/protected-paths.json", "tsconfig.json", "REVIEWER-RULES.md"], protectedPrefixes: ["automation/lib/", "scripts/validate-", "config/", "prompts/"]};
const F = (filename, status = "modified", previous_filename) => ({filename, status, ...(previous_filename !== undefined ? {previous_filename} : {})});
const RULES = () => [{type: "deletion"}, {type: "non_fast_forward"}, {type: "pull_request", parameters: {required_approving_review_count: 0}},
  {type: "required_status_checks", parameters: {required_status_checks: [{context: UBU}, {context: WIN}], strict_required_status_checks_policy: true}}];
const GOOD = () => ({
  pr: {number: 42, state: "open", draft: false, merged: false, head: {sha: HEAD, ref: `claude/${MK}ref`}, base: {ref: "v7/integration", sha: BASE}, user: {login: "owner1"}, title: `${MK}title`, changed_files: 3},
  currentBaseSha: BASE,
  checkRuns: [run_(UBU), run_(WIN), {name: `${MK}other-check`, status: "completed", conclusion: "failure", head_sha: HEAD, app_slug: "github-actions", completed_at: "2026-10-19T09:00:00Z"}],
  reviews: [review()],
  issueComments: [{body: `${MK}comment`, user: {login: "owner1"}}],
  // docs/planning/merge-gate.mjs itself is high risk now (self-protection), so the routine fixture uses another planning file.
  diffFiles: [F("docs/planning/notes-helper.mjs", "added"), F("docs/planning/MERGE_GATE.md", "modified"), F("docs/planning/old-note.md", "renamed", "docs/planning/older-note.md")],
  protectedPaths: structuredClone(PROTECTED_FIXTURE),
  rules: RULES(),
});
const blocks = (ev, code, pol, name) => {
  const r = run(ev, pol);
  check(`${name} -> BLOCK ${code}`, r.decision === "BLOCK" && r.reasons.includes(code), JSON.stringify(r));
};
const mut = f => { const e = GOOD(); f(e); return e; };

console.log(`node ${process.version}`);
// Positive cases.
{
  const r = run(GOOD());
  check("P1 all conditions hold (process mode, same account) -> MERGE, PROCESS_ONLY_SAME_ACCOUNT, expected SHAs bound",
    r.decision === "MERGE" && r.reasons.length === 0 && r.identityIndependence === "SAME_ACCOUNT" && r.trust === "PROCESS_ONLY_SAME_ACCOUNT" && r.mode === "process" && r.expectedHeadSha === HEAD && r.expectedBaseSha === BASE, JSON.stringify(r));
  const s = run(mut(e => { e.reviews = [review({login: "Reviewer-Bot"})]; e.rules[2].parameters.required_approving_review_count = 1; }), {mode: "strict", trustedReviewerLogins: ["reviewer-bot"]});
  check("P2 strict mode, distinct trusted reviewer account, approving-review rule -> MERGE, DISTINCT_ACCOUNT", s.decision === "MERGE" && s.identityIndependence === "DISTINCT_ACCOUNT" && s.trust === "DISTINCT_TRUSTED_ACCOUNT" && s.mode === "strict", JSON.stringify(s));
  const rr = run(mut(e => { e.checkRuns.unshift(run_(WIN, {conclusion: "failure", completed_at: "2026-10-19T08:00:00Z"})); }));
  const sp = run(mut(e => { e.checkRuns.push(run_(UBU, {conclusion: "failure", workflowPath: ".github/workflows/other.yml"})); }));
  check("P5 a failing same-named run from another workflow is ignored (provenance filter) -> MERGE", sp.decision === "MERGE", JSON.stringify(sp));
  const cr = run(mut(e => { e.reviews = [{id: 1, user: {login: "owner1"}, state: "CHANGES_REQUESTED", commit_id: HEAD, body: "", submitted_at: "2026-10-19T09:00:00Z"}, review({id: 2})]; }));
  check("P6 earlier CHANGES_REQUESTED by the same account that later posted CLEAN -> MERGE", cr.decision === "MERGE", JSON.stringify(cr));
  check("P3 an older failed run re-run green on the same head -> MERGE (latest completed run decides)", rr.decision === "MERGE", JSON.stringify(rr));
  const bl = run(mut(e => { e.reviews = [review({verdict: "BLOCKED", at: "2026-10-19T09:30:00Z", id: 1}), review({id: 2})]; }));
  check("P4 BLOCKED then a later CLEAN from the same reviewer-session on the same head -> MERGE", bl.decision === "MERGE", JSON.stringify(bl));
}
// a. PR state.
blocks(mut(e => { e.pr.draft = true; }), "PR_DRAFT", {}, "N1 draft PR");
blocks(mut(e => { e.pr.merged = true; }), "PR_ALREADY_MERGED", {}, "N2 merged PR");
blocks(mut(e => { e.pr.state = "closed"; }), "PR_NOT_OPEN", {}, "N3 closed PR");
blocks(mut(e => { e.pr.base.ref = "main"; }), "BASE_REF_MISMATCH", {}, "N4 PR targets another base ref");
// b. SHAs.
blocks(mut(e => { e.pr.head.sha = OTHER; }), "VERDICT_MISSING", {}, "N5 head moved after review + CI (verdict void)");
blocks(mut(e => { e.pr.head.sha = OTHER; }), `CHECK_MISSING:${UBU}`, {}, "N6 head moved after review + CI (CI void)");
blocks(mut(e => { e.currentBaseSha = MOVED_BASE; }), "BASE_DRIFT", {}, "N7 base drift");
blocks(mut(e => { e.pr.head.sha = HEAD.toUpperCase(); }), "EVIDENCE_MALFORMED:pr.head.sha", {}, "N8 upper-case head sha");
blocks(mut(e => { e.currentBaseSha = "b".repeat(39); }), "EVIDENCE_MALFORMED:currentBaseSha", {}, "N9 short base sha");
// c. CI.
blocks(mut(e => { e.checkRuns = e.checkRuns.filter(c => c.name !== UBU); }), `CHECK_MISSING:${UBU}`, {}, "N10 ubuntu missing");
blocks(mut(e => { e.checkRuns[0] = run_(UBU, {status: "in_progress", conclusion: null}); }), `CHECK_PENDING:${UBU}`, {}, "N11 ubuntu pending");
blocks(mut(e => { e.checkRuns[0] = run_(UBU, {conclusion: "failure"}); }), `CHECK_FAILED:${UBU}`, {}, "N12 ubuntu failed");
blocks(mut(e => { e.checkRuns = e.checkRuns.filter(c => c.name !== WIN); }), `CHECK_MISSING:${WIN}`, {}, "N13 windows missing");
blocks(mut(e => { e.checkRuns[1] = run_(WIN, {status: "queued", conclusion: null}); }), `CHECK_PENDING:${WIN}`, {}, "N14 windows pending");
blocks(mut(e => { e.checkRuns[1] = run_(WIN, {conclusion: "cancelled"}); }), `CHECK_FAILED:${WIN}`, {}, "N15 windows cancelled");
blocks(mut(e => { e.checkRuns.push(run_(WIN, {status: "in_progress", conclusion: null})); }), `CHECK_PENDING:${WIN}`, {}, "N16 windows green + a re-run still pending");
blocks(mut(e => { e.checkRuns.push(run_(WIN, {conclusion: "failure", completed_at: "2026-10-19T09:30:00Z"})); }), `CHECK_FAILED:${WIN}`, {}, "N17 windows green then a later failed run");
blocks(mut(e => { e.checkRuns[1] = run_(WIN, {head_sha: OLD}); }), `CHECK_ON_OTHER_SHA:${WIN}`, {}, "N18 windows success only on another sha");
blocks(mut(e => { e.checkRuns[0] = run_(UBU, {app_slug: "some-other-app"}); }), `CHECK_FROM_OTHER_APP:${UBU}`, {}, "N19 ubuntu success only from another app");
blocks(mut(e => { e.checkRuns[0] = run_(UBU, {completed_at: "not-a-date"}); }), `CHECK_MALFORMED:${UBU}`, {}, "N20 ubuntu completed_at malformed");
blocks(mut(e => { e.checkRuns.push(run_(UBU, {conclusion: "failure"})); }), `CHECK_FAILED:${UBU}`, {}, "N21 ubuntu success + failure at the same completed_at (tie fail-closed)");
// d. Verdict.
blocks(mut(e => { e.reviews = []; e.issueComments = [{body: bind(), user: {login: "owner1"}, commit_id: HEAD}]; }), "VERDICT_MISSING", {}, "N22 verdict only as an issue comment");
blocks(mut(e => { e.reviews = []; e.issueComments = [{body: `UASCO-LOOP-RECORD task=CP-X result CLEAN head=${HEAD}\n${bind()}`, user: {login: "owner1"}}]; }), "VERDICT_MISSING", {}, "N23 UASCO-LOOP-RECORD ... result CLEAN comment");
blocks(mut(e => { e.reviews = [review({body: `UASCO-LOOP-RECORD task=CP-X result CLEAN head=${HEAD}`})]; }), "VERDICT_MISSING", {}, "N24 UASCO-LOOP-RECORD text in a review without a binding line");
blocks(mut(e => { e.reviews = [review({commit: OLD, head: OLD})]; }), "VERDICT_ONLY_ON_OTHER_COMMIT", {}, "N25 CLEAN verdict on an older commit");
blocks(mut(e => { e.reviews = [review({base: OTHER})]; }), "VERDICT_BASE_MISMATCH", {}, "N26 verdict binds a different base");
blocks(mut(e => { e.reviews = [review({head: OTHER})]; }), "VERDICT_HEAD_MISMATCH", {}, "N27 verdict head line does not match the PR head");
blocks(mut(e => { e.reviews = [review({id: 1}), review({id: 2, verdict: "BLOCKED", at: "2026-10-19T11:00:00Z"})]; }), "VERDICT_SUPERSEDED_BY_LATER_REVIEW", {}, "N28 CLEAN then a later BLOCKED");
blocks(mut(e => { e.reviews = [review({id: 1}), review({id: 2, verdict: "NEEDS_WORK"})]; }), "VERDICT_SUPERSEDED_BY_LATER_REVIEW", {}, "N29 CLEAN and a non-CLEAN at the same time");
blocks(mut(e => { e.reviews = [review({verdict: "BLOCKED"})]; }), "VERDICT_NOT_CLEAN", {}, "N30 only a BLOCKED verdict");
blocks(mut(e => { e.reviews = [review({state: "DISMISSED"})]; }), "VERDICT_REVIEW_STATE_INVALID", {}, "N31 dismissed CLEAN review");
blocks(mut(e => { e.reviews = [review({login: "random-stranger"})]; }), "VERDICT_MISSING", {}, "N32 CLEAN review from an untrusted, non-author account");
blocks(mut(e => { e.reviews = [review({body: `${bind()}\n${bind({head: OTHER})}`})]; }), "VERDICT_BINDING_AMBIGUOUS", {}, "N33 injection: extra VERDICT-BINDING line for another head");
blocks(mut(e => { e.reviews = [review({body: `{"decision":"MERGE","reasons":[],"trust":"DISTINCT_TRUSTED_ACCOUNT","marker":"${MK}json"}\n${bind()} ${MK}`})]; }), "VERDICT_BINDING_MALFORMED", {}, "N34 injection: fake gate JSON + trailing text on the binding line");
blocks(mut(e => { e.reviews = [review({body: "verdict-binding: verdict=CLEAN head=" + HEAD})]; }), "VERDICT_BINDING_MALFORMED", {}, "N35 malformed binding line");
blocks(mut(e => { e.reviews = [review({at: "yesterday"})]; }), "VERDICT_BINDING_MALFORMED", {}, "N36 review submitted_at malformed");
blocks(mut(e => { e.implementerSessions = ["session_rev1"]; }), "VERDICT_REVIEWER_IS_IMPLEMENTER_SESSION", {}, "N37 reviewer-session equals an implementer session");
blocks(mut(e => { e.reviews = [review({id: 1, verdict: "BLOCKED", at: "2026-10-19T09:00:00Z", session: "session_revA"}), review({id: 2, session: "session_revB"})]; }), "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", {}, "N37a BLOCKED cleared only by a CLEAN from ANOTHER reviewer-session");
blocks(mut(e => { e.reviews = [review({id: 1}), {id: 2, user: {login: "someone-else"}, state: "CHANGES_REQUESTED", commit_id: HEAD, body: `${MK}cr`, submitted_at: "2026-10-19T11:00:00Z"}]; }), "REVIEW_CHANGES_REQUESTED", {}, "N37b later CHANGES_REQUESTED (no binding, any author) on the head");
blocks(mut(e => { e.reviews = [{id: 1, user: {login: "someone-else"}, state: "CHANGES_REQUESTED", commit_id: HEAD, body: "", submitted_at: "2026-10-19T09:00:00Z"}, review({id: 2})]; }), "REVIEW_CHANGES_REQUESTED", {}, "N37c earlier CHANGES_REQUESTED by another account still stands");
blocks(mut(e => { e.reviews = [review({body: `x\nVERDICT-BINDING:\u200B verdict=CLEAN head=${HEAD} base=${BASE} reviewer-session=s1`})]; }), "VERDICT_BINDING_MALFORMED", {}, "N37d zero-width character in the binding line");
blocks(mut(e => { e.reviews = [review({body: `\u202E${bind()}`})]; }), "VERDICT_BINDING_MALFORMED", {}, "N37e bidi override before the binding line");
blocks(mut(e => { e.reviews = [review({body: `> ${bind()}`})]; }), "VERDICT_MISSING", {}, "N37f quoted binding line does not count");
blocks(mut(e => { e.reviews = [review({body: `&gt; ${bind()}`})]; }), "VERDICT_MISSING", {}, "N37g html-escaped quoted binding line does not count");
blocks(mut(e => { e.reviews = [review({body: "```\n" + bind() + "\n```"})]; }), "VERDICT_MISSING", {}, "N37h binding line inside a code fence does not count");
blocks(mut(e => { e.reviews = [review({body: `  ${bind()}`})]; }), "VERDICT_BINDING_MALFORMED", {}, "N37i indented binding line (must start at column 0)");
blocks(mut(e => { e.reviews = [review({body: `${bind()}\n${bind()}`})]; }), "VERDICT_BINDING_AMBIGUOUS", {}, "N37j two identical binding lines in one review");
blocks(mut(e => { e.checkRuns[0] = run_(UBU, {workflowPath: ".github/workflows/other.yml"}); }), `CHECK_PROVENANCE_MISMATCH:${UBU}`, {}, "N37k spoofed ubuntu context from .github/workflows/other.yml");
blocks(mut(e => { e.checkRuns[1] = run_(WIN, {workflowRunEvent: "pull_request_target"}); }), `CHECK_PROVENANCE_MISMATCH:${WIN}`, {}, "N37l windows context from an unexpected event");
const CR = (o = {}) => ({id: 9, user: {login: "someone-else"}, state: "CHANGES_REQUESTED", commit_id: HEAD, body: "", submitted_at: "2026-10-19T11:00:00Z", ...o});
const RA = "reviewer-a", RB = "reviewer-b";
blocks(mut(e => { e.rules[2].parameters.required_approving_review_count = 1; e.reviews = [review({id: 1, login: RA, verdict: "BLOCKED", at: "2026-10-19T09:00:00Z", session: "sA"}), review({id: 2, login: RB, session: "sA"})]; }),
  "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", {mode: "strict", trustedReviewerLogins: [RA, RB]}, "N37m B2 strict: reviewer-a BLOCKED (sA), reviewer-b CLEAN quoting sA");
blocks(mut(e => { e.reviews = [review({id: 1, login: RA, verdict: "BLOCKED", at: "2026-10-19T09:00:00Z", session: "sA"}), review({id: 2, login: "owner1", session: "sA"})]; }),
  "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", {trustedReviewerLogins: [RA]}, "N37n B2 process: trusted reviewer BLOCKED (sA), PR author CLEAN quoting sA");
blocks(mut(e => { e.reviews = [review({id: 1, login: RA, verdict: "BLOCKED", at: "2026-10-19T09:00:00Z", session: "sA"}), review({id: 2, login: RA, session: "sB"})]; }),
  "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", {trustedReviewerLogins: [RA]}, "N37o B2 same login, different session");
blocks(mut(e => { e.reviews = [review({id: 1}), CR({user: null})]; }), "REVIEW_CHANGES_REQUESTED", {}, "N37p CHANGES_REQUESTED from a deleted/ghost account (user null)");
blocks(mut(e => { e.reviews = [review({body: "```\n\u00AD" + bind() + "\n```\n" + bind()})]; }), "VERDICT_BINDING_MALFORMED", {}, "N37q soft hyphen in a FENCED binding line still MALFORMED");
blocks(mut(e => { e.reviews = [review({body: "> \u2066" + bind() + "\n" + bind()})]; }), "VERDICT_BINDING_MALFORMED", {}, "N37r U+2066 isolate in a QUOTED binding line still MALFORMED");
for (const [nm, ch] of [["U+034F", "\u034F"], ["U+180E", "\u180E"], ["U+2069", "\u2069"]])
  blocks(mut(e => { e.reviews = [review({body: bind().replace("CLEAN", "CLEAN" + ch)})]; }), "VERDICT_BINDING_MALFORMED", {}, `N37s invisible ${nm} inside the binding line`);
blocks(mut(e => { e.pr.changed_files = 4; }), "DIFF_INCOMPLETE", {}, "N37t diffFiles shorter than pr.changed_files (truncated/paginated list)");
blocks(mut(e => { e.pr.changed_files = 3001; e.diffFiles = Array.from({length: 3001}, (_, i) => F(`docs/f${i}.md`)); }), "DIFF_INCOMPLETE", {}, "N37u more files than the PR files API can list");
// B3: a malformed/ambiguous BLOCKED from reviewer A is never lifted by ANOTHER login's CLEAN.
{
  const A = "reviewer-a", P = {trustedReviewerLogins: [A]};
  const blockedA = body => review({id: 1, login: A, at: "2026-10-19T09:00:00Z", session: "sA", body});
  blocks(mut(e => { e.reviews = [blockedA(`${bind({verdict: "BLOCKED", session: "sA"})}\nsee the verdict-binding rules`), review({id: 2})]; }), "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", P, "N37v B3 AMBIGUOUS BLOCKED (binding + prose) from A, CLEAN from the PR author");
  blocks(mut(e => { e.reviews = [blockedA(`${bind({verdict: "BLOCKED", session: "sA"})} `), review({id: 2})]; }), "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", P, "N37w B3 MALFORMED BLOCKED (trailing space) from A, CLEAN from the PR author");
  blocks(mut(e => { e.reviews = [blockedA(`${bind({verdict: "BLOCKED", session: "sA"})}\u061C`), review({id: 2})]; }), "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", P, "N37x B3 MALFORMED BLOCKED (U+061C) from A, CLEAN from the PR author");
  blocks(mut(e => { e.rules[2].parameters.required_approving_review_count = 1; e.reviews = [blockedA(`${bind({verdict: "BLOCKED", session: "sA"})} `), review({id: 2, login: "reviewer-b", session: "sA"})]; }),
    "VERDICT_NOT_CLEAN_NOT_CLEARED_BY_SAME_REVIEWER", {mode: "strict", trustedReviewerLogins: [A, "reviewer-b"]}, "N37y B3 strict: MALFORMED BLOCKED from A, CLEAN from trusted reviewer-b");
  const ok = run(mut(e => { e.reviews = [blockedA(`${bind({verdict: "BLOCKED", session: "sA"})} `), review({id: 2, login: A, session: "sB"})]; }), P);
  check("P7 B3 MALFORMED BLOCKED from A (session unparseable), later well-formed CLEAN from the SAME login A -> MERGE", ok.decision === "MERGE", JSON.stringify(ok));
}
// B4: duplicate diffFiles cannot pad the completeness count.
blocks(mut(e => { e.pr.changed_files = 3; e.diffFiles = [F("docs/x.md"), F("docs/x.md"), F("docs/y.md")]; }), "DIFF_INCOMPLETE", {}, "N37z B4 the same file listed twice (count matches, a file is hidden)");
blocks(mut(e => { e.pr.changed_files = 3; e.diffFiles = [F("docs/X.md"), F("docs\\x.md"), F("docs/y.md")]; }), "DIFF_INCOMPLETE", {}, "N37za B4 duplicate after normalisation (case, backslash)");
blocks(mut(e => { e.pr.changed_files = 3; e.diffFiles = [F("docs/a.md", "renamed", "docs/old.md"), F("docs/b.md", "renamed", "docs/old.md"), F("docs/y.md")]; }), "DIFF_INCOMPLETE", {}, "N37zb B4 duplicate previous_filename");
{
  const rr = run(mut(e => { e.pr.changed_files = 2; e.diffFiles = [F("docs/new.md", "renamed", "docs/a.md"), F("docs/a.md", "added")]; }));
  check("P8 rename a->new plus a re-added a (filename equals another entry's previous_filename) -> MERGE", rr.decision === "MERGE", JSON.stringify(rr));
}
// Nit 3: fences of different characters or shorter runs do not close each other.
check("F1 ~~~ does not close a ``` fence: a binding inside stays ignored", parseBinding("```\n~~~\n" + bind() + "\n```") === null);
check("F2 a shorter ``` run does not close a ```` fence", parseBinding("````\n```\n" + bind() + "\n````") === null);
check("F3 a ``` fence closed by ``` makes the following binding count", parseBinding("```\nx\n```\n" + bind())?.verdict === "CLEAN");
// Nit 1: the Unicode property class covers the whole earlier hand list.
{
  const old = [0x00AD, 0x034F, 0x180E, 0xFEFF];
  for (const [a, b] of [[0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2064], [0x2066, 0x2069]]) for (let c = a; c <= b; c++) old.push(c);
  const missed = old.filter(c => !INVISIBLE_RE.test(String.fromCodePoint(c)));
  check(`I1 INVISIBLE_RE covers all ${old.length} code points of the earlier hand list (+ U+061C)`, missed.length === 0 && INVISIBLE_RE.test("\u061C"), missed.map(c => c.toString(16)).join(","));
}
// e. Protected paths.
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("CLAUDE.md")); }), "PROTECTED_PATH", {}, "N38 protected exact path in diff");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("Config/Validation.JSON")); }), "PROTECTED_PATH", {}, "N39 protected path, mixed case");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("automation\\lib\\redaction.mjs")); }), "PROTECTED_PATH", {}, "N40 protected path, backslashes");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("docs/../.GITHUB/workflows/x.yml", "added")); }), "PROTECTED_PATH", {}, "N41 protected path via ../ and case");
blocks(mut(e => { e.protectedPaths = {exactPaths: ["x"], protectedPrefixes: ["y/"]}; e.pr.changed_files++; e.diffFiles.push(F("scripts/validate-foo.mjs", "added")); }), "PROTECTED_PATH", {}, "N42 truncated protectedPaths still hits the built-in floor");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("docs/claude-notes.md", "renamed", "CLAUDE.md")); }), "PROTECTED_PATH", {}, "N42a B1 rename FROM protected CLAUDE.md to docs/");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("docs/ci-copy.yml", "renamed", ".github/workflows/ci.yml")); }), "PROTECTED_PATH", {}, "N42b B1 rename FROM .github/workflows/ci.yml");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("config/validation.json", "renamed", "docs/harmless.json")); }), "PROTECTED_PATH", {}, "N42c B1 rename TO a protected path");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("AGENTS.md", "removed")); }), "PROTECTED_PATH", {}, "N42d B1 removed protected file (floor exact)");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("docs/redaction-copy.mjs", "copied", "automation/lib/redaction.mjs")); }), "PROTECTED_PATH", {}, "N42e B1 copied from a protected path");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F(".github/workflows/other.yml", "added")); }), "PROTECTED_PATH", {}, "N42f new workflow file (floor prefix)");
for (const [file, cat] of [["scripts/ensure-dependencies.mjs", "ensure-dependencies"], ["package.json", "npm-manifest"], ["package-lock.json", "npm-lockfile"], ["scripts/ci/ci-evidence.mjs", "ci-scripts"],
  ["npm-shrinkwrap.json", "npm-shrinkwrap"], [".npmrc", "npmrc"], ["scripts/secret-sanity.mjs", "secret-sanity"], ["scripts/bootstrap-kernel-selftest.mjs", "bootstrap-kernel-selftest"]]) {
  const code = `CI_EXECUTED_PATH:${cat}`;
  blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F(file.toUpperCase().replace(/\//g, "\\"))); }), code, {}, `N42g modified ${file} (upper case, backslashes)`);
  blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F(file, "renamed", "docs/staged-file.txt")); }), code, {}, `N42h rename INTO ${file}`);
  blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F(file, "added")); }), code, {}, `N42k added ${file}`);
  blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F(file, "removed")); }), code, {}, `N42l removed ${file}`);
  blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("docs/moved-away.txt", "renamed", file)); }), code, {}, `N42i rename OUT OF ${file}`);
}
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("scripts/ci/new-helper.mjs", "added")); }), "CI_EXECUTED_PATH:ci-scripts", {}, "N42j new file under scripts/ci/");
// e3. Risk tiers (COORD-TRANSITION-AUTONOMY): the gate and its classifier are high risk whatever protectedPaths says; a removed test file is high risk;
// a pre-authorized protected change passes only with SHA-bound contents that match its class.
{
  const g = run(GOOD());
  check("R0 a routine PR reports riskTier ROUTINE with fixed class codes only", g.decision === "MERGE" && g.riskTier === "ROUTINE" && JSON.stringify(g.riskClasses) === JSON.stringify(["ROUTINE"]), JSON.stringify(g));
}
for (const file of ["docs/planning/merge-gate.mjs", "docs/planning/merge-risk.mjs", "docs/planning/merge-risk.d.mts", "docs/planning/pr-controller.mjs", "docs/planning/merge-gate.proof.mjs",
  "docs/planning/dispatch.proof.mjs", "core/authority/autonomous-authority.mjs", "core/authority/protected-change-grammar.mjs", "tests/review-governance.test.ts", "tests/support/merge-risk.cases.ts",
  "tests/support/pr-controller.cases.ts", "tests/support/autonomous-authority.cases.ts", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "scripts/generate-trust-root.mjs",
  "scripts/verify-trust-root.mjs", "core/sandbox/x.ts", "core/agents/linux-unshare-sandbox.ts", "core/workos/execution-gate.ts", "apps/desktop/preload.mjs", "apps/desktop/renderer/index.html",
  "apps/desktop/renderer/app.js", ".github/CODEOWNERS"]) {
  const r = run(mut(e => { e.protectedPaths = {exactPaths: ["x"], protectedPrefixes: ["y/"]}; e.pr.changed_files++; e.diffFiles.push(F(file)); }));
  check(`N53 high-risk path ${file} (not in protectedPaths) -> BLOCK HIGH_RISK_PATH, riskTier FOUNDER`, r.decision === "BLOCK" && r.reasons.includes("HIGH_RISK_PATH") && r.riskTier === "FOUNDER", JSON.stringify(r));
}
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("tests/v7-b5-work-screens.test.ts", "removed")); }), "HIGH_RISK_PATH", {}, "N54 a removed test file (test removal)");
blocks(mut(e => { e.pr.changed_files++; e.diffFiles.push(F("tests/renamed-away.md", "renamed", "tests/v7-b1-workos.test.ts")); }), "HIGH_RISK_PATH", {}, "N54b a test file renamed away");
{
  const SRV = "apps/control-api/src/server.ts";
  const base = ['import {registerFlowRoutes} from "./routes/flow.js";', "const laneDeps={getStore,scope};", "registerFlowRoutes(app,laneDeps);", ""].join("\n");
  const head = ['import {registerFlowRoutes} from "./routes/flow.js";', 'import {registerReadinessRoutes} from "./routes/readiness.js";', "const laneDeps={getStore,scope};",
    "registerFlowRoutes(app,laneDeps);", "registerReadinessRoutes(app,laneDeps);", ""].join("\n");
  // server.ts is protected in the real config/protected-paths.json; the embedded fixture lists it for these cases.
  const prot = e => { e.protectedPaths.exactPaths.push(SRV); };
  const withSrv = (contents) => mut(e => { prot(e); e.pr.changed_files++; e.diffFiles.push(F(SRV)); if (contents) e.fileContents = contents; });
  const names = run(withSrv(null));
  check("R1 protected server.ts with names only (no contents) -> BLOCK PROTECTED_PATH, riskTier FOUNDER (fail-closed)", names.decision === "BLOCK" && names.reasons.includes("PROTECTED_PATH")
    && names.riskTier === "FOUNDER" && names.riskClasses.includes("PROTECTED_CONTENT_MISSING"), JSON.stringify(names));
  const ok = run(withSrv({[SRV]: {base, head}}));
  check("R2 server.ts route-registration append with SHA-bound contents -> MERGE, riskTier PREAUTHORIZED", ok.decision === "MERGE" && ok.riskTier === "PREAUTHORIZED"
    && ok.riskClasses.includes("ROUTE_REGISTRATION_APPEND") && !ok.reasons.length, JSON.stringify(ok));
  const bad = run(withSrv({[SRV]: {base, head: head.replace("registerReadinessRoutes(app,laneDeps);", "registerReadinessRoutes(app,{...laneDeps,x:()=>process.exit(1)});")}}));
  check("R3 server.ts change outside the class grammar (deny token) -> BLOCK PROTECTED_PATH", bad.decision === "BLOCK" && bad.reasons.includes("PROTECTED_PATH") && bad.riskClasses.includes("PROTECTED_CLASS_MISMATCH"), JSON.stringify(bad));
  const other = run(withSrv({"Apps/Control-Api/src/server.ts": {base, head}}));
  check("R4 contents keyed by another spelling of the path do not count -> BLOCK", other.decision === "BLOCK" && other.reasons.includes("PROTECTED_PATH"), JSON.stringify(other));
  const half = run(withSrv({[SRV]: {base, head: null}}));
  check("R5 one side of the contents missing -> BLOCK (fail-closed)", half.decision === "BLOCK" && half.riskClasses.includes("PROTECTED_CONTENT_MISSING"), JSON.stringify(half));
  const renamed = run(mut(e => { prot(e); e.pr.changed_files++; e.diffFiles.push(F(SRV, "renamed", "apps/control-api/src/old.ts")); e.fileContents = {[SRV]: {base, head}}; }));
  check("R6 a pre-authorized target that is renamed (not modified in place) -> BLOCK", renamed.decision === "BLOCK" && renamed.reasons.includes("PROTECTED_PATH"), JSON.stringify(renamed));
  const mixed = run(mut(e => { prot(e); e.pr.changed_files += 2; e.diffFiles.push(F(SRV), F("package.json")); e.fileContents = {[SRV]: {base, head}}; }));
  check("R7 pre-authorized change plus a dependency change -> BLOCK CI_EXECUTED_PATH:npm-manifest only (the pre-authorized file adds nothing)", mixed.decision === "BLOCK"
    && mixed.reasons.includes("CI_EXECUTED_PATH:npm-manifest") && !mixed.reasons.includes("PROTECTED_PATH") && mixed.riskTier === "FOUNDER", JSON.stringify(mixed));
}
// f. Ruleset.
for (const t of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"])
  blocks(mut(e => { e.rules = e.rules.filter(x => x.type !== t); }), `RULESET_MISSING:${t}`, {}, `N43 ruleset missing ${t}`);
blocks(mut(e => { e.rules[3].parameters.required_status_checks = [{context: UBU}]; }), `RULESET_MISSING:required_status_checks:${WIN}`, {}, "N44 ruleset missing the windows context");
// g. Identity.
blocks(GOOD(), "REVIEWER_NOT_INDEPENDENT_IDENTITY", {mode: "strict"}, "N45 strict + SAME_ACCOUNT");
blocks(mut(e => { e.reviews = [review({login: "reviewer-bot"})]; }), "REVIEWER_NOT_INDEPENDENT_IDENTITY", {mode: "strict"}, "N46 strict + distinct but untrusted reviewer");
blocks(mut(e => { e.reviews = [review({login: "OWNER1"})]; }), "REVIEWER_NOT_INDEPENDENT_IDENTITY", {mode: "strict", trustedReviewerLogins: ["owner1"]}, "N47 strict + PR author listed as trusted (case-folded)");
blocks(mut(e => { e.reviews = [review({login: "reviewer-bot"})]; }), "RULESET_MISSING:required_approving_review_count", {mode: "strict", trustedReviewerLogins: ["reviewer-bot"]}, "N48 strict without an approving-review rule");
blocks(GOOD(), "POLICY_MALFORMED:mode", {mode: "lenient"}, "N49 unknown mode");
// Malformed / missing fields.
for (const [name, f, code] of [
  ["pr missing", e => { delete e.pr; }, "EVIDENCE_MALFORMED:pr"],
  ["pr.draft not boolean", e => { e.pr.draft = "false"; }, "EVIDENCE_MALFORMED:pr.draft"],
  ["pr.changed_files missing", e => { delete e.pr.changed_files; }, "EVIDENCE_MALFORMED:pr.changed_files"],
  ["review entry not an object", e => { e.reviews.push(null); }, "EVIDENCE_MALFORMED:reviews"],
  ["pr.user missing", e => { delete e.pr.user; }, "EVIDENCE_MALFORMED:pr.user.login"],
  ["checkRuns not an array", e => { e.checkRuns = {}; }, "EVIDENCE_MALFORMED:checkRuns"],
  ["reviews missing", e => { delete e.reviews; }, "EVIDENCE_MALFORMED:reviews"],
  ["diffFiles missing (old ownDiffFiles shape only)", e => { e.ownDiffFiles = ["docs/x.md"]; delete e.diffFiles; }, "EVIDENCE_MALFORMED:diffFiles"],
  ["diffFiles entry is a bare string", e => { e.pr.changed_files++; e.diffFiles.push("docs/x.md"); }, "EVIDENCE_MALFORMED:diffFiles"],
  ["diffFiles status unknown", e => { e.pr.changed_files++; e.diffFiles.push(F("docs/x.md", "moved")); }, "EVIDENCE_MALFORMED:diffFiles"],
  ["diffFiles status missing", e => { e.pr.changed_files++; e.diffFiles.push({filename: "docs/x.md"}); }, "EVIDENCE_MALFORMED:diffFiles"],
  ["renamed without previous_filename", e => { e.pr.changed_files++; e.diffFiles.push(F("docs/x.md", "renamed")); }, "EVIDENCE_MALFORMED:diffFiles"],
  ["check run without workflowPath", e => { delete e.checkRuns[0].workflowPath; }, `CHECK_MISSING:${UBU}`],
  ["protectedPaths empty", e => { e.protectedPaths = {exactPaths: [], protectedPrefixes: []}; }, "EVIDENCE_MALFORMED:protectedPaths"],
  ["rules missing", e => { delete e.rules; }, "EVIDENCE_MALFORMED:rules"],
]) blocks(mut(f), code, {}, `N50 malformed: ${name}`);
blocks(null, "EVIDENCE_MALFORMED:root", {}, "N51 evidence null");
{
  const trap = GOOD(); Object.defineProperty(trap, "reviews", {get() { throw new Error(`${MK}getter`); }});
  const r = run(trap);
  check("N52 throwing getter -> INTERNAL_ERROR (fail-closed), no message echoed", r.decision === "INTERNAL_ERROR" && r.reasons.join() === "INTERNAL_ERROR", JSON.stringify(r));
}
// verifyPostMerge.
{
  const M = "f".repeat(40);
  const ok = verifyPostMerge({mergeCommitSha: M, mergeCommitParents: [BASE, HEAD], newBaseHead: M, expectedBaseSha: BASE, expectedHeadSha: HEAD});
  check("V1 post-merge parents [base, head] and new base head = merge commit -> VERIFIED", ok.decision === "VERIFIED", JSON.stringify(ok));
  const sw = verifyPostMerge({mergeCommitSha: M, mergeCommitParents: [HEAD, BASE], newBaseHead: M, expectedBaseSha: BASE, expectedHeadSha: HEAD});
  check("V2 swapped parents -> MERGE_PARENTS_MISMATCH", sw.reasons.includes("MERGE_PARENTS_MISMATCH"), JSON.stringify(sw));
  const sq = verifyPostMerge({mergeCommitSha: M, mergeCommitParents: [BASE], newBaseHead: M, expectedBaseSha: BASE, expectedHeadSha: HEAD});
  check("V3 squash-like single parent -> MERGE_PARENTS_MISMATCH", sq.reasons.includes("MERGE_PARENTS_MISMATCH"), JSON.stringify(sq));
  const mv = verifyPostMerge({mergeCommitSha: M, mergeCommitParents: [BASE, HEAD], newBaseHead: OTHER, expectedBaseSha: BASE, expectedHeadSha: HEAD});
  check("V4 base moved past the merge commit -> BASE_HEAD_NOT_MERGE_COMMIT", mv.reasons.includes("BASE_HEAD_NOT_MERGE_COMMIT"), JSON.stringify(mv));
  check("V1b an exact merge reports basis EXACT", ok.basis === "EXACT", JSON.stringify(ok));
  // GitHub auto-merge chain: another PR merged first, so the first parent is a descendant of the evaluated base, and later merges moved the base on.
  const pm = (o) => verifyPostMerge({mergeCommitSha: M, mergeCommitParents: [MOVED_BASE, HEAD], newBaseHead: M, expectedBaseSha: BASE, expectedHeadSha: HEAD, ...o});
  const chain = pm({baseIsAncestor: true});
  check("V5 auto-merge chain: first parent a proven descendant of the evaluated base -> VERIFIED, basis ANCESTRY_PROVEN", chain.decision === "VERIFIED" && chain.basis === "ANCESTRY_PROVEN", JSON.stringify(chain));
  check("V5b the same chain without the ancestry proof -> MERGE_PARENTS_MISMATCH", pm({}).reasons.includes("MERGE_PARENTS_MISMATCH") && pm({baseIsAncestor: false}).decision === "MISMATCH");
  const later = pm({baseIsAncestor: true, newBaseHead: OTHER, mergeOnFirstParent: true});
  check("V5c later merges moved the base on, merge commit proven on its first-parent chain -> VERIFIED", later.decision === "VERIFIED" && later.basis === "ANCESTRY_PROVEN", JSON.stringify(later));
  check("V5d base moved on without the first-parent proof -> BASE_HEAD_NOT_MERGE_COMMIT", pm({baseIsAncestor: true, newBaseHead: OTHER}).reasons.includes("BASE_HEAD_NOT_MERGE_COMMIT"));
  check("V5e proofs never excuse a wrong second parent or a swapped merge", pm({baseIsAncestor: true, mergeCommitParents: [MOVED_BASE, OTHER]}).reasons.includes("MERGE_PARENTS_MISMATCH")
    && pm({baseIsAncestor: true, mergeCommitParents: [HEAD, HEAD]}).reasons.includes("MERGE_PARENTS_MISMATCH") && pm({baseIsAncestor: true, mergeCommitParents: [MOVED_BASE]}).decision === "MISMATCH");
  check("V5f proof flags must be booleans (\"true\" is malformed)", pm({baseIsAncestor: "true"}).reasons.includes("EVIDENCE_MALFORMED:baseIsAncestor") && pm({baseIsAncestor: true, mergeOnFirstParent: 1}).reasons.includes("EVIDENCE_MALFORMED:mergeOnFirstParent"));
}
// CLI: one JSON line, exit codes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merge-gate-proof-"));
const cli = (args, ev) => {
  if (ev !== undefined) fs.writeFileSync(path.join(tmp, "ev.json"), typeof ev === "string" ? ev : JSON.stringify(ev));
  const r = spawnSync(process.execPath, [GATE, ...args], {encoding: "utf8"});
  ALL_OUT.push(r.stdout, r.stderr);
  let j = null; try { j = JSON.parse(r.stdout); } catch { /* null */ }
  return {code: r.status, j, lines: r.stdout.trim().split("\n").length, err: r.stderr};
};
const EVF = path.join(tmp, "ev.json");
{
  const a = cli(["--evidence", EVF], GOOD());
  check("C1 CLI MERGE -> exit 0, exactly one JSON line", a.code === 0 && a.lines === 1 && a.j?.decision === "MERGE" && a.err === "", JSON.stringify(a));
  const b = cli(["--evidence", EVF, "--mode", "strict"], GOOD());
  check("C2 CLI strict + same account -> exit 2 BLOCK", b.code === 2 && b.j?.decision === "BLOCK" && b.j.reasons.includes("REVIEWER_NOT_INDEPENDENT_IDENTITY"), JSON.stringify(b));
  const c = cli(["--evidence", EVF], `{"pr": ${MK}`);
  check("C3 CLI unparseable evidence -> exit 2 EVIDENCE_UNPARSEABLE", c.code === 2 && c.j?.reasons?.[0] === "EVIDENCE_UNPARSEABLE", JSON.stringify(c));
  const d = cli(["--evidence", path.join(tmp, "nope.json")]);
  check("C4 CLI missing evidence file -> exit 2 EVIDENCE_UNREADABLE", d.code === 2 && d.j?.reasons?.[0] === "EVIDENCE_UNREADABLE", JSON.stringify(d));
  const e = cli(["--evidence", EVF, `--${MK}flag`, "x"]);
  check("C5 CLI unknown flag -> exit 2 ARG_INVALID", e.code === 2 && e.j?.reasons?.[0] === "ARG_INVALID", JSON.stringify(e));
  const f = cli(["--evidence", EVF, "--mode", `${MK}mode`]);
  check("C6 CLI bad --mode -> exit 2 ARG_INVALID:--mode, mode not echoed", f.code === 2 && f.j?.reasons?.[0] === "ARG_INVALID:--mode", JSON.stringify(f));
  fs.writeFileSync(path.join(tmp, "pm.json"), JSON.stringify({mergeCommitSha: "f".repeat(40), mergeCommitParents: [BASE, HEAD], newBaseHead: "f".repeat(40), expectedBaseSha: BASE, expectedHeadSha: HEAD}));
  const g = cli(["--post-merge", path.join(tmp, "pm.json")]);
  check("C7 CLI --post-merge VERIFIED -> exit 0", g.code === 0 && g.j?.decision === "VERIFIED", JSON.stringify(g));
}
fs.rmSync(tmp, {recursive: true, force: true});
// No-echo: nothing from an untrusted field (bodies, titles, refs, comments, names, flags, thrown messages) reaches any output.
{
  const hits = ALL_OUT.filter(x => x && (x.includes(MK) || x.includes("random-stranger") || x.includes("owner1") || x.includes("reviewer-bot") || x.includes("session_rev1")));
  check(`no-echo scan: ${ALL_OUT.length} outputs carry no planted marker, login or session id`, hits.length === 0, hits.slice(0, 2).join(" ## "));
}
console.log(`MERGE_GATE_PROOF: ${failures === 0 ? "PASS" : "FAIL"} (${n - failures}/${n} checks)`);
process.exit(failures === 0 ? 0 : 1);
