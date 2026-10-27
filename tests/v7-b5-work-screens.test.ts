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
    // LOW (review #226): #222 PROJECT_REPOSITORY_INIT_FAILED (HTTP 500) has its own text, in en and tr
    expect(d(500, "PROJECT_REPOSITORY_INIT_FAILED")).toMatchObject({ok: false, key: "post.err.500.PROJECT_REPOSITORY_INIT_FAILED"});
    expect(en["post.err.500.PROJECT_REPOSITORY_INIT_FAILED"]).toMatch(/repository/i); expect(tr["post.err.500.PROJECT_REPOSITORY_INIT_FAILED"]).toMatch(/depo/i);
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
  // //TR: A-RUNSTATE-1: canlı koşular artık yalnız sunucunun aktif-işçi kümesidir (LEASED/RUNNING/CHECKPOINTING/VERIFYING); QUEUED canlı değil (ayrı kova), STARTING/REVIEWING RunStatus olmadığı için canlı sayılmaz.
  it("live runs are the server worker-active run states only", async () => {
    const c = await load(rend, "work-core.js");
    const runs = ["RUNNING", "QUEUED", "FAILED", "COMPLETED", "AWAITING_APPROVAL", "LEASED", "CHECKPOINTING", "VERIFYING", "STARTING", "REVIEWING"].map((s, i) => ({runId: `run_${i}_000000`, status: s}));
    expect(c.liveRuns(runs).map((r: any) => r.status)).toEqual(["RUNNING", "LEASED", "CHECKPOINTING", "VERIFYING"]);
    expect(c.queuedRuns(runs).map((r: any) => r.status)).toEqual(["QUEUED"]);
    expect(c.liveRuns(undefined)).toEqual([]);
    expect(c.queuedRuns(undefined)).toEqual([]);
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
    // //TR: A-RUNSTATE-1: RUN_ACTIVE_STATES yerine RUN_LIVE_STATES + QUEUED (CHECKPOINTING için mstatus anahtarı eklendi).
    // //TR: #273 LOW: eski RUN_ACTIVE_STATES mstatus.STARTING'i zorunlu kılıyordu; STARTING dev-run durumu olarak kullanılmaya devam ettiği için anahtar burada açıkça zorunlu tutulur.
    for (const st of [...core.RUN_LIVE_STATES, core.RUN_QUEUED_STATE, "STARTING", "AWAITING_APPROVAL", "FAILED", "CANCELLED", "STOPPED"]) need.add(`mstatus.${st}`);
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
    if (p === "/v1/attention") return {attention: {items: [], counts: {RUN_AWAITING_APPROVAL: 0, MISSION_FOUNDER_ATTENTION: 0, RUN_NEEDS_DECISION: 0, MISSION_AUTHORIZATION_PENDING: 0, MISSION_BLOCKED: 0, TASK_BLOCKED: 0}, truncated: false, source: "WORKOS"}};
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
    // MASTER-V2 C-RDY-1 (#260, R1 TEST_REGISTRATION_APPEND): rol hazırlık denetçisi testi (core-readiness-*) de sona eklenir; sıra ve tekillik kuralı aynen geçerlidir.
    for (const later of step.command.slice(i + 1)) expect(later).toMatch(/^tests\/v7-(?:b([6-9]|\d{2,})[a-z]?|ps\d+[a-z]?|m1a|core-predev|core-readiness|ux)-[a-z0-9-]+\.test\.ts$/);
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
    const r = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "EXECUTING", tasksOf("IN_PROGRESS"), T1); // DONE artık açık onay ister (LANE-A task-done-confirm)
    expect(targets(r.root)).toEqual(["DONE", "BLOCKED", "PENDING"]);
    byId(r.root, "taskst-reason")!.value = " kabul testi geçti "; byId(r.root, "taskst-reason")!.fire("input");
    byId(r.root, "taskst-DONE")!.fire("click"); await tick();
    expect(r.calls.post[0].body).toEqual({to: "DONE", reason: "kabul testi geçti"});
    expect(r.calls.confirm.length).toBe(1);
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
  it("DONE asks for a confirmation first: accepted sends exactly one POST with the typed reason; declined sends nothing and says so", async () => {
    const yes = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    expect(byId(yes.root, "taskst-DONE")!.dataset.confirm).toBe("true");
    byId(yes.root, "taskst-reason")!.value = "tamam"; byId(yes.root, "taskst-reason")!.fire("input");
    byId(yes.root, "taskst-DONE")!.fire("click"); await tick();
    expect(yes.calls.confirm.length).toBe(1);
    expect(yes.calls.confirm[0].target).toContain(T1);
    expect(yes.calls.confirm[0].body).toContain("doğrulamaz"); // varsayılan dil tr: onay metni işi doğrulamadığını söyler
    expect(yes.calls.post).toEqual([{path: `/v1/tasks/${T1}/transition`, body: {to: "DONE", reason: "tamam"}}]);
    expect(forms.drafts.status["task-status"]).toMatchObject({ok: true, key: "taskst.done"});
    forms.resetAllForms();
    const no = await open({post: () => ({status: 200, body: {}}), confirm: () => false}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    byId(no.root, "taskst-reason")!.value = "tamam"; byId(no.root, "taskst-reason")!.fire("input");
    byId(no.root, "taskst-DONE")!.fire("click"); await tick();
    expect(no.calls.confirm.length).toBe(1);
    expect(no.calls.post).toEqual([]);
    expect(forms.drafts.status["task-status"]).toMatchObject({ok: false, key: "confirm.cancelled"});
    expect(byId(mount(no.doc, await no.view.render(no.ctx)), "task-status-status")!.dataset.result).toBe("error"); // iptal başarı gibi görünmez
    expect(no.ts.taskStatusDraft.reason).toBe("tamam"); // gerekçe korunur
    expect(forms.drafts.busy["task-status"]).toBeFalsy();
  });
  it("only DONE confirms: BLOCKED, PENDING and IN_PROGRESS never open the confirmation", async () => {
    const o = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    expect(byData(o.root, "taskTo").filter(n => n.dataset.confirm === "true").map(n => n.dataset.taskTo)).toEqual(["DONE"]);
    for (const to of ["BLOCKED", "PENDING"]) {
      byId(o.root, "taskst-reason")!.value = "neden"; byId(o.root, "taskst-reason")!.fire("input");
      byId(o.root, `taskst-${to}`)!.fire("click"); await tick();
    }
    expect(o.calls.confirm).toEqual([]);
    expect(o.calls.post.map((p: any) => p.body.to)).toEqual(["BLOCKED", "PENDING"]);
    const p = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "PLANNED", tasksOf(), T1);
    byId(p.root, "taskst-IN_PROGRESS")!.fire("click"); await tick();
    expect(p.calls.confirm).toEqual([]);
    expect(p.calls.post.length).toBe(1);
  });
  it("a DONE request that fails validation never opens the confirmation (and BLOCKED still needs a typed reason)", async () => {
    const o = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    byId(o.root, "taskst-reason")!.value = "r".repeat(1001); byId(o.root, "taskst-reason")!.fire("input");
    byId(o.root, "taskst-DONE")!.fire("click"); await tick();
    expect(o.calls.confirm).toEqual([]); expect(o.calls.post).toEqual([]);
    expect(forms.drafts.status["task-status"].errors).toEqual({reason: "taskst.err.reasonLong"});
    byId(o.root, "taskst-reason")!.value = ""; byId(o.root, "taskst-reason")!.fire("input");
    byId(o.root, "taskst-BLOCKED")!.fire("click"); await tick();
    expect(o.calls.post).toEqual([]);
    expect(forms.drafts.status["task-status"].errors).toEqual({reason: "err.reasonRequired"});
    const frozen = await open({post: () => ({status: 200, body: {}}), confirm: () => true}, "COMPLETE", tasksOf("IN_PROGRESS"), T1);
    expect(byId(frozen.root, "taskst-DONE")).toBeNull(); expect(frozen.calls.confirm).toEqual([]);
  });
  it("after a server refusal following an accepted confirmation, the result is an error and the reason is kept", async () => {
    const o = await open({post: () => ({status: 409, body: {error: "WORKOS_INVALID_TRANSITION"}}), confirm: () => true}, "EXECUTING", tasksOf("IN_PROGRESS"), T1);
    byId(o.root, "taskst-reason")!.value = "tamam"; byId(o.root, "taskst-reason")!.fire("input");
    byId(o.root, "taskst-DONE")!.fire("click"); await tick();
    expect(o.calls.confirm.length).toBe(1); expect(o.calls.post.length).toBe(1);
    expect(forms.drafts.status["task-status"]).toMatchObject({ok: false, key: "post.err.409"});
    expect(o.ts.taskStatusDraft.reason).toBe("tamam");
  });
  it("task status strings exist in en and tr, including every key the view uses", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("taskst.")).sort();
    expect(keys(en).length).toBe(20);
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
  it("builds {roleId} only for a listed expert, {} (the server then assigns the default developer role UASCO-0085) without one, and refuses any other role", async () => {
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
  it("the option that sends no roleId is labelled with the role the server then assigns (UASCO-0085, default), never as 'none', and still posts {}", async () => {
    for (const [lang, want] of [["en", ["UASCO-0085 · developer", "Server default (Developer UASCO-0085)"]], ["tr", ["UASCO-0085 · geliştirici", "Sunucu varsayılanı (Geliştirici UASCO-0085)"]]] as const) {
      forms.resetAllForms();
      const {ctx, doc, calls} = await mkCtx({lang, get: getFor("AUTHORIZED"), post: () => ({status: 202, body: {}})});
      const view = await load(rend, "views", "work.js");
      forms.selection.missionId = MID;
      const root2 = mount(doc, await view.render(ctx)), sel = byId(root2, "run-expert")!;
      expect(sel.children.map(o => o.textContent), lang).toEqual(want);
      expect(sel.children.map(o => o.attrs.get("value") ?? (o as any).value), lang).toEqual(["UASCO-0085", ""]);
      for (const o of sel.children) expect(o.textContent, lang).not.toMatch(/\bnone\b|without a role|atamadan|rolsüz/i);
      sel.value = ""; sel.fire("change");
      byId(root2, "run-start")!.fire("click"); await tick();
      expect(calls.post, lang).toEqual([{path: `/v1/missions/${MID}/runs`, body: {}}]);
    }
  });
  it("expert strings exist in en and tr", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    for (const k of ["work.run.expert", "work.run.expertHint", "work.run.expertOpt", "work.run.expertDefault", "work.run.fn.developer", "err.roleNotExecutable", "form.field.roleId"]) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); }
    expect(tr["work.run.expertHint"]).toMatch(/sertifikalı değildir/);
  });
});

// //TR: COORD-FIRST-DELIVERY-WIRING: masaüstü allow-list'i ilk teslim yollarını yalnız tam eşleşmeyle kabul eder; yakın-ıskalar (sorgu, sondaki eğik çizgi, büyük harf, uzunluk, önek, alt yol, kodlama, yanlış yöntem) reddedilir ve renderer'ın kurduğu yollar birebir kabul edilir.
describe("COORD first-delivery Desktop allow-list (main.mjs)", () => {
  const H = (c: string) => c.repeat(24);
  const ITK = `itk_${H("a")}`, TSK = `tsk_${H("b")}`, MSN = `msn_${H("c")}`, PRJ = `prj_${H("d")}`;
  const RUNID = `run_${H("e")}`;
  // Batch 4a: the run-scoped task list and project readiness are admitted (exact shapes, GET only).
  const GETS = ["/v1/intakes", `/v1/intakes/${ITK}`, `/v1/missions/${MSN}/tasks`, `/v1/projects/${PRJ}/flow`, `/v1/tasks/${TSK}`, `/v1/tasks/${TSK}/runs`, `/v1/work-runs/${RUNID}/tasks`, `/v1/projects/${PRJ}/readiness`];
  const POSTS = ["/v1/intakes", `/v1/missions/${MSN}/plan`, `/v1/tasks/${TSK}/transition`, `/v1/tasks/${TSK}/runs`];
  const nearMisses = (p: string) => [p + "/", p + "?x=1", p + "#", p.toUpperCase(), p.replace(/[0-9a-f]{24}/, H("a").slice(0, 23)), p.replace(/[0-9a-f]{24}/, H("a") + "a"),
    p.replace(/[0-9a-f]{24}/, H("A")), p.replace("/v1/", "/v1//"), p.replace("/v1/", "/v2/"), p + "/x", p.replace(/\//g, "%2F"), " " + p].filter(m => m !== p);
  it("admits exactly the six first-delivery reads and the four writes (task-run link included)", () => {
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
    // Task-run link: the run-scoped list is admitted for GET only (batch 4a); never as POST, and no other reverse shapes.
    expect(post(`/v1/work-runs/${RUNID}/tasks`)).toBe(false);
    for (const p of [`/v1/work-runs/${RUNID}/tasks/${TSK}`, `/v1/work-runs/run_${H("e")}x/tasks`, `/v1/projects/${PRJ}/readiness/x`]) { expect(get(p), p).toBe(false); expect(post(p), p).toBe(false); }
    for (const p of [`/v1/tasks/tsk_x/runs`, `/v1/tasks/${TSK}/runs/run_${H("e")}`, `/v1/tasks/${TSK}/run`]) { expect(get(p), p).toBe(false); expect(post(p), p).toBe(false); }
  });
  it("run-summaries list: bare path and the five known query keys only, with typed values (batch 4a)", () => {
    const get = loadGet(), {desktopPostPathAllowed: post} = loadPost();
    for (const p of ["/v1/run-summaries", `/v1/run-summaries?projectId=${PRJ}`, `/v1/run-summaries?projectId=${PRJ}&status=RUNNING&limit=10`, `/v1/run-summaries?missionId=${MSN}`]) expect(get(p), p).toBe(true);
    for (const p of ["/v1/run-summaries/", "/v1/run-summaries?x=1", "/v1/run-summaries?status=running", "/v1/run-summaries?projectId=prj_x", "/v1/run-summaries?limit=0", `/v1/run-summaries?projectId=${PRJ}&projectId=${PRJ}`, "/v1/run-summaries/run_x", "/v1//run-summaries"]) expect(get(p), p).toBe(false);
    expect(post("/v1/run-summaries")).toBe(false);
  });
  // Batch 4b: the analysis step/plan writes, the delivered-product status read and its start/stop writes (no restart), exact shapes only.
  it("batch 4b: admits the analysis step/plan and product start/stop writes and the product status read, nothing near them", () => {
    const get = loadGet(), {desktopPostPathAllowed: post} = loadPost();
    const G4 = [`/v1/work-runs/${RUNID}/product`], P4 = [`/v1/missions/${MSN}/analysis/step`, `/v1/missions/${MSN}/analysis/plan`, `/v1/work-runs/${RUNID}/product/start`, `/v1/work-runs/${RUNID}/product/stop`];
    for (const p of G4) { expect(get(p), p).toBe(true); expect(post(p), `POST ${p}`).toBe(false); for (const m of nearMisses(p)) expect(get(m), m).toBe(false); }
    for (const p of P4) { expect(post(p), p).toBe(true); expect(get(p), `GET ${p}`).toBe(false); for (const m of nearMisses(p)) expect(post(m), m).toBe(false); }
    for (const p of [`/v1/work-runs/${RUNID}/product/restart`, `/v1/missions/${MSN}/analysis`, `/v1/missions/${MSN}/analysis/steps`, `/v1/missions/${MSN}/analysis/step/x`, `/v1/missions/${MSN}/analysis/plans`, `/v1/missions/${MSN}/analysis/other`,
      `/v1/projects/${PRJ}/analysis/step`, `/v1/missions/${PRJ}/analysis/step`, `/v1/work-runs/${RUNID}/products`, `/v1/work-runs/${RUNID}/product/`, `/v1/work-runs/${RUNID}/product/start/x`, `/v1/work-runs/${MSN}/product/start`, `/v1/work-runs/${RUNID}/product/status`,
      `/v1/work-runs/${RUNID}/product?x=1`, `/v1/missions/${MSN}/analysis/step?x=1`, `/v1/work-runs/${RUNID}/product/stop?x=1`]) {
      expect(get(p), p).toBe(false); expect(post(p), p).toBe(false);
    }
  });
  it("batch 4b: server.ts imports and registers the analysis and product-run routes once, right after the pre-dev decision routes", () => {
    const server = fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8");
    for (const [name, file] of [["registerAnalysisRoutes", "analysis"], ["registerProductRunRoutes", "product-run"]]) {
      expect(server.match(new RegExp(`^import \\{${name}\\} from "\\./routes/${file}\\.js";$`, "gm"))?.length, name).toBe(1);
      expect(server.match(new RegExp(`${name}\\(app,`, "g"))?.length, name).toBe(1);
    }
    expect(server.match(/^import \{AnalysisFlow,NO_ANALYSIS_BUILDER,claudeAnalysisReadiness\} from "\.\.\/\.\.\/\.\.\/core\/workos\/crew\/analysis\.js";$/gm)?.length).toBe(1);
    // The flow is built per request with the route's own Global Stop check (stopped) combined with the server's closing flag, and the existing executor pair's pre-dev builder; the late-declared accessors are read lazily. builderTrace reads that same per-request builder's lastTrace (null without a builder), so the audit's builderRan is evidence-based.
    // The closing flag is declared once, before the lane registrations, and only a preClose hook sets it (app.close stops a running paid analysis call instead of waiting for its timeout).
    expect(server.match(/^let closing=false;app\.addHook\("preClose",async\(\)=>\{closing=true\}\);$/gm)?.length).toBe(1);
    expect(server.match(/\bclosing\s*=(?!=)/g)?.length).toBe(2);
    expect(server.indexOf("let closing=false;")).toBeLessThan(server.indexOf("registerIntakeRoutes(app,laneDeps);"));
    expect(server).toMatch(/registerPredevDecisionRoutes\(app,laneDeps\);\n\/\/ [^\n]*\nregisterAnalysisRoutes\(app,\{\.\.\.laneDeps,analysisFlow:\(stopped\)=>\{const c=getExecutors\(\)\.pair\?\.preDevBuilder\?\.\(\)\?\?null;return Object\.assign\(new AnalysisFlow\(\{store:getStore\(\),scope,builder:c\?\?NO_ANALYSIS_BUILDER,readiness:\(\)=>claudeAnalysisReadiness\(\{controlRoot,profile:\{forbiddenRoots:\[getStore\(\)\.dataDir\]\},cli:getExecSetup\(\)\.cliStatus\(\)\}\),stopped:\(\)=>closing\|\|stopped\(\)\}\),\{builderTrace:\(\)=>c\?\.lastTrace\?\?null\}\);\}\}\);\n\/\/ [^\n]*\nregisterProductRunRoutes\(app,\{\.\.\.laneDeps,devruns:\(\)=>getDevRuns\(\)\}\);\nregisterRoleStatusRoutes\(app,/);
  });
  it("server.ts registers the task-run link routes once, right after the task routes", () => {
    const server = fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8");
    expect(server.match(/^import \{registerTaskRunRoutes\} from "\.\/routes\/task-runs\.js";$/gm)?.length).toBe(1);
    expect(server.match(/registerTaskRunRoutes\(app,laneDeps\);/g)?.length).toBe(1);
    expect(server).toContain("registerTaskRoutes(app,laneDeps);\nregisterTaskRunRoutes(app,laneDeps);");
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

// //TR: LANE-A first-delivery: görev-koşu bağı (GET/POST /v1/tasks/:id/runs, Lane B) — sıkı eşleme, bağlanabilir koşular, yalnız {runId} gönderimi, dürüst UNAVAILABLE/ret durumları.
describe("LANE-A task run link", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const T1 = "tsk_" + "a1".repeat(12), R1 = "run_" + "01".repeat(12), R2 = "run_" + "02".repeat(12), R3 = "run_" + "03".repeat(12);
  const link = (runId: string, extra: any = {}) => ({link: {taskId: T1, runId, missionId: MID, linkedAt: "2026-10-21T10:00:00.000Z", linkedBy: "x", ...extra}, run: {runId, status: "RUNNING"}});
  const tasks = (status = "PENDING") => [{taskId: T1, title: "Giriş", status, dependsOn: []}];
  const runs = (ids: string[]) => ids.map(id => ({runId: id, missionId: MID, status: "BLOCKED"}));
  const open = async (o: CtxOpts & {linked?: any; missionRuns?: string[]; taskStatus?: string}) => {
    const get = (p: string) => {
      if (p === "/v1/projects") return {projects: [project()]};
      if (p === "/v1/missions") return {missions: [mission({status: "EXECUTING"})]};
      if (p === `/v1/missions/${MID}`) return {mission: mission({status: "EXECUTING"}), tasks: tasks(o.taskStatus)};
      if (p === `/v1/tasks/${T1}/runs`) return o.linked;
      if (p.startsWith("/v1/work-runs")) return {workRuns: runs(o.missionRuns ?? [])};
      if (p.startsWith("/v1/evidence")) return {evidence: []};
      return undefined;
    };
    const c = await mkCtx({...o, get, lang: "en"});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js"), tr = await load(rend, "views", "task-runs.js");
    tr.resetTaskRunsDraft(null);
    let root = mount(c.doc, await view.render(c.ctx));
    for (let i = 0; i < 2; i++) { byData(root, "taskInspect", T1)[0].fire("click"); root = mount(c.doc, await view.render(c.ctx)); if (byId(root, "task-runs")) break; }
    return {...c, view, tr, root};
  };

  it("maps the link read strictly and offers only unlinked, canonical, unique runs", async () => {
    const c = await load(rend, "work-core.js");
    const ok = c.mapTaskRuns({runs: [link(R1), {link: link(R2).link, run: null}]});
    expect(ok.state).toBe("VERIFIED"); expect(ok.items.map((i: any) => [i.runId, i.status])).toEqual([[R1, "RUNNING"], [R2, null]]);
    for (const bad of [null, {}, {runs: "x"}, {runs: [null]}, {runs: [{link: null}]}, {runs: [link("run_x")]}, {runs: [link(R1, {taskId: "tsk_x"})]}, {runs: [link(R1, {missionId: "msn_x"})]}]) expect(c.mapTaskRuns(bad as any).state, JSON.stringify(bad)?.slice(0, 50)).toBe("ERROR");
    expect(c.mapTaskRuns({runs: [link(R1, {linkedAt: "nope"})]}).items[0].linkedAt).toBeNull();
    const items = [{runId: R1, status: "A"}, {runId: R2, status: "B"}, {runId: R2, status: "B"}, {runId: "run_bad", status: "C"}, null, {runId: R3, status: "D"}];
    expect(c.linkableRuns(items, [{runId: R1}]).map((r: any) => r.runId)).toEqual([R2, R3]);
    expect(c.linkableRuns(null as any, null as any)).toEqual([]);
    expect(c.taskRunsPath(T1)).toBe(`/v1/tasks/${T1}/runs`); expect(c.taskRunsPath("tsk_alpha01")).toBeNull();
  });
  it("builds only {runId}, refuses a bad id, an unknown task and a done task", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.buildLinkRunRequest({taskId: T1, runId: R1, taskStatus: "PENDING"})).toEqual({ok: true, path: `/v1/tasks/${T1}/runs`, body: {runId: R1}, errors: {}});
    expect(c.buildLinkRunRequest({taskId: T1, runId: "x", taskStatus: "PENDING"}).errors).toEqual({runId: "taskruns.err.run"});
    expect(c.buildLinkRunRequest({taskId: "tsk_x", runId: R1, taskStatus: "PENDING"}).errors).toEqual({taskId: "taskruns.err.task"});
    expect(c.buildLinkRunRequest({taskId: T1, runId: R1, taskStatus: "DONE"}).errors).toEqual({taskId: "taskruns.err.done"});
    expect(c.buildLinkRunRequest({taskId: T1, runId: R1, taskStatus: "DONE"}).body).toBeNull();
  });
  it("lists the linked runs for the selected task, offers unlinked mission runs, and sends nothing until the button is pressed", async () => {
    const o = await open({linked: {runs: [link(R1)]}, missionRuns: [R1, R2, R3]});
    const panel = byId(o.root, "task-runs")!;
    expect(panel.dataset.taskRunsFor).toBe(T1);
    expect(byData(panel, "taskRun").map(n => n.dataset.taskRun)).toEqual([R1]);
    const sel = byId(o.root, "taskruns-run")!;
    expect(all(sel).filter(n => n.tagName === "OPTION").map(n => n.attrs.get("value") ?? n.value)).toEqual([R2, R3]);
    expect(o.calls.post).toEqual([]);
    expect(o.calls.get).toContain(`/v1/tasks/${T1}/runs`);
  });
  it("a linked run whose record cannot be read says so instead of showing a status", async () => {
    const o = await open({linked: {runs: [link(R1), {link: link(R2).link, run: null}]}, missionRuns: [R1, R2]});
    const rows = byData(o.root, "taskRun");
    expect(rows.map(n => n.dataset.taskRun)).toEqual([R1, R2]);
    expect(text(rows[0])).toContain("Running"); expect(text(rows[0])).not.toContain("not readable");
    expect(text(rows[1])).toContain("run record not readable"); expect(text(rows[1])).not.toContain("Running");
  });
  const RES = (over: any = {}) => ({taskId: T1, from: "IN_PROGRESS", to: "DONE", action: "TRANSITIONED", reason: null, ...over});
  const RECON = (results: any[], over: any = {}) => ({runId: R1, runStatus: "SUCCEEDED", results, ...over});
  it("builds the reconcile request with an EMPTY body and a canonical run id only", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.buildReconcileRequest({runId: R1})).toEqual({ok: true, path: `/v1/work-runs/${R1}/tasks/reconcile`, body: {}, errors: {}});
    for (const bad of ["x", "", null, "run_x", "RUN_" + "01".repeat(12), R1 + "/", [R1]]) { const r = c.buildReconcileRequest({runId: bad as any}); expect(r.ok, String(bad)).toBe(false); expect(r.body).toBeNull(); expect(r.errors).toEqual({runId: "taskruns.err.run"}); }
    expect(c.reconcilePath(R1 + "?x=1")).toBeNull();
  });
  it("maps the reconcile answer strictly; one malformed row makes the whole answer ERROR", async () => {
    const c = await load(rend, "work-core.js");
    const ok = c.mapReconcile(RECON([RES(), RES({taskId: "tsk_" + "b2".repeat(12), action: "UNCHANGED", from: "PENDING", to: "PENDING", reason: "RUN_QUEUED"})]), T1);
    expect(ok.state).toBe("VERIFIED"); expect(ok.mine).toMatchObject({taskId: T1, action: "TRANSITIONED", to: "DONE"}); expect(ok.othersTransitioned).toBe(0);
    expect(c.mapReconcile(RECON([RES(), RES({taskId: "tsk_" + "b2".repeat(12)})]), T1).othersTransitioned).toBe(1);
    expect(c.mapReconcile(RECON([RES()]), "tsk_" + "c3".repeat(12)).mine).toBeNull();
    const bads = [null, [], {}, RECON([], {runId: "run_x"}), RECON([], {runStatus: "bad"}), RECON([], {runStatus: 5}), {runId: R1, runStatus: "SUCCEEDED"}, RECON("x" as any), RECON(Array.from({length: 501}, () => RES())),
      RECON([null]), RECON([RES({taskId: "tsk_x"})]), RECON([RES({from: "NOPE"})]), RECON([RES({to: "NOPE"})]), RECON([RES({action: "DONE"})]), RECON([RES({reason: "lower"})]), RECON([RES({reason: 5})]), RECON([RES(), null])];
    for (const b of bads) expect(c.mapReconcile(b as any, T1).state, JSON.stringify(b)?.slice(0, 60)).toBe("ERROR");
    expect(c.mapReconcile(RECON(Array.from({length: 500}, () => RES())), T1).state).toBe("VERIFIED");
  });
  it("classifies the POST outcome: not enabled (refused path, 404/501/403 without a server error code), result, invalid, failed", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.classifyReconcile({ok: false, thrown: true, message: "INVALID_API_PATH"}, T1).kind).toBe("NOT_ENABLED");
    expect(c.classifyReconcile({ok: false, thrown: true, message: "BRIDGE_UNAVAILABLE"}, T1).kind).toBe("FAILED");
    for (const st of [404, 501]) expect(c.classifyReconcile({ok: false, status: st, body: {error: "Not Found"}}, T1).kind, String(st)).toBe("NOT_ENABLED");
    expect(c.classifyReconcile({ok: false, status: 404, body: {error: "OUTCOME_RUN_NOT_FOUND"}}, T1).kind).toBe("FAILED");
    expect(c.classifyReconcile({ok: false, status: 404, body: {error: "RUN_NOT_FOUND"}}, T1).kind).toBe("FAILED");
    expect(c.classifyReconcile({ok: false, status: 403, body: {}}, T1).kind).toBe("NOT_ENABLED");
    expect(c.classifyReconcile({ok: false, status: 403, body: {error: "ACTION_DENIED", reason: "x"}}, T1).kind).toBe("FAILED");
    for (const st of [400, 409, 423, 500, 503]) expect(c.classifyReconcile({ok: false, status: st, body: {}}, T1).kind, String(st)).toBe("FAILED");
    expect(c.classifyReconcile(null, T1).kind).toBe("FAILED");
    expect(c.classifyReconcile({ok: true, status: 200, body: RECON([RES()])}, T1)).toMatchObject({kind: "RESULT", runStatus: "SUCCEEDED"});
    expect(c.classifyReconcile({ok: true, status: 200, body: {runId: "x"}}, T1).kind).toBe("INVALID");
  });
  it("turns a reconcile result into a status key without inventing anything", async () => {
    const c = await load(rend, "work-core.js");
    const k = (results: any[]) => c.reconcileStatusKey(c.mapReconcile(RECON(results), T1));
    expect(k([RES()])).toEqual({key: "taskruns.recon.transitioned", vars: {from: "IN_PROGRESS", to: "DONE", others: 0}});
    expect(k([RES({action: "UNCHANGED", from: "PENDING", to: "PENDING", reason: "RUN_QUEUED"})])).toEqual({key: "taskruns.recon.unchanged", vars: {reason: "RUN_QUEUED", others: 0}});
    expect(k([RES({action: "UNCHANGED", reason: null})]).vars.reason).toBe("—");
    for (const r of c.RECON_SKIP_REASONS) expect(k([RES({action: "SKIPPED", reason: r})]).key, r).toBe(`taskruns.recon.skipped.${r}`);
    expect(k([RES({action: "SKIPPED", reason: "SOMETHING_NEW"})])).toEqual({key: "taskruns.recon.skipped", vars: {reason: "SOMETHING_NEW", others: 0}});
    expect(k([RES({action: "SKIPPED", reason: null})]).vars.reason).toBe("—");
    expect(k([RES({taskId: "tsk_" + "b2".repeat(12)})])).toEqual({key: "taskruns.recon.noMine", vars: {others: 1}});
  });
  const press = async (o: any) => { byId(o.root, "taskreconcile-submit")!.fire("click"); await tick(); await tick(); return mount(o.doc, await o.view.render(o.ctx)); };
  it("the update button sits on the latest linked run only, sends an empty body, and reports the server's own answer", async () => {
    const o = await open({linked: {runs: [link(R1), link(R2, {linkedAt: "2026-10-21T11:00:00.000Z"})]}, missionRuns: [R1, R2], taskStatus: "IN_PROGRESS", post: (p: string, b: any) => ({status: 200, body: RECON([RES()], {runId: R2})})});
    const btns = all(o.root).filter(n => n.id === "taskreconcile-submit");
    expect(btns).toHaveLength(1); expect(btns[0].dataset.reconcileRun).toBe(R2);
    expect(o.calls.post).toEqual([]);
    const after = await press(o);
    expect(o.calls.post).toEqual([{path: `/v1/work-runs/${R2}/tasks/reconcile`, body: {}}]);
    const st = byId(after, "task-reconcile-status")!; expect(st.dataset.result).toBe("ok");
    expect(text(st)).toContain("IN_PROGRESS to DONE");
  });
  it("without the allow-list entry or route it says 'Not enabled' and shows no result", async () => {
    for (const post of [() => { throw new Error("INVALID_API_PATH"); }, () => ({status: 404, body: {error: "Not Found"}}), () => ({status: 403, body: {}})]) {
      const o = await open({linked: {runs: [link(R1)]}, missionRuns: [R1], taskStatus: "IN_PROGRESS", post});
      const after = await press(o);
      const st = byId(after, "task-reconcile-status")!; expect(st.dataset.result).toBe("error");
      expect(text(st)).toContain("Not enabled"); expect(text(st)).not.toContain("moved this task");
    }
  });
  it("a 2xx answer that does not parse is reported as unreadable, and a policy denial is reported as denial (not as 'not enabled')", async () => {
    const o = await open({linked: {runs: [link(R1)]}, missionRuns: [R1], taskStatus: "IN_PROGRESS", post: () => ({status: 200, body: {runId: "x"}})});
    expect(text(byId(await press(o), "task-reconcile-status")!)).toContain("could not be read as a valid result");
    const d = await open({linked: {runs: [link(R1)]}, missionRuns: [R1], taskStatus: "IN_PROGRESS", post: () => ({status: 403, body: {error: "ACTION_DENIED", reason: "GLOBAL_STOP"}})});
    const t = text(byId(await press(d), "task-reconcile-status")!); expect(t).not.toContain("Not enabled");
  });
  it("mirrors the server rule that maps a run result to the task (every known run status; unknown or unreadable status implies nothing)", async () => {
    const c = await load(rend, "work-core.js");
    const expected: Record<string, string> = {SUCCEEDED: "DONE", FAILED: "BLOCKED", RECOVERY_FAILED: "BLOCKED", CANCELLED: "BLOCKED", QUARANTINED: "BLOCKED", BLOCKED: "BLOCKED", CREATED: "NONE", QUEUED: "NONE"};
    for (const st of c.RUN_TASK_STATUSES) expect(c.taskTargetForRun(st), st).toBe(expected[st] ?? "IN_PROGRESS");
    expect(c.RUN_TASK_STATUSES).toHaveLength(18);
    // The renderer copy must stay equal to the server rule (core/workos/task-outcome.ts), status by status.
    const server = await import("../core/workos/task-outcome.js");
    for (const st of c.RUN_TASK_STATUSES) expect(c.taskTargetForRun(st), st).toBe(server.targetForRun(st) ?? "NONE");
    for (const bad of [null, undefined, "", "succeeded", "WHATEVER", 5, ["SUCCEEDED"]]) expect(c.taskTargetForRun(bad as any), String(bad)).toBeNull();
    expect(c.taskFollowsRun([{runId: R1, status: "FAILED"}, {runId: R2, status: "RUNNING"}, {runId: R3, status: null}])).toEqual([{runId: R1, governing: false, target: "BLOCKED"}, {runId: R2, governing: false, target: "IN_PROGRESS"}, {runId: R3, governing: true, target: null}]);
    expect(c.taskFollowsRun([{runId: R1, status: "SUCCEEDED"}])).toEqual([{runId: R1, governing: true, target: "DONE"}]);
    expect(c.taskFollowsRun(null as any)).toEqual([]);
  });
  it("shows the server rule only for the latest linked run, marks older runs as superseded, and never claims a transition happened", async () => {
    const mk = (id: string, st: string | null, at: string) => ({link: {taskId: T1, runId: id, missionId: MID, linkedAt: at, linkedBy: "x"}, run: st ? {runId: id, status: st} : null});
    const o = await open({linked: {runs: [mk(R1, "FAILED", "2026-10-21T09:00:00.000Z"), mk(R2, "SUCCEEDED", "2026-10-21T10:00:00.000Z")]}, missionRuns: [R1, R2]});
    const rows = byData(o.root, "taskRun");
    expect(rows.map(n => n.dataset.taskRunGoverning)).toEqual(["0", "1"]);
    expect(byData(rows[0], "taskRunFollow").map(n => n.dataset.taskRunFollow)).toEqual(["superseded"]);
    expect(byData(rows[1], "taskRunFollow").map(n => n.dataset.taskRunFollow)).toEqual(["DONE"]);
    expect(text(rows[1])).toContain("By the server rule"); expect(text(rows[1])).toContain("Done");
    expect(text(rows[0])).toContain("newer linked run governs");
    expect(o.calls.post).toEqual([]);
    const u = await open({linked: {runs: [mk(R1, null, "2026-10-21T10:00:00.000Z")]}, missionRuns: [R1]});
    expect(byData(byData(u.root, "taskRun")[0], "taskRunFollow").map(n => n.dataset.taskRunFollow)).toEqual(["unknown"]);
    const n = await open({linked: {runs: [mk(R1, "QUEUED", "2026-10-21T10:00:00.000Z")]}, missionRuns: [R1]});
    expect(byData(byData(n.root, "taskRun")[0], "taskRunFollow").map(x => x.dataset.taskRunFollow)).toEqual(["none"]);
  });
  it("links the chosen run with exactly {runId} and reports success without claiming anything started", async () => {
    const o = await open({linked: {runs: []}, missionRuns: [R1, R2], post: () => ({status: 201, body: {link: link(R2).link}})});
    const sel = byId(o.root, "taskruns-run")!; sel.value = R2; sel.fire("change");
    byId(o.root, "taskruns-submit")!.fire("click"); await tick();
    expect(o.calls.post).toEqual([{path: `/v1/tasks/${T1}/runs`, body: {runId: R2}}]);
    expect(forms.drafts.status["task-runs"]).toMatchObject({ok: true, key: "taskruns.done"});
    expect(o.calls.refresh).toBe(1);
  });
  it("shows honest states: unreachable read, nothing linked, no unlinked run, done task, unreadable mission runs", async () => {
    const un = await open({linked: undefined, missionRuns: [R1]});
    expect(text(byId(un.root, "task-runs")!)).toContain("cannot be read from the desktop yet");
    expect(byId(un.root, "taskruns-submit")).toBeNull(); // okunamayan bağda yazma sunulmaz
    const bad = await open({linked: {runs: [{link: null}]}, missionRuns: [R1]});
    expect(byId(bad.root, "taskruns-submit")).toBeNull(); expect(byData(bad.root, "taskRun")).toEqual([]);
    const none = await open({linked: {runs: []}, missionRuns: []});
    expect(text(byId(none.root, "task-runs")!)).toContain("No run is linked to this task");
    expect(byData(none.root, "taskrunsNote", "noUnlinked").length).toBe(1);
    const done = await open({linked: {runs: []}, missionRuns: [R1], taskStatus: "DONE"});
    expect(byData(done.root, "taskrunsNote", "done").length).toBe(1); expect(byId(done.root, "taskruns-submit")).toBeNull();
  });
  it("server refusals (409 mismatch / not linkable, 403, 423, 404, unreachable) never report success and keep the list unchanged", async () => {
    const cases: Array<[any, string]> = [[{status: 409, body: {error: "RUN_MISSION_MISMATCH"}}, "post.err.409"], [{status: 409, body: {error: "TASK_NOT_LINKABLE"}}, "post.err.409"], [{status: 403, body: {error: "FORBIDDEN"}}, "post.err.auth"],
      [{status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, "post.err.423"], [{status: 404, body: {error: "RUN_NOT_FOUND"}}, "post.err.unavailable"]];
    for (const [resp, key] of cases) {
      forms.resetAllForms();
      const o = await open({linked: {runs: []}, missionRuns: [R1], post: () => resp});
      byId(o.root, "taskruns-submit")!.fire("click"); await tick();
      expect(forms.drafts.status["task-runs"], key).toMatchObject({ok: false, key});
    }
    forms.resetAllForms();
    const net = await open({linked: {runs: []}, missionRuns: [R1]});
    byId(net.root, "taskruns-submit")!.fire("click"); await tick();
    expect(forms.drafts.status["task-runs"].ok).toBe(false); expect(forms.drafts.busy["task-runs"]).toBe(false);
  });
  it("task run strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("taskruns.") || k.startsWith("flow.taskRuns"));
    expect(keys.length).toBe(33);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: LANE-A first-delivery: koşu hazırlığı ve bloklu koşu nedenleri — kayıttan okunan eksikler kesin uyarıdır, "kayıtlı" garanti vermez, okunamayan kayıt UNKNOWN der; bilinen BLOK nedenleri açıklanır.
describe("LANE-A run readiness and block reasons", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const get = (proj: any, mis: any, runs: any[] = []) => (p: string) => {
    if (p === "/v1/projects") return {projects: proj === null ? [] : [proj]};
    if (p === "/v1/missions") return {missions: [mis]};
    if (p === `/v1/missions/${MID}`) return {mission: mis, tasks: []};
    if (p.startsWith("/v1/work-runs/")) { const r = runs.find(x => p === `/v1/work-runs/${x.runId}`); return r ? {workRun: r} : undefined; }
    if (p.startsWith("/v1/work-runs")) return {workRuns: runs};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  const render = async (proj: any, mis: any, runs: any[] = []) => {
    const c = await mkCtx({get: get(proj, mis, runs), lang: "en"});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js");
    return {...c, root: mount(c.doc, await view.render(c.ctx))};
  };
  const readiness = (root: N) => byId(root, "run-readiness");

  it("runReadiness: missing repository / remote url / missing test command are definite blockers; recorded makes no promise; unreadable is UNKNOWN", async () => {
    const c = await load(rend, "work-core.js");
    const P = (x: any = {}) => ({repositoryPath: "C:\\r", remoteRepository: false, testCommandSet: false, ...x});
    expect(c.runReadiness({project: P(), mission: {testCommandSet: true}})).toEqual({repository: "RECORDED", testCommand: "RECORDED", blockers: []});
    expect(c.runReadiness({project: P({testCommandSet: true}), mission: {testCommandSet: false}}).testCommand).toBe("RECORDED"); // proje komutu da sayılır (runner mission ?? project)
    expect(c.runReadiness({project: P({repositoryPath: null}), mission: {testCommandSet: true}})).toEqual({repository: "MISSING", testCommand: "RECORDED", blockers: ["REPOSITORY_NOT_CONFIGURED"]});
    expect(c.runReadiness({project: P({repositoryPath: null, remoteRepository: true}), mission: {testCommandSet: true}}).blockers).toEqual(["REMOTE_REPO_NOT_SUPPORTED_YET"]);
    expect(c.runReadiness({project: P(), mission: {testCommandSet: false}}).blockers).toEqual(["TEST_COMMAND_NOT_CONFIGURED"]);
    expect(c.runReadiness({project: P({repositoryPath: null}), mission: {testCommandSet: false}}).blockers).toEqual(["REPOSITORY_NOT_CONFIGURED", "TEST_COMMAND_NOT_CONFIGURED"]);
    expect(c.runReadiness({project: null, mission: {testCommandSet: true}})).toEqual({repository: "UNKNOWN", testCommand: "RECORDED", blockers: []});
    expect(c.runReadiness({project: null, mission: {testCommandSet: false}})).toEqual({repository: "UNKNOWN", testCommand: "UNKNOWN", blockers: []}); // proje okunamadı: test komutu yokluğu kesin değil
    expect(c.runReadiness({project: P(), mission: null})).toEqual({repository: "RECORDED", testCommand: "UNKNOWN", blockers: []});
    expect(c.runReasonHintKey("REPOSITORY_NOT_CONFIGURED")).toBe("run.reason.REPOSITORY_NOT_CONFIGURED");
    for (const k of ["TEST_COMMAND_NOT_CONFIGURED", "REMOTE_REPO_NOT_SUPPORTED_YET", "PROJECT_NOT_FOUND", "MISSION_NOT_FOUND"]) expect(c.runReasonHintKey(k), k).toBe(`run.reason.${k}`);
    for (const k of ["SANDBOX_UNAVAILABLE", "SOMETHING_ELSE", "", null, undefined, 5, "__proto__"]) expect(c.runReasonHintKey(k as any), String(k)).toBeNull();
  });
  it("mappers carry only booleans for the test command and remote repository, never the command or URL", async () => {
    const m = await load(rend, "model.js"), c = await load(rend, "work-core.js");
    const p = m.mapProjects({projects: [{projectId: PID, name: "A", repository: {url: "https://x/y.git"}, testCommand: ["node", "--test"]}, {projectId: "prj_" + "b".repeat(24), name: "B", repository: {path: "C:\\r"}}]}).items;
    expect(p[0]).toMatchObject({repositoryPath: null, remoteRepository: true, testCommandSet: true});
    expect(p[1]).toMatchObject({repositoryPath: "C:\\r", remoteRepository: false, testCommandSet: false});
    expect(JSON.stringify(p)).not.toContain("--test"); expect(JSON.stringify(p)).not.toContain("x/y.git");
    expect(c.mapMissionDetail({mission: mission({testCommand: ["npm", "test"]}), tasks: []}).mission.testCommandSet).toBe(true);
    expect(c.mapMissionDetail({mission: mission({testCommand: []}), tasks: []}).mission.testCommandSet).toBe(false);
    expect(c.mapMissionDetail({mission: mission(), tasks: []}).mission.testCommandSet).toBe(false);
  });
  it("shows the missing repository and test command before a run, only for startable missions, without sending anything", async () => {
    const noRepo = await render(project({repository: null}), mission({status: "AUTHORIZED"}));
    expect(readiness(noRepo.root)!.dataset.runReadiness).toBe("BLOCKERS");
    expect(readiness(noRepo.root)!.dataset.runBlockers).toBe("REPOSITORY_NOT_CONFIGURED,TEST_COMMAND_NOT_CONFIGURED");
    expect(text(readiness(noRepo.root)!)).toContain("A run would stop at REPOSITORY_NOT_CONFIGURED");
    expect(text(readiness(noRepo.root)!)).toContain("A run would stop at TEST_COMMAND_NOT_CONFIGURED");
    expect(noRepo.calls.post).toEqual([]);
    const ok = await render(project(), mission({status: "AUTHORIZED", testCommand: ["node", "--test"]}));
    expect(readiness(ok.root)!.dataset.runReadiness).toBe("RECORDED");
    expect(text(readiness(ok.root)!)).toContain("does not guarantee");
    expect(text(readiness(ok.root)!)).not.toContain("--test");
    const unk = await render(null, mission({status: "AUTHORIZED"}));
    expect(readiness(unk.root)!.dataset.runReadiness).toBe("UNKNOWN");
    expect(text(readiness(unk.root)!)).toContain("readiness is unknown");
    const draft = await render(project({repository: null}), mission({status: "DRAFT"}));
    expect(readiness(draft.root)).toBeNull(); // başlatılamayan mission'da not yok
    const remote = await render(project({repository: {url: "https://x/y.git"}}), mission({status: "AUTHORIZED", testCommand: ["node"]}));
    expect(readiness(remote.root)!.dataset.runBlockers).toBe("REMOTE_REPO_NOT_SUPPORTED_YET");
  });
  it("run cards explain known block reasons next to the code, keep the sandbox text, and show unknown reasons verbatim", async () => {
    const mk = (reason: string) => [{runId: RUN, missionId: MID, status: "BLOCKED", reason}];
    for (const [reason, expected] of [["REPOSITORY_NOT_CONFIGURED", "no code repository attached"], ["TEST_COMMAND_NOT_CONFIGURED", "no usable test command"], ["REMOTE_REPO_NOT_SUPPORTED_YET", "remote repository address"], ["SANDBOX_UNAVAILABLE", "no verified sandbox"]] as const) {
      const o = await render(project(), mission({status: "EXECUTING"}), mk(reason));
      const cell = byData(o.root, "runReason", reason)[0];
      expect(cell, reason).toBeDefined();
      expect(text(cell), reason).toContain(`${reason} —`); expect(text(cell), reason).toContain(expected);
    }
    const unk = await render(project(), mission({status: "EXECUTING"}), mk("SOMETHING_NEW"));
    expect(text(byData(unk.root, "runReason", "SOMETHING_NEW")[0])).toBe("SOMETHING_NEW");
  });
  it("readiness and reason strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("run.ready.") || /^run\.reason\.(REPOSITORY|TEST_COMMAND|REMOTE|PROJECT|MISSION)/.test(k));
    expect(keys.length).toBe(11);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: LANE-A first-delivery: koşu adımları tablosu — yalnız sunucunun kaydettiği olgular (adım, döngü, çıkış kodu, süre, zaman aşımı); çıkış kodu doğrulama sonucu değildir, eksik değer uydurulmaz.
describe("LANE-A run steps table", () => {
  const ev = (extra: any = {}) => ({evidenceId: "evd_" + "1".repeat(24), step: "VERIFY", cycle: 0, kind: "VERIFY_TESTS", argv: ["node", "--test"], startedAt: "2026-10-21T10:00:00.000Z", endedAt: "2026-10-21T10:00:03.250Z", exitCode: 0, logPath: null, logSha256: null, ...extra});
  const runOf = (evidence: any[]) => ({runId: RUN, missionId: MID, status: "RUNNING", step: "VERIFY", evidence});
  const render = async (evidence: any[]) => {
    const get = (p: string) => p === "/v1/projects" ? {projects: [project()]} : p === "/v1/missions" ? {missions: [mission({status: "EXECUTING"})]} : p === `/v1/missions/${MID}` ? {mission: mission({status: "EXECUTING"}), tasks: []}
      : p === `/v1/work-runs/${RUN}` ? {workRun: runOf(evidence)} : p.startsWith("/v1/work-runs") ? {workRuns: [runOf(evidence)]} : p.startsWith("/v1/evidence") ? {evidence: []} : undefined;
    const c = await mkCtx({get, lang: "en"});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js");
    return {...c, root: mount(c.doc, await view.render(c.ctx))};
  };
  const rows = (root: N) => byData(root, "runStepRow");

  it("maps only valid recorded facts: step code, cycle, integer exit code, timeout flag and ISO times; invalid values stay null", async () => {
    const c = await load(rend, "work-core.js");
    const m = c.mapWorkRun(runOf([ev(), ev({evidenceId: "evd_" + "2".repeat(24), step: "verify", cycle: -1, exitCode: 1.5, startedAt: "x", endedAt: null, timedOut: "yes"}), "evd_" + "3".repeat(24)])).evidence;
    expect(m[0]).toMatchObject({kind: "VERIFY_TESTS", step: "VERIFY", cycle: 0, exitCode: 0, timedOut: false, startedAt: "2026-10-21T10:00:00.000Z", endedAt: "2026-10-21T10:00:03.250Z"});
    expect(m[1]).toMatchObject({step: null, cycle: null, exitCode: null, timedOut: false, startedAt: null, endedAt: null});
    expect(m[2]).toMatchObject({kind: null}); // dize kimlik: adım bilgisi yok
    expect(c.evidenceDurationMs({startedAt: "2026-10-21T10:00:00.000Z", endedAt: "2026-10-21T10:00:03.250Z"})).toBe(3250);
    for (const bad of [{startedAt: "2026-10-21T10:00:05.000Z", endedAt: "2026-10-21T10:00:00.000Z"}, {startedAt: null, endedAt: "2026-10-21T10:00:00.000Z"}, {startedAt: "x", endedAt: "y"}, null, undefined]) expect(c.evidenceDurationMs(bad as any)).toBeNull();
    expect(c.runStepRows(m).map((r: any) => r.step)).toEqual(["VERIFY"]); // yalnız adım/zaman taşıyan kayıtlar
    expect(c.runStepRows(null as any)).toEqual([]);
  });
  it("renders one row per step record in recording order with exit code, start time and duration, and the not-a-verification-result note", async () => {
    const o = await render([ev({evidenceId: "evd_" + "1".repeat(24), step: "IMPLEMENT", kind: "EXECUTOR_RUN", exitCode: 0}), ev({evidenceId: "evd_" + "2".repeat(24), step: "VERIFY", exitCode: 1}), ev({evidenceId: "evd_" + "3".repeat(24), step: "VERIFY", cycle: 1, exitCode: null, timedOut: true, endedAt: null})]);
    const r = rows(o.root);
    expect(r.map(n => n.textContent.includes("IMPLEMENT") ? "IMPLEMENT" : "VERIFY")).toEqual(["IMPLEMENT", "VERIFY", "VERIFY"]);
    expect(r.map(n => n.dataset.runStepExit)).toEqual(["0", "1", ""]);
    expect(text(r[0])).toContain("exit 0"); expect(text(r[0])).toContain("3.3 s");
    expect(text(r[1])).toContain("exit 1");
    expect(r[2].dataset.runStepTimedOut).toBe("1"); expect(text(r[2])).toContain("timed out"); expect(text(r[2])).not.toContain("exit");
    expect(text(r[2])).toContain("—"); // süre bilinmiyor
    const t = text(byData(o.root, "runSteps", RUN)[0].parent!);
    expect(t).toContain("not a verification result");
    for (const row of r) expect(text(row)).not.toMatch(/pass|success|ok\b/i); // satırlar başarı/geçti demez: yalnız bildirilen çıkış kodu
  });
  it("shows no table when no evidence record carries step data, and renders hostile text as text", async () => {
    const none = await render([]);
    expect(rows(none.root)).toEqual([]); expect(byData(none.root, "runSteps")).toEqual([]);
    const strings = await render(["evd_" + "4".repeat(24)] as any);
    expect(byData(strings.root, "runSteps")).toEqual([]);
    const odd = await render([ev({kind: "<img src=x onerror=alert(1)>"})]);
    expect(rows(odd.root).length).toBe(1);
    expect(all(odd.root).some(n => n.tagName === "IMG")).toBe(false);
  });
  it("run steps strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("run.steps."));
    expect(keys.length).toBe(12);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: LANE-A A-RUN-TASK-LINK: koşu BAŞARIYLA başlatıldıktan sonra "koşuyu görevlere bağla" adımı. Görevleri yalnız Founder seçer (hepsi işaretsiz), DONE görevler sunulmaz, işaretli her görev için mevcut POST /v1/tasks/:id/runs {runId} çağrılır, görev başına sonuç ve kısmi başarısızlık görünür kalır; işaretli görev yoksa istek yoktur.
describe("LANE-A run -> task link step", () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const RID = "run_" + "ef".repeat(12), T = (c: string) => "tsk_" + c.repeat(24);
  const TASKS = [{taskId: T("1"), title: "Plan A", status: "PENDING"}, {taskId: T("2"), title: "Plan B", status: "IN_PROGRESS"}, {taskId: T("3"), title: "Plan C", status: "DONE"}, {taskId: T("4"), title: "Plan D", status: "BLOCKED"}];
  const linkPath = (t: string) => `/v1/tasks/${t}/runs`, startPath = `/v1/missions/${MID}/runs`;
  const getFor = (tasks: any[] = TASKS, status = "AUTHORIZED") => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status}), tasks};
    if (p.startsWith("/v1/work-runs")) return {workRuns: []};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  const started = (over: any = {}) => ({status: 201, body: {run: {runId: RID, missionId: MID, ...over}, hostExecutionNotice: {}}});
  const link = (taskId: string, status = 201, runId = RID) => ({status, body: {link: {taskId, runId, missionId: MID}}});
  const refuse = (error: string, status = 409) => ({status, body: {error}});
  const cbId = (t: string) => `runlink-cb-${t}`;
  async function open(post: (p: string, b: any) => any, tasks: any[] = TASKS, lang = "en") {
    const m = await mkCtx({get: getFor(tasks), post, lang});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js");
    const render = async () => mount(m.doc, await view.render(m.ctx));
    const o: any = {...m, view, render, root: await render()};
    o.start = async () => { byId(o.root, "run-start")!.fire("click"); await tick(); o.root = await render(); return o.root; };
    return o;
  }
  const check = (root: N, ...ids: string[]) => { for (const id of ids) byId(root, cbId(id))!.fire("change", {target: {checked: true}}); };
  const submit = async (o: any) => { byId(o.root, "runlink-submit")!.fire("click"); await tick(); o.root = await o.render(); return o.root; };

  it("parses a started run only from a 2xx body whose run id fits the schema and whose mission matches", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.parseStartedRun(started(), MID)).toBe(RID);
    expect(c.parseStartedRun({status: 200, body: started().body}, MID)).toBe(RID);
    for (const bad of [null, undefined, {thrown: true, state: "OFFLINE"}, {status: 409, body: started().body}, {status: 202, body: {}}, {status: 201, body: {run: {runId: "run_zz", missionId: MID}}}, {status: 201, body: {run: {runId: RID, missionId: MID2}}},
      {status: 201, body: {run: {runId: RID}}}, {status: 201, body: {run: null}}, {status: 201, body: []}, {status: "201", body: started().body}, {status: 201, body: {run: {runId: [RID], missionId: MID}}}, {status: 300, body: started().body}, {thrown: true, status: 201, body: started().body}]) expect(c.parseStartedRun(bad, MID), JSON.stringify(bad)).toBeNull();
  });
  it("offers only open tasks with valid ids: DONE tasks and bad ids are never listed; an unreadable status is shown as such, not guessed", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.linkableTasks(TASKS).map((t: any) => t.taskId)).toEqual([T("1"), T("2"), T("4")]);
    expect(c.linkableTasks([...TASKS, {taskId: "tsk_bad", title: "x", status: "PENDING"}, null, {title: "no id"}, {taskId: T("5"), title: 5, status: 7}])).toHaveLength(4);
    expect(c.linkableTasks([{taskId: T("5"), title: 5, status: 7}])).toEqual([{taskId: T("5"), title: "—", status: "—"}]);
    expect(c.linkableTasks(null)).toEqual([]);
    expect(c.linkableTasks([{taskId: T("3"), title: "x", status: "DONE"}])).toEqual([]);
  });
  it("classifies each link answer; the server's error code is carried verbatim and nothing is claimed on a mismatched or malformed answer", async () => {
    const c = await load(rend, "work-core.js"), cls = (res: any) => c.classifyLinkResult(res, T("1"), RID);
    expect(cls(link(T("1"), 201))).toEqual({kind: "LINKED"});
    expect(cls(link(T("1"), 200))).toEqual({kind: "ALREADY_LINKED"});
    for (const bad of [link(T("2"), 201), link(T("1"), 201, "run_" + "00".repeat(12)), {status: 201, body: {}}, {status: 200, body: {link: null}}, {status: 201, body: {link: []}}]) expect(cls(bad), JSON.stringify(bad)).toEqual({kind: "INVALID"});
    expect(cls(refuse("TASK_NOT_LINKABLE"))).toEqual({kind: "REFUSED", code: "TASK_NOT_LINKABLE", status: 409});
    expect(cls(refuse("RUN_MISSION_MISMATCH"))).toEqual({kind: "REFUSED", code: "RUN_MISSION_MISMATCH", status: 409});
    expect(cls(refuse("TASK_NOT_FOUND", 404))).toEqual({kind: "REFUSED", code: "TASK_NOT_FOUND", status: 404});
    expect(cls(refuse("LINK_STORE_CORRUPT", 503))).toEqual({kind: "REFUSED", code: "LINK_STORE_CORRUPT", status: 503});
    expect(cls(refuse("INVALID_BODY", 400))).toEqual({kind: "REFUSED", code: "INVALID_BODY", status: 400});
    expect(cls({status: 403, body: {error: "ACTION_DENIED"}})).toMatchObject({kind: "FAILED"}); // neden okunamıyorsa REFUSED/DENIED uydurulmaz
    expect(cls({status: 403, body: {error: "ACTION_DENIED", reason: "bad reason!"}})).toMatchObject({kind: "FAILED"});
    expect(cls({status: 403, body: {error: "FORBIDDEN"}})).toEqual({kind: "REFUSED", code: "FORBIDDEN", status: 403});
    expect(cls({status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}})).toEqual({kind: "STOPPED"});
    expect(cls({status: 403, body: {error: "ACTION_DENIED", reason: "NO_POLICY"}})).toEqual({kind: "DENIED", reason: "NO_POLICY"});
    expect(cls({thrown: true, state: "ERROR", message: "INVALID_API_PATH"})).toEqual({kind: "NOT_ENABLED"});
    for (const res of [null, {thrown: true, state: "OFFLINE", message: "fetch failed"}, {status: 500, body: {}}, {status: 409, body: {error: "<b>x</b>"}}, {status: 409, body: {error: "lower_case"}}, {status: 404, body: {}}])
      expect(cls(res), JSON.stringify(res)).toMatchObject({kind: "FAILED"});
  });
  it("after a SUCCESSFUL start the step appears with every open task UNCHECKED, DONE tasks absent, and nothing is sent until the Founder acts", async () => {
    const o = await open(p => p === startPath ? started() : undefined as any);
    expect(byId(o.root, "run-link")).toBeNull(); // başlatmadan önce yok
    await o.start();
    const panel = byId(o.root, "run-link")!;
    expect(panel.dataset.runId).toBe(RID);
    expect(text(byData(panel, "runlink", "lead")[0])).toContain(RID);
    expect(byData(panel, "runlinkItem").map(n => n.dataset.runlinkItem)).toEqual([T("1"), T("2"), T("4")]);
    for (const t of [T("1"), T("2"), T("4")]) expect(byId(o.root, cbId(t))!.hasAttribute("checked"), t).toBe(false);
    expect(byId(o.root, cbId(T("3")))).toBeNull();
    expect(text(panel)).not.toContain("Plan C");
    expect(o.calls.post).toEqual([{path: startPath, body: {roleId: "UASCO-0085"}}]);
  });
  it("a failed start offers no link step", async () => {
    for (const answer of [{status: 409, body: {error: "EXECUTOR_NOT_CONFIGURED"}}, {status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}]) {
      forms.resetAllForms();
      const o = await open(() => answer); await o.start();
      expect(byId(o.root, "run-link")).toBeNull();
    }
  });
  it("nothing checked: pressing the button sends NO request and says so", async () => {
    const o = await open(p => p === startPath ? started() : undefined as any); await o.start();
    await submit(o);
    expect(o.calls.post).toHaveLength(1); // yalnız koşu başlatma
    expect(forms.drafts.status[`runlink-${MID}`]).toMatchObject({ok: false, key: "runlink.noneChecked"});
    expect(text(byId(o.root, `runlink-${MID}-status`)!)).toBe("Nothing is checked, so nothing was sent.");
  });
  it("checked tasks are linked one by one with exactly {runId} on the existing endpoint; results are shown per task and the summary counts them", async () => {
    const o = await open((p, b) => p === startPath ? started() : p === linkPath(T("1")) ? link(T("1"), 201) : p === linkPath(T("4")) ? link(T("4"), 200) : undefined as any); await o.start();
    check(o.root, T("1"), T("4"));
    await submit(o);
    expect(o.calls.post).toEqual([{path: startPath, body: {roleId: "UASCO-0085"}}, {path: linkPath(T("1")), body: {runId: RID}}, {path: linkPath(T("4")), body: {runId: RID}}]);
    const res = (t: string) => byData(o.root, "runlinkItem", t)[0];
    expect(res(T("1")).dataset.runlinkState).toBe("LINKED"); expect(text(res(T("1")))).toContain("Linked.");
    expect(res(T("4")).dataset.runlinkState).toBe("ALREADY_LINKED"); expect(text(res(T("4")))).toContain("Already linked");
    expect(res(T("2")).dataset.runlinkState).toBe("IDLE");
    expect(text(byData(o.root, "runlink", "summary")[0])).toBe("2 linked, 0 not linked.");
    expect(byId(o.root, cbId(T("1")))!.hasAttribute("disabled")).toBe(true); // bağlanan görev kilitli
    expect(byId(o.root, cbId(T("2")))!.hasAttribute("disabled")).toBe(false);
  });
  it("a partial failure stays visible with the server's code; a later click retries ONLY the failed tasks (never the linked ones) and nothing is retried automatically", async () => {
    let fail4 = true;
    const o = await open((p) => p === startPath ? started() : p === linkPath(T("1")) ? link(T("1"), 201) : p === linkPath(T("2")) ? refuse("TASK_NOT_LINKABLE") : p === linkPath(T("4")) ? (fail4 ? refuse("TASK_NOT_FOUND", 404) : link(T("4"), 201)) : undefined as any); await o.start();
    check(o.root, T("1"), T("2"), T("4"));
    await submit(o);
    expect(o.calls.post.map((c: any) => c.path)).toEqual([startPath, linkPath(T("1")), linkPath(T("2")), linkPath(T("4"))]); // her görev bir kez
    const item = (t: string) => byData(o.root, "runlinkItem", t)[0];
    expect(item(T("1")).dataset.runlinkState).toBe("LINKED");
    expect(item(T("2")).dataset.runlinkState).toBe("REFUSED"); expect(text(item(T("2")))).toContain("Refused by the server: TASK_NOT_LINKABLE (HTTP 409). Not linked.");
    expect(item(T("4")).dataset.runlinkState).toBe("REFUSED"); expect(text(item(T("4")))).toContain("TASK_NOT_FOUND (HTTP 404)");
    expect(text(byData(o.root, "runlink", "summary")[0])).toBe("1 linked, 2 not linked.");
    expect(byData(o.root, "runlinkResult", "REFUSED").every(n => n.attrs.get("role") === "status")).toBe(true);
    // Hâlâ işaretli olan başarısızlar yalnız Founder yeniden bastığında denenir; T1 yeniden gönderilmez.
    fail4 = false;
    await submit(o);
    expect(o.calls.post.slice(4).map((c: any) => c.path)).toEqual([linkPath(T("2")), linkPath(T("4"))]);
    expect(item(T("4")).dataset.runlinkState).toBe("LINKED");
    expect(item(T("2")).dataset.runlinkState).toBe("REFUSED");
    expect(text(byData(o.root, "runlink", "summary")[0])).toBe("2 linked, 1 not linked.");
  });
  it("a Global Stop, a missing allow-list entry or a transport failure halts the batch: the remaining checked tasks are reported as NOT attempted, not as failures or successes", async () => {
    const cases: Array<[string, any]> = [["STOPPED", {status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}], ["NOT_ENABLED", "THROW_INVALID"], ["FAILED", "THROW_OFFLINE"]];
    for (const [kind, answer] of cases) {
      forms.resetAllForms();
      const post = (p: string) => { if (p === startPath) return started(); if (p === linkPath(T("1"))) return link(T("1"), 201); if (answer === "THROW_INVALID") throw new Error("INVALID_API_PATH"); if (answer === "THROW_OFFLINE") throw new Error("fetch failed"); return answer; };
      const o = await open(post); await o.start();
      check(o.root, T("1"), T("2"), T("4"));
      await submit(o);
      expect(o.calls.post.map((c: any) => c.path), kind).toEqual([startPath, linkPath(T("1")), linkPath(T("2"))]); // T4 hiç gönderilmedi
      const item = (t: string) => byData(o.root, "runlinkItem", t)[0];
      expect(item(T("1")).dataset.runlinkState, kind).toBe("LINKED");
      expect(item(T("2")).dataset.runlinkState, kind).toBe(kind);
      expect(item(T("4")).dataset.runlinkState, kind).toBe("NOT_ATTEMPTED");
      expect(text(item(T("4"))), kind).toContain("Not attempted");
      expect(text(byData(o.root, "runlink", "summary")[0]), kind).toBe("1 linked, 2 not linked.");
    }
  });
  it("unchecking removes a task from the batch; a task the server reported as already linked is not sent again; a new press clears the previous message", async () => {
    const o = await open((p) => p === startPath ? started() : p === linkPath(T("1")) ? link(T("1"), 200) : p === linkPath(T("2")) ? link(T("2"), 201) : undefined as any); await o.start();
    check(o.root, T("1"), T("2"));
    byId(o.root, cbId(T("2")))!.fire("change", {target: {checked: false}}); // geri alındı
    await submit(o);
    expect(o.calls.post.map((c: any) => c.path)).toEqual([startPath, linkPath(T("1"))]);
    expect(byData(o.root, "runlinkItem", T("1"))[0].dataset.runlinkState).toBe("ALREADY_LINKED");
    expect(byData(o.root, "runlinkItem", T("2"))[0].dataset.runlinkState).toBe("IDLE");
    check(o.root, T("2"));
    byId(o.root, "runlink-submit")!.fire("click"); await tick(); o.root = await o.render();
    expect(o.calls.post.map((c: any) => c.path)).toEqual([startPath, linkPath(T("1")), linkPath(T("2"))]); // T1 yeniden gönderilmedi
    // Eski "işaretli görev yok" iletisi yeni bir basışta silinir.
    forms.resetAllForms();
    const n = await open(p => p === startPath ? started() : p === linkPath(T("1")) ? link(T("1"), 201) : undefined as any); await n.start();
    await submit(n);
    expect(forms.drafts.status[`runlink-${MID}`].key).toBe("runlink.noneChecked");
    check(n.root, T("1")); await submit(n);
    expect(forms.drafts.status[`runlink-${MID}`]).toBeUndefined();
    expect(text(byId(n.root, `runlink-${MID}-status`)!)).toBe("");
  });
  it("submitRunLinks refuses to act for a mission or run it was not offered for (no request)", async () => {
    const act = await load(rend, "work-actions.js");
    const o = await open(p => p === startPath ? started() : undefined as any); await o.start();
    check(o.root, T("1"));
    const other = {missionId: MID2, tasks: TASKS};
    expect(await act.submitRunLinks(o.ctx, other)).toEqual({ok: false, validation: true});
    forms.drafts.runLink.runId = null;
    expect(await act.submitRunLinks(o.ctx, {missionId: MID, tasks: TASKS})).toEqual({ok: false, validation: true});
    expect(o.calls.post).toHaveLength(1);
  });
  it("while a batch is in flight the buttons are disabled and extra clicks send nothing", async () => {
    let release: (v: any) => void = () => {};
    const o = await open((p) => p === startPath ? started() : new Promise(r => { release = r; }) as any); await o.start();
    check(o.root, T("1"));
    const submitBtn = byId(o.root, "runlink-submit")!, closeBtn = byId(o.root, "runlink-close")!;
    submitBtn.fire("click"); await tick();
    submitBtn.fire("click"); submitBtn.fire("click"); closeBtn.fire("click"); await tick();
    expect(o.calls.post.map((c: any) => c.path)).toEqual([startPath, linkPath(T("1"))]);
    expect(forms.drafts.runLink.runId).toBe(RID); // kapatma istemi yutuldu
    o.root = await o.render();
    expect(byId(o.root, "runlink-submit")!.hasAttribute("disabled")).toBe(true);
    expect(byId(o.root, "runlink-close")!.hasAttribute("disabled")).toBe(true);
    release(link(T("1"), 201)); await tick(); await tick();
    o.root = await o.render();
    expect(byData(o.root, "runlinkItem", T("1"))[0].dataset.runlinkState).toBe("LINKED");
    expect(byId(o.root, "runlink-submit")!.hasAttribute("disabled")).toBe(false);
  });
  it("a start whose answer carries no readable run id for this mission offers NO link step and says why; no link request is possible", async () => {
    for (const answer of [{status: 202, body: {}}, started({runId: "run_zz"}), started({missionId: MID2})]) {
      forms.resetAllForms();
      const o = await open(() => answer); await o.start();
      expect(byData(o.root, "runlink", "unreadable")).toHaveLength(1);
      expect(text(byData(o.root, "runlink", "unreadable")[0])).toContain("no readable run id");
      expect(byId(o.root, "runlink-submit")).toBeNull();
      expect(byData(o.root, "runlinkItem")).toHaveLength(0);
      expect(o.calls.post).toHaveLength(1);
    }
  });
  it("a replayed start (200) offers the step too; a mission with only DONE tasks says there is nothing to link and offers no checkbox", async () => {
    forms.resetAllForms();
    const a = await open(() => ({status: 200, body: started().body})); await a.start();
    expect(byData(a.root, "runlinkItem")).toHaveLength(3);
    forms.resetAllForms();
    const b = await open(() => started(), [{taskId: T("3"), title: "Plan C", status: "DONE"}]); await b.start();
    expect(text(byData(b.root, "runlink", "none")[0])).toBe("This mission has no open tasks (not DONE) to link.");
    expect(byData(b.root, "runlinkItem")).toHaveLength(0);
    expect(byId(b.root, "runlink-submit")).toBeNull();
    forms.resetAllForms();
    const c = await open(() => started(), []); await c.start();
    expect(byData(c.root, "runlink", "none")).toHaveLength(1);
  });
  it("closing the step sends nothing and removes it; the step belongs to the mission it was started for", async () => {
    const o = await open(p => p === startPath ? started() : undefined as any); await o.start();
    check(o.root, T("1"));
    byId(o.root, "runlink-close")!.fire("click"); await tick(); o.root = await o.render();
    expect(byId(o.root, "run-link")).toBeNull();
    expect(o.calls.post).toHaveLength(1);
    forms.drafts.runLink = {missionId: MID2, runId: RID, checked: {}, results: {}};
    o.root = await o.render();
    expect(byId(o.root, "run-link")).toBeNull(); // başka mission için teklif bu mission'da çizilmez
  });
  it("DENIED, INVALID and server text are shown as text: the server's reason and code are never interpreted as markup", async () => {
    const o = await open((p) => p === startPath ? started() : p === linkPath(T("1")) ? {status: 403, body: {error: "ACTION_DENIED", reason: "POLICY_NOPE"}} : p === linkPath(T("2")) ? link(T("2"), 201, "run_" + "00".repeat(12)) : p === linkPath(T("4")) ? refuse("SOME_NEW_CODE") : undefined as any); await o.start();
    check(o.root, T("1"), T("2"), T("4"));
    await submit(o);
    const item = (t: string) => byData(o.root, "runlinkItem", t)[0];
    expect(text(item(T("1")))).toContain("Denied by policy: POLICY_NOPE. Not linked.");
    expect(item(T("2")).dataset.runlinkState).toBe("INVALID");
    expect(text(item(T("4")))).toContain("SOME_NEW_CODE (HTTP 409)");
    expect(all(o.root).some(n => ["SCRIPT", "IMG", "IFRAME"].includes(n.tagName))).toBe(false);
  });
  it("renders in Turkish without raw keys, and every runlink.* key exists in EN and TR with identical placeholders and none is dead", async () => {
    const o = await open(p => p === startPath ? started() : p === linkPath(T("1")) ? refuse("TASK_NOT_LINKABLE") : undefined as any, TASKS, "tr"); await o.start();
    check(o.root, T("1")); await submit(o);
    expect(text(byId(o.root, "run-link")!)).not.toMatch(/runlink\.|\{[a-zA-Z]+\}/);
    expect(text(byId(o.root, "run-link")!)).toContain("Bu koşuyu görevlere bağla");
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const have = (d: any) => Object.keys(d).filter(k => k.startsWith("runlink.")).sort();
    expect(have(en)).toEqual(have(tr));
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of have(en)) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    const src = read(rend, "views", "run-link.js");
    const need = new Set<string>([...src.matchAll(/"(runlink\.[A-Za-z.]+)"/g)].map(m => m[1]));
    for (const k of ["NOT_ATTEMPTED", "LINKED", "ALREADY_LINKED", "REFUSED", "DENIED", "STOPPED", "NOT_ENABLED", "INVALID"]) need.add(`runlink.result.${k}`);
    for (const m of read(rend, "work-actions.js").matchAll(/"(runlink\.[A-Za-z.]+)"/g)) need.add(m[1]);
    expect(have(en).filter(k => !need.has(k))).toEqual([]);
    expect([...need].filter(k => !(k in en))).toEqual([]);
  });
  it("the step writes only through ctx.api.post to the existing link path with the run id as the only body field; no bridge, storage, HTML sinks or new endpoints", async () => {
    const view = read(rend, "views", "run-link.js"), act = read(rend, "work-actions.js");
    expect(view).not.toMatch(/\.post\(|\bbridge\b|apiPost|apiGet|\bfetch\(|innerHTML|outerHTML|insertAdjacentHTML|\beval\(|localStorage|sessionStorage/);
    expect(act.match(/ctx\.api\.post\(/g)).toHaveLength(3); // geçiş, koşu başlatma, görev bağı
    const c = await load(rend, "work-core.js");
    expect(c.buildLinkRunRequest({taskId: T("1"), runId: RID, taskStatus: "PENDING"})).toEqual({ok: true, path: linkPath(T("1")), body: {runId: RID}, errors: {}});
    expect(c.buildLinkRunRequest({taskId: T("3"), runId: RID, taskStatus: "DONE"}).ok).toBe(false);
  });
});

// //TR: LANE-A A-FLOW-2: Görevler > koşu kartı "Bu koşuya bağlı görevler" (GET /v1/work-runs/:id/tasks). Okuma doğrulanmadıysa (allow-list yok / sunucu hatası / bozuk yanıt) "bağlı görev yok" ASLA söylenmez; bağlar görev başlıklarıyla ve durumlarıyla gösterilir.
describe("LANE-A run card: tasks linked to the run", () => {
  const R24 = "run_" + "ab".repeat(12), TID = (c: string) => "tsk_" + c.repeat(24), tasksPath = `/v1/work-runs/${R24}/tasks`;
  const TASKS = [{taskId: TID("1"), title: "Plan A", status: "PENDING"}, {taskId: TID("2"), title: "<b>Plan B</b>", status: "DONE"}];
  const getFor = (linkBody: any) => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission()]};
    if (p === `/v1/missions/${MID}`) return {mission: mission(), tasks: TASKS};
    if (p === `/v1/work-runs?missionId=${MID}`) return {workRuns: [{runId: R24, missionId: MID, status: "RUNNING"}]};
    if (p === `/v1/work-runs/${R24}`) return {workRun: {runId: R24, missionId: MID, status: "RUNNING"}};
    if (p === tasksPath) { if (linkBody instanceof Error) throw linkBody; return linkBody; }
    return undefined;
  };
  const link = (taskId: string, over: any = {}) => ({taskId, runId: R24, missionId: MID, tenantId: "t", linkedAt: "2026-10-26T01:00:00.000Z", linkedBy: "FOUNDER_LOCAL", ...over});
  async function render(linkBody: any, lang = "en") {
    const m = await mkCtx({get: getFor(linkBody), lang});
    forms.selection.missionId = MID;
    const root = mount(m.doc, await (await load(rend, "views", "work.js")).render(m.ctx));
    return {...m, root, block: byData(root, "runLinkedFor", R24)[0]};
  }
  it("maps the answer strictly: only links of THIS run with canonical ids and unique tasks; one bad row makes the whole read an error", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.runTasksPath(R24)).toBe(tasksPath);
    for (const bad of ["", "run_zz", "run_0123456789ab", R24 + "/x", R24 + "?a=1", "RUN_" + "ab".repeat(12), undefined, null, 5, [R24]]) expect(c.runTasksPath(bad), String(bad)).toBeNull();
    expect(c.mapRunTasks({links: [link(TID("1")), link(TID("2"), {linkedAt: "garbage"})]}, R24)).toEqual({state: "VERIFIED", links: [
      {taskId: TID("1"), runId: R24, missionId: MID, linkedAt: "2026-10-26T01:00:00.000Z"}, {taskId: TID("2"), runId: R24, missionId: MID, linkedAt: null}]});
    expect(c.mapRunTasks({links: []}, R24)).toEqual({state: "VERIFIED", links: []});
    const many = (n: number) => ({links: Array.from({length: n}, (_, i) => link("tsk_" + i.toString(16).padStart(24, "0")))});
    expect(c.mapRunTasks(many(500), R24).links).toHaveLength(500);
    expect(c.mapRunTasks(many(501), R24)).toEqual({state: "ERROR", links: []});
    for (const bad of [null, undefined, [], "x", {}, {links: "x"}, {links: {}}, {links: [null]}, {links: [link("tsk_zz")]}, {links: [link(TID("1"), {runId: "run_" + "cd".repeat(12)})]}, {links: [link(TID("1"), {missionId: "msn_zz"})]},
      {links: [link(TID("1")), link(TID("1"))]}, {links: [link([TID("1")] as any)]}])
      expect(c.mapRunTasks(bad, R24), JSON.stringify(bad)?.slice(0, 60)).toEqual({state: "ERROR", links: []});
  });
  it("the api reads exactly the canonical path once per detailed run; a missing allow-list entry is UNAVAILABLE, a server error is the client's state, a bad id sends nothing", async () => {
    const ok = await mkCtx({get: getFor({links: [link(TID("1"))]})});
    expect((await ok.ctx.api.runTasks(R24)).state).toBe("VERIFIED");
    expect(ok.calls.get).toEqual([tasksPath]);
    for (const bad of ["run_zz", "", undefined]) expect((await ok.ctx.api.runTasks(bad)).state, String(bad)).toBe("ERROR");
    expect(ok.calls.get).toHaveLength(1);
    expect((await (await mkCtx({get: getFor(new Error("INVALID_API_PATH"))})).ctx.api.runTasks(R24)).state).toBe("UNAVAILABLE");
    expect((await (await mkCtx({get: getFor(new Error(`${tasksPath}: HTTP 500`))})).ctx.api.runTasks(R24)).state).toBe("ERROR");
    expect((await (await mkCtx({get: getFor({links: "x"})})).ctx.api.runTasks(R24)).state).toBe("ERROR");
  });
  it("shows the linked tasks with the mission's task title and status; a task missing from the mission list is named as such; markup is text", async () => {
    const r = await render({links: [link(TID("1")), link(TID("2")), link(TID("3"))]});
    const items = byData(r.block, "runLinkedTask");
    expect(items.map(n => n.dataset.runLinkedTask)).toEqual([TID("1"), TID("2"), TID("3")]);
    expect(text(items[0])).toContain("Plan A"); expect(text(items[0])).toContain(TID("1"));
    expect(all(items[0]).some(n => n.dataset.status === "PENDING")).toBe(true); // durum rozeti
    expect(all(items[2]).some(n => "status" in n.dataset)).toBe(false); // listede olmayan görev için durum uydurulmaz
    expect(text(items[1])).toContain("<b>Plan B</b>");
    expect(text(items[2])).toContain("Task not in this mission's list");
    expect(all(r.root).some(n => n.tagName === "B")).toBe(false);
    expect(text(byData(r.block, "runLinked", "none")[0] ?? r.block)).not.toContain("No task is linked");
    expect(r.calls.get.filter((p: string) => p === tasksPath)).toHaveLength(1);
    expect(r.calls.post).toEqual([]);
  });
  it("an empty verified read says no task is linked; an unreadable one NEVER says so (not enabled / server error / malformed answer)", async () => {
    const none = await render({links: []});
    expect(byData(none.block, "runLinked", "none")).toHaveLength(1);
    expect(text(none.block)).toContain("No task is linked to this run");
    for (const [body, kind] of [[new Error("INVALID_API_PATH"), "unavailable"], [new Error(`${tasksPath}: HTTP 404`), "unavailable"], [new Error(`${tasksPath}: HTTP 500`), "error"], [{links: [{}]}, "error"], [{nope: 1}, "error"]] as Array<[any, string]>) {
      const r = await render(body);
      expect(byData(r.block, "runLinked").map(n => n.dataset.runLinked), String(body?.message ?? JSON.stringify(body))).toEqual([kind]);
      expect(text(r.block)).not.toContain("No task is linked");
      expect(byData(r.block, "runLinkedTask")).toHaveLength(0);
    }
  });
  it("a run whose id cannot name a link (not run_ + 24 hex) is shown as unreadable and sends no tasks request", async () => {
    const m = await mkCtx({get: p => p === `/v1/work-runs?missionId=${MID}` ? {workRuns: [{runId: "run_0123456789ab", missionId: MID, status: "RUNNING"}]} : p === "/v1/work-runs/run_0123456789ab" ? {workRun: {runId: "run_0123456789ab", missionId: MID, status: "RUNNING"}} : getFor({links: []})(p)});
    forms.selection.missionId = MID;
    const root = mount(m.doc, await (await load(rend, "views", "work.js")).render(m.ctx));
    expect(byData(root, "runLinked").map(n => n.dataset.runLinked)).toEqual(["error"]);
    expect(m.calls.get.some((p: string) => p.endsWith("/tasks"))).toBe(false);
  });
  it("renders in Turkish without raw keys; every run.linked.* key exists in EN and TR and none is dead", async () => {
    const r = await render({links: [link(TID("1"))]}, "tr");
    expect(text(r.block)).toContain("Bu koşuya bağlı görevler");
    expect(text(r.block)).not.toMatch(/run\.linked\.|\{[a-zA-Z]+\}/);
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const have = (d: any) => Object.keys(d).filter(k => k.startsWith("run.linked.")).sort();
    expect(have(en)).toEqual(have(tr));
    const used = new Set([...read(rend, "views", "work.js").matchAll(/"(run\.linked\.[A-Za-z]+)"/g)].map(m => m[1]));
    expect(have(en).filter(k => !used.has(k))).toEqual([]);
    expect([...used].filter(k => !(k in en) || !(k in tr))).toEqual([]);
  });
  it("the read adds no write path: the new api accessor only GETs, and the protected allow-list change is requested in docs/authority-requests, not made", () => {
    expect(read(rend, "api.js")).toMatch(/async runTasks\(runId\)\{const p=runTasksPath\(runId\);if\(!p\)return \{state:"ERROR",links:\[\]\};const r=await get\(p\)/);
    const doc = fs.readFileSync(path.join(root, "docs", "authority-requests", "LANE-A-run-tasks-allowlist.md"), "utf8");
    expect(doc).toContain("RUN_TASKS_RE=/^\\/v1\\/work-runs\\/run_[0-9a-f]{24}\\/tasks$/");
  });
});

describe("LANE-A A-FLOW-3: the run step tells the truth about who does the work", () => {
  const profile = (state: string, extra: any = {}) => ({state, ...(state === "LOGIN_REQUIRED" ? {reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"} : {}), loginCommand: state === "READY" ? null : "$env:CLAUDE_CONFIG_DIR='C:\\x\\implementer'; claude", ...extra});
  const execBody = (over: any = {}) => ({executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: "LOCAL_CLAUDE"}, sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE"},
    claudeProfiles: {implementer: profile("READY"), reviewer: profile("READY")}, ...over});
  const getFor = (exec: any, status = "AUTHORIZED") => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status}), tasks: []};
    if (p === `/v1/work-runs?missionId=${MID}`) return {workRuns: []};
    if (p === "/v1/system/executors") { if (exec instanceof Error) throw exec; return exec; }
    return undefined;
  };
  async function render(exec: any, lang = "en", status = "AUTHORIZED") {
    const m = await mkCtx({get: getFor(exec, status), lang});
    forms.selection.missionId = MID;
    const root = mount(m.doc, await (await load(rend, "views", "work.js")).render(m.ctx));
    return {...m, root, eng: byId(root, "run-engine")};
  }
  it("derives READY only with LOCAL_CLAUDE active and both profiles READY; a profile that is not READY or another executor is BLOCKED; missing data is UNKNOWN, never READY", async () => {
    const c = await load(rend, "project-core.js");
    const v = (over: any = {}) => c.engineVerdict(c.mapExecutors(execBody(over))).kind;
    expect(v()).toBe("READY");
    expect(v({claudeProfiles: {implementer: profile("LOGIN_REQUIRED"), reviewer: profile("READY")}})).toBe("BLOCKED");
    expect(v({claudeProfiles: {implementer: profile("READY"), reviewer: profile("REFUSED", {reason: "PROFILE_DIR_FORBIDDEN"})}})).toBe("BLOCKED");
    expect(v({claudeProfiles: {implementer: profile("WHATEVER"), reviewer: profile("READY")}})).toBe("BLOCKED");
    expect(v({active: {reason: "EXECUTOR_NOT_CONFIGURED"}})).toBe("BLOCKED");
    expect(v({active: {reason: "LOCAL_CLAUDE"}, claudeProfiles: {implementer: profile("LOGIN_REQUIRED"), reviewer: profile("LOGIN_REQUIRED")}})).toBe("BLOCKED");
    for (const o of [{active: undefined}, {active: {reason: "local-claude"}}, {active: {reason: 5}}, {active: "LOCAL_CLAUDE"}, {claudeProfiles: undefined}, {claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}},
      {claudeProfiles: {implementer: profile("READY")}}, {claudeProfiles: {implementer: profile("READY"), reviewer: {state: "ready"}}}]) expect(v(o), JSON.stringify(o)).toBe("UNKNOWN");
    for (const bad of [null, undefined, {state: "UNAVAILABLE", items: []}, {state: "ERROR", items: []}]) expect(c.engineVerdict(bad).kind).toBe("UNKNOWN");
    // each missing profile alone keeps a READY partner from making the pair READY
    expect(v({claudeProfiles: {reviewer: profile("READY")}})).toBe("UNKNOWN"); expect(v({claudeProfiles: {implementer: profile("READY")}})).toBe("UNKNOWN");
    // a failed read never reads as READY even if the object carries ready-looking fields
    const looksReady = c.mapExecutors(execBody());
    for (const st of ["ERROR", "UNAVAILABLE", undefined]) expect(c.engineVerdict({...looksReady, state: st}).kind, String(st)).toBe("UNKNOWN");
    expect(c.mapExecutors(execBody()).active).toBe("LOCAL_CLAUDE"); expect(c.mapExecutors(execBody({active: undefined})).active).toBeNull();
  });
  it("shows the engine block above the start button for a startable mission: READY says nothing is claimed to be running", async () => {
    const o = await render(execBody());
    expect(o.eng!.dataset.runEngine).toBe("READY");
    expect(o.calls.get.filter((p: string) => p === "/v1/system/executors")).toHaveLength(1);
    const head = all(o.eng!).find(n => n.dataset.engineHead)!;
    expect(head.dataset.engineHead).toBe("READY"); expect(text(head)).toContain("does not mean a run is in progress");
    expect(all(o.eng!).filter(n => n.dataset.engineProfile).map(n => [n.dataset.engineProfile, n.dataset.engineProfileState])).toEqual([["implementer", "READY"], ["reviewer", "READY"]]);
    expect(text(all(o.eng!).find(n => n.dataset.engineActive)!)).toContain("Local Claude");
    const order = all(o.root), iEng = order.indexOf(o.eng!), iBtn = order.findIndex(n => n.id === "run-start");
    expect(iEng).toBeGreaterThan(-1); expect(iBtn).toBeGreaterThan(iEng); // the truth comes before the button
    expect(all(o.eng!).some(n => n.dataset.engineLogin)).toBe(false);
    expect(text(o.eng!)).toContain("does not say a run is in progress");
  });
  it("a blocked profile gets the risk badge, not the ok badge; and no engine block is offered for a mission that cannot start a run", async () => {
    const b = await render(execBody({claudeProfiles: {implementer: profile("LOGIN_REQUIRED"), reviewer: profile("READY")}}));
    const badge = (role: string) => String(all(all(b.eng!).find(n => n.dataset.engineProfile === role)!).find(n => String(n.className).split(" ").includes("badge"))!.className);
    expect(badge("implementer")).toContain("badge-risk"); expect(badge("implementer")).not.toContain("badge-ok"); expect(badge("reviewer")).toContain("badge-ok");
    const done = await render(execBody(), "en", "COMPLETE");
    expect(done.eng).toBeNull(); expect(byId(done.root, "run-start")).not.toBeNull(); // the page itself still renders
  });
  it("LOGIN_REQUIRED is BLOCKED with the Founder's own login command as plain text, never READY, never running", async () => {
    const o = await render(execBody({claudeProfiles: {implementer: profile("LOGIN_REQUIRED"), reviewer: profile("READY")}}));
    expect(o.eng!.dataset.runEngine).toBe("BLOCKED");
    const head = all(o.eng!).find(n => n.dataset.engineHead)!;
    expect(text(head)).toContain("Nothing is running"); expect(text(head)).not.toContain("Ready:");
    const impl = all(o.eng!).find(n => n.dataset.engineProfile === "implementer")!;
    expect(impl.dataset.engineProfileState).toBe("LOGIN_REQUIRED"); expect(text(impl)).toContain("Sign-in required"); expect(text(impl)).toContain("UASCO never signs in for you");
    const cmd = all(o.eng!).find(n => n.dataset.engineLogin === "implementer")!;
    expect(text(cmd)).toContain("CLAUDE_CONFIG_DIR"); expect(all(o.eng!).some(n => n.dataset.engineLogin === "reviewer")).toBe(false);
    expect(all(o.eng!).filter(n => n.tagName === "BUTTON").length).toBe(0); // the renderer never runs the command
  });
  it("shows REFUSED, a missing profile and a non-configured executor honestly", async () => {
    const r = await render(execBody({claudeProfiles: {implementer: profile("READY"), reviewer: profile("REFUSED", {reason: "PROFILE_DIR_FORBIDDEN"})}}));
    expect(r.eng!.dataset.runEngine).toBe("BLOCKED");
    expect(text(all(r.eng!).find(n => n.dataset.engineProfile === "reviewer")!)).toContain("Refused");
    const m = await render(execBody({claudeProfiles: {implementer: profile("READY")}}));
    expect(m.eng!.dataset.runEngine).toBe("UNKNOWN");
    const miss = all(m.eng!).find(n => n.dataset.engineProfile === "reviewer")!;
    expect(miss.dataset.engineProfileState).toBe("MISSING"); expect(text(miss)).toContain("did not report this profile");
    const n = await render(execBody({active: {reason: "EXECUTOR_NOT_CONFIGURED"}}));
    expect(n.eng!.dataset.runEngine).toBe("BLOCKED"); expect(text(all(n.eng!).find(x => x.dataset.engineActive)!)).toContain("no executor is enabled");
    // LOW (review #226): the server's own PROVENANCE_MISSING has its text, not "(not recognised)"
    const pm = await render(execBody({active: {reason: "PROVENANCE_MISSING"}}));
    expect(pm.eng!.dataset.runEngine).toBe("BLOCKED"); expect(text(all(pm.eng!).find(x => x.dataset.engineActive)!)).toContain("provenance evidence is missing"); expect(text(all(pm.eng!).find(x => x.dataset.engineActive)!)).not.toContain("not recognised");
    const odd = await render(execBody({active: {reason: "BRAND_NEW"}}));
    expect(text(all(odd.eng!).find(x => x.dataset.engineActive)!)).toContain("BRAND_NEW (not recognised)");
  });
  it("states the sandbox truth next to the engine: UNAVAILABLE means tests will be NOT_EXECUTED, AVAILABLE does not promise a pass, unknown says unknown", async () => {
    const u = await render(execBody());
    expect(u.eng!.dataset.engineSandbox).toBe("UNAVAILABLE");
    const un = all(u.eng!).find(n => n.dataset.engineSandboxNote)!;
    expect(un.dataset.engineSandboxNote).toBe("UNAVAILABLE"); expect(text(un)).toContain("NOT_EXECUTED"); expect(text(un)).toContain("SANDBOX_UNAVAILABLE");
    const a = await render(execBody({sandbox: {state: "AVAILABLE", providerId: "docker"}}));
    expect(text(all(a.eng!).find(n => n.dataset.engineSandboxNote)!)).toContain("still needs the run's own evidence");
    const k = await render(execBody({sandbox: undefined}));
    expect(all(k.eng!).find(n => n.dataset.engineSandboxNote)!.dataset.engineSandboxNote).toBe("UNKNOWN");
  });
  it("an unreadable executor status is UNKNOWN with an honest note (UNAVAILABLE vs error), and never a ready or blocked claim", async () => {
    const off = await render(undefined);
    expect(off.eng!.dataset.runEngine).toBe("UNKNOWN"); expect(text(off.eng!)).toContain("not available to the desktop"); expect(text(off.eng!)).not.toContain("Ready:");
    expect(all(off.eng!).find(n => n.dataset.engineHead)!.dataset.engineHead).toBe("UNKNOWN"); expect(text(off.eng!)).toContain("nobody can say whether a run would be carried out");
    expect(all(off.eng!).some(n => n.dataset.engineProfile)).toBe(false);
    const err = await render(new Error("/v1/system/executors: HTTP 500"));
    expect(err.eng!.dataset.runEngine).toBe("UNKNOWN"); expect(text(err.eng!)).not.toContain("not available to the desktop");
  });
  it("C-IMPL-WIN-1: maps cli and per-role readiness strictly; ready must equal 'no blockers', free text and paths are never carried", async () => {
    const c = await load(rend, "project-core.js");
    const rd = (over: any = {}) => ({ready: false, blockers: ["CLAUDE_CLI_SHIM_UNSUPPORTED"], blocker: "CLAUDE_CLI_SHIM_UNSUPPORTED", founderAction: "Found C:\\Users\\x\\claude.cmd", profile: "READY", loginCommand: null, loginHint: "free text", ...over});
    const map = (r: any, cli: any = {state: "SHIM_UNSUPPORTED", path: "C:\\x\\claude.cmd"}) => c.mapExecutors({executors: {LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", cli, readiness: r}, FAKE: {state: "TEST_ONLY"}}});
    const m = map({implementer: rd(), reviewer: rd({ready: true, blockers: [], blocker: null})});
    expect(m.items.find((i: any) => i.id === "LOCAL_CLAUDE").cli).toEqual({state: "SHIM_UNSUPPORTED"});
    expect(m.readiness.implementer).toEqual({ready: false, blockers: ["CLAUDE_CLI_SHIM_UNSUPPORTED"], profile: "READY", loginCommand: null});
    expect(m.readiness.reviewer.ready).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/claude\.cmd|free text|founderAction/);
    for (const bad of [rd({ready: true}), rd({blockers: [], ready: false}), rd({blockers: "x"}), rd({blockers: ["bad code"]}), rd({blockers: [5]}), rd({blockers: Array(9).fill("CLAUDE_CLI_NOT_FOUND")}), rd({ready: "yes"}), null, 5])
      expect(map({implementer: bad, reviewer: rd()}).readiness.implementer, JSON.stringify(bad)).toBeNull();
    expect(map({implementer: rd({blockers: ["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"]}), reviewer: rd()}).readiness.implementer.blockers).toEqual(["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"]);
    for (const cli of [{state: "MAYBE"}, null, "FOUND"]) expect(map({}, cli).items[0].cli, String(cli)).toBeNull();
    expect(map(undefined).readiness).toBeNull(); expect(c.mapExecutors({executors: [{id: "FAKE", state: "READY"}]}).readiness).toBeNull();
  });
  it("C-IMPL-WIN-1: a role with ready=false is BLOCKED even when its profile is READY; ready roles stay READY; a conflicting role reading is unknown, not READY", async () => {
    const c = await load(rend, "project-core.js");
    const rd = (ready: boolean, blockers: string[] = ready ? [] : ["CLAUDE_CLI_NOT_FOUND"]) => ({ready, blockers, blocker: blockers[0] ?? null, profile: "READY", loginCommand: null});
    const kind = (readiness: any, over: any = {}) => c.engineVerdict(c.mapExecutors(execBody({readiness: undefined, executors: {LOCAL_CLAUDE: {state: "READY", readiness}, FAKE: {state: "TEST_ONLY"}}, ...over}))).kind;
    expect(kind({implementer: rd(true), reviewer: rd(true)})).toBe("READY");
    expect(kind({implementer: rd(false), reviewer: rd(true)})).toBe("BLOCKED");
    expect(kind({implementer: rd(true), reviewer: rd(false, ["CLAUDE_LAUNCHER_PROVENANCE_CHANGED"])})).toBe("BLOCKED");
    expect(kind(undefined)).toBe("READY"); // older server without readiness: the profile reading alone decides, as before
    expect(kind({implementer: {...rd(true), ready: false}, reviewer: rd(true)})).toBe("UNKNOWN"); // contradictory role reading is dropped, never trusted as ready
  });
  it("C-IMPL-WIN-1: the engine block lists each blocker in plain words (no server free text, no path), shows the login command only when a sign-in is the blocker, and flags a not-ready role with a READY profile", async () => {
    const mk = (r: any, p: any = profile("READY")) => execBody({claudeProfiles: {implementer: p, reviewer: profile("READY")}, executors: {LOCAL_CLAUDE: {state: "READY", readiness: r}, FAKE: {state: "TEST_ONLY"}}});
    const role = (blockers: string[], extra: any = {}) => ({ready: blockers.length === 0, blockers, blocker: blockers[0] ?? null, founderAction: "Found C:\\Users\\x\\claude.cmd", profile: "READY", loginCommand: null, ...extra});
    const o = await render(mk({implementer: role(["CLAUDE_CLI_SHIM_UNSUPPORTED", "PROVIDER_PROVENANCE_NOT_READY"]), reviewer: role([])}));
    expect(o.eng!.dataset.runEngine).toBe("BLOCKED");
    const impl = all(o.eng!).find(n => n.dataset.engineProfile === "implementer")!;
    expect(impl.dataset.engineProfileState).toBe("READY"); expect(impl.dataset.engineRoleReady).toBe("false");
    const bcls = String(all(impl).find(n => String(n.className).split(" ").includes("badge"))!.className);
    expect(bcls).toContain("badge-risk"); expect(bcls).not.toContain("badge-ok"); // a signed-in profile is not "ok" while the CLI is not usable
    expect(text(impl)).toContain("(not ready)"); expect(text(impl)).toContain("npm .cmd/.bat launcher"); expect(text(impl)).toContain("provenance evidence has not been captured");
    expect(all(impl).filter(n => n.dataset.engineBlocker).map(n => n.dataset.engineBlocker)).toEqual(["CLAUDE_CLI_SHIM_UNSUPPORTED", "PROVIDER_PROVENANCE_NOT_READY"]);
    expect(text(o.eng!)).not.toMatch(/claude\.cmd|C:\\/);
    const rv = all(o.eng!).find(n => n.dataset.engineProfile === "reviewer")!;
    expect(rv.dataset.engineRoleReady).toBe("true"); expect(all(rv).some(n => n.dataset.engineBlocker)).toBe(false);
    const cmd = "$env:CLAUDE_CONFIG_DIR='C:\\x\\implementer'; claude";
    const exp = await render(mk({implementer: role(["CLAUDE_PROFILE_LOGIN_EXPIRED"], {loginCommand: cmd}), reviewer: role([])}, profile("READY", {loginCommand: cmd})));
    expect(all(exp.eng!).find(n => n.dataset.engineLogin === "implementer")).toBeTruthy(); expect(text(exp.eng!)).toContain("sign-in has expired");
    const ready = await render(mk({implementer: role([], {loginCommand: cmd}), reviewer: role([])}, profile("READY", {loginCommand: cmd})));
    expect(ready.eng!.dataset.runEngine).toBe("READY"); expect(all(ready.eng!).some(n => n.dataset.engineLogin)).toBe(false); // the server always sends a command; READY never shows it
    expect(text(ready.eng!)).not.toContain("To sign in"); expect(text(ready.eng!)).not.toContain("CLAUDE_CONFIG_DIR");
    // an older/limited server may send readiness without claudeProfiles: the readiness reading carries the profile state and the login command
    const only = async (impl: any) => render({...mk({implementer: impl, reviewer: role([])}), claudeProfiles: undefined});
    const loginOnly = await only(role(["CLAUDE_PROFILE_LOGIN_REQUIRED"], {profile: "LOGIN_REQUIRED", loginCommand: cmd}));
    expect(loginOnly.eng!.dataset.runEngine).toBe("BLOCKED");
    expect(all(loginOnly.eng!).find(n => n.dataset.engineProfile === "implementer")!.dataset.engineProfileState).toBe("LOGIN_REQUIRED");
    expect(text(all(loginOnly.eng!).find(n => n.dataset.engineLogin === "implementer")!)).toContain("CLAUDE_CONFIG_DIR");
    const readyOnly = await only(role([]));
    expect(all(readyOnly.eng!).find(n => n.dataset.engineProfile === "implementer")!.dataset.engineProfileState).toBe("READY");
    expect(readyOnly.eng!.dataset.runEngine).toBe("READY"); // both roles are READY by their readiness reading alone
    const refused = await render(mk({implementer: role(["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"], {profile: "REFUSED"}), reviewer: role([])}));
    expect(text(all(refused.eng!).find(n => n.dataset.engineBlocker === "CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN")!)).toContain("(SETTINGS_NOT_WRITTEN)");
    const unk = await render(mk({implementer: role(["BRAND_NEW_BLOCKER"]), reviewer: role([])}));
    expect(text(all(unk.eng!).find(n => n.dataset.engineBlocker === "BRAND_NEW_BLOCKER")!)).toContain("BRAND_NEW_BLOCKER (not recognised)");
  });
  it("C-IMPL-WIN-1: Settings explains a .cmd/.bat shim specifically, and a plain missing CLI keeps the old text", async () => {
    const hint = async (cli: any) => {
      const m = await mkCtx({lang: "en", get: (p: string) => p === "/v1/system/executors" ? {executors: {LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", cli}, FAKE: {state: "TEST_ONLY"}}} : undefined});
      const root = mount(m.doc, await (await load(rend, "views", "executors-panel.js")).executorsPanel(m.ctx));
      return text(all(root).find(n => n.dataset.executor === "LOCAL_CLAUDE")!);
    };
    expect(await hint({state: "SHIM_UNSUPPORTED"})).toContain("npm .cmd/.bat launcher");
    expect(await hint({state: "NOT_FOUND"})).toContain("was not found on this computer");
    const readyShim = await mkCtx({lang: "en", get: (p: string) => p === "/v1/system/executors" ? {executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "SHIM_UNSUPPORTED"}}, FAKE: {state: "TEST_ONLY"}}} : undefined});
    expect(text(all(mount(readyShim.doc, await (await load(rend, "views", "executors-panel.js")).executorsPanel(readyShim.ctx))).find(n => n.dataset.executor === "LOCAL_CLAUDE")!)).not.toContain("npm .cmd/.bat"); // the shim text belongs to a missing CLI only
    expect(await hint(undefined)).toContain("was not found on this computer");
    expect(await hint({state: "SHIM_UNSUPPORTED"})).not.toContain("was not found on this computer");
  });
  it("a blocked run reason from the server is explained for the two engine causes, in en and tr", async () => {
    const c = await load(rend, "work-core.js");
    expect(c.runReasonHintKey("CLAUDE_PROFILE_LOGIN_REQUIRED")).toBe("run.reason.CLAUDE_PROFILE_LOGIN_REQUIRED");
    expect(c.runReasonHintKey("EXECUTOR_NOT_CONFIGURED")).toBe("run.reason.EXECUTOR_NOT_CONFIGURED");
    // LOW (review #226): "CODE:detail" reasons (e.g. CLAUDE_PROFILE_REFUSED:<reason>) are explained by their code; PROVENANCE_MISSING has its own text
    expect(c.runReasonHintKey("CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN")).toBe("run.reason.CLAUDE_PROFILE_REFUSED");
    expect(c.runReasonHintKey("PROVENANCE_MISSING")).toBe("run.reason.PROVENANCE_MISSING"); expect(c.runReasonHintKey("SOMETHING_ELSE:X")).toBeNull();
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("runengine.") || /^run\.reason\.(CLAUDE|CLI_|PROVIDER|EXECUTOR)/.test(k) || k === "runengine.role.notReady");
    expect(keys.length).toBe(28);
    for (const k of keys) expect(T[k], k).toBeTruthy();
    // LOW (review #226): a refused profile with its detail (CLAUDE_PROFILE_REFUSED:<reason>) shows the code's explanation, not the bare code
    const wk = await load(rend, "views", "work.js"), mc = await mkCtx({lang: "en"});
    const rcard = wk.runCard(mc.ctx, {runId: "run_" + "ab".repeat(12), missionId: MID, status: "BLOCKED", reason: "CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN", evidence: [], checkpoints: [], reviewer: null, step: null, role: null, evidenceVerification: null}) as N;
    const rr = byData(rcard, "runReason")[0]; expect(rr.dataset.runReason).toBe("CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"); expect(rr.textContent).toContain(E["run.reason.CLAUDE_PROFILE_REFUSED"]);
    const t = await render(execBody({claudeProfiles: {implementer: profile("LOGIN_REQUIRED"), reviewer: profile("READY")}}), "tr");
    expect(text(t.eng!)).toContain("Bloke");
  });
});

describe("LANE-A A-FLOW-GAP-2: the test-result step of a run says what really happened (executed / failed / not executed with its reason)", () => {
  // M2 (review #226): the row shows the SERVER's decision (GET /v1/work-runs/:id -> delivery.productVerification + testsExecuted); the client never recomputes it from the (truncated) evidence list.
  const HEAD = "a".repeat(40), RUNX = "run_" + "ab".repeat(12);
  const run = (over: any = {}) => ({runId: RUNX, missionId: MID, status: "AWAITING_APPROVAL", headSha: HEAD, ...over});
  const dlv = (state: string, reason: string, testsExecuted: boolean) => ({runId: RUNX, missionId: MID, status: "AWAITING_APPROVAL", sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", reason: null}, productVerification: {state, reason}, testsExecuted});
  const detail = async (delivery: any, over: any = {}) => { const core = await load(rend, "work-core.js"); return core.mapWorkRunDetail({run: run(over), delivery, outcomes: null}).run; };
  const card = async (x: any, lang = "en") => {
    const c = await mkCtx({lang}); const core = await load(rend, "work-core.js"), work = await load(rend, "views", "work.js");
    return {node: work.runCard(c.ctx, x) as N, core};
  };
  const result = (n: N) => within(n).find(x => x.dataset.runTestResult) ?? null;
  const within = (n: N): N[] => [n, ...n.children.flatMap(c => within(c))];
  const CASES: Array<[string, any, string, string, string]> = [
    // name, server delivery view, kind, reason, text it must contain
    ["tests ran and failed", dlv("FAILED", "TESTS_FAILED", true), "FAILED", "TESTS_FAILED", "ran and at least one exited with a non-zero code"],
    ["no verified sandbox", dlv("NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE", false), "NOT_EXECUTED", "SANDBOX_UNAVAILABLE", "No verified sandbox existed, so the tests were not run"],
    ["run never reached the tests", dlv("NOT_VERIFIED", "NOT_EXECUTED:TESTS_NOT_REACHED", false), "NOT_EXECUTED", "TESTS_NOT_REACHED", "did not reach the test step"],
    ["no commit", dlv("NOT_VERIFIED", "NOT_EXECUTED:NO_HEAD_COMMIT", false), "NOT_EXECUTED", "NO_HEAD_COMMIT", "produced no commit"],
    ["tests ran without a sandbox attestation", dlv("NOT_VERIFIED", "SANDBOX_ATTESTATION_MISSING", true), "NOT_VERIFIED", "SANDBOX_ATTESTATION_MISSING", "no sandbox attested it"],
    ["zero tests executed", dlv("NOT_VERIFIED", "ZERO_TESTS_EXECUTED", true), "NOT_VERIFIED", "ZERO_TESTS_EXECUTED", "executed zero tests"],
    ["test count unknown", dlv("NOT_VERIFIED", "EXECUTED_TEST_COUNT_UNKNOWN", true), "NOT_VERIFIED", "EXECUTED_TEST_COUNT_UNKNOWN", "number of executed tests is not known"],
    ["tests were changed", dlv("NOT_VERIFIED", "TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION", true), "NOT_VERIFIED", "TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION", "tests were changed"],
    ["test surface blocked", dlv("NOT_VERIFIED", "TEST_SURFACE_BLOCKED", true), "NOT_VERIFIED", "TEST_SURFACE_BLOCKED", "test surface is blocked"],
    // the server appends a detail to some reasons (outcomes.ts): the text resolves on the code before ':' and the full reason stays visible
    ["test surface blocked with the server's detail", dlv("NOT_VERIFIED", "TEST_SURFACE_BLOCKED:UNVERIFIED_ORACLE", true), "NOT_VERIFIED", "TEST_SURFACE_BLOCKED:UNVERIFIED_ORACLE", "test surface is blocked"],
    ["everything proven", dlv("PRODUCT_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", true), "EXECUTED_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", "executed in a verified sandbox"],
    // M2: the tests really ran (testsExecuted) although the run is stopped before the end; the server's NOT_EXECUTED:* wording must NOT turn into "not executed"
    ["tests ran, server reason says not reached", dlv("NOT_VERIFIED", "NOT_EXECUTED:TESTS_NOT_REACHED", true), "NOT_VERIFIED", "TESTS_NOT_REACHED", "no complete test result for the final commit"],
    ["tests recorded, server rule found no verified sandbox", dlv("NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE", true), "NOT_VERIFIED", "SANDBOX_UNAVAILABLE", "See Settings > Ready to build?"],
  ];
  it("shows the server's decision (delivery.productVerification + testsExecuted); a run without the server's delivery view is UNKNOWN, never 'not executed'", async () => {
    const core = await load(rend, "work-core.js");
    for (const [name, d, kind, reason] of CASES) expect(core.testResultOf(await detail(d)), name).toEqual({kind, reason});
    expect(core.testResultOf(core.mapWorkRun(run()))).toEqual({kind: "UNKNOWN", reason: null}); // list entry without the delivery view: nothing is claimed
    expect(core.testResultOf(await detail(undefined))).toEqual({kind: "UNKNOWN", reason: null});
    // M2: the evidence list is NOT consulted (the server looks at all evidence, the list is cut at 100)
    const withEvidence = core.mapWorkRun(run({evidence: [{evidenceId: "evd_" + "1".repeat(24), kind: "VERIFY_TESTS_NOT_EXECUTED", commitSha: HEAD, exitCode: 0, step: "VERIFY", cycle: 0}]}));
    expect(core.testResultOf(withEvidence)).toEqual({kind: "UNKNOWN", reason: null});
    const ranButEvidenceCut = await detail(dlv("PRODUCT_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", true), {evidence: []});
    expect(core.testResultOf(ranButEvidenceCut)).toEqual({kind: "EXECUTED_VERIFIED", reason: "TESTS_EXECUTED_IN_VERIFIED_SANDBOX"});
    for (const bad of [null, undefined, {}, {delivery: null}, {delivery: {productVerification: null}}, {delivery: {productVerification: {state: 5, reason: "x"}}}, {delivery: {productVerification: {state: "WEIRD", reason: "X"}}}]) expect(core.testResultOf(bad as any), String(bad)).toEqual({kind: "UNKNOWN", reason: null});
    for (const st of ["FAILED", "NOT_VERIFIED", "PRODUCT_VERIFIED"]) expect(core.testResultOf({delivery: {productVerification: {state: st, reason: 5}, testsExecuted: true}}), st).toEqual({kind: "UNKNOWN", reason: null}); // a non-text reason is never trusted
    expect(core.testResultOf({delivery: {productVerification: {state: "NOT_VERIFIED", reason: "SOMETHING_NEW"}, testsExecuted: false}})).toEqual({kind: "NOT_VERIFIED", reason: "SOMETHING_NEW"});
  });
  // The client rule (productVerificationOf, from the recorded evidence) is still live for every list item without the server's delivery view: it drives isProductVerified, the NOT_VERIFIED badges (m1a.js) and the PRODUCT_VERIFIED pill (views/delivery.js). These evidence cases are kept next to the delivery-view cases above.
  const evd = (kind: string, extra: any = {}) => ({evidenceId: "evd_" + "1".repeat(24), kind, commitSha: HEAD, exitCode: 0, step: "VERIFY", cycle: 0, ...extra});
  const attested = (kind: string, extra: any = {}) => evd(kind, {sandboxProviderId: "linux-unshare-v2", ...extra});
  const surface = (n: number | null, extra: any = {}) => ({kind: "TEST_SURFACE", commitSha: HEAD, testSurface: {executedTests: n, functionalAcceptance: "OK", modified: [], deleted: [], renamed: [], harness: [], weakened: [], ...extra}});
  const EV_CASES: Array<[string, any[], string, string]> = [
    // name, evidence, expected evidenceVerification.state, reason
    ["tests ran and failed", [attested("VERIFY_TESTS", {exitCode: 1}), attested("REGRESSION_TESTS")], "FAILED", "TESTS_FAILED"],
    ["regression failed", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS", {exitCode: 2})], "FAILED", "TESTS_FAILED"],
    ["no verified sandbox", [evd("VERIFY_TESTS_NOT_EXECUTED"), evd("REGRESSION_TESTS_NOT_EXECUTED")], "NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE"],
    ["run never reached the tests", [evd("EXECUTOR_RUN", {step: "IMPLEMENT"})], "NOT_VERIFIED", "NOT_EXECUTED:TESTS_NOT_REACHED"],
    ["tests ran without a sandbox attestation", [evd("VERIFY_TESTS"), evd("REGRESSION_TESTS"), surface(4)], "NOT_VERIFIED", "SANDBOX_ATTESTATION_MISSING"],
    ["zero tests executed", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS"), surface(0)], "NOT_VERIFIED", "ZERO_TESTS_EXECUTED"],
    ["test count unknown", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS")], "NOT_VERIFIED", "EXECUTED_TEST_COUNT_UNKNOWN"],
    ["tests were changed", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS"), surface(5, {modified: ["a.test.js"]})], "NOT_VERIFIED", "TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION"],
    ["test surface blocked", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS"), surface(5, {functionalAcceptance: "BLOCKED"})], "NOT_VERIFIED", "TEST_SURFACE_BLOCKED"],
    ["everything proven", [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS"), surface(7)], "PRODUCT_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX"],
  ];
  it("the evidence rule for list items (no delivery view) is unchanged: every recorded-evidence case maps to the same state and reason, and only the proven case is PRODUCT_VERIFIED", async () => {
    const core = await load(rend, "work-core.js");
    for (const [name, evidence, state, reason] of EV_CASES) {
      const w = core.mapWorkRun(run({evidence}));
      expect(w.evidenceVerification, name).toMatchObject({state, reason}); expect(core.isProductVerified(w), name).toBe(state === "PRODUCT_VERIFIED");
    }
    expect(core.mapWorkRun(run({evidence: [], headSha: undefined})).evidenceVerification).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:NO_HEAD_COMMIT"});
    // a regression run that failed on another commit does not count; a missing regression never verifies
    expect(core.mapWorkRun(run({evidence: [attested("VERIFY_TESTS"), surface(7)]})).evidenceVerification.state).not.toBe("PRODUCT_VERIFIED");
  });
  // W2 (review #226 survivor): when the server's delivery view is present it alone decides; a client recompute from the (truncated) evidence list never overrides the server's NOT_VERIFIED / FAILED.
  it("isProductVerified: the server's delivery view decides when present (the recorded evidence's PRODUCT_VERIFIED never overrides NOT_VERIFIED or FAILED); without it the evidence rule applies", async () => {
    const core = await load(rend, "work-core.js"), m1a = await load(rend, "m1a.js");
    const proven = [attested("VERIFY_TESTS"), attested("REGRESSION_TESTS"), surface(7)];
    for (const [state, reason, ran] of [["NOT_VERIFIED", "SANDBOX_ATTESTATION_MISSING", true], ["NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE", false], ["FAILED", "TESTS_FAILED", true]] as const) {
      const w = await detail(dlv(state, reason, ran), {evidence: proven});
      expect(w.evidenceVerification.state, reason).toBe("PRODUCT_VERIFIED"); // precondition: the client rule alone would say verified
      expect(w.delivery.productVerification.state, reason).toBe(state);
      expect(core.isProductVerified(w), reason).toBe(false); expect(m1a.runNotVerified(w), reason).toBe(true); expect(m1a.missionNotVerified([w], MID), reason).toBe(true);
    }
    const cut = await detail(dlv("PRODUCT_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", true), {evidence: []});
    expect(cut.evidenceVerification.state).not.toBe("PRODUCT_VERIFIED"); expect(core.isProductVerified(cut)).toBe(true); expect(m1a.runNotVerified(cut)).toBe(false);
    const listItem = core.mapWorkRun(run({evidence: proven}));
    expect(listItem.delivery?.productVerification?.state).toBeUndefined(); expect(core.isProductVerified(listItem)).toBe(true);
  });
  it("list items without the delivery view keep the Founder-approved NOT_VERIFIED badge for every evidence case except the proven one", async () => {
    const core = await load(rend, "work-core.js");
    for (const [name, evidence, state] of EV_CASES) {
      const {node} = await card(core.mapWorkRun(run({evidence})));
      expect(within(node).some(x => x.dataset.m1aBadge === "run"), name).toBe(state !== "PRODUCT_VERIFIED");
      expect(result(node)!.dataset.runTestResult, name).toBe("UNKNOWN"); // and no test result is claimed without the server's view
    }
  });
  it("the run card shows the test result row with the exact reason code and a plain sentence for every case; the generic NOT_VERIFIED badge stays", async () => {
    for (const [name, d, kind, reason, sentence] of CASES) {
      const {node} = await card(await detail(d));
      const r = result(node)!;
      expect(r, name).not.toBeNull(); expect(r.dataset.runTestResult, name).toBe(kind); expect(r.dataset.runTestReason, name).toBe(reason);
      expect(r.textContent, name).toContain(sentence); expect(r.textContent, name).toContain(`(${reason})`); expect(r.textContent, name).not.toContain("reason not recognised"); // every case above is a recognised reason, shown strictly as (REASON)
      expect(within(node).some(x => x.dataset.m1aBadge === "run"), name).toBe(kind !== "EXECUTED_VERIFIED"); // the Founder-approved NOT_VERIFIED badge is unchanged
    }
    const mk = async (state: string, reason: string, testsExecuted = false) => { const c = await mkCtx({lang: "en"}); const work = await load(rend, "views", "work.js"); return result(work.runCard(c.ctx, await detail(dlv(state, reason, testsExecuted))) as N)!; };
    expect((await mk("NOT_VERIFIED", "SOMETHING_NEW")).textContent).toBe("The result is NOT VERIFIED. (SOMETHING_NEW — reason not recognised)");
    expect((await mk("NOT_VERIFIED", "NOT_EXECUTED:SOMETHING_NEW")).textContent).toBe("The tests were not executed. (SOMETHING_NEW — reason not recognised)");
    const failed = result((await card(await detail(CASES[0][1]))).node)!;
    expect(failed.textContent).not.toContain("sandbox not verified"); // a failed test run is never described as a sandbox problem
  });
  it("a card without the server's delivery view says the result is not reported; a failed run keeps both lines (reason and result) and nothing says 'passed' unless the rule holds", async () => {
    const core = await load(rend, "work-core.js");
    const un = result((await card(core.mapWorkRun(run()))).node)!;
    expect(un.dataset.runTestResult).toBe("UNKNOWN"); expect(un.textContent).toContain("not reported for this run"); expect(un.textContent).not.toMatch(/not executed|passed|verified in/i);
    const blocked = await card(await detail(dlv("NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE", false), {status: "BLOCKED", reason: "SANDBOX_UNAVAILABLE"}));
    expect(within(blocked.node).some(x => x.dataset.runReason === "SANDBOX_UNAVAILABLE")).toBe(true); expect(result(blocked.node)!.dataset.runTestResult).toBe("NOT_EXECUTED");
    // M2: a run BLOCKED at REVIEW (reviewer login required) after the tests really ran is not shown as "NOT EXECUTED"
    const atReview = await card(await detail(dlv("NOT_VERIFIED", "NOT_EXECUTED:TESTS_NOT_REACHED", true), {status: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"}));
    expect(result(atReview.node)!.dataset.runTestResult).toBe("NOT_VERIFIED"); expect(result(atReview.node)!.textContent).not.toMatch(/were not executed|did not reach the test step|NOT EXECUTED/);
    for (const [name, d, kind] of CASES) { if (kind !== "EXECUTED_VERIFIED") expect(result((await card(await detail(d))).node)!.textContent, name).not.toMatch(/\bpassed\b/i); }
  });
  it("is present in English and Turkish for every kind and reason", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("run.test."));
    expect(keys.length).toBe(17);
    for (const k of keys) { expect(T[k], k).toBeTruthy(); expect(E[k], k).not.toBe(k); }
    const tn = result((await card(await detail(CASES[0][1]), "tr")).node)!;
    expect(tn.textContent).toContain("BAŞARISIZ");
  });
});

// //TR: LANE-A A-FLOW-GAP-2: Journey'nin uçtan uca sürülmesi. Durumlu sahte sunucu 7f6591c rotalarının şekillerini döndürür ve her GET/POST önce gerçek main.mjs allow-list'inden geçer (listede olmayan yol köprüde INVALID_API_PATH olur): böylece "GATED_4B" adımlar gerçekte olduğu gibi UNAVAILABLE görünür. Her adımın durumu tabloya yazılır ve test tabloyu sabitler.
describe("LANE-A A-FLOW-GAP-2: the Journey end to end (stateful fake server, real main.mjs allow-lists, 7f6591c route shapes)", () => {
  const H = (c: string) => c.repeat(24);
  const IPRJ = `prj_${H("a")}`, IMSN = `msn_${H("b")}`, IITK = `itk_${H("c")}`, IRUN = `run_${H("d")}`, ITSK = (i: number) => `tsk_${String(i + 1).repeat(24)}`, HEAD = "e".repeat(40);
  const IDEA = "Bir kitap kulübü uygulaması: üyeler kitap önerir ve oylar";
  async function mkServer() {
    const getOk = loadGet(), {desktopPostPathAllowed: postOk} = loadPost();
    const boundary = await load(root, "automation", "lib", "control-boundary.mjs");
    const S: any = {project: null, mission: null, intake: null, tasks: [] as any[], run: null, links: [] as any[], posts: [] as Array<{path: string; body: any}>, gets: [] as string[], blocked: [] as string[]};
    const exec = {executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: "LOCAL_CLAUDE"}, sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null},
      claudeProfiles: {implementer: {state: "READY"}, reviewer: {state: "READY"}}};
    const missionObj = () => S.mission && ({...S.mission});
    const get = (p: string) => {
      S.gets.push(p);
      if (!(boundary.desktopGetPathAllowed(p) || getOk(p))) { S.blocked.push(`GET ${p}`); throw new Error("INVALID_API_PATH"); }
      if (p === "/v1/projects") return {projects: S.project ? [S.project] : []};
      if (p === "/v1/intakes") return {intakes: S.intake ? [S.intake] : []};
      if (p === "/v1/missions") return {missions: S.mission ? [missionObj()] : []};
      if (p.startsWith("/v1/missions?projectId=")) return {missions: S.mission ? [missionObj()] : []};
      if (S.mission && p === `/v1/missions/${IMSN}`) return {mission: missionObj(), tasks: S.tasks};
      if (p === "/v1/work-runs" || p === `/v1/work-runs?missionId=${IMSN}`) return {workRuns: S.run ? [S.run] : []};
      if (S.run && p === `/v1/work-runs/${IRUN}`) return {workRun: S.run, outcomes: null, delivery: S.delivery()}; // the server also returns its delivery view (productVerification + testsExecuted)
      if (S.run && p === `/v1/work-runs/${IRUN}/tasks`) return {links: S.links};
      if (S.productRoute && S.run && p === `/v1/work-runs/${IRUN}/product`) return {product: {runId: IRUN, deliveredHeadSha: HEAD, tiedToThisRun: false, devrun: {status: "STOPPED", pid: null, port: null, preview: {state: "UNAVAILABLE", url: null}, logTail: "", deliveryRunId: null, bridged: null}}};
      if (p.startsWith("/v1/evidence")) return {evidence: []};
      if (p === `/v1/projects/${IPRJ}/readiness`) return {readiness: {projectId: IPRJ, missionId: IMSN, ready: true, verifiable: S.tasks.length > 0, checks: [
        {id: "MISSION", state: "OK", blocking: true, reason: null, nextAction: null}, {id: "RISK", state: "OK", blocking: true, reason: null, nextAction: null},
        {id: "REPOSITORY", state: "OK", blocking: true, reason: null, nextAction: null}, {id: "TEST_COMMAND", state: "OK", blocking: false, reason: null, nextAction: null},
        S.tasks.length ? {id: "PLAN", state: "OK", blocking: false, reason: null, nextAction: null} : {id: "PLAN", state: "BLOCKED", blocking: false, reason: "NO_PLANNED_TASKS", nextAction: "PLAN_MISSION"}]}};
      if (p === `/v1/projects/${IPRJ}/flow`) return {flow: {projectId: IPRJ, stages: ["MISSION", "PLAN", "RUN", "REVIEW", "DELIVERY"].map(s => ({stage: s, state: s === "MISSION" || (s === "PLAN" && S.tasks.length) ? "DONE" : "NOT_STARTED", detail: null})), missionCount: 1, taskCount: S.tasks.length, latestRunId: S.run ? S.run.runId : null}};
      if (p === "/v1/system/executors") return exec;
      if (p === `/v1/deliveries?projectId=${IPRJ}`) return {deliveries: S.run ? [S.delivery()] : []};
      throw new Error(`${p}: HTTP 404`);
    };
    S.delivery = () => ({runId: IRUN, missionId: IMSN, projectId: IPRJ, status: "AWAITING_APPROVAL", sourceCommit: HEAD, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", reason: "SOURCE_EVIDENCE_FOR_HEAD", label: "SOURCE_GENERATION_COMPLETE"},
      productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: "NOT_VERIFIED"}, testsExecuted: false, accepted: null,
      artifact: S.prepared ? {runId: IRUN, missionId: IMSN, sourceCommit: HEAD, treeSha: "3".repeat(40), exportArtifactHash: "f".repeat(64), artifactPath: `deliveries/${IRUN}/${"f".repeat(64)}.zip`} : null, fileState: S.prepared ? "VERIFIED" : null,
      testChanges: {required: false, testSurfaceSha256: null, changed: {modified: [], deleted: [], renamed: [], harness: [], truncated: false}}, labels: {sourceGeneration: null, productVerification: null, sourceDelivery: null}});
    const post = (p: string, b: any) => {
      S.posts.push({path: p, body: b});
      if (!postOk(p)) { S.blocked.push(`POST ${p}`); throw new Error("INVALID_API_PATH"); }
      if (p === "/v1/intakes") {
        S.project = {projectId: IPRJ, name: b.title ?? "Kitap Kulübü", tenantId: "t1", environmentId: "local", createdAt: "2026-10-26T05:00:00.000Z", repository: {path: "C:\\Projeler\\kitap"}};
        S.mission = {missionId: IMSN, projectId: IPRJ, title: "Kitap Kulübü", objective: b.idea, acceptanceCriteria: ["Uygulama açılır"], riskLevel: "R1", status: "DRAFT", createdAt: "2026-10-26T05:00:00.000Z"};
        S.intake = {intakeId: IITK, projectId: IPRJ, missionId: IMSN, title: "Kitap Kulübü", idea: b.idea, riskLevel: "R1", acceptanceCriteria: ["Uygulama açılır"], status: "CREATED", template: b.template,
          sources: {title: "FOUNDER", acceptanceCriteria: "DEFAULT", riskLevel: "DEFAULT"}, createdAt: "2026-10-26T05:00:00.000Z"};
        return {status: 201, body: {intake: S.intake}};
      }
      if (p === `/v1/missions/${IMSN}/plan`) { S.tasks = b.tasks.map((t: any, i: number) => ({taskId: ITSK(i), title: t.title, status: "PENDING"})); S.mission.status = "PLANNED"; return {status: 201, body: {tasks: S.tasks}}; }
      if (p === `/v1/missions/${IMSN}/transition`) { S.mission.status = b.to; return {status: 200, body: {mission: missionObj()}}; }
      if (p === `/v1/missions/${IMSN}/runs`) {
        S.run = {runId: IRUN, missionId: IMSN, projectId: IPRJ, status: "AWAITING_APPROVAL", headSha: HEAD, step: "REVIEW", startedAt: "2026-10-26T05:10:00.000Z",
          evidence: [{evidenceId: "evd_" + H("1"), kind: "VERIFY_TESTS_NOT_EXECUTED", commitSha: HEAD, exitCode: null, step: "VERIFY", cycle: 0}, {evidenceId: "evd_" + H("2"), kind: "REGRESSION_TESTS_NOT_EXECUTED", commitSha: HEAD, exitCode: null, step: "REGRESSION", cycle: 0}]};
        return {status: 201, body: {run: {runId: IRUN, missionId: IMSN}, hostExecutionNotice: "none"}};
      }
      const link = /^\/v1\/tasks\/(tsk_[0-9a-f]{24})\/runs$/.exec(p);
      if (link) { const l = {taskId: link[1], runId: b.runId, missionId: IMSN, tenantId: "t1", linkedAt: "2026-10-26T05:11:00.000Z", linkedBy: "FOUNDER_LOCAL"}; S.links.push(l); return {status: 201, body: {link: l}}; }
      if (p === `/v1/work-runs/${IRUN}/delivery/prepare`) { S.prepared = true; return {status: 200, body: {artifact: {exportArtifactHash: "f".repeat(64)}}}; }
      // batch 4b: the analysis step answers 200 with the full BLOCKED step (Lane B route change), a product start without a verified sandbox is the plain 409 gate refusal.
      if (p === `/v1/missions/${IMSN}/analysis/step`) return {status: 200, body: {status: "BLOCKED", blocker: "PROVIDER_PROVENANCE_NOT_READY", blockers: ["PROVIDER_PROVENANCE_NOT_READY", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED"], founderAction: "free text that is never shown"}};
      if (p === `/v1/work-runs/${IRUN}/product/start`) return {status: 409, body: {error: "SANDBOX_UNAVAILABLE"}};
      return {status: 404, body: {}};
    };
    return {S, get, post};
  }
  const type = (root: N, id: string, v: string) => { byId(root, id)!.value = v; byId(root, id)!.fire("input"); };
  const sleep = () => new Promise(r => setTimeout(r, 0));
  it("a path the desktop does not admit is UNAVAILABLE (not a generic error) for every read and every POST, and each blocked or unavailable step tells the Founder the one thing they can do", async () => {
    const m = await load(rend, "model.js"), w = await load(rend, "work-core.js");
    for (const msg of ["INVALID_API_PATH", "Error invoking remote method 'uasco:api-get': Error: INVALID_API_PATH", new Error("INVALID_API_PATH")]) expect(m.classifyFailure(msg), String(msg)).toEqual({state: "UNAVAILABLE", status: null});
    expect(m.classifyFailure("HTTP 500")).toMatchObject({state: "ERROR"}); expect(m.classifyFailure("boom")).toEqual({state: "ERROR", status: null}); expect(m.classifyFailure("HTTP 404").state).toBe("UNAVAILABLE");
    expect(w.describePostResult({thrown: true, state: "UNAVAILABLE", message: "INVALID_API_PATH"}).key).toBe("post.err.unavailable");
    expect(w.describePostResult({thrown: true, state: "OFFLINE"}).key).toBe("post.err.offline"); expect(w.describePostResult({thrown: true, state: "ERROR"}).key).toBe("post.err.generic");
    const srv = await mkServer(), c = await mkCtx({lang: "en", get: srv.get, post: srv.post});
    const raw = await c.ctx.api.raw(`/v1/work-runs/${IRUN}/product`); expect(raw.state).toBe("UNAVAILABLE"); // after 4b the path is admitted; this fake server answers 404 for it (productRoute off), which is UNAVAILABLE too
    // end-to-end allow-list refusal leg: a run-scoped product path the desktop does NOT admit never reaches the fake server; the bridge refuses it (INVALID_API_PATH) and the read is UNAVAILABLE
    const refused = await c.ctx.api.raw(`/v1/work-runs/${IRUN}/product/status`); expect(refused.state).toBe("UNAVAILABLE");
    expect(srv.S.blocked).toEqual([`GET /v1/work-runs/${IRUN}/product/status`]); // the admitted product read above was not blocked; only the refused one is
    // product card: unavailable read -> one line and the Run tab button
    srv.S.project = {projectId: IPRJ, name: "P", tenantId: "t1", environmentId: "local", createdAt: "2026-10-26T05:00:00.000Z"}; srv.S.mission = {missionId: IMSN, projectId: IPRJ, title: "M", status: "PLANNED", riskLevel: "R1", createdAt: "2026-10-26T05:00:00.000Z"};
    srv.S.run = {runId: IRUN, missionId: IMSN, projectId: IPRJ, status: "AWAITING_APPROVAL", headSha: HEAD, startedAt: "2026-10-26T05:10:00.000Z", evidence: []};
    const st = await load(rend, "studio-state.js"), ws = await load(rend, "views", "projects.js"); st.openProject(IPRJ, "overview");
    const root = mount(c.doc, await ws.render(c.ctx)), prod = byId(root, "studio-ov-product")!;
    expect(prod.textContent).toContain("not available to the desktop yet"); expect(byData(prod, "productNext", "RUN_TAB")[0].textContent).toContain("start the project's dev command from the Run tab");
    byId(prod, "product-open-run")!.fire("click"); await sleep(); expect(st.studio.tab).toBe("run");
    // analysis: a not-enabled step still shows the hand-plan way out, and the button only navigates to Tasks with the mission selected
    const jv = await load(rend, "views", "journey.js"); forms.selection.missionId = IMSN;
    const jr = mount(c.doc, await jv.render(c.ctx)); c.calls.navigate.length = 0; forms.selection.missionId = IMSN;
    expect(byData(jr, "analysisHandPlan")[0].textContent).toContain("write the plan by hand in Tasks"); const before = srv.S.posts.length;
    forms.selection.missionId = "msn_" + H("9"); byId(jr, "analysis-hand-plan")!.fire("click"); expect(c.calls.navigate).toEqual(["work"]); expect(forms.selection.missionId).toBe(IMSN); expect(srv.S.posts.length).toBe(before); // navigation only, nothing sent
    // run card: NOT_EXECUTED because of the sandbox points to the setup check
    const core = await load(rend, "work-core.js"), work = await load(rend, "views", "work.js");
    const rc = work.runCard(c.ctx, core.mapWorkRunDetail({workRun: srv.S.run, outcomes: null, delivery: srv.S.delivery()}).run);
    expect(byData(rc, "runTestResult")[0].textContent).toContain("See Settings > Ready to build?");
  });
  it("drives idea -> intake -> analysis -> plan -> mission/task -> run -> test result -> product -> delivery and records every step's status", async () => {
    const srv = await mkServer(), table: Record<string, string> = {};
    const c = await mkCtx({lang: "en", get: srv.get, post: srv.post, confirm: () => true});
    const ctx = c.ctx;
    const view = async (...p: string[]) => mount(c.doc, await (await load(rend, ...p)).render(ctx));
    const intakeMod = await load(rend, "views", "intake.js"); intakeMod.resetIntakeAll();
    const sel = forms.selection;
    // 1) idea -> intake
    let root = await view("views", "projects.js");
    type(root, "intake-idea", IDEA); byId(root, "intake-form")!.fire("submit"); await sleep();
    root = await view("views", "projects.js");
    const card = byId(root, "intake-result")!;
    expect(card.dataset.intakeId).toBe(IITK); expect(byId(root, "intake-readiness")!.dataset.runReadiness).toBe("READY"); // a run can start; only the non-blocking plan check is open
    expect(byId(root, "intake-ready-go-PLAN_MISSION")).not.toBeNull(); expect(byId(root, "intake-open-mission")).not.toBeNull();
    expect(srv.S.posts[0]).toMatchObject({path: "/v1/intakes", body: {idea: IDEA, template: "web-node"}});
    table.INTAKE = "COMPLETE_IN_UI";
    // 2) analysis: the Journey shows the section; after 4b the step POST is admitted and the server answers its exact BLOCKED readiness
    byId(root, "intake-open-mission")!.fire("click"); expect(sel.missionId).toBe(IMSN);
    root = await view("views", "journey.js");
    expect(byId(root, "analysis-step")).not.toBeNull();
    fire(byId(root, "analysis-step-submit")!);
    async function fire(n: N) { n.fire("click"); await sleep(); }
    await sleep();
    root = await view("views", "journey.js");
    expect(byData(root, "analysisStatus", "BLOCKED").length).toBe(1); expect(byId(root, "analysis-plan-submit")).toBeNull();
    expect(byData(root, "analysisBlocker").map(n => n.dataset.analysisBlocker)).toEqual(["PROVIDER_PROVENANCE_NOT_READY", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED"]);
    expect(byId(root, "analysis-step-status")!.textContent).not.toContain("not enabled in this build"); expect(root.textContent).not.toContain("free text that is never shown");
    expect(srv.S.posts.map((x: {path: string}) => x.path)).toContain(`/v1/missions/${IMSN}/analysis/step`);
    table.ANALYSIS_DRAFTS = "BLOCKED_BY_SERVER_READINESS"; table.PLAN_FROM_ANALYSIS = "CLOSED_UNTIL_COMPLETE";
    // 3) the manual plan path in Work (POST /plan is allowed)
    root = await view("views", "work.js");
    expect(byId(root, "plan-form")).not.toBeNull();
    type(root, "plan-title-0", "Giriş ekranı"); byId(root, "plan-add")!.fire("click"); type(root, "plan-title-1", "Oylama API"); type(root, "plan-deps-1", "1");
    byId(root, "plan-form")!.fire("submit"); await sleep();
    expect(srv.S.tasks.map((t: any) => t.title)).toEqual(["Giriş ekranı", "Oylama API"]);
    table.PLAN_MANUAL = "COMPLETE_IN_UI";
    // 4) mission/task: the planned mission lists its tasks and can start a run
    root = await view("views", "work.js");
    expect(text(root)).toContain("Giriş ekranı"); expect(text(root)).toContain("Oylama API"); expect(byId(root, "plan-form")).toBeNull();
    expect(byId(root, "run-start")!.hasAttribute("disabled")).toBe(false);
    table.MISSION_TASKS = "COMPLETE_IN_UI";
    // 5) task run: start the run, then link the first task to it
    byId(root, "run-start")!.fire("click"); await sleep(); await sleep();
    expect(srv.S.run?.runId).toBe(IRUN);
    root = await view("views", "work.js");
    expect(byId(root, "run-link")).not.toBeNull();
    const cb: any = byData(root, "runlinkTask", ITSK(0))[0]; cb.checked = true; cb.fire("change");
    byId(root, "runlink-submit")!.fire("click"); await sleep(); await sleep();
    expect(srv.S.posts.filter((p: {path: string}) => p.path === `/v1/tasks/${ITSK(0)}/runs`)).toEqual([{path: `/v1/tasks/${ITSK(0)}/runs`, body: {runId: IRUN}}]);
    expect(srv.S.links.map((l: any) => l.taskId)).toEqual([ITSK(0)]); // only the ticked task was linked
    root = await view("views", "work.js");
    expect(byData(root, "runLinkedFor", IRUN)[0].textContent).toContain("Giriş ekranı"); // the run card now lists the linked task
    table.TASK_RUN = "COMPLETE_IN_UI";
    // 6) test result: the run card says what happened to the tests
    const tr = byData(root, "runTestResult")[0];
    expect(tr.dataset.runTestResult).toBe("NOT_EXECUTED"); expect(tr.dataset.runTestReason).toBe("SANDBOX_UNAVAILABLE"); expect(tr.textContent).toContain("No verified sandbox existed");
    table.TEST_RESULT = "COMPLETE_IN_UI";
    // 7) running product: after 4b the run-scoped route is admitted; Start is offered for the delivered commit and the server refuses without a verified sandbox
    c.calls.navigate.length = 0;
    sel.missionId = IMSN;
    const ws = await load(rend, "views", "projects.js"); const st = await load(rend, "studio-state.js"); st.openProject(IPRJ, "overview");
    srv.S.productRoute = true;
    root = mount(c.doc, await ws.render(ctx));
    expect(byId(root, "studio-ov-product")!.dataset.productOffer).toBe("START"); expect(byId(root, "product-start")).not.toBeNull();
    byId(root, "product-start")!.fire("click"); await sleep(); await sleep();
    root = mount(c.doc, await ws.render(ctx));
    const prod = byId(root, "studio-ov-product")!;
    expect(srv.S.posts.map((x: {path: string}) => x.path)).toContain(`/v1/work-runs/${IRUN}/product/start`);
    expect(byId(root, "product-run-status")!.textContent).toContain("SANDBOX_UNAVAILABLE"); expect(prod.dataset.productState).toBe("STOPPED"); expect(byData(prod, "productUrl").length).toBe(0); expect(byId(root, "product-stop")).toBeNull();
    table.RUNNING_PRODUCT = "REFUSED_NO_SANDBOX";
    // 8) delivery: prepare the delivery package (POST allowed) from the project's Delivery tab
    st.openProject(IPRJ, "delivery");
    root = mount(c.doc, await ws.render(ctx));
    const prep = byId(root, `dl-prep-${IRUN}`);
    expect(prep).not.toBeNull();
    prep!.fire("click"); await sleep();
    expect(srv.S.posts.map((p: {path: string}) => p.path)).toContain(`/v1/work-runs/${IRUN}/delivery/prepare`);
    expect(byId(mount(c.doc, await ws.render(ctx)), `dl-open-${IRUN}`)).not.toBeNull(); // the acceptance dialog can be opened
    table.DELIVERY = "COMPLETE_IN_UI";
    expect(table).toEqual({INTAKE: "COMPLETE_IN_UI", ANALYSIS_DRAFTS: "BLOCKED_BY_SERVER_READINESS", PLAN_FROM_ANALYSIS: "CLOSED_UNTIL_COMPLETE", PLAN_MANUAL: "COMPLETE_IN_UI", MISSION_TASKS: "COMPLETE_IN_UI", TASK_RUN: "COMPLETE_IN_UI", TEST_RESULT: "COMPLETE_IN_UI", RUNNING_PRODUCT: "REFUSED_NO_SANDBOX", DELIVERY: "COMPLETE_IN_UI"});
    // after 4b the renderer asks for nothing outside the allow-list
    expect([...new Set(srv.S.blocked)]).toEqual([]);
  });
});

// //TR: A-PREDEV-BUSY-1: elle plan, analiz/pre-dev eylemleriyle aynı mission-yazma kilidini paylaşır (aynı mission'ın görevlerini yazar).
describe("LANE-A A-PREDEV-BUSY-1: the hand plan shares the mission-write lock", () => {
  const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
  const planGet = () => (p: string) => {
    if (p === "/v1/projects") return {projects: [project()]};
    if (p === "/v1/missions") return {missions: [mission({status: "AUTHORIZED"})]};
    if (p === `/v1/missions/${MID}`) return {mission: mission({status: "AUTHORIZED"}), tasks: []};
    if (p.startsWith("/v1/work-runs")) return {workRuns: []};
    if (p.startsWith("/v1/evidence")) return {evidence: []};
    return undefined;
  };
  const OKPLAN = (b: any) => ({status: 201, body: {tasks: b.tasks.map((t: any, i: number) => ({taskId: "tsk_" + String(i).repeat(24), title: t.title}))}});
  const open = async (post: (p: string, b: any) => any) => {
    const c = await mkCtx({get: planGet(), post});
    forms.selection.missionId = MID;
    const view = await load(rend, "views", "work.js"), pf = await load(rend, "views", "plan-form.js");
    pf.resetPlanDraft(null);
    return {...c, view, pf, root: mount(c.doc, await view.render(c.ctx))};
  };
  const type = (root: N, id: string, v: string) => { byId(root, id)!.value = v; byId(root, id)!.fire("input"); };
  const deferred = () => { let res: (v: any) => void = () => {}; const p = new Promise<any>(r => { res = r; }); return {p, res}; };
  const soon = <T,>(p: Promise<T>): Promise<T | "NOT_REFUSED_IN_TIME"> => Promise.race([p, new Promise<"NOT_REFUSED_IN_TIME">(r => setTimeout(() => r("NOT_REFUSED_IN_TIME"), 300))]); // fail fast when a call is not refused (no timeout is raised)

  it("another mission-write action in flight: the hand plan button is disabled with a note, a submit is refused ({ok:false,busy:true}) and nothing is posted; it is usable again afterwards", async () => {
    const {ctx, calls, root, pf, view, doc} = await open((_p, b) => OKPLAN(b));
    type(root, "plan-title-0", "A");
    forms.drafts.busy["analysis-step"] = true; // an analysis step is in flight
    const busyRoot = mount(doc, await view.render(ctx));
    expect(byId(busyRoot, "plan-submit")!.attrs.get("disabled")).toBeDefined(); expect(byId(busyRoot, "plan-in-flight")!.textContent).toContain("Mission verisini değiştiren başka bir istek sürüyor"); expect(byId(busyRoot, "plan-in-flight")!.attrs.get("tabindex")).toBe("-1"); // the focus target
    // the note names no mission and no request kind (the lock is global), and uses the same word as the rest of the Turkish UI
    expect(byId(busyRoot, "plan-in-flight")!.textContent).not.toMatch(/bu mission|misyon|analiz isteği|ön[- ]?geliştirme isteği|el planı/i);
    expect(await pf.submitPlan(ctx, MID)).toEqual({ok: false, busy: true}); byId(busyRoot, "plan-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([]);
    forms.drafts.busy["analysis-step"] = false;
    const freeRoot = mount(doc, await view.render(ctx));
    expect(byId(freeRoot, "plan-submit")!.attrs.get("disabled")).toBeUndefined(); expect(byId(freeRoot, "plan-in-flight")).toBeNull();
  });

  it("a hand plan in flight locks the other actions; the lock is released on a rejecting repaint and on a dropped (other-mission) answer; same-tick double call = 1 POST; the note takes focus", async () => {
    const d = deferred(); const posts: string[] = [];
    const c = await open((p, b) => { posts.push(p); return d.p; });
    type(c.root, "plan-title-0", "A");
    const seen: boolean[] = [], orig = c.ctx.rerender; c.ctx.rerender = async () => { seen.push(forms.missionWriteBusy()); return orig(); }; // the lock state at every repaint
    const p1 = c.pf.submitPlan(c.ctx, MID), p2 = c.pf.submitPlan(c.ctx, MID);
    expect(await soon(p2)).toEqual({ok: false, busy: true}); expect(forms.missionWriteBusy()).toBe(true);
    await tick(); expect(posts).toHaveLength(1);
    // the lock is shared: an analysis submit is refused while the hand plan runs
    const an = await load(rend, "views", "analysis-step.js"); expect(await an.submitAnalysisStep(c.ctx, MID)).toEqual({ok: false, busy: true});
    c.pf.resetPlanDraft("msn_" + "9".repeat(24)); // another mission selected while A's request is in flight
    d.res(OKPLAN({tasks: [{title: "A"}]})); const r = await p1;
    expect(r).toMatchObject({ok: false, stale: true}); expect(forms.missionWriteBusy()).toBe(false); expect(c.calls.refresh).toBe(0); // no refresh for the dropped answer
    expect(seen, "busy at each repaint: set before the POST, released before the dropped answer repaints").toEqual([true, false]); // exactly one repaint for the dropped answer
    expect(forms.drafts.status["mission-plan"]).toBeUndefined(); // the dropped answer wrote no status for the other mission
    // rejecting repaint
    const e = await open((_p, b) => OKPLAN(b)); type(e.root, "plan-title-0", "A"); e.ctx.rerender = async () => { throw new Error("REPAINT_FAILED"); };
    await expect(e.pf.submitPlan(e.ctx, MID)).rejects.toThrow("REPAINT_FAILED"); expect(forms.missionWriteBusy()).toBe(false); expect(e.calls.post).toEqual([]);
    // focus
    const f = await open((_p, b) => OKPLAN(b)); type(f.root, "plan-title-0", "A"); const spy: any[] = []; f.ctx.settleFocus = (o: any) => { spy.push(o); return null; };
    await f.pf.submitPlan(f.ctx, MID); expect(spy[0]).toEqual({keys: ["id:plan-in-flight"]});
  });

  it("the busy refusal comes before validation: an invalid (empty) hand plan while another request runs is refused as busy and writes no validation status", async () => {
    const c = await open((_p, b) => OKPLAN(b)); // rows are empty = invalid
    forms.drafts.busy["predev-approve"] = true;
    expect(await soon(c.pf.submitPlan(c.ctx, MID))).toEqual({ok: false, busy: true}); expect(forms.drafts.status["mission-plan"]).toBeUndefined(); expect(c.calls.post).toEqual([]);
    forms.drafts.busy["predev-approve"] = false;
    const r = await c.pf.submitPlan(c.ctx, MID); expect(r).toMatchObject({validation: true}); expect(forms.drafts.status["mission-plan"]).toBeDefined(); // without the lock the same input is a validation error
  });
});

