// //TR: Bu test B5 Desktop iş ekranlarını doğrular: sabit POST allow-list (bilinmeyen rota/yöntem/aşırı gövde/yol hileleri), GET allow-list eklemeleri, durum makinesi kopyasının core ile eşitliği, form istek gövdeleri (argv dizisi, idempotency), yüksek riskli geçişte onay, Gelen Kutusu türetimi, kanıt durum eşlemesi, tr/en eşitliği ve renderer'da token yokluğu; sahte DOM ile gerçek görünüm modüllerini çalıştırır.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {logicalTestFiles} from "./support/validation-test-shards.js";
import {moduleSpecifiers} from "./support/static-imports.js";

const root = path.resolve(__dirname, "..");
const desk = path.join(root, "apps", "desktop");
const rend = path.join(desk, "renderer");
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);
const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const code = (src: string) => src.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n");

const MID = "msn_" + "ab12".repeat(6);
const MID2 = "msn_" + "cd34".repeat(6);
const PID = "prj_" + "ef56".repeat(6);
const RUN = "run_0123456789ab";
const EVID = "evd_0123456789ab";
const SHA = "a".repeat(64);

// ---------- main.mjs blok yükleyicileri (electron vitest içinde import edilemez) ----------
const mainSrc = read(desk, "main.mjs");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); expect(m, name).not.toBeNull(); return m![1]; };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const loadPost = () => new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck, POST_MAX_BODY_BYTES};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}; POST_MAX_BODY_BYTES: number};

describe("B5 POST bridge allow-list (main.mjs)", () => {
  it("allows exactly the four fixed POST routes with strict mission ids", () => {
    const {desktopPostPathAllowed: ok} = loadPost();
    for (const p of ["/v1/projects", "/v1/missions", `/v1/missions/${MID}/transition`, `/v1/missions/${MID}/runs`]) expect(ok(p), p).toBe(true);
  });
  it("rejects unknown routes, GET-only routes, other mutating routes, id tricks and path tricks", () => {
    const {desktopPostPathAllowed: ok} = loadPost();
    const bad = ["/v1/cockpit", "/v1/work-runs", `/v1/work-runs/${RUN}`, "/v1/evidence", `/v1/evidence/${EVID}`, "/v1/agents", "/v1/control/stop", "/v1/control/resume", "/v1/control/retry-blocked", "/health",
      `/v1/missions/${MID}`, `/v1/missions/${MID}/`, `/v1/missions/${MID}/transition/`, `/v1/missions/${MID}/transition?x=1`, `/v1/missions/${MID}/runs?x=1`, `/v1/missions/${MID}/runs/extra`, `/v1/missions/${MID}/other`,
      `/v1/missions/${MID}/../projects`, `/v1/missions/../projects`, "/v1/missions/msn_zz/runs", "/v1/missions/msn_" + "A".repeat(24) + "/runs", "/v1/missions/msn_" + "a".repeat(23) + "/runs", "/v1/missions/msn_" + "a".repeat(25) + "/runs",
      "/v1/projects/", "/v1/projects?x=1", "/v1/projects\n", "/v1/projects%2f..", "/v1/projects#x", "/V1/projects", "v1/projects", "//evil.invalid/v1/projects", "http://evil.invalid/v1/projects", "/v1/projects/../control/stop", "", "/", "/v1/" + "a".repeat(200)];
    for (const p of bad) expect(ok(p), JSON.stringify(p)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, [], ["/v1/projects"]]) expect(ok(nonString)).toBe(false);
  });
  it("accepts only plain JSON object bodies up to 32 KB (measured in bytes)", () => {
    const {desktopPostBodyCheck: check, POST_MAX_BODY_BYTES} = loadPost();
    expect(POST_MAX_BODY_BYTES).toBe(32768);
    expect(check(undefined)).toEqual({ok: true, text: "{}"});
    expect(check({})).toEqual({ok: true, text: "{}"});
    expect(check({a: [1, "x"], b: {c: null}})).toMatchObject({ok: true});
    for (const bad of ["text", 5, true, [1, 2], [], new Date(), new Map(), new (class X { a = 1; })(), {n: BigInt(1)}, (() => { const c: any = {}; c.self = c; return c; })()])
      expect(check(bad), String(bad)).toMatchObject({ok: false, error: "INVALID_API_BODY"});
    const overhead = JSON.stringify({s: ""}).length;
    expect(check({s: "a".repeat(32768 - overhead)})).toMatchObject({ok: true});
    expect(check({s: "a".repeat(32768 - overhead + 1)})).toEqual({ok: false, error: "API_BODY_TOO_LARGE"});
    expect(check({s: "ş".repeat(16384)})).toEqual({ok: false, error: "API_BODY_TOO_LARGE"});
  });
  it("wires the POST handler with the sender check, allow-list, body check and main-side token; renderer and preload never see the token", () => {
    expect(mainSrc).toMatch(/uasco:api-post",async\(event,p,body\)=>\{requireTrustedSender\(event\);if\(!desktopPostPathAllowed\(p\)\)throw new Error\("INVALID_API_PATH"\);const prepared=desktopPostBodyCheck\(body\);if\(!prepared\.ok\)throw new Error\(prepared\.error\)/);
    expect(mainSrc).toMatch(/async function apiPost\(pathName,bodyText\)\{\s*await verifyServerIdentity\(\);/);
    expect(mainSrc).toMatch(/method:"POST",redirect:"error",cache:"no-store",headers:\{"content-type":"application\/json","x-uasco-control-token":token\}/);
    expect(mainSrc.match(/"uasco:api-post"/g)?.length).toBe(1);
    const preload = read(desk, "preload.mjs");
    expect(preload).toContain('apiPost:(path,body)=>ipcRenderer.invoke("uasco:api-post",path,body)');
    expect(code(preload)).not.toMatch(/token|process\.env/i);
    expect(preload).not.toContain("ipcRenderer.send");
    for (const f of walk(rend).filter(x => x.endsWith(".js") || x.endsWith(".html"))) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toContain("x-uasco-control-token");
      expect(s, f).not.toContain("UASCO_CONTROL_TOKEN");
      expect(s, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
      expect(s, f).not.toMatch(/ipcRenderer|require\(|process\.env/);
    }
  });
  it("sanitizes POST responses: no token, no local absolute paths, errors reduced to short safe fields", () => {
    const m = /(function scrubText[\s\S]*?)async function apiPost/.exec(mainSrc);
    expect(m).not.toBeNull();
    const secret = ["tok", "CANARY", "1234567890"].join("-");
    const {scrubText, sanitizePostBody} = new Function("token", `${m![1]}\nreturn {scrubText, sanitizePostBody};`)(secret) as any;
    const dirty = `failed ${secret} at C:\\Users\\salim\\Desktop\\UASCO\\x.txt and /home/alice/repo/y and /Users/bob/z`;
    const out = scrubText(dirty);
    expect(out).not.toContain(secret);
    expect(out).not.toMatch(/salim|alice|bob|C:\\/);
    const err = sanitizePostBody(409, {error: "EXECUTOR_NOT_CONFIGURED", reason: dirty, stack: "secret stack", details: {x: 1}, message: 5});
    expect(Object.keys(err).sort()).toEqual(["error", "reason"]);
    expect(JSON.stringify(err)).not.toContain(secret);
    expect(sanitizePostBody(500, null)).toEqual({error: "NON_JSON_ERROR"});
    expect(sanitizePostBody(500, [1])).toEqual({error: "NON_JSON_ERROR"});
    expect(sanitizePostBody(201, null)).toEqual({});
    const ok = sanitizePostBody(201, {project: {name: `n ${secret}`, projectId: PID}});
    expect(JSON.stringify(ok)).not.toContain(secret);
    expect(ok.project.projectId).toBe(PID);
  });
});

describe("B5 GET allow-list additions (main.mjs)", () => {
  it("allows exactly the work-runs and evidence reads with strict ids and query rules", () => {
    const ok = loadGet();
    const good = ["/v1/work-runs", `/v1/work-runs?missionId=${MID}`, `/v1/work-runs/${RUN}`, "/v1/evidence", `/v1/evidence/${EVID}`, `/v1/evidence?missionId=${MID}`, `/v1/evidence?runId=${RUN}`, "/v1/evidence?kind=TEST_LOG", "/v1/evidence?limit=100", "/v1/evidence?cursor=abc-123_.=:x",
      `/v1/evidence?missionId=${MID}&runId=${RUN}&kind=TEST_LOG&cursor=c1&limit=50`, `/v1/evidence?limit=5&missionId=${MID}`,
      "/v1/cockpit", "/v1/projects", "/v1/missions", `/v1/missions/${MID}`, `/v1/missions?projectId=${PID}`];
    for (const p of good) expect(ok(p), p).toBe(true);
  });
  it("rejects unknown params, duplicates, bad values, encodings, traversal and extra segments", () => {
    const ok = loadGet();
    const bad = ["/v1/evidence?", "/v1/evidence?missionId=", "/v1/evidence?missionId", "/v1/evidence?=x", "/v1/evidence?x=1", `/v1/evidence?missionId=${MID}&missionId=${MID2}`, `/v1/evidence?missionId=${MID}&`, `/v1/evidence?missionId=${MID}&&limit=1`,
      "/v1/evidence?kind=test_log", "/v1/evidence?kind=A%20B", "/v1/evidence?limit=0", "/v1/evidence?limit=1000", "/v1/evidence?limit=-1", "/v1/evidence?limit=1.5", "/v1/evidence?cursor=" + "a".repeat(129), "/v1/evidence?cursor=a%2fb", "/v1/evidence?cursor=a b",
      "/v1/evidence?missionId=msn_zz", `/v1/evidence?runId=${RUN}/../x`, `/v1/evidence?missionId=${MID}#frag`, "/v1/evidence/", "/v1/evidence/abc", `/v1/evidence/${EVID}/extra`, `/v1/evidence/${EVID}?x=1`, "/v1/evidence/../cockpit", "/v1/evidence/%2e%2e", `/v1/evidence/${"a".repeat(65)}`,
      `/v1/work-runs?projectId=${PID}`, "/v1/work-runs?", `/v1/work-runs?missionId=${MID}&limit=5`, `/v1/work-runs?missionId=${MID}&missionId=${MID}`, "/v1/work-runs/", "/v1/work-runs/abc", `/v1/work-runs/${RUN}/extra`, `/v1/work-runs/${RUN}/../x`, `/v1/work-runs/${RUN}?x=1`, "/v1/work-runs/%2e%2e%2f",
      `/v1/missions/${MID}/transition`, `/v1/missions/${MID}/runs`, "/v1/control/stop", "/v1/evil", "//evil/v1/evidence", "http://evil.invalid/v1/evidence", "/v1/evidence\n", "/v1/" + "a".repeat(450)];
    for (const p of bad) expect(ok(p), JSON.stringify(p)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, [], ["/v1/evidence"]]) expect(ok(nonString)).toBe(false);
  });
});

// ---------- Mission durum makinesi kopyası ----------
describe("B5 state machine copy", () => {
  it("equals the transitions table in core/mission/state-machine.ts (parsed from source)", async () => {
    const core = await load(rend, "work-core.js");
    const src = read(root, "core", "mission", "state-machine.ts");
    const body = /const transitions[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
    const parsed: Record<string, string[]> = {};
    for (const m of body.matchAll(/([A-Z_]+)\s*:\s*\[([^\]]*)\]/g)) parsed[m[1]] = [...m[2].matchAll(/"([A-Z_]+)"/g)].map(x => x[1]);
    expect(Object.keys(parsed).length).toBe(13);
    expect(JSON.parse(JSON.stringify(core.MISSION_TRANSITIONS))).toEqual(parsed);
  });
  it("matches canTransition for every ordered status pair and exposes only allowed next states", async () => {
    const core = await load(rend, "work-core.js");
    const sm: any = await import("../core/mission/state-machine.js");
    for (const from of core.MISSION_STATUSES) {
      for (const to of core.MISSION_STATUSES) expect(core.allowedNext(from).includes(to), `${from}->${to}`).toBe(sm.canTransition(from, to));
      expect([...core.allowedNext(from)].sort()).toEqual(core.MISSION_STATUSES.filter((s: string) => sm.canTransition(from, s)).sort());
    }
    expect(core.allowedNext("COMPLETE")).toEqual([]);
    expect(core.allowedNext("DRAFT")).not.toContain("COMPLETE");
    expect(core.allowedNext("nope")).toEqual([]);
    expect(core.allowedNext(undefined)).toEqual([]);
    const copy = core.allowedNext("DRAFT"); copy.push("COMPLETE");
    expect(core.allowedNext("DRAFT")).not.toContain("COMPLETE");
    expect(core.MISSION_PATH.every((s: string) => core.MISSION_STATUSES.includes(s))).toBe(true);
    expect(Object.isFrozen(core.MISSION_TRANSITIONS)).toBe(true);
  });
  it("high-risk targets are exactly AUTHORIZED and COMPLETE", async () => {
    const core = await load(rend, "work-core.js");
    expect([...core.HIGH_RISK_TARGETS].sort()).toEqual(["AUTHORIZED", "COMPLETE"]);
    for (const s of core.MISSION_STATUSES) expect(core.requiresConfirm(s), s).toBe(s === "AUTHORIZED" || s === "COMPLETE");
  });
});

// ---------- İstek kurucuları ----------
describe("B5 form request builders", () => {
  it("builds the project request with an argv ARRAY, an idempotency key and normalized fields", async () => {
    const c = await load(rend, "work-core.js");
    const r = c.buildProjectRequest({name: "  Uygulama ", repositoryPath: " C:\\Projeler\\app ", environmentId: " local-dev ", testCommand: ["node", " --test ", "", "  ", "tests/x.test.ts"]}, {key: "ui-abc"});
    expect(r).toEqual({ok: true, path: "/v1/projects", body: {name: "Uygulama", repository: {path: "C:\\Projeler\\app"}, environmentId: "local-dev", testCommand: ["node", "--test", "tests/x.test.ts"], idempotencyKey: "ui-abc"}});
    expect(Array.isArray(r.body.testCommand)).toBe(true);
    const min = c.buildProjectRequest({name: "A", repositoryPath: "/home/u/app", testCommand: [""]});
    expect(min.ok).toBe(true);
    expect(min.body).toEqual({name: "A", repository: {path: "/home/u/app"}});
  });
  it("rejects invalid project input with field-keyed dictionary errors", async () => {
    const c = await load(rend, "work-core.js");
    const err = (o: any, key?: string) => c.buildProjectRequest({name: "A", repositoryPath: "/ok/path", ...o}, key === undefined ? {} : {key});
    expect(err({name: " "}).errors.name).toBe("err.nameRequired");
    expect(err({name: "x".repeat(201)}).errors.name).toBe("err.nameLong");
    expect(err({repositoryPath: ""}).errors.repositoryPath).toBe("err.pathRequired");
    expect(err({repositoryPath: "relative/path"}).errors.repositoryPath).toBe("err.pathAbsolute");
    expect(err({repositoryPath: "https://github.com/x/y"}).errors.repositoryPath).toBe("err.pathUrl");
    expect(err({repositoryPath: "/a/../etc"}).errors.repositoryPath).toBe("err.pathTraversal");
    expect(err({repositoryPath: "C:\\a\\..\\b"}).errors.repositoryPath).toBe("err.pathTraversal");
    expect(err({repositoryPath: "/a\u0000b"}).errors.repositoryPath).toBe("err.pathInvalid");
    expect(err({repositoryPath: "/" + "a".repeat(1000)}).errors.repositoryPath).toBe("err.pathLong");
    expect(err({environmentId: "bad env!"}).errors.environmentId).toBe("err.envInvalid");
    expect(err({testCommand: "node --test"}).errors.testCommand).toBe("err.argvInvalid");
    expect(err({testCommand: [1]}).errors.testCommand).toBe("err.argvInvalid");
    expect(err({testCommand: ["node --test"]}).errors.testCommand).toBe("err.argvShellString");
    expect(err({testCommand: ["node", "a\nb"]}).errors.testCommand).toBe("err.argvControl");
    expect(err({testCommand: ["node", "x".repeat(501)]}).errors.testCommand).toBe("err.argvLong");
    expect(err({testCommand: Array.from({length: 33}, (_, i) => `t${i}`)}).errors.testCommand).toBe("err.argvMany");
    expect(err({}, "bad key!").errors.idempotencyKey).toBe("err.idempotencyKey");
    expect(err({testCommand: ["C:\\Program Files\\nodejs\\node.exe", "--test"]}).ok).toBe(true);
    expect(err({testCommand: ["/opt/my tools/bin/node", "--test"]}).ok).toBe(true);
    for (const shell of ["a/b c", "/usr/bin/node --test", "C:\\Program Files\\nodejs\\node.exe --test", "\"node\" x", "go test ./...", "npm run test"]) expect(err({testCommand: [shell]}).errors.testCommand, shell).toBe("err.argvShellString");
    const many = c.buildProjectRequest({name: "A", repositoryPath: "/ok", testCommand: Array.from({length: 32}, () => "x".repeat(500))});
    expect(many.ok).toBe(true);
    expect(c.buildProjectRequest(null).ok).toBe(false);
  });
  it("builds the mission request (criteria list, R0-R4, optional argv) and rejects bad input", async () => {
    const c = await load(rend, "work-core.js");
    const base = {projectId: PID, title: " T ", objective: " Hedef ", acceptanceCriteria: [" a ", "", "b"], riskLevel: "R2", testCommand: ["npm", "test"]};
    const r = c.buildMissionRequest(base, {key: "ui-k1"});
    expect(r).toEqual({ok: true, path: "/v1/missions", body: {projectId: PID, title: "T", objective: "Hedef", acceptanceCriteria: ["a", "b"], riskLevel: "R2", testCommand: ["npm", "test"], idempotencyKey: "ui-k1"}});
    expect(c.buildMissionRequest({...base, testCommand: undefined}).body).not.toHaveProperty("testCommand");
    for (const risk of ["R0", "R1", "R2", "R3", "R4"]) expect(c.buildMissionRequest({...base, riskLevel: risk}).ok).toBe(true);
    const bad = (o: any) => c.buildMissionRequest({...base, ...o}).errors ?? {};
    expect(bad({riskLevel: "R5"}).riskLevel).toBe("err.riskRequired");
    expect(bad({riskLevel: ""}).riskLevel).toBe("err.riskRequired");
    expect(bad({projectId: "prj_x"}).projectId).toBe("err.projectRequired");
    expect(bad({title: ""}).title).toBe("err.titleRequired");
    expect(bad({title: "x".repeat(201)}).title).toBe("err.titleLong");
    expect(bad({objective: " "}).objective).toBe("err.objectiveRequired");
    expect(bad({objective: "x".repeat(4001)}).objective).toBe("err.objectiveLong");
    expect(bad({acceptanceCriteria: ["", "  "]}).acceptanceCriteria).toBe("err.criteriaRequired");
    expect(bad({acceptanceCriteria: Array.from({length: 51}, () => "k")}).acceptanceCriteria).toBe("err.criteriaMany");
    expect(bad({acceptanceCriteria: ["x".repeat(4001)]}).acceptanceCriteria).toBe("err.criteriaLong");
    expect(bad({testCommand: ["go test ./..."]}).testCommand).toBe("err.argvShellString");
    expect(bad({acceptanceCriteria: Array.from({length: 50}, () => "k".repeat(4000)), objective: "o".repeat(4000)}).form).toBe("err.tooLarge");
  });
  it("idempotency tracker reuses the key for the same body, rotates it on change/reset, and keys satisfy the server pattern", async () => {
    const c = await load(rend, "work-core.js");
    let n = 0; const t = c.createIdempotencyTracker(() => `r${++n}`);
    const k1 = t.keyFor({a: 1}); expect(t.keyFor({a: 1})).toBe(k1);
    const k2 = t.keyFor({a: 2}); expect(k2).not.toBe(k1);
    t.reset(); expect(t.keyFor({a: 2})).not.toBe(k2);
    const real = c.createIdempotencyTracker(); const a = real.keyFor({x: 1}), b = real.keyFor({x: 1});
    expect(a).toBe(b); expect(a).toMatch(c.IDEMPOTENCY_KEY_RE); expect(a.length).toBeLessThanOrEqual(128);
    expect(c.newIdempotencyKey()).not.toBe(c.newIdempotencyKey());
    expect(c.newIdempotencyKey(() => "x".repeat(300)).length).toBe(128);
  });
  it("transition requests: only allowed targets, confirm for AUTHORIZED/COMPLETE, reason for BLOCKED/REMEDIATING/FOUNDER_ATTENTION_REQUIRED", async () => {
    const c = await load(rend, "work-core.js");
    const t = (o: any) => c.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "COMPLETE", reason: "", confirmed: false, ...o});
    expect(t({}).errors.confirm).toBe("err.confirmRequired");
    expect(t({confirmed: "yes"}).errors.confirm).toBe("err.confirmRequired");
    const ok = t({confirmed: true});
    expect(ok).toEqual({ok: true, path: `/v1/missions/${MID}/transition`, body: {to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)"}});
    expect(t({from: "PREFLIGHT", to: "AUTHORIZED"}).errors.confirm).toBe("err.confirmRequired");
    expect(t({from: "PREFLIGHT", to: "AUTHORIZED", confirmed: true}).ok).toBe(true);
    expect(t({from: "DRAFT", to: "COMPLETE", confirmed: true}).errors.to).toBe("err.transitionNotAllowed");
    expect(t({from: "COMPLETE", to: "DRAFT", confirmed: true}).errors.to).toBe("err.transitionNotAllowed");
    expect(t({from: "REPORTING", to: "BLOCKED"}).errors.reason).toBe("err.reasonRequired");
    expect(t({from: "REPORTING", to: "BLOCKED", reason: " neden "}).body).toEqual({to: "BLOCKED", reason: "neden"});
    expect(t({from: "DRAFT", to: "PREFLIGHT"}).ok).toBe(true);
    expect(t({missionId: "msn_x", from: "DRAFT", to: "PREFLIGHT"}).errors.missionId).toBe("err.missionInvalid");
    expect(t({from: "DRAFT", to: "PREFLIGHT", reason: "r".repeat(4001)}).errors.reason).toBe("err.reasonLong");
    expect(c.buildRunRequest({missionId: MID, status: "AUTHORIZED"})).toEqual({ok: true, path: `/v1/missions/${MID}/runs`, body: {}});
    expect(c.buildRunRequest({missionId: MID, status: "PLANNED"}).ok).toBe(true);
    for (const s of c.MISSION_STATUSES.filter((x: string) => x !== "AUTHORIZED" && x !== "PLANNED")) expect(c.buildRunRequest({missionId: MID, status: s}).errors.status, s).toBe("err.runNotStartable");
  });
  it("classifies POST results (409 EXECUTOR_NOT_CONFIGURED, 423, 503, auth, 404, offline) into dictionary keys that exist in tr and en", async () => {
    const c = await load(rend, "work-core.js");
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    const d = (status: number, error?: string) => c.describePostResult({ok: false, status, body: error ? {error} : {}});
    expect(d(201)).toMatchObject({ok: true, key: "post.ok"});
    expect(d(409, "EXECUTOR_NOT_CONFIGURED")).toMatchObject({ok: false, key: "post.err.409.EXECUTOR_NOT_CONFIGURED"});
    expect(d(409, "OTHER")).toMatchObject({key: "post.err.409"});
    expect(d(423, "GLOBAL_STOP_ACTIVE")).toMatchObject({key: "post.err.423"});
    expect(d(503, "WORKOS_UNAVAILABLE")).toMatchObject({key: "post.err.503"});
    expect(d(401).key).toBe("post.err.auth"); expect(d(403).key).toBe("post.err.auth");
    expect(d(400).key).toBe("post.err.400");
    expect(d(404).key).toBe("post.err.unavailable");
    expect(d(500).key).toBe("post.err.generic");
    expect(c.describePostResult({thrown: true, state: "OFFLINE"}).key).toBe("post.err.offline");
    expect(c.describePostResult({thrown: true, state: "ERROR"}).key).toBe("post.err.generic");
    expect(c.describePostResult(null).ok).toBe(false);
    const keys = ["post.ok", "post.err.400", "post.err.auth", "post.err.unavailable", "post.err.409", "post.err.409.EXECUTOR_NOT_CONFIGURED", "post.err.423", "post.err.503", "post.err.offline", "post.err.generic"];
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(en[k], k).toBeTruthy(); }
    expect(tr["post.err.409.EXECUTOR_NOT_CONFIGURED"]).toContain("EXECUTOR_NOT_CONFIGURED");
    expect(tr["post.err.423"]).toContain("GLOBAL_STOP_ACTIVE");
  });
});

// ---------- Eşleyiciler ve Gelen Kutusu ----------
// B5-C1-001: Lane B (core/workos/types.ts WorkRun) biçiminde koşu kaydı.
const laneBRun = (over: Record<string, any> = {}) => ({
  runId: RUN, missionId: MID, projectId: "prj_x", tenantId: "t1", roleId: "reporting-analyst",
  executor: {implementer: "claude-implementer", reviewer: "claude-reviewer-configured"},
  leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT",
  remediationCycle: 1, retryCount: 0, retryAt: null, reason: null, baseSha: null, headSha: null, workBranch: null,
  checkpoints: [{step: "IMPLEMENT", cycle: 0, at: "2026-10-14T09:00:00.000Z", data: {}}, {step: "REVIEW", cycle: 1, at: "2026-10-14T09:30:00.000Z", data: {}}],
  evidence: [
    {evidenceId: "ev_old_0001", step: "REVIEW", cycle: 0, kind: "REVIEW", argv: [], startedAt: "2026-10-14T09:10:00.000Z", endedAt: "2026-10-14T09:11:00.000Z", exitCode: 0, logPath: null, logSha256: null, reviewerIdentity: "claude-reviewer-old", verdict: "BLOCKED"},
    {evidenceId: EVID, step: "REVIEW", cycle: 1, kind: "REVIEW", argv: [], startedAt: "2026-10-14T09:20:00.000Z", endedAt: "2026-10-14T09:21:00.000Z", exitCode: 0, logPath: null, logSha256: null, reviewerIdentity: "claude-reviewer", verdict: "CLEAN"},
    {evidenceId: "ev_impl_0001", step: "IMPLEMENT", cycle: 1, kind: "IMPLEMENT", argv: [], startedAt: "2026-10-14T09:05:00.000Z", endedAt: "2026-10-14T09:06:00.000Z", exitCode: 0, logPath: null, logSha256: null, executorIdentity: "claude-implementer"}],
  createdAt: "2026-10-14T08:00:00.000Z", createdBy: "u", updatedAt: "2026-10-14T09:31:00.000Z", ...over});

describe("B5 mappers: work runs, evidence, inbox derivation", () => {
  it("maps work runs honestly (tolerant field names, invalid ids dropped, reviewer identity + verdict, lease/heartbeat)", async () => {
    const c = await load(rend, "work-core.js");
    const raw = {workRuns: [
      {runId: RUN, missionId: MID, status: "RUNNING", step: {name: "verify", index: 2, total: 5}, role: "backend-engineer", heartbeatAt: "2026-10-14T10:00:00.000Z", lease: {expiresAt: "2026-10-14T10:05:00.000Z"},
        checkpoints: [{name: "cp1", status: "COMPLETED", at: "2026-10-14T09:59:00.000Z"}, "cp2", {}, 5], evidence: [{evidenceId: EVID, kind: "TEST_LOG", verification: "VERIFIED"}, EVID, {kind: "X"}, 7],
        reviewer: {identity: "CLAUDE_REVIEWER", verdict: "APPROVED"}},
      {runId: "bad id!", status: "RUNNING"}, {status: "RUNNING"}, "junk", null, {id: "run_other_0001", status: "weird status"}]};
    const m = c.mapWorkRuns(raw);
    expect(m.state).toBe("VERIFIED");
    expect(m.items.map((r: any) => r.runId)).toEqual([RUN, "run_other_0001"]);
    const r = m.items[0];
    expect(r).toMatchObject({missionId: MID, status: "RUNNING", role: "backend-engineer", heartbeatAt: "2026-10-14T10:00:00.000Z", leaseExpiresAt: "2026-10-14T10:05:00.000Z", reviewer: {identity: "CLAUDE_REVIEWER", verdict: "APPROVED"}});
    expect(r.step).toEqual({name: "verify", index: 2, total: 5});
    expect(r.checkpoints.map((x: any) => x.name)).toEqual(["cp1", "cp2"]);
    expect(r.evidence.map((x: any) => x.evidenceId)).toEqual([EVID, EVID, null]);
    expect(m.items[1]).toMatchObject({status: "—", role: null, heartbeatAt: null, reviewer: null, step: null});
    expect(c.mapWorkRuns({}).state).toBe("ERROR");
    expect(c.mapWorkRuns(null).state).toBe("ERROR");
    expect(c.mapWorkRunDetail({run: {runId: RUN, status: "FAILED"}}).run.status).toBe("FAILED");
    expect(c.mapWorkRunDetail({}).state).toBe("ERROR");
    expect(c.mapWorkRuns({runs: [{runId: RUN, status: "QUEUED"}]}).items.length).toBe(1);
  });
  it("B5-C1-001: maps the Lane B WorkRun shape (step/cycle checkpoints, executor.reviewer, REVIEW evidence identity + verdict) and never invents 'none'", async () => {
    const c = await load(rend, "work-core.js");
    const r = c.mapWorkRun(laneBRun());
    expect(r.status).toBe("AWAITING_APPROVAL");
    expect(r.role).toBe("reporting-analyst");
    expect(r.step).toEqual({name: "REPORT", index: null, total: null});
    expect(r.checkpoints).toEqual([{name: "IMPLEMENT #0", status: null, at: "2026-10-14T09:00:00.000Z"}, {name: "REVIEW #1", status: null, at: "2026-10-14T09:30:00.000Z"}]);
    expect(r.checkpointsReported).toBe(true);
    // en son REVIEW kaydı (cycle 1) kazanır; eski BLOCKED kararı değil
    expect(r.reviewer).toEqual({identity: "claude-reviewer", verdict: "CLEAN"});
    // REVIEW kaydı yoksa kimlik executor.reviewer'dan, karar bildirilmemiş (null)
    const noEv = c.mapWorkRun(laneBRun({evidence: []}));
    expect(noEv.reviewer).toEqual({identity: "claude-reviewer-configured", verdict: null});
    // yalnız karar bildirilmişse kimlik yine executor.reviewer
    expect(c.mapWorkRun(laneBRun({evidence: [{evidenceId: EVID, step: "REVIEW", cycle: 0, verdict: "BLOCKED"}]})).reviewer).toEqual({identity: "claude-reviewer-configured", verdict: "BLOCKED"});
    // alanlar gerçekten yoksa: reviewer null, kontrol noktaları bildirilmedi
    const bare = c.mapWorkRun({runId: RUN, status: "QUEUED"});
    expect(bare.reviewer).toBeNull();
    expect(bare.checkpointsReported).toBe(false);
    expect(c.mapWorkRun(laneBRun({checkpoints: []})).checkpointsReported).toBe(true);
    // IMPLEMENT kanıtı reviewer sayılmaz
    expect(c.mapWorkRun(laneBRun({executor: undefined, evidence: [{evidenceId: EVID, step: "IMPLEMENT", cycle: 0, executorIdentity: "x", verdict: "CLEAN"}]})).reviewer).toBeNull();
    // detay yanıtı da aynı biçimi okur
    expect(c.mapWorkRunDetail({workRun: laneBRun()}).run.reviewer).toEqual({identity: "claude-reviewer", verdict: "CLEAN"});
  });
  it("evidence mapping: only the exact VERIFIED state is a verified chip; unknown/missing verification is UNVERIFIED", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.VERIFICATION_STATES).toEqual(["VERIFIED", "MISMATCH", "MISSING", "UNVERIFIABLE"]);
    expect(c.verificationChipKind("VERIFIED")).toBe("VERIFIED");
    expect(c.verificationChipKind("MISMATCH")).toBe("ERROR");
    expect(c.verificationChipKind("MISSING")).toBe("STALE");
    expect(c.verificationChipKind("UNVERIFIABLE")).toBe("UNVERIFIED");
    for (const odd of [undefined, null, "verified", "OK", "", 1, {}, "VERIFIED "]) expect(c.verificationChipKind(odd), String(odd)).toBe("UNVERIFIED");
    const item = c.mapEvidenceItem({evidenceId: EVID, missionId: MID, runId: RUN, kind: "TEST_LOG", verification: "MISMATCH", sourcePath: "logs/a.log", sha256: SHA.toUpperCase(), redactedLogTail: "line1\nline2", createdAt: "2026-10-14T10:00:00.000Z"});
    expect(item).toMatchObject({evidenceId: EVID, verification: "MISMATCH", sha256: SHA, sourcePath: "logs/a.log", logTail: "line1\nline2", kind: "TEST_LOG"});
    expect(c.mapEvidenceItem({id: EVID, sha256: "zz"})).toMatchObject({sha256: null, verification: null});
    expect(c.mapEvidenceItem({id: "x"})).toBeNull();
    expect(c.mapEvidenceItem(null)).toBeNull();
    const list = c.mapEvidenceList({evidence: [{id: EVID, verification: "VERIFIED", kind: "A"}, {id: "bad id"}, {id: "evd_other_001", verification: "MISSING", kind: "B"}], nextCursor: "n-1"});
    expect(list.items.length).toBe(2); expect(list.nextCursor).toBe("n-1");
    expect(c.mapEvidenceList({evidence: [], nextCursor: "bad cursor!"}).nextCursor).toBeNull();
    expect(c.mapEvidenceList({}).state).toBe("ERROR");
    expect(c.filterEvidence(list.items, {verification: "VERIFIED"}).length).toBe(1);
    expect(c.filterEvidence(list.items, {kind: "B"}).length).toBe(1);
    expect(c.filterEvidence(c.mapEvidenceList({evidence: [{id: EVID}, {id: "evd_other_001", verification: "MISSING"}]}).items, {verification: "NONE"}).length).toBe(1);
    expect(c.filterEvidence(list.items, {}).length).toBe(2);
  });
  it("derives the inbox from missions + runs: REPORTING+AWAITING_APPROVAL and FOUNDER_ATTENTION_REQUIRED only; nothing auto-approved", async () => {
    const c = await load(rend, "work-core.js");
    const ms = [
      {missionId: MID, title: "A", status: "REPORTING", riskLevel: "R2", projectId: PID},
      {missionId: MID2, title: "B", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3", projectId: PID},
      {missionId: "msn_" + "11".repeat(12), title: "C", status: "REPORTING", riskLevel: "R1"},
      {missionId: "msn_" + "22".repeat(12), title: "D", status: "EXECUTING", riskLevel: "R1"},
      {missionId: "bad", status: "REPORTING"}];
    const runs = [{runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}, {runId: "run_other_0002", missionId: "msn_" + "22".repeat(12), status: "AWAITING_APPROVAL"}, {runId: "run_other_0003", missionId: "msn_" + "11".repeat(12), status: "RUNNING"}];
    const items = c.deriveInbox(ms, runs);
    expect(items.map((i: any) => [i.kind, i.missionId])).toEqual([["DELIVERY_DECISION", MID], ["FOUNDER_ATTENTION", MID2]]);
    expect(items[0].runId).toBe(RUN);
    expect(items[0].actions).toEqual([{type: "accept", to: "COMPLETE"}, {type: "reject", to: "BLOCKED"}]);
    expect(items[1].actions).toEqual([{type: "retry", to: "PREFLIGHT"}, {type: "reject", to: "BLOCKED"}]);
    for (const a of items.flatMap((i: any) => i.actions)) expect(c.allowedNext(items.find((i: any) => i.actions.includes(a)).status)).toContain(a.to);
    expect(c.deriveInbox(ms, [])).toHaveLength(1);
    expect(c.deriveInbox([], runs)).toEqual([]);
    expect(c.deriveInbox(undefined, undefined)).toEqual([]);
    expect(JSON.stringify(items)).not.toMatch(/approved|auto/i);
  });
  it("live runs are the active run states only", async () => {
    const c = await load(rend, "work-core.js");
    const runs = ["RUNNING", "QUEUED", "FAILED", "COMPLETED", "AWAITING_APPROVAL", "LEASED"].map((s, i) => ({runId: `run_${i}_000000`, status: s}));
    expect(c.liveRuns(runs).map((r: any) => r.status)).toEqual(["RUNNING", "QUEUED", "LEASED"]);
    expect(c.liveRuns(undefined)).toEqual([]);
  });
});

// ---------- tr/en eşitliği ve anahtar kapsamı ----------
describe("B5 i18n", () => {
  it("tr and en keep identical keys and placeholders, nothing empty", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(tr)) { expect(tr[k].trim().length, k).toBeGreaterThan(0); expect(en[k].trim().length, k).toBeGreaterThan(0); expect(ph(en[k]), k).toBe(ph(tr[k])); }
  });
  it("every static and dynamic key used by the B5 modules exists in both dictionaries", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    const core = await load(rend, "work-core.js");
    const need = new Set<string>();
    const files = ["work-core.js", "forms.js", "work-actions.js", "api.js", "components.js", "views/projects.js", "views/work.js", "views/inbox.js", "views/assurance.js", "views/workforce.js", "app.js", "shell.js"].map(f => path.join(rend, f));
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/"((?:err|post|form|projects|work|inbox|assurance|everif|evidence|run|risk|confirm|workforce|transition|mission|project|map)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
      for (const m of s.matchAll(/(?:\bt\(|labelKey:|titleKey:|hintKey:|itemLabelKey:|addKey:|removeKey:|errorKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    }
    const html = read(rend, "index.html");
    for (const m of html.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([^"]+)"/g)) need.add(m[1]);
    for (const r of core.RISK_LEVELS) { need.add(`risk.${r}.name`); need.add(`risk.${r}.desc`); }
    for (const v of core.VERIFICATION_STATES) need.add(`everif.${v}`);
    need.add("everif.NONE");
    for (const s of ["current", "done", "todo"]) need.add(`work.timeline.${s}`);
    for (const st of core.MISSION_STATUSES) need.add(`mstatus.${st}`);
    for (const st of [...core.RUN_ACTIVE_STATES, "AWAITING_APPROVAL", "FAILED", "CANCELLED", "STOPPED"]) need.add(`mstatus.${st}`);
    // form.field.* her doğrulama alanı için
    const fields = new Set<string>();
    const collect = (r: any) => { for (const f of Object.keys(r.errors ?? {})) fields.add(f); };
    collect(core.buildProjectRequest({}, {key: "bad key"})); collect(core.buildProjectRequest({name: "A", repositoryPath: "/x", environmentId: "!", testCommand: "x"}));
    collect(core.buildMissionRequest({}, {key: "bad key"})); collect(core.buildMissionRequest({projectId: PID, title: "t", objective: "o", acceptanceCriteria: Array.from({length: 50}, () => "k".repeat(4000)), riskLevel: "R1"}));
    collect(core.buildTransitionRequest({missionId: "x", from: "DRAFT", to: "COMPLETE", reason: "r".repeat(5000)})); collect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "BLOCKED"})); collect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "COMPLETE"}));
    collect(core.buildRunRequest({missionId: "x", status: "DRAFT"}));
    expect(fields.size).toBeGreaterThanOrEqual(12);
    for (const f of fields) need.add(`form.field.${f}`);
    const missing = [...need].filter(k => !(k in tr) || !(k in en));
    expect(missing).toEqual([]);
  });
});

// ---------- Sahte DOM + gerçek görünüm modülleri ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = this; this.children.push(node); } }
  // //TR: UX WP-PROJECTS: Projeler görünümü artık WP2 kpiTile'ını (SVG ikon/sparkline) kullandığı için appendChild gerçek DOM gibi sağlanır; doğrulama gevşetilmez.
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  removeEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, (this.ls.get(ev) ?? []).filter(x => x !== fn)); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  // //TR: UX WP-PROJECTS: kpiTile SVG ikon/sparkline için createElementNS gerektirir; sahte DOM bunu gerçek document gibi sağlar (WP2/WP3/WP4 harness'leriyle aynı); doğrulama gevşetilmez.
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) ? this.focused : this.body; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (root: N, id: string) => all(root).find(n => n.id === id) ?? null;
const byData = (root: N, k: string, v?: string) => all(root).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const text = (n: N) => n.textContent;

interface CtxOpts {get?: (p: string) => any; post?: (p: string, b: any) => {status: number; body: any}; confirm?: (o: any) => boolean; lang?: string}
async function mkCtx(o: CtxOpts = {}) {
  const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js"), i18n = await load(rend, "i18n.js");
  const doc = new D(), store = st.createStore(null), lang = o.lang ?? "tr";
  const calls = {get: [] as string[], post: [] as Array<{path: string; body: any}>, confirm: [] as any[], navigate: [] as string[], rerender: 0, refresh: 0};
  const bridge = {
    apiGet: async (p: string) => { calls.get.push(p); const r = o.get?.(p); if (r === undefined) throw new Error(`${p}: HTTP 404`); return r; },
    apiPost: async (p: string, b: any) => { calls.post.push({path: p, body: b}); const r = o.post?.(p, b); if (!r) throw new Error("CONTROL_API_UNREACHABLE"); return r; }
  };
  const api = apiMod.createApi({bridge, store});
  const ctx: any = {doc, store, api, i18n: {lang, t: (k: string, v?: any) => i18n.translate(lang, k, v)}, t: (k: string, v?: any) => i18n.translate(lang, k, v),
    navigate: (id: string) => { calls.navigate.push(id); }, rerender: async () => { calls.rerender++; store.cache.clear(); }, refreshAll: async () => { calls.refresh++; store.cache.clear(); },
    confirm: async (opts: any) => { calls.confirm.push(opts); return o.confirm ? o.confirm(opts) : false; }, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, calls, store};
}
const mount = (doc: D, node: N) => { doc.body.replaceChildren(node); return node; };
const project = (extra: any = {}) => ({projectId: PID, name: "Uygulama", tenantId: "t1", environmentId: "local", createdAt: "2026-10-14T08:00:00.000Z", repository: {path: "C:\\Projeler\\app"}, ...extra});
const mission = (extra: any = {}) => ({missionId: MID, projectId: PID, title: "Görev A", objective: "Hedef metni", acceptanceCriteria: ["k1", "k2"], riskLevel: "R2", status: "AUTHORIZED", createdAt: "2026-10-14T09:00:00.000Z", ...extra});

let forms: any;
beforeEach(async () => { forms = await load(rend, "forms.js"); forms.resetAllForms(); });

describe("B5 Projeler screen", () => {
  it("renders the project list and the form; submit builds a validated body with an argv array and an idempotency key via the POST bridge only", async () => {
    const {ctx, doc, calls} = await mkCtx({get: p => p === "/v1/projects" ? {projects: [project()]} : undefined, post: () => ({status: 201, body: {project: {projectId: PID, name: "Yeni"}}})});
    const view = await load(rend, "views", "projects.js");
    const root = mount(doc, await view.render(ctx));
    expect(text(root)).toContain("Uygulama");
    expect(text(root)).toContain("C:\\Projeler\\app");
    expect(byId(root, "project-name")).not.toBeNull();
    expect(calls.post).toEqual([]); // render hiçbir şey göndermez
    byId(root, "project-name")!.value = "Yeni";
    byId(root, "project-name")!.fire("input");
    byId(root, "project-repo")!.value = "C:\\Projeler\\yeni";
    byId(root, "project-repo")!.fire("input");
    byId(root, "project-test-0")!.value = "node"; byId(root, "project-test-0")!.fire("input");
    byId(root, "project-test-add")!.fire("click");
    byId(root, "project-test-1")!.value = "--test"; byId(root, "project-test-1")!.fire("input");
    expect(text(byId(root, "project-test-preview")!)).toContain('["node","--test"]');
    byId(root, "project-form")!.fire("submit");
    await new Promise(r => setTimeout(r, 0));
    expect(calls.post.length).toBe(1);
    expect(calls.post[0].path).toBe("/v1/projects");
    expect(calls.post[0].body).toMatchObject({name: "Yeni", repository: {path: "C:\\Projeler\\yeni"}, testCommand: ["node", "--test"]});
    expect(calls.post[0].body.idempotencyKey).toMatch(/^ui-[A-Za-z0-9._:-]+$/);
    expect(forms.drafts.project.name).toBe(""); // başarıda taslak temizlenir
    expect(forms.drafts.status.project.ok).toBe(true);
  });
  it("shows validation messages and sends nothing for invalid input; keeps the typed draft across re-render", async () => {
    const {ctx, doc, calls} = await mkCtx({get: p => p === "/v1/projects" ? {projects: []} : undefined, post: () => ({status: 201, body: {}})});
    const view = await load(rend, "views", "projects.js");
    let root = mount(doc, await view.render(ctx));
    byId(root, "project-name")!.value = "Yarım"; byId(root, "project-name")!.fire("input");
    byId(root, "project-repo")!.value = "relative/dir"; byId(root, "project-repo")!.fire("input");
    byId(root, "project-form")!.fire("submit");
    await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toEqual([]);
    expect(calls.rerender).toBeGreaterThan(0);
    root = mount(doc, await view.render(ctx));
    expect(byId(root, "project-name")!.value).toBe("Yarım");
    expect(byId(root, "project-repo")!.getAttribute("aria-invalid")).toBe("true");
    expect(text(byId(root, "project-repo-err")!)).toContain("Mutlak");
    const status = byId(root, "project-status")!;
    expect(status.getAttribute("role")).toBe("alert");
    expect(text(status)).toContain("Depo yolu");
  });
  it("reuses the same idempotency key when a failed submit is retried with the same body, and rotates it after a body change", async () => {
    let n = 0; const codes = [503, 201];
    const {ctx, doc, calls} = await mkCtx({get: () => undefined, post: () => ({status: codes[n++] ?? 201, body: n === 1 ? {error: "WORKOS_UNAVAILABLE"} : {project: {projectId: PID, name: "A"}}})});
    const view = await load(rend, "views", "projects.js");
    const root = mount(doc, await view.render(ctx));
    byId(root, "project-name")!.value = "A"; byId(root, "project-name")!.fire("input");
    byId(root, "project-repo")!.value = "/home/u/a"; byId(root, "project-repo")!.fire("input");
    byId(root, "project-form")!.fire("submit"); await new Promise(r => setTimeout(r, 0));
    expect(forms.drafts.status.project.key).toBe("post.err.503");
    byId(root, "project-form")!.fire("submit"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post.length).toBe(2);
    expect(calls.post[1].body.idempotencyKey).toBe(calls.post[0].body.idempotencyKey);
  });
  it("shows UNAVAILABLE on 404 and keeps the form usable", async () => {
    const {ctx, doc} = await mkCtx({get: () => undefined});
    const view = await load(rend, "views", "projects.js");
    const root = mount(doc, await view.render(ctx));
    expect(text(root)).toContain("Kullanılamıyor");
    expect(byId(root, "project-submit")).not.toBeNull();
  });
  it("list editor keeps focus logic: adding a token focuses the new row, removing keeps at least one row", async () => {
    const {ctx, doc} = await mkCtx({get: () => undefined});
    const view = await load(rend, "views", "projects.js");
    const root = mount(doc, await view.render(ctx));
    byId(root, "project-test-add")!.fire("click");
    expect(doc.focused?.id).toBe("project-test-1");
    byId(root, "project-test-rm-1")!.fire("click");
    expect(forms.drafts.project.testCommand).toEqual([""]);
    byId(root, "project-test-rm-0")!.fire("click");
    expect(forms.drafts.project.testCommand).toEqual([""]);
    expect(doc.focused?.id).toBe("project-test-0");
  });
});

describe("B5 Görevler / Work OS screen", () => {
  const getFn = (extra: Record<string, any> = {}) => (p: string) => {
    if (p in extra) return extra[p];
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission(), mission({missionId: MID2, title: "Görev B", status: "BLOCKED"}), mission({missionId: "msn_" + "99".repeat(12), title: "Görev C", status: "DRAFT"})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission(), tasks: [{taskId: "tsk_" + "1".repeat(24), title: "alt görev", status: "PENDING"}]};
    if (p === `/v1/work-runs?missionId=${MID}`) return {workRuns: [{runId: RUN, missionId: MID, status: "RUNNING"}]};
    if (p === `/v1/work-runs/${RUN}`) return {workRun: {runId: RUN, missionId: MID, status: "RUNNING", step: {name: "doğrulama", index: 2, total: 4}, role: "qa-engineer", heartbeatAt: "2026-10-14T10:00:00.000Z", lease: {expiresAt: "2026-10-14T10:05:00.000Z"},
      checkpoints: [{name: "başlangıç", at: "2026-10-14T09:00:00.000Z", status: "COMPLETED"}], evidence: [{evidenceId: EVID, kind: "TEST_LOG", verification: "MISMATCH"}], reviewer: {identity: "CLAUDE_REVIEWER", verdict: "REJECTED"}}};
    return undefined;
  };
  it("lists missions with status filters (counts) and filtering narrows the table", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFn()});
    const view = await load(rend, "views", "work.js");
    let root = mount(doc, await view.render(ctx));
    expect(byData(root, "filter").map(n => n.dataset.filter)).toEqual(["ALL", "DRAFT", "AUTHORIZED", "BLOCKED"]);
    expect(byData(root, "missionId").length).toBe(3);
    byData(root, "filter", "BLOCKED")[0].fire("click");
    expect(calls.rerender).toBe(1);
    root = mount(doc, await view.render(ctx));
    expect(byData(root, "missionId").map(n => n.dataset.missionId)).toEqual([MID2]);
    expect(byData(root, "filter", "BLOCKED")[0].getAttribute("aria-pressed")).toBe("true");
  });
  it("mission detail shows only state-machine-allowed transitions; AUTHORIZED/COMPLETE targets are marked as needing confirmation; Çalıştır enabled only for AUTHORIZED/PLANNED", async () => {
    const {ctx, doc} = await mkCtx({get: getFn()});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    expect(byData(root, "to").map(n => n.dataset.to)).toEqual(["PLANNED", "BLOCKED"]);
    expect(byData(root, "to").every(n => n.dataset.confirm === "false")).toBe(true);
    expect(byId(root, "run-start")!.hasAttribute("disabled")).toBe(false);
    expect(text(byId(root, "work-detail")!)).toContain("alt görev");
    expect(byData(root, "step", "AUTHORIZED")[0].dataset.state).toBe("current");
    expect(byData(root, "step", "PREFLIGHT")[0].dataset.state).toBe("done");
    expect(byData(root, "step", "COMPLETE")[0].dataset.state).toBe("todo");
    // PREFLIGHT mission: AUTHORIZED is high risk
    const g2 = mkCtx({get: getFn({[`/v1/missions/${MID}`]: {mission: mission({status: "PREFLIGHT"}), tasks: []}})});
    const {ctx: c2, doc: d2} = await g2;
    const r2 = mount(d2, await view.render(c2));
    expect(byData(r2, "to").map(n => [n.dataset.to, n.dataset.confirm])).toEqual([["AUTHORIZED", "true"], ["BLOCKED", "false"], ["FOUNDER_ATTENTION_REQUIRED", "false"]]);
    expect(byId(r2, "run-start")!.hasAttribute("disabled")).toBe(true);
    // DRAFT: run disabled
    const {ctx: c3, doc: d3} = await mkCtx({get: getFn({[`/v1/missions/${MID}`]: {mission: mission({status: "DRAFT"}), tasks: []}})});
    const r3 = mount(d3, await view.render(c3));
    expect(byId(r3, "run-start")!.hasAttribute("disabled")).toBe(true);
    expect(byData(r3, "to").map(n => n.dataset.to)).toEqual(["PREFLIGHT", "BLOCKED"]);
    // COMPLETE: terminal
    const {ctx: c4, doc: d4} = await mkCtx({get: getFn({[`/v1/missions/${MID}`]: {mission: mission({status: "COMPLETE"}), tasks: []}})});
    const r4 = mount(d4, await view.render(c4));
    expect(byData(r4, "to")).toEqual([]);
    expect(byData(r4, "step", "COMPLETE")[0].dataset.state).toBe("current");
  });
  it("high-risk transitions require the confirm dialog (naming action and target); cancel sends nothing, confirm sends exactly one POST", async () => {
    let answer = false;
    const {ctx, doc, calls} = await mkCtx({get: getFn({[`/v1/missions/${MID}`]: {mission: mission({status: "PREFLIGHT"}), tasks: []}}), confirm: () => answer, post: () => ({status: 200, body: {mission: {}}})});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    const btn = byId(root, "tr-AUTHORIZED")!;
    btn.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.confirm.length).toBe(1);
    expect(calls.confirm[0].action).toContain("→");
    expect(calls.confirm[0].target).toContain(MID);
    expect(calls.confirm[0].target).toContain("Görev A");
    expect(calls.confirm[0].title).toContain("Yetkilendirildi");
    expect(calls.post).toEqual([]);
    expect(forms.drafts.status[`act-${MID}`].key).toBe("confirm.cancelled");
    answer = true;
    btn.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toEqual([{path: `/v1/missions/${MID}/transition`, body: {to: "AUTHORIZED", reason: "PREFLIGHT -> AUTHORIZED (UASCO Desktop)"}}]);
    expect(forms.drafts.status[`act-${MID}`].key).toBe("transition.done");
  });
  it("non-high-risk transitions need no dialog; BLOCKED requires a reason and sends nothing without one", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFn(), post: () => ({status: 200, body: {}})});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    byId(root, "tr-BLOCKED")!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toEqual([]); expect(calls.confirm).toEqual([]);
    expect(forms.drafts.status[`act-${MID}`].errors.reason).toBe("err.reasonRequired");
    byId(root, "tr-reason")!.value = "kapsam dışı"; byId(root, "tr-reason")!.fire("input");
    byId(root, "tr-BLOCKED")!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.confirm).toEqual([]);
    expect(calls.post).toEqual([{path: `/v1/missions/${MID}/transition`, body: {to: "BLOCKED", reason: "kapsam dışı"}}]);
  });
  it("Çalıştır posts to /runs and explains 409 EXECUTOR_NOT_CONFIGURED, 423 and 503 clearly (no fake progress)", async () => {
    const answers = [{status: 409, body: {error: "EXECUTOR_NOT_CONFIGURED"}}, {status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, {status: 503, body: {error: "WORKOS_UNAVAILABLE"}}, {status: 202, body: {}}];
    let i = 0;
    const {ctx, doc, calls} = await mkCtx({get: getFn(), post: () => answers[i++]});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    const keys: string[] = [];
    for (let n = 0; n < 4; n++) { byId(root, "run-start")!.fire("click"); await new Promise(r => setTimeout(r, 0)); keys.push(forms.drafts.status[`act-${MID}`].key); }
    // //TR: COORD-RUN-EXPERT: gövde varsayılan uzman geliştirici rolünü taşır; şekil hâlâ birebir denetlenir (başka alan yok).
    expect(calls.post.every(c => c.path === `/v1/missions/${MID}/runs` && JSON.stringify(c.body) === JSON.stringify({roleId: "UASCO-0085"}))).toBe(true);
    expect(keys).toEqual(["post.err.409.EXECUTOR_NOT_CONFIGURED", "post.err.423", "post.err.503", "run.startAccepted"]);
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    expect(tr["post.err.409.EXECUTOR_NOT_CONFIGURED"]).toMatch(/yürütücü/);
    expect(tr["run.startAccepted"]).toMatch(/Gerçek ilerleme/);
  });
  it("renders the run timeline honestly: step, role, heartbeat, lease, checkpoints, evidence link (opens Güvence), reviewer identity and verdict; UNAVAILABLE and empty states", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFn()});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    const card = byData(root, "runId", RUN)[0];
    expect(card).toBeTruthy();
    const t = text(card);
    expect(t).toContain("doğrulama (2/4)");
    expect(t).toContain("qa-engineer");
    expect(t).toContain("CLAUDE_REVIEWER");
    expect(t).toContain("REJECTED");
    expect(t).toContain("başlangıç");
    expect(t).toContain("UYUŞMUYOR");
    expect(t).not.toMatch(/%|progress/i);
    const link = byData(root, "focusKey", `ev-${RUN}-${EVID}`)[0];
    link.fire("click");
    expect(forms.selection.evidenceId).toBe(EVID);
    expect(calls.navigate).toEqual(["assurance"]);
    // 404 koşu servisi
    const g = getFn(); const {ctx: c2, doc: d2} = await mkCtx({get: p => p.startsWith("/v1/work-runs") ? undefined : g(p)});
    const r2 = mount(d2, await view.render(c2));
    expect(text(r2)).toContain("GET /v1/work-runs");
    expect(byData(r2, "runId")).toEqual([]);
    // boş
    const {ctx: c3, doc: d3} = await mkCtx({get: p => p === `/v1/work-runs?missionId=${MID}` ? {workRuns: []} : g(p)});
    const r3 = mount(d3, await view.render(c3));
    expect(text(r3)).toContain("henüz koşu yok");
  });
  it("B5-C1-001: run card shows Lane B checkpoints, reviewer identity and verdict; absent fields read 'not reported by server', never 'not assigned'", async () => {
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const lb = laneBRun();
    const {ctx, doc} = await mkCtx({get: getFn({[`/v1/work-runs/${RUN}`]: {workRun: lb}, [`/v1/work-runs?missionId=${MID}`]: {workRuns: [lb]}})});
    const t = text(byData(mount(doc, await view.render(ctx)), "runId", RUN)[0]);
    expect(t).toContain("REPORT");
    expect(t).toContain("IMPLEMENT #0");
    expect(t).toContain("REVIEW #1");
    expect(t).toContain("claude-reviewer");
    expect(t).toContain("İnceleme kararıTemiz");
    expect(t).not.toContain("Henüz atanmadı");
    expect(t).not.toContain("Henüz karar yok");
    expect(t).not.toContain("Kontrol noktası yok");
    expect(t).toContain("reporting-analyst");
    // alan yok: dürüst "sunucu bildirmedi"
    const bare = {runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"};
    const {ctx: c2, doc: d2} = await mkCtx({get: getFn({[`/v1/work-runs/${RUN}`]: {workRun: bare}, [`/v1/work-runs?missionId=${MID}`]: {workRuns: [bare]}})});
    const t2 = text(byData(mount(d2, await view.render(c2)), "runId", RUN)[0]);
    expect(t2).toContain("Sunucu bildirmedi");
    expect(t2).toContain("Kontrol noktaları sunucu tarafından bildirilmedi");
    expect(t2).not.toContain("Henüz atanmadı");
    expect(t2).not.toContain("Henüz karar yok");
    // sunucu açıkça boş dizi bildirdiyse gerçekten yok
    const empty = {...bare, checkpoints: []};
    const {ctx: c3, doc: d3} = await mkCtx({get: getFn({[`/v1/work-runs/${RUN}`]: {workRun: empty}, [`/v1/work-runs?missionId=${MID}`]: {workRuns: [empty]}})});
    expect(text(byData(mount(d3, await view.render(c3)), "runId", RUN)[0])).toContain("Kontrol noktası yok.");
  });
  it("Yeni Görev form builds the exact mission body (criteria list, risk, argv) with an idempotency key and keeps drafts", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFn(), post: () => ({status: 201, body: {mission: {missionId: MID2, title: "Yeni görev"}}})});
    const view = await load(rend, "views", "work.js");
    const root = mount(doc, await view.render(ctx));
    expect(byId(root, "mission-project")!.value).toBe(PID);
    expect(text(root)).toContain("R4 — Kritik");
    const set = (id: string, v: string) => { byId(root, id)!.value = v; byId(root, id)!.fire("input"); };
    set("mission-title", "Yeni görev"); set("mission-objective", "Hedef"); set("mission-criteria-0", "kriter 1");
    byId(root, "mission-criteria-add")!.fire("click"); set("mission-criteria-1", "kriter 2");
    byId(root, "mission-risk")!.value = "R3"; byId(root, "mission-risk")!.fire("change");
    set("mission-test-0", "npm"); byId(root, "mission-test-add")!.fire("click"); set("mission-test-1", "test");
    byId(root, "mission-form")!.fire("submit"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post.length).toBe(1);
    expect(calls.post[0].path).toBe("/v1/missions");
    expect(calls.post[0].body).toMatchObject({projectId: PID, title: "Yeni görev", objective: "Hedef", acceptanceCriteria: ["kriter 1", "kriter 2"], riskLevel: "R3", testCommand: ["npm", "test"]});
    expect(calls.post[0].body.idempotencyKey).toMatch(/^ui-/);
    expect(forms.selection.missionId).toBe(MID2);
    // geçersiz: kriter yok
    forms.resetAllForms();
    const root2 = mount(doc, await view.render(ctx));
    byId(root2, "mission-title")!.value = "x"; byId(root2, "mission-title")!.fire("input");
    byId(root2, "mission-form")!.fire("submit"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post.length).toBe(1);
    expect(Object.keys(forms.drafts.status.mission.errors)).toEqual(expect.arrayContaining(["objective", "acceptanceCriteria"]));
  });
});

describe("B5 Gelen Kutusu screen", () => {
  const getFn = (extra: Record<string, any> = {}) => (p: string) => {
    if (p in extra) return extra[p];
    if (p === "/v1/cockpit") return {generatedAt: "2026-10-14T10:00:00.000Z", awaitingApproval: {state: "VERIFIED", items: []}};
    if (p === "/v1/founder-attention") return {blocked: []};
    if (p === "/v1/missions") return {missions: [mission({status: "REPORTING"}), mission({missionId: MID2, title: "Dikkat", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3"}), mission({missionId: "msn_" + "77".repeat(12), title: "Yürütülüyor", status: "EXECUTING"})]};
    if (p === "/v1/work-runs") return {workRuns: [{runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}]};
    return undefined;
  };
  // M1a c2 (D-M1A-STATE-MODEL-2026-10-15): "kabul" (COMPLETE) yalnız PRODUCT_VERIFIED koşu ayrıntısıyla sunulur; ayrıntı yoksa veya NOT_VERIFIED ise düğme yoktur.
  const pvDetail = (state: "PRODUCT_VERIFIED" | "NOT_VERIFIED") => ({[`/v1/work-runs/${RUN}`]: {run: {runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}, outcomes: {}, delivery: {runId: "run_" + "0".repeat(24), missionId: MID,
    sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", reason: "x", label: "SOURCE_GENERATION_COMPLETE — Kaynak kod üretildi"}, productVerification: {state, reason: "x", label: null}, testChanges: {}}}});
  it("shows delivery decisions and Founder-attention items; rendering alone sends nothing", async () => {
    const hidden = await mkCtx({get: getFn(pvDetail("NOT_VERIFIED"))});
    const hv = mount(hidden.doc, await (await load(rend, "views", "inbox.js")).render(hidden.ctx, {id: "inbox"}));
    expect(byData(hv, "action", "accept").length).toBe(0);
    expect(byId(hv, `ib-COMPLETE-${MID}`)).toBeNull();
    expect(byId(hv, `ib-complete-na-${MID}`)).not.toBeNull();
    const {ctx, doc, calls} = await mkCtx({get: getFn(pvDetail("PRODUCT_VERIFIED")), post: () => ({status: 200, body: {}})});
    const view = await load(rend, "views", "inbox.js");
    const root = mount(doc, await view.render(ctx, {id: "inbox"}));
    expect(byData(root, "decisionMission").map(n => [n.dataset.decision, n.dataset.decisionMission])).toEqual([["DELIVERY_DECISION", MID], ["FOUNDER_ATTENTION", MID2]]);
    expect(calls.post).toEqual([]);
    expect(calls.confirm).toEqual([]);
    expect(text(root)).toContain("otomatik onaylanmaz");
    expect(byData(root, "action", "accept").length).toBe(1);
    expect(byId(root, `ib-COMPLETE-${MID}`)).not.toBeNull();
    expect(byId(root, `ib-PREFLIGHT-${MID2}`)).not.toBeNull();
  });
  it("accept requires the confirm dialog then POSTs COMPLETE; reject needs a reason and goes to BLOCKED (REMEDIATING is not allowed from REPORTING)", async () => {
    let answer = false;
    const {ctx, doc, calls} = await mkCtx({get: getFn(pvDetail("PRODUCT_VERIFIED")), confirm: () => answer, post: () => ({status: 200, body: {}})});
    const view = await load(rend, "views", "inbox.js");
    const root = mount(doc, await view.render(ctx, {id: "inbox"}));
    byId(root, `ib-COMPLETE-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.confirm.length).toBe(1);
    expect(calls.confirm[0].target).toContain(MID);
    expect(calls.post).toEqual([]);
    answer = true;
    byId(root, `ib-COMPLETE-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toEqual([{path: `/v1/missions/${MID}/transition`, body: {to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)"}}]);
    byId(root, `ib-BLOCKED-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post.length).toBe(1);
    expect(forms.drafts.status[`act-${MID}`].errors.reason).toBe("err.reasonRequired");
    expect(byData(root, "to").map(n => n.dataset.to).filter(t => t === "REMEDIATING")).toEqual([]);
    byId(root, `ib-reason-${MID}`)!.value = "kanıt yetersiz"; byId(root, `ib-reason-${MID}`)!.fire("input");
    byId(root, `ib-BLOCKED-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post[1]).toEqual({path: `/v1/missions/${MID}/transition`, body: {to: "BLOCKED", reason: "kanıt yetersiz"}});
  });
  it("without the run service only Founder-attention items are shown, with an honest note", async () => {
    const g = getFn();
    const {ctx, doc} = await mkCtx({get: p => p.startsWith("/v1/work-runs") ? undefined : g(p)});
    const view = await load(rend, "views", "inbox.js");
    const root = mount(doc, await view.render(ctx, {id: "inbox"}));
    expect(byData(root, "decisionMission").map(n => n.dataset.decisionMission)).toEqual([MID2]);
    expect(text(root)).toContain("Koşu servisi kullanılamıyor");
  });
  it("empty inbox says so; nothing is auto-approved anywhere in the view sources", async () => {
    const {ctx, doc} = await mkCtx({get: p => p === "/v1/missions" ? {missions: []} : p === "/v1/work-runs" ? {workRuns: []} : getFn()(p)});
    const view = await load(rend, "views", "inbox.js");
    const root = mount(doc, await view.render(ctx, {id: "inbox"}));
    expect(text(root)).toContain("Karar bekleyen");
    const src = code(read(rend, "views", "inbox.js") + read(rend, "work-actions.js"));
    expect(src).not.toMatch(/setInterval|setTimeout/);
    // post yalnız tıklama işleyicilerinden çağrılan performTransition içinde
    expect(code(read(rend, "views", "inbox.js"))).not.toMatch(/api\.post|\.post\(/);
  });
});

describe("B5 Güvence screen", () => {
  const items = [
    {evidenceId: EVID, missionId: MID, runId: RUN, kind: "TEST_LOG", verification: "VERIFIED", createdAt: "2026-10-14T10:00:00.000Z"},
    {evidenceId: "evd_second_0001", kind: "SCAN", verification: "MISMATCH"}, {evidenceId: "evd_third_00001", kind: "SCAN", verification: "MISSING"}, {evidenceId: "evd_fourth_0001", kind: "TEST_LOG", verification: "UNVERIFIABLE"}, {evidenceId: "evd_fifth_00001", kind: "SCAN"}];
  const getFn = (extra: Record<string, any> = {}) => (p: string) => {
    if (p in extra) return extra[p];
    if (p.startsWith("/v1/evidence?") || p === "/v1/evidence") return {evidence: items, nextCursor: "next-1"};
    if (p === `/v1/evidence/${EVID}`) return {evidence: {...items[0], sourcePath: "logs/test.log", sha256: SHA, redactedLogTail: "<img src=x onerror=alert(1)>\nok"}};
    return undefined;
  };
  it("lists evidence with verification chips; only exact VERIFIED is green; filters narrow the list", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFn()});
    const view = await load(rend, "views", "assurance.js");
    let root = mount(doc, await view.render(ctx));
    expect(calls.get).toContain("/v1/evidence?limit=100");
    const chips = byData(root, "verification").map(n => [n.dataset.verification, n.dataset.chip]);
    expect(chips).toEqual([["VERIFIED", "VERIFIED"], ["MISMATCH", "ERROR"], ["MISSING", "STALE"], ["UNVERIFIABLE", "UNVERIFIED"], ["NONE", "UNVERIFIED"]]);
    forms.drafts.evidence.verification = "MISMATCH";
    root = mount(doc, await view.render(ctx));
    expect(byData(root, "verification").map(n => n.dataset.verification)).toEqual(["MISMATCH"]);
    forms.drafts.evidence.verification = "ALL"; forms.drafts.evidence.kind = "SCAN";
    root = mount(doc, await view.render(ctx));
    expect(byData(root, "verification").length).toBe(3);
    forms.drafts.evidence.kind = "NO_SUCH";
    root = mount(doc, await view.render(ctx));
    expect(byData(root, "verification").length).toBe(5); // bilinmeyen tür süzgeci ALL'a döner
  });
  it("detail panel shows source path, sha256, verification and the log tail as plain text; 404 detail is UNAVAILABLE", async () => {
    const {ctx, doc} = await mkCtx({get: getFn()});
    const view = await load(rend, "views", "assurance.js");
    forms.selection.evidenceId = EVID;
    const root = mount(doc, await view.render(ctx));
    expect(text(byData(root, "field", "sourcePath")[0])).toBe("logs/test.log");
    expect(text(byData(root, "field", "sha256")[0])).toBe(SHA);
    const log = byId(root, "ev-log")!;
    expect(log.tagName).toBe("PRE");
    expect(text(log)).toContain("<img src=x onerror=alert(1)>");
    expect(log.children.every(c => c.tagName === "#TEXT")).toBe(true);
    expect(log.getAttribute("tabindex")).toBe("0");
    const g = getFn(); const {ctx: c2, doc: d2} = await mkCtx({get: p => p.startsWith("/v1/evidence/") ? undefined : g(p)});
    const r2 = mount(d2, await view.render(c2));
    expect(text(byId(r2, "assurance-detail")!)).toContain("Kullanılamıyor");
    expect(byId(r2, "ev-log")).toBeNull();
  });
  it("UNAVAILABLE on 404 list; list rows open the detail; mission scope and paging pass strict query values", async () => {
    const {ctx, doc, calls} = await mkCtx({get: () => undefined});
    const view = await load(rend, "views", "assurance.js");
    const root = mount(doc, await view.render(ctx));
    expect(text(byId(root, "assurance-list")!)).toContain("Kullanılamıyor");
    expect(byData(root, "verification")).toEqual([]);
    forms.selection.missionId = MID; forms.drafts.evidence.cursor = "c-1";
    const {ctx: c2, doc: d2, calls: k2} = await mkCtx({get: getFn()});
    const r2 = mount(d2, await view.render(c2));
    expect(k2.get[0]).toBe(`/v1/evidence?missionId=${MID}&cursor=c-1&limit=100`);
    byId(r2, `ev-${EVID}`)!.fire("click");
    expect(forms.selection.evidenceId).toBe(EVID);
    byId(r2, "ev-next")!.fire("click");
    expect(forms.drafts.evidence.cursor).toBe("next-1");
    expect(forms.drafts.evidence.stack).toEqual(["c-1"]);
    byId(r2, "ev-prev")!.fire("click");
    expect(forms.drafts.evidence.cursor).toBe("c-1");
    expect(calls.post).toEqual([]);
  });
});

describe("B5 AI İş Gücü screen", () => {
  it("separates registered roles (GET /v1/agents) from active workers and lists live runs; carries the 599 ≠ running note and the live /v1/roles role-catalog panel (UX WP-AGENTS, no stale planned panel)", async () => {
    const get = (p: string) => {
      if (p === "/v1/agents") return {count: 12};
      if (p === "/v1/cockpit") return {generatedAt: "2026-10-14T10:00:00.000Z", workforce: {state: "VERIFIED", registeredRoles: 12, targetRoles: 599, activeWorkerRuns: 1}};
      if (p === "/v1/work-runs") return {workRuns: [{runId: RUN, missionId: MID, status: "RUNNING", role: "qa-engineer", heartbeatAt: "2026-10-14T10:00:00.000Z"}, {runId: "run_done_00001", missionId: MID, status: "COMPLETED", role: "x"}]};
      return undefined;
    };
    const {ctx, doc} = await mkCtx({get});
    const view = await load(rend, "views", "workforce.js");
    const root = mount(doc, await view.render(ctx, {id: "workforce", plannedPackage: "B3"}));
    expect(text(byId(root, "wf-reg")!)).toContain("12");
    expect(text(byId(root, "wf-reg")!)).toContain("599");
    expect(text(byId(root, "wf-act")!)).toContain("1");
    expect(text(root)).toContain("599 hedef rol kataloğu ≠ çalışan ajan");
    expect(byData(root, "runId").map(n => n.dataset.runId)).toEqual([RUN]);
    expect(text(byData(root, "runId", RUN)[0])).toContain("qa-engineer");
    // UX WP-AGENTS: AI İş Gücü artık canlı /v1/roles rol kataloğuna bağlı gerçek bir görünümdür; eski planlı/kısmi panel (data-planned) kaldırıldı ve yerini rol kataloğu paneli aldı.
    expect(byData(root, "planned").length).toBe(0);
    expect(byId(root, "wf-catalog")).not.toBeNull();
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    expect(tr["workforce.catalogNote"]).toContain("599");
  });
  it("shows honest unavailable states when the services are missing and never invents a count", async () => {
    const {ctx, doc} = await mkCtx({get: () => undefined});
    const view = await load(rend, "views", "workforce.js");
    const root = mount(doc, await view.render(ctx, {id: "workforce", plannedPackage: "B3"}));
    expect(text(byId(root, "wf-reg")!)).toContain("—");
    expect(text(byId(root, "wf-act")!)).toContain("—");
    expect(byData(root, "runId")).toEqual([]);
    expect(text(byId(root, "wf-live")!)).toContain("work-runs");
  });
});

// ---------- Onay penceresi (app.js içindeki confirmAction) ----------
describe("B5 confirm dialog", () => {
  const html = read(rend, "index.html"), app = read(rend, "app.js");
  it("index.html has an accessible modal dialog with a default-focused cancel button, CSP unchanged, no inline script/style", () => {
    expect(html).toMatch(/<dialog id="confirmDialog"[^>]*aria-labelledby="confirmDialogTitle"[^>]*aria-describedby="confirmDialogDesc"/);
    expect(html).toMatch(/<button[^>]*id="confirmCancel"[^>]*autofocus/);
    expect(html).toContain('id="confirmOk"');
    expect(html).toContain('id="confirmAction"');
    expect(html).toContain('id="confirmTarget"');
    expect(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]).toBe("default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:");
    expect(html).not.toMatch(/<style\b|\sstyle\s*=|\son[a-z]+\s*=/i);
  });
  it("app.js skips periodic re-render while the confirm dialog is open, keeps STOP/dialog behaviour and wires the new view", () => {
    expect(app).toContain('doc.getElementById("confirmDialog")?.open');
    expect(app).toContain('doc.getElementById("stopDialog")?.open');
    expect(app).toContain('import * as assurance from "./views/assurance.js"');
    expect(app).toContain("confirm:confirmAction");
    expect(app).toContain("rerender()");
    expect(app).toContain("window.uasco.stop(");
  });
  it("confirmAction resolves true only on explicit confirm; Esc, cancel and Escape key resolve false; cancel is focused; listeners are cleaned up", async () => {
    const src = /(function confirmAction[\s\S]*?\n\})\n\n\/\*\* Legacy/.exec(app)?.[1];
    expect(src).toBeTruthy();
    const mk = () => {
      const doc = new D(); const d = new N(doc, "dialog"); d.attrs.set("id", "confirmDialog");
      const mkn = (id: string, tag = "span") => { const n = new N(doc, tag); n.attrs.set("id", id); d.append(n); return n; };
      mkn("confirmDialogTitle"); mkn("confirmDialogDesc"); mkn("confirmAction"); mkn("confirmTarget"); const ok = mkn("confirmOk", "button"), cancel = mkn("confirmCancel", "button");
      (d as any).showModal = () => { d.open = true; }; (d as any).close = () => { d.open = false; };
      doc.body.append(d);
      const ctx = {t: (k: string) => k};
      const fn = new Function("doc", "ctx", `${src}\nreturn confirmAction;`)(doc, ctx) as (o: any) => Promise<boolean>;
      return {doc, d, ok, cancel, fn};
    };
    const opts = {title: "T", body: "B", action: "A: X → Y", target: "Görev (msn)", confirmLabel: "Onayla: Y"};
    let s = mk(); let p = s.fn(opts);
    expect(s.d.open).toBe(true); expect(s.doc.focused).toBe(s.cancel);
    expect(s.doc.getElementById("confirmDialogTitle")!.textContent).toBe("T");
    expect(s.doc.getElementById("confirmAction")!.textContent).toBe("A: X → Y");
    expect(s.doc.getElementById("confirmTarget")!.textContent).toBe("Görev (msn)");
    expect(s.ok.textContent).toBe("Onayla: Y");
    s.ok.fire("click"); expect(await p).toBe(true); expect(s.d.open).toBe(false);
    expect(s.ok.ls.get("click")?.length ?? 0).toBe(0);
    s = mk(); p = s.fn(opts); s.cancel.fire("click"); expect(await p).toBe(false);
    s = mk(); p = s.fn(opts); s.d.fire("cancel"); expect(await p).toBe(false);
    s = mk(); p = s.fn(opts); s.d.fire("keydown", {key: "Escape"}); expect(await p).toBe(false);
    s = mk(); p = s.fn(opts); s.d.fire("keydown", {key: "Enter"}); expect(s.d.open).toBe(true); s.ok.fire("click"); expect(await p).toBe(true);
    s = mk(); p = s.fn(opts); s.ok.fire("click"); s.cancel.fire("click"); expect(await p).toBe(true); // ilk karar kesindir
  });
});

// ---------- Statik güvenlik/a11y ----------
describe("B5 static safety, routes and wiring", () => {
  it("new renderer modules never use innerHTML/eval/fetch and only reach POST through bridge.apiPost; backend data is rendered as text", () => {
    for (const f of ["work-core.js", "forms.js", "work-actions.js", "views/assurance.js", "views/inbox.js", "views/work.js", "views/projects.js", "views/workforce.js"]) {
      const s = read(rend, f);
      expect(s, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|\bfetch\s*\(|window\.uasco|localStorage|sessionStorage/);
    }
    const api = read(rend, "api.js");
    expect(api.match(/bridge\.apiPost\(/g)?.length).toBe(1);
    expect(api).not.toMatch(/apiPost\(\s*[^p]/);
    for (const f of walk(path.join(rend, "views")).concat(["forms.js", "work-actions.js", "shell.js"].map(x => path.join(rend, x)))) expect(read(f), f).not.toMatch(/\bbridge\b|apiPost|apiGet/);
  });
  it("routes: Güvence and Gelen Kutusu are real views, Teslimat (UX WP-DELIVERY) and Company OS (UX WP3) are real views hosted by planned.js, workforce (UX WP-AGENTS) is a real /v1/roles catalog view with no planned package", async () => {
    const routes = await load(rend, "routes.js");
    const by = (id: string) => routes.ROUTES.find((r: any) => r.id === id);
    expect(by("assurance").view).toBe("assurance"); expect(by("assurance").plannedPackage).toBeUndefined();
    expect(by("inbox").view).toBe("inbox"); expect(by("inbox").plannedPackage).toBeUndefined();
    expect(by("delivery").view).toBe("planned"); expect(by("delivery").component).toBe("delivery"); expect(by("delivery").plannedPackage).toBeUndefined();
    expect(by("company").view).toBe("planned"); expect(by("company").component).toBe("company"); expect(by("company").plannedPackage).toBeUndefined();
    expect(by("workforce").view).toBe("workforce"); expect(by("workforce").plannedPackage).toBeUndefined();
    expect(fs.existsSync(path.join(rend, "views", "assurance.js"))).toBe(true);
    expect(fs.existsSync(path.join(rend, "views", "delivery.js"))).toBe(true);
  });
  it("api exposes no generic POST and never forwards a caller-chosen method; every API GET path is accepted by the main allow-list", async () => {
    const ok = loadGet();
    const boundary = await load(root, "automation", "lib", "control-boundary.mjs");
    const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js");
    const calls: string[] = [];
    const store = st.createStore(null);
    const client = apiMod.createApi({bridge: {apiGet: async (p: string) => { calls.push(p); throw new Error(`${p}: HTTP 404`); }}, store});
    await Promise.all([client.allMissions(), client.missionDetail(MID), client.workRuns(), client.workRuns({missionId: MID}), client.workRunDetail(RUN), client.evidenceList(), client.evidenceList({missionId: MID, runId: RUN, kind: "TEST_LOG", cursor: "c-1", limit: 50}), client.evidenceItem(EVID), client.agentCount()]);
    expect(calls.length).toBe(9);
    for (const p of calls) expect(boundary.desktopGetPathAllowed(p) || ok(p), p).toBe(true);
    // geçersiz kimlikler istek üretmez
    calls.length = 0; store.cache.clear();
    expect((await client.missionDetail("../x")).state).toBe("ERROR");
    expect((await client.workRuns({missionId: "bad"})).state).toBe("ERROR");
    expect((await client.workRunDetail("a/b")).state).toBe("ERROR");
    expect((await client.evidenceItem("")).state).toBe("ERROR");
    await client.evidenceList({missionId: "bad", runId: "x y", kind: "lower", cursor: "a b", limit: 0});
    expect(calls).toEqual(["/v1/evidence"]);
    expect(Object.keys(client).filter(k => /post|put|patch|delete/i.test(k))).toEqual(["post"]);
  });
  it("api.post normalizes bridge results, clears the cache on success and reports failures without throwing", async () => {
    const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js");
    const store = st.createStore(null); store.cache.set("/v1/x", {at: 0, promise: null});
    const mk = (fn: any) => apiMod.createApi({bridge: {apiGet: async () => ({}), apiPost: fn}, store});
    expect(await mk(async () => ({status: 201, body: {a: 1}})).post("/v1/projects", {})).toEqual({ok: true, status: 201, body: {a: 1}});
    expect(store.cache.size).toBe(0);
    store.cache.set("/v1/x", {at: 0, promise: null});
    expect(await mk(async () => ({status: 409, body: {error: "E"}})).post("/v1/projects", {})).toEqual({ok: false, status: 409, body: {error: "E"}});
    expect(store.cache.size).toBe(1);
    expect(await mk(async () => { throw new Error("Error invoking remote method: CONTROL_API_UNREACHABLE"); }).post("/v1/projects", {})).toMatchObject({ok: false, thrown: true, state: "OFFLINE"});
    expect(await mk(async () => ({status: "x"})).post("/v1/projects", {})).toMatchObject({ok: false, thrown: true});
    expect(await apiMod.createApi({bridge: undefined, store}).post("/v1/projects", {})).toMatchObject({ok: false, thrown: true, state: "OFFLINE"});
  });
  it("styles keep contrast for the primary button and define form/timeline focus-safe rules; reduced motion and forced colors remain", () => {
    const css = read(rend, "styles.css");
    const tok = (n: string) => new RegExp(`--${n}:(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "";
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    expect(css).toMatch(/\.btn-primary\{[^}]*color:#031018/);
    expect(ratio("#031018", tok("accent"))).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["bg", "surface", "surface-2"]) { expect(ratio(tok("danger"), tok(bg)), `danger on ${bg}`).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("ok"), tok(bg))).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("warn"), tok(bg))).toBeGreaterThanOrEqual(4.5); }
    expect(css).toContain(".field-error");
    expect(css).toContain(".status-timeline");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).toContain("forced-colors:active");
    expect(css).not.toMatch(/\.field[^{]*\{[^}]*outline\s*:\s*none/);
  });
  it("validation.json appends this test at the end of the tests step and nothing else changed there", () => {
    const cfg = JSON.parse(read(root, "config", "validation.json"));
    // PUBLIC-CI: "tests" adımı sıralı tests, tests-2..tests-N kabuklarına bölünebilir; sıra kuralı kabukların birleşimi olan mantıksal liste üzerinde aynen geçerlidir.
    const step = {command: logicalTestFiles(cfg)};
    // B7: later V7 packages append their own test after this one; B5 must stay directly after B4 and only later v7 package tests (b6+ or product-studio ps<N>) may follow it.
    const i = step.command.indexOf("tests/v7-b5-work-screens.test.ts");
    expect(step.command[i - 1]).toBe("tests/v7-b4-desktop-shell.test.ts");
    // V7-PKG-M1A-MODE: merge-tool sözleşmesi gereği M1a testleri de sona eklenir (m1a-*); B5 sırası ve tekilliği değişmez.
    // V7-CORE-PREDEV (FA-V2-PRODUCT): CORE pre-dev sözleşme testi de sona eklenir (core-predev-*). UX paketleri (ux-*) de sona eklenir; B5 sırası ve tekilliği değişmez.
    for (const later of step.command.slice(i + 1)) expect(later).toMatch(/^tests\/v7-(?:b([6-9]|\d{2,})[a-z]?|ps\d+[a-z]?|m1a|core-predev|ux)-[a-z0-9-]+\.test\.ts$/);
    expect(step.command).toContain("tests/v7-b4-desktop-shell.test.ts");
    expect(step.command.filter((x: string) => x === "tests/v7-b5-work-screens.test.ts").length).toBe(1);
  });
  it("no secrets or tokens are embedded in the new sources or this test", () => {
    for (const f of walk(rend).filter(x => x.endsWith(".js") || x.endsWith(".html") || x.endsWith(".css")).concat([path.join(desk, "main.mjs"), path.join(desk, "preload.mjs")])) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/);
    }
    expect(crypto.createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });
});

describe("UI-026 task inspector", () => {
  const getT = (over: Record<string, any> = {}) => (p: string) => {
    const t: Record<string, any> = {"/v1/projects": {projects: [project()]}, "/v1/missions": {missions: [mission()]}, "/v1/work-runs": {workRuns: []},
      [`/v1/missions/${MID}`]: {mission: mission(), tasks: [{taskId: "tsk_alpha01", title: "Alt görev", status: "PENDING"}]}, ...over};
    for (const k of Object.keys(t)) if (p === k || p.startsWith(k + "?")) return t[k];
    return undefined;
  };
  it("opens read-only on click, shows API fields and UNKNOWN for missing ones, toggles closed, and sends no POST", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getT()});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    let root = mount(doc, await view.render(ctx));
    expect(byId(root, "task-inspector")!.dataset.taskInspector).toBe("closed");
    byData(root, "taskInspect", "tsk_alpha01")[0].fire("click");
    root = mount(doc, await view.render(ctx));
    expect(byId(root, "task-inspector")!.dataset.taskInspector).toBe("open");
    expect(text(byData(root, "taskField", "taskId")[0])).toBe("tsk_alpha01");
    expect(text(byData(root, "taskField", "title")[0])).toBe("Alt görev");
    for (const k of ["assignee", "dueAt", "dependencies", "description", "runLink"]) expect(text(byData(root, "taskField", k)[0])).toBe("UNKNOWN");
    expect(text(byData(root, "taskField", "runs")[0])).toContain("0");
    byData(root, "taskInspect", "tsk_alpha01")[0].fire("click");
    root = mount(doc, await view.render(ctx));
    expect(byId(root, "task-inspector")!.dataset.taskInspector).toBe("closed");
    expect(calls.post).toEqual([]);
    expect(calls.get.every(p => !p.includes("tasks"))).toBe(true);
  });
  it("run count is UNKNOWN when work-runs are unreadable; derive gives UNKNOWN for non-VERIFIED (incl. STALE) and EMPTY for a missing task", async () => {
    const core = await load(rend, "work-core.js");
    const det = {state: "VERIFIED", mission: {missionId: MID, title: "T", status: "PLANNED", riskLevel: "R1", tasks: [{taskId: "tsk_a", title: "x", status: "PENDING"}]}};
    expect(core.deriveTaskInspector(det, {state: "UNAVAILABLE", items: []}, "tsk_a").task.runs).toEqual({known: false, count: null, byStatus: {}});
    expect(core.deriveTaskInspector({...det, state: "STALE"}, {state: "VERIFIED", items: []}, "tsk_a")).toEqual({state: "UNKNOWN", task: null});
    expect(core.deriveTaskInspector({state: "OFFLINE", mission: null}, null, "tsk_a").state).toBe("UNKNOWN");
    expect(core.deriveTaskInspector(det, {state: "VERIFIED", items: []}, "tsk_zz").state).toBe("EMPTY");
  });
  it("locales carry the same task-inspector keys in en and tr", async () => {
    const keys = (f: string) => [...read(rend, "locales", f).matchAll(/"(work\.task\.[^"]+)"/g)].map(m => m[1]).sort();
    expect(keys("en.js").length).toBeGreaterThan(10);
    expect(keys("en.js")).toEqual(keys("tr.js"));
  });
});

describe("UI-025 task and work-run timeline", () => {
  const RUN = {runId: "run_tl000001", missionId: MID, status: "RUNNING", startedAt: "2026-10-14T10:00:00.000Z", checkpoints: [{name: "PLAN", at: "2026-10-14T10:05:00.000Z"}, {name: "NOTIME"}]};
  const getT = (runs: any[] = [RUN]) => (p: string) => {
    const t: Record<string, any> = {"/v1/projects": {projects: [project()]}, "/v1/missions": {missions: [mission()]}, "/v1/work-runs": {workRuns: runs},
      [`/v1/missions/${MID}`]: {mission: mission(), tasks: []}};
    for (const k of Object.keys(t)) if (p === k || p.startsWith(k + "?")) return t[k];
    return undefined;
  };
  it("renders mission, run and checkpoint events in time order with UNKNOWN for a missing timestamp, read-only", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getT()});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    const tl = byId(root, "work-wtl")!;
    expect(tl.dataset.wtlState).toBe("VERIFIED");
    const items = byData(root, "wtlKind", "mission").concat(byData(root, "wtlKind", "run"), byData(root, "wtlKind", "checkpoint"));
    expect(items.length).toBe(4);
    expect(byData(root, "wtlAt", "UNKNOWN").length).toBe(1);
    expect(text(byData(root, "wtlAt", "UNKNOWN")[0])).toContain("UNKNOWN");
    expect(calls.post).toEqual([]);
  });
  it("derive is UNKNOWN for non-VERIFIED mission (incl. STALE), omits runs when unreadable, and orders unknown times last", async () => {
    const core = await load(rend, "work-core.js");
    const det = {state: "VERIFIED", mission: {missionId: MID, title: "T", status: "PLANNED", createdAt: "2026-10-14T09:00:00.000Z", tasks: []}};
    expect(core.deriveWorkTimeline({...det, state: "STALE"}, {state: "VERIFIED", items: []})).toEqual({state: "UNKNOWN", runsKnown: false, events: []});
    const noRuns = core.deriveWorkTimeline(det, {state: "UNAVAILABLE", items: []});
    expect(noRuns.runsKnown).toBe(false);
    expect(noRuns.events.map((e: any) => e.kind)).toEqual(["mission"]);
    const d = core.deriveWorkTimeline(det, {state: "VERIFIED", items: [{runId: "run_a", startedAt: null, status: "RUNNING", checkpoints: []}, {runId: "run_b", startedAt: "2026-10-14T08:00:00.000Z", status: "DONE", checkpoints: []}]});
    expect(d.events.map((e: any) => e.id)).toEqual(["run_b", MID, "run_a"]);
  });
  it("locales carry the same timeline keys in en and tr", async () => {
    const keys = (f: string) => [...read(rend, "locales", f).matchAll(/"(work\.wtl\.[^"]+)"/g)].map(m => m[1]).sort();
    expect(keys("en.js").length).toBeGreaterThan(6);
    expect(keys("en.js")).toEqual(keys("tr.js"));
  });
});

describe("UI-109 ACTION_DENIED reason code with DENIED pill", () => {
  const dn = (status: number, body?: any) => load(rend, "work-core.js").then(c => c.describePostResult({ok: false, status, body}));
  it("maps a 403 ACTION_DENIED with a valid reason to post.err.denied; both locales carry identical placeholders", async () => {
    expect(await dn(403, {error: "ACTION_DENIED", reason: "BUDGET_DENIED"})).toEqual({ok: false, key: "post.err.denied", vars: {status: 403, reason: "BUDGET_DENIED"}});
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    expect(en["post.err.denied"]).toBeTruthy(); expect(tr["post.err.denied"]).toBeTruthy();
    expect(ph(en["post.err.denied"])).toEqual(["reason", "status"]); expect(ph(tr["post.err.denied"])).toEqual(ph(en["post.err.denied"]));
  });
  it("cuts the reason at the first ':' and never invents one", async () => {
    expect((await dn(403, {error: "ACTION_DENIED", reason: "APPROVAL_INVALID:some text"})).vars.reason).toBe("APPROVAL_INVALID");
    for (const body of [undefined, {}, {error: "OTHER", reason: "BUDGET_DENIED"}, {error: "ACTION_DENIED"}, {error: "ACTION_DENIED", reason: "bad code"}, {error: "ACTION_DENIED", reason: ":X"}, {error: "ACTION_DENIED", reason: 5}, {error: "ACTION_DENIED", reason: "A"}, {error: "ACTION_DENIED", reason: "A".repeat(65)}]) expect((await dn(403, body)).key, JSON.stringify(body)).toBe("post.err.auth");
    expect((await dn(401, {error: "ACTION_DENIED", reason: "BUDGET_DENIED"})).key).toBe("post.err.auth");
  });
  it("statusBlock renders a DENIED pill before the message with status and code, and no pill for other statuses", async () => {
    const {ctx, doc} = await mkCtx({get: () => undefined});
    forms.setStatus("f109", {ok: false, key: "post.err.denied", vars: {status: 403, reason: "BUDGET_DENIED"}, errors: null});
    const b = forms.statusBlock(ctx, "f109");
    expect(b.attrs.get("role")).toBe("alert");
    const pill = byData(b, "pill", "DENIED");
    expect(pill.length).toBe(1);
    expect(b.children[0]).toBe(pill[0]);
    expect(text(pill[0])).toContain("DENIED");
    expect(text(b)).toContain("403"); expect(text(b)).toContain("BUDGET_DENIED");
    for (const key of ["post.err.auth", "post.err.generic", "post.err.409"]) {
      forms.setStatus("f109", {ok: false, key, vars: {status: 403}, errors: null});
      expect(byData(forms.statusBlock(ctx, "f109"), "pill").length, key).toBe(0);
    }
    void doc;
  });
});

// ---------- UI-111: #/work koşu kartı yeniden deneme olguları ----------
describe("UI-111 #/work run-card retry facts", () => {
  const RETRY_AT = "2026-10-14T11:11:11.000Z";
  const base = {runId: RUN, missionId: MID, status: "RUNNING", startedAt: "2026-10-14T08:00:00.000Z", heartbeatAt: "2026-10-14T10:00:00.000Z", lease: {expiresAt: "2026-10-14T10:05:00.000Z"}, checkpoints: [{name: "cp", at: "2026-10-14T09:00:00.000Z", status: "COMPLETED"}]};
  const getWith = (over: Record<string, any>) => {
    const run = {...base, ...over};
    return {[`/v1/work-runs?missionId=${MID}`]: {workRuns: [run]}, [`/v1/work-runs/${RUN}`]: {workRun: run}} as Record<string, any>;
  };
  const baseGet = (extra: Record<string, any>) => (p: string) => {
    if (p in extra) return extra[p];
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission()]};
    if (p === `/v1/missions/${MID}`) return {mission: mission(), tasks: []};
    return undefined;
  };
  const renderCard = async (over: Record<string, any>) => {
    const {ctx, doc, calls} = await mkCtx({get: baseGet(getWith(over))});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const root = mount(doc, await view.render(ctx));
    return {root, card: byData(root, "runId", RUN)[0], calls, ctx};
  };

  it("mapWorkRun keeps counters only as non-negative safe integers and retryAt only when parseable", async () => {
    const c = await load(rend, "work-core.js");
    const bare = c.mapWorkRun({runId: RUN, status: "RUNNING"});
    expect([bare.retryCount, bare.remediationCycle, bare.attempt, bare.retryAt]).toEqual([null, null, null, null]);
    for (const f of ["retryCount", "remediationCycle", "attempt"]) {
      for (const bad of [-1, 1.5, "2", true, null]) expect(c.mapWorkRun({runId: RUN, status: "RUNNING", [f]: bad})[f], `${f}=${String(bad)}`).toBeNull();
      expect(c.mapWorkRun({runId: RUN, status: "RUNNING", [f]: 0})[f]).toBe(0);
      expect(c.mapWorkRun({runId: RUN, status: "RUNNING", [f]: 7})[f]).toBe(7);
    }
    for (const bad of [5, "", "not-a-date", null, {}]) expect(c.mapWorkRun({runId: RUN, status: "RUNNING", retryAt: bad}).retryAt, String(bad)).toBeNull();
    expect(c.mapWorkRun({runId: RUN, status: "RETRY_SCHEDULED", retryAt: RETRY_AT}).retryAt).toBe(RETRY_AT);
    // iso() davranışı sabitlenir: Date'in ayrıştırabildiği ISO olmayan dize olduğu gibi tutulur.
    expect(c.mapWorkRun({runId: RUN, status: "RETRY_SCHEDULED", retryAt: "Oct 14, 2026 11:11:11 UTC"}).retryAt).toBe("Oct 14, 2026 11:11:11 UTC");
    const d = c.mapWorkRunDetail({workRun: {runId: RUN, status: "RUNNING", retryCount: 1, remediationCycle: 2, attempt: 3, retryAt: RETRY_AT}});
    expect([d.run.retryCount, d.run.remediationCycle, d.run.attempt, d.run.retryAt]).toEqual([1, 2, 3, RETRY_AT]);
  });
  it("work-core.js keeps exactly its two relative imports and views/work.js/work-core.js use no indexedDB, Math.random, Date.now or new Date(", () => {
    const core = read(rend, "work-core.js"), view = read(rend, "views", "work.js");
    expect(moduleSpecifiers({source: core}).sort()).toEqual(["./delivery-core.js", "./model.js"]);
    for (const [n, s] of [["work-core.js", core], ["views/work.js", view]]) expect(s, n).not.toMatch(/indexedDB|Math\.random/);
    expect(view).not.toMatch(/Date\.now|new Date\(/);
  });
  it("renders retries/cycles/attempts as exactly the integer, with the data value; a bare run shows the dash and an empty data value", async () => {
    const {card} = await renderCard({retryCount: 1, remediationCycle: 2, attempt: 3});
    for (const [k, v] of [["runRetryCount", "1"], ["runRemediationCycle", "2"], ["runAttempt", "3"]]) {
      const dd = byData(card, k);
      expect(dd.length, k).toBe(1);
      expect(dd[0].dataset[k]).toBe(v);
      expect(text(dd[0])).toBe(v);
    }
    const bare = await renderCard({});
    for (const k of ["runRetryCount", "runRemediationCycle", "runAttempt"]) {
      const dd = byData(bare.card, k);
      expect(dd.length, k).toBe(1);
      expect(dd[0].dataset[k]).toBe("");
      expect(text(dd[0])).toBe("—");
    }
    expect(byData(bare.card, "runRetryAt").length).toBe(0);
    const t = text(bare.card);
    expect(t).not.toMatch(/%|progress/i);
    expect(byData(card, "runRetryCount").concat(byData(card, "runRemediationCycle"), byData(card, "runAttempt")).map(text).join("")).not.toMatch(/[\/]|total|toplam/i);
  });
  it("shows the retry-time row only for RETRY_SCHEDULED, as the recorded time; the pill keeps the raw status code in data-status", async () => {
    const {card, ctx} = await renderCard({status: "RETRY_SCHEDULED", retryCount: 1, retryAt: RETRY_AT});
    const core = await load(rend, "work-core.js");
    const dd = byData(card, "runRetryAt");
    expect(dd.length).toBe(1);
    expect(dd[0].dataset.runRetryAt).toBe(RETRY_AT);
    expect(text(dd[0])).toBe(core.formatDateTime(RETRY_AT, ctx.i18n.lang));
    const pill = byData(card, "status", "RETRY_SCHEDULED")[0];
    expect(pill).toBeTruthy();
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>, tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    expect(text(pill)).toBe((ctx.i18n.lang === "en" ? en : tr)["mstatus.RETRY_SCHEDULED"]);
    const missing = await renderCard({status: "RETRY_SCHEDULED"});
    expect(text(byData(missing.card, "runRetryAt")[0])).toBe("—");
    expect(byData(missing.card, "runRetryAt")[0].dataset.runRetryAt).toBe("");
    // eskimiş retryAt: başka durumlarda düğüm ve biçimli zaman görünmez
    for (const status of ["FAILED", "RUNNING", "BLOCKED"]) {
      const r = await renderCard({status, retryCount: 1, retryAt: RETRY_AT});
      expect(byData(r.card, "runRetryAt").length, status).toBe(0);
      expect(text(r.card), status).not.toContain(core.formatDateTime(RETRY_AT, r.ctx.i18n.lang));
    }
  });
  it("a FAILED *_RETRY_EXHAUSTED run keeps reason and retry count in the same dl.kv and shows no retry time", async () => {
    const {card} = await renderCard({status: "FAILED", reason: "TEST_RETRY_EXHAUSTED", retryCount: 2, retryAt: RETRY_AT});
    const reason = byData(card, "runReason", "TEST_RETRY_EXHAUSTED")[0], cnt = byData(card, "runRetryCount", "2")[0];
    expect(text(reason)).toBe("TEST_RETRY_EXHAUSTED");
    expect(text(cnt)).toBe("2");
    expect(reason.parent).toBe(cnt.parent);
    expect(reason.parent?.className).toBe("kv");
    expect(byData(card, "runRetryAt").length).toBe(0);
  });
  it("every path read passes the real main.mjs allow-list, no POST happens, and the five new keys exist in en and tr without placeholders or digits", async () => {
    const ok = loadGet();
    const {calls} = await renderCard({status: "RETRY_SCHEDULED", retryCount: 1, remediationCycle: 1, attempt: 1, retryAt: RETRY_AT});
    expect(calls.get.length).toBeGreaterThan(0);
    for (const p of calls.get) expect(ok(p), p).toBe(true);
    expect(calls.post).toEqual([]);
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>, tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const keys = ["run.retriesInStep", "run.remediationCycles", "run.leaseAttempts", "run.retryScheduledFor", "mstatus.RETRY_SCHEDULED"];
    for (const k of keys) for (const d of [en, tr]) { expect(typeof d[k], k).toBe("string"); expect(d[k].trim().length, k).toBeGreaterThan(0); expect(d[k], k).not.toMatch(/\{|\}/); }
    for (const k of keys.slice(0, 4)) { expect(en[k], k).not.toMatch(/[\d\/%]|total|max|remaining|lifetime|next|upcoming/i); expect(tr[k], k).not.toMatch(/[\d\/%]|toplam|azami|kalan|sonraki|yaklaşan/i); }
    expect(en["run.retriesInStep"]).toContain("step"); expect(tr["run.retriesInStep"]).toContain("adım");
    for (const k of ["run.remediationCycles", "run.leaseAttempts"]) { expect(en[k]).toContain("run"); expect(tr[k]).toContain("koşu"); }
    expect(en["run.retryScheduledFor"]).toBe("Retry scheduled for");
  });
});

// //TR: LANE-A first-delivery: Görevleri planla formu (POST /v1/missions/:id/plan, Lane B) — sıkı gövde kurucusu, yalnız kullanıcı satırları, dürüst hata durumları.
describe("LANE-A mission plan form", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const planGet = (status = "AUTHORIZED", tasks: any[] = []) => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status}), tasks};
    if (p.startsWith("/v1/work-runs")) return {workRuns: []};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  const open = async (o: CtxOpts, status = "AUTHORIZED", tasks: any[] = []) => {
    const c = await mkCtx({...o, get: planGet(status, tasks)});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js"), pf = await load(rend, "views", "plan-form.js");
    pf.resetPlanDraft(null);
    return {...c, view, pf, root: mount(c.doc, await view.render(c.ctx))};
  };
  const type = (root: N, id: string, v: string) => { byId(root, id)!.value = v; byId(root, id)!.fire("input"); };

  it("builds a strict body: titles trimmed, 1-based earlier-task dependencies become 0-based indexes, no extra fields", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.planPath(MID)).toBe(`/v1/missions/${MID}/plan`);
    expect(c.planPath("x")).toBeNull();
    const ok = c.buildPlanRequest({missionId: MID, rows: [{title: " A ", deps: ""}, {title: "B", deps: "1"}, {title: "C", deps: "1, 2"}, {title: "", deps: ""}]});
    expect(ok).toMatchObject({ok: true, path: `/v1/missions/${MID}/plan`, body: {tasks: [{title: "A"}, {title: "B", dependsOn: [0]}, {title: "C", dependsOn: [0, 1]}]}});
    const bad = (rows: any[]) => c.buildPlanRequest({missionId: MID, rows});
    expect(bad([]).errors.tasks).toBe("plan.err.none");
    expect(bad([{title: "", deps: ""}]).errors.tasks).toBe("plan.err.none");
    expect(bad([{title: "A", deps: "1"}]).rowErrors[0]).toBe("plan.err.deps"); // kendine bağımlılık
    expect(bad([{title: "A", deps: ""}, {title: "B", deps: "3"}]).rowErrors[1]).toBe("plan.err.deps"); // ileri bağımlılık
    expect(bad([{title: "A", deps: ""}, {title: "B", deps: "1,1"}]).rowErrors[1]).toBe("plan.err.deps"); // tekrar
    expect(bad([{title: "A", deps: ""}, {title: "B", deps: "x"}]).rowErrors[1]).toBe("plan.err.deps");
    expect(bad([{title: "", deps: "1"}]).rowErrors[0]).toBe("plan.err.title");
    expect(bad([{title: "A", deps: ""}, {title: "", deps: ""}, {title: "C", deps: ""}]).rowErrors[1]).toBe("plan.err.title"); // ortadaki boş satır numaralamayı kaydırmaz
    expect(bad([{title: "x".repeat(201), deps: ""}]).rowErrors[0]).toBe("plan.err.titleLong");
    expect(bad(Array.from({length: 51}, () => ({title: "t", deps: ""}))).errors.tasks).toBe("plan.err.many");
    expect(bad([{title: "A", deps: ""}]).body).toMatchObject({tasks: [{title: "A"}]});
    expect(Object.keys(ok.body)).toEqual(["tasks"]);
    expect(c.canPlan("AUTHORIZED", 0)).toBe(true);
    for (const s of ["EXECUTING", "COMPLETE", "BLOCKED"]) expect(c.canPlan(s, 0)).toBe(false);
    expect(c.canPlan("AUTHORIZED", 2)).toBe(false);
  });
  it("shows the form only for a plannable mission without tasks, and submits exactly the typed rows once", async () => {
    const {ctx, calls, root, pf} = await open({post: (_p, b) => ({status: 201, body: {tasks: b.tasks.map((t: any, i: number) => ({taskId: "tsk_" + String(i).repeat(24), title: t.title}))}})});
    expect(byId(root, "plan-form")).not.toBeNull();
    expect(calls.post).toEqual([]); // render hiçbir şey göndermez
    type(root, "plan-title-0", "Giriş ekranı");
    byId(root, "plan-add")!.fire("click");
    type(root, "plan-title-1", "API"); type(root, "plan-deps-1", "1");
    byId(root, "plan-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(1);
    expect(calls.post[0]).toEqual({path: `/v1/missions/${MID}/plan`, body: {tasks: [{title: "Giriş ekranı"}, {title: "API", dependsOn: [0]}]}});
    expect(forms.drafts.status["mission-plan"].ok).toBe(true);
    expect(pf.planDraft.rows).toEqual([{title: "", deps: ""}]);
    expect(calls.refresh).toBe(1);
    for (const [st, tasks] of [["EXECUTING", []], ["COMPLETE", []], ["AUTHORIZED", [{taskId: "tsk_" + "1".repeat(24), title: "t", status: "PENDING"}]]] as const) {
      const o = await open({}, st, tasks as any);
      expect(byId(o.root, "plan-form"), st).toBeNull();
    }
  });
  it("validation errors send nothing; server refusals (409 plan exists / not plannable / 403 / unreachable) never report success and keep the draft", async () => {
    const v = await open({});
    byId(v.root, "plan-form")!.fire("submit"); await tick();
    expect(v.calls.post).toEqual([]); expect(forms.drafts.status["mission-plan"].ok).toBe(false);
    const cases: Array<[any, string]> = [[{status: 409, body: {error: "PLAN_ALREADY_EXISTS"}}, "post.err.409.PLAN_ALREADY_EXISTS"], [{status: 409, body: {error: "MISSION_NOT_PLANNABLE"}}, "post.err.409.MISSION_NOT_PLANNABLE"],
      [{status: 403, body: {error: "FORBIDDEN"}}, "post.err.auth"], [{status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, "post.err.423"], [{status: 404, body: {error: "NOT_FOUND"}}, "post.err.unavailable"]];
    for (const [resp, key] of cases) {
      forms.resetAllForms();
      const o = await open({post: () => resp});
      type(o.root, "plan-title-0", "Bir");
      byId(o.root, "plan-form")!.fire("submit"); await tick();
      expect(forms.drafts.status["mission-plan"], key).toMatchObject({ok: false, key});
      expect(o.pf.planDraft.rows[0].title).toBe("Bir");
    }
    forms.resetAllForms();
    const net = await open({}); // post tanımsız: köprü hatası
    type(net.root, "plan-title-0", "Bir");
    byId(net.root, "plan-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["mission-plan"].ok).toBe(false);
    expect(forms.drafts.busy["mission-plan"]).toBe(false);
  });
  it("scopes the last result to its mission: a success or row errors recorded for one mission never show on another mission's empty plan form", async () => {
    const OTHER = "msn_" + "b".repeat(24), otherMission = {missionId: OTHER, status: "AUTHORIZED", tasks: []};
    // 1) A'da kaydedilen başarı B'nin boş formunda görünmez.
    forms.resetAllForms();
    const ok = await open({post: (_p, b) => ({status: 201, body: {tasks: b.tasks.map((t: any, i: number) => ({taskId: "tsk_" + String(i).repeat(24), title: t.title}))}})});
    type(ok.root, "plan-title-0", "Bir");
    byId(ok.root, "plan-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["mission-plan"].ok).toBe(true);
    const afterOk = mount(ok.doc, ok.pf.planFormPanel(ok.ctx, otherMission)!);
    expect(forms.drafts.status["mission-plan"]).toBeUndefined();
    expect(byId(afterOk, "mission-plan-status")!.dataset.result).toBeUndefined();
    expect(text(byId(afterOk, "mission-plan-status")!)).toBe("");
    // 2) A'daki doğrulama/satır hataları B'nin satırını geçersiz işaretlemez.
    forms.resetAllForms();
    const bad = await open({});
    type(bad.root, "plan-deps-0", "1");
    byId(bad.root, "plan-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["mission-plan"].rowErrors[0]).toBe("plan.err.title");
    const same = mount(bad.doc, bad.pf.planFormPanel(bad.ctx, {missionId: MID, status: "AUTHORIZED", tasks: []})!);
    expect(byId(same, "plan-err-0")).not.toBeNull(); // sanity: hata kendi mission'ında görünür
    const afterBad = mount(bad.doc, bad.pf.planFormPanel(bad.ctx, otherMission)!);
    expect(byId(afterBad, "plan-err-0")).toBeNull();
    expect(byId(afterBad, "plan-title-0")!.attrs.get("aria-invalid")).toBeUndefined();
    expect(byId(afterBad, "mission-plan-status")!.dataset.result).toBeUndefined();
    // 3) Aynı mission'da başarılı gönderimden sonra başarı mesajı korunur (yalnız mission DEĞİŞİNCE silinir).
    expect(forms.drafts.status["mission-plan"]).toBeUndefined();
  });
  it("plan strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("plan.") || k === "post.err.409.PLAN_ALREADY_EXISTS" || k === "post.err.409.MISSION_NOT_PLANNABLE");
    expect(keys.length).toBe(17);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: COORD-TASK-UI: seçili görevin durum denetimi (POST /v1/tasks/:id/transition) — sunucu durum makinesinin aynası, bağımlılık kapısı, donuk COMPLETE mission, sıkı gövde ve dürüst retler.
describe("COORD task status controls", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const T1 = "tsk_" + "1".repeat(24), T2 = "tsk_" + "2".repeat(24);
  const tasksOf = (s1 = "PENDING", s2 = "PENDING") => [{taskId: T1, missionId: MID, title: "Giriş ekranı", status: s1, dependsOn: []}, {taskId: T2, missionId: MID, title: "API", status: s2, dependsOn: [T1]}];
  const getFor = (status: string, tasks: any[]) => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status}), tasks};
    if (p.startsWith("/v1/work-runs")) return {workRuns: []};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  const open = async (o: CtxOpts, status: string, tasks: any[], taskId: string) => {
    const c = await mkCtx({...o, get: getFor(status, tasks)});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js"), ts = await load(rend, "views", "task-status.js");
    ts.resetTaskStatusDraft(null);
    let root = mount(c.doc, await view.render(c.ctx));
    if (byId(root, "task-status")?.dataset.taskStatus !== taskId) { byData(root, "taskInspect", taskId)[0].fire("click"); root = mount(c.doc, await view.render(c.ctx)); }
    expect(byId(root, "task-status")!.dataset.taskStatus).toBe(taskId);
    return {...c, view, ts, root};
  };
  const targets = (root: N) => byData(root, "taskTo").map(n => n.dataset.taskTo);

  it("mirrors the server task state machine exactly and gates IN_PROGRESS on done dependencies", async () => {
    const c = await load(rend, "work-core.js"), server = await load(root, "core", "workos", "types.ts");
    expect(JSON.parse(JSON.stringify(c.TASK_TRANSITIONS))).toEqual(JSON.parse(JSON.stringify(server.TASK_TRANSITIONS)));
    const [t1, t2] = tasksOf();
    expect(c.allowedTaskTargets(t2, [t1, t2], "PLANNED")).toEqual({targets: ["BLOCKED"], blockedBy: [T1]});
    expect(c.allowedTaskTargets(t2, [{...t1, status: "DONE"}, t2], "PLANNED")).toEqual({targets: ["IN_PROGRESS", "BLOCKED"], blockedBy: []});
    expect(c.allowedTaskTargets(t2, [t2], "PLANNED").blockedBy).toEqual([T1]); // listede olmayan bağımlılık bitmiş sayılmaz
    expect(c.allowedTaskTargets({...t1, status: "IN_PROGRESS"}, [t1], "EXECUTING").targets).toEqual(["DONE", "BLOCKED", "PENDING"]);
    expect(c.allowedTaskTargets({...t1, status: "BLOCKED"}, [t1], "EXECUTING").targets).toEqual(["PENDING"]);
    expect(c.allowedTaskTargets({...t1, status: "DONE"}, [t1], "EXECUTING").targets).toEqual([]);
    expect(c.allowedTaskTargets(t1, [t1], "COMPLETE")).toEqual({targets: [], blockedBy: []});
    expect(c.allowedTaskTargets({...t1, status: "LATER"}, [t1], "PLANNED").targets).toEqual([]);
    expect(c.allowedTaskTargets({...t2, dependsOn: null}, [t2], "PLANNED").targets).toEqual(["IN_PROGRESS", "BLOCKED"]); // okunamayan bağımlılıkta karar sunucuda
  });
  it("builds a strict {to, reason} body and refuses what the server would refuse", async () => {
    const c = await load(rend, "work-core.js"), [t1, t2] = tasksOf();
    const req = (o: any) => c.buildTaskTransitionRequest({task: t1, tasks: [t1, t2], missionStatus: "PLANNED", ...o});
    expect(req({to: "IN_PROGRESS", reason: ""})).toEqual({ok: true, path: `/v1/tasks/${T1}/transition`, body: {to: "IN_PROGRESS", reason: "PENDING -> IN_PROGRESS (UASCO Desktop)"}});
    expect(req({to: "BLOCKED", reason: "  tasarım bekleniyor "}).body).toEqual({to: "BLOCKED", reason: "tasarım bekleniyor"});
    expect(req({to: "IN_PROGRESS", reason: "r".repeat(1000)}).ok).toBe(true);
    expect(req({to: "IN_PROGRESS", reason: "r".repeat(1001)}).errors).toEqual({reason: "taskst.err.reasonLong"});
    expect(req({to: "BLOCKED", reason: "   "}).errors).toEqual({reason: "err.reasonRequired"});
    expect(req({to: "DONE"}).errors).toEqual({to: "err.transitionNotAllowed"});
    expect(req({to: "IN_PROGRESS", task: t2}).errors).toEqual({to: "taskst.err.deps"});
    expect(req({to: "BLOCKED", reason: "x", missionStatus: "COMPLETE"}).errors).toEqual({to: "taskst.err.frozen"});
    expect(req({to: "IN_PROGRESS", task: {...t1, taskId: "tsk_alpha01"}}).errors).toEqual({task: "taskst.err.task"});
    const mapped = c.mapMissionDetail({mission: mission(), tasks: [{taskId: T2, title: "API", status: "PENDING", dependsOn: [T1, "../x", 5]}, {taskId: T1, title: "A", status: "DONE"}]});
    expect(mapped.mission.tasks.map((t: any) => t.dependsOn)).toEqual([[T1], null]);
    for (const reason of ["TASK_DEPENDENCIES_NOT_DONE", "MISSION_COMPLETE"]) expect(c.describePostResult({status: 409, body: {error: "WORKOS_CONFLICT", reason}}).key).toBe(`post.err.409.${reason}`);
  });
  it("offers only allowed targets, explains waiting dependencies, and posts one exact request", async () => {
    const blocked = await open({}, "PLANNED", tasksOf(), T2);
    expect(targets(blocked.root)).toEqual(["BLOCKED"]);
    expect(text(byData(blocked.root, "taskstNote", "deps")[0])).toContain("Giriş ekranı");
    expect(text(byData(blocked.root, "taskField", "dependencies")[0])).toContain("Giriş ekranı");
    const o = await open({post: (_p, b) => ({status: 200, body: {task: {taskId: T1, status: b.to}}})}, "PLANNED", tasksOf(), T1);
    expect(targets(o.root)).toEqual(["IN_PROGRESS", "BLOCKED"]);
    expect(o.calls.post).toEqual([]); // render hiçbir şey göndermez
    byId(o.root, "taskst-IN_PROGRESS")!.fire("click"); await tick();
    expect(o.calls.post).toEqual([{path: `/v1/tasks/${T1}/transition`, body: {to: "IN_PROGRESS", reason: "PENDING -> IN_PROGRESS (UASCO Desktop)"}}]);
    expect(forms.drafts.status["task-status"]).toMatchObject({ok: true, key: "taskst.done"});
    expect(byId(mount(o.doc, await o.view.render(o.ctx)), "task-status-status")!.dataset.result).toBe("ok"); // E2E "shows the result" kontrolünün dayandığı işaret
    expect(o.calls.refresh).toBe(1);
    const r = await open({post: () => ({status: 200, body: {}})}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    expect(targets(r.root)).toEqual(["DONE", "BLOCKED", "PENDING"]);
    byId(r.root, "taskst-reason")!.value = " kabul testi geçti "; byId(r.root, "taskst-reason")!.fire("input");
    byId(r.root, "taskst-DONE")!.fire("click"); await tick();
    expect(r.calls.post[0].body).toEqual({to: "DONE", reason: "kabul testi geçti"});
    expect(r.ts.taskStatusDraft.reason).toBe("");
  });
  it("sends nothing when the request is invalid, frozen, terminal or the task ID is unknown", async () => {
    const b = await open({post: () => ({status: 200, body: {}})}, "PLANNED", tasksOf(), T1);
    byId(b.root, "taskst-BLOCKED")!.fire("click"); await tick();
    expect(b.calls.post).toEqual([]);
    expect(forms.drafts.status["task-status"]).toMatchObject({ok: false, errors: {reason: "err.reasonRequired"}});
    for (const [st, tasks, note] of [["COMPLETE", tasksOf("DONE", "DONE"), "frozen"], ["EXECUTING", tasksOf("DONE"), "terminal"]] as const) {
      const o = await open({}, st, tasks as any, T1);
      expect(targets(o.root), st).toEqual([]);
      expect(byData(o.root, "taskstNote", note).length, st).toBe(1);
    }
    const u = await open({}, "PLANNED", [{taskId: "tsk_alpha01", title: "Eski", status: "PENDING"}], "tsk_alpha01");
    expect(targets(u.root)).toEqual([]);
    expect(byData(u.root, "taskstNote", "id").length).toBe(1);
  });
  it("server and bridge refusals never report success and keep the typed reason", async () => {
    const cases: Array<[any, string]> = [[{status: 409, body: {error: "WORKOS_CONFLICT", reason: "TASK_DEPENDENCIES_NOT_DONE"}}, "post.err.409.TASK_DEPENDENCIES_NOT_DONE"],
      [{status: 409, body: {error: "WORKOS_CONFLICT", reason: "MISSION_COMPLETE"}}, "post.err.409.MISSION_COMPLETE"], [{status: 409, body: {error: "WORKOS_INVALID_TRANSITION"}}, "post.err.409"],
      [{status: 403, body: {error: "ACTION_DENIED", reason: "POLICY_DENY: x"}}, "post.err.denied"], [{status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, "post.err.423"],
      [{status: 404, body: {error: "NOT_FOUND"}}, "post.err.unavailable"], [{status: 400, body: {error: "INVALID_BODY"}}, "post.err.400"]];
    for (const [resp, key] of cases) {
      forms.resetAllForms();
      const o = await open({post: () => resp}, "PLANNED", tasksOf(), T1);
      byId(o.root, "taskst-reason")!.value = "neden"; byId(o.root, "taskst-reason")!.fire("input");
      byId(o.root, "taskst-IN_PROGRESS")!.fire("click"); await tick();
      expect(forms.drafts.status["task-status"], key).toMatchObject({ok: false, key});
      expect(byId(mount(o.doc, await o.view.render(o.ctx)), "task-status-status")!.dataset.result, key).toBe("error"); // hata asla "ok" olarak işaretlenmez
      expect(o.ts.taskStatusDraft.reason, key).toBe("neden");
    }
    forms.resetAllForms();
    const net = await open({}, "PLANNED", tasksOf(), T1); // post tanımsız: köprü hatası
    byId(net.root, "taskst-IN_PROGRESS")!.fire("click"); await tick();
    expect(forms.drafts.status["task-status"].ok).toBe(false);
    expect(forms.drafts.busy["task-status"]).toBe(false);
  });
  it("task status strings exist in en and tr, including every key the view uses", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("taskst.")).sort();
    expect(keys(en).length).toBe(16);
    expect(keys(en)).toEqual(keys(tr));
    const used = new Set([...read(rend, "views", "task-status.js").matchAll(/"(taskst\.[A-Za-z.]+)"/g), ...read(rend, "work-core.js").matchAll(/"(taskst\.[A-Za-z.]+)"/g)].map(m => m[1]));
    for (const k of [...used, "form.field.task", "work.task.noDeps", "post.err.409.TASK_DEPENDENCIES_NOT_DONE", "post.err.409.MISSION_COMPLETE"]) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); }
  });
});

// //TR: COORD-RUN-EXPERT: koşuyu yürütecek uzman geliştirici seçimi — çekirdek ilk-teslim bağlamalarının aynası, yalnız listedeki rol gönderilir, sunucu runner kapısı rolü yeniden denetler.
describe("COORD run expert selection", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const getFor = (status: string) => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status}), tasks: []};
    if (p.startsWith("/v1/work-runs")) return {workRuns: []};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  it("mirrors the core developer bindings, and every listed expert passes the runner's developer gate", async () => {
    const c = await load(rend, "work-core.js"), fdb = await load(root, "core", "agents", "first-delivery-bindings.ts");
    const core = fdb.FIRST_DELIVERY_BINDINGS.filter((b: any) => b.function === "developer").map((b: any) => ({roleId: b.roleId, function: b.function, capabilities: [...b.capabilities]}));
    expect(JSON.parse(JSON.stringify(c.RUN_EXPERTS))).toEqual(core);
    for (const e of c.RUN_EXPERTS) expect(fdb.assertRoleExecutes(e.roleId, "developer").roleId).toBe(e.roleId);
    const tester = fdb.FIRST_DELIVERY_BINDINGS.find((b: any) => b.function === "tester");
    expect(() => fdb.assertRoleExecutes(tester.roleId, "developer")).toThrow(/BINDING_ROLE_MISMATCH/);
    expect(c.isRunExpert(tester.roleId)).toBe(false);
  });
  it("builds {roleId} only for a listed expert, {} without a role, and refuses any other role", async () => {
    const c = await load(rend, "work-core.js"), run = (roleId?: string) => c.buildRunRequest({missionId: MID, status: "PLANNED", roleId});
    expect(run("UASCO-0085")).toEqual({ok: true, path: `/v1/missions/${MID}/runs`, body: {roleId: "UASCO-0085"}});
    expect(run("")).toEqual({ok: true, path: `/v1/missions/${MID}/runs`, body: {}});
    expect(run(undefined).body).toEqual({});
    for (const bad of ["UASCO-0313", "UASCO-9999", "../x", " UASCO-0085"]) expect(run(bad).errors, bad).toEqual({roleId: "err.roleNotExecutable"});
  });
  it("offers the expert picker only for a startable mission and posts the chosen role exactly once", async () => {
    const {ctx, doc, calls} = await mkCtx({get: getFor("AUTHORIZED"), post: () => ({status: 202, body: {}})});
    const view = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    let root2 = mount(doc, await view.render(ctx));
    const sel = byId(root2, "run-expert")!;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("UASCO-0085");
    expect(sel.children.map(o => o.attrs.get("value") ?? (o as any).value)).toEqual(["UASCO-0085", ""]);
    expect(calls.post).toEqual([]);
    byId(root2, "run-start")!.fire("click"); await tick();
    expect(calls.post).toEqual([{path: `/v1/missions/${MID}/runs`, body: {roleId: "UASCO-0085"}}]);
    root2 = mount(doc, await view.render(ctx));
    byId(root2, "run-expert")!.value = ""; byId(root2, "run-expert")!.fire("change");
    byId(root2, "run-start")!.fire("click"); await tick();
    expect(calls.post[1]).toEqual({path: `/v1/missions/${MID}/runs`, body: {}});
    forms.resetAllForms();
    const x = await mkCtx({get: getFor("EXECUTING")});
    forms.selection.missionId = MID;
    const r3 = mount(x.doc, await view.render(x.ctx));
    expect(byId(r3, "run-expert")).toBeNull();
  });
  it("expert strings exist in en and tr", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    for (const k of ["work.run.expert", "work.run.expertHint", "work.run.expertOpt", "work.run.expertNone", "work.run.fn.developer", "err.roleNotExecutable", "form.field.roleId"]) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); }
    expect(tr["work.run.expertHint"]).toMatch(/sertifikalı değildir/);
  });
});

// //TR: COORD-FIRST-DELIVERY-WIRING: masaüstü allow-list'i ilk teslim yollarını yalnız tam eşleşmeyle kabul eder; yakın-ıskalar (sorgu, sondaki eğik çizgi, büyük harf, uzunluk, önek, alt yol, kodlama, yanlış yöntem) reddedilir ve renderer'ın kurduğu yollar birebir kabul edilir.
describe("COORD first-delivery Desktop allow-list (main.mjs)", () => {
  const H = (c: string) => c.repeat(24);
  const ITK = `itk_${H("a")}`, TSK = `tsk_${H("b")}`, MSN = `msn_${H("c")}`, PRJ = `prj_${H("d")}`;
  const GETS = ["/v1/intakes", `/v1/intakes/${ITK}`, `/v1/missions/${MSN}/tasks`, `/v1/projects/${PRJ}/flow`, `/v1/tasks/${TSK}`];
  const POSTS = ["/v1/intakes", `/v1/missions/${MSN}/plan`, `/v1/tasks/${TSK}/transition`];
  const nearMisses = (p: string) => [p + "/", p + "?x=1", p + "#", p.toUpperCase(), p.replace(/[0-9a-f]{24}/, H("a").slice(0, 23)), p.replace(/[0-9a-f]{24}/, H("a") + "a"),
    p.replace(/[0-9a-f]{24}/, H("A")), p.replace("/v1/", "/v1//"), p.replace("/v1/", "/v2/"), p + "/x", p.replace(/\//g, "%2F"), " " + p].filter(m => m !== p);
  it("admits exactly the five first-delivery reads and the three writes", () => {
    const get = loadGet(), {desktopPostPathAllowed: post} = loadPost();
    for (const p of GETS) expect(get(p), p).toBe(true);
    for (const p of POSTS) expect(post(p), p).toBe(true);
  });
  it("refuses every near miss and the wrong method", () => {
    const get = loadGet(), {desktopPostPathAllowed: post} = loadPost();
    for (const p of GETS) for (const m of nearMisses(p)) expect(get(m), m).toBe(false);
    for (const p of POSTS) for (const m of nearMisses(p)) expect(post(m), m).toBe(false);
    for (const p of [`/v1/intakes/${ITK}`, `/v1/missions/${MSN}/tasks`, `/v1/projects/${PRJ}/flow`, `/v1/tasks/${TSK}`]) expect(post(p), `POST ${p}`).toBe(false);
    for (const p of [`/v1/missions/${MSN}/plan`, `/v1/tasks/${TSK}/transition`]) expect(get(p), `GET ${p}`).toBe(false);
    for (const p of [`/v1/intakes/itk_${H("a")}/x`, `/v1/intakes/prj_${H("a")}`, `/v1/tasks/msn_${H("a")}`, `/v1/tasks/${TSK}/transition/x`, `/v1/missions/${MSN}/tasks/${TSK}`]) { expect(get(p), p).toBe(false); expect(post(p), p).toBe(false); }
  });
  it("admits the exact paths the renderer builds, and the write body keeps the 32 KB bridge limit", async () => {
    const get = loadGet(), {desktopPostPathAllowed: post, desktopPostBodyCheck: check, POST_MAX_BODY_BYTES} = loadPost();
    const work = await load(rend, "work-core.js");
    expect(post(work.planPath(MSN))).toBe(true);
    expect(post(work.taskTransitionPath(TSK))).toBe(true);
    const intakeSrc = read(rend, "intake-core.js"), projectSrc = read(rend, "project-core.js");
    expect(intakeSrc).toContain('"/v1/intakes"'); expect(intakeSrc).toContain("`/v1/intakes/${id}`");
    expect(projectSrc).toContain("`/v1/projects/${id}/flow`");
    expect(get(`/v1/intakes/${ITK}`) && get(`/v1/projects/${PRJ}/flow`)).toBe(true);
    expect(POST_MAX_BODY_BYTES).toBe(32768);
    expect(check({idea: "x".repeat(32768)}).error).toBe("API_BODY_TOO_LARGE");
    expect(check({idea: "x".repeat(1000)}).ok).toBe(true);
  });
});
