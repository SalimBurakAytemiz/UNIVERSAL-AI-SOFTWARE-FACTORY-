// //TR: Phase-0 PROPOSAL proof — governance-verify.mjs icin bagimsiz Node kanitlari. Anahtarlar bu dosyada gecici (throwaway) uretilir ve diske yazilmaz; gercek anahtar/seal/D3 yoktur. Aktif kontrol degildir.
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyGovernance, payloadDigest, keyFingerprintOf } from "./governance-verify.mjs";

const mk = (principalId, roleClass) => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  return { principalId, roleClass, publicKeyPem, keyFingerprint: keyFingerprintOf(publicKeyPem), privateKey };
};
const founder = mk("founder-hw", "human-custody"), cloudGov = mk("cloud-gov", "cloud-automation"), localGov = mk("local-gov", "local-automation");
const builder = mk("builder-1", "builder"), rogue = mk("rogue", "cloud-automation");
const registry = { epoch: 5, quorum: { m: 2, n: 3 }, principals: [founder, cloudGov, localGov, builder].map(({ privateKey, ...x }) => x) };
const pinned = { registry, minEpoch: 5, expectedPolicyDigest: "pol-1", builderIdentities: ["builder-1"] };
const payload = { manifestFilesDigest: "m1", commit: "c1", policyDigest: "pol-1", epoch: 5, nonce: "n1", authoredBy: "builder-1" };
const S = (k, p = payload, id = k.principalId) => ({ principalId: id, keyFingerprint: k.keyFingerprint, signature: sign(null, payloadDigest(p), k.privateKey).toString("base64") });

let pass = 0, failN = 0;
const t = (name, res, wantOk, wantReason) => {
  const good = res.ok === wantOk && (!wantReason || res.reasons.some(r => r.startsWith(wantReason)));
  good ? pass++ : failN++;
  console.log(`${good ? "PASS" : "FAIL"} ${name} -> ${JSON.stringify(res)}`);
};
const v = (req, pin = pinned) => verifyGovernance(req, pin);

t("accept valid distinct quorum + human", v({ payload, signatures: [S(founder), S(cloudGov)] }), true);
t("reject builder-signed seal", v({ payload, signatures: [S(builder), S(founder)] }), false, "SIGNER_IS_BUILDER");
t("reject self-approval (signer==author, case variant)", v({ payload: { ...payload, authoredBy: " Cloud-Gov " }, signatures: [S(founder, { ...payload, authoredBy: " Cloud-Gov " }), S(cloudGov, { ...payload, authoredBy: " Cloud-Gov " })] }), false, "SELF_APPROVAL");
const badSig = S(cloudGov); badSig.signature = S(cloudGov, { ...payload, nonce: "evil" }).signature;
t("reject forged signature", v({ payload, signatures: [S(founder), badSig] }), false, "SIGNATURE_INVALID");
t("reject absent signature", v({ payload, signatures: [S(founder), { principalId: "cloud-gov", keyFingerprint: cloudGov.keyFingerprint }] }), false, "SIGNATURE_INVALID");
t("reject unregistered signer", v({ payload, signatures: [S(founder), S(rogue)] }), false, "SIGNER_NOT_IN_REGISTRY");
t("reject M-1 signatures", v({ payload, signatures: [S(founder)] }), false, "QUORUM_NOT_MET");
t("reject duplicate-principal fake-M", v({ payload, signatures: [S(founder), S(founder)] }), false, "DUPLICATE_PRINCIPAL");
const alias = { ...registry, principals: [...registry.principals, { principalId: "founder-alias", roleClass: "human-custody", publicKeyPem: founder.publicKeyPem, keyFingerprint: founder.keyFingerprint }] };
t("reject duplicate-key fake-M (alias principal)", v({ payload, signatures: [S(founder), S(founder, payload, "founder-alias")] }, { ...pinned, registry: alias }), false, "DUPLICATE_KEY");
const stale = { ...payload, epoch: 4 };
t("reject stale epoch", v({ payload: stale, signatures: [S(founder, stale), S(cloudGov, stale)] }), false, "STALE_EPOCH");
t("reject all-automatable quorum", v({ payload, signatures: [S(cloudGov), S(localGov)] }), false, "HUMAN_CUSTODY_SIGNER_MISSING");
t("reject policyDigest mismatch", v({ payload, signatures: [S(founder), S(cloudGov)] }, { ...pinned, expectedPolicyDigest: "other" }), false, "POLICY_DIGEST_MISMATCH");

console.log(`SUMMARY: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
