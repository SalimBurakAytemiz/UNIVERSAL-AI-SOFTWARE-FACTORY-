// //TR: DSK-T0002 (UI-014) saf çekirdek: GET /v1/missions/:id/analysis/report yanıtını sıkı biçimde süzer ve okunur rapor modeline (özet, önerilen işler + kabul kriterleri, riskler ve açık sorular, karar durumu) çevirir. Yalnız sunucu verisi kullanılır; eksik bölüm boş/NOT_STARTED kalır, hiçbir içerik ya da onay UYDURULMAZ. Bozuk yanıt dürüst ERROR olur.
export const REPORT_KINDS=["BusinessAnalysis","Requirements","Plan","Architecture"];
const MISSION_RE=/^msn_[0-9a-f]{24}$/;
const STATES=["NOT_STARTED","DRAFT","SUBMITTED","APPROVED","REJECTED"];
const isObj=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const str=(x,n=2000)=>typeof x==="string"&&x.trim()!==""?x.slice(0,n):null;
const strs=(x,max=100,n=1000)=>Array.isArray(x)?x.map(v=>str(v,n)).filter(v=>v!==null).slice(0,max):[];
const objs=(x,max=200)=>Array.isArray(x)?x.filter(isObj).slice(0,max):[];
const intOrNull=x=>Number.isInteger(x)&&x>=0?x:null;

export function analysisReportPath(missionId){return typeof missionId==="string"&&MISSION_RE.test(missionId)?`/v1/missions/${missionId}/analysis/report`:null}

/** Ham yanıt -> {state:"VERIFIED",report} | {state:"ERROR",report:null}. */
export function mapAnalysisReport(raw){
  const bad={state:"ERROR",report:null};
  const r=isObj(raw)?raw.report:null;
  if(!isObj(r)||!MISSION_RE.test(String(r.missionId))||typeof r.active!=="boolean"||typeof r.phase!=="string"||!isObj(r.sections)||!Array.isArray(r.tasks))return bad;
  const sections={};
  for(const kind of REPORT_KINDS){
    const s=r.sections[kind];
    if(!isObj(s)||!STATES.includes(s.state))return bad;
    sections[kind]={state:s.state,artifactId:str(s.artifactId,80),version:intOrNull(s.version),content:isObj(s.content)?s.content:null};
  }
  const tasks=objs(r.tasks,500).map(t=>({taskId:str(t.taskId,80),title:str(t.title,500),status:str(t.status,40)})).filter(t=>t.taskId);
  return {state:"VERIFIED",report:{missionId:r.missionId,active:r.active,phase:str(r.phase,40),sections,tasks}};
}

/** Rapor -> okunur model. Önerilen işler Plan iş paketleridir; kabul kriterleri iş paketinin karşıladığı (satisfies) gereksinimlerden gelir. */
export function buildReportModel(report){
  const s=report.sections,ba=s.BusinessAnalysis.content,rq=s.Requirements.content,pl=s.Plan.content,ar=s.Architecture.content;
  const summary=ba?{problem:str(ba.problem,4000),goals:objs(ba.goals).map(g=>({id:str(g.id,80),statement:str(g.statement)})).filter(g=>g.statement),successMetrics:strs(ba.successMetrics),stakeholders:strs(ba.stakeholders)}:null;
  const reqs=new Map();
  if(rq)for(const group of ["functional","nonFunctional"])for(const r of objs(rq[group])){const id=str(r.id,80);if(id)reqs.set(id,{id,statement:str(r.statement),acceptanceCriteria:strs(r.acceptanceCriteria,50)})}
  const tasks=pl?objs(pl.workPackages).map(w=>{
    const satisfies=strs(w.satisfies,50,80);
    return {id:str(w.id,80),title:str(w.title,500),estimate:str(w.estimate,80),dependsOn:strs(w.dependsOn,50,80),
      requirements:satisfies.map(id=>reqs.get(id)??{id,statement:null,acceptanceCriteria:[],unknown:true})};
  }).filter(t=>t.id):null;
  const risks=[...(ba?strs(ba.risks).map(text=>({source:"BusinessAnalysis",text})):[]),...(ar?strs(ar.risks).map(text=>({source:"Architecture",text})):[])];
  // Açık sorular: sunucuda ayrı bir "açık soru" alanı YOKTUR; doğrulanmamış varsayımlar ve kısıtlar dürüstçe bu başlık altında, kaynağıyla gösterilir.
  const questions=[...(ba?strs(ba.assumptions).map(text=>({source:"assumption",text})):[]),...(ba?strs(ba.constraints).map(text=>({source:"constraint",text})):[]),...(pl?strs(pl.outOfScope).map(text=>({source:"outOfScope",text})):[])];
  const decisions=REPORT_KINDS.map(kind=>({kind,state:s[kind].state,artifactId:s[kind].artifactId,version:s[kind].version}));
  const approved=decisions.filter(d=>d.state==="APPROVED").length;
  return {summary,tasks,risks,questions,decisions,approved,total:decisions.length,createdTasks:report.tasks,hasContent:REPORT_KINDS.some(k=>s[k].content!==null)};
}
