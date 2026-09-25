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
export function isolatedGitEnv(baseEnv=process.env){const s=isolationState(),env={...baseEnv};
  // //TR: Host process-control/Git transport env değişkenleri production Git child process'ine taşınmaz; aksi halde trusted Git komutu arbitrary helper/SSH binary çalıştırabilir.
  const exactDeny=new Set(["GIT_SSH","GIT_SSH_COMMAND","GIT_ASKPASS","SSH_ASKPASS","GIT_EXEC_PATH","GIT_TEMPLATE_DIR","GIT_PROXY_COMMAND","GIT_EXTERNAL_DIFF","GIT_DIFF_OPTS","GIT_CONFIG_COUNT","GIT_CONFIG_GLOBAL","GIT_CONFIG_SYSTEM"]);
  for(const key of Object.keys(env)){const ku=key.toUpperCase();if(exactDeny.has(ku)||/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(ku))delete env[key]}
  return {...env,GIT_CONFIG_GLOBAL:s.globalConfig,GIT_CONFIG_SYSTEM:s.systemConfig,GIT_CONFIG_NOSYSTEM:"1",GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"Never"}
}
export function isolatedGitArgs(args){const s=isolationState();return ["-c",`core.hooksPath=${s.hooks}`,"-c","credential.helper=","-c","core.askPass=","-c","protocol.ext.allow=never",...args]}
export function spawnGitSync(cwd,args,options={}){const env=isolatedGitEnv(options.env??process.env);return cp.spawnSync("git",isolatedGitArgs(args),{cwd,encoding:"utf8",windowsHide:true,...options,env})}
export function gitIsolationDescriptor(){const s=isolationState();return {globalConfig:s.globalConfig,systemConfig:s.systemConfig,hooks:s.hooks}}
