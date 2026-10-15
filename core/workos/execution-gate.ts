// //TR: Bu dosya proje kodu (AI üretimi veya güvenilmeyen proje içeriği) çalıştırma için TEK karar noktasıdır (Founder kararı FD-REL-1-REJECT-HOST-EXEC-2026-10-15): doğrulanmış bir sandbox sağlayıcısı kayıtlı DEĞİLSE ya da süreç başına öz-testi geçmediyse her yürütme reddedilir (SANDBOX_UNAVAILABLE), ana makinede asla çalıştırılmaz. Sağlayıcı yalnız programatik olarak (kurucu/seçenek) verilebilir; env, config dosyası, journal kaydı, API gövdesi veya masaüstü ayarı sağlayıcı kaydedemez ya da taklit edemez. Üretimde hiçbir sağlayıcı sınıfı yoktur; bu nedenle üretim kararı her zaman BLOCKED'dır.
import type {ChildProcess, SpawnOptions} from "node:child_process";
import type {ProcResult} from "./executors.js";

export const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE" as const;
/** Kapıdan geçmesi gereken proje kodu yürütme türleri (çağrı yeri sınıflandırması audit kaydındadır). */
export type ProjectExecutionKind = "RUNNER_VERIFY_TESTS" | "RUNNER_REGRESSION_TESTS" | "STUDIO_DEVRUN";
export const PROJECT_EXECUTION_KINDS: readonly ProjectExecutionKind[] = ["RUNNER_VERIFY_TESTS", "RUNNER_REGRESSION_TESTS", "STUDIO_DEVRUN"];
export interface SandboxRunOptions { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input?: string; shouldAbort?: () => boolean }
/**
 * İşletim sistemi izolasyonlu yürütme sağlayıcısı. Gerçek bir sağlayıcı (ör. Windows Sandbox / izole VM) ana makine dosyalarına, kullanıcı profiline,
 * tarayıcı oturumlarına, kimlik bilgilerine, Trust Kernel kayıtlarına ve diğer projelere erişimi engellediğini, ağı varsayılan kapalı tuttuğunu ve
 * CPU/RAM/disk/süre/süreç sınırlarını uyguladığını selfTest() içinde negatif testlerle kanıtlamak zorundadır. Bu pakette üretim sağlayıcısı YOKTUR.
 */
export interface SandboxProvider {
  readonly id: string;
  selfTest(): Promise<{ok: boolean; detail?: string}>;
  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult>;
  spawn(command: string, args: string[], opts: SpawnOptions): ChildProcess;
}
export type SandboxDenialDetail = "NO_VERIFIED_PROVIDER" | "SELF_TEST_FAILED" | "SELF_TEST_ERROR";
export type GateDecision =
  | {allowed: true; kind: ProjectExecutionKind; providerId: string; provider: SandboxProvider}
  | {allowed: false; kind: ProjectExecutionKind; reason: typeof SANDBOX_UNAVAILABLE; detail: SandboxDenialDetail};

const isProvider = (p: unknown): p is SandboxProvider => {
  const x = p as Partial<SandboxProvider> | null;
  return !!x && typeof x === "object" && typeof x.id === "string" && x.id.length > 0 && typeof x.selfTest === "function" && typeof x.run === "function" && typeof x.spawn === "function";
};

export class ExecutionGate {
  private readonly provider: SandboxProvider | null;
  private selfTestResult: Promise<{ok: boolean; detail: SandboxDenialDetail | null}> | null = null;
  /** provider yalnız programatik verilir (testlerde enjekte edilen sahte sağlayıcı); null/eksik/geçersiz = doğrulanmış sağlayıcı yok = BLOCKED. */
  constructor(provider: SandboxProvider | null = null) { this.provider = isProvider(provider) ? provider : null; }
  get registered(): boolean { return this.provider !== null; }
  private verified(): Promise<{ok: boolean; detail: SandboxDenialDetail | null}> {
    const p = this.provider;
    if (!p) return Promise.resolve({ok: false, detail: "NO_VERIFIED_PROVIDER"});
    // Öz-test süreç (kapı örneği) başına bir kez çalışır; yalnız açık {ok: true} geçer, hata/zaman aşımı/başka değer fail-closed'dur.
    return this.selfTestResult ??= Promise.resolve().then(() => p.selfTest()).then(
      r => (r && typeof r === "object" && r.ok === true ? {ok: true, detail: null} : {ok: false, detail: "SELF_TEST_FAILED" as const}),
      () => ({ok: false, detail: "SELF_TEST_ERROR" as const}));
  }
  /** Tek karar noktası: izin yalnız kayıtlı sağlayıcı + geçmiş öz-test ile verilir; aksi halde SANDBOX_UNAVAILABLE (ana makinede yürütme yok). */
  async authorize(kind: ProjectExecutionKind): Promise<GateDecision> {
    if (!PROJECT_EXECUTION_KINDS.includes(kind)) throw new Error(`UNKNOWN_EXECUTION_KIND:${String(kind)}`);
    const v = await this.verified();
    if (!v.ok || !this.provider) return {allowed: false, kind, reason: SANDBOX_UNAVAILABLE, detail: v.detail ?? "NO_VERIFIED_PROVIDER"};
    return {allowed: true, kind, providerId: this.provider.id, provider: this.provider};
  }
  /** Durum görünümü (sır/yol içermez). */
  async status(): Promise<{state: "AVAILABLE" | "UNAVAILABLE"; reason: typeof SANDBOX_UNAVAILABLE | null; detail: SandboxDenialDetail | null; providerId: string | null}> {
    const v = await this.verified();
    return v.ok && this.provider ? {state: "AVAILABLE", reason: null, detail: null, providerId: this.provider.id} : {state: "UNAVAILABLE", reason: SANDBOX_UNAVAILABLE, detail: v.detail ?? "NO_VERIFIED_PROVIDER", providerId: null};
  }
}
