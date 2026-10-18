//TR: scripts/merge-via-gate.mjs saf karar fonksiyonunun (evaluateMergeGate) fail-closed davranisinin yurutulebilir kaniti: her zorunlu kapi (CI context'leri head SHA'da success, governed verdict SHA+oturum+kimlik bagli CLEAN, strict/FF, conflict yok) ihlal edildiginde REFUSE, hepsi saglaninca MERGE. Ag/merge yapmaz; yalniz karar mantigini test eder. Run (Node 24): node docs/autonomy/reference/merge-gate-proof.mjs
import { evaluateMergeGate, REQUIRED_CONTEXTS } from "../../../scripts/merge-via-gate.mjs";
import { bindVerdict } from "../../../automation/lib/lease-verdict.mjs";

let passed = 0, failed = 0;
const ok = (c, label, got) => { if (c) { passed++; console.log(`PASS  ${label}`); } else { failed++; console.log(`FAIL  ${label}${got !== undefined ? `\n        got: ${JSON.stringify(got)}` : ""}`); } };
const HEAD = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"; // 40-hex
const greenChecks = REQUIRED_CONTEXTS.map((name) => ({ name, status: "completed", conclusion: "success" }));
const vbase = { taskId: "T", reviewedSha: HEAD, reviewerSessionId: "sess-rev", implementerSessionId: "sess-impl", result: "CLEAN", reviewerIdentity: "claude-reviewer", builderIdentity: "claude-builder" };
const expect = { expectedTaskId: "T", expectedHeadSha: HEAD, implementerSessionId: "sess-impl", builderIdentity: "claude-builder" };
const GOOD = () => ({ headSha: HEAD, checkRuns: greenChecks.map((c) => ({ ...c })), baseIsAncestorOfHead: true, hasConflict: false, verdict: bindVerdict(vbase), verdictExpectation: { ...expect } });
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

// accumulates multiple reasons, never silently passes
{ const r = evaluateMergeGate({ headSha: HEAD, checkRuns: [], baseIsAncestorOfHead: false, hasConflict: true, verdict: null, verdictExpectation: null }); ok(r.decision === "REFUSE" && r.reasons.length >= 4, "many simultaneous failures -> REFUSE with all reasons", r.reasons); }

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
