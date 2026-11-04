// //TR: UASCO-T0050 / V3-AC-F023-1 gerileme koruması: gerçek dispatch.mjs + task-lease + git ref store (yalnız yerel geçici bare remote, ağ/ücret yok) ile refs/uasco/claims/* oluşturulduğunu, lease'in yalnız kayıt (log-only) olduğunu, çakışma girişimlerinin çıktıda loglandığını ve 7 günlük benzetimde çift claim = 0 olduğunu kanıtlar.
import {describe,it,expect,beforeAll,afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {claim,renew,release} from "../../automation/lib/task-lease.mjs";
import {createLocalGitRefStore} from "../../automation/lib/task-lease-git-store.mjs";

const DISPATCH=path.resolve("docs/planning/dispatch.mjs");
const GIT_ENV={GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@x",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@x"};
const G=(cwd:string,args:string[],env:Record<string,string>={})=>{const r=spawnSync("git",args,{cwd,encoding:"utf8",env:{...process.env,...GIT_ENV,...env}});if(r.status!==0)throw new Error(`git ${args.join(" ")}: ${r.stderr}`);return r.stdout.trim()};
const T=(id:string)=>({id,status:"READY",owner:"CLOUD",authorizedBy:"FOUNDER:test",dependsOn:[],protectedEdit:false,requiresNewAuthority:false});
type Env={bare:string;work:string;bl:string};
type Out={code:number|null;j:any;raw:string};
const parse=(stdout:string)=>{try{return JSON.parse(stdout.trim().split("\n").filter(Boolean).pop()??"")}catch{return null}};
const dispatch=(e:Env,args:string[]):Out=>{const r=spawnSync(process.execPath,[DISPATCH,...args,"--backlog",e.bl],{cwd:e.work,encoding:"utf8",env:{...process.env,...GIT_ENV}});return {code:r.status,j:parse(r.stdout),raw:r.stdout}};
type AsyncOut=Out&{startedAt:number;endedAt:number};
// spawn errors resolve (never hang); a run that outlives 60 s is killed and reported as code null; start/end times let races prove overlap
const dispatchAsync=(e:Env,args:string[])=>new Promise<AsyncOut>(res=>{
  const startedAt=Date.now();let out="",done=false;
  const finish=(code:number|null,extra="")=>{if(done)return;done=true;clearTimeout(timer);res({code,j:parse(out),raw:out+extra,startedAt,endedAt:Date.now()})};
  const c=spawn(process.execPath,[DISPATCH,...args,"--backlog",e.bl],{cwd:e.work,env:{...process.env,...GIT_ENV}});
  const timer=setTimeout(()=>{c.kill("SIGKILL");finish(null," [killed: 60 s timeout]")},60_000);
  c.on("error",err=>finish(null,` [spawn error: ${err.message}]`));c.stdout.on("data",d=>out+=d);c.on("close",code=>finish(code));
});
const overlapped=(rs:AsyncOut[])=>rs[0]!.startedAt<rs[1]!.endedAt&&rs[1]!.startedAt<rs[0]!.endedAt;
const claimRefs=(bare:string)=>G(bare,["for-each-ref","--format=%(refname)","refs/uasco/claims/"]).split("\n").filter(Boolean);
const heads=(bare:string)=>G(bare,["for-each-ref","--format=%(refname)","refs/heads/claude/"]).split("\n").filter(Boolean);
const leaseOn=(bare:string,id:string)=>JSON.parse(G(bare,["cat-file","blob",G(bare,["rev-parse",`refs/uasco/claims/${id}`])]));

export function registerLeaseClaimsCases():void{
  describe("UASCO-T0050 pkg-lease1: refs/uasco/claims/* lease, conflict logging, zero double claims (V3-AC-F023-1)",()=>{
    let root:string;let n=0;
    beforeAll(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-t0050-"))});
    afterAll(()=>{fs.rmSync(root,{recursive:true,force:true})});
    const mkEnv=(ids:string[]):Env=>{
      const dir=path.join(root,`e${++n}`),bare=path.join(dir,"remote.git"),work=path.join(dir,"work");fs.mkdirSync(dir);
      G(dir,["init","--bare","-q","-b","v7/integration",bare]);G(dir,["clone","-q",bare,work]);G(work,["checkout","-q","-b","v7/integration"]);
      fs.mkdirSync(path.join(work,"docs/planning"),{recursive:true});const bl=path.join(work,"docs/planning/BACKLOG_CHECKPOINT.json");
      fs.writeFileSync(bl,JSON.stringify({tasks:ids.map(T)}));fs.writeFileSync(path.join(work,"README"),"x");G(work,["add","-A"]);
      const d=`${Math.floor(Date.now()/1000)-30*86400} +0000`;G(work,["commit","-q","-m","base"],{GIT_COMMITTER_DATE:d,GIT_AUTHOR_DATE:d});G(work,["push","-q","origin","v7/integration"]);
      return {bare,work,bl};
    };

    it("--claim records the lease as refs/uasco/claims/<id> next to the create-only branch claim",()=>{
      const e=mkEnv(["L-1","L-2"]);
      expect(claimRefs(e.bare)).toEqual([]);
      const r=dispatch(e,["--claim","--owner","cloud-a"]);
      expect(r.code,r.raw).toBe(0);
      expect(r.j).toMatchObject({outcome:"START",taskId:"L-1",claimed:true,claimRef:"refs/heads/claude/l-1",lease:{status:"GRANTED"}});
      expect(claimRefs(e.bare)).toEqual(["refs/uasco/claims/L-1"]);
      expect(heads(e.bare)).toEqual(["refs/heads/claude/l-1"]);
      const rec=leaseOn(e.bare,"L-1");
      expect(rec).toMatchObject({taskId:"L-1",environment:"CLOUD",workerId:"cloud-a",epoch:1});
      expect(rec.token).toBe(r.j.lease.token);
      expect(rec.expiresAt-rec.acquiredAt).toBe(6*36e5); // default --stale-hours 6
      // a second run advances to the next task and records its own lease; the first lease is untouched
      const r2=dispatch(e,["--claim","--owner","cloud-b"]);
      expect(r2.j).toMatchObject({outcome:"START",taskId:"L-2",lease:{status:"GRANTED"}});
      expect(claimRefs(e.bare)).toEqual(["refs/uasco/claims/L-1","refs/uasco/claims/L-2"]);
      expect(leaseOn(e.bare,"L-1").token).toBe(rec.token);
    },120_000);

    it("log-only: --no-lease claims without writing refs/uasco/claims/*; the branch ref stays the gate",()=>{
      const e=mkEnv(["N-1"]);
      const r=dispatch(e,["--claim","--no-lease"]);
      expect(r.j).toMatchObject({outcome:"START",taskId:"N-1",claimed:true,lease:{status:"SKIPPED"}});
      expect(claimRefs(e.bare)).toEqual([]);
      expect(heads(e.bare)).toEqual(["refs/heads/claude/n-1"]);
    },120_000);

    it("conflict attempts are logged: a lease held by another environment is reported as <id>:LEASE_HELD and not claimed",()=>{
      const e=mkEnv(["C-1","C-2"]);
      const other=claim(createLocalGitRefStore({repoDir:e.bare}),{taskId:"C-1",environment:"LOCAL_WINDOWS",workerId:"w-win",sessionId:"s-win",headSha:"a".repeat(40),now:Date.now(),ttlMs:6*36e5});
      expect(other.status).toBe("GRANTED");
      const r=dispatch(e,["--claim","--owner","cloud-a"]);
      expect(r.j).toMatchObject({outcome:"START",taskId:"C-2",lease:{status:"GRANTED"}});
      expect(r.j.reasons).toContain("C-1:LEASE_HELD");
      expect(heads(e.bare)).toEqual(["refs/heads/claude/c-2"]);
      expect(leaseOn(e.bare,"C-1")).toMatchObject({environment:"LOCAL_WINDOWS",workerId:"w-win",token:other.record!.token,epoch:1});
      // the branch-level conflict is logged as well: once both are taken nothing is offered, and each reason names the task
      const r3=dispatch(e,["--claim","--owner","cloud-b"]);
      expect(r3.j.outcome).toBe("NO_ACTION");
      expect(r3.j.reasons).toEqual(expect.arrayContaining(["C-1:LEASE_HELD","C-2:ALREADY_CLAIMED"]));
      expect(heads(e.bare)).toEqual(["refs/heads/claude/c-2"]);
    },120_000);

    it("race: two concurrent --claim processes on one task -> exactly one START, one lease ref, one branch",async()=>{
      for(let round=0;round<3;round++){
        const e=mkEnv(["R-1"]);
        const rs=await Promise.all(["w1","w2"].map(o=>dispatchAsync(e,["--claim","--owner",o])));
        expect(overlapped(rs),"the two claim processes ran concurrently").toBe(true);
        const starts=rs.filter(r=>r.j?.outcome==="START"&&r.j.claimed===true);
        expect(starts.length,rs.map(r=>r.raw).join(" | ")).toBe(1);
        expect(rs.filter(r=>r.j?.outcome==="NO_ACTION").length).toBe(1);
        expect(claimRefs(e.bare)).toEqual(["refs/uasco/claims/R-1"]);
        expect(heads(e.bare)).toEqual(["refs/heads/claude/r-1"]);
        expect(leaseOn(e.bare,"R-1").token).toBe(starts[0]!.j.lease.token);
      }
    },120_000);
    it("log-only race: with --no-lease the create-only branch push alone keeps it to one START per task",async()=>{
      for(let round=0;round<6;round++){
        const e=mkEnv(["Q-1"]);
        const rs=await Promise.all(["w1","w2"].map(o=>dispatchAsync(e,["--claim","--no-lease","--owner",o])));
        expect(overlapped(rs),"the two claim processes ran concurrently").toBe(true);
        expect(rs.filter(r=>r.j?.outcome==="START"&&r.j.claimed===true).length,rs.map(r=>r.raw).join(" | ")).toBe(1);
        expect(heads(e.bare)).toEqual(["refs/heads/claude/q-1"]);
        expect(claimRefs(e.bare)).toEqual([]);
      }
    },180_000);

    it("7 simulated days, 3 workers in 2 environments, 2 tasks over a real git ref store: double claims = 0",()=>{
      const repo=path.join(root,"sim");fs.mkdirSync(repo);G(repo,["init","-q"]);
      const store=createLocalGitRefStore({repoDir:repo});
      const W=[{environment:"CLOUD",workerId:"w-a",sessionId:"s-a"},{environment:"LOCAL_WINDOWS",workerId:"w-b",sessionId:"s-b"},{environment:"CLOUD",workerId:"w-c",sessionId:"s-c"}];
      const TASKS=["S-1","S-2"],TTL=6*36e5,STEP=3*36e5,DAYS=7;
      let seed=0x2f6b;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x80000000};
      const oracle=new Map<string,{w:number;token:string;expiresAt:number}|null>();
      const tokens=new Map<string,string>(); // `${task}|${w}` -> token the worker believes it holds
      const pausedUntil=new Map<string,number>(); // zombie holders: keep their token, wake up after their own TTL has run out
      let grants=0,held=0,renewed=0,released=0,takeovers=0,doubleClaims=0,paused=0,lost=0,zombieNoop=0,zombieRenewed=0;
      for(let t=0;t<=DAYS*24*36e5;t+=STEP){
        for(const task of TASKS)for(let w=0;w<W.length;w++){
          const now=t+w*60000,key=`${task}|${w}`,id={taskId:task,...W[w]!},cur=oracle.get(task)??null,mine=tokens.get(key);
          const wake=pausedUntil.get(key);
          if(wake!==undefined&&now<wake)continue; // still paused: no heartbeat, no claim
          if(mine){
            const stillMine=cur?.token===mine; // per the oracle: nobody took over while we were away
            if(wake!==undefined){
              // zombie wake-up (paused past its own TTL): it may renew/release only if nobody took over; otherwise LOST / NOOP
              pausedUntil.delete(key);
              if(rnd()<0.5){
                const r=renew(store,{...id,token:mine,now,ttlMs:TTL});
                expect(r.status,`zombie renew ${task} w${w} t=${now}`).toBe(stillMine?"RENEWED":"LOST");
                if(r.status==="RENEWED"){zombieRenewed++;oracle.set(task,{w,token:mine,expiresAt:now+TTL})}else{lost++;tokens.delete(key)}
              }else{
                const r=release(store,{...id,token:mine});tokens.delete(key);
                expect(r.status,`zombie release ${task} w${w} t=${now}`).toBe(stillMine?"RELEASED":"NOOP");
                if(r.status==="RELEASED"){released++;oracle.set(task,null)}else zombieNoop++;
              }
              const rec=store.read(task);expect(rec?.token??null).toBe(oracle.get(task)?.token??null);
              continue;
            }
            const p=rnd();
            if(p<0.10){tokens.delete(key);continue} // crash: forgets the token, lease must expire before anyone else gets it
            if(p<0.25){paused++;pausedUntil.set(key,now+TTL+STEP);continue} // pause: keeps the token, sleeps past its TTL
            if(p<0.35){const r=release(store,{...id,token:mine});tokens.delete(key);expect(r.status).toBe("RELEASED");released++;oracle.set(task,null);continue}
            const r=renew(store,{...id,token:mine,now,ttlMs:TTL});
            expect(r.status,`live renew ${task} w${w} t=${now}`).toBe("RENEWED"); // heartbeats every STEP < TTL never lose a live lease
            renewed++;oracle.set(task,{w,token:mine,expiresAt:now+TTL});
            continue;
          }
          if(rnd()<0.5)continue;
          const r=claim(store,{...id,headSha:"b".repeat(40),now,ttlMs:TTL});
          if(r.status==="GRANTED"){
            grants++;
            if(cur&&cur.w!==w&&now<=cur.expiresAt)doubleClaims++; // someone else's lease was still live
            if(cur&&cur.w!==w)takeovers++;
            const g=r.record!;
            if(cur&&cur.w===w&&cur.token!==g.token){
              // the same worker re-took its own expired lease under a NEW token: its previous grant's token must no longer renew it
              expect(renew(store,{...id,token:cur.token,now,ttlMs:TTL}).status,`stale-token renew ${task} w${w}`).toBe("LOST");
            }tokens.set(key,g.token);oracle.set(task,{w,token:g.token,expiresAt:g.expiresAt});
          }else{held++;expect(cur&&now<=cur.expiresAt&&cur.w!==w,`HELD only while another live lease exists (${task} t=${now})`).toBe(true)}
          const rec=store.read(task);expect(rec?.token??null).toBe(oracle.get(task)?.token??null);
        }
      }
      expect(doubleClaims).toBe(0);
      // the schedule really exercised conflicts, expiry takeovers, renewals, releases, pauses and zombie losses (not a vacuous run)
      for(const [k,v] of Object.entries({grants,held,renewed,released,takeovers,paused,lost,zombieNoop}))expect(v,k).toBeGreaterThan(0);
    },180_000);

    it("same worker, stale token: after re-taking its own expired lease, the previous grant's token can neither renew nor release it",()=>{
      const repo=path.join(root,"stale");fs.mkdirSync(repo);G(repo,["init","-q"]);
      const store=createLocalGitRefStore({repoDir:repo}),TTL=6*36e5,id={taskId:"Z-1",environment:"CLOUD",workerId:"w-z",sessionId:"s-z"};
      const first=claim(store,{...id,now:0,ttlMs:TTL});expect(first.status).toBe("GRANTED");
      const second=claim(store,{...id,now:TTL+1,ttlMs:TTL}); // the old grant expired unrenewed: a fresh grant, new token, epoch 2
      expect(second).toMatchObject({status:"GRANTED",record:{epoch:2}});
      const oldTok=first.record!.token,newTok=second.record!.token;expect(newTok).not.toBe(oldTok);
      expect(renew(store,{...id,token:oldTok,now:TTL+2,ttlMs:TTL}).status).toBe("LOST");
      expect(release(store,{...id,token:oldTok}).status).toBe("NOOP");
      expect(store.read("Z-1")?.token).toBe(newTok);
      expect(renew(store,{...id,token:newTok,now:TTL+3,ttlMs:TTL})).toMatchObject({status:"RENEWED",record:{token:newTok,expiresAt:2*TTL+3}});
      expect(release(store,{...id,token:newTok}).status).toBe("RELEASED");
      expect(store.read("Z-1")).toBeNull();
    },60_000);
  });
}
