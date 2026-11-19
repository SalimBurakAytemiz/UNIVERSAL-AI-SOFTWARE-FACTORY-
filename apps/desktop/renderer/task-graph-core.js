// //TR: DSK-T0003 (UI-024 + UI-207): mission görev bağımlılık haritası ve kritik yolun SAF çekirdeği. Girdi yalnız GET /v1/missions/:id/tasks okumasıdır; döngü, eksik bağımlılık hedefi, yinelenen görev ve okunamayan dependsOn dürüst hata olarak raporlanır, hiçbiri sessizce düzeltilmez. Kritik yol süre tahmini DEĞİLDİR: görev sayısına göre en uzun bağımlılık zinciridir ve döngü varsa hesaplanmaz (null).
export const TASK_GRAPH_TASK_ID_RE=/^tsk_[0-9a-f]{24}$/;
export const TASK_GRAPH_MISSION_ID_RE=/^msn_[0-9a-f]{24}$/;
export const TASK_GRAPH_MAX_TASKS=200;
export const TASK_GRAPH_KINDS=Object.freeze(["ready","active","waiting","blocked","done","unresolved","unknown"]);
const STATUSES=new Set(["PENDING","IN_PROGRESS","DONE","BLOCKED"]);
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

/** GET /v1/missions/:id/tasks yolunu yalnız geçerli mission kimliği için üretir; aksi halde null. */
export function missionTasksPath(missionId){return TASK_GRAPH_MISSION_ID_RE.test(String(missionId??""))?`/v1/missions/${missionId}/tasks`:null}

/** Sunucu yanıtını eşler. Geçersiz kimlikli görev atılır ama `dropped` sayılır; dependsOn dizi değilse null (bilinmiyor) kalır; dizi içindeki metin olmayan girdi "invalidDeps" sayılır. */
export function mapMissionTasks(raw){
  if(!isObj(raw)||!Array.isArray(raw.tasks))return {state:"ERROR",tasks:[],dropped:0,truncated:false};
  const list=raw.tasks.slice(0,TASK_GRAPH_MAX_TASKS);let dropped=0;const tasks=[];
  for(const t of list){
    if(!isObj(t)||typeof t.taskId!=="string"||!TASK_GRAPH_TASK_ID_RE.test(t.taskId)){dropped+=1;continue}
    const deps=Array.isArray(t.dependsOn)?t.dependsOn:null;
    tasks.push({taskId:t.taskId,title:typeof t.title==="string"&&t.title?t.title.slice(0,200):null,status:typeof t.status==="string"&&STATUSES.has(t.status)?t.status:null,
      dependsOn:deps===null?null:deps.filter(d=>typeof d==="string").map(d=>d.slice(0,80)),invalidDeps:deps===null?0:deps.filter(d=>typeof d!=="string").length});
  }
  return {state:"VERIFIED",tasks,dropped,truncated:raw.tasks.length>TASK_GRAPH_MAX_TASKS};
}

/** Tarjan SCC: 1'den büyük bileşenler ve kendine bağımlı düğümler döngüdür. Döngüler giriş sırasına göre kararlı döner. */
function findCycles(n,succ,selfLoop){
  const index=new Array(n).fill(-1),low=new Array(n).fill(0),on=new Array(n).fill(false),stack=[],out=[];let next=0;
  const strong=v=>{
    index[v]=low[v]=next++;stack.push(v);on[v]=true;
    for(const w of succ[v]){if(index[w]<0){strong(w);low[v]=Math.min(low[v],low[w])}else if(on[w])low[v]=Math.min(low[v],index[w])}
    if(low[v]===index[v]){const comp=[];let w;do{w=stack.pop();on[w]=false;comp.push(w)}while(w!==v);if(comp.length>1||selfLoop[v])out.push(comp.sort((a,b)=>a-b))}
  };
  for(let v=0;v<n;v++)if(index[v]<0)strong(v);
  return out.sort((a,b)=>a[0]-b[0]);
}

/**
 * Görev listesinden DAG'ı kurar.
 * Düğüm türleri: done, active (IN_PROGRESS), blocked (durum BLOCKED), ready (PENDING ve tüm bağımlılıklar DONE),
 * waiting (PENDING, bağımlılık bekliyor), unresolved (PENDING ama bağımlılık bilinmiyor/eksik/döngüde), unknown (durum okunamadı).
 */
export function buildTaskGraph(tasks){
  const list=Array.isArray(tasks)?tasks:[];
  const at=new Map(),duplicates=[],nodes=[];
  for(const t of list){if(at.has(t.taskId)){duplicates.push(t.taskId);continue}at.set(t.taskId,nodes.length);nodes.push({taskId:t.taskId,title:t.title??null,status:t.status??null,index:nodes.length,deps:t.dependsOn,invalidDeps:t.invalidDeps??0})}
  const n=nodes.length,succ=nodes.map(()=>[]),pred=nodes.map(()=>[]),selfLoop=new Array(n).fill(false);
  const edges=[],missing=[],unknownDeps=[],invalidDeps=[];
  for(const v of nodes){
    if(v.deps===null){unknownDeps.push(v.taskId);continue}
    if(v.invalidDeps>0)invalidDeps.push(v.taskId);
    for(const d of new Set(v.deps)){
      const u=at.get(d);
      if(u===undefined){missing.push({taskId:v.taskId,dependsOn:d});continue}
      if(u===v.index)selfLoop[u]=true;
      succ[u].push(v.index);pred[v.index].push(u);edges.push({from:d,to:v.taskId});
    }
  }
  const cycleIdx=findCycles(n,succ,selfLoop),inCycle=new Array(n).fill(false);
  for(const c of cycleIdx)for(const v of c)inCycle[v]=true;
  // Kahn: döngüsüz kısmın topolojik sırası (eşitlikte giriş sırası) ve derinliği (en uzun önceki zincir).
  const indeg=pred.map(p=>p.length),order=[],len=new Array(n).fill(0),prev=new Array(n).fill(-1),ready=[];
  for(let v=0;v<n;v++)if(indeg[v]===0)ready.push(v);
  while(ready.length){
    ready.sort((a,b)=>a-b);const v=ready.shift();order.push(v);len[v]=Math.max(len[v],1);
    for(const w of succ[v]){if(len[v]+1>len[w]||(len[v]+1===len[w]&&prev[w]>v)){len[w]=len[v]+1;prev[w]=v}if(--indeg[w]===0)ready.push(w)}
  }
  const acyclic=cycleIdx.length===0;
  let criticalPath=null;
  if(acyclic&&n>0){
    let end=0;for(let v=1;v<n;v++)if(len[v]>len[end])end=v;
    const path=[];for(let v=end;v>=0;v=prev[v])path.unshift(v);
    criticalPath=path.map(v=>nodes[v].taskId);
  }
  const onPath=new Set(criticalPath??[]),pathEdges=new Set();
  if(criticalPath)for(let i=1;i<criticalPath.length;i++)pathEdges.add(`${criticalPath[i-1]}>${criticalPath[i]}`);
  const missingOf=new Map();for(const m of missing)missingOf.set(m.taskId,[...(missingOf.get(m.taskId)??[]),m.dependsOn]);
  const maxLevel=order.length?Math.max(...order.map(v=>len[v]-1)):-1;
  const outNodes=nodes.map(v=>{
    const unresolved=v.deps===null||missingOf.has(v.taskId)||inCycle[v.index]||v.invalidDeps>0;
    const depsDone=pred[v.index].every(u=>nodes[u].status==="DONE");
    const kind=v.status===null?"unknown":v.status==="DONE"?"done":v.status==="IN_PROGRESS"?"active":v.status==="BLOCKED"?"blocked":unresolved?"unresolved":depsDone?"ready":"waiting";
    return {taskId:v.taskId,title:v.title,status:v.status,kind,index:v.index,
      level:inCycle[v.index]||len[v.index]===0?maxLevel+1:len[v.index]-1,
      critical:onPath.has(v.taskId),inCycle:inCycle[v.index],missing:missingOf.get(v.taskId)??[],
      dependsOn:pred[v.index].map(u=>nodes[u].taskId),waitingOn:pred[v.index].filter(u=>nodes[u].status!=="DONE").map(u=>nodes[u].taskId)};
  });
  const counts=Object.fromEntries(TASK_GRAPH_KINDS.map(k=>[k,outNodes.filter(x=>x.kind===k).length]));
  const errors={cycles:cycleIdx.map(c=>c.map(v=>nodes[v].taskId)),missing,duplicates,unknownDeps,invalidDeps};
  const errorCount=errors.cycles.length+missing.length+duplicates.length+unknownDeps.length+invalidDeps.length;
  return {nodes:outNodes,edges:edges.map(e=>({...e,critical:pathEdges.has(`${e.from}>${e.to}`)})),criticalPath,acyclic,errors,errorCount,counts};
}

/** Sütun = derinlik (döngüdeki/çözülemeyen düğümler son sütunda), satır = sütun içi giriş sırası. Saf geometri; SVG üretmez. */
export function layoutTaskGraph(graph,{nodeW=180,nodeH=44,gapX=56,gapY=14,pad=12}={}){
  const cols=new Map();
  for(const v of graph.nodes){if(!cols.has(v.level))cols.set(v.level,[]);cols.get(v.level).push(v)}
  const levels=[...cols.keys()].sort((a,b)=>a-b),pos=new Map();
  levels.forEach((lv,ci)=>cols.get(lv).forEach((v,ri)=>pos.set(v.taskId,{x:pad+ci*(nodeW+gapX),y:pad+ri*(nodeH+gapY),w:nodeW,h:nodeH})));
  const rows=Math.max(0,...[...cols.values()].map(c=>c.length));
  const width=levels.length?pad*2+levels.length*nodeW+(levels.length-1)*gapX:0,height=rows?pad*2+rows*nodeH+(rows-1)*gapY:0;
  const edges=graph.edges.map(e=>{
    const a=pos.get(e.from),b=pos.get(e.to);
    if(!a||!b)return null;
    if(e.from===e.to){const x=a.x+a.w,y=a.y+a.h/2;return {...e,d:`M${x} ${y-8} C${x+30} ${y-30} ${x+30} ${y+30} ${x} ${y+8}`}}
    const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mx=(x1+x2)/2;
    return {...e,d:`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`};
  }).filter(Boolean);
  return {width,height,pos,edges};
}
