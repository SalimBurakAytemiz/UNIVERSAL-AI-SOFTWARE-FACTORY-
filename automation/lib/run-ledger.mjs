// //TR: Bu helper autonomous run için hash-chained event, redacted log, closure-critical artifact digest inventory ve Ed25519 sealed final summary üretir.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {redactText} from "./redaction.mjs";import {writeJsonAtomic,stableStringify} from "./atomic-json.mjs";import {RUNTIME_CONTRACT_VERSIONS} from "./runtime-contracts.mjs";import {verifyEvidence} from "./evidence-signing.mjs";
function safeStamp(){return new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)}
const fileSha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
export function inventoryRunArtifacts(dir){const out=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),rel=path.relative(dir,p).replaceAll("\\","/");if(e.isDirectory())walk(p);else if(e.isFile()&&rel!=="summary.json")out.push({path:rel,sha256:fileSha(p),bytes:fs.statSync(p).size})}}if(fs.existsSync(dir))walk(dir);return out.sort((a,b)=>a.path.localeCompare(b.path))}
export function createRunId(){return `RUN-${safeStamp()}-${crypto.randomBytes(4).toString("hex")}`}
export class RunLedger{
 constructor(root,runId,options={}){this.runId=runId;this.dir=path.join(root,runId);this.seq=0;this.prevEventHash=null;this.maxLogBytes=options.maxLogBytes??10*1024*1024;this.signingKeyFile=options.signingKeyFile??null;this.usageTotals={calls:0,promptBytes:0,outputBytes:0,approxTokens:0,durationMs:0};for(const d of [this.dir,path.join(this.dir,"logs"),path.join(this.dir,"review"),path.join(this.dir,"evidence")])fs.mkdirSync(d,{recursive:true})}
 event(stage,event,details={},severity="INFO",extra={}){const row={schemaVersion:RUNTIME_CONTRACT_VERSIONS.runEvent,runId:this.runId,sequence:++this.seq,timestamp:new Date().toISOString(),phase:extra.phase??null,milestoneId:extra.milestoneId??null,actor:extra.actor??null,stage,event,severity,durationMs:extra.durationMs??null,exitCode:extra.exitCode??null,details:JSON.parse(redactText(JSON.stringify(details))),artifactRefs:extra.artifactRefs??[],previousEventHash:this.prevEventHash};row.eventHash=crypto.createHash("sha256").update(stableStringify(row)).digest("hex");this.prevEventHash=row.eventHash;fs.appendFileSync(path.join(this.dir,"events.jsonl"),JSON.stringify(row)+"\n","utf8");return row}
 writeManifest(v){writeJsonAtomic(path.join(this.dir,"run-manifest.json"),v)}
 writeSummary(v){const payload={...v,runId:this.runId,finalEventHash:this.prevEventHash,eventCount:this.seq,usageTotals:this.usageTotals,artifactDigests:inventoryRunArtifacts(this.dir)};if(!this.signingKeyFile||!fs.existsSync(this.signingKeyFile))throw new Error("RUN_SUMMARY_SIGNING_KEY_MISSING");const key=fs.readFileSync(this.signingKeyFile);payload.sealAlgorithm="Ed25519";payload.sealSignature=crypto.sign(null,Buffer.from(stableStringify(payload)),key).toString("base64");writeJsonAtomic(path.join(this.dir,"summary.json"),payload);return payload}
 writeJson(rel,v){const f=path.join(this.dir,rel);fs.mkdirSync(path.dirname(f),{recursive:true});writeJsonAtomic(f,v);return f}
 logPath(n){return path.join(this.dir,"logs",n)}
 appendRedacted(n,text){const f=this.logPath(n),red=redactText(text);let existing=0;try{existing=fs.statSync(f).size}catch{};if(existing>=this.maxLogBytes)return;const bytes=Buffer.from(red,"utf8"),remaining=this.maxLogBytes-existing;fs.appendFileSync(f,bytes.subarray(0,remaining));if(bytes.length>remaining)fs.appendFileSync(f,"\n[LOG_TRUNCATED_BY_POLICY]\n","utf8")}
 usage(row){this.usageTotals.calls++;this.usageTotals.promptBytes+=Number(row.promptBytes??0);this.usageTotals.outputBytes+=Number(row.outputBytes??0);this.usageTotals.approxTokens+=Number(row.approxTokens??0);this.usageTotals.durationMs+=Number(row.durationMs??0);fs.appendFileSync(path.join(this.dir,"usage.jsonl"),JSON.stringify({timestamp:new Date().toISOString(),...row})+"\n");writeJsonAtomic(path.join(this.dir,"usage-summary.json"),this.usageTotals)}
}
function readJsonSafe(file){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return null}}
function signedSummary(dir,publicKeyFile){const file=path.join(dir,"summary.json"),s=readJsonSafe(file);if(!s||!s.sealSignature||!publicKeyFile||!fs.existsSync(publicKeyFile))return null;const copy={...s},sig=copy.sealSignature;delete copy.sealSignature;return verifyEvidence(copy,sig,publicKeyFile)?s:null}
export function exportRunEvidence(runDir,exportRoot){
  const runId=path.basename(runDir),target=path.join(exportRoot,runId);fs.mkdirSync(exportRoot,{recursive:true});fs.rmSync(target,{recursive:true,force:true});fs.cpSync(runDir,target,{recursive:true});
  const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),rel=path.relative(target,p).replaceAll("\\","/");if(rel==="EXPORT-MANIFEST.json")continue;if(e.isDirectory())walk(p);else if(e.isFile())files.push({path:rel,sha256:fileSha(p),bytes:fs.statSync(p).size})}}walk(target);
  const manifest={"//TR":"Bu export manifest retention öncesi kopyalanan run evidence dosyalarının digest inventory'sidir.",schemaVersion:"1.0.0",runId,exportedAt:new Date().toISOString(),files:files.sort((a,b)=>a.path.localeCompare(b.path))};writeJsonAtomic(path.join(target,"EXPORT-MANIFEST.json"),manifest);return {target,manifest};
}
function retentionDecision(runDir,policy,publicKeyFile){
  const hold=readJsonSafe(path.join(runDir,policy.manualHoldMarker??".release-evidence-hold.json"));if(hold&&hold.active!==false)return {critical:true,reason:"MANUAL_HOLD"};
  const summary=policy.requireSignedSummaryForAutomaticHold===false?readJsonSafe(path.join(runDir,"summary.json")):signedSummary(runDir,publicKeyFile);
  if(summary&&(policy.criticalSummaryStatuses??[]).includes(summary.status))return {critical:true,reason:`SIGNED_STATUS:${summary.status}`};
  return {critical:false,reason:null};
}
export function cleanupOldRuns(root,retentionDays=30,maxRuns=500,{policy=null,exportRoot=null,publicKeyFile=null}={}){
  if(!fs.existsSync(root))return {deleted:[],preserved:[],exported:[]};const dirs=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({path:path.join(root,x.name),mtime:fs.statSync(path.join(root,x.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime),cutoff=Date.now()-retentionDays*86400000,deleted=[],preserved=[],exported=[];
  for(const [i,d] of dirs.entries())if(i>=maxRuns||d.mtime<cutoff){
    if(policy){const decision=retentionDecision(d.path,policy,publicKeyFile);if(decision.critical){if(policy.autoExportCritical&&exportRoot){const ex=exportRunEvidence(d.path,exportRoot);exported.push(ex.target)}if(policy.deleteCriticalAfterExport!==true){preserved.push({runId:path.basename(d.path),reason:decision.reason});continue}}}
    try{fs.rmSync(d.path,{recursive:true,force:true});deleted.push(path.basename(d.path))}catch{}
  }
  return {deleted,preserved,exported};
}
