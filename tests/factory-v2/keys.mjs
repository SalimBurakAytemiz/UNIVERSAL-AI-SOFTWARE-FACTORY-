// //TR: Factory V2 test kimlikleri: V41_OWNER, V2_CANDIDATE, FOUNDER ve kayıtsız bir saldırgan için ed25519 anahtarları; test anahtar listesi (kanonik değil, yalnız testte) ve canlı kaynak sağlayıcısı test tarafından ayarlanabilen bir köprü kurucusu.
import {generateRoleKey, parseKeyring, KEYRING_SCHEMA} from "../../automation/factory-v2/identity.mjs";
import {AuthorityBridge, REQUIRED_GATES} from "../../automation/factory-v2/bridge.mjs";

export const SESS = {V41: "session_v41supervisor", V2: "session_v2supervisor", FOUNDER: "session_founderxx01", ATTACK: "session_attackerxx1"};
const mk = (role, sessionId) => { const k = generateRoleKey(); return {...k, role, sessionId}; };
export const S = {V41: mk("V41_OWNER", SESS.V41), V2: mk("V2_CANDIDATE", SESS.V2), FOUNDER: mk("FOUNDER", SESS.FOUNDER), ATTACK: mk("V2_CANDIDATE", SESS.ATTACK)};
export const signerFor = session => Object.values(S).find(s => s.sessionId === session) ?? S.ATTACK;
const entry = s => ({keyId: s.keyId, role: s.role, sessionId: s.sessionId, publicKeyPem: s.publicKeyPem});
export const ringFor = (domain = "uasco-v7") => parseKeyring({schema: KEYRING_SCHEMA, domain, keys: [entry(S.V41), entry(S.V2), entry(S.FOUNDER)]}, {kind: "TEST"});
/** Stand-in for the live gate verifier (gate-verifier.mjs has its own fixture tests): refuses missing/unshaped evidence. */
export const okGates = gates => {
  for (const g of REQUIRED_GATES) if (!gates?.[g]?.evidence) throw new Error(`GATE_${g.toUpperCase()}:EVIDENCE_SHAPE`);
  return {verified: gates};
};
export const LIVE = {base: null, prs: [], state: null};
export function bridgeFor(docStore, domain = "uasco-v7", o = {}) {
  return new AuthorityBridge({docStore, domain, keyring: () => ringFor(domain), gateVerifier: okGates,
    live: {canonicalSha: () => LIVE.base, openPrs: () => LIVE.prs, stateDigest: () => LIVE.state}, ...o});
}
/** Commit with live sources set from the given observation (the bridge reads them itself, never from commit's arguments). */
export function commitLive(b, {manifest, currentOpenPrs, currentBaseSha, currentStateDigest, v2Session}) {
  Object.assign(LIVE, {prs: currentOpenPrs, base: currentBaseSha, state: currentStateDigest});
  return b.commit({manifest, signer: signerFor(v2Session)});
}
