//TR: Bu dosya rol yaşam döngüsü özetini (GET /v1/roles/status-summary) sağlar: REGISTERED/IMPLEMENTED/TESTED/CERTIFIED/RUNNING beş bağımsız sayaç yalnız kanıttan hesaplanır (core/agents/role-lifecycle.ts); salt okunur, durum yükseltmez. server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-C-role-status-route.md).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {RouteDeps} from "./deps.js";
import {FIRST_DELIVERY_BINDINGS} from "../../../../core/agents/first-delivery-bindings.js";
import {computeRoleStatusSummary, createEvidenceVerifier} from "../../../../core/agents/role-lifecycle.js";
import {READINESS_INPUT_FILES, computeRoleReadiness, loadReadinessInputFromRepo, reconcileLegacyStatusSummary} from "../../../../core/agents/readiness-audit.js";
import type {AdapterRealityEntry, ReadinessInput} from "../../../../core/agents/readiness-audit.js";
import {ADAPTER_REALITY_RECORDS, buildAdapterRealityMap} from "../../../../core/capabilities/adapter-reality.js";

export const ROLE_REGISTRY_FILE_REL = path.join("registries", "role-definitions.json");

// //TR: M3: readiness girdisinin DURAĞAN kısmı (kayıtlar + bilgi profilleri, ~420 dosya) süreç başına ve repoRoot başına bir kez yüklenir; her istekte yalnız çalışma gözlemi (runs) ve zaman yenilenir. Geçersiz kılma: girdi dosyalarının (boyut + mtime) parmak izi.
const statKey = (root: string, rel: string): string => { try { const st = fs.statSync(path.join(root, rel)); return `${rel}|${st.size}|${st.mtimeMs}`; } catch { return `${rel}|absent`; } };
const fingerprint = (root: string, slugs: readonly string[]): string => [...READINESS_INPUT_FILES.registries, ...slugs.map(x => `${READINESS_INPUT_FILES.knowledgeDir}/${x}.json`)].map(r => statKey(root, r)).join("\n");
// //TR: Bilinen sınırlama: boyut + mtime parmak izi, AYNI boyutta ve AYNI mtime ile yapılan bir içerik değişikliğini görmez (içerik özeti alınmaz); rol kaydı için sha çapraz denetimi (aşağıda) bu durumu yakalar.
const slugsOnDisk = (root: string): string[] => { try { const t = JSON.parse(fs.readFileSync(path.join(root, READINESS_INPUT_FILES.registries.find(r => r.endsWith("/technologies.json"))!), "utf8")); return Array.isArray(t?.technologies) ? t.technologies.map((x: any) => String(x?.slug)) : []; } catch { return []; } };
const staticInputCache = new Map<string, {fp: string; slugs: string[]; input: ReadinessInput}>();
/** Test kancası: önbelleği boşaltır. */
export function resetReadinessInputCache(): void { staticInputCache.clear(); }
function staticReadinessInput(root: string, now: Date): ReadinessInput {
  const hit = staticInputCache.get(root);
  if (hit && fingerprint(root, hit.slugs) === hit.fp) return hit.input;
  // L3: TÜM girdi listesinin parmak izi yüklemeden ÖNCE alınır ve sonra karşılaştırılır; yükleme sırasında bir dosya değiştiyse sonuç önbelleğe ALINMAZ.
  const slugs = slugsOnDisk(root), before = fingerprint(root, slugs);
  const input = loadReadinessInputFromRepo(root, {runs: {journal: "ABSENT"}, now});
  const loaded = [...input.technologies.keys()];
  if (loaded.length === slugs.length && loaded.every((x, k) => x === slugs[k]) && fingerprint(root, slugs) === before) staticInputCache.set(root, {fp: before, slugs, input});
  return input;
}
// //TR: B-ADAPTER: adapterReality YALNIZ doğrulanmış bir KAYNAK AĞACINDA verilir (geliştirme/çalışma ağacı). Paketlenmiş uygulamada (installer yalnız çalışma-zamanı VERİ dosyalarını hazırlar) adaptör modül/çağıran kaynakları yoktur; hepsini "kod yok" (ABSENT) saymak yanlış bir "araç hazır değil" iddiası olurdu, bu yüzden orada rapor NOT_SUPPLIED kalır (TOOL_READY UNKNOWN). Ağaç işaretleri HİÇBİR kayda bağlı değildir: doğrulanmış bir ağaçta eksik bir modül dosyası GERÇEK bir codePath ABSENT'tir (haritanın amacı). Yoklama (probe) UYDURULMAZ: her giriş NOT_OBSERVED kalır.
const TREE_MARKERS = ["core/capabilities/adapter-reality.ts", "core/capabilities/resolver.ts"] as const;
const REPO_PACKAGE_NAME = "universal-ai-software-company-os";
export function sourceTreePresent(root: string): boolean {
  try {
    for (const m of TREE_MARKERS) if (!fs.statSync(path.join(root, m)).isFile()) return false;
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))?.name === REPO_PACKAGE_NAME;
  } catch { return false; }
}
// //TR: Önbellek anahtarı: verifyRecord'un OKUDUĞU her dosyanın (modül, çağıranlar, npm paketlerinin package.json'ı) İÇERİK özeti; boyut+mtime değil, bu yüzden aynı boyut/aynı mtime ile yapılan bir düzenleme bayat bir PRESENT bırakamaz. Önbellek süreç başınadır (repoRoot başına bir giriş); özet her istekte yeniden hesaplanır (yalnız okuma + sha256, ayrıştırma yok).
const adapterSourceFiles = (): string[] => [...new Set(ADAPTER_REALITY_RECORDS.flatMap(r => [r.mode === "NPM_PACKAGE" ? path.join("node_modules", r.module, "package.json") : r.module, ...r.callers.map(c => c.file)]))].sort();
// //TR: Özet düz dosya olmayan girdiyi (FIFO, dizin) OKUMAZ (FIFO okuması süreci sonsuza dek bloklardı): tür işareti yeter. Okunamayan dosya ("<unreadable>") yok sayılan dosyadan ("<absent>") ayrı işaretlenir.
const contentFingerprint = (root: string): string => {
  const h = crypto.createHash("sha256");
  for (const rel of adapterSourceFiles()) {
    h.update(rel + "\0");
    const abs = path.join(root, rel);
    try { h.update(fs.statSync(abs).isFile() ? fs.readFileSync(abs) : "<non-file>"); } catch (e) { h.update((e as NodeJS.ErrnoException)?.code === "ENOENT" ? "<absent>" : "<unreadable>"); }
    h.update("\0");
  }
  return h.digest("hex");
};
const adapterCache = new Map<string, {fp: string; entries: ReadonlyMap<string, AdapterRealityEntry>}>();
/** Test kancası: adaptör gerçeklik önbelleğini boşaltır. */
export function resetAdapterRealityCache(): void { adapterCache.clear(); }
const sameEntries = (a: ReadonlyMap<string, AdapterRealityEntry>, b: ReadonlyMap<string, AdapterRealityEntry>): boolean => JSON.stringify([...a.entries()]) === JSON.stringify([...b.entries()]);
// //TR: Önbelleğe ALMA koşulu (L3 ile aynı ilke): özet inşadan ÖNCE ve SONRA aynı olmalı VE iki bağımsız inşa aynı haritayı vermeli. Aksi halde (dosya inşa sırasında değişti ya da bir okuma geçici olarak başarısız oldu; readText bunu "dosya yok" sayar) sonuç önbelleğe ALINMAZ, taze inşa döner; bayat bir PRESENT/ABSENT kalıcılaşmaz. Bilinen sınır: iki inşayı da kapsayan ve özet alındığında geri dönmüş geçici bir içerik, yazılımla ayırt edilemez.
/** Kaynak ağacı doğrulanmışsa kod destekli adaptör haritası (probe NOT_OBSERVED); aksi halde undefined (NOT_SUPPLIED). */
export function adapterRealityFor(root: string): ReadonlyMap<string, AdapterRealityEntry> | undefined {
  if (!sourceTreePresent(root)) { adapterCache.delete(root); return undefined; }
  const fp = contentFingerprint(root), hit = adapterCache.get(root);
  if (hit && hit.fp === fp) return hit.entries;
  const first = buildAdapterRealityMap({records: ADAPTER_REALITY_RECORDS, repoRoot: root}).entries;
  const entries = buildAdapterRealityMap({records: ADAPTER_REALITY_RECORDS, repoRoot: root}).entries;
  if (contentFingerprint(root) === fp && sameEntries(first, entries)) adapterCache.set(root, {fp, entries}); else adapterCache.delete(root);
  return entries;
}
const READINESS_INPUT_ERROR = /^READINESS_INPUT_(UNAVAILABLE|INVALID):/;

export function registerRoleStatusRoutes(app: any, d: RouteDeps & {repoRoot: string; now?: () => Date; readinessCompute?: typeof computeRoleReadiness}): void {
  // Tüketici ekran: rol/agent yaşam döngüsü paneli; salt okunur, yazma kapısı gerekmez. Kayıt eksik/bozuksa 503 (sayı uydurulmaz).
  app.get("/v1/roles/status-summary", async (_req: any, reply: any) => {
    let raw: Buffer, doc: any;
    try { raw = fs.readFileSync(path.join(d.repoRoot, ROLE_REGISTRY_FILE_REL)); doc = JSON.parse(raw.toString("utf8")); } catch { return reply.code(503).send({error: "ROLE_REGISTRY_UNAVAILABLE"}); }
    if (!Array.isArray(doc?.roles)) return reply.code(503).send({error: "ROLE_REGISTRY_UNAVAILABLE"});
    try {
      const st = d.getStore();
      // Gözlem açıkça iki durumludur: günlük VAR (run listesi) / YOK. Günlük yoksa RUNNING ölçülmemiştir (readiness: UNKNOWN); eski sayaç boş run listesiyle hesaplanır (değişmez).
      const observed = st.hasJournal ? {journal: "PRESENT" as const, runs: st.listRuns(d.scope)} : {journal: "ABSENT" as const};
      const now = d.now ? d.now() : new Date();
      const legacyShaEarly = crypto.createHash("sha256").update(raw).digest("hex");
      const statusSummary = computeRoleStatusSummary({
        roles: doc.roles, guildIds: Array.isArray(doc.guilds) ? doc.guilds.map((g: any) => g.guildId) : [],
        roleDefinitionsSha256: legacyShaEarly, bindings: FIRST_DELIVERY_BINDINGS,
        verify: createEvidenceVerifier(d.repoRoot), runs: observed.journal === "PRESENT" ? observed.runs : [], now
      });
      // Tek kaynak kuralı: bu rota HİÇBİR sayaç hesaplamaz; ölçüm core/agents/readiness-audit.ts'tedir. adapterReality YALNIZ doğrulanmış kaynak ağacında verilir (B-ADAPTER; aksi halde TOOL_READY UNKNOWN), reachableStages VERİLMEZ (stageWired UNKNOWN kalır).
      const legacySha = legacyShaEarly;
      let readiness;
      try {
        // verify HER istekte yeni kurulur (kanıt kökü kuruluşta çözülür; sonradan yazılan kanıt bayat kalmasın); önbellekte yalnız durağan girdi.
        const adapterReality = adapterRealityFor(d.repoRoot);
        const input = {...staticReadinessInput(d.repoRoot, now), ...(adapterReality ? {adapterReality} : {}), verify: createEvidenceVerifier(d.repoRoot), runs: observed, now};
        // L4: kayıt iki kez okunur (eski sayaç + readiness); sha uyuşmazsa (okumalar arasında değişti) readiness kullanılamaz sayılır, sayı uydurulmaz.
        if (input.roleDefinitionsSha256 !== legacySha) throw new Error("READINESS_INPUT_INVALID:ROLE_DEFINITIONS_CHANGED");
        readiness = (d.readinessCompute ?? computeRoleReadiness)(input); // readinessCompute: yalnız test tohumu (üretimde verilmez)
      } catch (e) {
        // M2: YALNIZ tipli girdi hataları (UNAVAILABLE / INVALID) düşürülür; başka her hata (programlama hatası) workosFail'e gider. Denetime yalnız kod yazılır (yol/sır yok).
        const m = e instanceof Error ? READINESS_INPUT_ERROR.exec(e.message) : null;
        if (!m) throw e;
        staticInputCache.delete(d.repoRoot);
        d.audit("WORKOS_ROLE_READINESS_DEGRADED", {actor: d.actor, code: `READINESS_INPUT_${m[1]}`});
        // Düşür, atma: eski statusSummary yine döner; readiness/reconciliation null, route HİÇBİR sayaç hesaplamaz.
        return {statusSummary, statusSummaryStatus: "DEPRECATED_LEGACY_PROJECTION" as const, readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE" as const};
      }
      return {statusSummary, statusSummaryStatus: "DEPRECATED_LEGACY_PROJECTION" as const, readiness, reconciliation: reconcileLegacyStatusSummary(statusSummary, readiness)};
    } catch (e) { return d.workosFail(reply, e); }
  });
}
