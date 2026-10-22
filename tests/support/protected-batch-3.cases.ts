// //TR: COORD korumalı paket 3 testleri: server.ts proje belleği/bilgi özeti rotalarını ve sabit kodlu çerçeve hata sözleşmesini gerçekten kaydeder (gerçek buildServer, kendi kaydı yok), kanıt dizini laneDeps üzerinden bağlıdır; main.mjs izin listesi yalnız renderer'ın ürettiği kanonik bellek/bilgi yollarını ve boş gövdeli reconcile POST'unu kabul eder, hileli varyantları ve bellek yazmayı reddeder. Kayıtlı bir test dosyasından çağrılır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {buildServer} from "../../apps/control-api/src/server.js";
import {WorkOsStore} from "../../core/workos/store.js";

const MAIN = fs.readFileSync("apps/desktop/main.mjs", "utf8");
const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN); if (!m) throw new Error(`missing ${name}`); return m[1]; };
const getAllowed = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postAllowed = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn desktopPostPathAllowed;`)() as (v: unknown) => boolean;
const P = "prj_" + "0123456789abcdef01234567", RUN = "run_" + "a".repeat(24);
// Renderer modules are plain browser ESM without type declarations: loaded by URL, typed as any.
const renderer = (f: string): Promise<any> => import(pathToFileURL(path.resolve("apps/desktop/renderer", f)).href);
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function registerProtectedBatch3Cases() {
  describe("COORD protected batch 3: desktop allow-list", () => {
    it("allows the canonical memory, provenance and knowledge reads the renderer builds", async () => {
      const kc = await renderer("knowledge-core.js");
      const ok = [`/v1/projects/${P}/memory`, `/v1/projects/${P}/memory/current`, `/v1/projects/${P}/memory/health`, `/v1/projects/${P}/memory/mem_000001`,
        kc.provenancePath(P, "mem_000042"), kc.knowledgePath(P), `/v1/projects/${P}/memory?kind=FACT`,
        kc.buildMemorySearch(P, {kind: "DECISION", tag: "db", q: "use it!"}).path, kc.buildMemorySearch(P, {tag: "çğış ü"}).path,
        "/v1/attention", kc.buildMemorySearch(P, {q: "x".repeat(200)}).path, kc.buildMemorySearch(P, {q: "日本語".repeat(66)}).path, `/v1/projects/${P}/memory?tag=${enc("a&b=c?d")}`];
      for (const p of ok) expect(getAllowed(p), String(p)).toBe(true);
    });

    it("refuses every non-canonical memory or knowledge read (order, repeats, encoding, lengths, control chars, ids, suffixes)", () => {
      const bad = [`/v1/projects/${P}/memory?`, `/v1/projects/${P}/memory?tag=a&kind=FACT`, `/v1/projects/${P}/memory?kind=FACT&kind=NOTE`, `/v1/projects/${P}/memory?kind=fact`,
        `/v1/projects/${P}/memory?kind=`, `/v1/projects/${P}/memory?q=`, `/v1/projects/${P}/memory?q=a&`, `/v1/projects/${P}/memory?limit=5`, `/v1/projects/${P}/memory?q=a b`,
        `/v1/projects/${P}/memory?q=a%2`, `/v1/projects/${P}/memory?q=%e2%82%ac`, `/v1/projects/${P}/memory?q=%41`, `/v1/projects/${P}/memory?tag=%2D`, `/v1/projects/${P}/memory?q=%7E`, `/v1/projects/${P}/memory?q=it's`, `/v1/projects/${P}/memory?q=${enc("x".repeat(201))}`,
        `/v1/projects/${P}/memory?tag=${enc("t".repeat(65))}`, `/v1/projects/${P}/memory?q=${enc("a\u0007b")}`, `/v1/projects/${P}/memory?q=${enc("a\u007fb")}`, `/v1/projects/${P}/memory?q=%FF`,
        `/v1/projects/${P}/memory/`, `/v1/projects/${P}/memory/mem_12345`, `/v1/projects/${P}/memory/mem_0000000000001`, `/v1/projects/${P}/memory/MEM_000001`,
        `/v1/projects/${P}/memory/mem_000001/provenance/`, `/v1/projects/${P}/memory/mem_000001/provenance?x=1`, `/v1/projects/${P}/memory/current?x=1`, `/v1/projects/${P}/memory/mem_000001/raw`,
        `/v1/projects/${P}/knowledge?x=1`, `/v1/projects/${P}/knowledge/`, "/v1/projects/prj_" + "A".repeat(24) + "/memory", "/v1/projects/prj_" + "a".repeat(23) + "/knowledge",
        "/v1/attention?x=1", "/v1/attention/", "/v1/attention/x", `/v1/projects/${P}/../memory`, `/V1/projects/${P}/memory`, `//evil/v1/projects/${P}/memory`, `/v1/projects/${P}/memory?q=${"%41".repeat(400)}`];
      for (const p of bad) expect(getAllowed(p), p).toBe(false);
      for (const v of [undefined, null, 1, {}, [`/v1/projects/${P}/memory`]]) expect(getAllowed(v)).toBe(false);
    });

    it("allows the empty-body reconcile POST for a canonical run id, and still no memory write", async () => {
      const wc = await renderer("work-core.js");
      expect(postAllowed(wc.reconcilePath(RUN))).toBe(true);
      for (const p of [`/v1/work-runs/${RUN}/tasks/reconcile/`, `/v1/work-runs/${RUN}/tasks/reconcile?x=1`, "/v1/work-runs/run_" + "A".repeat(24) + "/tasks/reconcile",
        "/v1/work-runs/RUN-1/tasks/reconcile", `/v1/work-runs/${RUN}/tasks`, `/v1/projects/${P}/memory`, `/v1/projects/${P}/knowledge`]) expect(postAllowed(p), p).toBe(false);
    });
  });

  describe("COORD protected batch 3: server.ts registrations (real buildServer)", () => {
    it("serves project memory and the knowledge summary with the evidence index wired, and answers framework errors with fixed codes", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b3-")), token = crypto.randomBytes(16).toString("hex");
      const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
      const runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
      const app = buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false});
      const store = new WorkOsStore(path.join(tmp, "data"));
      const p = store.createProject({tenantId: "local", orgId: "local", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
      const mem = await app.inject({method: "GET", url: `/v1/projects/${p.projectId}/memory`, headers: hdr});
      expect(mem.statusCode, mem.body).toBe(200);
      expect(JSON.parse(mem.body)).toHaveProperty("records");
      const kn = await app.inject({method: "GET", url: `/v1/projects/${p.projectId}/knowledge`, headers: hdr});
      expect(kn.statusCode, kn.body).toBe(200);
      const evidence = JSON.parse(kn.body).knowledge.evidence;
      expect(evidence.state).not.toBe("UNAVAILABLE"); // EVIDENCE_NOT_WIRED would mean laneDeps lacks the evidence index
      // The memory append route is live on the Control API (token + Global Stop + policy + schema), the renderer cannot reach it (Desktop POST allow-list).
      const post = (headers: Record<string, string>) => app.inject({method: "POST", url: `/v1/projects/${p.projectId}/memory`, headers: {...headers, "content-type": "application/json"}, payload: JSON.stringify({kind: "FACT", title: "t", body: "b"})});
      expect((await post({host: "127.0.0.1:3210"})).statusCode).toBe(403);
      const appended = await post(hdr);
      expect([appended.statusCode, JSON.parse(appended.body).record?.id]).toEqual([201, "mem_000001"]);
      expect(JSON.parse((await app.inject({method: "GET", url: `/v1/projects/${p.projectId}/memory`, headers: hdr})).body).records.map((r: any) => r.id)).toEqual(["mem_000001"]);
      const att = await app.inject({method: "GET", url: "/v1/attention", headers: hdr});
      expect([att.statusCode, JSON.parse(att.body).attention?.source]).toEqual([200, "WORKOS"]);
      const badJson = await app.inject({method: "POST", url: "/v1/projects", headers: {...hdr, "content-type": "application/json"}, payload: "{not json"});
      expect([badJson.statusCode, JSON.parse(badJson.body)]).toEqual([400, {error: "INVALID_JSON"}]);
      const missing = await app.inject({method: "GET", url: "/v1/no-such-route", headers: hdr});
      expect([missing.statusCode, JSON.parse(missing.body).error]).toEqual([404, "NOT_FOUND"]);
      const badUrl = await app.inject({method: "GET", url: "/v1/missions/%E0%A4%A", headers: hdr}); // router-level error: needs the frameworkErrors constructor option
      expect([badUrl.statusCode, JSON.parse(badUrl.body)]).toEqual([400, {error: "BAD_URL"}]);
      expect((await app.inject({method: "GET", url: `/v1/projects/${p.projectId}/memory`, headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403); // token hook still guards
      await app.close();
      fs.rmSync(tmp, {recursive: true, force: true});
    });
  });
}
