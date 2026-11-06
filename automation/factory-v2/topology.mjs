// //TR: Factory V2 topolojisi: 8 Builder + 4 Reviewer + 3 Merge Preparer + 1 Exclusive Merge Writer + 1 Supervisor ilk hedef yapılandırmadır; Builder sayısı doğrulanmış kapasiteye göre 10/12/... ölçeklenebilir. Hedef (target) ile etkin (active) sayılar ayrı tutulur: yapılandırılmış slot etkin işçi sayılmaz.
export const BUILDER_DOMAINS = Object.freeze([
  {slot: "A", domain: "DESKTOP_FRONTEND", hint: "Electron, Desktop UI and frontend"},
  {slot: "B", domain: "BACKEND_API", hint: "Backend, APIs, database and services"},
  {slot: "C", domain: "CLOUD_EXECUTION", hint: "Cloud execution, sandbox, workers and orchestration"},
  {slot: "D", domain: "QA_CI", hint: "QA automation, testing and Windows CI"},
  {slot: "E", domain: "SECURITY", hint: "Security, authorization and isolation"},
  {slot: "F", domain: "AI_ROUTING", hint: "AI models, routing, fallback and quotas"},
  {slot: "G", domain: "PRODUCT_RELEASE", hint: "Product E2E, packaging, installation and release"},
  {slot: "H", domain: "RELIABILITY", hint: "Performance, reliability, technical debt and independent backlog"}
]);
export const REVIEWER_ROLES = Object.freeze([
  {slot: "R1", focus: "ARCHITECTURE_CORRECTNESS"},
  {slot: "R2", focus: "SECURITY_ISOLATION"},
  {slot: "R3", focus: "QUALITY_ACCEPTANCE"},
  {slot: "R4", focus: "ADVERSARIAL_CROSS_SYSTEM"}
]);
export const INITIAL_TARGET = Object.freeze({builders: 8, reviewers: 4, mergePreparers: 3, mergeWriters: 1, supervisors: 1});
// Hard architectural ceilings: high enough to scale beyond 8; the governor decides what is actually used.
export const LIMITS = Object.freeze({builders: 32, reviewers: 16, mergePreparers: 8});

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Validate a target. mergeWriters and supervisors are fixed at exactly 1 (exclusivity is not configurable). */
export function validateTarget(t) {
  const errs = [];
  if (!intIn(t?.builders, 1, LIMITS.builders)) errs.push("builders");
  if (!intIn(t?.reviewers, 1, LIMITS.reviewers)) errs.push("reviewers");
  if (!intIn(t?.mergePreparers, 1, LIMITS.mergePreparers)) errs.push("mergePreparers");
  if (t?.mergeWriters !== 1) errs.push("mergeWriters:must_be_1");
  if (t?.supervisors !== 1) errs.push("supervisors:must_be_1");
  if (errs.length) throw new Error(`TOPOLOGY_INVALID:${errs.join(",")}`);
  return t;
}

/** Builder slot ids: A..H first (with domain preference), then H2.. general slots without a preferred domain. */
export function builderSlots(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = BUILDER_DOMAINS[i];
    out.push(d ? {id: `builder-${d.slot}`, role: "BUILDER", domain: d.domain} : {id: `builder-X${i + 1}`, role: "BUILDER", domain: null});
  }
  return out;
}
export function reviewerSlots(n) {
  const out = [];
  for (let i = 0; i < n; i++) { const r = REVIEWER_ROLES[i % REVIEWER_ROLES.length]; out.push({id: i < REVIEWER_ROLES.length ? `reviewer-${r.slot}` : `reviewer-${r.slot}-${Math.floor(i / 4) + 1}`, role: "REVIEWER", focus: r.focus}); }
  return out;
}
export function preparerSlots(n) { return Array.from({length: n}, (_, i) => ({id: `preparer-${i + 1}`, role: "MERGE_PREPARER"})); }

/** Full slot table for a target. Configured slots are NOT active workers. */
export function buildTopology(target = INITIAL_TARGET) {
  validateTarget(target);
  return {
    target: {...target},
    slots: [...builderSlots(target.builders), ...reviewerSlots(target.reviewers), ...preparerSlots(target.mergePreparers),
      {id: "merge-writer", role: "MERGE_WRITER"}, {id: "supervisor", role: "SUPERVISOR"}]
  };
}

/**
 * Reconfigure (e.g. 8 -> 10 -> 12). Existing slot ids are preserved; shrinking only removes idle slots,
 * a busy slot is kept draining (never preempted) and reported in `draining`.
 */
export function reconfigure(current, nextTarget, busySlotIds = new Set()) {
  const next = buildTopology(nextTarget);
  const nextIds = new Set(next.slots.map(s => s.id));
  const draining = current.slots.filter(s => !nextIds.has(s.id) && busySlotIds.has(s.id)).map(s => s.id);
  const removed = current.slots.filter(s => !nextIds.has(s.id) && !busySlotIds.has(s.id)).map(s => s.id);
  const added = next.slots.filter(s => !current.slots.some(c => c.id === s.id)).map(s => s.id);
  const slots = [...next.slots, ...current.slots.filter(s => draining.includes(s.id)).map(s => ({...s, draining: true}))];
  return {target: next.target, slots, added, removed, draining};
}

/** Map a backlog task to a preferred builder domain (deterministic keyword routing; no model call). */
export function domainOfTask(task) {
  const s = `${task?.id ?? ""} ${task?.name ?? ""} ${(task?.paths ?? []).join(" ")}`.toLowerCase();
  const rules = [
    ["SECURITY", /secur|güvenlik|auth|yetki|sandbox|isolation|izolasyon|secret|redact/],
    ["QA_CI", /\bqa\b|test|ci\b|windows ci|shard|regression|gerileme/],
    ["CLOUD_EXECUTION", /^cloud-|cloud|bulut|worker|orchestr|executor/],
    ["AI_ROUTING", /model|provider|sağlayıcı|routing|quota|kota|fallback|omniroute/],
    ["PRODUCT_RELEASE", /release|installer|kurulum|packag|paket|e2e|sürüm/],
    ["DESKTOP_FRONTEND", /desktop|electron|renderer|\bui\b|arayüz|frontend/],
    ["BACKEND_API", /api|backend|database|veritaban|server|endpoint|service/]
  ];
  for (const [d, re] of rules) if (re.test(s)) return d;
  return "RELIABILITY";
}
