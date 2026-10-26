// //TR: Bu modül renderer veri erişiminin tek kapısıdır: yalnız preload köprüsü (window.uasco.apiGet / apiPost) üzerinden GET ve sabit allow-list'li JSON POST yapar, token'ı hiç görmez; sonuçları epoch'lu önbellekte tutar, aynı anda gelen istekleri birleştirir ve eski epoch yanıtlarını atar.
import {classifyFailure,mapRolesPage,mapRoleCatalogPage,mapRoleDetail,mapCockpit,emptyCockpit,mapProjects,mapMissions,mapControlStatus,mapEvents,mapAttention} from "./model.js";
import {MISSION_ID_RE,SAFE_ID_RE,mapMissionDetail,mapWorkRuns,mapWorkRunDetail,mapEvidenceList,mapEvidenceDetail} from "./work-core.js";
import {devrunPath,filesPath,filePath,gitLogPath,gitDiffPath,exportsPath,exportItemPath,EXECUTORS_PATH,mapDevRun,mapFileList,mapFileContent,mapGitLog,mapGitDiff,mapExports,mapExecutors} from "./project-core.js";
import {deliveriesPath,deliveryPath,mapDeliveries,mapDelivery} from "./delivery-core.js";
import {COMPANY_KEYS,COMPANY_PATHS,COMPANY_MAPPERS,companyFailureState} from "./company-core.js";
import {ACADEMY_PATH,mapAcademy} from "./academy-core.js";
import {predevPath,crewPath,mapPredev,mapCrew} from "./journey-core.js";
import {COCKPIT_PATH,MISSIONS_PATH,WORK_RUNS_PATH,ATTENTION_PATH,mapExecCockpit,mapExecMissions,mapExecWorkRuns,mapExecAttention} from "./executive-core.js";
import {mapQueueMissions,mapQueueWorkRuns,mapQueueAttention} from "./queue-core.js";
import {REVIEWS_PATH,mapReadinessWorkRuns,mapReadinessReviews,mapReadinessEvidence} from "./readiness-core.js";
import {mapPostureWorkRuns,mapPostureReviews,mapPostureEvidence} from "./posture-core.js";
import {REVIEW_ID_RE,mapReviewDetail} from "./assurance-core.js";
import {PROJECTS_PATH,mapMatrixProjects,mapMatrixMissions,mapMatrixWorkRuns,mapMatrixCockpit} from "./matrix-core.js";
import {CONTROL_PATH,RUNS_PATH,mapOperationsControl,mapOperationsRuns,mapOperationsAttention} from "./operations-core.js";
import {DOMAINS_PATH,mapDomains} from "./domains-core.js";
import {SCHEDULER_PATH,mapScheduler} from "./scheduler-core.js";
import {CAPABILITIES_PATH,ADAPTERS_PATH,FABRICS_PATH,mapCapabilities,mapAdapters,mapFabrics} from "./integrations-core.js";
import {knowledgePath,mapKnowledge,provenancePath,mapProvenance,mapMemoryList} from "./knowledge-core.js";
import {STATUS_SUMMARY_PATH,mapStatusSummary} from "./agent-factory-core.js";
import {ATTENTION_PATH as WORKOS_ATTENTION_PATH,mapAttentionQueue,attentionAsBlocked} from "./attention-core.js";
import {INSTALL_PATH,PHASE0_PATH,mapInstallReport,mapPhase0Report} from "./install-core.js";
import {RUNS_PATH as AUDIT_RUNS_PATH,EVIDENCE_PATH as AUDIT_EVIDENCE_PATH,runEventsPath,mapAuditRuns,mapAuditEvents,mapAuditEvidence} from "./audit-core.js";

const TTL_MS=3000;
const ROLE_ID_RE=/^UASCO-\d{4}$/;
export function createApi({bridge,store,now=()=>Date.now()}){
  async function get(path,{force=false}={}){
    const hit=store.cache.get(path);if(!force&&hit&&now()-hit.at<TTL_MS)return hit.promise;
    const epoch=store.epoch;
    const promise=(async()=>{
      if(!bridge||typeof bridge.apiGet!=="function")return {ok:false,...classifyFailure("BRIDGE_UNAVAILABLE"),message:"BRIDGE_UNAVAILABLE",epoch};
      try{const data=await bridge.apiGet(path);if(epoch===store.epoch)store.markRefreshed();return {ok:true,data,epoch}}
      catch(e){return {ok:false,...classifyFailure(e),message:String(e&&e.message!==undefined?e.message:e).slice(0,300),epoch}}
    })();
    store.cache.set(path,{at:now(),promise});return promise;
  }
  /** Sabit allow-list'li POST; yanıtı {ok,status,body} olarak normalleştirir, köprü hatası thrown:true ile döner. Başarıda önbellek temizlenir (yazma sonrası bayat okuma olmaz). */
  async function post(path,body){
    if(!bridge||typeof bridge.apiPost!=="function")return {ok:false,thrown:true,...classifyFailure("BRIDGE_UNAVAILABLE"),message:"BRIDGE_UNAVAILABLE"};
    try{
      const res=await bridge.apiPost(path,body);
      if(!res||!Number.isSafeInteger(res.status))return {ok:false,thrown:true,state:"ERROR",status:null,message:"POST_RESPONSE_INVALID"};
      const ok=res.status>=200&&res.status<300;if(ok)store.cache.clear();
      return {ok,status:res.status,body:res.body&&typeof res.body==="object"?res.body:{}};
    }catch(e){return {ok:false,thrown:true,...classifyFailure(e),message:String(e&&e.message!==undefined?e.message:e).slice(0,300)}}
  }
  const stale=r=>r.epoch!==store.epoch;
  // //TR: UX WP3: Company OS kaynaklarının son başarılı okuması; sonraki okuma başarısız olursa kayıtlar STALE (eski veri, zamanıyla) gösterilir, hiç başarılı okuma yoksa asla veri uydurulmaz.
  const companyLastGood=new Map();
  return {
    get,post,stale,
    async cockpit(){const r=await get("/v1/cockpit");return r.ok?{state:"OK",data:mapCockpit(r.data)}:{state:r.state,data:emptyCockpit(r.state),message:r.message}},
    async projects(){const r=await get("/v1/projects");return r.ok?mapProjects(r.data):{state:r.state,items:[],message:r.message}},
    async missions(){const q=store.projectId?`/v1/missions?projectId=${store.projectId}`:"/v1/missions";const r=await get(q);return r.ok?mapMissions(r.data):{state:r.state,items:[],message:r.message}},
    async control(){const r=await get("/v1/control/status");return r.ok?mapControlStatus(r.data):{state:r.state,active:false,reason:null,message:r.message}},
    // //TR: Founder dikkati artık GET /v1/attention'dan (yalnız Work OS kayıtları) okunur; emekli scheduler kaynağı /v1/founder-attention bu okumada KULLANILMAZ. Eski tüketiciler için blocked[] aynı öğelerden türetilir, tam kuyruk queue alanındadır. Ana süreç izin listesi girişi tabandadır (main.mjs EXTRA bloğu); yine de köprü yolu reddederse (INVALID_API_PATH) durum UNAVAILABLE'dır, öğe uydurulmaz.
    async attention(){
      const r=await get(WORKOS_ATTENTION_PATH);
      if(!r.ok)return {state:/INVALID_API_PATH/.test(String(r.message??""))?"UNAVAILABLE":r.state,blocked:[],queue:null,message:r.message};
      const m=mapAttentionQueue(r.data);
      return m.state==="VERIFIED"?{state:"VERIFIED",blocked:m.queue.items.map(attentionAsBlocked),queue:m.queue}:{state:"ERROR",blocked:[],queue:null};
    },
    async health(){const r=await get("/health");return r.ok?{state:"VERIFIED",data:r.data}:{state:r.state,data:null,message:r.message}},
    async runs(){const r=await get("/v1/runs");return r.ok?{state:"VERIFIED",runs:Array.isArray(r.data?.runs)?r.data.runs:[]}:{state:r.state,runs:[],message:r.message}},
    async runEvents(runId){
      if(!/^RUN-[A-Za-z0-9-]+$/.test(String(runId)))return {state:"ERROR",events:[]};
      const r=await get(`/v1/runs/${encodeURIComponent(runId)}/events`);return r.ok?{state:"VERIFIED",events:mapEvents(r.data)}:{state:r.state,events:[],message:r.message};
    },
    async allMissions(){const r=await get("/v1/missions");return r.ok?mapMissions(r.data):{state:r.state,items:[],message:r.message}},
    async missionDetail(id){if(!MISSION_ID_RE.test(String(id)))return {state:"ERROR",mission:null};const r=await get(`/v1/missions/${id}`);return r.ok?mapMissionDetail(r.data):{state:r.state,mission:null,message:r.message}},
    async workRuns({missionId}={}){
      if(missionId!==undefined&&!MISSION_ID_RE.test(String(missionId)))return {state:"ERROR",items:[]};
      const r=await get(missionId?`/v1/work-runs?missionId=${missionId}`:"/v1/work-runs");return r.ok?mapWorkRuns(r.data):{state:r.state,items:[],message:r.message};
    },
    async workRunDetail(id){if(!SAFE_ID_RE.test(String(id)))return {state:"ERROR",run:null};const r=await get(`/v1/work-runs/${id}`);return r.ok?mapWorkRunDetail(r.data):{state:r.state,run:null,message:r.message}},
    /** Sorgu parametreleri sabit sırada ve yalnız geçerli değerlerle kurulur (main allow-list ile aynı kurallar). */
    async evidenceList({missionId,runId,kind,cursor,limit}={}){
      const q=[];
      if(missionId&&MISSION_ID_RE.test(missionId))q.push(`missionId=${missionId}`);
      if(runId&&SAFE_ID_RE.test(runId))q.push(`runId=${runId}`);
      if(kind&&/^[A-Z][A-Z0-9_]{0,39}$/.test(kind))q.push(`kind=${kind}`);
      if(cursor&&/^[A-Za-z0-9_.=:-]{1,128}$/.test(cursor))q.push(`cursor=${cursor}`);
      if(Number.isSafeInteger(limit)&&limit>=1&&limit<=500)q.push(`limit=${limit}`);
      const r=await get(q.length?`/v1/evidence?${q.join("&")}`:"/v1/evidence");return r.ok?mapEvidenceList(r.data):{state:r.state,items:[],nextCursor:null,message:r.message};
    },
    async evidenceItem(id){if(!SAFE_ID_RE.test(String(id)))return {state:"ERROR",item:null};const r=await get(`/v1/evidence/${id}`);return r.ok?mapEvidenceDetail(r.data):{state:r.state,item:null,message:r.message}},
    // PS-1B Project Studio okumaları: yol kurucuları main allow-list ile aynı kurallıdır; geçersiz girdi istek üretmez, 404 dürüst UNAVAILABLE kalır.
    async devrun(projectId,{force=false}={}){const p=devrunPath(projectId);if(!p)return {state:"ERROR",run:null};const r=await get(p,{force});return r.ok?mapDevRun(r.data):{state:r.state,run:null,message:r.message}},
    async projectFiles(projectId,rel=""){const p=filesPath(projectId,rel);if(!p)return {state:"ERROR",entries:[],truncated:false};const r=await get(p);return r.ok?mapFileList(r.data):{state:r.state,entries:[],truncated:false,message:r.message}},
    async projectFile(projectId,rel){const p=filePath(projectId,rel);if(!p)return {state:"ERROR",file:null};const r=await get(p);return r.ok?mapFileContent(r.data):{state:r.state,file:null,message:r.message}},
    async gitLog(projectId,limit){const p=gitLogPath(projectId,limit);if(!p)return {state:"ERROR",commits:[]};const r=await get(p);return r.ok?mapGitLog(r.data):{state:r.state,commits:[],message:r.message}},
    async gitDiff(projectId,from,to){const p=gitDiffPath(projectId,from,to);if(!p)return {state:"ERROR",diff:null};const r=await get(p);return r.ok?mapGitDiff(r.data):{state:r.state,diff:null,message:r.message}},
    async projectExports(projectId){const p=exportsPath(projectId);if(!p)return {state:"ERROR",items:[]};const r=await get(p);return r.ok?mapExports(r.data):{state:r.state,items:[],message:r.message}},
    async exportItem(projectId,exportId){const p=exportItemPath(projectId,exportId);if(!p)return {state:"ERROR",items:[]};const r=await get(p);return r.ok?mapExports({exports:[r.data?.export??r.data]}):{state:r.state,items:[],message:r.message}},
    // M1a c2: koşu teslim görünümleri (salt-okunur; main allow-list ile aynı kurallı yollar).
    async deliveries(projectId){const p=deliveriesPath(projectId);if(!p)return {state:"ERROR",items:[]};const r=await get(p);return r.ok?mapDeliveries(r.data):{state:r.state,items:[],message:r.message}},
    async delivery(runId){const p=deliveryPath(runId);if(!p)return {state:"ERROR",delivery:null};const r=await get(p);const d=r.ok?mapDelivery(r.data?.delivery):null;return r.ok?{state:d?"VERIFIED":"ERROR",delivery:d}:{state:r.state,delivery:null,message:r.message}},
    async executors(){const r=await get(EXECUTORS_PATH);return r.ok?mapExecutors(r.data):{state:r.state,items:[],message:r.message}},
    // //TR: INT-R3 D-M1-07: rol sayısı kanonik WFR-03 alanlarından okunur (registeredRoles/certified); eski "count" (LEGACY_REFERENCE_ONLY) kayıtlı rol olarak kullanılmaz, yalnız legacyRoles olarak taşınır.
    async agentCount(){const r=await get("/v1/agents"),n=v=>Number.isSafeInteger(v)&&v>=0?v:null,none={count:null,registeredRoles:null,certified:null,legacyRoles:null};if(!r.ok)return {state:r.state,...none};const reg=n(r.data?.registeredRoles);return reg===null?{state:"ERROR",...none}:{state:"VERIFIED",count:reg,registeredRoles:reg,certified:n(r.data?.certified),legacyRoles:n(r.data?.legacyRoles)}},
    // //TR: UX WP4: rol kataloğu GET /v1/roles sayfalarından (limit=100, sabit imleç biçimi) okunur; sayfa eksik, bozuk, tekrarlı veya toplamla uyuşmazsa katalog UNAVAILABLE/ERROR olur, kısmi sayı asla dönmez.
    async roles(){
      const items=[],seen=new Set();let cursor=null,total=null;
      for(let page=0;page<12;page++){
        const r=await get(cursor?`/v1/roles?limit=100&cursor=${cursor}`:"/v1/roles?limit=100");
        if(!r.ok)return {state:r.state,items:[],total:null,message:r.message};
        const p=mapRolesPage(r.data);if(!p||(total!==null&&p.total!==total))return {state:"ERROR",items:[],total:null};
        total=p.total;
        for(const it of p.items){if(seen.has(it.roleId))return {state:"ERROR",items:[],total:null};seen.add(it.roleId);items.push(it)}
        if(p.nextCursor===null)return items.length===total?{state:"VERIFIED",items,total}:{state:"ERROR",items:[],total:null};
        cursor=p.nextCursor;
      }
      return {state:"ERROR",items:[],total:null};
    },
    // //TR: UX WP-AGENTS: rol KATALOĞU /v1/roles sayfalarından (limit=100, sabit imleç biçimi) zengin ama güvenli alanlarla okunur; roles() ile aynı tam-ya-da-boş garantisi (sayfa eksik/bozuk/tekrarlı/toplamla uyuşmaz => UNAVAILABLE/ERROR, asla kısmi). control-tower sözleşmesini değiştirmemek için ayrı eşleyici (mapRoleCatalogPage) kullanılır.
    async roleCatalog(){
      const items=[],seen=new Set();let cursor=null,total=null;
      for(let page=0;page<12;page++){
        const r=await get(cursor?`/v1/roles?limit=100&cursor=${cursor}`:"/v1/roles?limit=100");
        if(!r.ok)return {state:r.state,items:[],total:null,message:r.message};
        const p=mapRoleCatalogPage(r.data);if(!p||(total!==null&&p.total!==total))return {state:"ERROR",items:[],total:null};
        total=p.total;
        for(const it of p.items){if(seen.has(it.roleId))return {state:"ERROR",items:[],total:null};seen.add(it.roleId);items.push(it)}
        if(p.nextCursor===null)return items.length===total?{state:"VERIFIED",items,total}:{state:"ERROR",items:[],total:null};
        cursor=p.nextCursor;
      }
      return {state:"ERROR",items:[],total:null};
    },
    // //TR: UX WP-AGENTS: tek rol tanımı GET /v1/roles/:roleId (yalnız UASCO-NNNN kimliği istek üretir; geçersiz kimlik istek yapmaz). Yanıt mapRoleDetail ile sanitize edilir; durumlar yükseltilmez, geçersiz yanıt dürüst ERROR olur.
    async roleDetail(roleId){
      if(!ROLE_ID_RE.test(String(roleId)))return {state:"ERROR",role:null};
      const r=await get(`/v1/roles/${roleId}`);if(!r.ok)return {state:r.state,role:null,message:r.message};
      const d=mapRoleDetail(r.data);return d?{state:"VERIFIED",...d}:{state:"ERROR",role:null};
    },
    /**
     * //TR: UX WP3: GET /v1/company/* (CRM hesap/kişi/fırsat, Finans fatura/ödeme, Hukuk sözleşme) altı kaynağı paralel okur ve her biri için {state,items,asOf,cause,message} döner:
     * VERIFIED (gerçek kayıtlar; boşsa görünüm EMPTY gösterir), STALE (son başarılı okuma + neden), NOT_CONNECTED (köprü allow-list'i yolu kabul etmiyor), UNAVAILABLE, OFFLINE, ERROR. Yalnız GET; yazma yok.
     */
    async company(){
      const rs=await Promise.all(COMPANY_KEYS.map(k=>get(COMPANY_PATHS[k])));
      const out={};
      COMPANY_KEYS.forEach((k,i)=>{
        const r=rs[i],mapped=r.ok?COMPANY_MAPPERS[k](r.data):null;
        if(mapped&&mapped.state==="VERIFIED"){const asOf=new Date(now()).toISOString();companyLastGood.set(k,{items:mapped.items,asOf});out[k]={state:"VERIFIED",items:mapped.items,asOf,cause:null,message:null};return}
        const cause=mapped?"ERROR":companyFailureState(r),message=mapped?"COMPANY_RESPONSE_INVALID":r.message??null,prev=companyLastGood.get(k);
        out[k]=prev&&cause!=="NOT_CONNECTED"?{state:"STALE",items:prev.items,asOf:prev.asOf,cause,message}:{state:cause,items:[],asOf:null,cause,message};
      });
      return out;
    },
    // //TR: FA-V2-PRODUCT: Skill Academy salt-okunur okuma-modeli (GET /v1/academy). Başarılıysa mapAcademy ile sanitize edilir (uydurma yok, dürüst durumlar); okuma başarısızsa ayrık dürüst durum ve boş veri döner.
    async academy(){const r=await get(ACADEMY_PATH);return r.ok?mapAcademy(r.data):{state:r.state,learnings:[],sources:[],reuses:0,globalKnowledge:[],byStatus:{},metrics:null,message:r.message}},
    // //TR: FA-V2-PRODUCT: Proje Yolculuğu salt-okunur okuma-modelleri (GET /v1/predev/:missionId, GET /v1/crew/:missionId; ikisi de CORE-8'de izinli). Yalnız kanonik msn_ kimliği istek üretir; başarılıysa sanitize edilir, bozuk yanıt dürüst ERROR olur, okuma hatası ayrık dürüst durumdur (uydurma yok).
    async predev(missionId){const p=predevPath(missionId);if(!p)return {state:"ERROR",predev:null};const r=await get(p);return r.ok?mapPredev(r.data):{state:r.state,predev:null,message:r.message}},
    async crew(missionId){const p=crewPath(missionId);if(!p)return {state:"ERROR",crew:null};const r=await get(p);return r.ok?mapCrew(r.data):{state:r.state,crew:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-236): Kurucu Yönetim Özeti ve İcra Defteri salt-okunur okumaları; dört sabit yol da main allow-list'inde zaten vardır (yeni uç nokta yok). Başarılıysa executive-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durumdur; uydurma yok.
    async execCockpit(){const r=await get(COCKPIT_PATH);return r.ok?mapExecCockpit(r.data):{state:r.state,cockpit:null,message:r.message}},
    async execMissions(){const r=await get(MISSIONS_PATH);return r.ok?mapExecMissions(r.data):{state:r.state,missions:null,message:r.message}},
    async execWorkRuns(){const r=await get(WORK_RUNS_PATH);return r.ok?mapExecWorkRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async execAttention(){const r=await get(ATTENTION_PATH);return r.ok?mapExecAttention(r.data):{state:r.state,attention:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-211): İnsan Onayı Bekleyen İş Kuyruğu salt-okunur okumaları; üç sabit yol da main allow-list'inde zaten vardır (yeni uç nokta yok, sorgu dizesi yok). Başarılıysa queue-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner.
    async queueAttention(){const r=await get(ATTENTION_PATH);return r.ok?mapQueueAttention(r.data):{state:r.state,attention:null,message:r.message}},
    async queueMissions(){const r=await get(MISSIONS_PATH);return r.ok?mapQueueMissions(r.data):{state:r.state,missions:null,message:r.message}},
    async queueWorkRuns(){const r=await get(WORK_RUNS_PATH);return r.ok?mapQueueWorkRuns(r.data):{state:r.state,runs:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-227): Kalite Kapısı ve Release Readiness salt-okunur okumaları; dört sabit yol da main allow-list'inde zaten vardır (GET /v1/work-runs, GET /v1/reviews [UI-049], GET /v1/cockpit evidence bloğu, GET /v1/missions; yeni uç nokta yok, sorgu dizesi yok). Başarılıysa readiness-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner.
    async readinessWorkRuns(){const r=await get(WORK_RUNS_PATH);return r.ok?mapReadinessWorkRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async readinessReviews(){const r=await get(REVIEWS_PATH);return r.ok?mapReadinessReviews(r.data):{state:r.state,reviews:null,message:r.message}},
    async readinessEvidence(){const r=await get(COCKPIT_PATH);return r.ok?mapReadinessEvidence(r.data):{state:r.state,evidence:null,message:r.message}},
    async readinessMissions(){const r=await get(MISSIONS_PATH);return r.ok?mapQueueMissions(r.data):{state:r.state,missions:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-037+046): Güvence Komuta Merkezi ve Güvenlik Duruşu salt-okunur okumaları; üç sabit yol da main allow-list'inde zaten vardır (GET /v1/work-runs, GET /v1/reviews [UI-049], GET /v1/cockpit evidence bloğu; yeni uç nokta yok, sorgu dizesi yok). Başarılıysa posture-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner.
    async commandCenterWorkRuns(){const r=await get(WORK_RUNS_PATH);return r.ok?mapPostureWorkRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async commandCenterReviews(){const r=await get(REVIEWS_PATH);return r.ok?mapPostureReviews(r.data):{state:r.state,reviews:null,message:r.message}},
    async commandCenterEvidence(){const r=await get(COCKPIT_PATH);return r.ok?mapPostureEvidence(r.data):{state:r.state,evidence:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-205): Çoklu Proje Komuta Matrisi salt-okunur okumaları; dört sabit yol da main allow-list'inde zaten vardır (GET /v1/projects, GET /v1/missions, GET /v1/work-runs, GET /v1/cockpit; yeni uç nokta yok, sorgu dizesi yok, seçili projeye göre daraltma yok). Başarılıysa matrix-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner.
    async matrixProjects(){const r=await get(PROJECTS_PATH);return r.ok?mapMatrixProjects(r.data):{state:r.state,projects:null,message:r.message}},
    async matrixMissions(){const r=await get(MISSIONS_PATH);return r.ok?mapMatrixMissions(r.data):{state:r.state,missions:null,message:r.message}},
    async matrixWorkRuns(){const r=await get(WORK_RUNS_PATH);return r.ok?mapMatrixWorkRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async matrixCockpit(){const r=await get(COCKPIT_PATH);return r.ok?mapMatrixCockpit(r.data):{state:r.state,cockpit:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-071): Operasyon ve Kurtarma salt-okunur okumaları; üç sabit yol da main allow-list'inde zaten vardır (GET /v1/control/status, GET /v1/runs, GET /v1/founder-attention; yeni uç nokta yok, sorgu dizesi yok, yeni POST yok). Başarılıysa operations-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner. Stop/Resume/Retry eylemleri BURADA yoktur; mevcut kabuk/IPC yolunda kalır.
    async operationsControl(){const r=await get(CONTROL_PATH);return r.ok?mapOperationsControl(r.data):{state:r.state,control:null,message:r.message}},
    async operationsRuns(){const r=await get(RUNS_PATH);return r.ok?mapOperationsRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async operationsAttention(){const r=await get(ATTENTION_PATH);return r.ok?mapOperationsAttention(r.data):{state:r.state,attention:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-248): İlk Çalıştırma Kurulum Doğrulaması salt-okunur okumaları; GET /v1/install ve GET /v1/phase0 main allow-list'inde zaten vardır (yeni uç nokta yok, sorgu dizesi yok). GET /v1/system/executors için mevcut executors() erişimcisi YENİDEN kullanılır (kopya yok). Başarılıysa install-core eşleyicileriyle fail-closed sanitize edilir (bozuk yanıt dürüst ERROR), okuma hatası ayrık dürüst durum olarak döner.
    async installInstall(){const r=await get(INSTALL_PATH);return r.ok?mapInstallReport(r.data):{state:r.state,install:null,message:r.message}},
    async installPhase0(){const r=await get(PHASE0_PATH);return r.ok?mapPhase0Report(r.data):{state:r.state,phase0:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-070): Denetim İzi salt-okunur okumaları; GET /v1/runs, GET /v1/runs/RUN-*/events ve GET /v1/evidence?limit=100 main/control-boundary allow-list'inde zaten vardır (yeni uç nokta ve POST yok). Başarılıysa audit-core eşleyicileriyle fail-closed sanitize edilir; okuma başarısızsa ayrık dürüst durum döner ve asla boş-temiz liste sayılmaz.
    async auditRuns(){const r=await get(AUDIT_RUNS_PATH);return r.ok?mapAuditRuns(r.data):{state:r.state,runs:null,message:r.message}},
    async auditRunEvents(runId){const p=runEventsPath(runId);if(!p)return {state:"ERROR",runId,events:null};const r=await get(p);return r.ok?mapAuditEvents(runId,r.data):{state:r.state,runId,events:null,message:r.message}},
    async auditEvidence(){const r=await get(AUDIT_EVIDENCE_PATH);return r.ok?mapAuditEvidence(r.data):{state:r.state,evidence:null,message:r.message}},
    // //TR: UI-049: Güvence Reviews paneli; /v1/reviews ve /v1/reviews/:evd_id main allow-list'inde zaten vardır (yeni uç nokta yok, yazma yok). Liste readiness-core ile fail-closed eşlenir; detay kimliği kanonik evd_+24 hex değilse istek yapılmaz.
    async assuranceReviews(){const r=await get(REVIEWS_PATH);return r.ok?mapReadinessReviews(r.data):{state:r.state,reviews:null,message:r.message}},
    async assuranceReview(id){if(!REVIEW_ID_RE.test(String(id)))return {state:"ERROR",review:null};const r=await get(`${REVIEWS_PATH}/${id}`);return r.ok?mapReviewDetail(r.data,id):{state:r.state,review:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-DOMAIN-PACKS): Alan Paketleri salt-okunur kayıt defteri okuması (GET /v1/domains, sorgu dizesi ve POST yok); yol automation/lib/control-boundary.mjs desktopGetPathAllowed listesinde zaten vardır (yeni uç nokta yok). Başarılıysa domains-core eşleyicisiyle fail-closed sanitize edilir; okunamazsa sayı null'dır (0 değil).
    async domains(){const r=await get(DOMAINS_PATH);return r.ok?mapDomains(r.data):{state:r.state,registry:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-078): Uzantılar ve Entegrasyonlar salt-okunur kayıt defteri okumaları (GET /v1/capabilities, /v1/adapters, /v1/fabrics; sorgu dizesi ve POST yok); üç yol da automation/lib/control-boundary.mjs desktopGetPathAllowed listesinde zaten vardır (yeni uç nokta yok).
    async integrationsCapabilities(){const r=await get(CAPABILITIES_PATH);return r.ok?mapCapabilities(r.data):{state:r.state,registry:null,message:r.message}},
    async integrationsAdapters(){const r=await get(ADAPTERS_PATH);return r.ok?mapAdapters(r.data):{state:r.state,registry:null,message:r.message}},
    async integrationsFabrics(){const r=await get(FABRICS_PATH);return r.ok?mapFabrics(r.data):{state:r.state,registry:null,message:r.message}},
    // //TR: Ajan Fabrikası durum özeti (GET /v1/roles/status-summary, sorgu dizesi ve POST yok); beş sayaç ayrı tutulur. Ana süreç izin listesi girişi koordinatörün korumalı grubundadır; o gelene kadar okuma UNAVAILABLE döner ve hiçbir sayı uydurulmaz.
    async rolesStatusSummary(){const r=await get(STATUS_SUMMARY_PATH);return r.ok?mapStatusSummary(r.data):{state:r.state,summary:null,message:r.message}},
    // //TR: FA-V2-PRODUCT (UI-BUILD-SCHEDULER): Derleme Zamanlayıcı salt-okunur okuması (GET /v1/scheduler, sorgu dizesi ve POST yok); yol automation/lib/control-boundary.mjs desktopGetPathAllowed listesinde zaten vardır (yeni uç nokta yok). Başarılıysa scheduler-core eşleyicisiyle fail-closed sanitize edilir.
    async scheduler(){const r=await get(SCHEDULER_PATH);return r.ok?mapScheduler(r.data):{state:r.state,scheduler:null,message:r.message}},
    // //TR: Proje bilgi özeti (GET /v1/projects/:id/knowledge, sorgu dizesi ve POST yok); Ana süreç izin listesi girişi koordinatörün korumalı grubundadır: köprü yolu reddederse (INVALID_API_PATH) durum UNAVAILABLE'dır, hiçbir sayı uydurulmaz.
    async projectKnowledge(projectId){
      const p=knowledgePath(projectId);if(!p)return {state:"ERROR",knowledge:null};
      const r=await get(p);
      if(!r.ok)return {state:/INVALID_API_PATH/.test(String(r.message??""))?"UNAVAILABLE":r.state,knowledge:null,message:r.message};
      return mapKnowledge(r.data,projectId);
    },
    // //TR: Bir bellek girdisinin geçmişi (GET /v1/projects/:id/memory/:memId/provenance, sorgu dizesi yok); izin listesi girişi koordinatörün korumalı grubundadır, reddedilirse UNAVAILABLE.
    async memoryProvenance(projectId,memId){
      const p=provenancePath(projectId,memId);if(!p)return {state:"ERROR",provenance:null};
      const r=await get(p);
      if(!r.ok)return {state:/INVALID_API_PATH/.test(String(r.message??""))?"UNAVAILABLE":r.state,provenance:null,message:r.message};
      return mapProvenance(r.data,memId);
    },
    // //TR: Bellek listesi/arama (GET /v1/projects/:id/memory[?kind=&tag=&q=]); yol buildMemorySearch ile üretilir, izin listesi girişi koordinatörün korumalı grubundadır (reddedilirse UNAVAILABLE).
    async memoryList(projectId,path){
      if(typeof path!=="string"||!path.startsWith(`/v1/projects/${projectId}/memory`))return {state:"ERROR",list:null};
      const r=await get(path);
      if(!r.ok)return {state:/INVALID_API_PATH/.test(String(r.message??""))?"UNAVAILABLE":r.state,list:null,message:r.message};
      return mapMemoryList(r.data,projectId);
    },
    async raw(path){return get(path)}
  };
}
