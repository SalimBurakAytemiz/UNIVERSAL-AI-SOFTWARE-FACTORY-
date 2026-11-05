// //TR: Factory V2 merge otorite koruması: kanonik merge yolu (docs/planning/autonomy/executor.mjs) her yazıdan ÖNCE bunu çağırır. Kayıt dalındaki otorite kaydı tam zincir doğrulamasıyla okunur: V4.1 otoritedeyse V4.1 merge'ü geçer; V2 otoritedeyse yalnız V2 tutucusunun kayıtlı anahtarıyla bu PR/head/epoch'a bağlı imzalı MERGE niyeti geçer; devir hazırlığı/drenaj aşamasında veya kayıt doğrulanamıyorsa hiçbir merge geçmez. Böylece devirden sonra V4.1 süreci yeni merge yapamaz — V2 tarafındaki kontrole güvenmeden.
import {spawnSync} from "node:child_process";
import {verifyAuthorityDoc, authorityRef} from "./bridge.mjs";
import {verifyAction, canonDigest, loadCanonicalKeyring} from "./identity.mjs";

export const REGISTRY_BRANCH = "uasco/registry";
export const DOMAIN = "uasco-v7";
const SHA = /^[0-9a-f]{40}$/;

/**
 * Pure decision. readAuthority() -> authority doc | null (null = no record anywhere = genesis, V4.1);
 * keyring() -> canonical keyring (may throw when not yet registered); v2Intent = signed MERGE envelope or null.
 */
export function mergeAuthority({readAuthority, keyring, domain = DOMAIN, pr, headSha, v2Intent = null, now = Date.now()}) {
  let doc;
  try { doc = readAuthority(); } catch (e) { return {allowed: false, reason: `AUTHORITY_UNREADABLE:${e?.message ?? e}`}; }
  if (!doc) return v2Intent ? {allowed: false, reason: "V2_INTENT_WITHOUT_V2_AUTHORITY"} : {allowed: true, by: "V4.1", reason: "NO_AUTHORITY_RECORD"};
  let ring, core;
  try { ring = keyring(); core = verifyAuthorityDoc(doc, {ring, domain}).core; } catch (e) { return {allowed: false, reason: `AUTHORITY_UNVERIFIABLE:${e?.message ?? e}`}; }
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
export function liveAuthorityReaders({repoRoot, remote = "origin", baseRef = "v7/integration", branch = REGISTRY_BRANCH, domain = DOMAIN}) {
  const git = a => spawnSync("git", a, {cwd: repoRoot, encoding: "utf8"});
  const remoteSha = ref => { const r = git(["ls-remote", remote, ref]); if (r.status !== 0) throw new Error("REMOTE_UNREACHABLE"); return r.stdout.split(/\s+/)[0] || null; };
  return {
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
