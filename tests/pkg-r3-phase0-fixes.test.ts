// //TR: Bu test ilk gerçek Phase0 denemesinde bulunan üç hatanın regresyonunu doğrular: runtime-contracts fixture'ının install.ps1 UASCO_INSTALL_ID değerinden izolasyonu (PHASE0-F1), install-report'un node:crypto ile rapor yazması (PHASE0-F2) ve builder politikasının yalnız çalışma dizini içi edit/write için acceptEdits kullanıp Bash/web/alt ajan/MCP'yi kapalı tutması (PHASE0-F3).
import {describe,it,expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
const repo=process.cwd();
function run(script:string,cwd:string,installId?:string){const env={...process.env};if(installId===undefined)delete env.UASCO_INSTALL_ID;else env.UASCO_INSTALL_ID=installId;const r=cp.spawnSync(process.execPath,[path.join(repo,script)],{cwd,env,encoding:"utf8",timeout:300000});return {status:r.status,out:`${r.stdout??""}${r.stderr??""}`}}
describe("Phase0 install-time fixes",()=>{
  it("runtime-contracts passes with and without a host UASCO_INSTALL_ID (PHASE0-F1)",()=>{for(const id of [undefined,"INSTALL-HOST-1790000000000"]){const r=run("scripts/validate-runtime-contracts.mjs",repo,id);expect(r.status,r.out).toBe(0);expect(r.out).toContain("RUNTIME_CONTRACT_VALIDATION: PASS 16/16")}
    const src=fs.readFileSync("scripts/validate-runtime-contracts.mjs","utf8");expect(src).toContain('ok("install-id-env-ledger-mismatch-rejected",envMismatch)');expect(fs.readFileSync("automation/lib/phase0-contract.mjs","utf8")).toContain("PHASE0_INSTALL_ID_ENV_LEDGER_MISMATCH")},300000);
  it("install-report writes INSTALL_REPORT.json and still rejects an install id mismatch (PHASE0-F2)",()=>{const t=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-install-report-"));try{fs.mkdirSync(path.join(t,".ai/runtime"),{recursive:true});fs.writeFileSync(path.join(t,".ai/runtime/INSTALL_STEPS.json"),JSON.stringify({schemaVersion:"1.1.0",installId:"INSTALL-T1",steps:[]}));
    const ok=run("scripts/install-report.mjs",t,"INSTALL-T1");expect(ok.status,ok.out).toBe(0);const rep=JSON.parse(fs.readFileSync(path.join(t,".ai/runtime/INSTALL_REPORT.json"),"utf8"));expect(rep.installId).toBe("INSTALL-T1");expect(rep.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(run("scripts/install-report.mjs",t,"INSTALL-OTHER").status).not.toBe(0)}finally{fs.rmSync(t,{recursive:true,force:true})}
    expect(fs.readFileSync("scripts/install-report.mjs","utf8")).toContain('import crypto from "node:crypto";')});
  it("builder policy allows only working-directory edits and keeps shell, web, subagents and MCP denied (PHASE0-F3)",()=>{const pol=JSON.parse(fs.readFileSync("config/builder-execution-policy.json","utf8"));
    expect(pol.permissionMode).toBe("acceptEdits");expect(pol.allowedTools).toEqual(["Read","Edit","Write","Glob","Grep"]);for(const t of ["Bash","WebFetch","WebSearch","NotebookEdit","Agent","Skill"])expect(pol.disallowedTools).toContain(t);expect(pol.disallowedToolPatterns).toContain("mcp__*");
    for(const k of ["denyExternalSideEffects","denyHostShell","denyMcpByDefault","requireBoundarySmoke","highRiskRequiresOsSandbox"])expect(pol[k]).toBe(true);expect(pol.toolSetRestrictionFlag).toBe("--tools");
    const broker=fs.readFileSync("scripts/claude-builder-broker.mjs","utf8");for(const x of ['"--permission-mode"','"--tools"','"--disallowedTools"','pol.permissionMode??"dontAsk"'])expect(broker).toContain(x);
    const smoke=fs.readFileSync("scripts/builder-boundary-smoke.mjs","utf8");expect(smoke).toContain("insideRun.status===0&&inside&&outsideSame&&!secretLeaked");expect(fs.readFileSync("scripts/install.ps1","utf8")).toContain("builder-boundary-smoke.mjs")});
});
