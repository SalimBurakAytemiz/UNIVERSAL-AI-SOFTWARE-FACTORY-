// //TR: DSK-T0006 (UI-038..UI-045) proje başına test stratejisi ve kapsam görünümünün saf (DOM'suz) çekirdeği. Girdi yalnız mevcut gerçek okumalardır: mapTestReports (GET /v1/work-runs test kanıtı),
// GET /v1/projects (beyan edilen testCommand) ve GET /v1/work-runs/:id teslim görünümü (ürün doğrulama ekseni). Hiçbir sayı/sonuç tahmin edilmez: test kaydı yoksa NOT_EXECUTED, EXECUTED asla PRODUCT_VERIFIED sayılmaz
// (ürün doğrulaması yalnız sunucunun productVerification ekseninden okunur), laboratuvar kategorileri (API/web/mobil/masaüstü/performans/görsel) için kanıt türü yoktur ve hepsi NOT_EXECUTED/BLOCKED (Founder kapısı) kalır.

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const PROJECT_RE=/^prj_[0-9a-f]{24}$/;
export const TEST_STATES=Object.freeze(["EXECUTED","FAILED","BLOCKED","UNVERIFIED","NOT_EXECUTED"]);
export const PRODUCT_AXIS=Object.freeze(["NOT_VERIFIED","PRODUCT_VERIFIED","FAILED"]);

// //TR: UI-040..UI-045 laboratuvarları: bugün hiçbiri için yürütme kanıtı türü kaydedilmez; durum sabit ve dürüsttür, "koş" eylemi yoktur.
export const LAB_CATEGORIES=Object.freeze([
  {id:"api",ui:"UI-040",state:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"web",ui:"UI-041",state:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"mobile",ui:"UI-042",state:"BLOCKED",gate:"FD-REL-1 + DEVICE_FARM"},
  {id:"desktop",ui:"UI-043",state:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"performance",ui:"UI-044",state:"NOT_EXECUTED",gate:"FD-REL-1"},
  {id:"visual",ui:"UI-045",state:"NOT_EXECUTED",gate:"FD-REL-1"}
]);

/** Koşunun güncel head'e bağlı son TEST_SURFACE kaydı (dosya listeleri + yürütülen sayı); yoksa null. */
export function latestSurface(run){
  const recs=Array.isArray(run?.records)?run.records:[];
  for(let i=recs.length-1;i>=0;i--){const r=recs[i];if(r.kind==="TEST_SURFACE"&&r.atHead)return r}
  return null;
}

/**
 * mapTestReports çıktısı -> proje başına gruplar. Sunucu sırası en eski önce; her projenin koşuları en yeni önce döner,
 * projeler en yeni koşusuna göre sıralanır. Geçersiz proje kimliği olan koşu "unassigned" sayılır (gruba uydurulmaz).
 */
export function groupTestsByProject(reports){
  if(!isObj(reports)||reports.state!=="VERIFIED"||!Array.isArray(reports.runs))return {state:isObj(reports)&&typeof reports.state==="string"&&reports.state!=="VERIFIED"?reports.state:"ERROR",projects:[],unassigned:0,truncated:false};
  const map=new Map();let unassigned=0;
  reports.runs.forEach((r,order)=>{
    if(typeof r.projectId!=="string"||!PROJECT_RE.test(r.projectId)){unassigned++;return}
    let g=map.get(r.projectId);
    if(!g){g={projectId:r.projectId,runs:[],counts:Object.fromEntries(TEST_STATES.map(s=>[s,0])),lastOrder:-1};map.set(r.projectId,g)}
    g.runs.push(r);g.lastOrder=order;
    const st=TEST_STATES.includes(r.state)?r.state:"NOT_EXECUTED";g.counts[st]++;
  });
  const projects=[...map.values()].sort((a,b)=>b.lastOrder-a.lastOrder).map(g=>{
    const runs=[...g.runs].reverse(),latest=runs[0];
    return {projectId:g.projectId,runs,total:runs.length,counts:g.counts,latest,surface:latestSurface(latest)};
  });
  return {state:"VERIFIED",projects,unassigned,truncated:reports.truncated===true};
}

/** GET /v1/projects ham sonucu (api.raw) -> seçili projenin adı ve beyan edilen testCommand argv'si. Proje yoksa NOT_FOUND; okuma başarısızsa okuma durumu. */
export function projectStrategy(raw,projectId){
  if(!isObj(raw)||raw.ok!==true)return {state:isObj(raw)&&typeof raw.state==="string"?raw.state:"ERROR",name:null,testCommand:null};
  const list=isObj(raw.data)&&Array.isArray(raw.data.projects)?raw.data.projects:null;
  if(!list)return {state:"ERROR",name:null,testCommand:null};
  const p=list.find(x=>isObj(x)&&x.projectId===projectId);
  if(!p)return {state:"NOT_FOUND",name:null,testCommand:null};
  const argv=Array.isArray(p.testCommand)&&p.testCommand.length>0&&p.testCommand.every(a=>typeof a==="string"&&a.length<=500)?p.testCommand.slice(0,40):null;
  return {state:"VERIFIED",name:typeof p.name==="string"&&p.name.length?p.name.slice(0,200):null,testCommand:argv};
}

/** api.workRunDetail sonucu -> ürün doğrulama ekseni. Okuma başarısız ya da eksen tanınmıyorsa null (asla PRODUCT_VERIFIED varsayılmaz). */
export function productAxisOf(detail){
  if(!isObj(detail)||detail.state!=="VERIFIED"||!isObj(detail.run))return {state:isObj(detail)&&typeof detail.state==="string"&&detail.state!=="VERIFIED"?detail.state:"ERROR",axis:null};
  const v=detail.run.productVerification;
  return {state:"VERIFIED",axis:PRODUCT_AXIS.includes(v)?v:null};
}
