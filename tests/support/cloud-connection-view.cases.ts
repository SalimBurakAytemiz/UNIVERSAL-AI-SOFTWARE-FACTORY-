// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0005 masaüstü bulut bağlantı görünümünün yalnız uzak istemci olduğunu doğrular: uç nokta yoksa fail-closed NOT_CONFIGURED, https zorunluluğunda gateway ile eşlik, çevrimdışı salt-okunur, rol bazlı uzak komutlar, belirteç/secret hiç çizilmez, sunucu metni yalnız textContent ile ve yerel yürütme yolu yok.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {ROLE_PERMISSIONS, resolveCloudRuntimeConfig, issueSession} from "../../apps/control-api/src/cloud/remote-gateway.js";

const root = path.resolve(__dirname, "..", "..");
const file = path.join(root, "apps", "desktop", "renderer", "views", "cloud-connection.js");
const load = async (): Promise<any> => import(pathToFileURL(file).href);

class N {
  tagName: string; children: N[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<() => void>>(); innerHTMLWrites = 0;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { this.innerHTMLWrites++; throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string>) { for (const c of n) this.children.push(typeof c === "string" ? this.doc.createTextNode(c) : c); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  addEventListener(ev: string, fn: () => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) fn(); }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class D {
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}
const now = new Date("2026-11-03T12:00:00Z");
const cfg = {endpoint: "https://cloud.example.invalid/api", environment: "staging"};
const sess = (roles: string[] = ["OPERATOR"], expiresAt = now.getTime() + 3_600_000) => ({subject: "user-001", tenantId: "tenant-001", roles, expiresAt});
const okModel = (over: Record<string, unknown> = {}) => ({config: cfg, online: true, probe: {status: "OK"}, session: sess(), jobs: [], now, ...over});
const render = async (model: unknown, extra: Record<string, unknown> = {}) => {
  const m = await load(); const doc = new D(); const sent: Array<[string, unknown]> = [];
  const node: N = m.cloudConnectionView({doc, t: (k: string) => k, sendRemoteCommand: (a: string, x: unknown) => sent.push([a, x]), ...extra}, model);
  return {node, sent, cmds: node.all().filter(n => n.dataset.cloudCmd).map(n => n.dataset.cloudCmd)};
};

export function registerCloudConnectionViewCases(): void {
  describe("CLOUD-T0005 desktop cloud connection view (remote-only client)", () => {
    it("fails closed with NOT_CONFIGURED when no endpoint is set, and offers no commands", async () => {
      for (const config of [undefined, {}, {endpoint: ""}, {endpoint: "   "}]) {
        const {node, cmds} = await render({...okModel(), config});
        expect(node.dataset.cloudState).toBe("NOT_CONFIGURED");
        expect(node.dataset.readOnly).toBe("true");
        expect(cmds).toEqual([]);
        expect(node.textContent).toContain("CLOUD_RUNTIME_NOT_CONFIGURED");
      }
    });
    it("endpoint resolution matches the gateway's resolveCloudRuntimeConfig", async () => {
      const m = await load();
      const cases: Array<[string | undefined, string | undefined]> = [
        [undefined, undefined], ["https://cloud.example.invalid/api", "staging"], ["http://cloud.example.invalid", "staging"],
        ["https://u:p@cloud.example.invalid", "staging"], ["https://cloud.example.invalid/?t=1", "staging"], ["https://cloud.example.invalid/#x", "staging"],
        ["https://localhost/api", "production"], ["https://127.0.0.1", "production"], ["https://[::1]", "production"], ["https://localhost/api", "staging"],
        ["not a url", "staging"], ["https://cloud.example.invalid", "dev"], ["file:///etc/passwd", "staging"], ["https://cloud.example.invalid", "production"],
      ];
      for (const [endpoint, environment] of cases) {
        const g = resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: endpoint, UASCO_CLOUD_ENVIRONMENT: environment});
        const c = m.resolveCloudEndpoint({endpoint, environment});
        expect(c.ok, `${endpoint}/${environment}`).toBe(g.ok);
        if (!g.ok && !c.ok) expect(c.reason).toBe(g.reason);
      }
    });
    it("rejects insecure endpoints with ENDPOINT_INSECURE and no commands", async () => {
      const {node, cmds} = await render(okModel({config: {endpoint: "http://cloud.example.invalid", environment: "staging"}}));
      expect(node.dataset.cloudState).toBe("ENDPOINT_INSECURE"); expect(cmds).toEqual([]);
    });
    it("client role actions mirror gateway ROLE_PERMISSIONS", async () => {
      const m = await load();
      expect(JSON.parse(JSON.stringify(m.CLIENT_ROLE_ACTIONS))).toEqual(JSON.parse(JSON.stringify(ROLE_PERMISSIONS)));
    });
    it("offline mode is status/read-only: no commands even for FOUNDER", async () => {
      const {node, cmds} = await render(okModel({online: false, session: sess(["FOUNDER"]), jobs: [{jobId: "job-1", status: "RUNNING", artifacts: [{name: "a.zip", sha256: "a".repeat(64)}]}]}));
      expect(node.dataset.cloudState).toBe("OFFLINE"); expect(node.dataset.readOnly).toBe("true"); expect(cmds).toEqual([]);
    });
    it("derives CONNECTING / ERROR / AUTH_REQUIRED / SESSION_EXPIRED closed states", async () => {
      const m = await load(); const st = (o: Record<string, unknown>) => m.deriveConnectionState(okModel(o));
      expect(st({probe: undefined}).state).toBe("CONNECTING");
      expect(st({probe: {status: "FAIL", code: "HTTP_503"}})).toMatchObject({state: "ERROR", error: "HTTP_503", readOnly: true});
      expect(st({session: null}).state).toBe("AUTH_REQUIRED");
      expect(st({session: sess(["ADMIN", "constructor"])}).state).toBe("AUTH_REQUIRED");
      expect(st({session: sess(["OPERATOR"], now.getTime())}).state).toBe("SESSION_EXPIRED");
      expect(st({session: {...sess(), expiresAt: undefined}}).state).toBe("SESSION_EXPIRED");
      for (const s of ["CONNECTING", "ERROR", "AUTH_REQUIRED", "SESSION_EXPIRED"]) expect(m.allowedCommands({state: s, readOnly: true, session: sess(["FOUNDER"])})).toEqual([]);
    });
    it("connected commands follow least privilege and go only to the remote bridge", async () => {
      const job = {jobId: "job-1", status: "RUNNING", artifacts: [{name: "out.zip", sha256: "b".repeat(64)}, {name: "nosha.zip"}]};
      const v = await render(okModel({session: sess(["VIEWER"]), jobs: [job]}));
      expect(v.cmds).toEqual(["artifact.download"]);
      const o = await render(okModel({session: sess(["OPERATOR"]), jobs: [job]}));
      expect(o.cmds.sort()).toEqual(["artifact.download", "job.cancel", "job.submit"]);
      const f = await render(okModel({session: sess(["FOUNDER"]), jobs: [job]}));
      expect(f.cmds).toContain("system.stop");
      for (const n of f.node.all().filter(x => x.dataset.cloudCmd)) n.fire("click");
      expect(f.sent.map(s => s[0]).sort()).toEqual(["artifact.download", "job.cancel", "job.submit", "system.stop"]);
      expect(f.sent.find(s => s[0] === "artifact.download")![1]).toEqual({jobId: "job-1", name: "out.zip"});
    });
    it("never renders session tokens or secrets, even if the server sends them", async () => {
      const token = issueSession({subject: "user-001", tenantId: "tenant-001", roles: ["OPERATOR"]}, 3_600_000, "sk-1", "session-fixture-key-".repeat(3), now);
      const leak = "provider-fixture-credential-0123456789";
      const {node} = await render(okModel({
        session: {...sess(), token, secret: leak, accessToken: token},
        jobs: [{jobId: "job-1", status: "FAILED", message: `auth failed token=${leak} Bearer abc.def.ghi session ${token} key sk-ABCDEFGHIJKLMNOP`}],
      }));
      const text = node.all().map(n => n.textContent + [...n.attrs.values()].join(" ") + Object.values(n.dataset).join(" ")).join(" ");
      expect(text).not.toContain(token); expect(text).not.toContain(token.split(".")[2]!); expect(text).not.toContain(leak); expect(text).not.toContain("abc.def.ghi"); expect(text).not.toContain("sk-ABCDEFGHIJKLMNOP");
      expect(text).toContain("[REDACTED]");
    });
    it("server text is written only as text (escaped), with control chars stripped and length capped", async () => {
      const m = await load();
      const evil = "<img src=x onerror=alert(1)><script>x()</script>";
      const {node} = await render(okModel({jobs: [{jobId: evil, status: "‮evil\u0000", message: "x".repeat(5000)}]}));
      const all = node.all();
      expect(all.some(n => ["IMG", "SCRIPT"].includes(n.tagName))).toBe(false);
      expect(node.textContent).toContain(evil);
      expect(all.every(n => n.innerHTMLWrites === 0)).toBe(true);
      expect(m.sanitizeServerText("‮evil\u0000")).toBe("evil");
      expect(m.sanitizeServerText("x".repeat(5000)).length).toBeLessThanOrEqual(513);
    });
    it("source has no local runtime/WSL/process execution path and no HTML sinks", () => {
      const src = fs.readFileSync(file, "utf8").split("\n").filter(l => !l.trim().startsWith("//")).join("\n").replace(/"[^"\n]*"/g, '""');
      expect(src).not.toMatch(/child_process|\bspawn\b|\bexecFile\b|\bexec\(|\brequire\(|ipcRenderer|\bprocess\.|\bwsl\b|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/i);
      expect([...src.matchAll(/^import .* from "(.*)";$/gm)].length).toBe(1);
    });
    it("exposes LOCAL_EXECUTION_ALLOWED=false and marks the region as remote-only", async () => {
      const m = await load(); expect(m.LOCAL_EXECUTION_ALLOWED).toBe(false);
      const {node} = await render(okModel());
      expect(node.dataset.localExecution).toBe("false"); expect(node.dataset.cloudState).toBe("CONNECTED");
    });
  });
}
