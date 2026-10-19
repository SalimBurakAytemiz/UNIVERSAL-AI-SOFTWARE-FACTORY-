// //TR: Bu modül UI-003 "Dönüş Özeti" (son ziyaretten beri ne oldu) görünümünün saf (DOM'suz) çekirdeğidir: YALNIZ executive-core.js'in zaten eşlediği iki salt-okunur okumayı (GET /v1/work-runs, GET /v1/missions; ikisi de önceden izinlidir, yeni uç nokta yoktur) ve bu cihazda tutulan bir "son görülme" işaretini kullanır. İşaret istemci saati DEĞİL, sunucu kayıtlarının en yeni zaman damgasıdır (filigran); yalnız Founder "görüldü" dediğinde yazılır ve sunucuya hiçbir şey gönderilmez. HİÇBİR değer uydurulmaz: okunamayan kaynak 0 değil dürüst durumunu taşır, bozuk işaret yok sayılır, gruplama koşunun GÜNCEL durumuna göredir (aradaki geçişler yeniden kurulmaz). Ürün doğrulaması bu modülde hiçbir yerde üretilmez.
import {TERMINAL_RUN_STATUSES,AWAITING_RUN_STATUS} from "./executive-core.js";

export const RETURN_SEEN_STORAGE_KEY="uasco.executive.returnSeenAt";
export const MAX_RETURN_ROWS=50;
/** Gösterim sırası: Founder eylemi bekleyenler önce, sonra hata/engel, sonra tamamlanan/durdurulan, en son süren işler. */
export const RETURN_GROUPS=Object.freeze(["awaiting","failed","blocked","completed","stopped","active"]);
const GROUP_FOR_STATUS=Object.freeze({[AWAITING_RUN_STATUS]:"awaiting",FAILED:"failed",RECOVERY_FAILED:"failed",BLOCKED:"blocked",QUARANTINED:"blocked",SUCCEEDED:"completed",CANCELLED:"stopped",CANCELLING:"stopped"});
/** Koşu durumu -> dönüş grubu; terminal olmayan ve Founder beklemeyen her durum "active"tir. */
export const groupForStatus=s=>GROUP_FOR_STATUS[s]??(TERMINAL_RUN_STATUSES.includes(s)?"stopped":"active");

const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const ts=x=>{const t=Date.parse(x);return Number.isNaN(t)?null:t};

/** İşaret yalnız kanonik ISO-8601 UTC (toISOString biçimi) olabilir; başka her değer (boş, yerel tarih, kısmi tarih, sayı) geçersizdir. */
export function canonicalSeen(x){
  if(typeof x!=="string"||x.length!==24)return null;
  const t=Date.parse(x);
  return Number.isNaN(t)||new Date(t).toISOString()!==x?null:x;
}
/** -> {storage:"AVAILABLE"|"UNAVAILABLE", seen:iso|null, invalid:boolean}. Depo yoksa ya da okuma atarsa UNAVAILABLE; bozuk değer yok sayılır ve invalid:true döner. */
export function readSeen(storage){
  if(!storage||typeof storage.getItem!=="function")return {storage:"UNAVAILABLE",seen:null,invalid:false};
  let raw;
  try{raw=storage.getItem(RETURN_SEEN_STORAGE_KEY)}catch{return {storage:"UNAVAILABLE",seen:null,invalid:false}}
  if(raw===null||raw===undefined)return {storage:"AVAILABLE",seen:null,invalid:false};
  const seen=canonicalSeen(raw);
  return {storage:"AVAILABLE",seen,invalid:seen===null};
}
/** İşareti yazar; yalnız kanonik değer kabul edilir. Başarı true, depo yok/yazma hatası/geçersiz değer false (asla atmaz). */
export function storeSeen(storage,iso){
  const v=canonicalSeen(iso);
  if(v===null||!storage||typeof storage.setItem!=="function")return false;
  try{storage.setItem(RETURN_SEEN_STORAGE_KEY,v);return true}catch{return false}
}

/**
 * Filigran: okunabilen kaynaklardaki EN YENİ sunucu zaman damgası (koşu updatedAt/createdAt, kabul edilen teslim acceptedAt, mission createdAt).
 * İstemci saati hiç kullanılmaz; hiçbir kayıt yoksa null (işaretlenecek bir şey yok).
 */
export function returnWatermark(runs,missions){
  let best=null,bestT=-Infinity;
  const see=x=>{const t=ts(x);if(t!==null&&t>bestT){bestT=t;best=new Date(t).toISOString()}};
  if(isOk(runs)&&runs.runs)for(const r of runs.runs.items){see(r.updatedAt);see(r.createdAt);if(r.delivery&&r.delivery.accepted)see(r.delivery.accepted.acceptedAt)}
  if(isOk(missions)&&missions.missions)for(const m of missions.missions.items)see(m.createdAt);
  return best;
}

const capped=items=>({count:items.length,items:items.slice(0,MAX_RETURN_ROWS),truncated:items.length>MAX_RETURN_ROWS});

/**
 * Dönüş özeti. runs ve missions, executive-core.js mapExecWorkRuns/mapExecMissions sonuçlarıdır; seen readSeen().seen'dir.
 * -> {state, since, watermark, groups, missions, deliveries, total, nothingNew}
 *  state: koşu okuması başarısızsa onun dürüst durumu (OFFLINE/UNAVAILABLE/ERROR; özet yok);
 *         işaret yoksa FIRST_VISIT (özet yok, hiçbir şey "yeni" sayılmaz);
 *         aksi halde VERIFIED, mission okuması başarısızsa PARTIAL (mission sayısı 0 değil null'dır).
 * Yalnız işaretten KESİN sonraki kayıtlar sayılır (eşit zaman damgası "görülmüş"tür).
 */
export function returnSummary({runs,missions},seen){
  const since=canonicalSeen(seen);
  if(!isOk(runs)||!runs.runs)return {state:failState(runs?.state),since,watermark:null,groups:null,missions:null,deliveries:null,total:null,nothingNew:false};
  const watermark=returnWatermark(runs,missions);
  if(since===null)return {state:"FIRST_VISIT",since:null,watermark,groups:null,missions:null,deliveries:null,total:null,nothingNew:false};
  const s=ts(since),after=x=>{const t=ts(x);return t!==null&&t>s};
  const changed=runs.runs.items.filter(r=>after(r.updatedAt));
  const groups={};
  for(const g of RETURN_GROUPS)groups[g]=capped(changed.filter(r=>groupForStatus(r.status)===g));
  const deliveries=capped(runs.runs.items.filter(r=>r.delivery&&r.delivery.accepted&&after(r.delivery.accepted.acceptedAt)));
  const msOk=isOk(missions)&&missions.missions;
  const newMissions=msOk?{state:"VERIFIED",...capped(missions.missions.items.filter(m=>after(m.createdAt)))}:{state:failState(missions?.state),count:null,items:[],truncated:false};
  const total=changed.length+deliveries.count+(newMissions.count??0);
  return {state:msOk?"VERIFIED":"PARTIAL",since,watermark,groups,missions:newMissions,deliveries,total,nothingNew:msOk&&total===0};
}
