// //TR: Bu modül Company OS (CRM, Finans, Hukuk) görünümünün saf (DOM'suz) veri modelidir: GET /v1/company/* sözleşmelerinin eşleyicileri, durum sınıflandırma (EMPTY/UNAVAILABLE/NOT_CONNECTED/OFFLINE/FAILED/STALE), kuruş-tam para biçimleyici ve para birimi bazlı toplamlar; eksik veya geçersiz alan asla sayıya/değere çevrilmez, "—" kalır; bir taslak fatura ödenmiş, bir teklif/fırsat imzalı sayılmaz.
import {MISSING} from "./model.js";

/** Salt-okunur liste uçları; sorgu parametresi yoktur (süzme istemcide, zaten alınmış gerçek kayıtlar üzerinde yapılır). */
export const COMPANY_PATHS=Object.freeze({
  accounts:"/v1/company/accounts",contacts:"/v1/company/contacts",opportunities:"/v1/company/opportunities",
  invoices:"/v1/company/invoices",payments:"/v1/company/payments",contracts:"/v1/company/contracts"
});
export const COMPANY_KEYS=Object.freeze(Object.keys(COMPANY_PATHS));
/** Görünüm sekmeleri ve her sekmenin okuduğu kaynaklar. */
export const COMPANY_TABS=Object.freeze(["crm","finance","legal"]);
export const TAB_SOURCES=Object.freeze({crm:["accounts","contacts","opportunities"],finance:["invoices","payments"],legal:["contracts"]});
export const OPPORTUNITY_STAGES=Object.freeze(["LEAD","QUALIFIED","PROPOSAL","WON","LOST"]);
export const OPEN_STAGES=Object.freeze(["LEAD","QUALIFIED","PROPOSAL"]);
export const INVOICE_STATUSES=Object.freeze(["DRAFT","ISSUED","PARTIALLY_PAID","PAID","VOID"]);
export const CONTRACT_STATUSES=Object.freeze(["DRAFT","SENT","SIGNED","DECLINED","EXPIRED"]);

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max=300)=>typeof x==="string"&&x.trim()?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&!Number.isNaN(new Date(x).getTime())?x:null;
const minor=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const currency=x=>typeof x==="string"&&/^[A-Z]{3}$/.test(x)?x:null;
const idOf=(prefix,x)=>typeof x==="string"&&new RegExp(`^${prefix}_[0-9a-f]{24}$`).test(x)?x:null;
const sha256=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x)?x:null;

function mapList(raw,field,mapOne){
  if(!isObj(raw)||!Array.isArray(raw[field]))return {state:"ERROR",items:[]};
  return {state:"VERIFIED",items:raw[field].filter(isObj).map(mapOne).filter(Boolean)};
}
const byNewest=(a,b)=>String(b.createdAt??"").localeCompare(String(a.createdAt??""))||String(a.id).localeCompare(String(b.id));
export function mapAccounts(raw){
  const r=mapList(raw,"accounts",a=>{const id=idOf("acc",a.accountId);return id?{id,name:str(a.name,200),createdAt:iso(a.createdAt)}:null});
  return {...r,items:r.items.sort((a,b)=>String(a.name??"").localeCompare(String(b.name??""))||a.id.localeCompare(b.id))};
}
export function mapContacts(raw){
  const r=mapList(raw,"contacts",c=>{const id=idOf("cnt",c.contactId);return id?{id,accountId:idOf("acc",c.accountId),name:str(c.name,200),role:str(c.role,100),email:str(c.email,254),createdAt:iso(c.createdAt)}:null});
  return {...r,items:r.items.sort(byNewest)};
}
export function mapOpportunities(raw){
  const r=mapList(raw,"opportunities",o=>{const id=idOf("opp",o.opportunityId);return id?{id,accountId:idOf("acc",o.accountId),title:str(o.title,200),stage:str(o.stage,40),amountMinor:minor(o.amountMinor),currency:currency(o.currency),createdAt:iso(o.createdAt),updatedAt:iso(o.updatedAt)}:null});
  return {...r,items:r.items.sort(byNewest)};
}
export function mapInvoices(raw){
  const r=mapList(raw,"invoices",i=>{
    const id=idOf("inv",i.invoiceId);if(!id)return null;
    const total=minor(i.totalMinor),paid=minor(i.paidMinor),bal=minor(i.balanceMinor);
    return {id,accountId:idOf("acc",i.accountId),number:str(i.number,40),status:str(i.status,40),currency:currency(i.currency),totalMinor:total,paidMinor:paid,
      balanceMinor:bal!==null?bal:total!==null&&paid!==null&&total>=paid?total-paid:null,dueDate:str(i.dueDate,10),issuedAt:iso(i.issuedAt),voidedAt:iso(i.voidedAt),createdAt:iso(i.createdAt),lineCount:Array.isArray(i.lineItems)?i.lineItems.length:null};
  });
  return {...r,items:r.items.sort(byNewest)};
}
export function mapPayments(raw){
  const r=mapList(raw,"payments",p=>{const id=idOf("pay",p.paymentId);return id?{id,invoiceId:idOf("inv",p.invoiceId),entryKind:p.entryKind==="REVERSAL"?"REVERSAL":p.entryKind==="PAYMENT"?"PAYMENT":null,amountMinor:minor(p.amountMinor),currency:currency(p.currency),receivedAt:iso(p.receivedAt),reference:str(p.reference,100),reversesPaymentId:idOf("pay",p.reversesPaymentId),createdAt:iso(p.createdAt)}:null});
  return {...r,items:r.items.sort((a,b)=>String(b.receivedAt??b.createdAt??"").localeCompare(String(a.receivedAt??a.createdAt??""))||a.id.localeCompare(b.id))};
}
export function mapContracts(raw){
  const r=mapList(raw,"contracts",c=>{
    const id=idOf("ctr",c.contractId);if(!id)return null;
    return {id,accountId:idOf("acc",c.accountId),opportunityId:idOf("opp",c.opportunityId),title:str(c.title,200),status:str(c.status,40),
      sentAt:iso(c.sentAt),signedAt:iso(c.signedAt),closedAt:iso(c.closedAt),signerName:str(c.signerName,200),documentSha256:sha256(c.documentSha256),createdAt:iso(c.createdAt)};
  });
  return {...r,items:r.items.sort(byNewest)};
}
export const COMPANY_MAPPERS=Object.freeze({accounts:mapAccounts,contacts:mapContacts,opportunities:mapOpportunities,invoices:mapInvoices,payments:mapPayments,contracts:mapContracts});

/**
 * //TR: Başarısız bir okuma sonucunu dürüst Company OS durumuna çevirir: köprü allow-list'i yolu kabul etmediyse (INVALID_API_PATH) NOT_CONNECTED (bu masaüstü derlemesi Company OS okumasına bağlı değil), 404/501/503 UNAVAILABLE, ağ OFFLINE, diğer hatalar ERROR.
 * r: api.get sonucu ({state,status,message}).
 */
export function companyFailureState(r){
  const msg=String(r?.message??"");
  if(/INVALID_API_PATH/.test(msg))return "NOT_CONNECTED";
  if(r?.status===503)return "UNAVAILABLE";
  return r?.state==="OFFLINE"||r?.state==="UNAVAILABLE"?r.state:"ERROR";
}
/** Kaynak durumunun ayrık rozet türü (statePill): canlı+boş=EMPTY, ERROR=FAILED; NOT_CONNECTED/UNAVAILABLE/OFFLINE/STALE ayrı kalır. */
export function companyPillKind(res){
  if(!res||res.loading===true)return "LOADING";
  switch(res.state){
    case "VERIFIED":return res.items.length===0?"EMPTY":"VERIFIED";
    case "STALE":return "STALE";
    case "NOT_CONNECTED":return "NOT_CONNECTED";
    case "OFFLINE":return "OFFLINE";
    case "ERROR":return "FAILED";
    default:return "UNAVAILABLE";
  }
}
export const isLive=res=>Boolean(res)&&res.loading!==true&&(res.state==="VERIFIED"||res.state==="STALE");
/** Bilinmeyen kaynak (henüz alınmamış) için boş sonuç. */
export const emptyResource=(state="UNAVAILABLE")=>({state,items:[],asOf:null,cause:null,message:null});

// ---------- Para ----------
const FRACTION_CACHE=new Map();
/** Para biriminin küçük birim üssü (Intl'den: TRY/USD=2, JPY=0, KWD=3); biçimleyici yoksa 2. */
export function currencyExponent(code){
  if(FRACTION_CACHE.has(code))return FRACTION_CACHE.get(code);
  let d=2;try{d=new Intl.NumberFormat("en",{style:"currency",currency:code}).resolvedOptions().maximumFractionDigits}catch{d=2}
  if(!Number.isInteger(d)||d<0||d>4)d=2;FRACTION_CACHE.set(code,d);return d;
}
/** Küçük birim tutarı (tamsayı/BigInt) ondalık metne çevirir; kayan nokta kullanılmaz. Geçersiz tutar/para birimi "—". */
export function formatMoney(amountMinor,code,lang="tr"){
  const cur=currency(code);
  let big;try{big=typeof amountMinor==="bigint"?amountMinor:Number.isSafeInteger(amountMinor)&&amountMinor>=0?BigInt(amountMinor):null}catch{big=null}
  if(big===null||big<0n||cur===null)return MISSING;
  const d=currencyExponent(cur),base=10n**BigInt(d),loc=lang==="en"?"en-GB":"tr-TR";
  const whole=big/base,frac=big%base;
  let grouped;try{grouped=new Intl.NumberFormat(loc,{useGrouping:true}).format(whole)}catch{grouped=String(whole)}
  let sep=lang==="en"?".":",";try{sep=new Intl.NumberFormat(loc).formatToParts(1.1).find(p=>p.type==="decimal")?.value??sep}catch{/* varsayılan ayırıcı */}
  return `${grouped}${d>0?sep+String(frac).padStart(d,"0"):""} ${cur}`;
}
/** Kayıtları para birimine göre ayrı toplar (farklı para birimleri asla toplanmaz); tutarı olmayan/geçersiz kayıt toplama girmez ve skipped sayılır. */
export function sumByCurrency(items,pick){
  const sums=new Map();let skipped=0;
  for(const it of items){
    const v=pick(it),cur=currency(it.currency);
    if(v===null||v===undefined||cur===null||!Number.isSafeInteger(v)||v<0){skipped+=1;continue}
    sums.set(cur,(sums.get(cur)??0n)+BigInt(v));
  }
  return {totals:[...sums.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([cur,total])=>({currency:cur,minor:total})),skipped};
}

// ---------- Dürüst durum kuralları ----------
/** //TR: "PAID" yalnız sunucu durumu PAID ve ödenen tutar toplamı karşılıyorsa gösterilir; tutarsız kayıt NOT_VERIFIED olur. Taslak fatura asla ödenmiş görünmez. */
export function invoiceIntegrity(inv){
  if(inv.status==="PAID")return inv.totalMinor!==null&&inv.paidMinor!==null&&inv.paidMinor>=inv.totalMinor?"OK":"MISMATCH";
  if(inv.status==="DRAFT")return inv.paidMinor===null||inv.paidMinor===0?"OK":"MISMATCH";
  return "OK";
}
/** //TR: "SIGNED" yalnız belge sha256, imzalayan ve imza zamanı üçü de varsa imzalı kanıtlıdır; eksikse NOT_VERIFIED. Fırsat (WON dahil) sözleşme veya imza anlamına gelmez. */
export function contractIntegrity(c){
  if(c.status!=="SIGNED")return "OK";
  return c.documentSha256&&c.signerName&&c.signedAt?"OK":"MISSING_EVIDENCE";
}
/** Hesap kimliğinden gösterilecek ad: yalnız gerçek hesap kaydından; hesap listesi yoksa/eşleşmezse null (çağıran kimliği gösterir). */
export function accountName(accounts,id){
  if(!id||!accounts||!isLive(accounts))return null;
  return accounts.items.find(a=>a.id===id)?.name??null;
}
/** Seçili hesaba göre süzer (null = tümü); hesaba bağlı olmayan kayıt (accountId yok) süzülmüş görünümde yer almaz. */
export function forAccount(items,accountId){return accountId?items.filter(x=>x.accountId===accountId):items}
