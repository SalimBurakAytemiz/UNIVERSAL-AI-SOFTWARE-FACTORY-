// //TR: Bu modül süpervizörün denetimli kendini güncellemesidir (Founder kararı 2026-10-01): master'ın ucu kontrol durumunda kayıtlı governed bir hızlı ileri birleştirmeyse, çalışan kontrol düzleminin torunuysa ve korumalı kontrol düzlemi dosyalarını değiştiriyorsa yeni düzlem yalnız tam komut sözleşmeleriyle hazırlanır (yerel klon, ayrık checkout, gözden geçirilmiş kilitle bağımlılık, mühürlü trust-root doğrulaması), Task Scheduler'ın başlattığı sabit control\current bağlantısı yeni düzleme çevrilir ve eski düzlem geri dönüş için silinmez. Hiçbir koşul sağlanmazsa hiçbir şey değişmez.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
import {writeJsonAtomic,readJsonIfExists} from "./atomic-json.mjs";
export const UPGRADE_EXIT_CODE=4;
const SHA40=/^[0-9a-f]{40}$/,sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function controlPlaneLayout(policy){const dir=path.join(policy.roots.controlRoot,"control");return {dir,current:path.join(dir,"current"),record:path.join(dir,"CURRENT.json")}}
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
// //TR: Bağlantı değişimi: yeni bağlantı yanında hazırlanır, eski bağlantı (yalnız bağlantı, hedefi değil) kaldırılır ve yenisi adına taşınır; aradaki çok kısa boşlukta tetiklenen görev başarısız olur ve Task Scheduler yeniden dener.
export function switchJunction(link,target){const next=`${link}.next`;try{if(fs.lstatSync(next).isSymbolicLink())fs.unlinkSync(next)}catch{}
  fs.symlinkSync(target,next,"junction");let old=null;try{if(fs.lstatSync(link).isSymbolicLink()){old=fs.realpathSync(link);fs.unlinkSync(link)}else throw new Error("CONTROL_PLANE_LINK_NOT_A_JUNCTION")}catch(e){if(e.code!=="ENOENT")throw e}fs.renameSync(next,link);return {previous:old,current:fs.realpathSync(link)}}
// //TR: Yeni düzlemin hazırlanması yalnız sözleşmelerle yapılır; bağımlılıklar gözden geçirilmiş kilit aynıysa çalışan düzlemden çevrimdışı kopyalanır, ardından kurulum betiği kilidi doğrular; mühürlü trust-root doğrulanmadan bağlantı değişmez.
export function performControlPlaneUpgrade({runner,policy,repo,masterSha,planeCommit,runningPlane,reason,now=()=>new Date()}){
  const L=controlPlaneLayout(policy),dest=path.join(L.dir,masterSha.slice(0,12));
  if(!fs.existsSync(dest))runner.must("git.cloneLocal",{source:repo,dest});else runner.must("git.fetchOrigin",{cwd:dest});
  runner.must("git.checkoutDetached",{cwd:dest,commit:masterSha});const head=runner.must("git.headCommit",{cwd:dest}).stdout.trim();if(head!==masterSha)throw new Error(`CONTROL_PLANE_HEAD_MISMATCH:${head}`);
  if(runner.must("git.status",{cwd:dest}).stdout.trim())throw new Error("CONTROL_PLANE_CLONE_NOT_CLEAN");
  const lockOld=path.join(runningPlane,"package-lock.json"),lockNew=path.join(dest,"package-lock.json"),nmOld=path.join(runningPlane,"node_modules"),nmNew=path.join(dest,"node_modules");
  if(!fs.existsSync(nmNew)&&fs.existsSync(nmOld)&&fs.existsSync(lockOld)&&fs.existsSync(lockNew)&&sha(lockOld)===sha(lockNew))fs.cpSync(nmOld,nmNew,{recursive:true,dereference:true});
  runner.must("node.script",{script:"scripts/ensure-dependencies.mjs",cwd:dest});
  const vt=runner.run("node.script",{script:"scripts/verify-trust-root.mjs",cwd:dest});if(vt.status!==0)throw new Error("CONTROL_PLANE_TRUST_ROOT_NOT_VERIFIED");
  const sw=switchJunction(L.current,dest),rec={"//TR":"Bu kayıt Task Scheduler'ın başlattığı control\\current bağlantısının gösterdiği kontrol düzlemini ve bir öncekini tutar; geri dönüş için eski düzlem silinmez.",commit:masterSha,path:dest,activatedAt:now().toISOString(),reason,previous:{commit:planeCommit,path:runningPlane,linkTarget:sw.previous}};
  writeJsonAtomic(L.record,rec);return {status:"UPGRADED",from:planeCommit,to:masterSha,path:dest,record:rec};
}
// //TR: Süpervizör girişi: yalnız kontrol kökünün altındaki etkinleştirilmiş bir düzlemden çalışıyorsa denenir; her yoklama sözleşmeyle yapılır ve başarısızlık hiçbir şeyi değiştirmez.
export function checkAndUpgrade({runner,policy,repo,runningPlane,control,globalStop=null,now=()=>new Date()}){
  const s=policy?.selfUpgrade;if(!s?.enabled)return {upgrade:false,reason:"SELF_UPGRADE_DISABLED"};
  let planeCommit,masterSha;try{planeCommit=runner.must("git.headCommit",{cwd:runningPlane}).stdout.trim()}catch(e){return {upgrade:false,reason:"PLANE_NOT_UNDER_CONTROL_ROOT"}}
  masterSha=runner.must("git.revParse",{cwd:repo,rev:policy.merge.defaultBranchRef}).stdout.trim();if(masterSha===planeCommit)return {upgrade:false,reason:"ALREADY_CURRENT"};
  const anc=runner.run("git.isAncestor",{cwd:repo,ancestor:planeCommit,descendant:masterSha}),changed=anc.status===0?runner.must("git.diffNames",{cwd:repo,base:planeCommit,head:masterSha}).stdout.split(/\r?\n/).filter(Boolean):[];
  const plan=planControlPlaneUpgrade({control,masterSha,planeCommit,isDescendant:anc.status===0,changedPaths:changed,protectedPaths:protectedPathsOf(runningPlane),policy,globalStop});if(!plan.upgrade)return plan;
  return {...plan,...performControlPlaneUpgrade({runner,policy,repo,masterSha,planeCommit,runningPlane,reason:`${plan.reason}:${plan.mergedPackage}`,now})};
}
