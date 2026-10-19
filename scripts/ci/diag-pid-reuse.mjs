// //TR: YALNIZ TANI (merge edilmez): olen bir surecin PID'inin hemen sonraki spawn'a yeniden verilme sikligini olcer.
import cp from "node:child_process";
let same=0;const n=40;
for(let i=0;i<n;i++){const dead=Number(cp.spawnSync(process.execPath,["-e","console.log(process.pid)"],{encoding:"utf8"}).stdout.trim());const c=cp.spawn(process.execPath,["-e","setTimeout(()=>{},3000)"]);if(c.pid===dead)same++;c.kill();await new Promise(r=>c.on("exit",r));}
console.log(`PID_REUSE next-spawn-got-the-dead-pid ${same}/${n}`);
