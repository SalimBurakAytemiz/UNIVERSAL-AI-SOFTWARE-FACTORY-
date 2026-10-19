//TR: Self-hosted CI on-kontrolu (capraz platform, bash gerektirmez): Node >=24 (repo engines) ve package-lock.json varligini dogrular, runner kimligini (kullanici adi, platform) yazdirir. Basarisizlikta fail-closed cikis 1. Ag erisimi yoktur, hicbir dosya yazmaz.
import fs from "node:fs";
import os from "node:os";

const major = Number(process.versions.node.split(".")[0]);
console.log(`node=${process.version} platform=${process.platform} arch=${process.arch} user=${os.userInfo().username}`);
let ok = true;
if (!(major >= 24)) { console.error(`PREFLIGHT_FAIL: Node >=24 required (repo engines); got ${process.version}`); ok = false; }
if (!fs.existsSync("package-lock.json")) { console.error("PREFLIGHT_FAIL: package-lock.json missing; run install/bootstrap once and commit lockfile"); ok = false; }
console.log(ok ? "PREFLIGHT: PASS" : "PREFLIGHT: FAIL");
process.exit(ok ? 0 : 1);
