// //TR: Bu dosya pre-dev rollerinin (business analyst, requirements engineer, planner, architect, UX designer) ÜRETİM BuilderPort adaptörünü tanımlar: mevcut LOCAL_CLAUDE reviewer rotasının yetkisini (provenance-doğrulanmış launcher, ayrı salt-okunur reviewer profili, salt-okunur reviewerArgv, allowPaidApi=false env) AYNEN kullanır; yeni yetki, yeni env bayrağı, ağ veya kişisel profil yedeği YOKTUR. Süreç, depodan ve çalışma alanlarından bağımsız BOŞ bir scratch dizininde çalışır; scratch'te herhangi bir değişiklik çıktıyı GEÇERSİZ kılar. Model çıktısı yalnız veridir: bu adaptör JSON'u yorumlamaz/yürütmez, tek kapı driver'ın doğrulayıcılarıdır. Rol bağlaması (assertRoleExecutes) hiçbir süreç/provenance okuması yapılmadan ÖNCE denetlenir (fail-closed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {assertRoleExecutes, FIRST_DELIVERY_BINDINGS} from "../../agents/first-delivery-bindings.js";
import {effectiveLimits} from "../../agents/role-execution.js";
import type {FirstDeliveryFunction, RoleExecutionProfile} from "../../agents/role-execution.js";
import type {ProcOptions, ProcResult} from "../executors.js";
import {claudeAuthFailure} from "../claude-profiles.js";
import {PRE_DEV_ROLE_MAP} from "./types.js";
import type {ArtifactKind} from "./types.js";
import type {BuilderPort, MissionContext} from "./driver.js";

// //TR: Artefakt türü -> bağlı ilk-teslim fonksiyonu. first-delivery-bindings.ts STAGE_CONSUMERS.PREDEV_PRODUCE aynı beş fonksiyonu içerir; testler iki yönde tutarlılığı doğrular (rol kimliği PRE_DEV_ROLE_MAP[kind][0]).
export const PREDEV_KIND_FUNCTION: Readonly<Record<ArtifactKind, FirstDeliveryFunction>> = {
  BusinessAnalysis: "business-analyst", Requirements: "requirements-engineer", Plan: "planner", Architecture: "architect", UxSpec: "ux-designer"
};

// //TR: Üretilen taslağı kaydeden aktör: Founder'dan AYRI ajan kimliği. Onay rotaları her zaman sunucu aktörünü (Founder) onaylayan yapar; kaydeden = onaylayan olamayacağı için (PREDEV_APPROVER_NOT_INDEPENDENT) ajan taslağı yalnız bağımsız Founder kararıyla onaylanır. Hesap verebilirlik: WORKOS_PREDEV_PRODUCED audit kaydı Founder aktörünü + rol kimliğini taşır.
export const PREDEV_AGENT_ACTOR = "agent:claude-predev-builder";
export const PREDEV_BUILDER_DEFAULT_TIMEOUT_MS = 600_000;
export const PREDEV_BUILDER_MAX_PROMPT_BYTES = 256 * 1024;
export const PREDEV_BUILDER_MAX_OUTPUT_BYTES = 256 * 1024;

export type PreDevBuilderFailure =
  | "PREDEV_BUILDER_ROLE_NOT_EXECUTABLE" | "PREDEV_BUILDER_PROMPT_INVALID" | "PREDEV_BUILDER_PROVENANCE_REFUSED" | "PREDEV_BUILDER_PROFILE_REFUSED"
  | "PREDEV_BUILDER_ENV_FAILED" | "PREDEV_BUILDER_SCRATCH_FAILED" | "PREDEV_BUILDER_SPAWN_FAILED" | "PREDEV_BUILDER_TIMEOUT" | "PREDEV_BUILDER_ABORTED" | "PREDEV_BUILDER_EXIT_NONZERO"
  | "PREDEV_BUILDER_EMPTY_OUTPUT" | "PREDEV_BUILDER_OUTPUT_TOO_LARGE" | "PREDEV_BUILDER_SCRATCH_MODIFIED"
  // //TR: C-FLOW-ANALYSIS-2 (yalnız outputFormat "claude-json"): oturum yok/süresi dolmuş, CLI hata sonucu bildirdi, sonuç zarfı bozuk.
  | "PREDEV_BUILDER_LOGIN_EXPIRED" | "PREDEV_BUILDER_CLI_ERROR" | "PREDEV_BUILDER_ENVELOPE_INVALID";

// //TR: Adaptör hatası: code sabit bir makine-okunur koddur (model/stderr metni taşımaz); detail yalnız iç tanılama içindir (audit'e hash/kod olarak girer, istemciye dönmez).
export class PreDevBuilderError extends Error {
  constructor(readonly code: PreDevBuilderFailure, readonly detail: string = "") { super(code); this.name = "PreDevBuilderError"; }
}

// //TR: Her produce çağrısının kanıt özeti (ham model çıktısı/stderr SAKLANMAZ): rol, tür, kimlik, süre, çıkış kodu ve çıktının sha256'sı. Route bunu WORKOS_PREDEV_PRODUCED audit kaydına yazar.
export interface PreDevProduceTrace {
  roleId: string; kind: ArtifactKind; identity: string; startedAt: string; endedAt: string; durationMs: number; timeoutMs: number;
  exitCode: number | null; outputSha256: string | null; failure: PreDevBuilderFailure | null;
}

export interface PreDevBuilderRuntime {
  identity: string;
  // Throw => provenance reddi (PROVIDER_PROVENANCE PASS + launcher sha256 eşleşmesi LocalClaudeExecutors'ta denetlenir).
  launcher(): string;
  profile(): {ok: true; dir: string} | {ok: false; reason: string};
  env(profileDir: string): NodeJS.ProcessEnv;
  argv(launcher: string): string[];
  run(argv: string[], opts: ProcOptions): Promise<ProcResult>;
  // Scratch dizinlerinin oluşturulduğu kök (varsayılan: os.tmpdir()); depo/çalışma alanı içinde OLMAMALI.
  scratchRoot?: string;
  // //TR: "text" (varsayılan): stdout modelin çıktısıdır (eski davranış, birebir). "claude-json": argv `--output-format json` ile kurulmuştur; stdout tek bir sonuç zarfıdır ({type:"result", subtype, is_error, result}) ve çıktı YALNIZ başarılı zarfın `result` metnidir.
  outputFormat?: "text" | "claude-json";
}
export interface ClaudePreDevBuilderOptions { timeoutMs?: number; bindings?: readonly RoleExecutionProfile[]; maxOutputBytes?: number }

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// //TR: Başarılı bir CLI sonuç zarfı: tek JSON nesnesi, type "result", is_error false, subtype "success", result metin. Başka her şey (dizi, akış olayları, düz metin) zarf DEĞİLDİR ve model çıktısı sayılmaz.
type Envelope = {kind: "ok"; result: string} | {kind: "error"; text: string} | {kind: "invalid"};
function readEnvelope(stdout: string): Envelope {
  let o: unknown;
  try { o = JSON.parse(stdout); } catch { return {kind: "invalid"}; }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return {kind: "invalid"};
  const e = o as Record<string, unknown>;
  if (e.type !== "result" || typeof e.is_error !== "boolean") return {kind: "invalid"};
  const text = typeof e.result === "string" ? e.result : "";
  if (e.is_error === true || e.subtype !== "success") return {kind: "error", text};
  if (typeof e.result !== "string") return {kind: "invalid"};
  return {kind: "ok", result: e.result};
}
// //TR: Modelin TÜM çıktısı tek bir ```json ... ``` (veya ``` ... ```) çitiyse yalnız çit sarmalayıcısı kaldırılır; içerik DEĞİŞTİRİLMEZ ve kapıyı yine driver doğrulayıcıları tutar. Çit dışında metin varsa (öncesinde/sonrasında) HİÇBİR şey ayıklanmaz; birden çok çitte kalan metin geçerli JSON olamaz. Her iki durumda çıktı olduğu gibi geçer ve driver onu PREDEV_DRIVER_INVALID_JSON ile reddeder (JSON "kurtarılmaz").
function unwrapSingleFence(t: string): string {
  const m = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(t);
  return m ? m[1]!.trim() : t;
}

export class ClaudePreDevBuilder implements BuilderPort {
  // //TR: İstek başına TAZE örnek kullanılır (route her çağrıda yeni örnek ister); lastTrace o çağrının özetidir.
  lastTrace: PreDevProduceTrace | null = null;
  // //TR: Route bunu Global Stop'a bağlar (süreç çalışırken durdurma = süreç grubu öldürülür, çıktı döndürülmez).
  shouldAbort?: () => boolean;
  private readonly bindings: readonly RoleExecutionProfile[];
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  constructor(private readonly rt: PreDevBuilderRuntime, o: ClaudePreDevBuilderOptions = {}) {
    this.bindings = o.bindings ?? FIRST_DELIVERY_BINDINGS;
    this.timeoutMs = o.timeoutMs ?? PREDEV_BUILDER_DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = o.maxOutputBytes ?? PREDEV_BUILDER_MAX_OUTPUT_BYTES;
  }

  async produce(kind: ArtifactKind, rolePrompt: string, _ctx: MissionContext): Promise<string> {
    this.lastTrace = null;
    const roleId = PRE_DEV_ROLE_MAP[kind][0], fn = PREDEV_KIND_FUNCTION[kind];
    const startedAt = new Date().toISOString(), t0 = Date.now();
    let timeoutMs = this.timeoutMs, exitCode: number | null = null, outputSha256: string | null = null;
    const fail = (code: PreDevBuilderFailure, detail = ""): never => {
      this.lastTrace = {roleId, kind, identity: this.rt.identity, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - t0, timeoutMs, exitCode, outputSha256, failure: code};
      throw new PreDevBuilderError(code, detail);
    };
    // 1) Rol bağlaması: süreç, provenance veya dosya sistemi dokunulmadan ÖNCE (eksik/yetersiz bağlama = NOT_EXECUTABLE).
    let profile: RoleExecutionProfile;
    try { profile = assertRoleExecutes(roleId, fn, this.bindings); } catch (e) { return fail("PREDEV_BUILDER_ROLE_NOT_EXECUTABLE", (e as Error).message.slice(0, 200)); }
    timeoutMs = effectiveLimits(profile.limits, {maxRemediations: 0, executorTimeoutMs: this.timeoutMs}).executorTimeoutMs;
    if (typeof rolePrompt !== "string" || rolePrompt.trim() === "" || Buffer.byteLength(rolePrompt, "utf8") > PREDEV_BUILDER_MAX_PROMPT_BYTES) return fail("PREDEV_BUILDER_PROMPT_INVALID");
    // 2) Provenance-doğrulanmış launcher ve AYRI reviewer profili; kişisel profile geri düşülmez.
    let launcher: string;
    try { launcher = this.rt.launcher(); } catch (e) { return fail("PREDEV_BUILDER_PROVENANCE_REFUSED", (e as Error).message.slice(0, 200)); }
    let prof: ReturnType<PreDevBuilderRuntime["profile"]>;
    try { prof = this.rt.profile(); } catch (e) { return fail("PREDEV_BUILDER_PROFILE_REFUSED", (e as Error).message.slice(0, 200)); }
    if (!prof.ok) return fail("PREDEV_BUILDER_PROFILE_REFUSED", prof.reason.slice(0, 200));
    // 3) Depodan bağımsız boş scratch dizini (0700); süreç yalnız burada çalışır.
    let scratch: string;
    try { scratch = fs.mkdtempSync(path.join(this.rt.scratchRoot ?? os.tmpdir(), "uasco-predev-")); } catch (e) { return fail("PREDEV_BUILDER_SCRATCH_FAILED", (e as Error).message.slice(0, 200)); }
    try {
      // //TR: argv/env kurulumu (config + politika dosyaları okur) ve süreç çalıştırıcı beklenmedik fırlatırsa TİPLİ hataya çevrilir; ham hata route'a sızmaz (audit + sabit 502 kodu).
      let argv: string[], env: NodeJS.ProcessEnv;
      try { argv = this.rt.argv(launcher); env = this.rt.env(prof.dir); } catch (e) { return fail("PREDEV_BUILDER_ENV_FAILED", (e as Error).message.slice(0, 200)); }
      let r: ProcResult;
      try { r = await this.rt.run(argv, {cwd: scratch, env, timeoutMs, input: rolePrompt, newSession: process.platform !== "win32", ...(this.shouldAbort ? {shouldAbort: this.shouldAbort} : {})}); }
      catch (e) { return fail("PREDEV_BUILDER_SPAWN_FAILED", (e as Error).message.slice(0, 200)); }
      exitCode = r.exitCode;
      // Zaman aşımı/abort: süreç ağacı runProcess tarafından öldürülmüştür; hiçbir çıktı döndürülmez.
      if (r.timedOut) return fail("PREDEV_BUILDER_TIMEOUT");
      if (r.aborted) return fail("PREDEV_BUILDER_ABORTED");
      if (r.spawnError) return fail("PREDEV_BUILDER_SPAWN_FAILED");
      // Scratch'te HER değişiklik (dosya, dizin, gizli dosya) çıktıyı geçersiz kılar; model okuma-yalnız araçlarla çalışmalıydı.
      let entries: string[];
      try { entries = fs.readdirSync(scratch); } catch { return fail("PREDEV_BUILDER_SCRATCH_MODIFIED", "scratch unreadable"); }
      if (entries.length > 0) return fail("PREDEV_BUILDER_SCRATCH_MODIFIED", `${entries.length} entries`);
      const rawOut = String(r.stdout ?? "").trim();
      const json = this.rt.outputFormat === "claude-json";
      const envl = json && rawOut !== "" ? readEnvelope(rawOut) : null;
      // //TR: Oturum yok/süresi dolmuş: CLI bunu çıkış kodu 1 + zarfın `result` metni (veya stderr) ile bildirir; genel EXIT_NONZERO yerine kesin neden.
      if (json && (r.exitCode !== 0 || envl?.kind === "error") && claudeAuthFailure(`${envl?.kind === "error" ? envl.text : ""}\n${rawOut}\n${String(r.stderr ?? "")}`)) return fail("PREDEV_BUILDER_LOGIN_EXPIRED");
      if (r.exitCode !== 0) return fail("PREDEV_BUILDER_EXIT_NONZERO");
      if (json && rawOut !== "" && envl!.kind === "invalid") return fail("PREDEV_BUILDER_ENVELOPE_INVALID");
      if (envl?.kind === "error") return fail("PREDEV_BUILDER_CLI_ERROR");
      const out = envl?.kind === "ok" ? unwrapSingleFence(envl.result.trim()) : rawOut;
      if (out === "") return fail("PREDEV_BUILDER_EMPTY_OUTPUT");
      if (Buffer.byteLength(out, "utf8") > this.maxOutputBytes) return fail("PREDEV_BUILDER_OUTPUT_TOO_LARGE");
      outputSha256 = sha256(out);
      this.lastTrace = {roleId, kind, identity: this.rt.identity, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - t0, timeoutMs, exitCode, outputSha256, failure: null};
      return out;
    } finally {
      try { fs.rmSync(scratch, {recursive: true, force: true}); } catch { /* temizlik en iyi çabadır; scratch depo dışındadır */ }
    }
  }
}
