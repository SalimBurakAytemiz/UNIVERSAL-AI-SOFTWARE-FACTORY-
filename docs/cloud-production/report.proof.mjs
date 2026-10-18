//TR: CP-REPORT standalone proof for report.mjs
import { buildReport, renderMarkdown } from "./report.mjs";

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
    { id: "T5", status: "RUNNING" },
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
const bt = rep({ prs: [{ createdAt: P.periodStart }, { createdAt: P.periodEnd }, { createdAt: "2026-01-01T01:00:01Z" }] });
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

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
