// //TR: Bu modül task-lease Store sözleşmesini gerçek git ref'leriyle atomik yapar: local backend `update-ref` (old=0000… create-if-absent, old=sha CAS) kullanır, remote backend enjekte edilen runGit ile push/--force-with-lease kullanır; atomiklik JS kilidinden değil git'in ref kilidinden gelir.
// RUNTIME NOTE: createRemoteRefStore against the real origin creates live `refs/uasco/claims/*` refs; that activation is a runtime step and is NOT exercised by tests (tests inject a fake runGit).
import {spawnSync} from "node:child_process";
const ZERO="0".repeat(40),PREFIX="refs/uasco/claims/";
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const refOf=(prefix,id)=>{if(typeof id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)||id.includes("..")||id.endsWith(".lock")||id.endsWith("."))throw new Error(`LEASE_TASK_ID_INVALID:${id}`);return prefix+id};
const parse=s=>{try{return JSON.parse(s)}catch{return null}};
// Shared store logic over backend ops: {git(args,input)->{status,stdout}, sha(ref)->sha|null, put(ref,newSha,oldSha|null)->bool (null = must not exist), del(ref,oldSha)->bool}.
function makeStore(prefix,ops){
  const blob=rec=>{const r=ops.git(["hash-object","-w","--stdin"],JSON.stringify(rec));if(r.status!==0)throw new Error("LEASE_BLOB_WRITE_FAILED");return r.stdout.trim()};
  const load=ref=>{const sha=ops.sha(ref);if(!sha)return {sha:null,rec:null};const r=ops.git(["cat-file","blob",sha]);return {sha,rec:r.status===0?parse(r.stdout):null}};
  return {read:id=>load(refOf(prefix,id)).rec,
    // a loser can briefly observe "absent" while the winner holds the ref lock; retry reads, then fail closed (created:false,current:null).
    createIfAbsent(id,rec){const ref=refOf(prefix,id);if(ops.put(ref,blob(rec),null))return {created:true,current:rec};
      for(let i=0;i<40;i++){const c=load(ref).rec;if(c)return {created:false,current:c};sleep(5)}return {created:false,current:null}},
    cas(id,tok,rec){const ref=refOf(prefix,id),c=load(ref);if(!c.rec||c.rec.token!==tok)return {ok:false,current:c.rec};return ops.put(ref,blob(rec),c.sha)?{ok:true,current:rec}:{ok:false,current:load(ref).rec}},
    remove(id,tok){const ref=refOf(prefix,id),c=load(ref);if(!c.rec||c.rec.token!==tok)return {ok:false};return {ok:ops.del(ref,c.sha)}}}}
export function createLocalGitRefStore({repoDir,refPrefix=PREFIX}={}){
  if(!repoDir)throw new Error("LEASE_REPO_DIR_REQUIRED");
  const git=(args,input)=>{const r=spawnSync("git",args,{cwd:repoDir,input,encoding:"utf8",windowsHide:true});return {status:r.status??1,stdout:r.stdout??"",stderr:r.stderr??""}};
  return makeStore(refPrefix,{git,sha:ref=>{const r=git(["rev-parse","--verify","-q",ref]);return r.status===0?r.stdout.trim():null},
    put:(ref,n,o)=>git(["update-ref",ref,n,o??ZERO]).status===0,del:(ref,o)=>git(["update-ref","-d",ref,o]).status===0})}
// runGit(args,input?) -> {status,stdout,stderr}: injected (real impl runs git in a clone whose `remote` is the shared origin).
// create-if-absent = `push --force-with-lease=<ref>:` (empty expected value = ref must not exist); CAS = `--force-with-lease=<ref>:<oldSha>`.
export function createRemoteRefStore({runGit,remote="origin",refPrefix=PREFIX}={}){
  if(typeof runGit!=="function")throw new Error("LEASE_RUNGIT_REQUIRED");
  const sha=ref=>{const r=runGit(["ls-remote",remote,ref]);if(r.status!==0)return null;const l=r.stdout.split("\n").map(x=>x.trim().split(/\s+/)).find(p=>p[1]===ref);return l&&runGit(["fetch","--no-tags",remote,ref]).status===0?l[0]:null};
  return makeStore(refPrefix,{git:runGit,sha,
    put:(ref,n,o)=>runGit(["push",remote,`${n}:${ref}`,`--force-with-lease=${ref}:${o??""}`]).status===0,
    del:(ref,o)=>runGit(["push",remote,`:${ref}`,`--force-with-lease=${ref}:${o}`]).status===0})}
