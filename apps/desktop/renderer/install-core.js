// //TR: Bu modül İlk Çalıştırma Kurulum Doğrulaması görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-248): yalnız üç salt-okunur ve zaten izinli GET (GET /v1/install, GET /v1/phase0, GET /v1/system/executors) yanıtını güvenli, sınırlı alanlara eşler. Sunucunun `verification` alanı (VERIFIED | PENDING | REJECTED) ve `final`/`phase0Final` değeri AYNEN taşınır; hiçbir durum yükseltilmez, hiçbir doğrulama uydurulmaz. Çelişkili yanıt (ör. VERIFIED ama final CLEAN değil) ya da tek bozuk kayıt KISMEN değil tümden ERROR olur. Hassas alanlar bilerek taşınmaz: bileşen dosya yolları (file), dosya özetleri (sha256), girdi özetlerinin yolları, imza değeri (yalnız var/yok bilgisi) ve serbest metin hata/ayrıntı alanları (hata kodları yalnız katı bir desene uyarsa taşınır). Yürütücü okuması mevcut mapExecutors eşleyicisini (project-core.js) YENİDEN kullanır; kopya yoktur. Ürün doğrulaması bu modülde hiçbir yerde üretilmez ve ilgili sabit değer bu dosyada hiç yer almaz.
import {EXECUTORS_PATH} from "./project-core.js";
import {shortSha} from "./executive-core.js";

export {EXECUTORS_PATH,shortSha};
export const INSTALL_PATH="/v1/install";
export const PHASE0_PATH="/v1/phase0";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); üçü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const INSTALL_SOURCES=Object.freeze(["install","phase0","executors"]);
export const INSTALL_SOURCE_PATHS=Object.freeze({install:INSTALL_PATH,phase0:PHASE0_PATH,executors:EXECUTORS_PATH});
/** Sunucunun doğrulama kararları (AYNEN taşınır). Yalnız VERIFIED başarıdır ve yalnız sunucu söylerse. */
export const VERIFICATIONS=Object.freeze(["VERIFIED","PENDING","REJECTED"]);
/** Phase-0 kabulünün temiz sayılan sonuçları; VERIFIED doğrulama yalnız bunlarla birlikte tutarlıdır. */
export const CLEAN_FINALS=Object.freeze(["CLEAN","CLEAN_LOCAL_ONLY"]);
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
export const MAX_COMPONENTS=64;
export const MAX_CHECKS=64;
export const MAX_ERRORS=50;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const ID_RE=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const CODE_RE=/^[A-Z][A-Z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;
const INSTALL_ID_RE=/^INSTALL-[A-Za-z0-9._:-]{1,120}$/;
const SHA_RE=/^[0-9a-f]{40,64}$/;
/** Serbest metin hata iletisi (yol/ayrıntı sızabilir) taşınmaz; yalnız KOD biçimli hatalar AYNEN, diğerleri sabit bir yer tutucuyla. */
export const WITHHELD_ERROR="ERROR_DETAIL_WITHHELD";
const errorCode=x=>typeof x==="string"&&CODE_RE.test(x)?x:WITHHELD_ERROR;

/** errors: yoksa [], dizi değilse/çok uzunsa null (okuma reddedilir). */
function mapErrors(x){
  if(x===undefined||x===null)return [];
  if(!Array.isArray(x)||x.length>MAX_ERRORS||x.some(e=>typeof e!=="string"))return null;
  return x.map(errorCode);
}
/** verification alanı kapalı kümede olmalı (bilinmeyen değer tahmin edilmez). */
const verificationOf=raw=>VERIFICATIONS.includes(raw.verification)?raw.verification:null;

/** Bileşen satırı: yalnız {id,present,status}. file/sha256 bilerek taşınmaz. */
function mapComponent(id,row){
  if(!ID_RE.test(id)||!isObj(row)||typeof row.present!=="boolean")return null;
  const status=text(row.status,64);if(status===null)return null;
  return {id,present:row.present,status};
}
/**
 * GET /v1/install -> {state:"VERIFIED",install:{...}} | {state:"ERROR",install:null}. `state` OKUMANIN durumudur; kurulum kararı install.verification'dadır (AYNEN).
 * Tek bozuk bileşen/hata ya da çelişki (VERIFIED ama phase0Final temiz değil) tüm okumayı ERROR yapar. Dosya yolu, özet ve digest taşınmaz.
 */
export function mapInstallReport(raw){
  const bad={state:"ERROR",install:null};
  if(!isObj(raw))return bad;
  const verification=verificationOf(raw),phase0Final=text(raw.phase0Final,64);
  if(verification===null||phase0Final===null||!isObj(raw.components))return bad;
  const errors=mapErrors(raw.errors);if(errors===null)return bad;
  const entries=Object.entries(raw.components);
  if(entries.length>MAX_COMPONENTS)return bad;
  const components=[];
  for(const [id,row] of entries){const c=mapComponent(id,row);if(c===null)return bad;components.push(c)}
  let installId=null,generatedAt=null,schemaVersion=null,sourceCommit=null;
  if(verification==="VERIFIED"){
    // Doğrulanmış rapor eksiksiz ve Phase-0 temizliğiyle tutarlı olmalıdır; aksi halde elevate etmek yerine reddedilir.
    if(!CLEAN_FINALS.includes(phase0Final)||errors.length>0)return bad;
    if(typeof raw.installId!=="string"||!INSTALL_ID_RE.test(raw.installId))return bad;
    installId=raw.installId;generatedAt=iso(raw.generatedAt);schemaVersion=text(raw.schemaVersion,32);
    if(generatedAt===null||schemaVersion===null)return bad;
    if(raw.phase0SourceCommit!==undefined&&raw.phase0SourceCommit!==null){if(typeof raw.phase0SourceCommit!=="string"||!SHA_RE.test(raw.phase0SourceCommit))return bad;sourceCommit=shortSha(raw.phase0SourceCommit)}
  }else{
    // PENDING/REJECTED: bileşen listesi sunucu gereği boştur; doldurulmuş bir bileşen listesi çelişkidir. REJECTED hata listesi ister.
    if(components.length>0)return bad;
    if(verification==="REJECTED"&&(raw.errors===undefined||CLEAN_FINALS.includes(phase0Final)))return bad;
    if(verification==="PENDING"&&errors.length>0)return bad;
  }
  return {state:"VERIFIED",install:{verification,phase0Final,installId,generatedAt,schemaVersion,sourceCommit,components,errors}};
}

/** Bir Phase-0 kontrolü: değer düz durum metni ya da {status} olabilir; ayrıntı (detail) serbest metindir ve taşınmaz. */
function mapCheck(name,v){
  if(!ID_RE.test(name))return null;
  const status=isObj(v)?text(v.status,64):text(v,64);
  return status===null?null:{name,status};
}
/**
 * GET /v1/phase0 -> {state:"VERIFIED",phase0:{...}} | {state:"ERROR",phase0:null}. `final` ve `verification` AYNEN; VERIFIED yalnız final CLEAN/CLEAN_LOCAL_ONLY ile tutarlıysa kabul edilir.
 * İmza değeri taşınmaz (yalnız signed: var/yok); girdi özetlerinin yolları/özetleri taşınmaz (yalnız sayılar).
 */
export function mapPhase0Report(raw){
  const bad={state:"ERROR",phase0:null};
  if(!isObj(raw))return bad;
  const verification=verificationOf(raw),final=text(raw.final,64);
  if(verification===null||final===null)return bad;
  const errors=mapErrors(raw.errors);if(errors===null)return bad;
  let installId=null,generatedAt=null,schemaVersion=null,sourceCommit=null,signed=false,checks=[],inputs=null;
  if(verification==="VERIFIED"){
    if(!CLEAN_FINALS.includes(final)||errors.length>0)return bad;
    if(typeof raw.installId!=="string"||!INSTALL_ID_RE.test(raw.installId))return bad;
    installId=raw.installId;generatedAt=iso(raw.generatedAt);schemaVersion=text(raw.schemaVersion,32);
    if(generatedAt===null||schemaVersion===null||!isObj(raw.checks)||typeof raw.sealSignature!=="string"||!raw.sealSignature)return bad;
    if(typeof raw.sourceCommit!=="string"||!SHA_RE.test(raw.sourceCommit))return bad;
    sourceCommit=shortSha(raw.sourceCommit);signed=true;
    const entries=Object.entries(raw.checks);if(entries.length>MAX_CHECKS)return bad;
    for(const [name,v] of entries){const c=mapCheck(name,v);if(c===null)return bad;checks.push(c)}
    if(raw.inputDigests!==undefined&&raw.inputDigests!==null){
      if(!isObj(raw.inputDigests))return bad;
      const rows=Object.values(raw.inputDigests);
      if(rows.length>MAX_CHECKS||rows.some(r=>!isObj(r)||typeof r.present!=="boolean"))return bad;
      inputs={total:rows.length,present:rows.filter(r=>r.present).length};
    }
  }else{
    if(verification==="REJECTED"&&(raw.errors===undefined||CLEAN_FINALS.includes(final)))return bad;
    if(verification==="PENDING"&&errors.length>0)return bad;
  }
  return {state:"VERIFIED",phase0:{verification,final,installId,generatedAt,schemaVersion,sourceCommit,signed,checks,inputs,errors}};
}

// ---------- Birleşik model ----------
/** Okuma sonucu yalnız eşleyici çıktısı eksiksizse kullanılabilir (VERIFIED ama gövdesi eksik okuma ERROR sayılır). */
const BODY_KEY=Object.freeze({install:"install",phase0:"phase0",executors:"items"});
const usableOf=(k,r)=>ok(r)&&(k==="executors"?Array.isArray(r.items):Boolean(r[BODY_KEY[k]]));
/**
 * Üç okuma sonucundan ({install,phase0,executors}: mapInstallReport / mapPhase0Report / mapExecutors çıktıları) görünüm modelini türetir.
 * Hiçbir kaynaktan genel bir "kurulum tamam" kararı türetilmez; her kaynağın kararı kendi başına AYNEN taşınır. Okunamayan kaynak null'dır (boş/0 değil).
 * Çapraz denetim: install.phase0Final ile phase0.final ikisi de okunduysa karşılaştırılır; uyuşmazlık düzeltilmez, iki değer olduğu gibi bildirilir.
 */
export function buildInstall(res){
  const usable=Object.fromEntries(INSTALL_SOURCES.map(k=>[k,usableOf(k,res[k])]));
  const sources=Object.fromEntries(INSTALL_SOURCES.map(k=>[k,{state:usable[k]?"VERIFIED":ok(res[k])?"ERROR":failState(res[k]?.state)}]));
  const unreadable=INSTALL_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const install=usable.install?res.install.install:null,phase0=usable.phase0?res.phase0.phase0:null;
  const ex=usable.executors?{items:res.executors.items.map(x=>({id:x.id,state:x.state,testOnly:x.testOnly===true})),sandbox:res.executors.sandbox??null,profiles:Array.isArray(res.executors.profiles)?res.executors.profiles.map(p=>({role:p.role,state:p.state,reason:p.reason??null})):[]}:null;
  const reconcile=install&&phase0?{install:install.phase0Final,phase0:phase0.final,agree:install.phase0Final===phase0.final}:null;
  const pendingAny=[install,phase0].some(x=>x&&x.verification==="PENDING"),rejectedAny=[install,phase0].some(x=>x&&x.verification==="REJECTED");
  const counts=install?{total:install.components.length,present:install.components.filter(c=>c.present).length}:null;
  return {sources,unreadable,complete:unreadable.length===0,install,phase0,executors:ex,reconcile,counts,pendingAny,rejectedAny};
}
