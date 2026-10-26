//TR: Windows sistem programlarını (wsl.exe, taskkill.exe) MUTLAK sistem yoluyla çözer (SystemRoot\System32\<ad>): libuv çıplak adı Windows'ta ÖNCE geçerli dizinde arar, bu yüzden çalışma dizinindeki sahte bir wsl.exe/taskkill.exe çalıştırılabilirdi. Dosya yoksa null döner (çağıran reddeder; sessiz çıplak-ad yedeği YOKTUR). Windows dışında ad olduğu gibi döner (test sahte çalıştırıcıları, taskkill zaten yalnız win32'de çağrılır).
import fs from "node:fs";
import path from "node:path";

export interface SystemExeOptions { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; exists?: (p: string) => boolean }

export function systemExe(name: string, o: SystemExeOptions = {}): string | null {
  if (!/^[A-Za-z0-9._-]{1,32}\.exe$/i.test(name) && (o.platform ?? process.platform) === "win32") return null;
  if ((o.platform ?? process.platform) !== "win32") return name;
  const given = (o.env ?? process.env).SystemRoot;
  const root = typeof given === "string" && /^[A-Za-z]:\\/.test(given) ? given : "C:\\Windows";
  const p = path.win32.join(root, "System32", name);
  return (o.exists ?? fs.existsSync)(p) ? p : null;
}
