// //TR: Bu modül Güvence (QA + Güvenlik) görünümünün saf (DOM'suz) çekirdeğidir: GET /v1/work-runs ham kayıtlarındaki SECURITY_REPORT kanıtının (core/workos security-tools.ts aşama özeti) güvenli, DÜRÜST eşlemesi. Hiçbir durum YÜKSELTİLMEZ: yalnız sunucunun bildirdiği gitleaks/trivy/semgrep durumu (INSTALLED/NOT_INSTALLED/ERROR), secret-scan ve SCA durumu taşınır; araç yoksa NOT_INSTALLED, kapsam eksikse PARTIAL, kanıt yoksa NOT_EXECUTED gösterilir; sahte "temiz/geçti" asla üretilmez ve SOURCE_GENERATION_COMPLETE asla PRODUCT_VERIFIED sayılmaz. Veri HTML olarak yorumlanmaz; bu modül yalnız salt-okunur veri üretir.
import {MISSING} from "./model.js";
import {mapReadinessWorkRuns} from "./readiness-core.js";

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max=200)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const safeInt=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const SHA_RE=/^[0-9a-f]{40}$/;
const RUN_ID_RE=/^[A-Za-z0-9_-]{6,64}$/;
const MSN_RE=/^msn_[0-9a-f]{24}$/;
const CODE_RE=/^[A-Z][A-Z0-9_]{0,39}$/;

// //TR: Güvenlik aşaması (B3C) sözleşmesi durumları; bunların DIŞINDAki değer asla "geçti" sayılmaz.
export const SECURITY_STAGE_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED"]);
export const SECURITY_TOOL_STATES=Object.freeze(["INSTALLED","NOT_INSTALLED","ERROR"]);
// //TR: Bir koşunun headline güvenlik durumu: aşama durumu + kanıtın run.headSha'ya bağlı olup olmadığı birlikte değerlendirilir.
export const SECURITY_SCAN_STATES=Object.freeze(["PASSED","PARTIAL","BLOCKED","STALE","NOT_EXECUTED"]);
// //TR: FD-REL-1 (yürütme kapısı) + ücretli cihaz farmı: dinamik QA Founder kapısındadır ve bu yüzeyler ASLA sahte "koş/geçti" göstermez.
export const DYNAMIC_QA_GATES=Object.freeze(["unitTests","e2eTests","visualTests","apiTests","webTests","mobileTests","desktopTests","deviceFarm","livePreview"]);

const toolStatus=s=>SECURITY_TOOL_STATES.includes(s)?s:"ERROR";
const stageStatus=s=>SECURITY_STAGE_STATES.includes(s)?s:null;
// //TR: Araç/alt-durum kodu (CLEAN/FINDINGS/NOT_INSTALLED/PARTIAL/ERROR/NOT_AVAILABLE ...) sunucunun verdiği haliyle taşınır; bilinmeyen biçim dürüst "UNKNOWN" olur, asla "CLEAN" diye uydurulmaz.
const code=s=>typeof s==="string"&&CODE_RE.test(s)?s:"UNKNOWN";

function toolView(t){
  if(!isObj(t))return null;
  const tool=str(t.tool,40);if(!tool)return null;
  return {tool,status:toolStatus(t.status),version:str(t.version,80),reason:str(t.reason,80)};
}


// //TR: UI-047: SECURITY_REPORT sca.findings[] ve secrets.gitleaks.items[] için sınırlı, temizlenmiş eşleme. Yalnız beyaz listedeki alanlar taşınır (gizli DEĞER asla alınmaz; fixedVersion bilerek DÜŞÜRÜLÜR ki "düzeltildi" durumu çıkarılamasın). Bozuk girdi atılır ve sayılır; alan yok/dizi değilse boş + RECORDED=false (asla "temiz" değil).
export const SEC_FINDINGS_SCA_CAP=50;
export const SEC_FINDINGS_SECRET_CAP=100;
const SEV_ALLOW=Object.freeze(["CRITICAL","HIGH","MEDIUM","LOW","INFO","UNKNOWN"]);
const textField=(x,max)=>typeof x==="string"&&x.length&&!/[\u0000-\u001f\u007f]/.test(x)?x.slice(0,max):null;
function mapFindingList(raw,cap,mapOne){
  if(!Array.isArray(raw))return {recorded:false,items:[],dropped:0,overCap:false};
  const items=[];let dropped=0;
  for(const e of raw.slice(0,cap)){const m=mapOne(e);if(m)items.push(m);else dropped+=1}
  return {recorded:true,items,dropped,overCap:raw.length>cap};
}
const scaFinding=e=>{
  if(!isObj(e))return null;
  const pkg=textField(e.package,120),id=textField(e.id,60);if(!pkg||!id)return null;
  return {package:pkg,version:textField(e.version,60),id,severity:SEV_ALLOW.includes(e.severity)?e.severity:"UNKNOWN",target:textField(e.target,160)};
};
const secretFinding=e=>{
  if(!isObj(e))return null;
  const ruleId=textField(e.ruleId,80),file=textField(e.file,200);if(!ruleId||!file)return null;
  return {ruleId,file,line:Number.isSafeInteger(e.line)&&e.line>=0?e.line:null,commit:typeof e.commit==="string"&&SHA_RE.test(e.commit)?e.commit:null};
};

/** //TR: Koşunun en son SECURITY_REPORT kanıtı (en yüksek cycle, eşitlikte dizideki son); yalnız .security taşıyan kayıt. */
function latestSecurityEvidence(evidence){
  let best=null,bestCycle=-1;
  for(const e of (Array.isArray(evidence)?evidence:[])){
    if(!isObj(e)||e.kind!=="SECURITY_REPORT"||!isObj(e.security))continue;
    const cyc=Number.isSafeInteger(e.cycle)?e.cycle:0;
    if(cyc>=bestCycle){best=e;bestCycle=cyc}
  }
  return best;
}

/** //TR: UI-146: koşunun TÜM SECURITY_REPORT (.security taşıyan) kanıtlarından cycle sırasına göre (null cycle sonda, eşitlikte dizi sırası) en çok 20 girdilik salt-okunur tarama geçmişi. Değerler kayıtlı olduğu gibi taşınır; fark/"düzeltildi" türetilmez, bozuk kayıt atılır. */
export const SCAN_HISTORY_CAP=20;
function scanHistory(evidence,headSha){
  const out=[];
  for(const e of (Array.isArray(evidence)?evidence:[])){
    if(!isObj(e)||e.kind!=="SECURITY_REPORT"||!isObj(e.security))continue;
    const sec=e.security,commitSha=typeof e.commitSha==="string"&&SHA_RE.test(e.commitSha)?e.commitSha:null;
    const secrets=isObj(sec.secrets)?sec.secrets:{},gl=isObj(secrets.gitleaks)?secrets.gitleaks:{},sca=isObj(sec.sca)?sec.sca:{};
    out.push({cycle:Number.isSafeInteger(e.cycle)?e.cycle:null,stageStatus:stageStatus(sec.status),commitSha,commitBound:Boolean(headSha&&commitSha&&headSha===commitSha),
      gitleaksFindings:safeInt(gl.findings),scaBlocking:safeInt(sca.blocking),blockReason:typeof sec.blockReason==="string"&&CODE_RE.test(sec.blockReason)?sec.blockReason:null});
  }
  return out.map((v,i)=>({v,i})).sort((a,b)=>(a.v.cycle===null)-(b.v.cycle===null)||(a.v.cycle!==null&&b.v.cycle!==null&&a.v.cycle!==b.v.cycle?a.v.cycle-b.v.cycle:0)||a.i-b.i).slice(0,SCAN_HISTORY_CAP).map(x=>x.v);
}

/** //TR: Tek bir ham work-run kaydını güvenli güvenlik görünümüne eşler; kanıt yoksa dürüst NOT_EXECUTED. Geçersiz kimlik => null (satır üretilmez). */
export function mapRunSecurity(run){
  if(!isObj(run))return null;
  const idv=run.runId??run.workRunId??run.id;
  const runId=typeof idv==="string"&&RUN_ID_RE.test(idv)?idv:null;if(!runId)return null;
  const missionId=typeof run.missionId==="string"&&MSN_RE.test(run.missionId)?run.missionId:null;
  const headSha=typeof run.headSha==="string"&&SHA_RE.test(run.headSha)?run.headSha:null;
  const status=typeof run.status==="string"&&CODE_RE.test(run.status)?run.status:null;
  const ev=latestSecurityEvidence(run.evidence);
  if(!ev){
    return {runId,missionId,runStatus:status,headSha,commitSha:null,commitBound:false,scanned:false,
      scanStatus:"NOT_EXECUTED",stageStatus:null,blockReason:null,cycle:null,founderNote:null,scanHistory:[],
      secrets:{builtin:{status:"UNKNOWN",hits:null},gitleaks:{status:"UNKNOWN",findings:null,reason:null}},
      sca:{status:"UNKNOWN",blocking:null,counts:{},reason:null},
      sast:{status:"NOT_AVAILABLE",reason:"NO_SECURITY_EVIDENCE"},sbom:{status:"NOT_AVAILABLE",reason:"NO_SECURITY_EVIDENCE"},
      scaFindings:mapFindingList(undefined,0,scaFinding),secretFindings:mapFindingList(undefined,0,secretFinding),scaTruncated:false,
      tools:[],gaps:[]};
  }
  const sec=ev.security,commitSha=typeof ev.commitSha==="string"&&SHA_RE.test(ev.commitSha)?ev.commitSha:null;
  const commitBound=Boolean(headSha&&commitSha&&headSha===commitSha);
  const st=stageStatus(sec.status);
  // //TR: Headline: aşama PASSED yalnız kanıt run.headSha'ya bağlıyken PASSED gösterilir; başka commit'e bağlıysa STALE (asla geçerli "geçti" gibi). BLOCKED her durumda engeldir.
  const scanStatus=st==="BLOCKED"?"BLOCKED":st==="PASSED"?(commitBound?"PASSED":"STALE"):st==="PARTIAL"?(commitBound?"PARTIAL":"STALE"):"NOT_EXECUTED";
  const secrets=isObj(sec.secrets)?sec.secrets:{};
  const builtin=isObj(secrets.builtin)?secrets.builtin:{};
  const gitleaks=isObj(secrets.gitleaks)?secrets.gitleaks:{};
  const sca=isObj(sec.sca)?sec.sca:{};
  const sast=isObj(sec.sast)?sec.sast:{};
  const sbom=isObj(sec.sbom)?sec.sbom:{};
  const counts={};if(isObj(sca.counts))for(const [k,v] of Object.entries(sca.counts)){const n=safeInt(v);if(n!==null&&/^[A-Z_]{1,20}$/.test(k))counts[k]=n}
  return {
    runId,missionId,runStatus:status,headSha,commitSha,commitBound,scanned:true,scanHistory:scanHistory(run.evidence,headSha),
    scanStatus,stageStatus:st,blockReason:typeof sec.blockReason==="string"&&CODE_RE.test(sec.blockReason)?sec.blockReason:null,
    cycle:Number.isSafeInteger(ev.cycle)?ev.cycle:null,founderNote:str(sec.founderNote,600),
    secrets:{builtin:{status:code(builtin.status),hits:safeInt(builtin.hits)},gitleaks:{status:code(gitleaks.status),findings:safeInt(gitleaks.findings),reason:str(gitleaks.reason,80)}},
    sca:{status:code(sca.status),blocking:safeInt(sca.blocking),counts,reason:str(sca.reason,80)},
    sast:{status:code(sast.status),reason:str(sast.reason,80)},sbom:{status:code(sbom.status),reason:str(sbom.reason,80)},
    scaFindings:mapFindingList(sca.findings,SEC_FINDINGS_SCA_CAP,scaFinding),secretFindings:mapFindingList(gitleaks.items,SEC_FINDINGS_SECRET_CAP,secretFinding),scaTruncated:sca.truncated===true,
    tools:(Array.isArray(sec.tools)?sec.tools:[]).slice(0,10).map(toolView).filter(Boolean),
    gaps:(Array.isArray(sec.gaps)?sec.gaps:[]).filter(g=>typeof g==="string").slice(0,30).map(g=>g.slice(0,120))
  };
}

function emptyAggregate(){return {total:0,scanned:0,byStatus:{PASSED:0,PARTIAL:0,BLOCKED:0,STALE:0,NOT_EXECUTED:0},blocked:0,toolsSeen:null}}
/** //TR: Koşu güvenlik görünümlerinin dürüst toplamı: duruma göre sayım + engel sayısı + son taranan koşudaki araç durumu (varsa). Hiçbir sayı uydurulmaz. */
export function aggregateSecurity(runs){
  const agg=emptyAggregate();agg.total=runs.length;
  let latestScanned=null;
  for(const r of runs){
    if(agg.byStatus[r.scanStatus]!==undefined)agg.byStatus[r.scanStatus]+=1;
    if(r.scanned){agg.scanned+=1;if(!latestScanned)latestScanned=r}
  }
  agg.blocked=agg.byStatus.BLOCKED;
  // //TR: Araç kapsamı yalnız gerçek taranmış bir koşunun kanıtından; hiç tarama yoksa null (kurulu/kurulu değil durumu uydurulmaz).
  agg.toolsSeen=latestScanned?latestScanned.tools:null;
  return agg;
}

/** //TR: GET /v1/work-runs ham sonucunu (api.raw) güvenlik tarama görünümüne eşler; başarısızsa dürüst durum, asla boş "temiz" tablo. */
export function mapSecurityScans(r){
  if(!isObj(r)||r.ok!==true){
    const state=isObj(r)&&typeof r.state==="string"?r.state:"ERROR";
    return {state,runs:[],aggregate:emptyAggregate()};
  }
  const data=r.data;
  const list=isObj(data)?(Array.isArray(data.workRuns)?data.workRuns:Array.isArray(data.runs)?data.runs:Array.isArray(data.items)?data.items:null):null;
  if(!list)return {state:"ERROR",runs:[],aggregate:emptyAggregate()};
  const runs=list.slice(0,500).map(mapRunSecurity).filter(Boolean);
  return {state:"VERIFIED",runs,aggregate:aggregateSecurity(runs)};
}

/** //TR: cockpit.evidence bloğundan dürüst kanıt bütünlüğü özeti; yalnız VERIFIED/STALE blokta ve geçerli tamsayıysa sayı, aksi halde null (uydurma yok). */
export function evidenceIntegrity(evBlock){
  const b=isObj(evBlock)?evBlock:null,live=b&&(b.state==="VERIFIED"||b.state==="STALE");
  const n=k=>live?safeInt(b[k]):null;
  return {state:b?b.state:"UNAVAILABLE",live:Boolean(live),total:n("total"),verified:n("verified"),mismatch:n("mismatch"),missing:n("missing"),unverifiable:n("unverifiable")};
}

// //TR: UI-049: GET /v1/reviews/:evd_id yanıtının fail-closed eşlemesi. Karar sunucudan AYNEN taşınır (yükseltilmez); biçim bozuksa {state:"ERROR",review:null}. Serbest metin yalnız sınırlı uzunlukta alınır ve textContent ile çizilir.
export const REVIEW_ID_RE=/^evd_[0-9a-f]{24}$/;
const REVIEW_VERDICT_SET=Object.freeze(["CLEAN","BLOCKED","NO_VERDICT"]);
const RUN_RE_R=/^run_[0-9a-f]{24}$/;
const isoOrNull=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
/** //TR: CLEAN kararı yalnız TÜM koşullar sağlanırsa doğrulanmış sayılır: bağımsızlık kanıtlı, incelenen commit boş değil ve AYNI yanıttaki koşunun head'ine eşit, kayıt koşunun son review'u, geçersiz kılınmamış ve kayıtlı ham karar boş ya da karara eşit. Aksi halde STALE (asla VERIFIED). */
export function reviewCleanVerified(x){
  if(!isObj(x)||x.verdict!=="CLEAN")return false;
  return x.independent===true&&x.currentHead===true&&typeof x.reviewedCommit==="string"&&SHA_RE.test(x.reviewedCommit)
    &&typeof x.headSha==="string"&&x.reviewedCommit===x.headSha
    &&typeof x.reviewId==="string"&&x.latestReviewId===x.reviewId
    &&!x.invalidated&&(x.recordedVerdict===null||x.recordedVerdict===undefined||x.recordedVerdict===x.verdict);
}
/** //TR: Liste satırı için aynı kural: koşu özeti (runs) AYNI liste yanıtından gelir; eşleşen koşu yoksa doğrulanmış sayılmaz (liste kaydı invalidated/recordedVerdict taşımaz; bunlar yalnız detayda kontrol edilir). */
export function reviewRowVerified(rec,runs){
  if(!isObj(rec)||!Array.isArray(runs))return false;
  const run=runs.find(r=>isObj(r)&&r.runId===rec.runId);
  return run?reviewCleanVerified({...rec,headSha:run.headSha,latestReviewId:run.latestReviewId}):false;
}
export function mapReviewDetail(raw,requestedId){
  const bad={state:"ERROR",review:null};
  if(!isObj(raw)||raw.source!=="WORK_OS_JOURNAL_RUN_EVIDENCE"||!isObj(raw.review)||!isObj(raw.run))return bad;
  const r=raw.review,ev=r.evidence,run=raw.run;
  if(!REVIEW_ID_RE.test(String(r.reviewId))||!RUN_RE_R.test(String(r.runId))||!MSN_RE.test(String(r.missionId))||!REVIEW_VERDICT_SET.includes(r.verdict)||!isObj(r.reviewer)||!isObj(r.implementer)||!isObj(ev)||typeof r.currentHead!=="boolean"||safeInt(r.cycle)===null)return bad;
  if(requestedId!==undefined&&r.reviewId!==requestedId)return bad;
  if(r.independent!==null&&typeof r.independent!=="boolean")return bad;
  const commit=r.reviewedCommit===null||r.reviewedCommit===undefined?null:SHA_RE.test(String(r.reviewedCommit))?r.reviewedCommit:undefined;
  if(commit===undefined)return bad;
  // //TR: Koşu özeti aynı yanıttan; kimlik uyuşmazlığı ya da bozuk head/son review kimliği okumayı reddeder.
  if(run.runId!==r.runId)return bad;
  const headSha=run.headSha===null||run.headSha===undefined?null:typeof run.headSha==="string"&&SHA_RE.test(run.headSha)?run.headSha:undefined;
  const latestReviewId=run.latestReviewId===null||run.latestReviewId===undefined?null:typeof run.latestReviewId==="string"&&REVIEW_ID_RE.test(run.latestReviewId)?run.latestReviewId:undefined;
  if(headSha===undefined||latestReviewId===undefined)return bad;
  // //TR: Bozuk sayaç/çıkış kodu/kayıtlı karar okumayı başarısız kılar (sessizce null + VERIFIED olmaz).
  const fc=ev.findingsCount,ec=ev.exitCode;
  if(fc!==null&&fc!==undefined&&safeInt(fc)===null)return bad;
  if(ec!==null&&ec!==undefined&&!Number.isSafeInteger(ec))return bad;
  if(ev.recordedVerdict!==null&&ev.recordedVerdict!==undefined&&!REVIEW_VERDICT_SET.includes(ev.recordedVerdict))return bad;
  const findings=Array.isArray(ev.findings)?ev.findings.filter(f=>typeof f==="string").slice(0,20).map(f=>f.slice(0,300)):null;
  const out={reviewId:r.reviewId,runId:r.runId,missionId:r.missionId,cycle:r.cycle,verdict:r.verdict,independent:r.independent===true?true:r.independent===false?false:null,
    reviewer:str(r.reviewer.identity,120),implementer:str(r.implementer.identity,120),reviewedCommit:commit,currentHead:r.currentHead,timestamp:isoOrNull(r.timestamp),
    recordedVerdict:ev.recordedVerdict??null,invalidated:str(ev.invalidated,60),findingsCount:fc??null,findings,
    exitCode:ec??null,timedOut:ev.timedOut===true,note:str(ev.note,200),runHeadSha:headSha,latestReviewId};
  out.verified=reviewCleanVerified({...out,headSha});
  return {state:"VERIFIED",review:out};
}
// //TR: UI-050: kanıt soyağacı YALNIZ GET /v1/evidence liste alanlarından (missionId, runId) kurulur. Kenar yalnız alan mevcutsa vardır: ikisi de varsa mission->run->evidence; yalnız missionId varsa mission altında "koşu kaydı yok"; yalnız runId varsa görev bağı olmayan koşu; ikisi de yoksa gruplanmamış. Hiçbir bağ başka kanıtlardan ÇIKARILMAZ (aynı runId'li başka kayıttan missionId ödünç alınmaz).
export function buildLineage(items){
  // //TR: Tekrarlanan evidenceId (aynı kanıtın iki kez gelmesi) atlanır; DOM kimlikleri benzersiz kalır ve atlanan sayı açıkça bildirilir.
  const list=[],seenIds=new Set();let duplicates=0;
  for(const e of (Array.isArray(items)?items:[])){
    if(!isObj(e)||typeof e.evidenceId!=="string")continue;
    if(seenIds.has(e.evidenceId)){duplicates+=1;continue}
    seenIds.add(e.evidenceId);list.push(e);
  }
  const missions=new Map(),orphanRuns=new Map(),ungrouped=[];
  const mission=id=>{let m=missions.get(id);if(!m){m={missionId:id,runs:new Map(),noRun:[]};missions.set(id,m)}return m};
  for(const e of list){
    const mid=typeof e.missionId==="string"&&e.missionId?e.missionId:null,rid=typeof e.runId==="string"&&e.runId?e.runId:null;
    if(mid&&rid){const m=mission(mid);if(!m.runs.has(rid))m.runs.set(rid,[]);m.runs.get(rid).push(e)}
    else if(mid)mission(mid).noRun.push(e);
    else if(rid){if(!orphanRuns.has(rid))orphanRuns.set(rid,[]);orphanRuns.get(rid).push(e)}
    else ungrouped.push(e);
  }
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  return {
    total:list.length,duplicates,
    missions:[...missions.values()].sort((a,b)=>cmp(a.missionId,b.missionId)).map(m=>({missionId:m.missionId,noRun:m.noRun,runs:[...m.runs.entries()].sort((a,b)=>cmp(a[0],b[0])).map(([runId,evidence])=>({runId,evidence}))})),
    orphanRuns:[...orphanRuns.entries()].sort((a,b)=>cmp(a[0],b[0])).map(([runId,evidence])=>({runId,evidence})),
    ungrouped};
}
// //TR: PQ-003: buildLineage çıktısından düğüm/kenar grafiği. Kenarlar YALNIZ listedeki missionId/runId alanlarından gelir (mission->run, run->evidence, koşusuz kanıt için mission->evidence); aynı runId farklı mission altında ayrı düğümdür (birleştirme çıkarımı yok); bağsız öğeler kenarsız düğüm olarak kalır.
export const GRAPH_KINDS=Object.freeze(["mission","run","evidence"]);
export function buildLineageGraph(L){
  const nodes=[],edges=[],byKey=new Map();
  const node=(kind,key,label,extra={})=>{const id=`${kind}:${key}`;let n=byKey.get(id);if(!n){n={id,kind,label,...extra};byKey.set(id,n);nodes.push(n)}return n};
  const edge=(a,b)=>edges.push({from:a.id,to:b.id});
  const evNode=e=>node("evidence",e.evidenceId,e.evidenceId,{evidenceId:e.evidenceId,evKind:typeof e.kind==="string"?e.kind:null});
  const runNode=(mid,r)=>node("run",`${mid??""}|${r.runId}`,r.runId,{runId:r.runId,missionId:mid});
  for(const m of L?.missions??[]){
    const mn=node("mission",m.missionId,m.missionId,{missionId:m.missionId});
    for(const r of m.runs){const rn=runNode(m.missionId,r);edge(mn,rn);for(const e of r.evidence)edge(rn,evNode(e))}
    for(const e of m.noRun)edge(mn,evNode(e));
  }
  for(const r of L?.orphanRuns??[]){const rn=runNode(null,r);for(const e of r.evidence)edge(rn,evNode(e))}
  for(const e of L?.ungrouped??[])evNode(e);
  const columns=GRAPH_KINDS.map(k=>nodes.filter(n=>n.kind===k));
  return {nodes,edges,columns,byId:id=>byKey.get(id)??null};
}
/** Seçili düğümle bağlı tüm atalar ve torunlar (kenar yönünde/tersinde), düğümün kendisi hariç. */
export function linkedNodeIds(graph,id){
  const out=new Set();
  const walk=(start,dir)=>{const q=[start];while(q.length){const cur=q.pop();for(const e of graph.edges){const nxt=dir==="down"?(e.from===cur?e.to:null):(e.to===cur?e.from:null);if(nxt&&!out.has(nxt)&&nxt!==id){out.add(nxt);q.push(nxt)}}}};
  walk(id,"down");walk(id,"up");return out;
}
/** Klavye gezintisi: Aşağı/Yukarı aynı sütunda, Sağ ilk çocuğa, Sol ilk ebeveyne, Home/End sütun başı/sonu; hedef yoksa null. */
export function lineageNavigate(graph,id,key){
  const n=graph.byId(id);if(!n)return null;
  const col=graph.columns[GRAPH_KINDS.indexOf(n.kind)],i=col.indexOf(n);
  if(key==="ArrowDown")return col[i+1]?.id??null;
  if(key==="ArrowUp")return col[i-1]?.id??null;
  if(key==="Home")return col[0]?.id??null;
  if(key==="End")return col[col.length-1]?.id??null;
  if(key==="ArrowRight")return graph.edges.find(e=>e.from===id)?.to??null;
  if(key==="ArrowLeft")return graph.edges.find(e=>e.to===id)?.from??null;
  return null;
}
// //TR: UI-051: koşu başına test raporu GET /v1/work-runs ham kanıt kayıtlarından (VERIFY_TESTS, REGRESSION_TESTS, *_NOT_EXECUTED, TEST_SURFACE) türetilir; anlamı readiness-core testsOf ile aynıdır ve yalnız GÜNCEL head'e (run.headSha) bağlı kayıt sayılır. EXECUTED yalnız iki test kaydı da exit 0, sandbox tanıklı ve yürütülen test sayısı > 0 iken; kayıt yoksa NOT_EXECUTED. Hiçbir durum yükseltilmez, "geçti" üretilmez.
export const TEST_REPORT_STATES=Object.freeze(["EXECUTED","FAILED","BLOCKED","NOT_EXECUTED","UNVERIFIED"]);
const TEST_KINDS=Object.freeze(["VERIFY_TESTS","REGRESSION_TESTS","VERIFY_TESTS_NOT_EXECUTED","REGRESSION_TESTS_NOT_EXECUTED","TEST_SURFACE"]);
const lastOf=(list,pred)=>{for(let i=list.length-1;i>=0;i--)if(pred(list[i]))return list[i];return null};
function mapTestRecord(e,head){
  if(!isObj(e)||!TEST_KINDS.includes(e.kind))return null;
  const sha=typeof e.commitSha==="string"&&SHA_RE.test(e.commitSha)?e.commitSha:null,ts=isObj(e.testSurface)?e.testSurface:null;
  return {evidenceId:typeof e.evidenceId==="string"&&e.evidenceId.length<=80?e.evidenceId:null,kind:e.kind,cycle:safeInt(e.cycle),commitSha:sha,atHead:head!==null&&sha===head,
    exitCode:Number.isSafeInteger(e.exitCode)?e.exitCode:null,attested:typeof e.sandboxProviderId==="string"&&e.sandboxProviderId.length>0,
    acceptance:ts&&typeof ts.functionalAcceptance==="string"?str(ts.functionalAcceptance,40):null,executedTests:ts?safeInt(ts.executedTests):null};
}
// //TR: Durum (EXECUTED/FAILED/...) readiness-core'un testsOf'u ile BİREBİR aynı kaynaktan gelir: tüm liste önce mapReadinessWorkRuns ile fail-closed doğrulanır (bozuk kanıt öğesi, biçimsiz commit/exitCode/sağlayıcı/kabul, yinelenen runId, bozuk koşu satırı => TÜM okuma ERROR) ve satır başına `tests` değeri oradan alınır; burada ikinci bir kural kopyası YOKTUR. Kayıtlar yalnız doğrulanmış ham öğelerden gösterim için türetilir.
export const TEST_ROWS_MAX=500;
export function mapTestReports(r){
  const bad=state=>({state,runs:[],total:0,truncated:false});
  if(!isObj(r)||r.ok!==true)return bad(isObj(r)&&typeof r.state==="string"?r.state:"ERROR");
  const data=r.data;
  const list=isObj(data)?(Array.isArray(data.workRuns)?data.workRuns:Array.isArray(data.runs)?data.runs:Array.isArray(data.items)?data.items:null):null;
  if(!list)return bad("ERROR");
  const rd=mapReadinessWorkRuns({runs:list});
  if(rd.state!=="VERIFIED"||!rd.runs||rd.runs.items.length!==list.length)return bad("ERROR");
  const runs=list.slice(0,TEST_ROWS_MAX).map((x,i)=>{
    const row=rd.runs.items[i],head=row.headSha;
    const records=x.evidence.map(e=>mapTestRecord(e,head)).filter(Boolean);
    const surface=lastOf(records.filter(q=>q.atHead),q=>q.kind==="TEST_SURFACE"&&q.acceptance!==null);
    return {runId:row.runId,missionId:row.missionId,headSha:head,state:row.tests,records,executedTests:surface?surface.executedTests:null};
  });
  return {state:"VERIFIED",runs,total:list.length,truncated:list.length>TEST_ROWS_MAX};
}
export {MISSING};
