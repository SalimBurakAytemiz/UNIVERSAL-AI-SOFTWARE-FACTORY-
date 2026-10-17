// //TR: Bu modül Provider Hub görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-074): yalnız iki salt-okunur ve zaten izinli GET (GET /v1/system/executors: yürütücü/sağlayıcı durumu, etkin yönlendirme nedeni, ayrı UASCO Claude profilleri; GET /v1/control/status: yönlendirme kapısı olarak global stop) yanıtını güvenli, sınırlı alanlara eşler ve bunlardan sağlayıcı sağlığı/yönlendirme bulguları türetir. HİÇBİR veri uydurulmaz: kimlik/enum/biçim/zaman damgası bozuksa, kayıt yinelenmişse ya da iki alan birbiriyle çelişiyorsa okuma KISMEN değil tümden ERROR olur (fail-closed); eksik alan tahmin edilmez; sunucu durumları yükseltilmez. Sağlayıcı "READY" (hazır/bağlı) YALNIZ gerçek olumlu kanıttan çıkar (yürütücü: READY + enabled=true; profil: READY + kimlik deposu PRESENT + ayar dosyası PRESENT — çalıştırma kapısıyla aynı kural); eksik, doğrulanamayan, reddedilen ya da bilinmeyen sağlayıcı ASLA hazır sayılmaz. Genel düzey (READY) tek bir "en yeni/temsilci" öğeden değil, TÜM beklenen sağlayıcılar üzerinden every/sayım ile türetilir ve yalnız her beklenen sağlayıcı olumluyken, etkin yönlendirme gerçek LOCAL_CLAUDE iken, global stop doğrulanmış-pasifken ve iki kaynak da okunabilirken verilir; zaman damgası hiçbir sıralama/karar anahtarı değildir (sıra sabit kimlik sırasıdır), bu yüzden eksik/bozuk zaman damgası bir öğeyi "zararsız" konuma sıralayamaz. Gizli bilgi (anahtar/token/kimlik deposu içeriği/profil yolu/giriş komutu) ASLA okunmaz ve çıktıya taşınmaz: yalnız varlık/yokluk (PRESENT/ABSENT) ve güvenli kod değerleri eşlenir. Bu modül hiçbir bağlantı kurmaz, etkinleştirmez, sağlayıcı değiştirmez ve ürün doğrulamasını hesaplamaz; ilgili sabit değer bu dosyada hiç yer almaz.
import {CONTROL_PATH,FAIL_CLOSED_STOP_REASONS} from "./operations-core.js";

export const EXECUTORS_PATH="/v1/system/executors";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); ikisi de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const PROVIDER_SOURCES=Object.freeze(["executors","control"]);
export const PROVIDER_SOURCE_PATHS=Object.freeze({executors:EXECUTORS_PATH,control:CONTROL_PATH});
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
/** Dürüst sağlayıcı durumları: yalnız READY olumludur; geri kalanı olumlu kanıt YOKTUR. */
export const PROVIDER_STATUSES=Object.freeze(["READY","NOT_CONNECTED","NOT_VERIFIED","NOT_INSTALLED","UNSUPPORTED","LICENSE_REQUIRED","REFUSED","TEST_ONLY","UNKNOWN"]);
/** Bilinen olumsuz ama kayıtlı durumlar (kurulmamış/bağlı değil/desteklenmiyor/lisans gerekli). */
export const NOT_READY_STATUSES=Object.freeze(["NOT_CONNECTED","NOT_INSTALLED","UNSUPPORTED","LICENSE_REQUIRED"]);
/** Doğrulanamayan durumlar (kanıt yok: ne olumlu ne olumsuz). */
export const UNVERIFIED_STATUSES=Object.freeze(["NOT_VERIFIED","UNKNOWN"]);
/** Beklenen gerçek sağlayıcılar (sıra sabit): yerel Claude yürütücüsü + iki ayrı UASCO Claude profili. Raporlanmayan biri "bilinmiyor"dur; yok sayılmaz. */
export const EXPECTED_PROVIDERS=Object.freeze(["LOCAL_CLAUDE","CLAUDE_IMPLEMENTER","CLAUDE_REVIEWER"]);
export const PROFILE_ROLES=Object.freeze(["implementer","reviewer"]);
export const ROUTING_MODES=Object.freeze(["LOCAL_CLAUDE","TEST_ONLY","NONE","UNKNOWN","NOT_REPORTED"]);
/** Sunucunun "hiçbir yürütücü seçili değil" için ürettiği sabit nedenler (core/workos + server.ts selectExecutors). */
export const NO_EXECUTOR_REASONS=Object.freeze(["EXECUTOR_NOT_CONFIGURED","EXECUTOR_UNKNOWN","EXECUTOR_CONFIG_INVALID","PROVENANCE_MISSING"]);
/** Bulgu önem düzeyleri (sıra = kontrol listesi sırası) ve genel düzeyler (READY yalnız hiç bulgu yokken VE olumlu kanıt tamken). */
export const SEVERITIES=Object.freeze(["BLOCKED","HALTED","UNKNOWN","NOT_READY","UNVERIFIED"]);
export const TIERS=Object.freeze([...SEVERITIES,"READY"]);
export const FINDING_IDS=Object.freeze({
  BLOCKED:Object.freeze(["PROVIDER_REFUSED"]),
  HALTED:Object.freeze(["STOP_ACTIVE","STOP_FAIL_CLOSED"]),
  UNKNOWN:Object.freeze(["SOURCE_UNREADABLE"]),
  NOT_READY:Object.freeze(["PROVIDER_NOT_CONNECTED","PROVIDER_NOT_INSTALLED","PROVIDER_UNSUPPORTED","PROVIDER_LICENSE_REQUIRED","ROUTING_NONE","ROUTING_TEST_ONLY"]),
  UNVERIFIED:Object.freeze(["PROVIDER_NOT_VERIFIED","PROVIDER_UNKNOWN","ROUTING_UNKNOWN","ROUTING_MISMATCH"])});
const SEVERITY_OF_STATUS=Object.freeze({REFUSED:"BLOCKED",NOT_CONNECTED:"NOT_READY",NOT_INSTALLED:"NOT_READY",UNSUPPORTED:"NOT_READY",LICENSE_REQUIRED:"NOT_READY",NOT_VERIFIED:"UNVERIFIED",UNKNOWN:"UNVERIFIED"});
/** Sunucunun/çekirdeğin ürettiği bilinen neden kodları (yerelleştirilmiş açıklaması vardır); tanınmayan geçerli biçimli kod ham gösterilir. */
export const KNOWN_REASON_CODES=Object.freeze(["CLAUDE_PROFILE_LOGIN_REQUIRED","CREDENTIAL_STORE_NOT_A_REGULAR_FILE","PROFILE_PATH_NOT_ABSOLUTE","PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG","PROFILE_PATH_IS_HOME_DIRECTORY","PROFILE_PATH_INSIDE_PROJECT_WORKSPACE","PROFILE_PATH_INSIDE_GIT_WORKTREE","PROFILE_PATH_IS_LINK","CLAUDE_PROFILE_STATUS_UNAVAILABLE","NOT_REPORTED","ENABLEMENT_NOT_REPORTED","EVIDENCE_NOT_REPORTED","SETTINGS_MISSING","SETTINGS_MODIFIED"]);
const MAX_ENTRIES=20;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const TOKEN_RE=/^[A-Z][A-Z0-9_]{0,39}$/,REASON_RE=/^[A-Z][A-Z0-9_:]{0,119}$/,ACTIVE_RE=/^[A-Z][A-Z0-9_]{0,63}$/,ROLE_RE=/^[a-z][a-z0-9_]{0,29}$/;
/** Sürüm metni yalnız güvenli karakterlerden oluşur; yol/kimlik benzeri (ters eğik çizgi, iki nokta, eğik çizgi, tırnak) içeren metin gösterilmez. */
const VERSION_RE=/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,119}$/;
const SOURCE_VALUES=Object.freeze(["SETTING","ENV","NONE"]);
const SETTINGS_VALUES=Object.freeze(["PRESENT","MISSING","MODIFIED"]);
const CREDENTIAL_VALUES=Object.freeze(["PRESENT","ABSENT"]);
/** İsteğe bağlı alan: yok/null -> null, geçerli -> değer, geçersiz -> undefined (okuma reddedilir). */
const opt=(v,ok)=>v===undefined||v===null?null:ok(v)?v:undefined;
const oneOf=list=>x=>typeof x==="string"&&list.includes(x);

/** Sunucu yürütücü durumu -> dürüst sağlayıcı durumu. Tanınmayan (geçerli biçimli) durum UNKNOWN'dur ve ham değeri ayrıca taşınır; hiçbir durum yükseltilmez. */
const EXECUTOR_STATUS=new Map([["READY","READY"],["NOT_CONFIGURED","NOT_CONNECTED"],["NOT_CONNECTED","NOT_CONNECTED"],["PROVENANCE_MISSING","NOT_VERIFIED"],["CLI_NOT_FOUND","NOT_INSTALLED"],["NOT_INSTALLED","NOT_INSTALLED"],["UNSUPPORTED","UNSUPPORTED"],["LICENSE_REQUIRED","LICENSE_REQUIRED"],["TEST_ONLY","TEST_ONLY"]]);
const PROFILE_STATUS=new Map([["READY","READY"],["LOGIN_REQUIRED","NOT_CONNECTED"],["NOT_CONNECTED","NOT_CONNECTED"],["REFUSED","REFUSED"],["NOT_INSTALLED","NOT_INSTALLED"],["UNSUPPORTED","UNSUPPORTED"],["LICENSE_REQUIRED","LICENSE_REQUIRED"]]);

function row(over){
  return {id:null,kind:"EXECUTOR",role:null,serverState:null,status:"UNKNOWN",positive:false,reason:null,enabled:null,source:null,version:null,capturedAt:null,credentialStore:null,settings:null,...over};
}
/** Anahtarlı nesne ya da kimlik alanlı dizi -> [{key,rec}]; biçim bozuk, anahtar geçersiz ya da kimlik yinelenmişse null. */
function entriesOf(v,keyName,keyRe){
  if(Array.isArray(v)){
    const out=[],seen=new Set();
    for(const rec of v){
      if(!isObj(rec)||typeof rec[keyName]!=="string"||!keyRe.test(rec[keyName])||seen.has(rec[keyName]))return null;
      seen.add(rec[keyName]);out.push({key:rec[keyName],rec});
    }
    return out;
  }
  if(isObj(v)){
    const out=[];
    for(const k of Object.keys(v)){if(!keyRe.test(k))return null;out.push({key:k,rec:v[k]})}
    return out;
  }
  return null;
}
/** Tek yürütücü kaydı; çelişki/bozukluk null (tüm okuma reddedilir). Çıktıda yol/giriş komutu/gizli alan taşınmaz (yalnız bilinen alanlar okunur). */
function parseExecutor(id,rec){
  if(!isObj(rec)||typeof rec.state!=="string"||!TOKEN_RE.test(rec.state))return null;
  // Kaydın kendi kimliği (varsa) anahtarıyla çelişemez.
  if(rec.id!==undefined&&rec.id!==id)return null;
  const enabled=opt(rec.enabled,x=>typeof x==="boolean"),source=opt(rec.source,oneOf(SOURCE_VALUES)),ver=opt(rec.version,x=>typeof x==="string"),cap=opt(rec.provenanceCapturedAt,x=>iso(x)!==null);
  if([enabled,source,ver,cap].includes(undefined))return null;
  // Etkin/kaynak çelişkisi: etkin değilken kaynak SETTING/ENV, etkinken kaynak NONE olamaz.
  if(enabled===false&&(source==="SETTING"||source==="ENV"))return null;
  if(enabled===true&&source==="NONE")return null;
  const fake=id==="FAKE";
  // FAKE yalnız test yürütücüsüdür: başka bir durum bildirirse çelişkidir.
  if(fake&&rec.state!=="TEST_ONLY")return null;
  const mapped=EXECUTOR_STATUS.get(rec.state)??"UNKNOWN";
  const common={id,serverState:rec.state,enabled,source,version:ver!==null&&VERSION_RE.test(ver)?ver:null,capturedAt:cap};
  if(fake||mapped==="TEST_ONLY")return row({...common,kind:"TEST",status:"TEST_ONLY",positive:false});
  if(mapped==="READY"){
    // Yürütücü READY ise etkin olmak ZORUNDADIR: etkin değil -> çelişki (red); etkin bilgisi yok -> olumlu kanıt yok (doğrulanamadı).
    if(enabled===false)return null;
    if(enabled===null)return row({...common,status:"NOT_VERIFIED",reason:"ENABLEMENT_NOT_REPORTED"});
    return row({...common,status:"READY",positive:true});
  }
  // NOT_CONFIGURED sunucuda "provenance geçerli ama etkin değil" demektir: etkinken bildirilemez.
  if(rec.state==="NOT_CONFIGURED"&&enabled===true)return null;
  return row({...common,status:mapped});
}
/** Tek profil kaydı (implementer/reviewer). dir/loginCommand/loginHint gibi alanlar BİLEREK okunmaz. */
function parseProfile(role,rec){
  if(!isObj(rec)||typeof rec.state!=="string"||!TOKEN_RE.test(rec.state))return null;
  // Kaydın kendi rolü (varsa) anahtarıyla çelişemez.
  if(rec.role!==undefined&&rec.role!==role)return null;
  const reason=opt(rec.reason,x=>typeof x==="string"&&REASON_RE.test(x)),settings=opt(rec.settings,oneOf(SETTINGS_VALUES)),cred=opt(rec.credentialStore,oneOf(CREDENTIAL_VALUES));
  if([reason,settings,cred].includes(undefined))return null;
  if(rec.state==="READY"&&cred==="ABSENT")return null;
  if(rec.state==="LOGIN_REQUIRED"&&cred==="PRESENT")return null;
  const id=`CLAUDE_${role.toUpperCase()}`;
  const common={id,kind:"PROFILE",role,serverState:rec.state,reason,credentialStore:cred,settings};
  const mapped=PROFILE_STATUS.get(rec.state)??"UNKNOWN";
  if(mapped==="READY"){
    // Çalıştırma kapısıyla aynı kural: READY + ayar dosyası PRESENT. Kimlik deposunun varlığı da açıkça bildirilmelidir; aksi halde olumlu kanıt yoktur.
    if(cred==="PRESENT"&&settings==="PRESENT")return row({...common,status:"READY",positive:true});
    return row({...common,status:"NOT_VERIFIED",reason:settings!==null&&settings!=="PRESENT"?`SETTINGS_${settings}`:"EVIDENCE_NOT_REPORTED"});
  }
  return row({...common,status:mapped});
}
function mapProfiles(v){
  const none={state:"NOT_REPORTED",error:null,items:[]};
  if(v===undefined||v===null)return none;
  // Sunucu profil durumunu okuyamazsa tek alanlı {error} döner: bu "profil yok" değil "okunamadı"dır.
  if(isObj(v)&&has(v,"error")){
    if(Object.keys(v).length!==1||typeof v.error!=="string"||!REASON_RE.test(v.error))return null;
    return {state:"UNAVAILABLE",error:v.error,items:[]};
  }
  const entries=entriesOf(v,"role",ROLE_RE);
  if(entries===null||entries.length>MAX_ENTRIES)return null;
  const items=[];
  for(const {key,rec} of entries){const p=parseProfile(key,rec);if(p===null)return null;items.push(p)}
  if(!items.length)return none;
  return {state:"REPORTED",error:null,items};
}
/** Etkin yönlendirme nedeni -> kip. Tanınmayan geçerli biçimli neden UNKNOWN'dur (ham neden ayrıca taşınır). */
export function routingModeOf(reason){
  if(reason===null)return "NOT_REPORTED";
  if(reason==="LOCAL_CLAUDE")return "LOCAL_CLAUDE";
  if(reason==="FAKE")return "TEST_ONLY";
  return NO_EXECUTOR_REASONS.includes(reason)?"NONE":"UNKNOWN";
}
const idOrder=(order)=>(a,b)=>{
  const ia=order.indexOf(a),ib=order.indexOf(b),ra=ia<0?order.length:ia,rb=ib<0?order.length:ib;
  return ra!==rb?ra-rb:a<b?-1:a>b?1:0;
};

/**
 * GET /v1/system/executors -> {state:"VERIFIED",providers:{executors,active,profiles}} | {state:"ERROR",providers:null}.
 * executors boş/eksik/dizi-olmayan-nesne-olmayan, kayıt biçimi bozuk, kimlik yinelenmiş ya da bir kayıt kendi içinde çelişkiliyse TÜM okuma ERROR olur (kısmi sonuç yok). active ve claudeProfiles isteğe bağlıdır (yoksa "raporlanmadı"); varsa ve bozuksa TÜM okuma ERROR olur.
 * Sıra sabit kimlik sırasıdır (zaman damgası sıralama anahtarı DEĞİLDİR).
 */
export function mapProvidersExecutors(raw){
  const bad={state:"ERROR",providers:null};
  if(!isObj(raw))return bad;
  const entries=entriesOf(raw.executors,"id",TOKEN_RE);
  if(entries===null||entries.length===0||entries.length>MAX_ENTRIES)return bad;
  const executors=[];
  for(const {key,rec} of entries){const e=parseExecutor(key,rec);if(e===null)return bad;executors.push(e)}
  const eo=idOrder(["LOCAL_CLAUDE"]);
  executors.sort((a,b)=>(a.kind==="TEST")!==(b.kind==="TEST")?(a.kind==="TEST"?1:-1):eo(a.id,b.id));
  let active={reported:false,reason:null,mode:"NOT_REPORTED"};
  if(raw.active!==undefined&&raw.active!==null){
    if(!isObj(raw.active)||typeof raw.active.reason!=="string"||!ACTIVE_RE.test(raw.active.reason))return bad;
    active={reported:true,reason:raw.active.reason,mode:routingModeOf(raw.active.reason)};
  }
  const profiles=mapProfiles(raw.claudeProfiles);
  if(profiles===null)return bad;
  const po=idOrder(PROFILE_ROLES);
  profiles.items.sort((a,b)=>po(a.role,b.role));
  return {state:"VERIFIED",providers:{executors,active,profiles}};
}

// ---------- Türetim ----------
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const rankOf=s=>SEVERITIES.indexOf(s);
const missingRow=(id,kind,role,reason)=>row({id,kind,role,reason});

/** Beklenen sağlayıcıları (LOCAL_CLAUDE + iki profil) ve rapor edilen fazlalıkları sabit sırayla birleştirir; raporlanmayan beklenen sağlayıcı "bilinmiyor"dur (olumlu değil, yok sayılmaz). */
function realProviders(P){
  const rows=[];
  const lc=P.executors.find(e=>e.id==="LOCAL_CLAUDE"&&e.kind!=="TEST");
  rows.push(lc??missingRow("LOCAL_CLAUDE","EXECUTOR",null,"NOT_REPORTED"));
  for(const e of P.executors)if(e.kind==="EXECUTOR"&&e.id!=="LOCAL_CLAUDE")rows.push(e);
  const missingReason=P.profiles.state==="UNAVAILABLE"?P.profiles.error:"NOT_REPORTED";
  for(const role of PROFILE_ROLES)rows.push(P.profiles.items.find(p=>p.role===role)??missingRow(`CLAUDE_${role.toUpperCase()}`,"PROFILE",role,missingReason));
  for(const p of P.profiles.items)if(!PROFILE_ROLES.includes(p.role))rows.push(p);
  return rows;
}
function deriveGate(C){
  const failClosed=C.active&&(C.verification==="REJECTED"||FAIL_CLOSED_STOP_REASONS.includes(C.reason));
  return {state:C.active?"ACTIVE":"INACTIVE",failClosed:Boolean(failClosed)};
}

/**
 * İki okuma sonucundan ({executors,control}: mapProvidersExecutors ve operations-core mapOperationsControl çıktıları) sağlayıcı sağlığını ve bulguları türetir.
 * Sayılar yalnız yürütücü kaynağı okunabiliyorsa vardır (aksi halde null, asla 0). Her bulgu kayıtlı bir durumdan türer.
 * Genel düzey: BLOCKED (reddedilen sağlayıcı) > HALTED (global stop aktif) > UNKNOWN (okunamayan kaynak) > NOT_READY (bağlı/kurulu değil, yönlendirme yok/test) > UNVERIFIED (kanıt eksik) > READY.
 * READY YALNIZ hiç bulgu yokken VE olumlu kanıt tamken verilir (savunma: bulgu yoksa ama kanıt eksikse UNVERIFIED). Hiçbir tek öğe seçilmez; tüm sağlayıcılar every/sayım ile değerlendirilir.
 */
export function buildProviders(res){
  res=isObj(res)?res:{};
  const usable={executors:ok(res.executors)&&isObj(res.executors.providers),control:ok(res.control)&&isObj(res.control.control)&&typeof res.control.control.active==="boolean"};
  const sources=Object.fromEntries(PROVIDER_SOURCES.map(k=>[k,{state:usable[k]?"VERIFIED":ok(res[k])?"ERROR":failState(res[k]?.state)}]));
  const unreadable=PROVIDER_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const P=usable.executors?res.executors.providers:null;
  const gate=usable.control?deriveGate(res.control.control):null;
  const providers=P?realProviders(P):null;
  const testOnly=P?P.executors.filter(e=>e.kind==="TEST"):null;
  const routing=P?{...P.active}:null;
  const F=[];
  const add=(id,severity,params={},extra={})=>F.push({id,severity,key:`${id}${extra.key?`:${extra.key}`:""}`,params,route:extra.route??null});
  if(gate&&gate.state==="ACTIVE")add(gate.failClosed?"STOP_FAIL_CLOSED":"STOP_ACTIVE","HALTED",{},{route:"tower"});
  if(providers){
    for(const r of providers){
      if(r.positive)continue;
      const sev=SEVERITY_OF_STATUS[r.status]??"UNVERIFIED";
      add(`PROVIDER_${r.status}`,sev,{providerId:r.id,status:r.status,serverState:r.serverState,reason:r.reason},{key:r.id,route:"settings"});
    }
    const lc=providers.find(r=>r.id==="LOCAL_CLAUDE");
    if(routing.mode==="NONE")add("ROUTING_NONE","NOT_READY",{reason:routing.reason},{route:"settings"});
    else if(routing.mode==="TEST_ONLY")add("ROUTING_TEST_ONLY","NOT_READY",{reason:routing.reason},{route:"settings"});
    else if(routing.mode==="UNKNOWN"||routing.mode==="NOT_REPORTED")add("ROUTING_UNKNOWN","UNVERIFIED",{reason:routing.reason},{});
    // Yönlendirme LOCAL_CLAUDE diyor ama sağlayıcı olumlu değil: sunucu önbelleği ile durum ayrışmış olabilir; hazır sayılmaz.
    else if(routing.mode==="LOCAL_CLAUDE"&&!(lc&&lc.positive))add("ROUTING_MISMATCH","UNVERIFIED",{reason:routing.reason},{route:"settings"});
  }
  for(const k of unreadable)add("SOURCE_UNREADABLE","UNKNOWN",{source:k,state:sources[k].state},{key:k});
  // Kontrol listesi: BLOCKED -> HALTED -> UNKNOWN -> NOT_READY -> UNVERIFIED; aynı düzeyde ekleme sırası korunur (kararlı sıralama).
  const findings=F.map((f,i)=>({f,i})).sort((a,b)=>rankOf(a.f.severity)-rankOf(b.f.severity)||a.i-b.i).map(x=>x.f);
  const counts=providers?{
    total:providers.length,
    ready:providers.filter(r=>r.positive).length,
    notReady:providers.filter(r=>NOT_READY_STATUSES.includes(r.status)).length,
    refused:providers.filter(r=>r.status==="REFUSED").length,
    unverified:providers.filter(r=>UNVERIFIED_STATUSES.includes(r.status)).length
  }:null;
  // Olumlu kanıt: iki kaynak okunur, global stop doğrulanmış-pasif, her beklenen sağlayıcı olumlu (every), etkin yönlendirme gerçek LOCAL_CLAUDE.
  const positiveEvidence=Boolean(providers&&gate&&gate.state==="INACTIVE"&&routing.mode==="LOCAL_CLAUDE"&&providers.length>=EXPECTED_PROVIDERS.length
    &&EXPECTED_PROVIDERS.every(id=>providers.some(r=>r.id===id))&&providers.every(r=>r.positive===true&&r.status==="READY"));
  const tier=findings.length?findings[0].severity:positiveEvidence?"READY":"UNVERIFIED";
  const unknownStates=unreadable.map(k=>sources[k].state);
  const unknownState=unknownStates.includes("OFFLINE")?"OFFLINE":unknownStates.includes("ERROR")?"ERROR":unknownStates.length?"UNAVAILABLE":null;
  const bySeverity=Object.fromEntries(SEVERITIES.map(s=>[s,findings.filter(x=>x.severity===s).length]));
  return {sources,unreadable,unknownState,gate,routing,providers,testOnly,counts,findings,bySeverity,tier};
}
