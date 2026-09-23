// //TR: Bu helper package.json execution semantics alanlarını field-level korur; tüm direct dependency section'larında scope taşıma, alias/protocol ve non-exact semver bypass'larını fail-closed reddeder.
import fs from "node:fs";import {spawnGitSync} from "./git-isolation.mjs";
function contentAt(cwd,ref,file){const r=spawnGitSync(cwd,["show",`${ref}:${file}`]);return r.status===0?r.stdout:null}
function dependencyChanges(before,after,sections){const out=[];for(const section of sections){const b=before?.[section]??{},a=after?.[section]??{};for(const name of new Set([...Object.keys(b),...Object.keys(a)]))if(b[name]!==a[name])out.push({section,name,before:b[name]??null,after:a[name]??null})}return out}
const exactSemver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function protocolRejected(value,protocols=[]){const s=String(value).toLowerCase();return protocols.some(p=>{const q=String(p).toLowerCase();return q.endsWith("*")?s.startsWith(q.slice(0,-1)):s.startsWith(q)})}
export function evaluatePackagePolicy({worktree,baseCommit,policy,milestone}){
 const raw=contentAt(worktree,baseCommit,"package.json");let before=null,after=null;const violations=[];
 try{before=raw?JSON.parse(raw):null;after=JSON.parse(fs.readFileSync(`${worktree}/package.json`,`utf8`))}catch{violations.push({type:"PACKAGE_JSON_UNPARSEABLE"});return {ok:false,violations,dependencyChanges:[]}}
 for(const field of policy.protectedFields??[])if(JSON.stringify(before?.[field]??null)!==JSON.stringify(after?.[field]??null))violations.push({type:"PROTECTED_PACKAGE_FIELD_CHANGED",field});
 const sections=policy.dependencySections??policy.dependencyFields??["dependencies","devDependencies","optionalDependencies","peerDependencies"],changes=dependencyChanges(before,after,sections);
 if(changes.length&&milestone.allowDependencyChanges!==true)violations.push({type:"DEPENDENCY_CHANGE_NOT_ALLOWED",dependencyChanges:changes});
 if(policy.requireExactDirectVersions)for(const section of sections)for(const [name,v] of Object.entries(after?.[section]??{})){const s=String(v);if(protocolRejected(s,policy.forbidDependencyProtocols??[])||!exactSemver.test(s))violations.push({type:"DISALLOWED_DEPENDENCY_VERSION",section,name,version:s})}
 return {ok:violations.length===0,violations,dependencyChanges:changes};
}
