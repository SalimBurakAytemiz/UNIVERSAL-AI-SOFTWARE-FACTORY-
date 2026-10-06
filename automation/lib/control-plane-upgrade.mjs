// //TR: Bu modül süpervizörün denetimli kendini güncellemesidir (Founder kararı 2026-10-01): master'ın ucu kontrol durumunda kayıtlı governed bir hızlı ileri birleştirmeyse, çalışan kontrol düzleminin torunuysa ve korumalı kontrol düzlemi dosyalarını değiştiriyorsa yeni düzlem yalnız tam komut sözleşmeleriyle hazırlanır (yerel klon, ayrık checkout, gözden geçirilmiş kilitle bağımlılık, mühürlü trust-root doğrulaması), Task Scheduler'ın başlattığı sabit control\current bağlantısı yeni düzleme çevrilir ve eski düzlem geri dönüş için silinmez. Hiçbir koşul sağlanmazsa hiçbir şey değişmez. Görev bağlantıya doğrudan değil, bağlantıya bağlı olmayan sabit giriş dosyası (control\uasco-supervisor-entry.mjs) üzerinden başlar; giriş, kesintiye uğramış bir bağlantı değişimini günlüğe (SWITCH.json) ve yedek bağlantıya bakarak başlatılabilir bir düzleme onarır ve ancak sonra control\current üzerinden başlatıcıyı çalıştırır. Etkinleştirme sınırında Global Stop canlı olarak yeniden denetlenir.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
import {writeJsonAtomic,readJsonIfExists} from "./atomic-json.mjs";
export const UPGRADE_EXIT_CODE=4;
export const CONTROL_PLANE_ENTRY="uasco-supervisor-entry.mjs";
const SHA40=/^[0-9a-f]{40}$/,sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function controlPlaneLayout(policy){const dir=path.join(policy.roots.controlRoot,"control");return {dir,current:path.join(dir,"current"),record:path.join(dir,"CURRENT.json"),journal:path.join(dir,"SWITCH.json"),entry:path.join(dir,CONTROL_PLANE_ENTRY)}}
export function readControlPlaneRecord(policy){return readJsonIfExists(controlPlaneLayout(policy).record,null)}
// //TR: Korumalı küme çalışan düzlemin mühürlü manifestinden okunur; manifestin kendisi de kontrol düzlemi dosyası sayılır.
export function protectedPathsOf(planeRoot){const m=JSON.parse(fs.readFileSync(path.join(planeRoot,"config/trust-root-manifest.json"),"utf8"));return [...new Set([...(m.files??[]).map(f=>f.path),"config/trust-root-manifest.json"])]}
// //TR: Saf karar: hangi koşul sağlanmıyorsa nedeni döner; yalnız hepsi sağlanırsa güncelleme yapılır.
export function planControlPlaneUpgrade({control,masterSha,planeCommit,isDescendant,changedPaths=[],protectedPaths=[],policy,globalStop=null}){
  const s=policy?.selfUpgrade;if(!s?.enabled)return {upgrade:false,reason:"SELF_UPGRADE_DISABLED"};if(globalStop)return {upgrade:false,reason:"GLOBAL_STOP_ACTIVE"};
  if(!SHA40.test(String(masterSha))||!SHA40.test(String(planeCommit)))return {upgrade:false,reason:"COMMIT_UNKNOWN"};if(masterSha===planeCommit)return {upgrade:false,reason:"ALREADY_CURRENT"};
  const merged=Object.values(control?.packages??{}).find(p=>p?.status==="CLOSED"&&p.mergedCommit===masterSha);if(!merged)return {upgrade:false,reason:"MASTER_NOT_A_GOVERNED_MERGE"};
  if(isDescendant!==true)return {upgrade:false,reason:"MASTER_NOT_A_FAST_FORWARD_OF_THE_PLANE"};
  if(Object.values(control.packages).some(p=>p?.inFlight)||Object.values(control.releases??{}).some(r=>r?.inFlight))return {upgrade:false,reason:"ACTION_IN_FLIGHT"};
  const prot=new Set(protectedPaths),touched=changedPaths.filter(f=>prot.has(f));if(!touched.length)return {upgrade:false,reason:"NO_CONTROL_PLANE_CHANGE"};
  return {upgrade:true,reason:"GOVERNED_MERGE_CHANGES_THE_CONTROL_PLANE",mergedPackage:merged.id,touched:touched.slice(0,20)};
}
// //TR: Bağlantı değişimi: Windows bir dizin bağlantısının üzerine rename izni vermez, bu yüzden aynı adda kısa bir boşluk kaçınılmazdır; boşluk kurtarılabilir yapılır. Yeni bağlantı yanında (.next) hazırlanır, değişim günlüğü (önceki ve yeni hedef, yazılacak kayıt) atomik yazılır, eski bağlantı silinmeden yedek adına (.prev) taşınır, ardından .next asıl ada taşınır; son taşıma başarısız olursa yedekten geri alınır ve günlük kaldırılır. Bu adımların herhangi birinde kesilen bir değişim recoverControlPlaneLink ile (sabit giriş dosyası her başlatmada çağırır) elle onarım gerekmeden başlatılabilir bir düzleme döner. Hedef düzlemler hiçbir adımda silinmez.
export function switchJunction(link,target,{record=null,now=()=>new Date()}={}){
  const next=`${link}.next`,prev=`${link}.prev`,journal=path.join(path.dirname(link),"SWITCH.json"),isLink=p=>{try{return fs.lstatSync(p).isSymbolicLink()}catch(e){if(e.code==="ENOENT")return false;throw e}};
  const writeJournal=v=>{const t=`${journal}.tmp-${process.pid}`;fs.writeFileSync(t,JSON.stringify(v,null,2)+"\n");fs.renameSync(t,journal)};
  if(isLink(next))fs.unlinkSync(next);fs.symlinkSync(target,next,"junction");
  const had=isLink(link);if(!had&&fs.existsSync(link))throw new Error("CONTROL_PLANE_LINK_NOT_A_JUNCTION");
  let old=null;if(had){try{old=fs.realpathSync(link)}catch{old=null}}
  writeJournal({"//TR":"Bu günlük control\\current bağlantı değişimi sürerken vardır; kesilen bir değişimi sabit giriş dosyası bununla onarır. Değişim bitince kaldırılır.",previous:old,next:path.resolve(target),record,stagedAt:now().toISOString()});
  if(had){if(isLink(prev))fs.unlinkSync(prev);fs.renameSync(link,prev)}
  try{fs.renameSync(next,link)}catch(e){if(had){try{fs.renameSync(prev,link);fs.rmSync(journal,{force:true});if(isLink(next))fs.unlinkSync(next)}catch{}}throw e}
  if(had){try{fs.unlinkSync(prev)}catch{}}
  return {previous:old,current:fs.realpathSync(link)};
}
// //TR: Kurtarma kendi kendine yeterlidir (yalnız fs ve path kullanır) çünkü sabit giriş dosyasına aynen gömülür. Bağlantı sağlamsa yalnız bağlantı taşındıktan sonra kesilmiş bir değişimin kaydı günlükten tamamlanır. Bağlantı yoksa veya hedefi kayıpsa kesilen değişimden önce çalışan düzlem geri getirilir (yedek bağlantı, günlükteki önceki hedef veya CURRENT.json kaydı); önceki düzlem yoksa hazırlanmış (doğrulanmış) yeni düzlem kullanılır. Gerçek bir dizin asla silinmez; başlatılabilir aday yoksa hiçbir bağlantı uydurulmaz. Kurtarılan düzlemin daemon'u başlarken kendi mühürlü trust-root'unu yeniden doğrular.
export function recoverControlPlaneLink(link){
  const dir=path.dirname(link),next=`${link}.next`,prev=`${link}.prev`,journalFile=path.join(dir,"SWITCH.json"),recordFile=path.join(dir,"CURRENT.json");
  const isLink=p=>{try{return fs.lstatSync(p).isSymbolicLink()}catch{return false}},real=p=>{try{return fs.realpathSync(p)}catch{return null}};
  const launchable=p=>{const r=typeof p==="string"&&p?real(p):null;return !!r&&fs.existsSync(path.join(r,"scripts","uasco-supervisor-launcher.mjs"))};
  const same=(a,b)=>{const x=real(a),y=real(b);return !!x&&!!y&&x.toLowerCase()===y.toLowerCase()};
  const readJson=f=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}},dropLink=p=>{if(isLink(p))fs.unlinkSync(p)};
  const journal=readJson(journalFile);
  if(isLink(link)&&launchable(link)){
    if(!journal)return {recovered:false,action:"LINK_PRESENT",current:real(link)};
    let action="DISCARDED_STALE_SWITCH_JOURNAL";if(journal.record&&same(link,journal.next)){const t=`${recordFile}.tmp-${process.pid}`;fs.writeFileSync(t,JSON.stringify(journal.record,null,2)+"\n");fs.renameSync(t,recordFile);action="FINALIZED_INTERRUPTED_SWITCH"}
    dropLink(prev);dropLink(next);fs.rmSync(journalFile,{force:true});return {recovered:true,action,current:real(link)};
  }
  if(fs.existsSync(link)&&!isLink(link))return {recovered:false,reason:"CONTROL_PLANE_LINK_NOT_A_JUNCTION"};
  const record=readJson(recordFile);
  const cands=[[prev,"rename","RESTORED_PREVIOUS_PLANE"],[journal?.previous,"create","RESTORED_PREVIOUS_PLANE"],[record?.path,"create","RESTORED_RECORDED_PLANE"],[next,"rename","COMPLETED_STAGED_SWITCH"],[journal?.next,"create","COMPLETED_STAGED_SWITCH"]].filter(([p])=>launchable(p));
  if(!cands.length)return {recovered:false,reason:"NO_LAUNCHABLE_CANDIDATE"};
  const [p,how,action]=cands[0],target=real(p);dropLink(link);
  if(how==="rename")fs.renameSync(p,link);else fs.symlinkSync(target,link,"junction");
  if(p!==next)dropLink(next);if(journal)fs.rmSync(journalFile,{force:true});
  return {recovered:true,action,current:real(link)};
}
// //TR: Sabit giriş dosyasının kaynağı: kurtarma fonksiyonunun kendisi gömülür (tek kaynak), sonra başlatıcı control\current'ın gerçek yolundan aynı argümanlarla yüklenir; böylece başlatıcı kendi düzleminin yolunu ve argümanlarını görür.
export function controlPlaneEntrySource(){return `// //TR: Bu dosya UASCO-Autonomous-Supervisor zamanlanmış görevinin sabit giriş noktasıdır; automation/lib/control-plane-upgrade.mjs tarafından üretilir, elle düzenlenmez. Kesintiye uğramış bir control\\current değişimini onarır ve control\\current üzerinden uasco-supervisor-launcher.mjs'i çalıştırır.
import fs from "node:fs";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const recoverControlPlaneLink=${recoverControlPlaneLink.toString()};
const dir=path.dirname(fileURLToPath(import.meta.url)),link=path.join(dir,"current");
let rec;try{rec=recoverControlPlaneLink(link)}catch(e){rec={recovered:false,reason:"RECOVERY_FAILED:"+String(e&&e.message||e)}}
if(rec.recovered||rec.reason){try{const logs=path.join(dir,"..","logs");fs.mkdirSync(logs,{recursive:true});fs.appendFileSync(path.join(logs,"supervisor-entry.jsonl"),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...rec})+"\\n")}catch{}}
await import(pathToFileURL(path.join(fs.realpathSync(link),"scripts","uasco-supervisor-launcher.mjs")).href);
`}
// //TR: Giriş dosyası yalnız içerik farklıysa geçici dosya + rename ile atomik yazılır.
export function installControlPlaneEntry(dir){const file=path.join(dir,CONTROL_PLANE_ENTRY),src=controlPlaneEntrySource();let cur=null;try{cur=fs.readFileSync(file,"utf8")}catch{}
  if(cur!==src){fs.mkdirSync(dir,{recursive:true});const t=`${file}.tmp-${process.pid}`;fs.writeFileSync(t,src);fs.renameSync(t,file)}return {file,changed:cur!==src,sha256:sha(file)}}
// //TR: Yeni düzlemin hazırlanması yalnız sözleşmelerle yapılır; bağımlılıklar gözden geçirilmiş kilit aynıysa çalışan düzlemden çevrimdışı kopyalanır, ardından kurulum betiği kilidi doğrular; mühürlü trust-root doğrulanmadan bağlantı değişmez. Etkinleştirme sınırında (son komuttan sonra, ilk dosya sistemi değişikliğinden hemen önce) Global Stop canlı olarak yeniden denetlenir; etkinse veya denetim başarısızsa hiçbir şey değişmeden ertelenir (DEFERRED) ve sonraki yetkili deneme aynı hazırlığı yeniden kullanır. Canlı durdurma denetimi zorunludur.
export function performControlPlaneUpgrade({runner,policy,repo,masterSha,planeCommit,runningPlane,reason,shouldStop,now=()=>new Date()}){
  if(typeof shouldStop!=="function")throw new Error("CONTROL_PLANE_UPGRADE_REQUIRES_A_LIVE_GLOBAL_STOP_CHECK");
  const L=controlPlaneLayout(policy),dest=path.join(L.dir,masterSha.slice(0,12));
  if(!fs.existsSync(dest))runner.must("git.cloneLocal",{source:repo,dest});else runner.must("git.fetchOrigin",{cwd:dest});
  runner.must("git.checkoutDetached",{cwd:dest,commit:masterSha});const head=runner.must("git.headCommit",{cwd:dest}).stdout.trim();if(head!==masterSha)throw new Error(`CONTROL_PLANE_HEAD_MISMATCH:${head}`);
  if(runner.must("git.status",{cwd:dest}).stdout.trim())throw new Error("CONTROL_PLANE_CLONE_NOT_CLEAN");
  const lockOld=path.join(runningPlane,"package-lock.json"),lockNew=path.join(dest,"package-lock.json"),nmOld=path.join(runningPlane,"node_modules"),nmNew=path.join(dest,"node_modules");
  if(!fs.existsSync(nmNew)&&fs.existsSync(nmOld)&&fs.existsSync(lockOld)&&fs.existsSync(lockNew)&&sha(lockOld)===sha(lockNew))fs.cpSync(nmOld,nmNew,{recursive:true,dereference:true});
  runner.must("node.script",{script:"scripts/ensure-dependencies.mjs",cwd:dest});
  const vt=runner.run("node.script",{script:"scripts/verify-trust-root.mjs",cwd:dest});if(vt.status!==0)throw new Error("CONTROL_PLANE_TRUST_ROOT_NOT_VERIFIED");
  let stop;try{stop=shouldStop()}catch(e){stop=`STOP_CHECK_FAILED_FAIL_CLOSED:${e?.message??e}`}
  if(stop)return {status:"DEFERRED",reason:`GLOBAL_STOP_ACTIVE_AT_ACTIVATION:${stop}`,from:planeCommit,to:masterSha,path:dest};
  installControlPlaneEntry(L.dir);
  let previousTarget=null;try{if(fs.lstatSync(L.current).isSymbolicLink())previousTarget=fs.realpathSync(L.current)}catch{}
  const rec={"//TR":"Bu kayıt Task Scheduler'ın sabit giriş dosyası üzerinden başlattığı control\\current bağlantısının gösterdiği kontrol düzlemini ve bir öncekini tutar; geri dönüş için eski düzlem silinmez.",commit:masterSha,path:dest,activatedAt:now().toISOString(),reason,previous:{commit:planeCommit,path:runningPlane,linkTarget:previousTarget}};
  switchJunction(L.current,dest,{record:rec,now});writeJsonAtomic(L.record,rec);fs.rmSync(L.journal,{force:true});return {status:"UPGRADED",from:planeCommit,to:masterSha,path:dest,record:rec};
}
// //TR: Süpervizör girişi: önce kesintiye uğramış bir bağlantı değişimi varsa onarılır (savunma derinliği; asıl onarım sabit giriş dosyasındadır), sonra yalnız kontrol kökünün altındaki etkinleştirilmiş bir düzlemden çalışıyorsa güncelleme denenir; her yoklama sözleşmeyle yapılır ve başarısızlık hiçbir şeyi değiştirmez. Planlama anlık Global Stop görüntüsüyle, etkinleştirme canlı denetimle yapılır.
export function checkAndUpgrade({runner,policy,repo,runningPlane,control,globalStop=null,shouldStop,now=()=>new Date()}){
  const s=policy?.selfUpgrade;if(!s?.enabled)return {upgrade:false,reason:"SELF_UPGRADE_DISABLED"};
  let linkRecovery;try{linkRecovery=recoverControlPlaneLink(controlPlaneLayout(policy).current)}catch(e){linkRecovery={recovered:false,reason:`RECOVERY_FAILED:${e?.message??e}`}}
  let planeCommit,masterSha;try{planeCommit=runner.must("git.headCommit",{cwd:runningPlane}).stdout.trim()}catch(e){return {upgrade:false,reason:"PLANE_NOT_UNDER_CONTROL_ROOT",linkRecovery}}
  masterSha=runner.must("git.revParse",{cwd:repo,rev:policy.merge.defaultBranchRef}).stdout.trim();if(masterSha===planeCommit)return {upgrade:false,reason:"ALREADY_CURRENT",linkRecovery};
  const anc=runner.run("git.isAncestor",{cwd:repo,ancestor:planeCommit,descendant:masterSha}),changed=anc.status===0?runner.must("git.diffNames",{cwd:repo,base:planeCommit,head:masterSha}).stdout.split(/\r?\n/).filter(Boolean):[];
  const plan=planControlPlaneUpgrade({control,masterSha,planeCommit,isDescendant:anc.status===0,changedPaths:changed,protectedPaths:protectedPathsOf(runningPlane),policy,globalStop});if(!plan.upgrade)return {...plan,linkRecovery};
  return {...plan,linkRecovery,...performControlPlaneUpgrade({runner,policy,repo,masterSha,planeCommit,runningPlane,reason:`${plan.reason}:${plan.mergedPackage}`,shouldStop,now})};
}
