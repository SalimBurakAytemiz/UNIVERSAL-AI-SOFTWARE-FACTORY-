// //TR: Phase-0 PROPOSAL (korunmayan scaffold) — separate-identity governance referans dogrulayicisi. AKTIF BIR KONTROL DEGILDIR; hicbir yerde cagrilmaz/baglanmaz. Maintainer sonradan PROTECTED kapsama (automation/lib/) terfi ettirir. Builder asla muhurleyici degildir; gercek anahtar yoktur. Saf fonksiyon: anahtar/ag yok, yalniz duz veri nesneleri; fail-closed.
// Spec: SEPARATE-IDENTITY-CLOUD-GOVERNANCE.md (CP-GOV). Pinned registry/epoch/policy caller tarafindan PROTECTED control-plane kokunden verilmelidir, aday worktree'den ASLA.
import { createHash, createPublicKey, verify } from "node:crypto";

const ident = x => (typeof x === "string" ? x.trim().toLowerCase() : ""); // lease-verdict.mjs ile ayni normalize
export const AUTOMATABLE_CLASSES = Object.freeze(["cloud-automation", "local-automation"]);
export const HUMAN_CLASS = "human-custody";
export const BUILDER_CLASSES = Object.freeze(["builder", "implementer", "orchestrator"]);

// deterministic canonical JSON (sorted keys)
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}
export const payloadDigest = payload => createHash("sha256").update(stableStringify(payload)).digest();
export const keyFingerprintOf = pem => createHash("sha256").update(createPublicKey(pem).export({ type: "spki", format: "der" })).digest("hex");

function sigValid(pem, digest, sigB64) {
  try { return typeof sigB64 === "string" && sigB64.length > 0 && verify(null, digest, createPublicKey(pem), Buffer.from(sigB64, "base64")); }
  catch { return false; }
}

/**
 * request: { payload:{manifestFilesDigest,commit,policyDigest,epoch,nonce,authoredBy}, signatures:[{principalId,keyFingerprint,signature}] }
 * pinned:  { registry:{principals:[{principalId,roleClass,publicKeyPem,keyFingerprint}],quorum:{m,n}}, minEpoch, expectedPolicyDigest, builderIdentities:[] }
 * returns { ok, reasons[] } — ok only when reasons is empty.
 */
export function verifyGovernance(request, pinned) {
  const reasons = [];
  const fail = r => { reasons.push(r); };
  const p = request?.payload, sigs = request?.signatures, reg = pinned?.registry;
  if (!p || typeof p !== "object" || !Array.isArray(sigs)) return { ok: false, reasons: ["REQUEST_MALFORMED"] };
  if (!reg || !Array.isArray(reg.principals) || !reg.quorum || !Number.isInteger(reg.quorum.m) || reg.quorum.m < 2) return { ok: false, reasons: ["REGISTRY_MISSING_OR_WEAK"] };
  if (!pinned.expectedPolicyDigest || !Number.isInteger(pinned.minEpoch) || !Array.isArray(pinned.builderIdentities)) return { ok: false, reasons: ["PINNED_CONTEXT_INCOMPLETE"] };
  for (const k of ["manifestFilesDigest", "commit", "policyDigest", "epoch", "nonce", "authoredBy"]) if (p[k] === undefined || p[k] === null || p[k] === "") fail(`PAYLOAD_MISSING:${k}`);
  if (reasons.length) return { ok: false, reasons };

  if (p.policyDigest !== pinned.expectedPolicyDigest) fail("POLICY_DIGEST_MISMATCH");
  if (!Number.isInteger(p.epoch) || p.epoch < pinned.minEpoch) fail("STALE_EPOCH");

  const digest = payloadDigest(p);
  const author = ident(p.authoredBy);
  const builders = new Set(pinned.builderIdentities.map(ident).filter(Boolean));
  const byId = new Map(reg.principals.map(x => [ident(x.principalId), x]));
  const seenP = new Set(), seenK = new Set();
  let valid = 0, humanValid = 0, automatable = 0;

  for (const s of sigs) {
    const id = ident(s?.principalId);
    const pr = byId.get(id);
    if (!pr) { fail(`SIGNER_NOT_IN_REGISTRY:${id || "?"}`); continue; }
    if (BUILDER_CLASSES.includes(pr.roleClass) || builders.has(id)) { fail(`SIGNER_IS_BUILDER:${id}`); continue; }
    if (id === author) { fail(`SELF_APPROVAL:${id}`); continue; }
    // pinned key only: the claimed fingerprint must match the registry's AND the real key
    let fp; try { fp = keyFingerprintOf(pr.publicKeyPem); } catch { fail(`REGISTRY_KEY_INVALID:${id}`); continue; }
    if (fp !== pr.keyFingerprint || (s.keyFingerprint !== undefined && ident(s.keyFingerprint) !== fp)) { fail(`KEY_FINGERPRINT_MISMATCH:${id}`); continue; }
    if (!sigValid(pr.publicKeyPem, digest, s.signature)) { fail(`SIGNATURE_INVALID:${id}`); continue; }
    if (seenP.has(id)) { fail(`DUPLICATE_PRINCIPAL:${id}`); continue; }
    if (seenK.has(fp)) { fail(`DUPLICATE_KEY:${id}`); continue; }
    seenP.add(id); seenK.add(fp); valid++;
    if (pr.roleClass === HUMAN_CLASS) humanValid++;
    else if (AUTOMATABLE_CLASSES.includes(pr.roleClass)) automatable++;
    else fail(`ROLE_CLASS_UNKNOWN:${id}`);
  }
  if (valid === 0) fail("NO_VALID_SIGNATURE");
  if (valid < reg.quorum.m) fail(`QUORUM_NOT_MET:${valid}<${reg.quorum.m}`);
  if (humanValid < 1) fail("HUMAN_CUSTODY_SIGNER_MISSING");
  if (valid > 0 && automatable === valid) fail("ALL_AUTOMATABLE_QUORUM");
  return { ok: reasons.length === 0, reasons };
}
