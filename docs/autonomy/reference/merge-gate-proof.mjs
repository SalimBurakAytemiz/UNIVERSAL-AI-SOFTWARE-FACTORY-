//TR: scripts/merge-via-gate.mjs saf karar fonksiyonunun (evaluateMergeGate) fail-closed davranisinin yurutulebilir kaniti: her zorunlu kapi (CI context'leri head SHA'da success, governed verdict SHA+oturum+kimlik bagli CLEAN, strict/FF, conflict yok) ihlal edildiginde REFUSE, hepsi saglaninca MERGE. Ag/merge yapmaz; yalniz karar mantigini test eder. Run (Node 24): node docs/autonomy/reference/merge-gate-proof.mjs
import { evaluateMergeGate, resolveVerdict, REQUIRED_CONTEXTS } from "../../../scripts/merge-via-gate.mjs";
import { bindVerdict } from "../../../automation/lib/lease-verdict.mjs";

let passed = 0, failed = 0;
const ok = (c, label, got) => { if (c) { passed++; console.log(`PASS  ${label}`); } else { failed++; console.log(`FAIL  ${label}${got !== undefined ? `\n        got: ${JSON.stringify(got)}` : ""}`); } };
const HEAD = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"; // 40-hex
const greenChecks = REQUIRED_CONTEXTS.map((name) => ({ name, status: "completed", conclusion: "success" }));
const vbase = { taskId: "T", reviewedSha: HEAD, reviewerSessionId: "sess-rev", implementerSessionId: "sess-impl", result: "CLEAN", reviewerIdentity: "claude-reviewer", builderIdentity: "claude-builder" };
const expect = { expectedTaskId: "T", expectedHeadSha: HEAD, implementerSessionId: "sess-impl", builderIdentity: "claude-builder" };
const GOOD = () => ({ headSha: HEAD, checkRuns: greenChecks.map((c) => ({ ...c })), baseIsAncestorOfHead: true, hasConflict: false, verdict: bindVerdict(vbase), verdictExpectation: { ...expect }, baseFetched: true, expectedBaseBranch: "v7/integration", pr: { baseRefName: "v7/integration", headRefOid: HEAD } });
const refusedFor = (ev, needle) => { const r = evaluateMergeGate(ev); return r.decision === "REFUSE" && r.reasons.some((x) => x.includes(needle)); };

console.log("== merge-via-gate evaluateMergeGate — fail-closed decision");
// the one MERGE case: everything green
{ const r = evaluateMergeGate(GOOD()); ok(r.decision === "MERGE" && r.reasons.length === 0, "all gates satisfied -> MERGE", r); }

// CI gate
ok(refusedFor({ ...GOOD(), checkRuns: [{ name: REQUIRED_CONTEXTS[0], status: "in_progress", conclusion: null }, greenChecks[1]] }, "REQUIRED_CHECK_NOT_SUCCESS"), "a pending required check -> REFUSE");
ok(refusedFor({ ...GOOD(), checkRuns: [greenChecks[0]] }, "REQUIRED_CHECK_MISSING"), "a missing required check (windows) -> REFUSE");
ok(refusedFor({ ...GOOD(), checkRuns: greenChecks.map((c, i) => i === 1 ? { ...c, conclusion: "failure" } : c) }, "REQUIRED_CHECK_NOT_SUCCESS"), "a failed required check -> REFUSE");
ok(refusedFor({ ...GOOD(), checkRuns: greenChecks.map((c, i) => i === 1 ? { ...c, conclusion: "cancelled" } : c) }, "REQUIRED_CHECK_NOT_SUCCESS"), "a cancelled required check -> REFUSE");
ok(refusedFor({ ...GOOD(), checkRuns: [] }, "REQUIRED_CHECK_MISSING"), "no checks at all -> REFUSE (both missing)");
// (regression) a required context with MULTIPLE runs (repo emits push + pull_request per SHA): one success must NOT mask a sibling failure/pending
ok(refusedFor({ ...GOOD(), checkRuns: [...greenChecks.map((c) => ({ ...c })), { name: REQUIRED_CONTEXTS[0], status: "completed", conclusion: "failure" }] }, `REQUIRED_CHECK_NOT_SUCCESS:${REQUIRED_CONTEXTS[0]}`), "a required context with success+failure runs -> REFUSE (no fail-open via .some)");
ok(refusedFor({ ...GOOD(), checkRuns: [...greenChecks.map((c) => ({ ...c })), { name: REQUIRED_CONTEXTS[0], status: "in_progress", conclusion: null }] }, `REQUIRED_CHECK_NOT_SUCCESS:${REQUIRED_CONTEXTS[0]}`), "a required context with success+in_progress runs -> REFUSE (no fail-open via .some)");

// strict / fast-forward gate
ok(refusedFor({ ...GOOD(), baseIsAncestorOfHead: false }, "NOT_FAST_FORWARD_OR_BEHIND_BASE"), "head behind base (not FF) -> REFUSE");
ok(refusedFor({ ...GOOD(), baseIsAncestorOfHead: undefined }, "NOT_FAST_FORWARD_OR_BEHIND_BASE"), "unknown ancestry -> REFUSE (fail-closed)");

// conflict gate
ok(refusedFor({ ...GOOD(), hasConflict: true }, "MERGE_CONFLICT"), "merge conflict -> REFUSE");
ok(refusedFor({ ...GOOD(), hasConflict: undefined }, "CONFLICT_STATE_UNKNOWN"), "unknown conflict state -> REFUSE (fail-closed)");

// head sha gate
ok(refusedFor({ ...GOOD(), headSha: "not-a-sha" }, "NO_VALID_HEAD_SHA"), "invalid head SHA -> REFUSE");

// governed verdict gate (bound to head + independent + CLEAN)
ok(refusedFor({ ...GOOD(), verdict: null }, "GOVERNED_VERDICT_MISSING"), "missing governed verdict -> REFUSE");
ok(refusedFor({ ...GOOD(), verdict: bindVerdict({ ...vbase, reviewedSha: "b".repeat(40) }) }, "STALE_SHA"), "verdict reviewed a different SHA -> REFUSE STALE_SHA");
ok(refusedFor({ ...GOOD(), verdictExpectation: { ...expect, expectedHeadSha: "c".repeat(40) } }, "VERDICT_EXPECTATION_NOT_BOUND_TO_HEAD"), "expectation head != current head -> REFUSE");
ok(refusedFor({ ...GOOD(), verdict: bindVerdict({ ...vbase, reviewerSessionId: "sess-impl" }) }, "NOT_INDEPENDENT"), "reviewer session == implementer -> REFUSE NOT_INDEPENDENT");
ok(refusedFor({ ...GOOD(), verdict: bindVerdict({ ...vbase, reviewerIdentity: "claude-builder" }) }, "SAME_IDENTITY"), "reviewer identity == builder -> REFUSE SAME_IDENTITY");
ok(refusedFor({ ...GOOD(), verdict: bindVerdict({ ...vbase, taskId: "OTHER" }) }, "TASK_MISMATCH"), "verdict for another task -> REFUSE TASK_MISMATCH");
ok(refusedFor({ ...GOOD(), verdict: bindVerdict({ ...vbase, result: "BLOCKED" }) }, "NOT_CLEAN"), "non-CLEAN verdict -> REFUSE NOT_CLEAN");

// (B4a) verdict provenance: expectation derived from git (task + head commit trailer), never from the verdict file
const commitMessage = "feat: x\n\nClaude-Session: https://claude.ai/code/session_REAL1";
const derive = (record) => { const d = resolveVerdict(record, { task: "T", headSha: HEAD, commitMessage, authorName: "claude-builder" }); return evaluateMergeGate({ ...GOOD(), ...d }); };
const fabricated = { verdict: { ...vbase, reviewerSessionId: "made-up", implementerSessionId: "me", reviewerIdentity: "other", builderIdentity: "me" }, expectation: { expectedTaskId: "T", expectedHeadSha: HEAD, implementerSessionId: "me", builderIdentity: "me" } };
{ const r = derive(fabricated); ok(r.decision === "REFUSE" && r.reasons.some((x) => x.includes("GOVERNED_VERDICT_REJECTED")), "self-consistent fabricated verdict+expectation file -> REFUSE (file expectation ignored)", r); }
{ const r = derive({ verdict: { ...vbase, implementerSessionId: "session_REAL1", reviewerSessionId: "session_REV9" }, expectation: fabricated.expectation }); ok(r.decision === "MERGE", "review record matching git-derived implementer session, distinct reviewer, live head -> MERGE", r); }
{ const r = derive({ verdict: { ...vbase, taskId: "OTHER", implementerSessionId: "session_REAL1", reviewerSessionId: "session_REV9" } }); ok(r.decision === "REFUSE" && r.reasons.some((x) => x.includes("TASK_MISMATCH")), "verdict for a task other than the required --task -> REFUSE", r); }
{ const r = derive({ verdict: { ...vbase, reviewedSha: "b".repeat(40), implementerSessionId: "session_REAL1", reviewerSessionId: "session_REV9" } }); ok(r.decision === "REFUSE" && r.reasons.some((x) => x.includes("STALE_SHA")), "review record for a non-head SHA -> REFUSE", r); }
{ const r = derive({ verdict: { ...vbase, implementerSessionId: "session_REAL1", reviewerSessionId: "session_REAL1" } }); ok(r.decision === "REFUSE" && r.reasons.some((x) => x.includes("NOT_INDEPENDENT")), "reviewer session == git-read implementer session -> REFUSE", r); }
{ const d = resolveVerdict({ verdict: vbase }, { task: "T", headSha: HEAD, commitMessage: "no trailer", authorName: "claude-builder" }); const r = evaluateMergeGate({ ...GOOD(), ...d }); ok(r.decision === "REFUSE" && r.reasons.includes("VERDICT_EXPECTATION_MISSING"), "head commit without Claude-Session trailer -> REFUSE", r); }
{ const d = resolveVerdict({ verdict: vbase }, { task: undefined, headSha: HEAD, commitMessage, authorName: "claude-builder" }); const r = evaluateMergeGate({ ...GOOD(), ...d }); ok(r.decision === "REFUSE", "missing --task -> REFUSE", r); }

// (B4b) --apply binding: PR base + head + fetched base
ok(refusedFor({ ...GOOD(), pr: { baseRefName: "master", headRefOid: HEAD } }, "PR_BASE_MISMATCH"), "PR targets another base (master) -> REFUSE");
ok(refusedFor({ ...GOOD(), pr: { baseRefName: "v7/integration", headRefOid: "d".repeat(40) } }, "PR_HEAD_MISMATCH"), "PR live head != evaluated head -> REFUSE");
ok(refusedFor({ ...GOOD(), pr: null }, "PR_VIEW_MISSING"), "PR view unavailable -> REFUSE");
ok(refusedFor({ ...GOOD(), baseFetched: false }, "BASE_NOT_FETCHED"), "base fetch failed (stale base ref) -> REFUSE");

// accumulates multiple reasons, never silently passes
{ const r = evaluateMergeGate({ headSha: HEAD, checkRuns: [], baseIsAncestorOfHead: false, hasConflict: true, verdict: null, verdictExpectation: null }); ok(r.decision === "REFUSE" && r.reasons.length >= 4, "many simultaneous failures -> REFUSE with all reasons", r.reasons); }

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
