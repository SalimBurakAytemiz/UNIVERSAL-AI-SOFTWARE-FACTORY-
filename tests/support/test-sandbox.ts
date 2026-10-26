// //TR: YALNIZ TEST: SBX-GATE'ten önce ana makinede çalışan runner/dev-run testleri için programatik olarak enjekte edilen sahte sandbox sağlayıcısı. Bu sağlayıcı İZOLASYON SAĞLAMAZ; yalnız test kodunda (kurucu/seçenek ile) kullanılır, test komutları testlerin kendi yazdığı sabit fikstürlerdir (AI üretimi kod değildir). Üretim kodu bu dosyayı asla import etmez.
import cp from "node:child_process";
import {runProcess} from "../../core/workos/executors.js";
import {ExecutionGate} from "../../core/workos/execution-gate.js";
import type {SandboxProvider} from "../../core/workos/execution-gate.js";

export const TEST_HOST_PASSTHROUGH_SANDBOX: SandboxProvider = {
  id: "TEST_ONLY_HOST_PASSTHROUGH",
  async selfTest() { return {ok: true, detail: "TEST_ONLY"}; },
  run: (argv, o) => runProcess(argv, o),
  spawn: (command, args, o) => cp.spawn(command, args, o)
};
export const testExecutionGate = (): ExecutionGate => new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX);
// Windows CI: varsayılan seçici WSL sağlayıcısını kurar; sandbox seçeneği vermeyen sunucu testleri GERÇEK wsl.exe başlatmasın diye win32'de sandbox: null enjekte edilir (diğer platformlarda boş: varsayılan davranış sınanır).
export const NO_REAL_WSL_ON_WIN32: {sandbox?: null} = process.platform === "win32" ? {sandbox: null} : {};
