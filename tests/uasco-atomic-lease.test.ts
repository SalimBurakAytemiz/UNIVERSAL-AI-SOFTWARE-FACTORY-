// //TR: Bu test ortamlar arası atomik görev kirasının kanıtıdır: 16 gerçek worker_thread aynı task'ı gerçek git ref store üzerinden yarıştırır ve tam 1 GRANTED / 15 HELD beklenir; ayrıca TTL/takeover, renew/release, fake remote CAS ve SHA+session bağlı verdict reddi doğrulanır.
import {describe,it,expect,beforeAll,afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {pathToFileURL} from "node:url";
import {Worker} from "node:worker_threads";
import {claim,renew,release,isExpired,type LeaseStore} from "../automation/lib/task-lease.mjs";
import {createLocalGitRefStore,createRemoteRefStore} from "../automation/lib/task-lease-git-store.mjs";
import {bindVerdict,verifyVerdict} from "../automation/lib/lease-verdict.mjs";
const LIB=(f:string)=>pathToFileURL(path.resolve("automation/lib",f)).href;
const mkRepo=()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-lease-"));cp.execFileSync("git",["init","-q"],{cwd:d});return d};
const A=(o:Record<string,unknown>={})=>({taskId:"T-1",environment:"cloud-linux",workerId:"w-a",sessionId:"s-a",headSha:"a".repeat(40),now:1000,ttlMs:100,...o}) as any;
const B=(o:Record<string,unknown>={})=>A({environment:"local-windows",workerId:"w-b",sessionId:"s-b",...o});
// worker code runs claim() through the git-ref store; git's ref lock is the only arbiter
const WORKER=`const {workerData:w,parentPort}=require("node:worker_threads");(async()=>{const {claim}=await import(w.lease);const {createLocalGitRefStore}=await import(w.gstore);const store=createLocalGitRefStore({repoDir:w.repoDir});Atomics.add(new Int32Array(w.sab),0,1);while(Atomics.load(new Int32Array(w.sab),1)===0)Atomics.wait(new Int32Array(w.sab),1,0,50);const r=claim(store,{taskId:w.taskId,environment:w.i%2?"cloud-linux":"local-windows",workerId:"w"+w.i,sessionId:"s"+w.i,headSha:"f".repeat(40),now:5000,ttlMs:60000});parentPort.postMessage({i:w.i,status:r.status,epoch:r.record?.epoch??null})})().catch(e=>parentPort.postMessage({err:String(e)}));`;
describe("atomic cross-environment task lease",()=>{
  let repo:string;beforeAll(()=>{repo=mkRepo()});afterAll(()=>{fs.rmSync(repo,{recursive:true,force:true})});
  it("RACE: 16 real worker_threads claim one task through the git-ref store -> exactly 1 GRANTED, 15 HELD",async()=>{
    const N=16,sab=new SharedArrayBuffer(8),ctl=new Int32Array(sab);
    const ws=Array.from({length:N},(_,i)=>new Worker(WORKER,{eval:true,workerData:{i,sab,repoDir:repo,taskId:"RACE-1",lease:LIB("task-lease.mjs"),gstore:LIB("task-lease-git-store.mjs")}}));
    const done=ws.map(w=>new Promise<any>((res,rej)=>{w.once("message",res);w.once("error",rej)}));
    const t0=Date.now();while(Atomics.load(ctl,0)<N&&Date.now()-t0<30000)await new Promise(r=>setTimeout(r,10));
    expect(Atomics.load(ctl,0),"all workers ready").toBe(N);Atomics.store(ctl,1,1);Atomics.notify(ctl,1);
    const out=await Promise.all(done);await Promise.all(ws.map(w=>w.terminate()));
    expect(out.filter(o=>o.err)).toEqual([]);
    expect(out.filter(o=>o.status==="GRANTED").length).toBe(1);expect(out.filter(o=>o.status==="HELD").length).toBe(N-1);
    const holder=createLocalGitRefStore({repoDir:repo}).read("RACE-1")!,winner=out.find(o=>o.status==="GRANTED");
    expect(holder.workerId).toBe("w"+winner.i);expect(holder.epoch).toBe(1);
  },60000);
  it("TTL: unexpired claim is HELD for others; after expiry a second claimant is GRANTED with epoch+1",()=>{
    const s=createLocalGitRefStore({repoDir:repo}),g=claim(s,A({taskId:"TTL-1"}));expect(g.status).toBe("GRANTED");expect(g.record!.epoch).toBe(1);
    expect(claim(s,B({taskId:"TTL-1",now:1100})).status).toBe("HELD");expect(isExpired(g.record,1100)).toBe(false);
    const r=claim(s,B({taskId:"TTL-1",now:1101}));expect(r.status).toBe("GRANTED");expect(r.record!.epoch).toBe(2);expect(r.previous!.token).toBe(g.record!.token);expect(r.record!.token).not.toBe(g.record!.token);
  });
  it("same owner re-claim is idempotent GRANTED (same token); renew keeps ownership; reclaimed owner gets LOST",()=>{
    const s=createLocalGitRefStore({repoDir:repo}),g=claim(s,A({taskId:"REN-1"}));
    expect(claim(s,A({taskId:"REN-1",now:1050})).record!.token).toBe(g.record!.token);
    const r=renew(s,A({taskId:"REN-1",now:1090}));expect(r.status).toBe("RENEWED");expect(s.read("REN-1")!.expiresAt).toBe(1190);expect(claim(s,B({taskId:"REN-1",now:1150})).status).toBe("HELD");
    expect(claim(s,B({taskId:"REN-1",now:1191})).status).toBe("GRANTED");
    expect(renew(s,A({taskId:"REN-1",now:1192})).status).toBe("LOST");expect(s.read("REN-1")!.workerId).toBe("w-b");
  });
  it("release frees the lease; non-owner release is NOOP",()=>{
    const s=createLocalGitRefStore({repoDir:repo});claim(s,A({taskId:"REL-1"}));
    expect(release(s,B({taskId:"REL-1"})).status).toBe("NOOP");expect(s.read("REL-1")).not.toBeNull();
    expect(release(s,A({taskId:"REL-1"})).status).toBe("RELEASED");expect(s.read("REL-1")).toBeNull();expect(release(s,A({taskId:"REL-1"})).status).toBe("NOOP");
    expect(claim(s,B({taskId:"REL-1",now:1001})).status).toBe("GRANTED");
  });
  it("git store cas/remove reject a stale token and invalid task ids are refused",()=>{
    const s=createLocalGitRefStore({repoDir:repo}),g=claim(s,A({taskId:"CAS-1"})).record!;
    expect(s.cas("CAS-1","wrong",{...g,token:"x"}).ok).toBe(false);expect(s.remove("CAS-1","wrong").ok).toBe(false);expect(s.read("CAS-1")!.token).toBe(g.token);
    expect(()=>s.read("../evil")).toThrow(/LEASE_TASK_ID_INVALID/);expect(()=>s.read("a b")).toThrow(/LEASE_TASK_ID_INVALID/);
  });
  describe("remote ref store (fake runGit, no network)",()=>{
    // in-memory fake of the git remote: models ls-remote / fetch / hash-object / cat-file / push --force-with-lease
    const mkFake=()=>{const objs=new Map<string,string>(),refs=new Map<string,string>(),log:string[][]=[];let n=0;
      const runGit=(args:string[],input?:string)=>{log.push(args);const [c]=args;
        if(c==="hash-object"){const sha=String(++n).padStart(40,"0");objs.set(sha,input!);return {status:0,stdout:sha+"\n"}}
        if(c==="cat-file")return objs.has(args[2])?{status:0,stdout:objs.get(args[2])!}:{status:128,stdout:""};
        if(c==="ls-remote")return refs.has(args[2])?{status:0,stdout:`${refs.get(args[2])}\t${args[2]}\n`}:{status:0,stdout:""};
        if(c==="fetch")return {status:refs.has(args[3])?0:1,stdout:""};
        if(c==="push"){const [sha,ref]=args[2].split(":"),m=/^--force-with-lease=(.+?):(.*)$/.exec(args[3])!,exp=m[2],cur=refs.get(m[1])??"";
          if(exp!==cur)return {status:1,stdout:""};if(sha)refs.set(ref,sha);else refs.delete(ref);return {status:0,stdout:""}}
        return {status:1,stdout:""}};return {runGit,refs,log}};
    it("createIfAbsent wins once; second is created:false; cas with wrong old value is ok:false",()=>{
      const f=mkFake(),s=createRemoteRefStore({runGit:f.runGit});
      const rec=(tok:string)=>({taskId:"R-1",environment:"e",workerId:"w",sessionId:"s",headSha:null,epoch:1,token:tok,acquiredAt:1,heartbeatAt:1,expiresAt:99});
      expect(s.createIfAbsent("R-1",rec("t1")).created).toBe(true);
      const second=s.createIfAbsent("R-1",rec("t2"));expect(second.created).toBe(false);expect(second.current!.token).toBe("t1");
      expect(s.cas("R-1","stale",rec("t3")).ok).toBe(false);expect(s.read("R-1")!.token).toBe("t1");
      // lost update at the ref level: the lease check fails when the remote ref moved after we read it
      const lease=f.log.filter(a=>a[0]==="push").map(a=>a[3]);expect(lease[0]).toBe("--force-with-lease=refs/uasco/claims/R-1:");
      expect(s.cas("R-1","t1",rec("t4")).ok).toBe(true);expect(s.read("R-1")!.token).toBe("t4");
      expect(s.remove("R-1","t1").ok).toBe(false);expect(s.remove("R-1","t4").ok).toBe(true);expect(s.read("R-1")).toBeNull();
    });
    it("claim over the fake remote: first GRANTED, second HELD, expired takeover GRANTED",()=>{
      const f=mkFake(),s=createRemoteRefStore({runGit:f.runGit});
      expect(claim(s,A({taskId:"R-2"})).status).toBe("GRANTED");expect(claim(s,B({taskId:"R-2",now:1010})).status).toBe("HELD");
      expect(claim(s,B({taskId:"R-2",now:2000})).record!.epoch).toBe(2);
    });
  });
});
describe("SHA + session bound reviewer verdict",()=>{
  const SHA="c".repeat(40),base={taskId:"T-1",reviewedSha:SHA,reviewerSessionId:"rev-1",implementerSessionId:"impl-1",result:"CLEAN",reviewerIdentity:"CLAUDE_REVIEWER",builderIdentity:"CLAUDE_BUILDER"};
  const opts={expectedHeadSha:SHA,implementerSessionId:"impl-1"};
  it("accepts only a CLEAN, SHA-matching, independent verdict",()=>{const v=bindVerdict(base);expect(Object.isFrozen(v)).toBe(true);expect(verifyVerdict(v,opts)).toEqual({ok:true,reason:"OK"})});
  it("rejects STALE_SHA",()=>expect(verifyVerdict(bindVerdict({...base,reviewedSha:"d".repeat(40)}),opts)).toEqual({ok:false,reason:"STALE_SHA"}));
  it("rejects NOT_INDEPENDENT (reviewer session == implementer session, recorded or expected)",()=>{
    expect(verifyVerdict(bindVerdict({...base,reviewerSessionId:"impl-1"}),opts).reason).toBe("NOT_INDEPENDENT");
    expect(verifyVerdict(bindVerdict({...base,implementerSessionId:"other",reviewerSessionId:"impl-1"}),opts).reason).toBe("NOT_INDEPENDENT")});
  it("rejects SAME_IDENTITY",()=>expect(verifyVerdict(bindVerdict({...base,reviewerIdentity:"X",builderIdentity:"X"}),opts).reason).toBe("SAME_IDENTITY"));
  it("rejects every non-CLEAN result",()=>{for(const r of ["BLOCKED","INCONCLUSIVE","INVALID"])expect(verifyVerdict(bindVerdict({...base,result:r}),opts)).toEqual({ok:false,reason:`NOT_CLEAN:${r}`})});
  it("bindVerdict refuses unknown results and missing fields; null verdict is rejected",()=>{expect(()=>bindVerdict({...base,result:"OK"})).toThrow(/VERDICT_RESULT_INVALID/);expect(()=>bindVerdict({...base,reviewedSha:""})).toThrow(/VERDICT_ARG_MISSING/);expect(verifyVerdict(null,opts).ok).toBe(false)});
});
