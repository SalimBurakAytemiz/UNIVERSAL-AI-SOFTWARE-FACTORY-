// //TR: Factory V2 rol kimliği: otorite geçişlerini imzalayan her rol (V41_OWNER, V2_CANDIDATE, FOUNDER) ed25519 anahtarıyla imzalar; açık anahtarlar YALNIZ kanonik daldaki Founder onaylı yönetişim dosyasından (docs/planning/authority/FACTORY-V2-ROLE-KEYS.json, belirli commit SHA'sında) okunur — kayıt dalına yazabilen bir oturum anahtar listesini değiştiremez. Çağıranın verdiği "actor" metni kimlik sayılmaz: kimlik = kayıtlı anahtarla doğrulanan imza + rol + oturum + alan + geçerlilik süresi.
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";

export const KEYRING_SCHEMA = "uasco.factory-v2.role-keys/1";
export const ENVELOPE_SCHEMA = "uasco.factory-v2.signed-action/1";
export const CANONICAL_KEYRING_PATH = "docs/planning/authority/FACTORY-V2-ROLE-KEYS.json";
export const ROLES = Object.freeze(["V41_OWNER", "V2_CANDIDATE", "FOUNDER"]);
/** Which roles may sign which authority action. Rollback is never available to an arbitrary registry writer. */
export const ACTION_ROLES = Object.freeze({PREPARE: ["V2_CANDIDATE"], DRAIN_ACK: ["V41_OWNER"], COMMIT: ["V2_CANDIDATE"], ROLLBACK: ["V41_OWNER", "FOUNDER"], MERGE: ["V2_CANDIDATE"]});
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v);
export const canonDigest = v => crypto.createHash("sha256").update(canon(v)).digest("hex");

export class IdentityError extends Error { constructor(code, detail) { super(`${code}${detail ? ":" + detail : ""}`); this.code = code; this.detail = detail; } }

export function generateRoleKey() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({type: "spki", format: "pem"}).toString();
  return {publicKeyPem: pub, privateKeyPem: privateKey.export({type: "pkcs8", format: "pem"}).toString(), keyId: `k_${canonDigest(pub).slice(0, 16)}`};
}

/** Validate a keyring object. `source` records where it came from (canonical commit or probe), and must be stated by the loader. */
/**
 * Keygen for a real role holder: the private key is written ONLY to a new 0600 file outside every git work tree (so it cannot be
 * committed by accident), never overwritten, never printed. Returns the public keyring entry, the only thing that may leave the container.
 */
export function writeRoleKey({role, sessionId, out}) {
  if (!ROLES.includes(role)) throw new IdentityError("KEYGEN_ROLE_INVALID", role);
  if (!/^session_[A-Za-z0-9]{8,}$/.test(sessionId ?? "")) throw new IdentityError("KEYGEN_SESSION_INVALID");
  if (typeof out !== "string" || !out) throw new IdentityError("KEYGEN_OUT_REQUIRED");
  const abs = nodePath.resolve(out), dir = nodePath.dirname(abs);
  if (!fs.existsSync(dir)) throw new IdentityError("KEYGEN_OUT_DIR_MISSING");
  const inTree = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {encoding: "utf8", windowsHide: true});
  if (inTree.status === 0 && inTree.stdout.trim() === "true") throw new IdentityError("KEYGEN_OUT_INSIDE_GIT_WORKTREE", dir);
  if (/^(true|false)$/.test((spawnSync("git", ["-C", dir, "rev-parse", "--is-bare-repository"], {encoding: "utf8", windowsHide: true}).stdout ?? "").trim())) throw new IdentityError("KEYGEN_OUT_INSIDE_GIT_REPOSITORY", dir);
  const k = {...generateRoleKey(), role, sessionId};
  fs.writeFileSync(abs, JSON.stringify(k), {mode: 0o600, flag: "wx"}); // wx: never overwrite an existing key
  return {keyId: k.keyId, role, sessionId, publicKeyPem: k.publicKeyPem};
}

export function parseKeyring(obj, source) {
  if (obj?.schema !== KEYRING_SCHEMA || !Array.isArray(obj.keys) || typeof obj.domain !== "string") throw new IdentityError("KEYRING_INVALID");
  const keys = new Map();
  for (const k of obj.keys) {
    if (!ROLES.includes(k.role) || !/^session_[A-Za-z0-9]{8,}$/.test(k.sessionId ?? "") || typeof k.publicKeyPem !== "string") throw new IdentityError("KEYRING_ENTRY_INVALID", k.keyId);
    const id = `k_${canonDigest(k.publicKeyPem).slice(0, 16)}`;
    if (k.keyId !== id) throw new IdentityError("KEYRING_KEYID_MISMATCH", k.keyId);
    if (keys.has(id)) throw new IdentityError("KEYRING_DUPLICATE", id);
    keys.set(id, {...k, key: crypto.createPublicKey(k.publicKeyPem)});
  }
  return {domain: obj.domain, keys, source, mode: obj.mode ?? "LIVE"};
}

/** Canonical keyring: the governance file at an exact commit of the canonical branch (merged only through a Founder-approved PR). */
export function loadCanonicalKeyring({repoDir, commitSha, path = CANONICAL_KEYRING_PATH}) {
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? "")) throw new IdentityError("KEYRING_COMMIT_INVALID");
  const r = spawnSync("git", ["show", `${commitSha}:${path}`], {cwd: repoDir, encoding: "utf8"});
  if (r.status !== 0) throw new IdentityError("KEYRING_ABSENT", `${commitSha}:${path}`); // no registered keys => no signed action can verify
  let obj; try { obj = JSON.parse(r.stdout); } catch { throw new IdentityError("KEYRING_UNPARSEABLE"); }
  const ring = parseKeyring(obj, {kind: "CANONICAL", commitSha, path});
  if (ring.mode !== "LIVE") throw new IdentityError("KEYRING_NOT_LIVE");
  return ring;
}

/** Sign an action. payload is any JSON; prev binds the action to the exact authority state it acts on (anti-replay). */
export function signAction({privateKeyPem, keyId, role, sessionId, domain, action, prev, payload, now = Date.now(), ttlMs = 15 * 60_000}) {
  const body = {schema: ENVELOPE_SCHEMA, domain, action, role, sessionId, keyId, prev, payloadDigest: canonDigest(payload ?? null), issuedAt: now, expiresAt: now + ttlMs, nonce: crypto.randomUUID()};
  const signature = crypto.sign(null, Buffer.from(canon(body)), crypto.createPrivateKey(privateKeyPem)).toString("base64");
  return {...body, signature};
}

/**
 * Verify an envelope against the keyring: signature, registered key, role allowed for the action, key bound to the claimed session,
 * domain, freshness, prev binding and payload digest. Returns the verified signer; throws otherwise.
 */
export function verifyAction(env, {ring, action, domain, prev, payload, now = Date.now(), checkTime = true}) {
  if (env?.schema !== ENVELOPE_SCHEMA) throw new IdentityError("ENVELOPE_SCHEMA");
  const {signature, ...body} = env;
  const k = ring.keys.get(env.keyId);
  if (!k) throw new IdentityError("SIGNER_KEY_UNKNOWN", env.keyId);
  let ok = false; try { ok = crypto.verify(null, Buffer.from(canon(body)), k.key, Buffer.from(String(signature), "base64")); } catch { ok = false; }
  if (!ok) throw new IdentityError("SIGNATURE_INVALID");
  if (k.role !== env.role || k.sessionId !== env.sessionId) throw new IdentityError("SIGNER_IDENTITY_MISMATCH", `${env.role}/${env.sessionId}`); // claims must match the registered key
  if (!(ACTION_ROLES[action] ?? []).includes(k.role)) throw new IdentityError("ROLE_NOT_ALLOWED", `${k.role}->${action}`);
  if (env.action !== action) throw new IdentityError("ACTION_MISMATCH", env.action);
  if (env.domain !== domain || ring.domain !== domain) throw new IdentityError("DOMAIN_MISMATCH");
  if (env.prev !== prev) throw new IdentityError("STALE_OR_REPLAYED", "prev"); // bound to the exact prior state
  if (env.payloadDigest !== canonDigest(payload ?? null)) throw new IdentityError("PAYLOAD_MISMATCH");
  if (checkTime && (!(now >= env.issuedAt - 60_000) || now > env.expiresAt)) throw new IdentityError("ENVELOPE_EXPIRED");
  if (k.validUntil && now > k.validUntil) throw new IdentityError("KEY_EXPIRED");
  return {role: k.role, sessionId: k.sessionId, keyId: k.keyId};
}
