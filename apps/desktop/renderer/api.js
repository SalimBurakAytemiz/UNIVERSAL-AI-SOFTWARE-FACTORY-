// //TR: Bu modül renderer veri erişiminin tek kapısıdır: yalnız preload köprüsü (window.uasco.apiGet) üzerinden GET yapar, token'ı hiç görmez; sonuçları epoch'lu önbellekte tutar, aynı anda gelen istekleri birleştirir ve eski epoch yanıtlarını atar.
import {classifyFailure,mapCockpit,emptyCockpit,mapProjects,mapMissions,mapControlStatus,mapEvents,mapAttention} from "./model.js";

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
  const stale=r=>r.epoch!==store.epoch;
  return {
    get,stale,
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
    async raw(path){return get(path)}
  };
}
