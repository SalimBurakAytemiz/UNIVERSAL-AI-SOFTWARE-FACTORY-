//TR: CP-REPORT standalone proof for report.mjs
import fs from "node:fs";
import { buildReport, renderMarkdown, STATUSES } from "./report.mjs";

let passed = 0, failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  ok ? passed++ : failed++;
};

const full = {
  periodStart: "2026-01-01T00:00:00Z",
  periodEnd: "2026-01-01T01:00:00Z",
  prs: [
    { number: 1, title: "a", state: "open", createdAt: "2026-01-01T00:30:00Z", headSha: "x" },
    { number: 2, title: "b", state: "open", createdAt: "2026-01-01T00:59:00Z", headSha: "y" },
    { number: 3, title: "c", state: "open", createdAt: "2025-12-31T00:00:00Z", headSha: "z" },
  ],
  queue: { tasks: [
    { id: "T1", status: "DONE" },
    { id: "T2", status: "COMPLETED" },
    { id: "T3", status: "BLOCKED", blocker: "needs review" },
    { id: "T4", status: "BLOCKED" },
    { id: "T5", status: "IN_PROGRESS" },
  ] },
  runFacts: { activeImplementers: 2, failures: ["f1"] },
};
const r = buildReport(full);
check("full: newPrs === 2", r.newPrs === 2);
check("full: completedTasks === 2", r.completedTasks === 2);
check("full: bottlenecks length 2", r.bottlenecks.length === 2);
check("full: activeImplementers/failures pass through", r.activeImplementers === 2 && r.failures.length === 1);
check("full: no unknowns", r.unknowns.length === 0);
check("blocked task carries its blocker", r.bottlenecks.some((b) => b.id === "T3" && b.blocker === "needs review"));
check("blocked task without blocker -> unspecified", r.bottlenecks.some((b) => b.id === "T4" && b.blocker === "unspecified"));

const np = buildReport({ ...full, prs: undefined });
check("prs undefined -> newPrs UNKNOWN (not 0)", np.newPrs === "UNKNOWN" && np.newPrs !== 0);
check("prs undefined -> 'prs' in unknowns", np.unknowns.includes("prs"));

const nq = buildReport({ ...full, queue: undefined });
check("queue undefined -> completedTasks UNKNOWN", nq.completedTasks === "UNKNOWN");
check("queue undefined -> bottlenecks UNKNOWN", nq.bottlenecks === "UNKNOWN");
check("queue undefined -> 'queue' in unknowns", nq.unknowns.includes("queue"));

const nr = buildReport({ ...full, runFacts: undefined });
check("runFacts undefined -> activeImplementers UNKNOWN", nr.activeImplementers === "UNKNOWN");
check("runFacts undefined -> failures UNKNOWN", nr.failures === "UNKNOWN");

const bad = buildReport({ ...full, runFacts: { activeImplementers: NaN, failures: "x" } });
check("typed-wrong runFacts -> UNKNOWN", bad.activeImplementers === "UNKNOWN" && bad.failures === "UNKNOWN");

const empty = buildReport(undefined);
check("undefined input never yields confident 0", empty.newPrs === "UNKNOWN" && empty.completedTasks === "UNKNOWN" && empty.activeImplementers === "UNKNOWN");

check("deterministic", JSON.stringify(buildReport(full)) === JSON.stringify(buildReport(full)));
check("markdown renders 'UNKNOWN (not observed)'", renderMarkdown(np).includes("UNKNOWN (not observed)"));
check("markdown full has no UNKNOWN", !renderMarkdown(r).includes("UNKNOWN"));

const P = { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-01T01:00:00Z" };
const rep = (o) => buildReport({ ...full, ...o });
const g = rep({ prs: [{ createdAt: "garbage" }, {}] });
check("unparseable PR createdAt -> newPrs UNKNOWN + unknowns entry", g.newPrs === "UNKNOWN" && g.unknowns.includes("prs[].createdAt"));
const inv = rep({ periodStart: P.periodEnd, periodEnd: P.periodStart });
check("inverted period -> period+newPrs UNKNOWN", inv.newPrs === "UNKNOWN" && inv.unknowns.includes("period"));
const bt = rep({ prs: [{ number: 1, createdAt: P.periodStart }, { number: 2, createdAt: P.periodEnd }, { number: 3, createdAt: "2026-01-01T01:00:01Z" }] });
check("boundaries start/end inclusive, just-after excluded", bt.newPrs === 2);
const mt = rep({ queue: { tasks: [{ id: "1", status: "DONE" }, null, { id: "2" }] } });
check("malformed tasks -> completedTasks/bottlenecks UNKNOWN + flagged",
  mt.completedTasks === "UNKNOWN" && mt.bottlenecks === "UNKNOWN" && mt.unknowns.includes("queue.tasks[]"));
check("negative / fractional activeImplementers -> UNKNOWN",
  rep({ runFacts: { activeImplementers: -3, failures: [] } }).activeImplementers === "UNKNOWN" &&
  rep({ runFacts: { activeImplementers: 1.5, failures: [] } }).activeImplementers === "UNKNOWN");
check("zero activeImplementers is valid", rep({ runFacts: { activeImplementers: 0, failures: [] } }).activeImplementers === 0);
const u = buildReport({ ...full, periodStart: undefined, periodEnd: undefined });
check("undefined period bounds -> UNKNOWN, no throw", u.newPrs === "UNKNOWN" && u.unknowns.includes("period"));

// Advisory remediation proofs
const iso = (a, b) => rep({ periodStart: a, periodEnd: b });
check("start==end: instant PR counted, others not",
  rep({ periodStart: P.periodStart, periodEnd: P.periodStart, prs: [{ number: 1, createdAt: P.periodStart }, { number: 2, createdAt: "2026-01-01T00:00:01Z" }] }).newPrs === 1);
check("NaN/Infinity period -> period unknown",
  iso(NaN, 1).unknowns.includes("period") && iso(0, Infinity).unknowns.includes("period") && iso(-Infinity, Infinity).newPrs === "UNKNOWN");
check("epoch-seconds number period -> unparseable (period unknown)", iso(1767225600, 1767229200).unknowns.includes("period"));
check("epoch-ms number / Date object period -> unparseable",
  iso(1767225600000, 1767229200000).newPrs === "UNKNOWN" && iso(new Date(0), new Date(1)).newPrs === "UNKNOWN");
check("epoch-seconds number PR createdAt -> unknown, never undercount",
  rep({ prs: [{ createdAt: 1767225900 }] }).newPrs === "UNKNOWN" && rep({ prs: [{ createdAt: new Date(P.periodStart) }] }).newPrs === "UNKNOWN");
check("non-ISO strings rejected",
  ["2026-01-01", "2026-01-01 00:00:00Z", "Jan 1 2026", "2026-01-01T00:00:00", "1767225600", "2026-1-1T00:00:00Z"].every((x) => iso(x, P.periodEnd).newPrs === "UNKNOWN"));
check("Feb 30 / Apr 31 / month 13 / hour 24 rejected",
  ["2026-02-30T00:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z"].every((x) => iso(x, "2027-01-01T00:00:00Z").unknowns.includes("period")));
check("leap day valid, non-leap Feb 29 rejected",
  !iso("2028-02-29T00:00:00Z", "2028-03-01T00:00:00Z").unknowns.includes("period") && iso("2026-02-29T00:00:00Z", "2026-03-01T00:00:00Z").unknowns.includes("period"));
check("offset and fractional seconds accepted",
  rep({ prs: [{ number: 1, createdAt: "2026-01-01T01:30:00.123+01:00" }] }).newPrs === 1);
check("bad offset rejected", rep({ prs: [{ createdAt: "2026-01-01T00:30:00+25:00" }] }).newPrs === "UNKNOWN");
const stT = (status) => rep({ queue: { tasks: [{ id: "a", status }] } });
check("status ' DONE' / 'done' / unknown -> malformed",
  [" DONE", "done", "Done", "WAT", "RUNNING", "DONE "].every((x) => stT(x).completedTasks === "UNKNOWN" && stT(x).bottlenecks === "UNKNOWN" && stT(x).unknowns.includes("queue.tasks[]")));
check("every exact queue status accepted",
  ["READY","IN_PROGRESS","BLOCKED","DONE","COMPLETED","DRAFT_NOT_READY","PENDING_REVIEW","PENDING_CI","AUTHORITY_REQUIRED","NOT_STARTED"].every((x) => stT(x).unknowns.length === 0));
check("task missing / empty / non-string id -> malformed",
  [{ status: "DONE" }, { id: "", status: "DONE" }, { id: 5, status: "DONE" }].every((t) => rep({ queue: { tasks: [t] } }).unknowns.includes("queue.tasks[]")));
const dt = rep({ queue: { tasks: [{ id: "a", status: "DONE" }, { id: "a", status: "DONE" }] } });
check("duplicate task ids -> unknown, not double counted",
  dt.completedTasks === "UNKNOWN" && dt.bottlenecks === "UNKNOWN" && dt.unknowns.includes("queue.tasks[].id"));
const dp = rep({ prs: [{ number: 1, createdAt: P.periodStart }, { number: 1, createdAt: P.periodStart }] });
check("duplicate PR numbers -> newPrs UNKNOWN + flagged", dp.newPrs === "UNKNOWN" && dp.unknowns.includes("prs[].number"));
// eslint-disable-next-line no-sparse-arrays
const sp = rep({ prs: [{ number: 1, createdAt: P.periodStart }, , ] });
check("sparse prs hole -> unknown", sp.newPrs === "UNKNOWN" && sp.unknowns.includes("prs[].createdAt"));
const st2 = rep({ queue: { tasks: [{ id: "a", status: "DONE" }, , ] } });
check("sparse tasks hole -> malformed", st2.completedTasks === "UNKNOWN" && st2.unknowns.includes("queue.tasks[]"));
check("1e21 / -0 / Infinity / MAX_SAFE+1 activeImplementers -> UNKNOWN",
  [1e21, -0, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null].every((x) => rep({ runFacts: { activeImplementers: x, failures: [] } }).activeImplementers === "UNKNOWN"));
check("MAX_SAFE_INTEGER activeImplementers accepted", rep({ runFacts: { activeImplementers: Number.MAX_SAFE_INTEGER, failures: [] } }).activeImplementers === Number.MAX_SAFE_INTEGER);
const inj = renderMarkdown(buildReport({ ...full, periodStart: "2026-01-01T00:00:00Z\n# Injected", periodEnd: "x\r\n- Fake: 1" }));
check("newline in period cannot inject markdown lines",
  inj.split("\n").length === renderMarkdown(r).split("\n").length && !inj.includes("\n# Injected") && !inj.includes("\n- Fake"));
const cyc = {}; cyc.self = cyc;
let circ = "";
try { circ = renderMarkdown(rep({ runFacts: { activeImplementers: 1, failures: [cyc, "ok\nline"] } })); } catch { circ = "THROW"; }
check("circular failure -> [unserializable], no throw", circ.includes("[unserializable]") && circ !== "THROW");
check("newline in failure string / blocker escaped", !circ.includes("ok\nline"));
let big = "";
try { big = renderMarkdown(rep({ runFacts: { activeImplementers: 1, failures: [{ n: 10n }] } })); } catch { big = "THROW"; }
check("BigInt failure -> [unserializable], no throw", big.includes("[unserializable]"));

// Delta-review remediation proofs
const okPr = (number) => ({ number, createdAt: P.periodStart });
const nPrs = (...a) => rep({ prs: a });
check("PR number 1 vs '1' is a duplicate (String key)", nPrs(okPr(1), okPr("1")).newPrs === "UNKNOWN" && nPrs(okPr(1), okPr("1")).unknowns.includes("prs[].number"));
check("distinct numbers 1 and 2 (number/string mix) counted", nPrs(okPr(1), okPr("2")).newPrs === 2);
const bothUndef = nPrs({ createdAt: P.periodStart }, { createdAt: P.periodStart });
check("both PR numbers undefined -> malformed, not filtered", bothUndef.newPrs === "UNKNOWN" && bothUndef.unknowns.includes("prs[].number"));
check("single PR with missing number -> malformed", nPrs({ createdAt: P.periodStart }).unknowns.includes("prs[].number"));
check("non-safe / fractional / zero / negative / NaN / non-integer-string / other-type numbers -> malformed",
  [2 ** 53, 1.5, 0, -1, NaN, Infinity, "1.5", "01", "", " 1", "1 ", "abc", "9007199254740993", null, {}, [], 1n, true]
    .every((n) => nPrs(okPr(n)).newPrs === "UNKNOWN" && nPrs(okPr(n)).unknowns.includes("prs[].number")));
const thrower = { toString() { throw new Error("boom"); } };
const sym = Symbol("s");
const hostileQ = { tasks: [
  { id: "H1", status: "BLOCKED", blocker: thrower },
  { id: "H2", status: "BLOCKED", blocker: sym },
  { id: "H3", status: "BLOCKED", blocker: { toString: () => ({}) , valueOf: () => ({}) } },
  { id: "H4", status: "BLOCKED", get blocker() { throw new Error("getter"); } },
] };
let hr = null; let hmd = "";
try { hr = rep({ queue: hostileQ }); hmd = renderMarkdown(hr); } catch { hr = "THROW"; }
check("throwing toString / throwing getter / non-primitive blocker never throws -> 'unspecified'",
  hr !== "THROW" && Array.isArray(hr.bottlenecks) && hr.bottlenecks.length === 4 && hr.bottlenecks.filter((b) => b.id !== "H2").every((b) => b.blocker === "unspecified"));
check("Symbol blocker does not throw", hr !== "THROW" && Array.isArray(hr.bottlenecks) && hr.bottlenecks.some((b) => b.id === "H2" && typeof b.blocker === "string"));
let hid = "";
try { hid = renderMarkdown({ ...buildReport(full), bottlenecks: [{ id: sym, blocker: thrower }], failures: [thrower, sym, { toJSON() { throw new Error("j"); } }] }); } catch { hid = "THROW"; }
check("renderMarkdown with hostile ids/blockers/failures never throws -> [unserializable]", hid !== "THROW" && hid.includes("[unserializable]"));
let hg = "";
try { hg = JSON.stringify(buildReport({ ...full, queue: { get tasks() { throw new Error("t"); } }, prs: new Proxy([], { get() { throw new Error("p"); } }) })); } catch { hg = "THROW"; }
check("throwing queue.tasks getter / hostile prs proxy never throws", hg !== "THROW");
const esc = renderMarkdown(rep({ runFacts: { activeImplementers: 1, failures: ["a\u2028b\u2029c", "<img src=x onerror=1>", "x&y"] } }));
check("U+2028 / U+2029 escaped as \\u2028 / \\u2029", !/[\u2028\u2029]/.test(esc) && esc.includes("\\u2028") && esc.includes("\\u2029"));
check("'<' escaped: no raw <img", !esc.includes("<") && esc.includes("\\u003cimg src=x onerror=1>"));
check("'&' escaped: no raw &", !esc.includes("&") && esc.includes("x\\u0026y"));
const blk = renderMarkdown(rep({ queue: { tasks: [{ id: "<b>", status: "BLOCKED", blocker: "a&b\u2028c" }] } }));
check("bottleneck id/blocker escaped too", !blk.includes("<") && !blk.includes("&") && !/[\u2028\u2029]/.test(blk));
// STATUSES parity with queue.mjs: queue.mjs lives on the CP-QUEUE branch, so this runs only where that file exists.
if (fs.existsSync(new URL("./queue.mjs", import.meta.url))) {
  const q = await import("./queue.mjs");
  const a = [...q.STATUSES].sort().join(","), b = [...STATUSES].sort().join(",");
  check("report STATUSES equals queue.mjs STATUSES", q.STATUSES instanceof Set && a === b);
} else {
  console.log("SKIP: ./queue.mjs not present on this branch; STATUSES parity not checked here (not counted as a pass)");
}
check("report STATUSES has the 10 exact queue statuses",
  STATUSES.size === 10 && ["READY","IN_PROGRESS","BLOCKED","DONE","COMPLETED","DRAFT_NOT_READY","PENDING_REVIEW","PENDING_CI","AUTHORITY_REQUIRED","NOT_STARTED"].every((x) => STATUSES.has(x)));

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
