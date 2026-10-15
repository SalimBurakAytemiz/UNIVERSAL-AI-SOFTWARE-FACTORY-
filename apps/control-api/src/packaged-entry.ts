// //TR: Bu giriş noktası kurulu (paketlenmiş) UASCO masaüstü uygulamasında Control API'yi Electron node modunda başlatır: token yalnız stdin'in ilk satırından okunur (argv/env/log'a girmez), değişken veri yolları yalnız mutlak UASCO_RUNTIME_DIR/UASCO_DATA_DIR'den alınır, sunucu yalnız 127.0.0.1'e bağlanır ve stdin kapanınca (ana süreç çıkınca) temiz kapanır.
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildServer} from "./server.js";
import {parseControlPort} from "../../../automation/lib/control-boundary.mjs";

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** stdin'in ilk satırını en çok 256 bayt ve süre sınırıyla okur; satırın geri kalanını tutmaz. */
export function readFirstLine(stream: NodeJS.ReadableStream, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = (err: Error | null, value?: string) => {
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      if (err) reject(err); else resolve(value ?? "");
    };
    const onData = (chunk: Buffer | string) => {
      buf += String(chunk);
      const i = buf.indexOf("\n");
      if (i >= 0) { done(null, buf.slice(0, i).replace(/\r$/, "")); return; }
      if (buf.length > 256) done(new Error("CONTROL_TOKEN_LINE_TOO_LONG"));
    };
    const onEnd = () => done(new Error("CONTROL_TOKEN_STDIN_CLOSED"));
    const timer = setTimeout(() => done(new Error("CONTROL_TOKEN_STDIN_TIMEOUT")), timeoutMs);
    stream.on("data", onData);
    stream.on("end", onEnd);
  });
}

/** Kurulu mod ortamını doğrular: iki veri yolu da mutlak olmalı, port geçerli olmalıdır. */
export function packagedServerConfig(env: NodeJS.ProcessEnv): {runtime: string; dataDir: string; port: number} {
  const runtime = env.UASCO_RUNTIME_DIR ?? "", dataDir = env.UASCO_DATA_DIR ?? "";
  if (!path.isAbsolute(runtime)) throw new Error("UASCO_RUNTIME_DIR_NOT_ABSOLUTE");
  if (!path.isAbsolute(dataDir)) throw new Error("UASCO_DATA_DIR_NOT_ABSOLUTE");
  return {runtime: path.resolve(runtime), dataDir: path.resolve(dataDir), port: parseControlPort(env.CONTROL_API_PORT, 3210)};
}

/**
 * INT-R3 D-M1-02: provenance/ayar kontrol kökü userData altındadır (runtime ve veri dizinlerinin ortak üst dizini + "control"), asla kurulum dizini değildir.
 * İki mutlak yol aynı üst dizini paylaşmalıdır (masaüstü kabuğu ikisini de userData altında kurar); aksi halde fail-closed.
 */
export function packagedControlRoot(cfg: {runtime: string; dataDir: string}): string {
  const parent = path.dirname(path.resolve(cfg.runtime));
  if (path.dirname(path.resolve(cfg.dataDir)) !== parent || path.dirname(parent) === parent) throw new Error("UASCO_CONTROL_ROOT_UNRESOLVED");
  return path.join(parent, "control");
}
/** Paketli uygulama kökü: bu dosya <app>/apps/control-api/src/packaged-entry.js konumundadır. */
export const packagedAppRoot = (): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function main(): Promise<void> {
  const cfg = packagedServerConfig(process.env);
  const controlRoot = packagedControlRoot(cfg);
  process.stdin.setEncoding("utf8");
  const token = await readFirstLine(process.stdin);
  if (!TOKEN_RE.test(token)) throw new Error("CONTROL_TOKEN_INVALID");
  const app = buildServer({controlToken: token, runtime: cfg.runtime, dataDir: cfg.dataDir, port: cfg.port, logger: true, repoRoot: packagedAppRoot(), controlRoot});
  let closing = false;
  const shutdown = async (code: number) => {
    if (closing) return;
    closing = true;
    try { await app.close(); } catch { /* kapanışta hata yutulur; süreç yine çıkar */ }
    process.exit(code);
  };
  process.stdin.on("end", () => void shutdown(0));
  process.stdin.on("close", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  process.stdin.resume();
  await app.listen({host: "127.0.0.1", port: cfg.port});
}

// //TR: Yalnız doğrudan çalıştırıldığında başlar; testler saf yardımcıları import ederken stdin okunmaz.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`PACKAGED_CONTROL_API_FAILED: ${msg.slice(0, 300)}\n`);
  process.exit(2);
});
