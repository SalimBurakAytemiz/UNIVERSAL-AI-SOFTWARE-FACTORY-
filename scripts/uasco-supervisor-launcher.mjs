// //TR: Bu dar başlatıcı Windows Task Scheduler'ın çalıştırdığı tek giriştir: kendi kontrol düzlemindeki scripts/uasco-orchestrator.mjs --daemon sürecini sabit argümanlarla (kabuk yok) başlatır, çıktısını kontrol kökündeki sınırlı günlüğe yazar, çökmede policy'deki artan bekleme ile yeniden başlatır ve saatlik yeniden başlatma sınırını aşınca Task Scheduler'a bırakır; temiz durma (Global Stop), ölümcül güven hatası veya başka worker'ın çalışması yeniden başlatılmaz.
// usage: node scripts/uasco-supervisor-launcher.mjs --repo <constructionRepo>
import fs from "node:fs";import path from "node:path";import cp from "node:child_process";import {fileURLToPath} from "node:url";
import {expandPolicyPaths} from "../automation/lib/command-contracts.mjs";
const controlPlaneRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),argv=process.argv.slice(2),i=argv.indexOf("--repo");
if(i<0||!argv[i+1]||argv.length!==2){console.error("usage: node scripts/uasco-supervisor-launcher.mjs --repo <constructionRepo>");process.exit(2)}
const repo=path.resolve(argv[i+1]),policy=expandPolicyPaths(JSON.parse(fs.readFileSync(path.join(controlPlaneRoot,"config/orchestrator-policy.json"),"utf8")),{repo}),L=policy.launcher;
if(!L||!Array.isArray(L.restartBackoffSeconds)||!L.restartBackoffSeconds.length||!(L.maxRestartsPerHour>0)||!(L.healthyRunSeconds>0)||!(L.maxLogBytes>0)){console.error("LAUNCHER_POLICY_INVALID");process.exit(2)}
const logs=path.join(policy.roots.controlRoot,"logs"),daemonLog=path.join(logs,"supervisor-daemon.log"),events=path.join(logs,"supervisor-launcher.jsonl");fs.mkdirSync(logs,{recursive:true});
const event=(type,extra={})=>{try{fs.appendFileSync(events,JSON.stringify({at:new Date().toISOString(),launcherPid:process.pid,type,...extra})+"\n")}catch{}};
// //TR: Günlük dosyası sınırı aşınca bir önceki kopyaya döndürülür; eski kopya silinmez, üzerine yazılır.
const rotate=()=>{try{if(fs.statSync(daemonLog).size>L.maxLogBytes)fs.renameSync(daemonLog,`${daemonLog}.1`)}catch{}};
const EXIT={OK:0,FATAL:2,ALREADY_RUNNING:3,UPGRADED:4};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const orchestrator=path.join(controlPlaneRoot,"scripts","uasco-orchestrator.mjs");let child=null,stopping=false;
for(const sig of ["SIGINT","SIGTERM","SIGBREAK"])try{process.on(sig,()=>{stopping=true;event("LAUNCHER_SIGNAL",{signal:sig});try{child?.kill()}catch{}})}catch{}
event("LAUNCHER_STARTED",{controlPlane:controlPlaneRoot,repo,node:process.version});
const restarts=[];let failures=0;
while(!stopping){
  rotate();const fd=fs.openSync(daemonLog,"a"),started=Date.now();
  child=cp.spawn(process.execPath,[orchestrator,"--daemon","--repo",repo],{cwd:controlPlaneRoot,stdio:["ignore",fd,fd],windowsHide:true,shell:false,env:{...process.env,UASCO_SUPERVISOR_LAUNCHER_PID:String(process.pid)}});
  event("DAEMON_STARTED",{pid:child.pid});
  const {code,signal}=await new Promise(r=>child.once("exit",(code,signal)=>r({code,signal})));fs.closeSync(fd);const ranMs=Date.now()-started;event("DAEMON_EXITED",{pid:child.pid,code,signal,ranSeconds:Math.round(ranMs/1000)});child=null;
  if(stopping)break;
  if(code===EXIT.OK){event("LAUNCHER_STOPPED",{reason:"DAEMON_STOPPED_CLEANLY"});process.exit(0)}
  if(code===EXIT.ALREADY_RUNNING){event("LAUNCHER_STOPPED",{reason:"ANOTHER_WORKER_OWNS_THE_LOCK"});process.exit(0)}
  if(code===EXIT.FATAL){event("LAUNCHER_STOPPED",{reason:"DAEMON_FATAL_NOT_RESTARTED"});process.exit(2)}
  // //TR: Denetimli kendini güncelleme: eski düzlem yeniden başlatılmaz; Task Scheduler'ın bir sonraki tetikleyicisi control\current bağlantısı üzerinden yeni düzlemi başlatır.
  if(code===EXIT.UPGRADED){event("LAUNCHER_STOPPED",{reason:"CONTROL_PLANE_UPGRADED_NEXT_TRIGGER_STARTS_THE_NEW_PLANE"});process.exit(0)}
  // //TR: Çökme: uzun süre sağlıklı çalıştıysa bekleme sıfırlanır; son bir saatteki yeniden başlatma sınırı aşılırsa sonraki periyodik Task Scheduler tetikleyicisine bırakılır.
  if(ranMs>=L.healthyRunSeconds*1000)failures=0;const now=Date.now();while(restarts.length&&now-restarts[0]>3_600_000)restarts.shift();
  if(restarts.length>=L.maxRestartsPerHour){event("LAUNCHER_STOPPED",{reason:"RESTART_LIMIT_REACHED",restartsLastHour:restarts.length});process.exit(1)}
  const wait=L.restartBackoffSeconds[Math.min(failures,L.restartBackoffSeconds.length-1)]*1000;failures++;restarts.push(now);event("DAEMON_RESTART_SCHEDULED",{inSeconds:wait/1000,failures});await sleep(wait);
}
event("LAUNCHER_STOPPED",{reason:"SIGNAL"});process.exit(0);
