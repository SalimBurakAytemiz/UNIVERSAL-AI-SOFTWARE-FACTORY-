// //TR: Bu modül renderer veri erişiminin tek kapısıdır: yalnız preload köprüsü (window.uasco.apiGet / apiPost) üzerinden GET ve sabit allow-list'li JSON POST yapar, token'ı hiç görmez; sonuçları epoch'lu önbellekte tutar, aynı anda gelen istekleri birleştirir ve eski epoch yanıtlarını atar.
import {classifyFailure,mapCockpit,emptyCockpit,mapProjects,mapMissions,mapControlStatus,mapEvents,mapAttention} from "./model.js";
import {MISSION_ID_RE,SAFE_ID_RE,mapMissionDetail,mapWorkRuns,mapWorkRunDetail,mapEvidenceList,mapEvidenceDetail} from "./work-core.js";

const TTL_MS=3000;
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
  return {
    get,post,stale,
    async cockpit(){const r=await get("/v1/cockpit");return r.ok?{state:"OK",data:mapCockpit(r.data)}:{state:r.state,data:emptyCockpit(r.state),message:r.message}},
    async projects(){const r=await get("/v1/projects");return r.ok?mapProjects(r.data):{state:r.state,items:[],message:r.message}},
    async missions(){const q=store.projectId?`/v1/missions?projectId=${store.projectId}`:"/v1/missions";const r=await get(q);return r.ok?mapMissions(r.data):{state:r.state,items:[],message:r.message}},
    async control(){const r=await get("/v1/control/status");return r.ok?mapControlStatus(r.data):{state:r.state,active:false,reason:null,message:r.message}},
    async attention(){const r=await get("/v1/founder-attention");return r.ok?mapAttention(r.data):{state:r.state,blocked:[],message:r.message}},
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
    async agentCount(){const r=await get("/v1/agents");return r.ok&&Number.isSafeInteger(r.data?.count)&&r.data.count>=0?{state:"VERIFIED",count:r.data.count}:{state:r.ok?"ERROR":r.state,count:null}},
    async raw(path){return get(path)}
  };
}
