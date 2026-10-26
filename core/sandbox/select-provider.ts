//TR: Varsayılan sandbox sağlayıcısı seçici (B-WSL-WIRE-1): platforma göre TEK karar noktası. linux -> Linux unshare sağlayıcısı, win32 -> WSL2 sağlayıcısı, başka her platform -> null. Ortam değişkeni, yapılandırma veya istek gövdesi SAĞLAYICIYI seçemez ve değiştiremez (SBX-GATE kuralı); yalnız test enjeksiyonu için fabrika parametresi vardır. Kurucu hata atarsa null (NO_VERIFIED_PROVIDER, sunucu açılışı çökmez). Hiçbir şey selfTest geçene kadar çalışmaz.
import {LinuxUnshareSandboxProvider} from "../agents/linux-unshare-sandbox.js";
import {WslUnshareSandboxProvider} from "./wsl-unshare-sandbox.js";
import type {SandboxProvider} from "../workos/execution-gate.js";

export interface SelectProviderOptions {
  platform?: NodeJS.Platform;
  /** Yalnız testler: sağlayıcı fabrikaları. Üretimde verilmez (varsayılan seçenekler kullanılır). */
  makeLinux?: () => SandboxProvider;
  makeWsl?: () => SandboxProvider;
}

export function defaultSandboxProviderFor(o: SelectProviderOptions = {}): SandboxProvider | null {
  const platform = o.platform ?? process.platform;
  try {
    if (platform === "linux") return (o.makeLinux ?? (() => new LinuxUnshareSandboxProvider() as unknown as SandboxProvider))();
    if (platform === "win32") return (o.makeWsl ?? (() => new WslUnshareSandboxProvider() as unknown as SandboxProvider))();
    return null;
  } catch {
    return null;
  }
}
