// //TR: Bu öz-test desktop-e2e-logic.mjs saf fonksiyonlarını Electron başlatmadan doğrular: hepsi PASS→0, NOT_VERIFIED→1, FAIL→1, sıfır rota→1, commitSha tercih sırası.
import assert from "node:assert/strict";
import {computeStatus,exitCodeFor,resolveCommitSha} from "./desktop-e2e-logic.mjs";
const R=(...s)=>s.map((status,i)=>({id:`r${i}`,status}));
const code=(routes,fatal)=>exitCodeFor(computeStatus(routes,fatal));
let n=0;const t=(name,fn)=>{fn();n++;console.log(`ok ${n} ${name}`)};
t("all PASS -> exit 0",()=>{assert.equal(computeStatus(R("PASS","PASS"),null),"PASS");assert.equal(code(R("PASS","PASS"),null),0)});
t("one NOT_VERIFIED -> PARTIAL, exit 1",()=>{assert.equal(computeStatus(R("PASS","NOT_VERIFIED"),null),"PARTIAL");assert.equal(code(R("PASS","NOT_VERIFIED"),null),1)});
t("one FAIL -> exit 1",()=>{assert.equal(computeStatus(R("PASS","FAIL"),null),"FAIL");assert.equal(code(R("PASS","FAIL"),null),1)});
t("zero routes -> FAIL, exit 1",()=>{assert.equal(computeStatus([],null),"FAIL");assert.equal(code([],null),1)});
t("fatal with all PASS -> exit 1",()=>assert.equal(code(R("PASS"),"X"),1));
t("commitSha prefers UASCO_HEAD_SHA",()=>assert.equal(resolveCommitSha({UASCO_HEAD_SHA:" a ",GITHUB_SHA:"b"},"c"),"a"));
t("commitSha falls back to GITHUB_SHA",()=>assert.equal(resolveCommitSha({UASCO_HEAD_SHA:"  ",GITHUB_SHA:"b"},"c"),"b"));
t("commitSha falls back to git HEAD",()=>assert.equal(resolveCommitSha({},"c\n"),"c"));
t("commitSha UNKNOWN when nothing",()=>assert.equal(resolveCommitSha({},""),"UNKNOWN"));
console.log(`selftest PASS ${n}/${n}`);
