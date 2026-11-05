// //TR: Factory V2 merge otorite koruması: kanonik merge yolu (docs/planning/autonomy/executor.mjs) her yazıdan ÖNCE bunu çağırır. Kayıt dalındaki otorite kaydı tam zincir doğrulamasıyla okunur: V4.1 otoritedeyse V4.1 merge'ü geçer; V2 otoritedeyse yalnız V2 tutucusunun kayıtlı anahtarıyla bu PR/head/epoch'a bağlı imzalı MERGE niyeti geçer; devir hazırlığı/drenaj aşamasında veya kayıt doğrulanamıyorsa hiçbir merge geçmez. Böylece devirden sonra V4.1 süreci yeni merge yapamaz — V2 tarafındaki kontrole güvenmeden.
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {verifyAuthorityHistory, authorityRef} from "./bridge.mjs";
import {sidecarPath} from "./shared-registry.mjs";
import {verifyAction, canonDigest, loadCanonicalKeyring} from "./identity.mjs";

export const REGISTRY_BRANCH = "uasco/registry";
export const DOMAIN = "uasco-v7";
const SHA = /^[0-9a-f]{40}$/;

/**
 * Pure decision. readAuthority() -> authority doc | null (null = no record anywhere = genesis, V4.1);
 * keyring() -> canonical keyring (may throw when not yet registered); v2Intent = signed MERGE envelope or null.
 */
export function mergeAuthority({readAuthority, readHistory = () => [], anchored = () => false, hwm = null, registryProtected = () => false, keyring, domain = DOMAIN, pr, headSha, v2Intent = null, now = Date.now()}) {
  let doc, history, anchor, hw;
  try { doc = readAuthority(); history = readHistory(); anchor = anchored(); hw = hwm?.get() ?? null; } catch (e) { return {allowed: false, reason: `AUTHORITY_UNREADABLE:${e?.message ?? e}`}; }
  // Genesis (V4.1 merges as today) only when NOTHING was ever recorded, nothing is anchored on the canonical branch and this reader never saw an epoch.
  if (!doc && !history.some(Boolean) && !anchor && !((hw?.epoch ?? 0) > 0)) return v2Intent ? {allowed: false, reason: "V2_INTENT_WITHOUT_V2_AUTHORITY"} : {allowed: true, by: "V4.1", reason: "NO_AUTHORITY_RECORD"};
  // Once authority exists, its history is only trustworthy if the registry branch cannot be force-pushed or deleted (server-enforced).
  let prot; try { prot = registryProtected(); } catch { prot = false; }
  if (!prot) return {allowed: false, reason: "REGISTRY_NOT_PROTECTED"};
  let ring, core;
  try { ring = keyring(); core = verifyAuthorityHistory({current: doc, history, ring, domain, anchored: anchor, hwm: hw}).core; } catch (e) { return {allowed: false, reason: `AUTHORITY_UNVERIFIABLE:${e?.message ?? e}`}; }
  if (hwm && core.epoch > (hw?.epoch ?? 0)) { try { hwm.set({epoch: core.epoch}); } catch {} }
  if (core.phase === "V41_AUTHORITATIVE") return v2Intent ? {allowed: false, reason: "V2_INTENT_WHILE_V41_AUTHORITATIVE"} : {allowed: true, by: "V4.1", epoch: core.epoch};
  if (core.phase !== "V2_AUTHORITATIVE") return {allowed: false, reason: `HANDOVER_IN_PROGRESS:${core.phase}`}; // nobody merges mid-handover
  if (!v2Intent) return {allowed: false, reason: "V41_FENCED_BY_V2_AUTHORITY"};
  if (!Number.isInteger(pr) || !SHA.test(headSha ?? "")) return {allowed: false, reason: "MERGE_TARGET_INVALID"};
  try {
    const who = verifyAction(v2Intent, {ring, action: "MERGE", domain, prev: canonDigest(core), payload: {pr, headSha, epoch: core.epoch}, now});
    if (who.sessionId !== core.holder) return {allowed: false, reason: "MERGE_SIGNER_NOT_HOLDER"};
    return {allowed: true, by: "V2", epoch: core.epoch, holder: core.holder};
  } catch (e) { return {allowed: false, reason: `V2_INTENT_INVALID:${e?.message ?? e}`}; }
}

/** Live readers for the canonical merge path (read-only git against origin). */
/** api: synchronous GitHub reader (the executor passes its own curlApi) used only for the branch-protection check. */
export function liveAuthorityReaders({repoRoot, remote = "origin", baseRef = "v7/integration", branch = REGISTRY_BRANCH, domain = DOMAIN, api = null}) {
  const git = a => spawnSync("git", a, {cwd: repoRoot, encoding: "utf8"});
  const remoteSha = ref => { const r = git(["ls-remote", remote, ref]); if (r.status !== 0) throw new Error("REMOTE_UNREACHABLE"); return r.stdout.split(/\s+/)[0] || null; };
  const docs = () => {
    const sha = remoteSha(`refs/heads/${branch}`); if (!sha) return null;
    if (git(["fetch", "-q", "--no-tags", remote, `+refs/heads/${branch}:refs/uasco-guard/registry`]).status !== 0) throw new Error("REGISTRY_FETCH_FAILED");
    // only commits that changed this domain's authority file (lease traffic never grows it); overflow fails closed
    const file = sidecarPath(authorityRef(domain)), MAX = 10_000;
    const r = git(["log", "--first-parent", "--format=%H", `--max-count=${MAX + 1}`, sha, "--", file]); if (r.status !== 0) throw new Error("REGISTRY_HISTORY_FAILED");
    const shas = r.stdout.split("\n").filter(Boolean);
    if (shas.length > MAX) throw new Error("REGISTRY_HISTORY_TOO_LONG");
    // unparseable historical entries carry no authority (null, like invalid ones); the CURRENT record (readAuthority) stays strict
    return shas.reverse().map(c => { const s = git(["show", `${c}:${file}`]); if (s.status !== 0) return null; try { return JSON.parse(s.stdout); } catch { return null; } });
  };
  const hwmFile = path.join(repoRoot, ".git", `uasco-authority-hwm-${domain}.json`);
  return {
    readHistory: () => docs() ?? [],
    // server-enforced protection of the registry branch: both force-push (non_fast_forward) and deletion must be forbidden
    registryProtected() {
      if (typeof api !== "function") return false;
      const rules = api(`rules/branches/${encodeURIComponent(branch)}`);
      const types = new Set((Array.isArray(rules) ? rules : []).map(r => r?.type));
      return types.has("non_fast_forward") && types.has("deletion");
    },
    // canonical anchor: a governance-path cutover authorization for this domain exists on the canonical branch
    anchored() {
      const sha = remoteSha(`refs/heads/${baseRef}`);
      if (git(["fetch", "-q", "--no-tags", remote, `+refs/heads/${baseRef}:refs/uasco-guard/base`]).status !== 0) throw new Error("BASE_FETCH_FAILED");
      const r = git(["grep", "-l", "-E", `^AUTHORIZES: FACTORY_V2_CUTOVER domain=${domain} `, sha, "--", "docs/planning/authority/"]);
      if (r.status > 1) throw new Error("ANCHOR_GREP_FAILED");
      return r.status === 0;
    },
    hwm: {get: () => { try { return JSON.parse(fs.readFileSync(hwmFile, "utf8")); } catch { return null; } }, set: v => fs.writeFileSync(hwmFile, JSON.stringify(v))},
    readAuthority() {
      const sha = remoteSha(`refs/heads/${branch}`); if (!sha) return null;
      if (git(["fetch", "-q", "--no-tags", remote, `+refs/heads/${branch}:refs/uasco-guard/registry`]).status !== 0) throw new Error("REGISTRY_FETCH_FAILED");
      const r = git(["show", `${sha}:doc.json`]); if (r.status !== 0) throw new Error("REGISTRY_DOC_MISSING");
      return JSON.parse(r.stdout).sections?.[authorityRef(domain)] ?? null;
    },
    keyring() {
      const sha = remoteSha(`refs/heads/${baseRef}`);
      if (git(["fetch", "-q", "--no-tags", remote, `+refs/heads/${baseRef}:refs/uasco-guard/base`]).status !== 0) throw new Error("BASE_FETCH_FAILED");
      return loadCanonicalKeyring({repoDir: repoRoot, commitSha: sha});
    }
  };
}
