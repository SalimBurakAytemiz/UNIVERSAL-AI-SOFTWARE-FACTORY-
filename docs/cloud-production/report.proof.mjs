//TR: CP-REPORT standalone proof for report.mjs
import fs from "node:fs";
import { buildReport, renderMarkdown, redactSecrets, STATUSES } from "./report.mjs";

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
  ["READY","IN_PROGRESS","BLOCKED","DONE","COMPLETED","DRAFT_NOT_READY","PENDING_REVIEW","IN_REVIEW","PENDING_CI","AUTHORITY_REQUIRED","NOT_STARTED"].every((x) => stT(x).unknowns.length === 0));
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
const blk = renderMarkdown({ ...buildReport(full), bottlenecks: [{ id: "<b>", blocker: "a&b\u2028c" }] });
check("bottleneck id/blocker escaped too", !blk.includes("<") && !blk.includes("&") && !/[\u2028\u2029]/.test(blk));
// STATUSES parity with queue.mjs: queue.mjs lives on the CP-QUEUE branch, so this runs only where that file exists.
if (fs.existsSync(new URL("./queue.mjs", import.meta.url))) {
  const q = await import("./queue.mjs");
  const a = [...q.STATUSES].sort().join(","), b = [...STATUSES].sort().join(",");
  check("report STATUSES equals queue.mjs STATUSES", Array.isArray(q.STATUSES) && a === b);
} else {
  console.log("SKIP: ./queue.mjs not present on this branch; STATUSES parity not checked here (not counted as a pass)");
}
check("report STATUSES is a frozen array with the 11 exact queue statuses incl. IN_REVIEW",
  Array.isArray(STATUSES) && Object.isFrozen(STATUSES) && STATUSES.length === 11 &&
  ["READY","IN_PROGRESS","BLOCKED","DONE","COMPLETED","DRAFT_NOT_READY","PENDING_REVIEW","IN_REVIEW","PENDING_CI","AUTHORITY_REQUIRED","NOT_STARTED"].every((x) => STATUSES.includes(x)));
{
  let threw = false;
  try { STATUSES.push("EVIL"); } catch { threw = true; }
  check("mutating exported STATUSES does not widen validation",
    threw && !STATUSES.includes("EVIL") && stT("EVIL").unknowns.includes("queue.tasks[]"));
}
check("IN_REVIEW counts as neither DONE nor bottleneck",
  stT("IN_REVIEW").completedTasks === 0 && stT("IN_REVIEW").bottlenecks.length === 0);
check("all real backlog statuses accepted",
  ["DONE","IN_REVIEW","BLOCKED","DRAFT_NOT_READY","AUTHORITY_REQUIRED"].every((x) => stT(x).unknowns.length === 0));

// Delta-2 proofs: id policy, caps, hostile render
const idT = (id) => rep({ queue: { tasks: [{ id, status: "DONE" }] } });
check("real backlog ids with '+' accepted", ["UI-037+046", "UI-027+UI-220", "CP-1.a_b:c"].every((x) => idT(x).unknowns.length === 0 && idT(x).completedTasks === 1));
check("malformed task ids rejected as queue.tasks[].id",
  ["a b", " a", "a\n", "a\u200B", "\u3164", "a/b", "\u00E9", ".", "..", "-", ":", "+", "_"].every((x) => idT(x).unknowns.includes("queue.tasks[].id") && idT(x).completedTasks === "UNKNOWN"));
const hugePrs = new Array(2 ** 28);
const hugeTasks = new Array(2 ** 28);
{
  const t0 = Date.now();
  const a = rep({ prs: hugePrs });
  const b = rep({ queue: { tasks: hugeTasks } });
  const ms = Date.now() - t0;
  check("sparse prs of length 2**28 -> UNKNOWN + 'prs[]' in <1s", a.newPrs === "UNKNOWN" && a.unknowns.includes("prs[]") && ms < 1000);
  check("sparse queue.tasks of length 2**28 -> UNKNOWN + 'queue.tasks[]' in <1s",
    b.completedTasks === "UNKNOWN" && b.bottlenecks === "UNKNOWN" && b.unknowns.includes("queue.tasks[]") && ms < 1000);
}
{
  const atCap = Array.from({ length: 100000 }, (_, i) => ({ number: i + 1, createdAt: P.periodStart }));
  const over = Array.from({ length: 100001 }, (_, i) => ({ number: i + 1, createdAt: P.periodStart }));
  check("exactly 100000 prs accepted, 100001 -> UNKNOWN 'prs[]'", rep({ prs: atCap }).newPrs === 100000 && rep({ prs: over }).newPrs === "UNKNOWN" && rep({ prs: over }).unknowns.includes("prs[]"));
  const tAt = Array.from({ length: 100000 }, (_, i) => ({ id: "T" + i, status: "DONE" }));
  const tOver = Array.from({ length: 100001 }, (_, i) => ({ id: "T" + i, status: "DONE" }));
  check("exactly 100000 tasks accepted, 100001 -> UNKNOWN 'queue.tasks[]'", rep({ queue: { tasks: tAt } }).completedTasks === 100000 && rep({ queue: { tasks: tOver } }).completedTasks === "UNKNOWN" && rep({ queue: { tasks: tOver } }).unknowns.includes("queue.tasks[]"));
}
{
  const hl = new Proxy([], { get(t, k) { if (k === "length") throw new Error("len"); return Reflect.get(t, k); } });
  let o; let threw = false;
  try { o = rep({ prs: hl, queue: { tasks: hl } }); } catch { threw = true; }
  check("throwing length getter never throws -> UNKNOWN", !threw && o.newPrs === "UNKNOWN" && o.completedTasks === "UNKNOWN");
}
{
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  let o = ""; let threw = false;
  try { o = renderMarkdown(proxy); } catch { threw = true; }
  check("renderMarkdown of revoked-proxy report never throws", !threw && typeof o === "string" && o.includes("[unrenderable]"));
  const hostileRep = { ...buildReport(full), failures: new Proxy([], { get() { throw new Error("x"); } }), bottlenecks: { get length() { throw new Error("y"); } } };
  threw = false;
  try { o = renderMarkdown(hostileRep); } catch { threw = true; }
  check("renderMarkdown with throwing list rendering never throws -> [unrenderable], other lines survive", !threw && o.includes("[unrenderable]") && o.includes("Completed tasks: 2"));
  const lr = { ...buildReport(full), unknowns: { get length() { throw new Error("z"); } } };
  threw = false;
  try { o = renderMarkdown(lr); } catch { threw = true; }
  check("renderMarkdown with hostile unknowns never throws", !threw && o.includes("[unrenderable]"));
}
{
  let n = 0;
  const flip = { get id() { return n++ === 0 ? "OK" : "bad id"; }, status: "DONE" };
  const o = rep({ queue: { tasks: [flip] } });
  check("stateful task id getter is snapshotted once", o.completedTasks === 1 && o.unknowns.length === 0);
}
// Review remediation: never use the iterator; snapshot; blocker/notes
{
  const P0 = { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-01T01:00:00Z" };
  const mk = (arr, extra) => { let hits = 0; Object.defineProperty(arr, Symbol.iterator, { value: function* () { hits++; if (extra) yield* extra(); else for (;;) yield { number: hits++, createdAt: P0.periodStart }; } }); return { arr, hits: () => hits }; };
  let t0 = Date.now();
  const inf = mk([{ number: 1, createdAt: P0.periodStart }]);
  const r1 = buildReport({ ...P0, prs: inf.arr, queue: { tasks: [] }, runFacts: { activeImplementers: 0, failures: [] } });
  check("prs with infinite own Symbol.iterator: indexed contents only (newPrs 1), iterator never called, <1s", r1.newPrs === 1 && inf.hits() === 0 && Date.now() - t0 < 1000);
  t0 = Date.now();
  const gen = mk([{ id: "T1", status: "DONE" }], function* () { for (let i = 0; i < 3e6; i++) yield { id: "G" + i, status: "BLOCKED" }; });
  const r2 = buildReport({ ...P0, prs: [], queue: { tasks: gen.arr }, runFacts: { activeImplementers: 0, failures: [] } });
  check("queue.tasks with 3e6-item own iterator: equals indexed contents, <1s", r2.completedTasks === 1 && r2.bottlenecks.length === 0 && gen.hits() === 0 && Date.now() - t0 < 1000);
  const fi = mk([]);
  const r3 = buildReport({ ...P0, prs: [], queue: { tasks: [] }, runFacts: { activeImplementers: 0, failures: fi.arr } });
  check("failures with infinite iterator: length 0 (indexed), no iteration", Array.isArray(r3.failures) && r3.failures.length === 0 && fi.hits() === 0);
  t0 = Date.now();
  const ri = mk([]); const ui = mk([]);
  const md = renderMarkdown({ ...buildReport(full), failures: ri.arr, unknowns: ui.arr, bottlenecks: mk([]).arr });
  check("render lists/unknowns never iterate (empty arrays with infinite iterators render 'none'), <1s",
    ri.hits() === 0 && ui.hits() === 0 && md.includes("- Failures: 0") && md.includes("Unknowns: none") && Date.now() - t0 < 1000);
  const th = new Proxy([{ number: 1, createdAt: P0.periodStart }], { get(t, k, rc) { if (k === "0") throw new Error("boom"); return Reflect.get(t, k, rc); } });
  let o; let threw = false;
  try { o = buildReport({ ...P0, prs: th, queue: { tasks: th }, runFacts: { activeImplementers: 1, failures: th } }); } catch { threw = true; }
  check("Proxy of array with throwing get -> UNKNOWN everywhere, no throw", !threw && o.newPrs === "UNKNOWN" && o.completedTasks === "UNKNOWN" && o.failures === "UNKNOWN" && o.bottlenecks === "UNKNOWN");
  let md2; threw = false;
  try { md2 = renderMarkdown({ ...buildReport(full), failures: th, unknowns: th }); } catch { threw = true; }
  check("render of throwing-get proxy lists -> [unrenderable], no throw", !threw && md2.includes("[unrenderable]"));
  // snapshot: mutate the caller's arrays after buildReport
  const f = ["a", "b"]; const prs = [{ number: 1, createdAt: P0.periodStart }]; const tasks = [{ id: "T", status: "BLOCKED", blocker: "x" }];
  const rr = buildReport({ ...P0, prs, queue: { tasks }, runFacts: { activeImplementers: 1, failures: f } });
  const before = renderMarkdown(rr);
  f.push("c"); f[0] = "ZZZ"; tasks.push({ id: "U", status: "BLOCKED" }); prs.length = 0;
  check("later mutation of caller's failures/tasks/prs cannot change the rendered report", renderMarkdown(rr) === before && rr.failures.length === 2 && rr.failures[0] === "a");
  check("failures over cap -> UNKNOWN + 'failures'", (() => { const x = buildReport({ ...P0, runFacts: { activeImplementers: 1, failures: new Array(100001) } }); return x.failures === "UNKNOWN" && x.unknowns.includes("failures"); })());
  // blocker / notes
  const bl = (t) => buildReport({ ...P0, queue: { tasks: [{ id: "B", status: "BLOCKED", ...t }] } }).bottlenecks[0].blocker;
  check("blocker non-empty string wins over notes", bl({ blocker: "bb", notes: "nn" }) === "bb");
  check("empty blocker falls back to notes", bl({ blocker: "", notes: "nn" }) === "nn");
  check("absent blocker falls back to notes", bl({ notes: "nn" }) === "nn");
  check("non-string blocker falls back to notes", bl({ blocker: 5, notes: "nn" }) === "nn");
  check("neither -> unspecified", bl({}) === "unspecified" && bl({ blocker: "", notes: "" }) === "unspecified" && bl({ notes: 7 }) === "unspecified");
  check("notes capped at 200 chars", bl({ notes: "n".repeat(500) }).length === 200);
  const nb = renderMarkdown(buildReport({ ...P0, queue: { tasks: [{ id: "B", status: "BLOCKED", notes: "a<b>&\nline" }] } }));
  check("notes rendered via safe() escaping", !nb.includes("<") && !nb.includes("&") && nb.includes("a\\u003cb>\\u0026\\nline"));
}

// Review remediation 2: bounded rendering and best-effort secret redaction
{
  const base = { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-01T01:00:00Z", prs: [], queue: { tasks: [] } };
  const t0 = Date.now();
  const fl = Array.from({ length: 1e5 }, (_, i) => "F" + i + "x".repeat(2000));
  const md = renderMarkdown(buildReport({ ...base, runFacts: { activeImplementers: 1, failures: fl } }));
  check("1e5 failures of 2000 chars: markdown < 500 KB in < 2 s", md.length < 500 * 1024 && Date.now() - t0 < 2000);
  check("failures list ends with fixed '(+99000 more)' marker and shows the true count", md.includes("(+99000 more)") && md.includes("Failures: 100000 ("));
  check("each rendered failure string is capped (truncated marker present, no 2000-char run)", md.includes("...(truncated)") && !md.includes("x".repeat(250)));
  const exactly = renderMarkdown(buildReport({ ...base, runFacts: { activeImplementers: 1, failures: fl.slice(0, 1000) } }));
  check("exactly 1000 items: no '(+N more)' marker", !exactly.includes("more)"));
  const bn = { ...base, queue: { tasks: Array.from({ length: 5000 }, (_, i) => ({ id: "B" + i, status: "BLOCKED", blocker: "b" })) } };
  const mb = renderMarkdown(buildReport(bn));
  check("5000 bottlenecks: capped at 1000 with '(+4000 more)'", mb.includes("(+4000 more)") && !mb.includes("B1000:") && mb.includes("B999\""));
  const longId = renderMarkdown({ period: { start: "p".repeat(5000), end: "e" }, completedTasks: 0, newPrs: 0, activeImplementers: 0, failures: [], bottlenecks: [{ id: "i".repeat(5000), blocker: "k" }], unknowns: ["u".repeat(5000)] });
  check("long period/id/unknown strings are capped", longId.length < 2000);

  // NOTE: fixtures are FAKE values assembled at runtime so no token-shaped literal exists in this file;
  // scripts/secret-sanity.mjs is unchanged. Redaction is a best-effort denylist, not a guarantee; blocker/notes must not hold secrets.
  const A = "A".repeat(24);
  const fakes = {
    ghp: "gh" + "p_" + A,
    pat: "github" + "_pat_" + A,
    glpat: "gl" + "pat-" + A,
    akia: "AK" + "IA" + "B".repeat(16),
    xox: "xo" + "xb-" + "1234567890-abc",
    jwt: "ey" + "Jhbgci.ey" + "Jzdwiy.sig_nature",
  };
  const bt = (text) => buildReport({ ...base, queue: { tasks: [{ id: "S", status: "BLOCKED", notes: text }] } }).bottlenecks[0].blocker;
  for (const [k, v] of Object.entries(fakes)) {
    const out = bt("see " + v + " end");
    check(`redaction: ${k} token shape replaced`, out === "see [redacted] end" && !out.includes(v));
  }
  for (const kv of ["Authorization: Bearer abc123def", "password=hunter2", "client_secret = zzz", "api-token: qqq"]) {
    const out = bt("x " + kv + " y");
    check(`redaction: key/value pair '${kv.split(/[:=]/)[0].trim()}' replaced`, out === "x [redacted] y");
  }
  check("redaction applies to blocker field too", buildReport({ ...base, queue: { tasks: [{ id: "S", status: "BLOCKED", blocker: fakes.ghp }] } }).bottlenecks[0].blocker === "[redacted]");
  check("token straddling the 200-char cap is redacted, not half-leaked", !bt("a".repeat(190) + " " + fakes.ghp).includes("gh" + "p_"));
  check("plain blocker text untouched", bt("waiting for review of PR 12") === "waiting for review of PR 12");
  // Review remediation 3 (ReDoS): deterministic hostile-input proofs. Each probe is a fixed worst-case string for one pattern.
  // The budget is generous and fixed (50 ms per call, first of up to 3 attempts to be under it so a scheduler hiccup cannot
  // fail the run) against ~870 ms measured before the fix for "token".repeat(400) at the old 2000-char cap, so it does not flake.
  const PER_CALL_MS = 50;
  const fastest = (fn) => { let ms = Infinity; for (let i = 0; i < 3 && ms >= PER_CALL_MS; i++) { const t = process.hrtime.bigint(); fn(); ms = Number(process.hrtime.bigint() - t) / 1e6; } return ms; };
  const hostile = {
    "token x10000": "token".repeat(10000),
    "passwordtokensecret x5000": "passwordtokensecret".repeat(5000),
    "Authorization x4000": "Authorization".repeat(4000),
    "passwd x8000": "passwd".repeat(8000),
    "secret_ x8000": "secret_".repeat(8000),
    "token+spaces x500": ("token" + " ".repeat(20)).repeat(500),
    "token=bearer x5000": "token=bearer ".repeat(5000),
    "64-char runs around token": ("x".repeat(64) + "token" + "y".repeat(64) + " ").repeat(100),
    "a- x5e5": "a-".repeat(5e5),
    "eyJ x5000": "eyJ".repeat(5000),
    "ghp_ x5000": "ghp_".repeat(5000),
    "github_pat_ x3000": "github_pat_".repeat(3000),
    "xoxb- x5000": "xox" + "b-".repeat(5000),
    "AKIA x5000": "AKIA".repeat(5000),
  };
  for (const [name, text] of Object.entries(hostile)) {
    const direct = fastest(() => redactSecrets(text));
    const viaBlocker = fastest(() => bt(text));
    const viaRender = fastest(() => renderMarkdown(buildReport({ ...base, runFacts: { activeImplementers: 1, failures: [text] } })));
    check(`ReDoS: hostile '${name}' stays under ${PER_CALL_MS} ms per call (redactSecrets / blocker / failures render)`,
      direct < PER_CALL_MS && viaBlocker < PER_CALL_MS && viaRender < PER_CALL_MS);
  }
  check("ReDoS: 'token'.repeat(400) at the formerly slow size is now fast", fastest(() => redactSecrets("token".repeat(400))) < PER_CALL_MS);
  check("redaction still masks a real 'token=abc' and 'Authorization: Bearer x'",
    redactSecrets("token=abc") === "[redacted]" && redactSecrets("Authorization: Bearer x") === "[redacted]");
  check("redaction still works after a hostile run of keywords inside the scan window",
    (() => { const o = redactSecrets("token".repeat(8) + " token=abc"); return o.endsWith(" [redacted]") && !o.includes("abc"); })() &&
    (() => { const o = redactSecrets("passwordtokensecret".repeat(5) + " Authorization: Bearer x"); return o.endsWith(" [redacted]") && !o.includes("Bearer x"); })());
  check("redaction: quoted key/value forms (password=\"v\", JSON-style) are masked",
    redactSecrets("password=\"hunter2\" ok") === "[redacted]\" ok" && !redactSecrets("{\"token\":\"abc\",\"n\":1}").includes("abc") && !redactSecrets("{\"Authorization\":\"Bearer zzz\"}").includes("zzz"));
  check("redaction: identifier runs up to 64 chars around the keyword are still masked",
    redactSecrets("MY_" + "X".repeat(40) + "_TOKEN_" + "Y".repeat(40) + "=v1") === "[redacted]");
  check("scan window is capped at 256 chars (nothing past it is emitted)", redactSecrets("a b ".repeat(200)).length <= 256);
  {
    // After an early secret shrinks the text, a token cut by the 256-char scan window must not leave a fragment in the output.
    const head = fakes.ghp.replace(A, "A".repeat(100)) + " ";
    const tail = "gh" + "p_" + "B".repeat(30);
    const text = head + "w ".repeat(67) + " " + tail;
    const out = bt(text);
    check("fragment of a token cut by the scan window is dropped, not half-leaked", text.indexOf(tail) === 240 && out.startsWith("[redacted] w w") && !out.includes("BBBB") && !out.includes("gh" + "p_B"));
  }
  check("blocker/notes are read and redacted only for BLOCKED tasks",
    (() => {
      let hits = 0; let n = 0;
      const lazy = (status) => ({ id: "L" + status, status, get blocker() { hits++; return "token=abc"; }, get notes() { hits++; return "token=abc"; } });
      const flip = { id: "F", get status() { return n++ === 0 ? "BLOCKED" : "DONE"; }, blocker: "token=abc" };
      const o = buildReport({ ...base, queue: { tasks: [lazy("DONE"), lazy("COMPLETED"), lazy("IN_REVIEW"), lazy("READY"), flip] } });
      return hits === 0 && n === 1 && o.completedTasks === 2 && o.bottlenecks.length === 1 && o.bottlenecks[0].id === "F" && o.bottlenecks[0].blocker === "[redacted]";
    })());

  // The failures items rendered into the report are free text too: they are redacted before the cap.
  {
    const fmd = renderMarkdown(buildReport({ ...base, runFacts: { activeImplementers: 1, failures: [
      "boom " + fakes.ghp, "token=sEcReT123 failed", "Authorization: Bearer zQ9", { password: "hunter2", step: 3 },
      "a".repeat(190) + " " + fakes.pat, "plain failure text", "gh" + "p_" + "A".repeat(200),
    ] } }));
    const line = fmd.split("\n").find((l) => l.startsWith("- Failures:")) || "";
    check("failures items: token shapes, key=value pairs and JSON-style objects are redacted",
      line.startsWith("- Failures: 7 (") && ![fakes.ghp, fakes.pat, "sEcReT123", "zQ9", "hunter2", "gh" + "p_", "github" + "_pat_"].some((x) => line.includes(x)) && line.includes("[redacted]"));
    check("failures items: non-secret text and structure are preserved", line.includes("\"plain failure text\"") && line.includes("\"boom [redacted]\"") && line.includes("\"step\""));
    const only = renderMarkdown(buildReport({ ...base, runFacts: { activeImplementers: 1, failures: ["gh" + "p_" + "A".repeat(200)] } }));
    check("failures items: shrunk item is exactly \"[redacted]\" with no truncation marker", only.includes("- Failures: 1 (\"[redacted]\")"));
  }
}

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
