// //TR: Bu helper bütün production Git subprocess'lerini host global/system config ve repository hook'larından izole eder; builder host Git ayarlarıyla güven kapılarını etkileyemez.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
let state=null;
function isolationState(){
  if(state)return state;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uasco-git-isolation-"));
  const globalConfig=path.join(dir,"global.gitconfig"),systemConfig=path.join(dir,"system.gitconfig"),hooks=path.join(dir,"hooks");
  fs.writeFileSync(globalConfig,"");fs.writeFileSync(systemConfig,"");fs.mkdirSync(hooks,{recursive:true});
  state={dir,globalConfig,systemConfig,hooks};
  process.once("exit",()=>{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}});
  return state;
}
export function isolatedGitEnv(baseEnv=process.env){const s=isolationState();return {...baseEnv,GIT_CONFIG_GLOBAL:s.globalConfig,GIT_CONFIG_SYSTEM:s.systemConfig,GIT_CONFIG_NOSYSTEM:"1",GIT_TERMINAL_PROMPT:"0"}}
export function isolatedGitArgs(args){const s=isolationState();return ["-c",`core.hooksPath=${s.hooks}`,...args]}
export function spawnGitSync(cwd,args,options={}){const env=isolatedGitEnv(options.env??process.env);return cp.spawnSync("git",isolatedGitArgs(args),{cwd,encoding:"utf8",windowsHide:true,...options,env})}
export function gitIsolationDescriptor(){const s=isolationState();return {globalConfig:s.globalConfig,systemConfig:s.systemConfig,hooks:s.hooks}}
