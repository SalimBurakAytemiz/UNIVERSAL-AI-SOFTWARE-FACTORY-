// //TR: C-LINUX-SANDBOX-EXPORTS: Lane B'nin WSL2 sağlayıcısı Linux izolasyonunu kopyalamadan yeniden kullanır; bu test dışa aktarılan üç sabitin sağlayıcının KENDİ kullandığı değerler olduğunu sabitler (davranış değişmedi).
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LINUX_SANDBOX_HELPER_PATH, LINUX_SANDBOX_NS_FLAGS, LINUX_SANDBOX_SETUP, LinuxUnshareSandboxProvider} from "../core/agents/linux-unshare-sandbox.js";

describe("C-LINUX-SANDBOX-EXPORTS: the exported isolation constants are the values the provider runs with", () => {
  it("exports the unchanged values (isolation flags frozen, helper PATH, setup script)", () => {
    expect([...LINUX_SANDBOX_NS_FLAGS]).toEqual(["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL"]);
    expect(Object.isFrozen(LINUX_SANDBOX_NS_FLAGS)).toBe(true);
    expect(() => (LINUX_SANDBOX_NS_FLAGS as string[]).push("--evil")).toThrow(TypeError); // a consumer cannot change the provider's flags
    expect(LINUX_SANDBOX_HELPER_PATH).toBe("/usr/sbin:/usr/bin:/sbin:/bin");
    expect(typeof LINUX_SANDBOX_SETUP).toBe("string");
    expect(LINUX_SANDBOX_SETUP).toContain(`PATH=${LINUX_SANDBOX_HELPER_PATH}`); // the script resolves privileged helpers with the exported HELPER_PATH
    expect(LINUX_SANDBOX_SETUP.startsWith("set -eu; set -f\n")).toBe(true);
  });

  // The provider's own argv builder (private) must embed exactly the exported flags and script. It needs a host directory that can serve as the new root (/mnt, /srv or /media); a host without one cannot build argv at all, which is reported (not silently passed).
  it("the provider's argv is [...exported flags, shell, -c, exported setup, ...] for the same inputs", () => {
    const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-"));
    try {
      const p = new LinuxUnshareSandboxProvider({platform: "linux", readOnlyRoots: []}) as unknown as {args(cwd: string, timeoutMs: number, command: string[]): string[] | null};
      const argv = p.args(cwd, 1000, ["true"]);
      if (argv === null) { expect(["/mnt", "/srv", "/media"].some(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })).toBe(false); return; } // null only when no new-root mount point exists on this host
      expect(argv.slice(0, LINUX_SANDBOX_NS_FLAGS.length)).toEqual([...LINUX_SANDBOX_NS_FLAGS]);
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 1]).toBe("-c");
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 2]).toBe(LINUX_SANDBOX_SETUP);
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  });
});
