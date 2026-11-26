// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-delivery.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0016.A / AUD-022 (RW-009) birleşik scrubber + dışa aktarma
// testidir: GERÇEK buildServer gerçek bir teslim ZIP'i hazırlar ve dışa aktarır; main.mjs'nin GERÇEK scrubText/sanitizePostBody ve deliveryExportCheck fonksiyonları kaynaktan değerlendirilir.
// sanitizePostBody mutlak yolu "[path]" yapar; UASCO-T0016.D (Founder-tier main.mjs) ile deliveryExportCheck artık body.path'e güvenmez, dosyayı yalnız veri dizini + doğrulanmış kayıttan türetir.
// Bu yüzden test KATIDIR: gerçek köprü gövdesiyle dışa aktarma başarılı olmalı, sha256 eşleşmeli; ayrıca GERÇEK uasco:export-delivery IPC işleyici kaynağı uçtan uca sürülür.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../../core/workos/store.js";
import {ExecutionGate} from "../../core/workos/execution-gate.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import {setup, okScript, runner, api, HDR, tmpRoot, rmTmp, TOKEN} from "./relfx.js";
import type {Ctx} from "./relfx.js";

const REPO = path.resolve(__dirname, "..", "..");
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs ${name} block not found`); return m[1]; };
const fnSrc = (name: string): string => { const m = new RegExp(`\\nfunction ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs function ${name} not found`); return m[0]; };
type Check = (body: unknown, runId: string, root: string, f: typeof fs, p: typeof path, c: typeof crypto) => {ok: boolean; reason?: string; sha256?: string; bytes?: Buffer; fileName?: string};
/** main.mjs'deki GERÇEK deliveryExportCheck (M1A-C2 bloğu). */
const mainCheck = new Function(`${block("M1A-C2")}\nreturn deliveryExportCheck;`)() as Check;
/** main.mjs'deki GERÇEK sanitizePostBody (+scrubText), belirteç kapanışıyla. */
const sanitize = new Function("token", `${fnSrc("scrubText")}${fnSrc("sanitizePostBody")}\nreturn sanitizePostBody;`)(TOKEN) as (status: number, parsed: unknown) => any;
const scrub = new Function("token", `${fnSrc("scrubText")}\nreturn scrubText;`)(TOKEN) as (v: unknown, max?: number) => string;

/** ÖNERİLEN Founder-tier main.mjs düzeltmesi (deliveryExportCheck yerine): dosya YALNIZ ana sürecin veri dizini + doğrulanmış kayıttan türetilir; sunucunun (temizlenmiş) body.path'ine güvenilmez.
 *  Diğer bütün kapılar aynen korunur (kayıt biçimi, sha256 + fileState, mutlak kök, gerçek yolun kök altında kalması, baytların yeniden sha256'sı). */
export const PROPOSED_DELIVERY_EXPORT_CHECK = `function deliveryExportCheck(body,runId,deliveriesRoot,fsMod,pathMod,cryptoMod){
  const rec=body&&typeof body==="object"?body.artifact:null;
  if(!DELIVERY_RUN_ID_RE.test(String(runId))||!rec||typeof rec!=="object"||rec.runId!==runId||!DELIVERY_HASH_RE.test(String(rec.exportArtifactHash))||rec.artifactPath!==\`deliveries/\${rec.runId}/\${rec.exportArtifactHash}.zip\`)return {ok:false,reason:"DELIVERY_RECORD_INVALID"};
  if(body.sha256!==rec.exportArtifactHash||body.fileState!=="VERIFIED")return {ok:false,reason:"DELIVERY_ARTIFACT_HASH_MISMATCH"};
  if(typeof deliveriesRoot!=="string"||!pathMod.isAbsolute(deliveriesRoot))return {ok:false,reason:"DELIVERY_PATH_REJECTED"};
  // AUD-022: body.path sanitizePostBody/scrubText ile "[path]" olur; dosya yalnız veri dizini + doğrulanmış kayıttan türetilir.
  let real,rootReal;try{rootReal=fsMod.realpathSync(deliveriesRoot);real=fsMod.realpathSync(pathMod.join(deliveriesRoot,rec.runId,\`\${rec.exportArtifactHash}.zip\`))}catch{return {ok:false,reason:"DELIVERY_ARTIFACT_MISSING"}}
  if(!real.startsWith(rootReal+pathMod.sep))return {ok:false,reason:"DELIVERY_PATH_REJECTED"};
  let bytes;try{bytes=fsMod.readFileSync(real)}catch{return {ok:false,reason:"DELIVERY_ARTIFACT_MISSING"}}
  const sha=cryptoMod.createHash("sha256").update(bytes).digest("hex");
  if(sha!==rec.exportArtifactHash)return {ok:false,reason:"DELIVERY_ARTIFACT_HASH_MISMATCH"};
  return {ok:true,bytes,sha256:sha,fileName:deliveryExportFileName(rec)};
}
`;
/** Önerilen fonksiyon, M1A-C2 bloğundaki deliveryExportCheck yerine konarak değerlendirilir (aynı sabitler ve deliveryExportFileName). */
const proposedCheck = (() => {
  const src = block("M1A-C2"), a = src.indexOf("function deliveryExportCheck("), b = src.indexOf("\n}\n", a) + 3;
  return new Function(`${src.slice(0, a)}${PROPOSED_DELIVERY_EXPORT_CHECK}${src.slice(b)}\nreturn deliveryExportCheck;`)() as Check;
})();

let tmp = "";
const apps: Array<{close: () => Promise<unknown>}> = [];

/** Gerçek teslim: web-node şablon projesi + mission + sahte executor koşusu (AWAITING_APPROVAL) + POST prepare; ardından POST export gövdesi (sunucunun gerçek yanıtı). */
async function realExport(c: Ctx) {
  const app = api(c, {sandbox: undefined}); apps.push(app);
  const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "AUD-022 App", environmentId: "dev", template: "web-node", idempotencyKey: "aud022"}});
  expect(created.statusCode, created.body).toBe(201);
  const pid = created.json().project.projectId as string;
  const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
  const missionId = mc.json().mission.missionId as string;
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
  const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n"}})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
  const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await runner({...c, store, missionId}, fake, {executionGate: new ExecutionGate(null)}).tick();
  const runId = r0.runId;
  expect(store.getRun({tenantId: "tA"}, runId)!.status).toBe("AWAITING_APPROVAL");
  expect((await app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/prepare`, headers: HDR, payload: {}})).statusCode).toBe(201);
  const ex = await app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/export`, headers: HDR, payload: {}});
  expect(ex.statusCode, ex.body).toBe(200);
  const raw = ex.json(), root = path.join(c.dataDir, "deliveries");
  return {runId, raw, root, file: raw.path as string};
}

export function registerDeliveryExportAud022Cases(): void {
  describe("UASCO-T0016.A / AUD-022: combined scrubber + desktop export (real buildServer delivery, real main.mjs functions)", () => {
    vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
    beforeEach(() => { tmp = tmpRoot("uasco-aud022-"); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });

    it("diagnosis: the server answers with the real absolute path under <data>/deliveries, and main.mjs's sanitizePostBody rewrites it to '[path]'", async () => {
      const c = setup(tmp), e = await realExport(c);
      expect(path.isAbsolute(e.file)).toBe(true);
      expect(fs.realpathSync(e.file)).toBe(fs.realpathSync(path.join(e.root, e.runId, `${e.raw.sha256}.zip`)));
      const clean = sanitize(200, e.raw);
      expect(clean.path).toBe("[path]");
      expect(clean.sha256).toBe(e.raw.sha256); // diğer alanlar korunur
      expect(clean.artifact.artifactPath).toBe(`deliveries/${e.runId}/${e.raw.sha256}.zip`); // göreli yol temizlenmez
      // Windows ve POSIX veri dizinleri de aynı biçimde silinir (paketli uygulama: %APPDATA% / ~/.config)
      for (const p of ["C:\\Users\\Founder\\AppData\\Roaming\\UASCO\\workos\\deliveries\\run_x\\h.zip", "C:/Users/Founder/AppData/Roaming/UASCO/deliveries/h.zip", "/home/founder/.config/UASCO/workos/deliveries/run_x/h.zip", "/Users/founder/Library/Application Support/UASCO/deliveries/h.zip", "/tmp/x/deliveries/h.zip"])
        { const out = scrub(p); expect(out.startsWith("[path]"), p).toBe(true); expect(out, p).not.toBe(p); expect(fs.existsSync(out)).toBe(false); }
      // not: boşluklu yol (macOS "Application Support") yalnız boşluğa kadar silinir; kalan kısım metinde kalır
      expect(scrub("/Users/founder/Library/Application Support/UASCO/x.zip")).toBe("[path] Support/UASCO/x.zip");
    });

    it("the real main.mjs export path (T0016.D fixed): the scrubbed bridge body exports the real ZIP and the sha256 matches", async () => {
      const c = setup(tmp), e = await realExport(c);
      const viaBridge = mainCheck(sanitize(200, e.raw), e.runId, e.root, fs, path, crypto);
      expect(viaBridge.ok, JSON.stringify({reason: viaBridge.reason})).toBe(true);
      expect(viaBridge.sha256).toBe(e.raw.sha256);
      expect(Buffer.compare(viaBridge.bytes!, fs.readFileSync(e.file))).toBe(0);
      expect(viaBridge.fileName).toBe(`UASCO-teslim-${e.runId}-${e.raw.sha256.slice(0, 12)}.zip`);
      // body.path (sunucu girdisi) artık hiçbir yeri işaret edemez: başka bir dosyaya yönlendirmek dışa aktarılan baytları değiştirmez
      const decoy = path.join(tmp, "decoy.zip"); fs.writeFileSync(decoy, Buffer.from("not the delivery"));
      const redirected = mainCheck({...sanitize(200, e.raw), path: decoy}, e.runId, e.root, fs, path, crypto);
      expect(redirected.ok).toBe(true);
      expect(Buffer.compare(redirected.bytes!, fs.readFileSync(e.file))).toBe(0);
    });

    it("main.mjs deliveryExportCheck IS the reviewed AUD-022 proposal (comments ignored)", () => {
      const strip = (src: string) => src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n").trim();
      const m = /function deliveryExportCheck\([\s\S]*?\n\}\n/.exec(block("M1A-C2"));
      expect(m).not.toBeNull();
      expect(strip(m![0])).toBe(strip(PROPOSED_DELIVERY_EXPORT_CHECK));
    });

    it("end to end through the REAL uasco:export-delivery IPC handler source: real server export -> sanitizePostBody -> deliveryExportCheck -> save dialog -> written copy re-hashed", async () => {
      const c = setup(tmp), e = await realExport(c);
      const app = apps[apps.length - 1] as any;
      const hm = /ipcMain\.handle\("uasco:export-delivery",[\s\S]*?\n\}\);\n/.exec(MAIN_SRC);
      expect(hm, "handler source").not.toBeNull();
      const saveTo = path.join(tmp, "saved", "export.zip"); fs.mkdirSync(path.dirname(saveTo), {recursive: true});
      const posts: string[] = []; let handler: ((ev: unknown, runId: unknown) => Promise<any>) | null = null;
      // main.mjs apiPost aynası: gerçek sunucuya POST, yanıt GERÇEK sanitizePostBody'den geçer
      const apiPost = async (p: string, bodyText: string) => { posts.push(p); const r = await app.inject({method: "POST", url: p, headers: {...HDR, "content-type": "application/json"}, payload: bodyText}); let parsed: unknown = null; try { parsed = JSON.parse(r.body); } catch { parsed = null; } return {status: r.statusCode, body: sanitize(r.statusCode, parsed)}; };
      const deps = {ipcMain: {handle: (n: string, fn: any) => { if (n === "uasco:export-delivery") handler = fn; }}, requireTrustedSender: () => undefined, DELIVERY_RUN_ID_RE: /^run_[0-9a-f]{24}$/, apiPost, deliveryExportCheck: mainCheck,
        path, fs, crypto, dataDirRoot: () => c.dataDir, controlWindow: null, dialog: {showSaveDialog: async (_w: unknown, o: any) => { expect(o.defaultPath).toBe(`UASCO-teslim-${e.runId}-${e.raw.sha256.slice(0, 12)}.zip`); return {canceled: false, filePath: saveTo}; }}};
      new Function(...Object.keys(deps), hm![0])(...Object.values(deps));
      expect(handler).not.toBeNull();
      const out = await handler!({}, e.runId);
      expect(out).toEqual({exported: true, sha256: e.raw.sha256, fileName: "export.zip", savedTo: saveTo});
      expect(posts).toEqual([`/v1/work-runs/${e.runId}/delivery/export`]);
      expect(crypto.createHash("sha256").update(fs.readFileSync(saveTo)).digest("hex")).toBe(e.raw.sha256);
      // kurcalanmış artefakt: işleyici bayt vermez, sunucu ya da ana süreç reddeder (sessiz başarı yok)
      fs.writeFileSync(e.file, Buffer.concat([fs.readFileSync(e.file), Buffer.from("x")])); fs.rmSync(saveTo);
      const bad = await handler!({}, e.runId);
      expect(bad.exported).toBe(false);
      expect(fs.existsSync(saveTo)).toBe(false);
      await expect(handler!({}, "run_bad")).rejects.toThrow("INVALID_RUN_ID");
    });

    it("proposed Founder-tier fix: the scrubbed bridge body exports the real ZIP (sha256 matches) and every existing guard still refuses", async () => {
      const c = setup(tmp), e = await realExport(c), body = sanitize(200, e.raw);
      const ok = proposedCheck(body, e.runId, e.root, fs, path, crypto);
      expect(ok.ok).toBe(true);
      expect(ok.sha256).toBe(e.raw.sha256);
      expect(crypto.createHash("sha256").update(ok.bytes!).digest("hex")).toBe(e.raw.sha256);
      expect(ok.fileName).toBe(`UASCO-teslim-${e.runId}-${e.raw.sha256.slice(0, 12)}.zip`);
      // korunan kapılar
      expect(proposedCheck(body, "run_" + "f".repeat(24), e.root, fs, path, crypto).reason).toBe("DELIVERY_RECORD_INVALID");
      expect(proposedCheck({...body, artifact: {...body.artifact, artifactPath: "../x.zip"}}, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_RECORD_INVALID");
      expect(proposedCheck({...body, sha256: "0".repeat(64)}, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
      expect(proposedCheck({...body, fileState: "MODIFIED"}, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
      expect(proposedCheck(body, e.runId, "relative/deliveries", fs, path, crypto).reason).toBe("DELIVERY_PATH_REJECTED");
      expect(proposedCheck(body, e.runId, path.join(tmp, "elsewhere"), fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_MISSING");
      // dosya kurcalanırsa (aynı ad, farklı bayt) hash yeniden doğrulanır
      fs.writeFileSync(e.file, Buffer.concat([fs.readFileSync(e.file), Buffer.from("x")]));
      expect(proposedCheck(body, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
    });

    it("proposed fix: a symlinked run directory that resolves outside the deliveries root is rejected; a missing file is MISSING", async () => {
      const c = setup(tmp), e = await realExport(c), body = sanitize(200, e.raw);
      const runDir = path.join(e.root, e.runId), outside = path.join(tmp, "outside-run");
      fs.mkdirSync(outside, {recursive: true});
      fs.copyFileSync(e.file, path.join(outside, path.basename(e.file)));
      fs.rmSync(runDir, {recursive: true, force: true});
      let linked = true;
      try { fs.symlinkSync(outside, runDir, "dir"); } catch { linked = false; } // Windows'ta ayrıcalık yoksa sembolik bağ atlanır
      if (linked) expect(proposedCheck(body, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_PATH_REJECTED");
      fs.rmSync(runDir, {recursive: true, force: true});
      expect(proposedCheck(body, e.runId, e.root, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_MISSING");
    });
  });
}
