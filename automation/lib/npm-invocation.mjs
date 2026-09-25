// //TR: Bu helper Windows'ta npm.cmd shell olmadan spawn edilemediği (Node CVE-2024-27980 sonrası EINVAL) için npm'i shell:true kullanmadan çalışan Node kurulumunun paketlenmiş npm-cli.js dosyasıyla doğrudan node üzerinden çağırır; PATH/prefix npm'ine güvenmez, dosya yoksa veya düzenli dosya değilse fail-closed hata verir.
import fs from "node:fs";
import path from "node:path";

export function resolveNpmInvocation({platform=process.platform,execPath=process.execPath,lstatSync=fs.lstatSync}={}){
 if(platform!=="win32")return {command:"npm",prefixArgs:[],mode:"PATH_NPM"};
 const cli=path.win32.join(path.win32.dirname(execPath),"node_modules","npm","bin","npm-cli.js");let st;
 try{st=lstatSync(cli)}catch{throw new Error(`NPM_CLI_NOT_FOUND:${cli}`)}
 if(!st.isFile())throw new Error(`NPM_CLI_NOT_REGULAR_FILE:${cli}`);
 return {command:execPath,prefixArgs:[cli],mode:"NODE_BUNDLED_NPM_CLI"};
}
export function npmSpawnArgs(args,options){const inv=resolveNpmInvocation(options);return {command:inv.command,args:[...inv.prefixArgs,...args]}}
