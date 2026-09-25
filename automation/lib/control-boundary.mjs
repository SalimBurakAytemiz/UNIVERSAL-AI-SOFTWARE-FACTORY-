// //TR: Bu helper Control API/Desktop güven sınırında port/origin, challenge-proof, token compare, IPC GET allowlist, runtime path containment ve trust-sensitive runtime artifact doğrulamasını tek yerde fail-closed uygular.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {stableStringify} from "./atomic-json.mjs";
import {verifyPhase0Acceptance} from "./phase0-contract.mjs";

const CONTROL_HOST="127.0.0.1";
const STATIC_GET_PATHS=new Set([
  "/health","/v1/factory","/v1/phase0","/v1/install","/v1/scheduler","/v1/agents","/v1/capabilities","/v1/fabrics","/v1/adapters","/v1/domains","/v1/control/status","/v1/retry","/v1/founder-attention","/v1/runs"
]);
const sha256=b=>crypto.createHash("sha256").update(b).digest("hex");
const under=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep);

export function parseControlPort(value,fallback=3210){
  const raw=value===undefined||value===null||value===""?String(fallback):String(value);
  if(!/^[1-9][0-9]{0,4}$/.test(raw))throw new Error("CONTROL_API_PORT_INVALID");
  const port=Number(raw);if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error("CONTROL_API_PORT_INVALID");return port;
}
export function controlOrigin(port){return `http://${CONTROL_HOST}:${parseControlPort(port)}`}
export function controlTokenFingerprint(token){return typeof token==="string"&&token.length?sha256(Buffer.from(token,"utf8")):null}
export function controlChallengeProof(token,challenge){
  if(typeof token!=="string"||!token||typeof challenge!=="string"||!/^[0-9a-f]{64}$/.test(challenge))return null;
  return crypto.createHmac("sha256",Buffer.from(token,"utf8")).update(challenge,"utf8").digest("hex");
}
export function secureStringEqual(a,b){
  if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);if(x.length!==y.length)return false;return crypto.timingSafeEqual(x,y);
}
export function hostHeaderAllowed(value,port){const expected=`${CONTROL_HOST}:${parseControlPort(port)}`;return typeof value==="string"&&value.toLowerCase()===expected}
export function desktopGetPathAllowed(value){
  if(typeof value!=="string")return false;if(STATIC_GET_PATHS.has(value))return true;
  if(/^\/v1\/runs\/RUN-[A-Za-z0-9-]+\/events$/.test(value))return true;
  if(/^\/v1\/runs\/RUN-[A-Za-z0-9-]+\/logs$/.test(value))return true;
  if(/^\/v1\/runs\/RUN-[A-Za-z0-9-]+\/logs\/[A-Za-z0-9._-]+\.log$/.test(value))return true;
  return false;
}
export function resolveExistingPathUnder(root,...parts){
  const lexicalRoot=path.resolve(root),candidate=path.resolve(lexicalRoot,...parts);if(!under(candidate,lexicalRoot))throw new Error("CONTROL_PATH_ESCAPE");
  if(!fs.existsSync(lexicalRoot)||!fs.existsSync(candidate))throw new Error("CONTROL_PATH_MISSING");if(fs.lstatSync(lexicalRoot).isSymbolicLink())throw new Error("CONTROL_ROOT_SYMLINK_DENIED");
  const rel=path.relative(lexicalRoot,candidate),segments=rel?rel.split(path.sep).filter(Boolean):[];let cur=lexicalRoot;
  for(const seg of segments){cur=path.join(cur,seg);const st=fs.lstatSync(cur);if(st.isSymbolicLink())throw new Error("CONTROL_PATH_SYMLINK_DENIED")}
  const realRoot=fs.realpathSync(lexicalRoot),realCandidate=fs.realpathSync(candidate);if(!under(realCandidate,realRoot))throw new Error("CONTROL_REALPATH_ESCAPE");return candidate;
}
export function resolveWritablePathUnder(root,...parts){
  const lexicalRoot=path.resolve(root),candidate=path.resolve(lexicalRoot,...parts);if(!under(candidate,lexicalRoot))throw new Error("CONTROL_PATH_ESCAPE");if(!fs.existsSync(lexicalRoot)||fs.lstatSync(lexicalRoot).isSymbolicLink())throw new Error("CONTROL_ROOT_UNSAFE");
  const parent=path.dirname(candidate);if(!fs.existsSync(parent))throw new Error("CONTROL_PARENT_MISSING");resolveExistingPathUnder(lexicalRoot,...path.relative(lexicalRoot,parent).split(path.sep).filter(Boolean));if(fs.existsSync(candidate)&&fs.lstatSync(candidate).isSymbolicLink())throw new Error("CONTROL_PATH_SYMLINK_DENIED");return candidate;
}

export function verifyPhase0ForControl(repoRoot,report){
  if(!report)return {ok:false,errors:["PHASE0_MISSING"]};const publicKeyFile=path.join(path.resolve(repoRoot),".ai/runtime/keys/evidence-ed25519-public.pem");
  return verifyPhase0Acceptance({repoRoot:path.resolve(repoRoot),report,publicKeyFile});
}
export function verifyInstallReportForControl(repoRoot,report,phase0){
  const errors=[];if(!report||typeof report!=="object")return {ok:false,errors:["INSTALL_REPORT_MISSING"]};if(report.schemaVersion!=="1.2.0")errors.push("INSTALL_REPORT_SCHEMA_VERSION_INVALID");
  const core={installId:report.installId,components:report.components,phase0Final:report.phase0Final,phase0SourceCommit:report.phase0SourceCommit,phase0SealSignature:report.phase0SealSignature};const expected=sha256(Buffer.from(stableStringify(core)));if(report.digest!==expected)errors.push("INSTALL_REPORT_DIGEST_INVALID");
  if(!phase0||!verifyPhase0ForControl(repoRoot,phase0).ok)errors.push("INSTALL_REPORT_PHASE0_NOT_VERIFIED");else{if(report.installId!==phase0.installId)errors.push("INSTALL_REPORT_INSTALL_ID_MISMATCH");if(report.phase0Final!==phase0.final)errors.push("INSTALL_REPORT_PHASE0_FINAL_MISMATCH");if(report.phase0SourceCommit!==phase0.sourceCommit)errors.push("INSTALL_REPORT_SOURCE_COMMIT_MISMATCH");if(report.phase0SealSignature!==phase0.sealSignature)errors.push("INSTALL_REPORT_PHASE0_SIGNATURE_MISMATCH")}
  const root=path.resolve(repoRoot),components=report.components&&typeof report.components==="object"?report.components:{};for(const [id,row] of Object.entries(components)){if(!row||typeof row!=="object"){errors.push(`INSTALL_COMPONENT_INVALID:${id}`);continue}const rel=String(row.file??"");if(!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).includes("..")){errors.push(`INSTALL_COMPONENT_PATH_INVALID:${id}`);continue}const file=path.resolve(root,rel);if(!under(file,root)){errors.push(`INSTALL_COMPONENT_PATH_ESCAPE:${id}`);continue}const exists=fs.existsSync(file);if(Boolean(row.present)!==exists){errors.push(`INSTALL_COMPONENT_PRESENCE_MISMATCH:${id}`);continue}if(exists){try{const safe=resolveExistingPathUnder(root,...rel.split(/[\\/]/).filter(Boolean)),actual=sha256(fs.readFileSync(safe));if(actual!==row.sha256)errors.push(`INSTALL_COMPONENT_DIGEST_MISMATCH:${id}`)}catch(e){errors.push(`${String(e.message??e)}:${id}`)}}else if(row.sha256!==null)errors.push(`INSTALL_COMPONENT_ABSENT_WITH_DIGEST:${id}`)}
  return {ok:errors.length===0,errors};
}
