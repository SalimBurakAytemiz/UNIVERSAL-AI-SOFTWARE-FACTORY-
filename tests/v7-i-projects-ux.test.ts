// //TR: Bu test (Builder I, Projeler UX) gerçek control-api üzerinde studio okuma hatasının açıklandığını, "Oluşturuldu" alanının tarih taşıdığını ve sandbox UNAVAILABLE iken dev-run Başlat/Yeniden başlat düğmelerinin görünür nedenle kapalı olduğunu doğrular.
// Builder I — Projects / Project Studio UX, against the REAL control-api (buildServer + app.inject) behind the desktop
// bridge's own GET/POST allow-lists. Each test pins one defect fix and carries a positive control:
//  (1) a studio read that fails says what could not be read, the HTTP status and that it is not an empty result (not a bare "Error");
//  (2) "Created" on the project card and the workspace overview carries the date, not only the time of day;
//  (3) the dev-run Start/Restart are disabled with a visible reason when the server reports the sandbox UNAVAILABLE,
//      and the server-side 409 DEVRUN_SANDBOX_UNAVAILABLE refusal is still enforced.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); if (!m) throw new Error(`missing ${name}`); return m[1]; };
const extraGet = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postGates = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  disabled?: boolean; isConnected = true;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "disabled") this.disabled = true; }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  contains(n: N | null): boolean { for (let c = n; c; c = c.parent) if (c === this) return true; return false; }
  focus() { /* test double */ } scrollIntoView() { /* test double */ }
}
class D {
  body: N; activeElement: N | null = null; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id);
const byData = (r: N, k: string, v?: string) => all(r).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));

const TOKEN = "t".repeat(32), hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, RECORDER = "implementer@local.invalid";
const ENV_KEYS = ["UASCO_WORKOS_EXECUTOR", "UASCO_WORKOS_RUNNER", "UASCO_CONTROL_ROOT"];
let tmp = ""; const saved: Record<string, string | undefined> = {}; const apps: Array<ReturnType<typeof buildServer>> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-i-proj-")); for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  const forms = await load("forms.js"); forms.resetAllForms?.();
  const st = await load("studio-state.js"); st.closeProject?.();
});

function gitRepo(dir: string) {
  fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  const g = (...a: string[]) => execFileSync("git", a, {cwd: dir, stdio: "ignore", env: {...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@local.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@local.invalid"}});
  g("init", "-q"); g("add", "."); g("commit", "-q", "-m", "init");
}

async function setup(lang: "en" | "tr" = "en", {repo = "managed" as "managed" | "unmanaged"} = {}) {
  const sb = fs.mkdtempSync(path.join(tmp, "b-")), dataDir = path.join(sb, "data"), runtime = path.join(sb, "runtime"), controlRoot = path.join(sb, "control");
  for (const d of [runtime, controlRoot]) fs.mkdirSync(d, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, dataDir, tenantId: "tA", port: 3210, logger: false, controlRoot, runner: {enabled: false}}); apps.push(app);
  let project: any;
  if (repo === "managed") {
    // the wizard's own route: a managed repository created by the server from a template
    const r = await app.inject({method: "POST", url: "/v1/projects", headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({name: "Book club", environmentId: "env-dev", template: "web-node", devCommand: ["node", "server.js"]})});
    if (r.statusCode !== 201 && r.statusCode !== 200) throw new Error(`create project: HTTP ${r.statusCode} ${r.body}`);
    project = r.json().project;
  } else {
    // a project registered with an existing local path (not managed): the studio cannot read it
    const repoDir = path.join(sb, "repo"); gitRepo(repoDir);
    project = new WorkOsStore(dataDir).createProject({tenantId: "tA", orgId: "org1", name: "Book club", environmentId: "env-dev", createdBy: RECORDER, repository: {path: repoDir}});
  }
  const baseGet = (await import("../automation/lib/control-boundary.mjs")).desktopGetPathAllowed as (v: unknown) => boolean;
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), cache = st.createStore(null), calls = {get: [] as string[], post: [] as Array<{path: string; status: number; body: any}>};
  const bridge = {
    apiGet: async (p: string) => { calls.get.push(p); if (!baseGet(p) && !extraGet(p)) throw new Error("INVALID_API_PATH"); const r = await app.inject({method: "GET", url: p, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); },
    apiPost: async (p: string, b: unknown) => {
      if (!postGates.desktopPostPathAllowed(p)) throw new Error("INVALID_API_PATH");
      const prepared = postGates.desktopPostBodyCheck(b); if (!prepared.ok) throw new Error(prepared.error);
      const r = await app.inject({method: "POST", url: p, headers: {...hdr, "content-type": "application/json"}, payload: prepared.text});
      let body: any = null; try { body = r.json(); } catch { /* non-json */ }
      calls.post.push({path: p, status: r.statusCode, body}); return {status: r.statusCode, body};
    }
  };
  const api = apiMod.createApi({bridge, store: cache});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store: cache, api, i18n: {lang, t}, t, navigate: () => {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => true, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
  const projects = await load("views", "projects.js"), studio = await load("studio-state.js");
  const view = async (tab?: string) => { if (tab) studio.openProject(project.projectId, tab); else studio.closeProject(); const root: N = await projects.render(ctx); doc.body.replaceChildren(root); return root; };
  const exec = (await app.inject({method: "GET", url: "/v1/system/executors", headers: hdr})).json();
  return {app, ctx, doc, calls, project, view, exec};
}

describe("Projects UX — a failed studio read is explained, not a bare 'Error'", () => {
  it("a project without a readable managed repository: Files and Changes say what could not be read, the HTTP status, and that it is not an empty result (en)", async () => {
    const s = await setup("en", {repo: "unmanaged"});
    const files = await s.view("files");
    const f = byData(files, "readFail", "files")!;
    expect(f).toBeDefined();
    const status = (await s.app.inject({method: "GET", url: `/v1/projects/${s.project.projectId}/files`, headers: hdr})).statusCode;
    expect(status).not.toBe(200); expect(status).not.toBe(404); // the real route fails as an ERROR (not UNAVAILABLE)
    expect(f.dataset.readFailStatus).toBe(String(status));
    expect(f.textContent).toContain("The folder listing could not be read.");
    expect(f.textContent).toContain(`The server answered HTTP ${status}.`);
    expect(f.textContent).toContain("This is not an empty result.");
    expect(byData(files, "readFail", "files")!.textContent).not.toBe("Error");
    const changes = await s.view("changes");
    const g = byData(changes, "readFail", "gitLog")!;
    expect(g).toBeDefined();
    expect(g.textContent).toContain("The git history could not be read.");
  });
  it("tr: the explanation is localised", async () => {
    const s = await setup("tr", {repo: "unmanaged"});
    const f = byData(await s.view("files"), "readFail", "files")!;
    expect(f.textContent).toContain("Klasör listesi okunamadı.");
    expect(f.textContent).toContain("Bu boş bir sonuç değildir.");
  });
  it("positive control: a present repository lists its files and history, with no read-failure note", async () => {
    const s = await setup("en");
    const files = await s.view("files");
    expect(byData(files, "readFail")).toBeUndefined();
    expect(all(files).some(n => n.id.startsWith("fe-"))).toBe(true);
    const changes = await s.view("changes");
    expect(byData(changes, "readFail")).toBeUndefined();
    expect(all(byId(changes, "studio-git-log")!).some(n => n.tagName === "TABLE" || n.tagName === "OL" || n.tagName === "UL")).toBe(true);
  });
  it("pure: readFail only explains ERROR; UNAVAILABLE/OFFLINE keep their own state note", async () => {
    const s = await setup("en");
    for (const state of ["UNAVAILABLE", "OFFLINE"]) {
      const ctx = {...s.ctx, api: {...s.ctx.api, projectFiles: async () => ({state, entries: [], truncated: false, message: "x: HTTP 404"})}};
      const studio = await load("studio-state.js"); studio.openProject(s.project.projectId, "files");
      const root: N = await (await load("views", "projects.js")).render(ctx);
      expect(byData(root, "readFail"), state).toBeUndefined();
    }
  });
});

describe("Projects UX — 'Created' carries the date", () => {
  it("project card and workspace overview show date and time (en and tr), the ISO kept in data", async () => {
    for (const lang of ["en", "tr"] as const) {
      const s = await setup(lang);
      const iso = s.project.createdAt;
      const work = await load("work-core.js"), model = await load("model.js");
      const want = work.formatDateTime(iso, lang), timeOnly = model.formatTime(iso, lang);
      expect(want).not.toBe(timeOnly); // the date is really part of the label
      const list = await s.view();
      const dd = byData(list, "projectCreated", iso)!;
      expect(dd.textContent).toBe(want);
      const ov = await s.view("overview");
      expect(all(byId(ov, "studio-panel")!).some(n => n.textContent === want)).toBe(true);
      expect(all(byId(ov, "studio-panel")!).some(n => n.tagName === "DD" && n.textContent === timeOnly)).toBe(false);
    }
  });
});

describe("Projects UX — dev-run Start is gated by the server's sandbox state", () => {
  it("sandbox UNAVAILABLE (real /v1/system/executors): Start and Restart are disabled and described by a visible reason; the server still refuses a direct start with 409", async () => {
    const s = await setup("en");
    expect(s.exec.sandbox?.state).toBe("UNAVAILABLE"); // the real server in this environment
    const root = await s.view("run");
    const start = byId(root, "studio-run-start")!, restart = byId(root, "studio-run-restart")!, why = byId(root, "studio-run-sandbox-why")!;
    expect(start.disabled).toBe(true); expect(restart.disabled).toBe(true);
    expect(byId(root, "studio-run-stop")!.disabled).toBe(true); // nothing runs, so Stop is off for its own reason
    for (const b of [start, restart]) { expect(b.getAttribute("aria-describedby")).toBe("studio-run-sandbox-why"); expect(b.dataset.runSandboxBlocked).toBe("SANDBOX_UNAVAILABLE"); }
    expect(why.textContent).toContain("SANDBOX_UNAVAILABLE");
    expect(why.textContent).toContain("Start and Restart are disabled");
    const r = await s.app.inject({method: "POST", url: `/v1/projects/${s.project.projectId}/devrun/start`, headers: {...hdr, "content-type": "application/json"}, payload: "{}"});
    expect(r.statusCode).toBe(409);
    expect(JSON.stringify(r.json())).toContain("SANDBOX_UNAVAILABLE");
  });
  it("tr: the reason is localised", async () => {
    const s = await setup("tr");
    expect(byId(await s.view("run"), "studio-run-sandbox-why")!.textContent).toContain("devre dışı");
  });
  it("positive control: a sandbox reported AVAILABLE (or not readable) leaves Start enabled and shows no reason", async () => {
    for (const ex of [{state: "VERIFIED", sandbox: {state: "AVAILABLE"}}, {state: "ERROR"}]) {
      const s = await setup("en");
      s.ctx.api = {...s.ctx.api, executors: async () => ex};
      const root = await s.view("run");
      expect(byId(root, "studio-run-start")!.disabled, JSON.stringify(ex)).toBe(false);
      expect(byId(root, "studio-run-sandbox-why")).toBeUndefined();
      expect(byId(root, "studio-run-start")!.getAttribute("aria-describedby")).toBeNull();
    }
  });
});
