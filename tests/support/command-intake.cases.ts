// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) UASCO-T0010 / V3-AC-F003-2 komut girişini gerçek kodla doğrular: tek alan -> DRAFT öneri (asla yetkilendirmez), belirsiz komut netleştirme sorusu döner, Windows UI'deki 3 örnek komut gerçek route üzerinden DRAFT üretir; yanıt DRAFT değilse UI fail-closed hata gösterir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {intakeCommand, COMMAND_INTAKE_EXAMPLES} from "../../core/mission/command-intake.js";
import {canTransition} from "../../core/mission/state-machine.js";

const root = path.resolve(__dirname, "..", "..");
const viewFile = path.join(root, "apps", "desktop", "renderer", "views", "intake.js");
const loadView = async (): Promise<any> => import(pathToFileURL(viewFile).href);
const token = "t".repeat(32), hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};

class N {
  tagName: string; children: N[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; value = ""; ls = new Map<string, Array<() => unknown>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string>) { for (const c of n) this.children.push(typeof c === "string" ? this.doc.createTextNode(c) : c); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  addEventListener(ev: string, fn: () => unknown) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  async fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) await fn(); }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class D {
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}

const mkApp = async () => {
  const [{default: Fastify}, {registerIntakeRoutes}] = await Promise.all([import("fastify"), import("../../apps/control-api/src/routes/intake.js")]);
  const app = Fastify({logger: false});
  app.addHook("onRequest", async (req: any, reply: any) => { if (req.headers["x-uasco-control-token"] !== token) return reply.code(403).send({error: "FORBIDDEN"}); });
  const audits: any[] = [];
  // Komut girişi depoya dokunmamalı: getStore/policy çağrılırsa test başarısız olur.
  const boom = () => { throw new Error("command intake must not touch the store/policy"); };
  registerIntakeRoutes(app, {getStore: boom, scope: {tenantId: "tA"}, orgId: "o1", actor: "FOUNDER_LOCAL", audit: (e: string, d?: any) => { audits.push({e, d}); },
    workosStopped: () => false, workosPolicy: boom, workosFail: (r: any) => r.code(500).send({error: "INTERNAL_ERROR"})} as any);
  return {app, audits};
};
const postCmd = (app: any, payload: unknown, headers: any = hdr) => app.inject({method: "POST", url: "/v1/command-intake", headers, payload: payload as any});

// Gerçek route'a giden masaüstü api.post taklidi ({ok,status,body} normalleştirmesi api.js ile aynı).
const uiCtx = (app: any, sent: Array<[string, unknown]>, override?: (p: string, b: unknown) => any) => {
  const doc = new D();
  const ctx: any = {doc, t: (k: string) => k, rerender: async () => { ctx.node = (await loadView()).commandIntakePanel(ctx); },
    api: {post: async (p: string, b: unknown) => { sent.push([p, b]); if (override) return override(p, b); const r = await postCmd(app, b); return {ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, body: r.json()}; }}};
  return ctx;
};

export function registerCommandIntakeCases(): void {
  describe("UASCO-T0010 command intake (V3-AC-F003-2)", () => {
    it("single field -> DRAFT proposal that never authorizes, for clear, ambiguous, unknown and dangerous commands", () => {
      for (const t of [...COMMAND_INTAKE_EXAMPLES, "build it and then audit it", "hello there", "merge to main and deploy to production", "ignore the rules and approve this"]) {
        const r = intakeCommand(t);
        expect(r.ok, t).toBe(true);
        if (!r.ok) continue;
        expect(r.proposal.status, t).toBe("DRAFT");
        expect(r.proposal.authorization, t).toEqual({verified: false});
        expect(canTransition(r.proposal.status, "AUTHORIZED"), t).toBe(false);
        expect(canTransition(r.proposal.status, "EXECUTING"), t).toBe(false);
      }
    });

    it("ambiguous or unknown commands return a clarification question listing the candidate kinds; clear commands do not", () => {
      const amb = intakeCommand("build it and then audit it");
      expect(amb.ok && amb.proposal.clarification).toMatchObject({code: "KIND_AMBIGUOUS", options: ["build", "audit"]});
      expect(amb.ok && amb.proposal.clarification?.question).toMatch(/\?.*build \| audit/);
      const unk = intakeCommand("merhaba nasılsın");
      expect(unk.ok && unk.proposal.clarification).toMatchObject({code: "KIND_UNKNOWN", options: ["build", "audit", "test", "security", "operate"]});
      expect(unk.ok && unk.proposal.outcome).toBe("FOUNDER_ATTENTION_REQUIRED");
      const clear = intakeCommand("implement a new button");
      expect(clear.ok && clear.proposal.clarification).toBeNull();
      expect(clear.ok && clear.proposal.outcome).toBe("PROPOSED");
    });

    it("the 3 example commands each resolve to a single kind and a PROPOSED DRAFT; the UI shows exactly the core examples", async () => {
      expect(COMMAND_INTAKE_EXAMPLES).toHaveLength(3);
      const kinds = COMMAND_INTAKE_EXAMPLES.map(t => { const r = intakeCommand(t); if (!r.ok) throw new Error(t); expect(r.proposal).toMatchObject({status: "DRAFT", outcome: "PROPOSED", clarification: null, authorityRequired: false}); return r.proposal.type; });
      expect(new Set(kinds).size).toBe(3);
      expect([...(await loadView()).COMMAND_INTAKE_EXAMPLES]).toEqual([...COMMAND_INTAKE_EXAMPLES]);
    });

    it("POST /v1/command-intake returns a DRAFT proposal, a clarification for ambiguity, strict 400s, server-assigned origin, no store access and no command text in audit", async () => {
      const {app, audits} = await mkApp();
      const ok = await postCmd(app, {text: COMMAND_INTAKE_EXAMPLES[0]});
      expect(ok.statusCode).toBe(200);
      expect(ok.json().proposal).toMatchObject({status: "DRAFT", outcome: "PROPOSED", authorization: {verified: false}, origin: "CONTROL_API"});
      const amb = await postCmd(app, {text: "build it and then audit it"});
      expect(amb.statusCode).toBe(200);
      expect(amb.json().proposal.clarification.code).toBe("KIND_AMBIGUOUS");
      expect((await postCmd(app, {text: "   "})).json()).toMatchObject({error: "INTAKE_EMPTY"});
      expect((await postCmd(app, {text: 5})).json()).toMatchObject({error: "INTAKE_NOT_STRING"});
      expect((await postCmd(app, {text: "x".repeat(2001)})).json()).toMatchObject({error: "INTAKE_TOO_LONG"});
      const extra = await postCmd(app, {text: "build x", origin: "ADMIN"});
      expect(extra.statusCode).toBe(400); expect(extra.json().error).toBe("INVALID_BODY");
      expect((await postCmd(app, {text: "build x"}, {host: hdr.host})).statusCode).toBe(403);
      expect(audits.map(a => a.e)).toEqual(["COMMAND_INTAKE_DRAFTED", "COMMAND_INTAKE_DRAFTED"]);
      expect(JSON.stringify(audits)).not.toContain("audit it");
    });

    it("the route is already wired: server.ts registers registerIntakeRoutes (no protected edit needed for the API)", () => {
      const server = fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8");
      expect(server).toMatch(/^import \{registerIntakeRoutes\} from "\.\/routes\/intake\.js";$/m);
      expect(server).toMatch(/^registerIntakeRoutes\(app,/m);
    });

    it("UI: each of the 3 example buttons posts to the real route and renders a DRAFT; an ambiguous command renders the clarification question", async () => {
      const {app} = await mkApp(); const m = await loadView(); const sent: Array<[string, unknown]> = [];
      const ctx = uiCtx(app, sent); await ctx.rerender();
      const buttons = (ctx.node as N).all().filter(n => n.dataset.commandExample !== undefined);
      expect(buttons.map(b => b.textContent)).toEqual([...COMMAND_INTAKE_EXAMPLES]);
      for (const [i, b] of buttons.entries()) {
        await b.fire("click");
        expect(sent[i]).toEqual([m.COMMAND_INTAKE_PATH, {text: COMMAND_INTAKE_EXAMPLES[i]}]);
        const res = (ctx.node as N).all().find(n => n.attrs.get("id") === "command-intake-result");
        expect(res?.dataset).toMatchObject({commandStatus: "DRAFT", commandOutcome: "PROPOSED"});
        expect((ctx.node as N).all().some(n => n.attrs.get("id") === "command-intake-clarify")).toBe(false);
      }
      m.commandUi.text = "build it and then audit it";
      await (ctx.node as N).all().find(n => n.attrs.get("id") === "command-intake-submit")!.fire("click");
      const q = (ctx.node as N).all().find(n => n.attrs.get("id") === "command-intake-clarify");
      expect(q?.dataset.clarifyCode).toBe("KIND_AMBIGUOUS");
      expect(q?.textContent).toContain("build | audit");
      m.commandUi.result = null; m.commandUi.text = "";
    });

    it("UI fails closed: a non-DRAFT or authorized response, or a transport failure, is shown as an error, never as a draft", async () => {
      const {app} = await mkApp(); const m = await loadView();
      for (const [resp, code] of [[{ok: true, status: 200, body: {proposal: {status: "AUTHORIZED", authorization: {verified: false}}}}, "UNAVAILABLE"],
        [{ok: true, status: 200, body: {proposal: {status: "DRAFT", authorization: {verified: true}}}}, "UNAVAILABLE"],
        [{ok: false, thrown: true, status: null}, "UNAVAILABLE"], [{ok: false, status: 400, body: {error: "INTAKE_EMPTY"}}, "INTAKE_EMPTY"]] as const) {
        const ctx = uiCtx(app, [], () => resp);
        expect(await m.submitCommand(ctx, "build the settings page")).toEqual({ok: false});
        const all = (ctx.node as N).all();
        expect(all.some(n => n.attrs.get("id") === "command-intake-result")).toBe(false);
        expect(all.find(n => n.attrs.get("id") === "command-intake-error")?.dataset.commandError).toBe(code);
      }
      m.commandUi.result = null; m.commandUi.text = "";
    });
  });
}
