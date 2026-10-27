// //TR: A2 (Araçlar paneli) saf çekirdeği: GET /v1/adapters/reality yanıtını SIKI ve fail-closed okur. Bu uç nokta henüz sunucuda ve ana süreç izin listesinde YOKTUR (docs/authority-requests/LANE-A-adapter-reality-route.md); yanıt şekli core/capabilities/adapter-reality.ts buildAdapterRealityReport çıktısından (AdapterReconciliation + her adaptör için codePath/probe/ciEvidence) türetilmiştir. Dört olgu AYRI tutulur ve birbirine çevrilmez: kayıtlı (registry), kod destekli (kaynak ağacında doğrulanmış kod yolu), CI kanıt sınıfı (CI'ın ne kanıtladığı), probe durumu (canlı kontrol). Hiçbiri "kurulu" demek değildir. Sunucu adapterReality NOT_SUPPLIED derse (paketli uygulama) sonuç ÖLÇÜLMEDİ'dir: sıfır ya da "hazır değil" değildir.
export const ADAPTER_REALITY_PATH="/v1/adapters/reality";
export const CI_EVIDENCE=Object.freeze(["REAL","REAL_WHEN_CONFIGURED","FAKE_ONLY","FAKE_BINARY_ONLY","HARNESS_NOT_CI","DISCOVERY_ONLY","IN_PROCESS_RUNTIME","RUNTIME_PREREQUISITE"]);
export const PROBE_STATES=Object.freeze(["READY","FAILED","NOT_OBSERVED"]);
export const REALITY_FINDINGS=Object.freeze(["UNDER_REPORTED","OVER_REPORTED","UNREGISTERED_REAL","DEAD_CODE","ADAPTER_UNRESOLVED"]);
export const REALITY_ORIGINS=Object.freeze(["REGISTRY","UNREGISTERED","BINDING"]);
export const MAX_ADAPTERS=500;
export const MAX_FINDINGS=1000;
export const MAX_COUNT=1_000_000;
const MAX_CI_PROBLEMS=100;
const ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_COUNT;
const sameKeys=(o,keys)=>{const k=Object.keys(o);return k.length===keys.length&&keys.every(x=>k.includes(x))};
const idList=(a,max)=>Array.isArray(a)&&a.length<=max&&a.every(x=>typeof x==="string"&&ID_RE.test(x))&&new Set(a).size===a.length;
const tally=(items,key,values)=>{const m=Object.fromEntries(values.map(v=>[v,0]));for(const it of items)m[it[key]]+=1;return m};

/**
 * Yanıt -> {state:"VERIFIED",reality} | {state:"NOT_SUPPLIED"} | {state:"ERROR"}.
 * NOT_SUPPLIED yalnız tam olarak {schemaVersion:"1.0.0", adapterReality:"NOT_SUPPLIED"} gövdesidir (ek alan ERROR). VERIFIED için tüm değişmezler tutmalıdır: sayaçlar bulgu dizisiyle, kod destekli kimlikler adaptör satırlarıyla, ölü kod ve çözülemeyen kimlikler bulgularla birebir uyuşur; biri bozuksa TÜM okuma ERROR olur (kısmi sayı yok).
 */
export function mapAdapterReality(raw){
  const bad={state:"ERROR"};
  if(!isObj(raw)||raw.schemaVersion!=="1.0.0")return bad;
  if(raw.adapterReality==="NOT_SUPPLIED")return sameKeys(raw,["schemaVersion","adapterReality"])?{state:"NOT_SUPPLIED"}:bad;
  if(raw.adapterReality!=="SUPPLIED"||!sameKeys(raw,["schemaVersion","adapterReality","registry","adapters","codeBackedRegistryIds","unregisteredReal","deadCode","unresolvedBindingAdapters","findings","counts","ciProblems"]))return bad;
  const g=raw.registry;
  if(!isObj(g)||!sameKeys(g,["total","defined","implemented"])||![g.total,g.defined,g.implemented].every(count)||g.defined>g.total||g.implemented>g.total)return bad;
  if(!Array.isArray(raw.adapters)||raw.adapters.length>MAX_ADAPTERS)return bad;
  const adapters=[],seen=new Set();
  for(const a of raw.adapters){
    if(!isObj(a)||!sameKeys(a,["id","origin","codePath","probe","ciEvidence"])||typeof a.id!=="string"||!ID_RE.test(a.id)||seen.has(a.id))return bad;
    if(!REALITY_ORIGINS.includes(a.origin)||!["PRESENT","ABSENT"].includes(a.codePath)||!PROBE_STATES.includes(a.probe)||!CI_EVIDENCE.includes(a.ciEvidence))return bad;
    seen.add(a.id);adapters.push({id:a.id,origin:a.origin,codePath:a.codePath,probe:a.probe,ciEvidence:a.ciEvidence});
  }
  if(!idList(raw.codeBackedRegistryIds,MAX_ADAPTERS)||!idList(raw.unregisteredReal,MAX_ADAPTERS)||!idList(raw.deadCode,MAX_FINDINGS)||!idList(raw.unresolvedBindingAdapters,MAX_FINDINGS))return bad;
  const byId=new Map(adapters.map(a=>[a.id,a]));
  const registryPresent=adapters.filter(a=>a.origin==="REGISTRY"&&a.codePath==="PRESENT").map(a=>a.id).sort();
  if(raw.codeBackedRegistryIds.length!==registryPresent.length||[...raw.codeBackedRegistryIds].sort().some((x,i)=>x!==registryPresent[i]))return bad;
  if(raw.codeBackedRegistryIds.length>g.total)return bad;
  if(!raw.unregisteredReal.every(x=>byId.get(x)?.codePath==="PRESENT"))return bad;
  if(!Array.isArray(raw.findings)||raw.findings.length>MAX_FINDINGS)return bad;
  const findings=[];
  for(const f of raw.findings){
    if(!isObj(f)||!sameKeys(f,["finding","id","detail"])||!REALITY_FINDINGS.includes(f.finding)||typeof f.id!=="string"||!ID_RE.test(f.id)||typeof f.detail!=="string"||f.detail.length>300)return bad;
    findings.push({finding:f.finding,id:f.id});
  }
  if(!isObj(raw.counts)||!sameKeys(raw.counts,REALITY_FINDINGS)||!REALITY_FINDINGS.every(k=>count(raw.counts[k])))return bad;
  const tf=tally(findings,"finding",REALITY_FINDINGS);
  if(REALITY_FINDINGS.some(k=>tf[k]!==raw.counts[k]))return bad;
  const idsOf=k=>findings.filter(f=>f.finding===k).map(f=>f.id).sort();
  const eq=(a,b)=>a.length===b.length&&[...a].sort().every((x,i)=>x===b[i]);
  if(!eq(raw.deadCode,idsOf("DEAD_CODE"))||!eq(raw.unresolvedBindingAdapters,idsOf("ADAPTER_UNRESOLVED"))||!eq(raw.unregisteredReal,idsOf("UNREGISTERED_REAL")))return bad;
  if(!idsOf("UNDER_REPORTED").every(x=>raw.codeBackedRegistryIds.includes(x)))return bad;
  if(!Array.isArray(raw.ciProblems)||raw.ciProblems.length>MAX_CI_PROBLEMS||!raw.ciProblems.every(x=>typeof x==="string"&&x.length>0&&x.length<=300))return bad;
  const present=adapters.filter(a=>a.codePath==="PRESENT");
  return {state:"VERIFIED",reality:{
    registry:{total:g.total,defined:g.defined,implemented:g.implemented},
    adapters,codeBackedRegistryIds:[...raw.codeBackedRegistryIds].sort(),
    codeBacked:{registry:raw.codeBackedRegistryIds.length,other:present.length-raw.codeBackedRegistryIds.length,absent:adapters.length-present.length},
    ci:tally(present,"ciEvidence",CI_EVIDENCE),probe:tally(adapters,"probe",PROBE_STATES),
    findings,counts:{...raw.counts},deadCode:[...raw.deadCode].sort(),unresolvedBindingAdapters:[...raw.unresolvedBindingAdapters].sort(),ciProblems:[...raw.ciProblems]}};
}

/**
 * Üç kaynaktan (GET /v1/adapters eşlemesi, GET /v1/adapters/reality eşlemesi, hazırlık eşlemesi) tek ölçüm durumu.
 * MEASURED yalnız rapor doğrulanmış VE hazırlık girdisi NOT_SUPPLIED demiyorsa; çelişki CONFLICT'tir (ölçülmedi). Paketli uygulamada NOT_SUPPLIED sayı değil "ölçülmedi"dir.
 */
export function toolsMeasurement(reality,ready){
  const input=ready&&ready.state==="VERIFIED"?ready.readiness.inputs.adapterReality:null;
  if(reality&&reality.state==="VERIFIED")return input==="NOT_SUPPLIED"?{kind:"CONFLICT"}:{kind:"MEASURED"};
  if(reality&&reality.state==="NOT_SUPPLIED")return {kind:"NOT_SUPPLIED"};
  if(input==="NOT_SUPPLIED")return {kind:"NOT_SUPPLIED"};
  if(reality&&reality.state==="UNAVAILABLE")return {kind:"UNSERVED"};
  if(reality&&reality.state==="OFFLINE")return {kind:"OFFLINE"};
  return {kind:"ERROR"};
}
