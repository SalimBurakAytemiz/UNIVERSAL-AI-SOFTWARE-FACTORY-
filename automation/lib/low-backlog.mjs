// //TR: Bu helper P3/LOW review bulgularını remediation döngüsünü tüketmeden durable fingerprint/dedupe backlog'a yazar.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {writeJsonAtomic} from "./atomic-json.mjs";
const digest=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
export function persistLowBacklog(file,findings=[],meta={}){
 const current=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{"//TR":"Bu runtime ledger P3/LOW bulguları remediation cycle tüketmeden durable biçimde saklar.",schemaVersion:"1.0.0",entries:[]};
 const byFingerprint=new Map((current.entries??[]).map(x=>[x.fingerprint,x]));
 for(const f of findings.filter(x=>x?.severity==="P3")){
   const fingerprint=f.fingerprint||digest({category:f.category??"",basis:[...(f.basisRefs??[])].sort(),file:f.file??"",symbol:f.symbol??"",expected:f.expected??"",observed:f.observed??""});
   const prior=byFingerprint.get(fingerprint);const now=new Date().toISOString();
   byFingerprint.set(fingerprint,{fingerprint,findingId:f.id??prior?.findingId??null,severity:"P3",classification:"ADVISORY",category:f.category??null,file:f.file??null,basisRefs:f.basisRefs??[],packageId:meta.packageId??prior?.packageId??null,runId:meta.runId??prior?.runId??null,reviewedCommit:meta.reviewedCommit??prior?.reviewedCommit??null,cycle:meta.cycle??prior?.cycle??null,firstSeenAt:prior?.firstSeenAt??now,lastSeenAt:now,occurrences:(prior?.occurrences??0)+1});
 }
 current.entries=[...byFingerprint.values()].sort((a,b)=>String(a.fingerprint).localeCompare(String(b.fingerprint)));current.updatedAt=new Date().toISOString();
 fs.mkdirSync(path.dirname(file),{recursive:true});writeJsonAtomic(file,current);return current;
}
