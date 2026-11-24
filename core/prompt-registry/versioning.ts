// //TR: UASCO-T0117: model'e gönderilen her istemin (prompts/ altındaki fabrika istemleri, CLAUDE_REVIEWER sistem istemi, ürünün kod içi rol/yürütücü/planlayıcı istemleri) açık bir
// SÜRÜMÜ ve içerik ÖZETİ (sha256) vardır. Bu modül SAF'tır (yalnız node:crypto): özet, manifest denetimi ve kayıt referansı üretir; dosya okumaz, ağ/model/shell çağırmaz.
// Manifest kuralı: her istemin sürüm geçmişi YALNIZ EKLENEREK büyür; son sürümün sha256'sı güncel içerikle birebir eşleşmelidir. İçerik değişip sürüm artırılmazsa denetim düşer
// (PROMPT_CHANGED_WITHOUT_VERSION_BUMP). Özet, satır sonları LF'ye normalleştirilmiş UTF-8 metin üzerindendir (Windows checkout'ta CRLF aynı özeti verir).
import crypto from "node:crypto";

export const PROMPT_ID_RE = /^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface PromptVersion { version: number; sha256: string }
export interface PromptManifestEntry { source: string; versions: readonly PromptVersion[] }
export interface PromptManifest { schemaVersion: 1; prompts: Readonly<Record<string, PromptManifestEntry>> }
/** Bir koşu/inceleme kaydına yazılan istem referansı: şablon sürümü + şablon özeti + (varsa) gönderilen gerçek metnin özeti. */
export interface PromptRef { id: string; version: number; templateSha256: string; renderedSha256: string | null }

/** LF'ye normalleştirilmiş UTF-8 metnin sha256'sı (hex). */
export function promptDigest(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

export function latestVersion(m: PromptManifest, id: string): PromptVersion | null {
  const e = Object.prototype.hasOwnProperty.call(m.prompts, id) ? m.prompts[id] : undefined;
  return e && e.versions.length ? e.versions[e.versions.length - 1] : null;
}

/**
 * Manifesti güncel özetlerle denetler; boş dizi = temiz. Sorun kodları:
 * PROMPT_NOT_IN_MANIFEST, PROMPT_NOT_PRODUCED (manifestte var, kaynakta yok), PROMPT_ID_INVALID, PROMPT_SOURCE_INVALID, PROMPT_VERSIONS_EMPTY,
 * PROMPT_VERSION_INVALID (tamsayı >=1 ve kesin artan değil), PROMPT_SHA256_INVALID, PROMPT_DIGEST_REPEATED (ardışık iki sürüm aynı içerik),
 * PROMPT_CHANGED_WITHOUT_VERSION_BUMP (güncel özet son sürümün özetinden farklı).
 */
export function checkManifest(m: PromptManifest, current: Readonly<Record<string, {source: string; sha256: string}>>): string[] {
  const issues: string[] = [];
  if (!m || m.schemaVersion !== 1 || typeof m.prompts !== "object" || m.prompts === null) return ["PROMPT_MANIFEST_INVALID"];
  for (const id of Object.keys(current).sort()) if (!Object.prototype.hasOwnProperty.call(m.prompts, id)) issues.push(`PROMPT_NOT_IN_MANIFEST ${id}`);
  for (const id of Object.keys(m.prompts).sort()) {
    const e = m.prompts[id];
    if (!PROMPT_ID_RE.test(id)) issues.push(`PROMPT_ID_INVALID ${id}`);
    if (!Object.prototype.hasOwnProperty.call(current, id)) { issues.push(`PROMPT_NOT_PRODUCED ${id}`); continue; }
    if (typeof e?.source !== "string" || e.source !== current[id].source) issues.push(`PROMPT_SOURCE_INVALID ${id}`);
    const vs = Array.isArray(e?.versions) ? e.versions : [];
    if (!vs.length) { issues.push(`PROMPT_VERSIONS_EMPTY ${id}`); continue; }
    vs.forEach((v, i) => {
      if (!Number.isInteger(v?.version) || v.version < 1 || (i > 0 && v.version <= vs[i - 1].version)) issues.push(`PROMPT_VERSION_INVALID ${id}@${String(v?.version)}`);
      if (!SHA256_RE.test(String(v?.sha256))) issues.push(`PROMPT_SHA256_INVALID ${id}@${String(v?.version)}`);
      if (i > 0 && v.sha256 === vs[i - 1].sha256) issues.push(`PROMPT_DIGEST_REPEATED ${id}@${v.version}`);
    });
    const last = vs[vs.length - 1];
    if (last.sha256 !== current[id].sha256) issues.push(`PROMPT_CHANGED_WITHOUT_VERSION_BUMP ${id}: manifest v${last.version}=${last.sha256} current=${current[id].sha256}`);
  }
  return issues;
}

/** Güncel özetlerden bir sonraki manifesti önerir (değişen istem için sürüm +1 eklenir, yeni istem v1 ile girer, geçmiş asla yeniden yazılmaz). */
export function proposeManifest(m: PromptManifest, current: Readonly<Record<string, {source: string; sha256: string}>>): PromptManifest {
  const prompts: Record<string, PromptManifestEntry> = {};
  for (const id of Object.keys(current).sort()) {
    const prev = Object.prototype.hasOwnProperty.call(m.prompts, id) ? m.prompts[id].versions : [];
    const last = prev.length ? prev[prev.length - 1] : null;
    const versions = last && last.sha256 === current[id].sha256 ? [...prev] : [...prev, {version: (last?.version ?? 0) + 1, sha256: current[id].sha256}];
    prompts[id] = {source: current[id].source, versions};
  }
  return {schemaVersion: 1, prompts};
}

/** Kayıt referansı; manifestte olmayan istem için fırlatır (sürümsüz istem gönderilmez). */
export function promptRef(m: PromptManifest, id: string, rendered?: string): PromptRef {
  const v = latestVersion(m, id);
  if (!v) throw new Error(`PROMPT_NOT_VERSIONED:${id}`);
  return {id, version: v.version, templateSha256: v.sha256, renderedSha256: typeof rendered === "string" ? promptDigest(rendered) : null};
}
