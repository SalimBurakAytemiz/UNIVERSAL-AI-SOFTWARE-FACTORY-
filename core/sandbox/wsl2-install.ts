// //TR: DSK-T0007 UASCO-Sandbox kurulum akışı (masaüstü kurulum adımı bunu çağırır): kullanıcının mevcut WSL dağıtımlarına DOKUNMAZ (yalnız UASCO-Sandbox adı kullanılır; varsa yeniden içe aktarılmaz, doğrulamaya geçilir), sabitlenmiş resmi dosyaları indirip özetlerini doğrular, uygulamanın konukta gereken dosyalarını (broker, env politikası, üç yapılandırma, konuk çıkış proxy'si) paketler, kurulum planını çalıştırır ve YALNIZ başarıda konuk ikili özetlerini kontrol köküne yazar (sunucu sağlayıcıyı bu kayıtla doğrular). Herhangi bir adım başarısızsa kayıt yazılmaz: gerçek yürütme kapalı kalır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {WSL_DISTRO, WSL2_ARTIFACTS, parseWslList, provisionPlan, provision} from "./wsl2-provider.js";
import type {WslRunner} from "./wsl2-provider.js";

/** Files the guest needs from the app (the broker's whole import closure + its config + the guest egress proxy). */
export const GUEST_APP_FILES = Object.freeze(["scripts/claude-builder-broker.mjs", "automation/lib/env-policy.mjs", "config/automation.json", "config/builder-execution-policy.json", "config/environment-policy.json", "core/sandbox/guest/egress.cjs"]);
export const SANDBOX_RECORD = (controlRoot: string) => path.join(controlRoot, ".ai", "runtime", "WSL_SANDBOX.json");
const realSha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export interface InstallDeps {
  runner: WslRunner;
  /** Fetch a URL to a file (the desktop passes an HTTPS downloader; tests a stub). The hash is checked here, not by the fetcher. */
  download: (url: string, dest: string) => Promise<void>;
  /** Builds a tar of `files` (relative to appRoot) at `dest`, entries under ./app/... ; default: the system tar. */
  packApp?: (appRoot: string, files: readonly string[], dest: string) => void;
  readFile?: (p: string) => Buffer;
  /** Test seam only (real artifacts are not in CI); production uses sha256 of the bytes. */
  sha256?: (b: Buffer) => string;
}
export type InstallResult = {ok: true; installed: boolean; record: string} | {ok: false; step: string};

const defaultPackApp = (appRoot: string, files: readonly string[], dest: string): void => {
  const tar = process.platform === "win32" ? path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const staging = fs.mkdtempSync(path.join(path.dirname(dest), "app-"));
  for (const f of files) { const t = path.join(staging, "sbx-app", f); fs.mkdirSync(path.dirname(t), {recursive: true}); fs.copyFileSync(path.join(appRoot, f), t); }
  fs.mkdirSync(path.join(staging, "sbx-app", "sbx"), {recursive: true}); fs.copyFileSync(path.join(appRoot, "core/sandbox/guest/egress.cjs"), path.join(staging, "sbx-app", "sbx", "egress.cjs"));
  const r = cp.spawnSync(tar, ["-c", "-f", dest, "-C", path.join(staging, "sbx-app"), "."], {windowsHide: true});
  fs.rmSync(staging, {recursive: true, force: true});
  if (r.status !== 0) throw new Error("APP_PACK_FAILED");
};

/** Installs (or re-verifies) the dedicated distro. workDir: a private directory under the app's local data (downloads, app tar). */
export async function installSandbox(o: {appRoot: string; controlRoot: string; installDir: string; workDir: string}, d: InstallDeps): Promise<InstallResult> {
  const read = d.readFile ?? (p => fs.readFileSync(p)), sha256 = d.sha256 ?? realSha256;
  const list = await d.runner(["-l", "-v"], {timeoutMs: 30_000});
  if (list.exitCode === null) return {ok: false, step: "WSL_NOT_AVAILABLE"};
  const existing = parseWslList(list.stdout).find(r => r.name === WSL_DISTRO);
  if (existing && existing.version !== 2) return {ok: false, step: "EXISTING_DISTRO_NOT_WSL2"};
  fs.mkdirSync(o.workDir, {recursive: true});
  const art: Record<"rootfs" | "node" | "claude", string> = {rootfs: path.join(o.workDir, "rootfs.tar.gz"), node: path.join(o.workDir, "node.tar.xz"), claude: path.join(o.workDir, "claude.tgz")};
  for (const k of ["rootfs", "node", "claude"] as const) {
    if (k === "rootfs" && existing) continue;
    if (!fs.existsSync(art[k]) || sha256(read(art[k])) !== WSL2_ARTIFACTS[k].sha256) {
      try { await d.download(WSL2_ARTIFACTS[k].url, art[k]); } catch { return {ok: false, step: `DOWNLOAD_FAILED_${k.toUpperCase()}`}; }
      if (sha256(read(art[k])) !== WSL2_ARTIFACTS[k].sha256) { fs.rmSync(art[k], {force: true}); return {ok: false, step: `ARTIFACT_HASH_MISMATCH_${k.toUpperCase()}`}; }
    }
  }
  const appTar = path.join(o.workDir, "app.tar");
  try { (d.packApp ?? defaultPackApp)(o.appRoot, GUEST_APP_FILES, appTar); } catch { return {ok: false, step: "APP_PACK_FAILED"}; }
  const plan = provisionPlan({installDir: o.installDir, rootfs: {path: art.rootfs, sha256: WSL2_ARTIFACTS.rootfs.sha256}, node: {path: art.node, sha256: WSL2_ARTIFACTS.node.sha256},
    claude: {path: art.claude, sha256: WSL2_ARTIFACTS.claude.sha256}, appScriptsTar: {path: appTar, sha256: sha256(read(appTar))},
    nodeBinarySha256: WSL2_ARTIFACTS.node.binarySha256 ?? "", claudeBinarySha256: WSL2_ARTIFACTS.claude.binarySha256 ?? ""});
  if (!plan.ok) return {ok: false, step: plan.error};
  // an existing UASCO-Sandbox is never re-imported (no data loss, no second distro); everything after the import step is idempotent and re-verified
  const steps = existing ? {ok: true as const, steps: plan.steps.filter(s => s.args[0] !== "--import")} : plan;
  const r = await provision(steps, d.runner, read, sha256);
  if (!r.ok) return r;
  const record = SANDBOX_RECORD(o.controlRoot);
  fs.mkdirSync(path.dirname(record), {recursive: true});
  fs.writeFileSync(record, JSON.stringify({distro: WSL_DISTRO, node: WSL2_ARTIFACTS.node.binarySha256, claude: WSL2_ARTIFACTS.claude.binarySha256, installedAt: new Date().toISOString()}, null, 2) + "\n");
  return {ok: true, installed: !existing, record};
}
