// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-delivery.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0016.A / AUD-022 (RW-009) birleşik scrubber + dışa aktarma
// testidir: GERÇEK buildServer gerçek bir teslim ZIP'i hazırlar ve dışa aktarır; main.mjs'nin GERÇEK scrubText/sanitizePostBody ve deliveryExportCheck fonksiyonları kaynaktan değerlendirilir.
// Bugün sanitizePostBody mutlak yolu "[path]" yaptığı için dışa aktarma DELIVERY_ARTIFACT_MISSING ile başarısızdır (hata sabitlenir); main.mjs düzeltilince test kendiliğinden "dışa aktarma
// başarılı + sha256 eşleşir" beklentisine sıkılaşır. Önerilen Founder-tier düzeltme (yalnız veri dizininden türetilen yol) aynı gerçek artefaktla burada doğrulanır.
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

    it("the real main.mjs export path: today it fails with DELIVERY_ARTIFACT_MISSING only because of the scrubbed path (the unscrubbed body passes); once main.mjs is fixed this tightens to a real export", async () => {
      const c = setup(tmp), e = await realExport(c);
      const viaBridge = mainCheck(sanitize(200, e.raw), e.runId, e.root, fs, path, crypto);
      const unscrubbed = mainCheck(e.raw, e.runId, e.root, fs, path, crypto);
      expect(unscrubbed.ok).toBe(true); // tek neden temizlenmiş yoldur
      const bytes = fs.readFileSync(e.file);
      if (viaBridge.ok) {
        // main.mjs düzeltildi: masaüstü dışa aktarma gerçek ZIP'i verir ve sha256 eşleşir
        expect(viaBridge.sha256).toBe(e.raw.sha256);
        expect(Buffer.compare(viaBridge.bytes!, bytes)).toBe(0);
      } else {
        // AUD-022 bugün: her masaüstü dışa aktarma başarısız
        expect(viaBridge).toEqual({ok: false, reason: "DELIVERY_ARTIFACT_MISSING"});
      }
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
