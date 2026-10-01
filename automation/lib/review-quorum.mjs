// //TR: Bu modül çift bağımsız incelemenin (Founder talimatı 2026-10-01) saf kurallarıdır: hangi reviewer'ların gerektiği, sağlayıcı başına inceleme kapısının donmuş bundle'a bağlanması (commit veya digest değişince kapı bayatlar), yeter sayı (iki geçerli CLEAN -> CLEAN; geçerli bir BLOCKED entegrasyonu durdurur; biçimi bozuk sonuç asla CLEAN olmaz; kota hiçbir sonuç üretmez) ve iki reviewer'ın bulgularının sağlayıcı atfı korunarak birleştirilmesi. Builder çıktısı hiçbir zaman reviewer kanıtı sayılmaz; bu modül yalnız reviewer kanıtlarından gelen sonuçları birleştirir.
import {canonicalFindingFingerprint} from "./review-governance.mjs";
export const REVIEWER_KEYS=["claude","codex"];
export const REVIEWER_IDENTITY={claude:"CLAUDE_REVIEWER",codex:"CODEX_REVIEWER"};
export const PROVIDER_STATE_KEY={claude:"claudeReviewer",codex:"codex"};
export const GATE_STATUSES=["PENDING","CLEAN","BLOCKED","INVALID","PROVIDER_BLOCKED"];
const SEV=["P3","P2","P1","P0"],sevRank=s=>SEV.indexOf(String(s));
// //TR: Etkinleştirmeden önce dondurulmuş ve geçmişte kapanmış paketler tarihsel politikayla (yalnız Codex) kalır; etkinleştirmeden sonra açık her paket iki reviewer ister. Paket açıkça işaretlenmişse o işaret geçerlidir; CODEX_ONLY_HISTORICAL yalnız konduğu revizyona aittir ve etkinleştirmeden sonraki her yeni commit'te engine onu DUAL ile değiştirir.
export function requiredReviewers(p,control){if(p?.reviewPolicy==="DUAL")return ["claude","codex"];if(p?.reviewPolicy==="CODEX_ONLY_HISTORICAL")return ["codex"];return control?.dualReview?.active===true?["claude","codex"]:["codex"]}
// //TR: Son sürüm denetimi hedefi: release adayının tam depo denetimi, iki reviewer'ın aynı donmuş tam depo bundle'ını kendi temiz klonunda incelediği paket benzeri bir görünümdür; kapı adayın bundle digest'ine bağlıdır ve her zaman iki reviewer ister.
export function auditTarget(r){const a=r?.audit??{};return {id:a.id??null,kind:"RELEASE_AUDIT",bundle:a.bundle??null,baseCommit:a.baseCommit??null,reviewCommit:r?.sourceCommit??null,cycle:a.cycle??1,reviewGate:a.reviewGate,reviewPolicy:"DUAL",auditBase:true}}
export function isDualPackage(p,control){return requiredReviewers(p,control).length===2}
// //TR: Kapı paketin o anki bundle digest'i ve cycle'ı ile anahtarlanır; ikisinden biri değişirse eski sonuçlar uygulanmaz. Etkinleştirmeden önce aynı bundle için kaydedilmiş geçerli Codex CLEAN'i (paket hâlâ REVIEW_CLEAN, aynı cycle, varsa aynı bundle digest) Codex kapısına taşınır (tarihsel kanıt geçersiz sayılmaz), Claude kapısı boş başlar; birleşme kapısı bu kanıtı yine donmuş bundle'a karşı yeniden türetir.
export function currentGate(p){const g=p?.reviewGate;if(g&&g.bundleDigest===p.bundle?.digest&&g.cycle===p.cycle)return g;
  const fresh={bundleDigest:p?.bundle?.digest??null,cycle:p?.cycle??null,providers:{}};
  if(p?.status==="REVIEW_CLEAN"&&p.review?.result==="CLEAN"&&!p.review.dual&&p.review.cycle===p.cycle&&p.review.evidence&&(p.review.bundleDigest===undefined||p.review.bundleDigest===p.bundle?.digest))fresh.providers.codex={status:"CLEAN",runDir:p.review.runDir??null,evidence:p.review.evidence,seededFromCodexOnlyReview:true};
  return fresh}
export function gateStatus(gate,k){const s=gate?.providers?.[k]?.status;return GATE_STATUSES.includes(s)?s:"PENDING"}
// //TR: Yeter sayı: geçersiz sonuç -> INVALID; hepsi CLEAN -> CLEAN; bir BLOCKED varsa ve diğer reviewer şu anda çalıştırılamıyorsa (sonucu var veya sağlayıcısı uygun değil) -> BLOCKED; aksi halde PENDING. Çalıştırılabilirlik PENDING kapı için de sağlayıcı durumuna bakar: başka bir paketten kaydedilmiş genel kota da reviewer'ı bekletir, bu yüzden geçerli BLOCKED bulgularıyla remediation başlar. CLEAN yine yalnız gerekli her reviewer'ın CLEAN'iyle oluşur. Bir reviewer diğerinin geçerli bulgusunu geçersiz kılamaz.
export function computeReviewAggregate(gate,required,{providerDue=()=>true}={}){
  const statuses=Object.fromEntries(required.map(k=>[k,gateStatus(gate,k)]));
  if(required.some(k=>statuses[k]==="INVALID"))return {result:"INVALID",dualReviewClean:false,statuses};
  if(required.every(k=>statuses[k]==="CLEAN"))return {result:"CLEAN",dualReviewClean:required.length===2,statuses};
  const blockedBy=required.filter(k=>statuses[k]==="BLOCKED"),runnable=required.filter(k=>(statuses[k]==="PENDING"||statuses[k]==="PROVIDER_BLOCKED")&&providerDue(k));
  if(blockedBy.length&&!runnable.length)return {result:"BLOCKED",dualReviewClean:false,statuses,blockedBy};
  return {result:"PENDING",dualReviewClean:false,statuses,waitingFor:required.filter(k=>!["CLEAN","BLOCKED"].includes(statuses[k])),runnable};
}
// //TR: Sıradaki reviewer: kapısı bekleyen ve sağlayıcısı uygun olan ilk reviewer; her reviewer aynı donmuş girdiyi kendi temiz klonunda görür.
export function nextReviewer(p,control,providerDue){const gate=currentGate(p);for(const k of requiredReviewers(p,control)){const s=gateStatus(gate,k);if((s==="PENDING"||s==="PROVIDER_BLOCKED")&&providerDue(k))return k}return null}
// //TR: Birleşik bulgu, remediation için her sağlayıcının yönetilen bulgusunu (yeniden üretim, kabul ölçütü, yeniden test kimlikleri dahil) kanıtında aynen taşır; builder'a daha az bilgi gitmez.
// //TR: Kök neden anahtarı: etkilenen dosya + sembol + kategori; yalnız birebir eşleşen bulgular birleştirilir, belirsiz durumda ayrı tutulur.
export function rootCauseKey(f){const file=String(f?.file??f?.path??"").replace(/\\/g,"/").toLowerCase(),sym=String(f?.symbol??"").toLowerCase(),cat=String(f?.category??"").toLowerCase();return file||sym?`${file}|${sym}|${cat}`:null}
export function namespacedFindingId(provider,id){return `F-${provider.toUpperCase()}.${String(id).replace(/^F-/,"")}`}
// //TR: Bulgu birleştirme (durum ve builder için): sağlayıcı atfı ve her reviewer'ın bağımsız kanıtı korunur.
export function aggregateFindings(byProvider){const out=[],idx=new Map();
  for(const k of REVIEWER_KEYS)for(const f of byProvider?.[k]??[]){const key=rootCauseKey(f),evidence={provider:REVIEWER_IDENTITY[k],findingId:f.id,severity:f.severity??null,classification:f.classification??null,expected:f.expected??null,observed:f.observed??null,finding:f};const prev=key?idx.get(key):null;
    if(prev){if(!prev.providers.includes(REVIEWER_IDENTITY[k]))prev.providers.push(REVIEWER_IDENTITY[k]);prev.evidence.push(evidence);if(sevRank(f.severity)>sevRank(prev.severity))prev.severity=f.severity;prev.sourceIds[k]=[...(prev.sourceIds[k]??[]),f.id];continue}
    const a={id:namespacedFindingId(k,f.id),findingId:namespacedFindingId(k,f.id),severity:f.severity??null,classification:f.classification??null,providers:[REVIEWER_IDENTITY[k]],path:f.file??null,symbol:f.symbol??null,rootCause:f.category??null,evidence:[evidence],remediationState:"OPEN",sourceIds:{[k]:[f.id]}};out.push(a);if(key)idx.set(key,a)}
  return out}
// //TR: Bir sonraki cycle'ın defteri: şemaya uygun bulgular korunur, kimlikler sağlayıcıya göre ad alanına alınır (parmak izi kimlikten bağımsızdır); iki reviewer da birleşik defteri aynen görür.
// //TR: Defter kimliği kanonik parmak izidir (kategori, dayanak, dosya, sembol, yeniden üretim adımları); yalnız parmak izi birebir aynı olan kayıtlar tek kayıt olur. Aynı dosya/sembol/kategorideki farklı bulgular (aynı sağlayıcıdan da olsa) ayrı kalır, böylece birinin çözülmesi diğerini defterden düşürmez. Saklı parmak izi yeniden hesaplananla uyuşmayan kayıt hiçbir kayıtla birleştirilmez. Birleşmede güçlü kayıt (açık > kapalı, BLOCKER > diğer, yüksek önem) tutulur; iki kaydın yeniden test kimlikleri ve kanıt referansları birleştirilir, hiçbir yeniden test yükümlülüğü kaybolmaz.
const LEDGER_CLOSED=["RESOLVED","DOWNGRADED","DUPLICATE"];
function ledgerIdentity(f){const fp=canonicalFindingFingerprint(f??{});return f?.fingerprint===undefined||f.fingerprint===fp?fp:null}
const ledgerRank=f=>[LEDGER_CLOSED.includes(f?.status)?0:1,f?.classification==="BLOCKER"?1:0,sevRank(f?.severity)];
function outranks(a,b){const x=ledgerRank(a),y=ledgerRank(b),i=x.findIndex((v,j)=>v!==y[j]);return i>=0&&x[i]>y[i]}
export function mergeFindingLedgers(byProvider){const out=[],idx=new Map();
  for(const k of REVIEWER_KEYS)for(const f of byProvider?.[k]??[]){const e={...f,id:namespacedFindingId(k,f.id)},key=ledgerIdentity(f);
    if(key&&idx.has(key)){const i=idx.get(key),prev=out[i],m=outranks(e,prev)?{...e,id:prev.id}:{...prev};for(const x of ["retestValidationIds","evidenceRefs"]){const u=[...new Set([...(prev[x]??[]),...(e[x]??[])])];if(u.length)m[x]=u}out[i]=m;continue}
    if(key)idx.set(key,out.length);out.push(e)}
  return out}
