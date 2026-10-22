// //TR: Test yardımcısı (vitest tarafından toplanmaz): bu süreç bir sözde-terminal (pty) altında, yani KONTROL EDEN TERMİNALİ olan bir ana süreç olarak başlatılır; Linux sandbox sağlayıcısıyla bir komut çalıştırır ve ana sürecin ile sandbox içindeki sürecin tty_nr değerini tek satırda yazar (RESULT ...). Sandbox kontrol eden terminali MİRAS ALMAMALIDIR (TIOCSTI).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LinuxUnshareSandboxProvider} from "../../core/agents/linux-unshare-sandbox.js";

const ttyNrOfSelf = (): string => (fs.readFileSync("/proc/self/stat", "utf8").split(") ")[1] ?? "").split(" ")[4] ?? "?";
const provider = new LinuxUnshareSandboxProvider(process.env.UASCO_SBX_ACCEPT_UNENFORCED === "1" ? {acceptUnenforcedProcessLimit: true} : {});
const st = await provider.selfTest();
const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-tty-"));
try {
  const r = await provider.run(["sh", "-c", "echo sandbox_tty_nr=$(awk '{print $7}' /proc/self/stat); if [ -e /dev/tty ]; then echo dev_tty_present; else echo dev_tty_absent; fi"], {cwd: ws, env: {PATH: "/usr/bin:/bin"}, timeoutMs: 30_000});
  console.log(`RESULT selftest_ok=${st.ok} host_tty_nr=${ttyNrOfSelf()} ${r.stdout.replace(/\s+/g, " ").trim()}`);
} finally { fs.rmSync(ws, {recursive: true, force: true}); }
