// //TR: Bu test GOV2 Codex review emekliliğinin fail-closed kurallarını doğrular: eski ürün supervisor'ı hiçbir şey yapmadan 64 koduyla çıkar, sarmalayıcı/otomatik başlatma betikleri ve control-api hiçbir inceleme yolu başlatmaz, etkin kapı yokken gerekli reviewer yoktur ve hiçbir şey CLEAN olmaz, provenance final'i yalnız Claude'a bağlıdır, execution routing bağımsız reviewer kimliğinin üretici kimliklerinden farklı olmasını ister.
import {describe,expect,it,vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const repo=process.cwd(),node=process.execPath;
const run=(code:string)=>{const r=cp.spawnSync(node,["--input-type=module","-e",code],{cwd:repo,encoding:"utf8"});return {status:r.status,out:(r.stdout??"").trim(),err:(r.stderr??"").trim()}};
describe("GOV2 Codex review retirement",()=>{
  it("retires the legacy product supervisor fail-closed without touching any state",()=>{
    const st=()=>cp.spawnSync("git",["status","--porcelain"],{cwd:repo,encoding:"utf8"}).stdout;const before=st();
    const r=cp.spawnSync(node,[path.join(repo,"automation/factory-supervisor.mjs")],{cwd:repo,encoding:"utf8",timeout:60000});
    expect(r.status).toBe(64);expect(r.stderr).toContain("LEGACY_CODEX_REVIEW_PATH_RETIRED");expect(st()).toBe(before);
    const src=fs.readFileSync(path.join(repo,"automation/factory-supervisor.mjs"),"utf8").split("\n");expect(src.findIndex(l=>l.includes("process.exit(64)"))).toBeLessThan(src.findIndex(l=>l.startsWith("import fs")));
  },70000);
  it("makes the wrapper and autostart scripts and the control-api refuse to start the legacy path",()=>{
    for(const f of ["scripts/start-full-auto.ps1","scripts/register-autostart.ps1"]){const t=fs.readFileSync(path.join(repo,f),"utf8");const lines=t.split(/\r?\n/);const i=lines.findIndex(l=>l.startsWith("throw "));expect(i).toBeGreaterThan(0);expect(lines[i]).toContain("LEGACY_CODEX_REVIEW_PATH_RETIRED");expect(lines.slice(0,i).some(l=>/Register-ScheduledTask|factory-supervisor|Start-Process/.test(l))).toBe(false)}
    const server=fs.readFileSync(path.join(repo,"apps/control-api/src/server.ts"),"utf8");const m=/function startSupervisorDetached\(\)\{\s*return \{started:false,reason:"LEGACY_CODEX_REVIEW_PATH_RETIRED"\};/.exec(server);expect(m).not.toBeNull();
    const install=fs.readFileSync(path.join(repo,"scripts/install.ps1"),"utf8");expect(install).not.toContain("register-autostart.ps1");expect(install).toContain("LEGACY_CODEX_REVIEW_PATH_RETIRED");
    if(process.platform==="win32"){const r=cp.spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(repo,"scripts/register-autostart.ps1"),"-RepoPath",repo],{cwd:repo,encoding:"utf8",timeout:60000});expect(r.status).not.toBe(0);expect(`${r.stderr}${r.stdout}`).toContain("LEGACY_CODEX_REVIEW_PATH_RETIRED")}
  },70000);
  it("has no required reviewer without an active gate and never returns a CLEAN aggregate for an empty set",()=>{
    const r=run(`import * as q from "./automation/lib/review-quorum.mjs";const g={providers:{claude:{status:"CLEAN"},codex:{status:"CLEAN"}}};const dual={dualReview:{active:true}};console.log(JSON.stringify({a:q.requiredReviewers({reviewPolicy:"DUAL"},dual),b:q.requiredReviewers({},{}),c:q.requiredReviewers({reviewPolicy:"CODEX_ONLY_HISTORICAL"},dual),agg:q.computeReviewAggregate(g,[]).result,sat:q.reviewSatisfiesGate({bundle:{digest:"x"},review:{result:"CLEAN",dual:true,dualReviewClean:true,bundleDigest:"x"}},dual),honoured:q.honouredBlockers({reviewGate:{active:true,model:"CLAUDE_ONLY",required:["claude"],codexRequired:false}})}))`);
    expect(r.status).toBe(0);const o=JSON.parse(r.out);expect(o.a).toEqual([]);expect(o.b).toEqual([]);expect(o.c).toEqual([]);expect(o.agg).toBe("INVALID");expect(o.sat).toBe(false);expect(o.honoured).toEqual(["codex"]);
  });
  it("schedules no reviewer without an active gate and never turns the provider-less outcome into CLEAN",()=>{
    const r=run(`import {nextAction,applyOutcome} from "./automation/lib/orchestrator-engine.mjs";import fs from "node:fs";const policy=JSON.parse(fs.readFileSync("config/orchestrator-policy.json","utf8"));const p={id:"P",kind:"REVIEW",status:"REVIEW_PENDING",baseCommit:"a".repeat(40),reviewCommit:"b".repeat(40),cycle:1,bundle:{file:"x",promptFile:"y",digest:"c".repeat(64)},merge:{mode:"NONE",after:[]},dependsOn:[]};const c={order:["P"],packages:{P:p},releases:{},providers:{}};const a=nextAction(c,new Date());const o=applyOutcome(c,a,{type:"CLEAN",runDir:"r",evidence:"e"},new Date(),policy).control.packages.P;console.log(JSON.stringify({a,status:o.status,reason:o.blockedReason,review:o.review??null}))`);
    expect(r.status).toBe(0);const o=JSON.parse(r.out);expect(o.a.type).toBe("REVIEW");expect(o.a.provider).toBeUndefined();expect(o.status).toBe("FOUNDER_DECISION_PENDING");expect(o.reason).toBe("LEGACY_GATE_RETIRED");expect(o.review).toBeNull();
  });
  it("keeps the provenance final dependent on Claude only and records Codex as informational",()=>{
    const cap=fs.readFileSync(path.join(repo,"scripts/capture-provider-provenance.mjs"),"utf8");
    expect(cap).toContain('report.final=report.claude.status==="PASS"&&acceptedLevel(report.claude)?"PASS":"BLOCKED"');expect(cap).not.toMatch(/report\.final=[^;]*codex/);expect(cap).toContain("INFORMATIONAL_OPTIONAL_NOT_REQUIRED");
    const smoke=fs.readFileSync(path.join(repo,"scripts/provider-smoke.mjs"),"utf8");expect(smoke).not.toContain("codex-reviewer-broker");
    expect(fs.readFileSync(path.join(repo,"scripts/phase0-acceptance.mjs"),"utf8")).toContain('coreTools=["git","node","npm","claude"]');
  });
  it("requires the independent reviewer identity to differ from every producer identity in the execution registry",()=>{
    const r=run(`import fs from "node:fs";import {loadExecutionBackendRegistry,assertExecutionMergeGate} from "./automation/lib/execution-routing.mjs";const doc=JSON.parse(fs.readFileSync("config/execution-backends.json","utf8"));const t=f=>{const x=JSON.parse(JSON.stringify(doc));f(x);try{loadExecutionBackendRegistry(x);return "ACCEPTED"}catch(e){return String(e.message)}};console.log(JSON.stringify({ok:t(()=>{}),same:t(x=>{x.backends.LOCAL_CLAUDE.builderIdentity="CLAUDE_REVIEWER"}),noId:t(x=>{delete x.backends.LOCAL_CLAUDE.builderIdentity}),codex:t(x=>{x.pipeline.independentReviewerIdentity="CODEX_REVIEWER"}),gone:t(x=>{delete x.pipeline.independentReviewerIdentity})}))`);
    expect(r.status).toBe(0);const o=JSON.parse(r.out);expect(o.ok).toBe("ACCEPTED");expect(o.same).toContain("REVIEWER_IDENTITY_MUST_DIFFER_FROM_PRODUCERS");expect(o.noId).toContain("BUILDER_IDENTITY");expect(o.codex).toContain("REVIEWER_IDENTITY_MUST_BE_CLAUDE_REVIEWER");expect(o.gone).toContain("REVIEWER_IDENTITY_MUST_BE_CLAUDE_REVIEWER");
  });
  it("smokes both the Claude builder broker and the governed Claude reviewer broker and needs both for PASS",()=>{
    const smoke=fs.readFileSync(path.join(repo,"scripts/provider-smoke.mjs"),"utf8");
    expect(smoke).toContain("claude-builder-broker.mjs");expect(smoke).toContain("claude-reviewer-broker.mjs");expect(smoke).not.toContain("codex-reviewer-broker");
    expect(smoke).toContain('name:"claudeBuilder"');expect(smoke).toContain('name:"claudeReviewer"');
    expect(smoke).toContain('const final=targets.every(x=>result[x.name]?.status==="PASS")?"PASS":"BLOCKED"');
    for(const x of ["safeChildEnv(","timeoutMs:120000","maxCaptureBytes:20000","runCommand("])expect(smoke).toContain(x);expect(smoke).not.toContain("prov.claude.resolvedPath;args");expect(smoke).not.toContain("spawnSync(prov");
    const orch=fs.readFileSync(path.join(repo,"scripts/uasco-orchestrator.mjs"),"utf8");expect(orch).toContain("claudeBuilder:rep.providers?.claudeBuilder?.status");expect(orch).toContain("claudeReviewer:rep.providers?.claudeReviewer?.status");
  });
  it("requires an explicit reviewer provider, refuses to spawn the retired Codex reviewer and still reads historical Codex evidence",()=>{
    const r=run(`import fs from "node:fs";import os from "node:os";import path from "node:path";import {runBrokerReview,findCompletedRun} from "./automation/lib/review-pipeline.mjs";
const calls=[];const runner={run:(...a)=>{calls.push(a);throw new Error("SPAWNED")},spawn:(...a)=>{calls.push(a);throw new Error("SPAWNED")}};const base={reviewRoot:"x",evidenceRoot:"y",bundleRel:"b",promptRel:"p",expectedDigest:"d",baseCommit:"a",reviewedCommit:"c",cycle:1,runner};
const m=f=>{try{f();return "NO_THROW"}catch(e){return e.message}};
const ev=fs.mkdtempSync(path.join(os.tmpdir(),"gov2-ev-"));const rd=path.join(ev,"runs","r1");fs.mkdirSync(rd,{recursive:true});fs.writeFileSync(path.join(rd,"run-manifest.json"),JSON.stringify({bundleDigest:"D",cycle:1,startedAt:"2026-09-29T00:00:00Z",reviewer:{identity:"CODEX_REVIEWER"}}));
console.log(JSON.stringify({codex:m(()=>runBrokerReview({...base,provider:"codex"})),none:m(()=>runBrokerReview(base)),findNone:m(()=>findCompletedRun({evidenceRoot:ev,bundleDigest:"D",cycle:1})),calls:calls.length,hist:m(()=>findCompletedRun({evidenceRoot:ev,bundleDigest:"D",cycle:1,provider:"codex"}))}));`);
    expect(r.status).toBe(0);const o=JSON.parse(r.out);expect(o.codex).toBe("REVIEWER_RETIRED:CODEX_REVIEWER");expect(o.none).toBe("REVIEWER_PROVIDER_REQUIRED");expect(o.findNone).toBe("REVIEWER_PROVIDER_REQUIRED");expect(o.calls).toBe(0);expect(o.hist).not.toBe("REVIEWER_PROVIDER_REQUIRED");
  });
  it("labels the legacy Codex reviewer config and superseded dual keys as retired and never as the active reviewer",()=>{
    const c=JSON.parse(fs.readFileSync(path.join(repo,"config/automation.json"),"utf8")),p=JSON.parse(fs.readFileSync(path.join(repo,"config/orchestrator-policy.json"),"utf8"));
    expect(c.reviewer.status).toBe("RETIRED_LEGACY_CODEX_REVIEWER");expect(c.reviewer.activeReviewer).toBe(false);expect(c.reviewers.codex.activeReviewer).toBe(false);expect(c.reviewers.codex.status).toBe("RETIRED_HISTORICAL_ONLY");expect(c.reviewers.claude.identity).toBe("CLAUDE_REVIEWER");
    expect(p.review.status).toBe("LEGACY_DUAL_REVIEW_RETIRED_GOV2");expect(p.releaseAudit.status).toBe("LEGACY_DUAL_RELEASE_AUDIT_CONTRACT_SUPERSEDED_BY_reviewGate_GOV2");expect(p.reviewGate.codexRequired).toBe(false);expect(p.reviewGate.required).toEqual(["claude"]);
  });
});
