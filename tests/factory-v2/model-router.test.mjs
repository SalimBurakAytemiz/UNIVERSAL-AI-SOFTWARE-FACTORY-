// //TR: Factory V2 model yönlendirici kabul testleri: basit→Haiku, standart→Sonnet, kritik→Opus; Opus erişilemezse kritik iş düşürülmez, bekler ve diğer işler sürer; kota sınırında sınıf atlanmaz, beklenir; yetkilendirme reddi ayrı sınıflanır; reviewer bağımsızlığı; yönlendirme kaydında seçilen model, gerekçe ve platformun bildirdiği gerçek hizmet veren model ayrı tutulur ve sonuç yalnız doğrulanmış modelle kabul edilir; sınırlı yükseltme; core/policy/model-routing.ts ile sınıf uyumu.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {git} from "./harness.mjs";
import {S, SESS, ringFor} from "./keys.mjs";
import {createLocalDocStore} from "../../automation/factory-v2/ref-doc-store.mjs";
import {createSharedRegistry} from "../../automation/factory-v2/shared-registry.mjs";
import {registryLog} from "../../automation/factory-v2/ledger-log.mjs";
import {StateJournal} from "../../automation/factory-v2/state-journal.mjs";
import {createMemoryStore} from "../../automation/factory-v2/ownership.mjs";
import {FactorySupervisor} from "../../automation/factory-v2/supervisor.mjs";
import {CloudOrchestrator, RESULT_MARK} from "../../automation/factory-v2/cloud-orchestrator.mjs";
import {routeJob, complexityOf, classifyModelError, availabilityFrom, sessionModelFacts, classOfModel, COMPLEXITY_CLASS} from "../../automation/factory-v2/model-router.mjs";
import {routeModel} from "../../core/policy/model-routing.ts";

const T = 120_000, D = "fv2-test", sha = c => c.repeat(40);
const clock = {t: 5_000_000};
function stack({backlog, models, diffPaths = () => ["work/x.txt"], reviewers = 4}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-mr-")); git(root, "init", "-q", "-b", "integ", "r"); const r = path.join(root, "r");
  fs.writeFileSync(path.join(r, "a"), "a"); git(r, "add", "."); git(r, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "a");
  const journal = new StateJournal(registryLog({registry: createSharedRegistry({docStore: createLocalDocStore(r), ref: "refs/heads/uasco/registry"}), ns: "mr", signer: S.V2, ring: ringFor(D), domain: D}));
  const g = {tips: {}, trailers: {}, branchTip(b) { return this.tips[b] ?? null; }, fetch: () => true, sessionsOf(h) { return this.trailers[h] ?? null; }, isAncestor: () => true};
  const orch = new CloudOrchestrator({repoUrl: "https://example.invalid/r", domain: D, git: g, now: () => clock.t, ...(models ? {models} : {})});
  const sup = new FactorySupervisor({domain: D, mode: "SHADOW", sessionId: SESS.V2, journal, leaseStore: createMemoryStore(), executor: orch, backlog: () => backlog, now: () => clock.t, leaseTtlMs: 3600_000,
    target: {builders: 8, reviewers, mergePreparers: 3, mergeWriters: 1, supervisors: 1}, dispatchBase: () => sha("b"), isAncestor: () => true, diffPaths});
  orch.attach(sup); sup.start();
  return {sup, orch, journal, g};
}
const result = (w, extra) => `${RESULT_MARK} ${JSON.stringify({intentId: w.intentId, nonce: w.nonce, taskId: w.taskId, attempt: w.attempt, ...extra})}`;
const served = (model, cost = 0.01) => ({ccr: {id: "x", configured_model: model, session_context: {model}, external_metadata: {last_served_model: model, usage: {cost_usd: cost}}}});
const byTask = (orch, id) => orch.actions().find(a => a.taskId === id);

describe("Claude-native adaptive model routing", () => {
  it("1-3: mechanical -> Haiku, routine -> Sonnet, critical -> Opus, applied through the real create_session `model` field", {timeout: T}, async () => {
    const {sup, orch} = stack({backlog: [
      {id: "DOC", paths: ["docs/guide/"], tier: "T0", name: "docs typo"},
      {id: "FEAT", paths: ["apps/web/"], tier: "T1", name: "feature"},
      {id: "SEC", paths: ["automation/factory-v2/supervisor.mjs"], tier: "T1", name: "supervisor change"}]});
    await sup.tick();
    expect(byTask(orch, "DOC").createSession).toMatchObject({model: "haiku", tags: expect.arrayContaining(["model:cheap"])});
    expect(byTask(orch, "FEAT").createSession).toMatchObject({model: "sonnet", tags: expect.arrayContaining(["model:standard"])});
    expect(byTask(orch, "SEC").createSession).toMatchObject({model: "opus", tags: expect.arrayContaining(["model:senior"])});
    const w = orch.workers(x => x.taskId === "SEC")[0];
    expect(w.routing).toMatchObject({complexity: "CRITICAL", requiredClass: "SENIOR", modelClass: "SENIOR", requestedModel: "opus"});
    expect(w.routing.reasons.join(" ")).toMatch(/CRITICAL -> SENIOR/);
  });

  it("4: Opus not accessible -> a critical task is never downgraded; it waits while independent tasks continue", {timeout: T}, async () => {
    const {sup, orch, journal} = stack({backlog: [{id: "SEC", paths: ["automation/factory-v2/supervisor.mjs"], tier: "T1"}, {id: "FEAT", paths: ["apps/web/"], tier: "T1"}]});
    for (const m of ["opus", "claude-opus-5-5"]) journal.record("MODEL_OBSERVATION", {model: m, outcome: "ACCESS"}, sup.fence(), `obs:${m}`);
    await sup.tick();
    expect(byTask(orch, "SEC")).toBeUndefined();
    expect(journal.get("SEC")).toMatchObject({state: "QUEUED"});
    expect(byTask(orch, "FEAT").createSession.model).toBe("sonnet");
    expect(routeJob({role: "BUILDER", complexity: "CRITICAL"}, {availability: orch.availability()})).toMatchObject({decision: "REFUSE", code: "NO_PERMITTED_MODEL", requiredClass: "SENIOR"});
  });

  it("5: quota limit -> the class waits (no climb to a costlier model); after the reset it routes again", () => {
    const now = 1_000;
    const a = availabilityFrom([{model: "sonnet", outcome: "QUOTA", until: now + 60_000}, {model: "claude-sonnet-5-5", outcome: "QUOTA", until: now + 60_000}], now);
    expect(routeJob({role: "BUILDER", complexity: "ROUTINE"}, {availability: a})).toMatchObject({decision: "WAIT", code: "MODEL_QUOTA_WAIT"});
    expect(routeJob({role: "BUILDER", complexity: "MECHANICAL"}, {availability: a}).model).toBe("haiku"); // other classes unaffected
    const later = availabilityFrom([{model: "sonnet", outcome: "QUOTA", until: now + 60_000}], now + 61_000);
    expect(routeJob({role: "BUILDER", complexity: "ROUTINE"}, {availability: later}).model).toBe("sonnet");
    // an inaccessible cheaper class is climbed past (never below the requirement)
    const noHaiku = availabilityFrom([{model: "haiku", outcome: "ACCESS"}, {model: "claude-haiku-5-5", outcome: "ACCESS"}]);
    expect(routeJob({role: "BUILDER", complexity: "MECHANICAL"}, {availability: noHaiku})).toMatchObject({decision: "ROUTE", modelClass: "STANDARD", requiredClass: "CHEAP"});
  });

  it("6: authorisation, access and quota failures are classified apart; a model failure releases the task without escalating its class", {timeout: T}, async () => {
    expect(classifyModelError("HTTP 401 authentication_error: invalid token")).toBe("AUTH");
    expect(classifyModelError("429 rate_limit_error: usage limit reached (five_hour)")).toBe("QUOTA");
    expect(classifyModelError("403: model claude-opus-x is not available for this account")).toBe("ACCESS");
    expect(classifyModelError("TypeError: x is undefined")).toBe(null);
    const {sup, orch, journal} = stack({backlog: [{id: "FEAT", paths: ["apps/web/"], tier: "T1"}]});
    await sup.tick();
    const a = byTask(orch, "FEAT");
    expect(orch.modelFailure(a.intentId, "401 Unauthorized: OAuth token rejected")).toMatchObject({classified: true, kind: "AUTH", model: "sonnet"});
    expect(orch.workers(x => x.intentId === a.intentId)[0]).toMatchObject({status: "LOST", modelError: "AUTH"});
    expect(orch.availability().get("sonnet").state).toBe("AUTH");
    clock.t += 60_000; await sup.tick(); clock.t += 60_000; await sup.tick();
    const again = byTask(orch, "FEAT");
    expect(again.intentId).not.toBe(a.intentId);
    expect(again.createSession.model).toBe("claude-sonnet-5-5"); // same class, next catalog entry; not escalated to Opus
    expect(journal.get("FEAT").attempt).toBe(1);
  });

  it("7: reviewer independence: a reviewer never shares the builder session; security review is critical (Opus)", {timeout: T}, async () => {
    expect(routeJob({role: "REVIEWER", complexity: "ROUTINE", builderSession: "session_sameAAAAA1", reviewerSession: "session_sameAAAAA1"})).toMatchObject({decision: "REFUSE", code: "REVIEWER_NOT_INDEPENDENT"});
    expect(complexityOf({role: "REVIEWER", focus: "SECURITY_ISOLATION", paths: ["docs/x.md"], tier: "T0"})).toBe("CRITICAL");
    const {sup, orch, g} = stack({backlog: [{id: "SEC", paths: ["automation/factory-v2/supervisor.mjs"], tier: "T1"}], diffPaths: () => ["automation/factory-v2/supervisor.mjs"]});
    await sup.tick();
    const b = byTask(orch, "SEC"); orch.bind(b.intentId, "session_builderMR001");
    orch.observe(b.intentId, {...sessionModelFacts(served("claude-opus-5-5")), sessionId: "session_builderMR001"});
    const w = orch.workers(x => x.intentId === b.intentId)[0]; g.tips[w.branch] = sha("4"); g.trailers[sha("4")] = ["session_builderMR001"];
    expect(orch.submitResult(b.intentId, {sessionId: "session_builderMR001", text: result(w, {ok: true, headSha: sha("4")})})).toEqual({accepted: true});
    await sup.tick();
    const reviews = orch.actions().filter(a => a.role === "REVIEWER");
    expect(reviews.length).toBeGreaterThan(1);
    for (const r of reviews) expect(r.createSession.model).toBe("opus");
    expect(() => orch.bind(reviews[0].intentId, "session_builderMR001")).toThrow(/SESSION_ALREADY_BOUND/);
  });

  it("8: the routing record keeps chosen model, reasons and the platform-served model apart; results need the served model and refuse a downgrade", {timeout: T}, async () => {
    const {sup, orch, g} = stack({backlog: [{id: "SEC", paths: ["automation/factory-v2/supervisor.mjs"], tier: "T1"}]});
    await sup.tick();
    const a = byTask(orch, "SEC"); orch.bind(a.intentId, "session_builderMR002");
    const w0 = orch.workers(x => x.intentId === a.intentId)[0]; g.tips[w0.branch] = sha("6"); g.trailers[sha("6")] = ["session_builderMR002"];
    const text = result(w0, {ok: true, headSha: sha("6")});
    expect(orch.submitResult(a.intentId, {sessionId: "session_builderMR002", text})).toMatchObject({accepted: false, reason: "MODEL_NOT_VERIFIED"});
    expect(orch.observe(a.intentId, {...sessionModelFacts(served("claude-sonnet-5-5", 0.05)), sessionId: "session_builderMR002"})).toMatchObject({servedModel: "claude-sonnet-5-5", sameFamily: false, satisfiesRequired: false});
    expect(orch.submitResult(a.intentId, {sessionId: "session_builderMR002", text}).reason).toBe("MODEL_DOWNGRADED:claude-sonnet-5-5<SENIOR"); // a platform fallback below the requirement is refused, not accepted silently
    expect(orch.observe(a.intentId, {...sessionModelFacts(served("claude-opus-5-5", 0.31)), sessionId: "session_builderMR002"})).toMatchObject({sameFamily: true, satisfiesRequired: true});
    expect(orch.submitResult(a.intentId, {sessionId: "session_builderMR002", text})).toEqual({accepted: true});
    const rec = orch.workers(x => x.intentId === a.intentId)[0];
    expect(rec.routing).toMatchObject({requestedModel: "opus", modelClass: "SENIOR", requiredClass: "SENIOR"});
    expect(rec.routing.reasons.length).toBeGreaterThan(0);
    expect(rec.model).toMatchObject({configuredModel: "claude-opus-5-5", sessionModel: "claude-opus-5-5", servedModel: "claude-opus-5-5", costUsdReported: 0.31});
    expect(() => orch.observe(a.intentId, {...sessionModelFacts(served("claude-opus-5-5")), sessionId: "session_someoneelse1"})).toThrow(/SESSION_NOT_BOUND_TO_INTENT/);
    expect(orch.observe(a.intentId, {sessionId: "session_builderMR002", servedModel: null})).toMatchObject({recorded: false, reason: "NOT_YET_SERVED"});
  });

  it("escalation after capability failures is bounded and never loops; model failures do not escalate", () => {
    expect(routeJob({role: "BUILDER", complexity: "MECHANICAL"}, {escalate: 1})).toMatchObject({modelClass: "STANDARD"});
    expect(routeJob({role: "BUILDER", complexity: "MECHANICAL"}, {escalate: 7})).toMatchObject({modelClass: "SENIOR"});
    expect(routeJob({role: "BUILDER", complexity: "CRITICAL"}, {escalate: 3})).toMatchObject({modelClass: "SENIOR"});
    expect(routeJob({role: "BUILDER", complexity: "ROUTINE"}, {models: {CHEAP: [], STANDARD: ["claude-opus-5-5"], SENIOR: []}})).toMatchObject({decision: "REFUSE"}); // a mislabelled catalog entry is ignored
    expect(classOfModel("claude-haiku-5-5")).toBe("CHEAP");
    expect(sessionModelFacts({ccr: {id: "s"}})).toMatchObject({servedModel: null, costUsdReported: null});
  });

  it("conforms to core/policy/model-routing.ts: same class per complexity, CRITICAL never below SENIOR", () => {
    const catalog = [{id: "haiku", modelClass: "CHEAP", tier: "SUBSCRIPTION"}, {id: "sonnet", modelClass: "STANDARD", tier: "SUBSCRIPTION"}, {id: "opus", modelClass: "SENIOR", tier: "SUBSCRIPTION"}];
    for (const complexity of Object.keys(COMPLEXITY_CLASS)) {
      const ts = routeModel({riskLevel: "R1", dataClass: "INTERNAL", complexity, role: "BUILDER", paidAuthority: false, executorId: "e", sessionId: "s"}, catalog);
      expect(ts.decision).toBe("ROUTE");
      expect(routeJob({role: "BUILDER", complexity}).modelClass).toBe(ts.modelClass);
    }
    const tsNoSenior = routeModel({riskLevel: "R1", dataClass: "INTERNAL", complexity: "CRITICAL", role: "BUILDER", paidAuthority: false, executorId: "e", sessionId: "s"}, catalog.slice(0, 2));
    expect(tsNoSenior.decision).toBe("REFUSE");
    expect(routeJob({role: "BUILDER", complexity: "CRITICAL"}, {models: {CHEAP: ["haiku"], STANDARD: ["sonnet"], SENIOR: []}}).decision).toBe("REFUSE");
  });
});
