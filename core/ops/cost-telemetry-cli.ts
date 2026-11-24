// //TR: UASCO-T0111 çevrimdışı komut satırı (npx tsx core/ops/cost-telemetry-cli.ts ...). Ağ/sağlayıcı/ücretli çağrı YAPMAZ; yalnız yerel döküm ve anlık görüntü dosyalarını okur/yazar.
//   snapshot --input <dump.json> --out <abs dir> [--day YYYY-MM-DD]   get_session biçimli dökümden günlük anlık görüntüyü yazar
//   series   --dir <abs dir> --end YYYY-MM-DD [--days 7]               günlük serisini JSON olarak yazdırır (eksik gün MISSING, maliyeti null)
//   gate     --dir <abs dir> --day YYYY-MM-DD --threshold <usd>        bütçe kapısı: çıkış 0 CONTINUE, 3 STOP, 4 UNKNOWN, 2 girdi hatası
// Koordinatör bağlaması (kapı çıkışında durma, ledger alanı) korunan automation/ sahibinin işidir; bu komut ona tek bir çağrı noktası sağlar.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {GATE_EXIT, readSeries, runCostGate, snapshotFromDump} from "./cost-telemetry-store.js";

export function parseArgs(argv: readonly string[]): {cmd: string; opts: Record<string, string>} {
  const [cmd = "", ...rest] = argv, opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1];
    if (!/^--[a-z]+$/.test(k) || v === undefined || v.startsWith("--")) throw new Error(`ARG_INVALID:${k}`);
    opts[k.slice(2)] = v;
  }
  return {cmd, opts};
}

/** Komutu çalıştırır; {exitCode, out} döner (süreç çıkışı yalnız ana girişte yapılır, testler doğrudan çağırır). */
export function runCli(argv: readonly string[]): {exitCode: number; out: string} {
  let cmd: string, opts: Record<string, string>;
  try { ({cmd, opts} = parseArgs(argv)); } catch (e) { return {exitCode: GATE_EXIT.INPUT_ERROR, out: JSON.stringify({error: (e as Error).message})}; }
  const need = (k: string) => { const v = opts[k]; if (v === undefined) throw new Error(`ARG_MISSING:--${k}`); return v; };
  const abs = (k: string) => path.resolve(need(k));
  try {
    if (cmd === "snapshot") {
      const dump = JSON.parse(fs.readFileSync(abs("input"), "utf8"));
      const r = snapshotFromDump(dump, abs("out"), opts.day);
      return {exitCode: 0, out: JSON.stringify({file: r.file, aggregate: r.snapshot.aggregate})};
    }
    if (cmd === "series") {
      const days = opts.days === undefined ? 7 : Number(opts.days);
      return {exitCode: 0, out: JSON.stringify(readSeries(abs("dir"), need("end"), days))};
    }
    if (cmd === "gate") {
      const thr = Number(need("threshold"));
      const g = runCostGate(abs("dir"), need("day"), thr);
      return {exitCode: g.exitCode, out: JSON.stringify(g.verdict)};
    }
    return {exitCode: GATE_EXIT.INPUT_ERROR, out: JSON.stringify({error: `UNKNOWN_COMMAND:${cmd}`})};
  } catch (e) {
    // gate için girdi hatası da durmayı gerektirir (0 değildir)
    return {exitCode: GATE_EXIT.INPUT_ERROR, out: JSON.stringify({error: (e as Error).message})};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = runCli(process.argv.slice(2));
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.exitCode;
}
