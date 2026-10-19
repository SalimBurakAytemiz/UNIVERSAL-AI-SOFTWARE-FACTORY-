//TR: MAINTAINER-ONLY uygulama betigi (FD-PUBLIC-CI-2026-10-19-C, yalniz PR #49): korunan scripts/liveness-selftest.mjs dosyasinda TEK fikstur degisikligini uygular ve capanin TAM BIR KEZ bulundugunu dogrular; aksi halde hicbir dosyaya dokunmadan durur. Degisiklik: "kurtarma sirasinda yeni canli isaret" senaryosundaki (101. satir) olu-bootstrap isaretinin startedAt degeri simdi yerine bir dakika once (past(1)); boylece Windows'ta olu PID'i yeniden alan bir surec watchdog'un 5 sn sahip-olusturma toleransina dusmez ve PID_REUSED (STALE) olarak siniflanir. Urun kodu degismez. Manifest reseal'i bu betik YAPMAZ; ayri adimda scripts/generate-trust-root.mjs calistirilir. Builder bu betigi calistirmaz.
import fs from "node:fs";

const FILE = "scripts/liveness-selftest.mjs";
const FIND = 'fs.writeFileSync(path.join(w.root,"bootstrap","UPGRADE_IN_PROGRESS.json"),JSON.stringify({pid:dead,startedAt:new Date().toISOString()}))';
const REPLACE = 'fs.writeFileSync(path.join(w.root,"bootstrap","UPGRADE_IN_PROGRESS.json"),JSON.stringify({pid:dead,startedAt:past(1)}))';

if (!process.argv.includes("--i-am-the-maintainer")) {
  console.error("REFUSED: maintainer-only; pass --i-am-the-maintainer (authority FD-PUBLIC-CI-2026-10-19-C, PR #49 only)");
  process.exit(2);
}
const text = fs.readFileSync(FILE, "utf8");
if (text.includes("\r\n")) throw new Error(`${FILE}: CRLF content; refusing (repo text files are LF)`);
const n = text.split(FIND).length - 1;
if (n !== 1) throw new Error(`${FILE}: anchor must occur exactly once, found ${n}`);
const next = text.replace(FIND, () => REPLACE);
const changed = next.split("\n").map((l, i) => (l !== text.split("\n")[i] ? i + 1 : 0)).filter(Boolean);
if (changed.length !== 1 || changed[0] !== 101) throw new Error(`${FILE}: expected exactly line 101 to change, got ${changed.join(",")}`);
fs.writeFileSync(FILE, next);
console.log(`APPLIED FD-PUBLIC-CI-2026-10-19-C to ${FILE} (line 101 only)`);
