// //TR: Bu helper frozen milestone scope/protected trust-root/test weakening/package execution policy/dependency/diff budget kontrollerini commit öncesi fail-closed uygular.
import fs from "node:fs";import path from "node:path";import {spawnGitSync} from "./git-isolation.mjs";import {protectedChangeViolations} from "./trust-root.mjs";import {evaluatePackagePolicy} from "./package-policy.mjs";
function allowed(n,p){return p.some(x=>n===x||n.startsWith(x.endsWith("/")?x:`${x}/`))}
function contentAt(cwd,ref,file){const r=spawnGitSync(cwd,["show",`${ref}:${file}`]);return r.status===0?r.stdout:null}
function assertionCount(s=""){return (s.match(/\b(?:expect|assert|assertEquals|assertTrue|assertFalse)\s*\(/g)||[]).length}
function diffLines(cwd,base){const r=spawnGitSync(cwd,["diff","--numstat",base,"--"]);if(r.status!==0)return 0;return r.stdout.split(/\r?\n/).filter(Boolean).reduce((n,l)=>{const [a,b]=l.split(/\s+/);return n+(Number(a)||0)+(Number(b)||0)},0)}
export function evaluateChangeSet({repoRoot,worktree,baseCommit,changedFiles,milestone,protectedPolicy,governanceAuthorized=false}){
 const violations=[];const maxFiles=milestone.maxFilesChanged??120,maxLines=milestone.maxDiffLines??18000;const lines=diffLines(worktree,baseCommit);
 if(changedFiles.length>maxFiles)violations.push({type:"CHANGE_FILE_BUDGET_EXCEEDED",detail:`${changedFiles.length} > ${maxFiles}`});if(lines>maxLines)violations.push({type:"CHANGE_LINE_BUDGET_EXCEEDED",detail:`${lines} > ${maxLines}`});
 for(const f of changedFiles)if(!allowed(f,milestone.allowedPathPrefixes??[]))violations.push({type:"OUT_OF_SCOPE_PATH",path:f});
 for(const f of protectedChangeViolations(changedFiles,protectedPolicy,governanceAuthorized===true))violations.push({type:"PROTECTED_TRUST_ROOT_CHANGE",path:f});
 for(const f of changedFiles.filter(x=>/^tests\/.+\.(?:ts|js|mjs|py|java|cs)$/.test(x))){const before=contentAt(worktree,baseCommit,f),afterPath=path.join(worktree,f),after=fs.existsSync(afterPath)?fs.readFileSync(afterPath,"utf8"):null;if(before!==null&&after===null){violations.push({type:"EXISTING_TEST_DELETED",path:f});continue}if(after&&/\.(?:skip|only)\s*\(/.test(after))violations.push({type:"TEST_SKIP_OR_ONLY",path:f});if(before!==null&&after!==null&&!milestone.allowExistingTestAssertionReduction){const b=assertionCount(before),a=assertionCount(after);if(b>0&&a<b)violations.push({type:"ASSERTION_COUNT_REDUCED",path:f,before:b,after:a})}}
 const pkg=changedFiles.includes("package.json"),lock=changedFiles.includes("package-lock.json");if(pkg!==lock)violations.push({type:pkg?"PACKAGE_JSON_CHANGED_WITHOUT_LOCKFILE":"PACKAGE_LOCK_CHANGED_WITHOUT_PACKAGE_JSON"});
 let dependencyChanges=[];if(pkg){const policy=JSON.parse(fs.readFileSync(path.join(repoRoot,"config/package-policy.json"),"utf8"));const pr=evaluatePackagePolicy({worktree,baseCommit,policy,milestone});violations.push(...pr.violations);dependencyChanges=pr.dependencyChanges}
 return {ok:violations.length===0,violations,dependencyChanges,diffLines:lines};
}
