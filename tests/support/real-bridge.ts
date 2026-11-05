// //TR: Bu yardımcı, renderer görünümlerini GERÇEK Control API'ye (buildServer) bağlayan test köprüsünü tek yerde toplar (UASCO-T0006): apps/desktop/main.mjs "uasco:api-get" + verifyServerIdentity + api() davranışını birebir taklit eder — masaüstü GET allow-list'i (control-boundary + main B4-ALLOWLIST bloğu), /health için challenge + controlProof kimlik doğrulaması ve sentezlenmiş gövde, /v1 için kontrol token'ı ve "<yol>: HTTP <kod>" hata biçimi; POST her zaman testi düşürür. Ağ yalnız 127.0.0.1 üzerindedir.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {pathToFileURL} from "node:url";

const REPO = path.resolve(__dirname, "..", "..");
export const TEST_TOKEN = "t".repeat(32);
export const DEFAULT_TEST_PORT = 3210;

export type Transport = (url: string, headers: Record<string, string>) => Promise<{statusCode: number; json: () => any}>;
interface Injectable { inject: (o: {method: "GET"; url: string; headers: Record<string, string>}) => Promise<{statusCode: number; json: () => any}> }

/** Fastify inject taşıyıcısı (süreç içi, gerçek route + kapı). */
export const injectTransport = (app: Injectable): Transport => async (url, headers) => app.inject({method: "GET", url, headers});
/** Gerçek HTTP taşıyıcısı (main.mjs ile aynı fetch seçenekleri); sunucu kapalıysa gerçek "fetch failed" -> OFFLINE. */
export const httpTransport = (base: string): Transport => async (url, headers) => {
  const r = await fetch(base + url, {headers, redirect: "error", cache: "no-store"});
  const body = await r.text();
  return {statusCode: r.status, json: () => JSON.parse(body)};
};
/** Boş bir loopback portu: sunucu bu porta göre kurulur ve dinler (host denetimi ve kimlik kanıtı porta bağlıdır). */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((res, rej) => { const srv = net.createServer(); srv.once("error", rej); srv.listen(0, "127.0.0.1", () => { const a = srv.address() as {port: number}; srv.close(() => res(a.port)); }); });
}
/** main.mjs B4-ALLOWLIST bloğu + control-boundary desktopGetPathAllowed: masaüstünün gerçek GET allow-list'i. */
export async function desktopAllowList(): Promise<{allowed: (p: string) => boolean; proof: (token: string, challenge: string) => string | null}> {
  const mainSrc = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
  const m = /\/\/ B4-ALLOWLIST-BEGIN\n([\s\S]*?)\/\/ B4-ALLOWLIST-END/.exec(mainSrc);
  if (!m) throw new Error("main.mjs B4-ALLOWLIST block not found");
  const extra = new Function(`${m[1]}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
  const boundary = await import(pathToFileURL(path.join(REPO, "automation", "lib", "control-boundary.mjs")).href);
  return {allowed: (p: string) => boundary.desktopGetPathAllowed(p) || extra(p), proof: boundary.controlChallengeProof};
}
/** main.mjs köprüsü: token'ı yalnız köprü bilir (renderer bilmez). `port` çağrı anında okunur (test içinde değişebilir). */
export async function realBridge(transport: Transport, opts: {token?: string; port: () => number} ) {
  const token = opts.token ?? TEST_TOKEN;
  const {allowed, proof} = await desktopAllowList();
  const calls: string[] = [];
  const host = () => `127.0.0.1:${opts.port()}`;
  const verify = async () => {
    const challenge = crypto.randomBytes(32).toString("hex"), expected = proof(token, challenge);
    if (!expected) throw new Error("CONTROL_TOKEN_NOT_CONFIGURED");
    const r = await transport(`/health?challenge=${challenge}`, {host: host()});
    if (r.statusCode !== 200) throw new Error(`health: HTTP ${r.statusCode}`);
    const h = r.json();
    if (h.status !== "HEALTHY" || h.system !== "UNIVERSAL-AI-SOFTWARE-COMPANY-OS" || h.bindHost !== "127.0.0.1" || Number(h.port) !== opts.port() || h.controlProof !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const bridge = {
    apiGet: async (p: string) => {
      calls.push(p);
      if (!allowed(p)) throw new Error("INVALID_API_PATH");
      if (p === "/health") { await verify(); return {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"}; }
      if (!p.startsWith("/v1/")) throw new Error("CONTROL_API_PATH_INVALID");
      await verify();
      const r = await transport(p, {"x-uasco-control-token": token, host: host()});
      if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    },
    apiPost: async (p: string) => { throw new Error(`POST must never be called (${p})`); }
  };
  return {bridge, calls, allowed};
}
