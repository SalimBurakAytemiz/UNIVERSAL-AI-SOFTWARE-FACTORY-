// //TR: Bu dosya COORD-INTAKE-TEMPLATE için intake'in yönetilen şablon deposu kurmasını sağlar: yalnız ProjectStudio.createTemplateRepository ve renderTemplate'i sarar (git/depo kodu kopyalanmaz). İkinci bir ProjectStudio örneği güvenlidir çünkü ProjectStudio durumsuzdur (yalnız dataDir/seçenekler) ve her yazı <dataDir>/journal.lock altında store tarafından sıralanır. server.ts'teki iki kural burada bilerek tekrarlanır (env-policy yolu ve şablon varsayılanlarının önceliği); tests/v7-b1-workos.test.ts içindeki parite testi ikisini de POST /v1/projects ile sabitler.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ProjectStudio, StudioError} from "./project-studio.js";
import {renderTemplate} from "./project-templates.js";
import type {ProjectTemplate, ProjectType} from "./types.js";

// //TR: buildServer'ın repoRoot/config/environment-policy.json türetmesiyle aynı dosya: geliştirmede (tsx), vitest'te ve paketli uygulamada (stage/core/workos -> stage/config) çözülür; dosya paketli kurulumda RUNTIME_CONFIG_FILES ile sahnelenir.
export const APP_ENV_POLICY_FILE = fileURLToPath(new URL("../../config/environment-policy.json", import.meta.url));

export type TemplateStudio = Pick<ProjectStudio, "dataDir" | "createTemplateRepository">;
export interface TemplateFields { template: ProjectTemplate; projectType: ProjectType; testCommand?: string[]; devCommand?: string[] }

// //TR: server.ts POST /v1/projects ile aynı öncelik: Founder'ın verdiği değer kazanır, yoksa şablonun değeri; şablonda olmayan alan anahtar olarak hiç yazılmaz (boş dizi yazılmaz). Dönen diziler kopyadır.
export function templateProjectFields(template: ProjectTemplate, name: string, explicit: {projectType?: ProjectType; testCommand?: string[]; devCommand?: string[]} = {}): TemplateFields {
  const spec = renderTemplate(template, name);
  const tc = explicit.testCommand ?? spec.testCommand, dc = explicit.devCommand ?? spec.devCommand;
  return {template, projectType: explicit.projectType ?? spec.projectType, ...(tc ? {testCommand: [...tc]} : {}), ...(dc ? {devCommand: [...dc]} : {})};
}

export class TemplateProvisioner {
  private readonly studio: TemplateStudio;
  // //TR: Ön kontrol store kilidinden ÖNCE çalışır: yapılandırma okunamazsa hiçbir kilit alınmaz ve hiçbir şey yazılmaz. Durum 500'dür (yeniden denenebilir 503 değil): eksik/bozuk kurulum dosyası tekrar denemeyle düzelmez.
  constructor(o: {dataDir: string; studio?: TemplateStudio; envPolicyFile?: string}) {
    if (o.studio) {
      // //TR: Enjekte edilen studio başka bir veri dizinine depo kuramaz (başka tenant/kurulumun projects/ dizini); fail-closed.
      if (path.resolve(o.studio.dataDir) !== path.resolve(o.dataDir)) throw new StudioError("PROJECT_PROVISIONER_MISCONFIGURED", 500, "DATA_DIR_MISMATCH");
      this.studio = o.studio;
      return;
    }
    const f = o.envPolicyFile ?? APP_ENV_POLICY_FILE;
    let ok = false;
    try { const p: unknown = JSON.parse(fs.readFileSync(f, "utf8")); ok = p !== null && typeof p === "object" && !Array.isArray(p); } catch { ok = false; }
    if (!ok) throw new StudioError("PROJECT_PROVISIONER_UNAVAILABLE", 500, "ENV_POLICY_UNREADABLE");
    this.studio = new ProjectStudio({dataDir: o.dataDir, envPolicyFile: f});
  }
  // //TR: store.createProjectDetailed'in prepareManagedRepository kancası: kilit altında, idempotency kontrolünden sonra yeni projectId için çağrılır; studio kendi hatasında kendi dizinini siler, append hatasında discard'ı store çağırır.
  prepare(template: ProjectTemplate, name: string): (projectId: string) => {path: string; discard: () => void} {
    return projectId => { const x = this.studio.createTemplateRepository(projectId, template, name); return {path: x.path, discard: x.discard}; };
  }
}
