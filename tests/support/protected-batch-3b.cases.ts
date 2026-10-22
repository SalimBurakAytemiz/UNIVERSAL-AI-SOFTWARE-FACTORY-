// //TR: COORD korumalı paket 3b testleri: server.ts pre-dev Founder karar rotalarını ve kanıttan hesaplanan rol yaşam döngüsü özetini gerçekten kaydeder (gerçek buildServer, kendi kaydı yok); main.mjs izin listesi yalnız kanonik kimlikli üç pre-dev POST yolunu ve sorgusuz GET /v1/roles/status-summary yolunu kabul eder, hileli varyantları reddeder. Kayıtlı bir test dosyasından çağrılır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {buildServer} from "../../apps/control-api/src/server.js";
import {WorkOsStore} from "../../core/workos/store.js";
import {PreDevDriver} from "../../core/workos/predev/driver.js";
import {TASKHUB_BRIEF} from "../../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../../core/workos/predev/fixtures/taskhub/index.js";

const MAIN = fs.readFileSync("apps/desktop/main.mjs", "utf8");
const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN); if (!m) throw new Error(`missing ${name}`); return m[1]; };
const getAllowed = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postAllowed = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn desktopPostPathAllowed;`)() as (v: unknown) => boolean;
const M = "msn_" + "0123456789abcdef01234567", A = "pda_" + "89abcdef0123456789abcdef";
// Renderer modules are plain browser ESM without type declarations: loaded by URL, typed as any.
const renderer = (f: string): Promise<any> => import(pathToFileURL(path.resolve("apps/desktop/renderer", f)).href);

export function registerProtectedBatch3bCases() {
  describe("COORD protected batch 3b: desktop allow-list", () => {
    it("allows the three pre-dev decision POSTs for canonical mission and artifact ids, and nothing near them", () => {
      for (const p of [`/v1/missions/${M}/predev/start`, `/v1/missions/${M}/predev/artifacts/${A}/approve`, `/v1/missions/${M}/predev/artifacts/${A}/reject`]) {
        expect(postAllowed(p), p).toBe(true);
        expect(getAllowed(p), p).toBe(false);
      }
      const bad = [`/v1/missions/${M}/predev/start/`, `/v1/missions/${M}/predev/start?x=1`, `/v1/missions/${M}/predev`, `/v1/missions/${M}/predev/stop`,
        `/v1/missions/${M}/predev/artifacts/${A}/submit`, `/v1/missions/${M}/predev/artifacts/${A}/approve/`, `/v1/missions/${M}/predev/artifacts/${A}/approve?x=1`,
        `/v1/missions/${M}/predev/artifacts/${A}`, `/v1/missions/${M}/predev/artifacts/${A}/approvereject`, `/v1/missions/${M}/predev/artifacts/${A}/Approve`,
        `/v1/missions/${M}/predev/artifacts/pda_${"A".repeat(24)}/approve`, `/v1/missions/${M}/predev/artifacts/pda_${"a".repeat(23)}/reject`, `/v1/missions/${M}/predev/artifacts/art_${"a".repeat(24)}/approve`,
        `/v1/missions/msn_${"A".repeat(24)}/predev/start`, `/v1/missions/msn_${"a".repeat(25)}/predev/start`, `/v1/missions/${M}/predev/artifacts/${A}/../${A}/approve`,
        `/v1/missions/${M}/predev/artifacts/${A}%2Fapprove`, `/V1/missions/${M}/predev/start`, `//evil/v1/missions/${M}/predev/start`, `/v1/predev/${M}`, `/v1/missions/${M}/predev/artifacts/${A}/approve\n`,
        // left anchor and mission id on every pattern: a prefix or a smuggled query must not reach another route (apiPost sends apiBase+path as is)
        `/x/v1/missions/${M}/predev/start`, `/v1/control/resume?/v1/missions/${M}/predev/start`, `//evil/v1/missions/${M}/predev/artifacts/${A}/approve`, `/x/v1/missions/${M}/predev/artifacts/${A}/reject`,
        `/v1/control/resume?/v1/missions/${M}/predev/artifacts/${A}/approve`, `/v1/missions/msn_${"A".repeat(24)}/predev/artifacts/${A}/approve`, `/v1/missions/msn_${"a".repeat(25)}/predev/artifacts/${A}/reject`];
      for (const p of bad) expect(postAllowed(p), p).toBe(false);
      for (const v of [undefined, null, 1, {}, [`/v1/missions/${M}/predev/start`]]) expect(postAllowed(v)).toBe(false);
    });

    it("allows the read-only role status summary the renderer requests, without a query, and does not open the role list to writes", async () => {
      const af = await renderer("agent-factory-core.js");
      expect(getAllowed(af.STATUS_SUMMARY_PATH)).toBe(true);
      expect(getAllowed("/v1/roles/UASCO-0001")).toBe(true); // the existing role detail stays as it was
      for (const p of ["/v1/roles/status-summary/", "/v1/roles/status-summary?x=1", "/v1/roles/status-summary?", "/v1/roles/STATUS-SUMMARY", "/v1/roles/status-summaryx",
        "/v1/roles/status-summary%2F", "/v1/roles/status-summary/../x", "/v1/roles/status", "/V1/roles/status-summary",
        "/x/v1/roles/status-summary", "//evil/v1/roles/status-summary", "/v1/runs/r1/logs/stdout?q=/v1/roles/status-summary"]) expect(getAllowed(p), p).toBe(false);
      for (const p of ["/v1/roles/status-summary", "/v1/roles", "/v1/roles/UASCO-0001"]) expect(postAllowed(p), p).toBe(false);
    });
  });

  describe("COORD protected batch 3b: server.ts registrations (real buildServer)", () => {
    it("runs the Founder pre-dev decisions through the registered routes: start, approve with evidence, reject keeps the phase, the re-draft supersedes and is approved", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b3b-")), token = crypto.randomBytes(16).toString("hex"), SC = {tenantId: "local"};
      const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210", "content-type": "application/json"};
      const runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
      const app = buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false});
      const store = new WorkOsStore(path.join(tmp, "data"));
      const p = store.createProject({tenantId: "local", orgId: "local", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
      const m = store.createMission({tenantId: "local", projectId: p.projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SC, m.missionId, to, "go", "FOUNDER_LOCAL");
      const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: {produce: async (kind: any) => JSON.stringify((TASKHUB_ARTIFACTS as any)[kind])}});
      const post = (url: string, body: unknown, headers: Record<string, string> = hdr) => app.inject({method: "POST", url, headers, payload: JSON.stringify(body)});
      const draft = async () => { const out = await driver.produceCurrentPhase(SC, m.missionId, "agent-ba@local.invalid"); if (out.status !== "RECORDED") throw new Error(JSON.stringify(out)); return out.artifactId; };
      const base = `/v1/missions/${m.missionId}/predev`;
      expect((await post(`${base}/start`, {}, {host: "127.0.0.1:3210", "content-type": "application/json"})).statusCode).toBe(403); // token hook still guards
      const s = await post(`${base}/start`, {});
      expect([s.statusCode, s.json().predev?.phase], s.body).toEqual([201, "BUSINESS_ANALYSIS"]);
      const a1 = await post(`${base}/artifacts/${await draft()}/approve`, {evidenceRefs: ["evd_taskhub_ba_signed"]});
      expect([a1.statusCode, a1.json().predev?.phase], a1.body).toEqual([200, "REQUIREMENTS"]);
      const rejected = await draft();
      const r = await post(`${base}/artifacts/${rejected}/reject`, {reason: "Acceptance criteria are not testable"});
      expect([r.statusCode, r.json().predev?.phase], r.body).toEqual([200, "REQUIREMENTS"]);
      const noEvidence = await post(`${base}/artifacts/${rejected}/approve`, {});
      expect(noEvidence.statusCode).toBe(400); // strict body: evidenceRefs is required
      const a2 = await post(`${base}/artifacts/${await draft()}/approve`, {evidenceRefs: ["evd_taskhub_req_signed"]}); // the re-draft carries supersedes (#198)
      expect([a2.statusCode, a2.json().predev?.phase], a2.body).toEqual([200, "PLANNING"]);
      await app.close();
      fs.rmSync(tmp, {recursive: true, force: true});
    });

    it("serves the role lifecycle summary from evidence with five independent counters, and the static path does not shadow role detail", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b3b-")), token = crypto.randomBytes(16).toString("hex");
      const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
      const runtime = path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
      const app = buildServer({controlToken: token, runtime, dataDir: path.join(tmp, "data"), port: 3210, logger: false});
      const res = await app.inject({method: "GET", url: "/v1/roles/status-summary", headers: hdr});
      expect(res.statusCode, res.body).toBe(200);
      const s = res.json().statusSummary, roles = JSON.parse(fs.readFileSync("registries/role-definitions.json", "utf8")).roles;
      expect([s.target, s.registered]).toEqual([599, roles.length]);
      for (const k of ["implemented", "tested", "certified", "running"]) expect(Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= s.registered, k).toBe(true);
      expect(s.basis.roleDefinitionsSha256).toBe(crypto.createHash("sha256").update(fs.readFileSync("registries/role-definitions.json")).digest("hex"));
      const detail = await app.inject({method: "GET", url: `/v1/roles/${roles[0].roleId}`, headers: hdr});
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json()).not.toHaveProperty("statusSummary");
      expect((await app.inject({method: "GET", url: "/v1/roles/status-summary", headers: {host: "127.0.0.1:3210"}})).statusCode).toBe(403);
      await app.close();
      fs.rmSync(tmp, {recursive: true, force: true});
    });
  });
}
