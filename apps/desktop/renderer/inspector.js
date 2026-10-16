// //TR: Bu modül UX WP-SHELL-REFINE global Inspector çekmecesidir (sağ taraflı, dialog benzeri modal): verilen bir varlık referansı {kind,id} (project/mission/run/role) için GERÇEK ayrıntıları YALNIZ zaten allow-list'li GET'ler üzerinden (api.projects / api.missionDetail / api.workRunDetail / api.roleDetail) okur ve dürüst boş/UNAVAILABLE durumlarıyla gösterir. Yalnız h()/textContent; API verisi asla HTML olarak yorumlanmaz, veri UYDURULMAZ (sunucu bildirmediyse "—"). Yeni GET/yazma yoktur; STOP veya başka yan etkili denetim burada yoktur. Çekmece modal <dialog> olduğu için odak hapsi (focus-trap) tarayıcıdan gelir; Esc kapatır ve odak çağıran denetime geri döner.
import {h,stateNote,badge,statusLabel} from "./components.js";
import {MISSING,formatTime} from "./model.js";

export const INSPECTOR_KINDS=Object.freeze(["project","mission","run","role"]);
// //TR: Dürüst gönderim: kimlik biçimi geçersizse istek hiç yapılmaz (api.js / main.mjs allow-list kuralları ile aynı desenler).
const REF_ID_RE=Object.freeze({project:/^prj_[0-9a-f]{24}$/,mission:/^msn_[0-9a-f]{24}$/,run:/^[A-Za-z0-9_-]{6,64}$/,role:/^UASCO-\d{4}$/});

/** Referans incelenebilir mi: bilinen kind + geçerli kimlik biçimi. */
export function isInspectableRef(ref){
  return Boolean(ref)&&INSPECTOR_KINDS.includes(ref.kind)&&typeof ref.id==="string"&&REF_ID_RE[ref.kind].test(ref.id);
}

/**
 * //TR: Varlık ayrıntısını GERÇEK sunucudan, YALNIZ mevcut allow-list'li GET'lerle okur. Proje için tek-kayıt GET'i yoktur; mevcut /v1/projects listesinden eşleşen kayıt alınır (yeni rota eklenmez). Durum sunucudan olduğu gibi taşınır; kayıt yoksa dürüst UNAVAILABLE. Hiçbir alan uydurulmaz.
 */
export async function fetchInspectorDetail(ctx,ref){
  if(!isInspectableRef(ref))return {state:"ERROR",entity:null};
  if(ref.kind==="project"){
    const r=await ctx.api.projects();
    if(r.state!=="VERIFIED")return {state:r.state,entity:null};
    const p=(Array.isArray(r.items)?r.items:[]).find(x=>x.projectId===ref.id);
    return p?{state:"VERIFIED",entity:p}:{state:"UNAVAILABLE",entity:null};
  }
  if(ref.kind==="mission"){const r=await ctx.api.missionDetail(ref.id);return {state:r.state,entity:r.mission};}
  if(ref.kind==="run"){const r=await ctx.api.workRunDetail(ref.id);return {state:r.state,entity:r.run};}
  const r=await ctx.api.roleDetail(ref.id);return {state:r.state,entity:r.role,guild:r.guild,cluster:r.cluster};
}

/** Varlık için kısa, dürüst görünür ad (çekmece alt başlığında / palet eyleminde kullanılır); yoksa kimlik. */
export function labelForEntity(ref,entity){
  if(!entity)return ref?.id??MISSING;
  if(ref.kind==="project")return entity.name??ref.id;
  if(ref.kind==="mission")return entity.title??ref.id;
  if(ref.kind==="role")return entity.title??ref.id;
  return ref.id;
}

function kv(ctx,pairs){
  const doc=ctx.doc,nodes=[];
  for(const [labelKey,value] of pairs){
    if(value===undefined)continue;
    nodes.push(h(doc,"dt",{text:ctx.t(labelKey)}));
    const dd=typeof value==="string"||value===null
      ?h(doc,"dd",{},h(doc,"span",{text:value===null||value===""?MISSING:value}))
      :h(doc,"dd",{},value);
    nodes.push(dd);
  }
  return h(doc,"dl",{class:"kv inspector-kv"},nodes);
}
function listOrNone(ctx,items,itemFn){
  const doc=ctx.doc,arr=Array.isArray(items)?items.filter(Boolean):[];
  if(!arr.length)return h(doc,"span",{class:"note",text:ctx.t("inspector.none")});
  return h(doc,"ul",{class:"inspector-list"},arr.slice(0,50).map(itemFn));
}

/** Kind'e göre gerçek alanları dürüstçe döşer; değer yoksa "—" (uydurma yok). */
function detailBody(ctx,ref,res){
  const doc=ctx.doc,e=res.entity;
  if(!e||res.state!=="VERIFIED")return stateNote(ctx,res.state&&res.state!=="VERIFIED"?res.state:"UNAVAILABLE");
  if(ref.kind==="project")return kv(ctx,[
    ["inspector.field.id",h(doc,"span",{class:"mono",text:e.projectId})],
    ["inspector.field.tenant",e.tenantId??null],
    ["inspector.field.environment",e.environmentId??null],
    ["inspector.field.repository",e.repositoryPath?h(doc,"span",{class:"mono",text:e.repositoryPath}):null],
    ["inspector.field.created",formatTime(e.createdAt,ctx.i18n.lang)]
  ]);
  if(ref.kind==="mission")return h(doc,"div",{class:"inspector-sections"},
    kv(ctx,[
      ["inspector.field.id",h(doc,"span",{class:"mono",text:e.missionId})],
      ["inspector.field.project",e.projectId?h(doc,"span",{class:"mono",text:e.projectId}):null],
      ["inspector.field.status",badge(ctx,statusLabel(ctx,e.status))],
      ["inspector.field.risk",badge(ctx,e.riskLevel??MISSING,"badge-risk")],
      ["inspector.field.created",formatTime(e.createdAt,ctx.i18n.lang)]
    ]),
    h(doc,"h3",{class:"inspector-sub",text:ctx.t("inspector.field.objective")}),
    h(doc,"p",{class:"note",text:e.objective??MISSING}),
    h(doc,"h3",{class:"inspector-sub",text:ctx.t("inspector.field.criteria")}),
    listOrNone(ctx,e.acceptanceCriteria,c=>h(doc,"li",{text:String(c)})),
    h(doc,"h3",{class:"inspector-sub",text:ctx.t("inspector.field.tasks")}),
    listOrNone(ctx,e.tasks,ti=>h(doc,"li",{},h(doc,"span",{text:ti.title??MISSING}),h(doc,"span",{class:"inspector-task-status"},badge(ctx,statusLabel(ctx,ti.status)))))
  );
  if(ref.kind==="run")return kv(ctx,[
    ["inspector.field.id",h(doc,"span",{class:"mono",text:e.runId})],
    ["inspector.field.mission",e.missionId?h(doc,"span",{class:"mono",text:e.missionId}):null],
    ["inspector.field.status",badge(ctx,statusLabel(ctx,e.status))],
    ["inspector.field.step",e.step&&e.step.name?e.step.name:null],
    ["inspector.field.role",e.role??null],
    ["inspector.field.reviewer",e.reviewer&&e.reviewer.identity?e.reviewer.identity:null],
    ["inspector.field.verdict",e.reviewer&&e.reviewer.verdict?badge(ctx,statusLabel(ctx,e.reviewer.verdict)):null],
    ["inspector.field.started",formatTime(e.startedAt,ctx.i18n.lang)]
  ]);
  // role
  return h(doc,"div",{class:"inspector-sections"},
    kv(ctx,[
      ["inspector.field.id",h(doc,"span",{class:"mono",text:e.roleId})],
      ["inspector.field.title",e.title??null],
      ["inspector.field.guild",e.guildId?h(doc,"span",{class:"mono",text:e.guildId}):null],
      ["inspector.field.cluster",e.clusterId?h(doc,"span",{class:"mono",text:e.clusterId}):null],
      ["inspector.field.lifecycle",e.lifecycle??null],
      ["inspector.field.priority",e.priority??null],
      ["inspector.field.runtime",badge(ctx,statusLabel(ctx,e.runtimeStatus))],
      ["inspector.field.proficiency",badge(ctx,statusLabel(ctx,e.proficiencyStatus))],
      ["inspector.field.scope",e.certifiedScope??null]
    ]),
    h(doc,"h3",{class:"inspector-sub",text:ctx.t("inspector.field.responsibilities")}),
    listOrNone(ctx,e.responsibilities,c=>h(doc,"li",{text:String(c)}))
  );
}

/**
 * //TR: Çekmece denetleyicisi. Tek bir modal <dialog> kurar (ilk açılışta body'ye eklenir, sonraki açılışlarda yeniden kullanılır). open(ref,invoker) ayrıntıyı gerçek sunucudan okuyup boyar; başlık düğümü kararlı kalır (yeniden boyamada odak kaybolmaz). close() odağı çağıran denetime geri verir. Her hata yutulur (uygulama engellenmez).
 */
export function createInspector(ctx){
  const doc=ctx.doc;
  let invoker=null,token=0,isOpen=false;
  const dialog=h(doc,"dialog",{class:"dialog drawer",id:"inspectorDrawer",role:"dialog","aria-modal":"true","aria-labelledby":"inspectorTitle","aria-describedby":"inspectorSub"});
  const titleEl=h(doc,"h2",{class:"drawer-title",id:"inspectorTitle",tabindex:"-1"});
  const subEl=h(doc,"p",{class:"note drawer-sub mono",id:"inspectorSub"});
  const bodyEl=h(doc,"div",{class:"drawer-body",id:"inspectorBody"});
  const closeBtn=h(doc,"button",{type:"button",class:"btn drawer-close",id:"inspectorClose","aria-label":ctx.t("inspector.close"),text:"✕",on:{click:()=>close()}});
  dialog.append(
    h(doc,"div",{class:"drawer-head"},h(doc,"div",{class:"drawer-headmain"},titleEl,subEl),closeBtn),
    bodyEl
  );
  dialog.addEventListener("cancel",e=>{if(e&&typeof e.preventDefault==="function")e.preventDefault();close()});
  dialog.addEventListener("keydown",e=>{if(e&&e.key==="Escape"){if(typeof e.preventDefault==="function")e.preventDefault();close()}});

  function ensureMounted(){if(!dialog.parentNode&&doc.body&&typeof doc.body.append==="function")doc.body.append(dialog)}
  // //TR: Başlık = varlığın GERÇEK adı (mission başlığı/proje adı/rol başlığı) varsa; yoksa kind etiketi. Alt satır = kind etiketi · kimlik. Hiçbir ad uydurulmaz.
  function setHead(ref,entity){
    const kindLabel=ctx.t(`inspector.kind.${ref.kind}`),name=entity?labelForEntity(ref,entity):null;
    titleEl.textContent=name&&name!==ref.id?name:kindLabel;
    subEl.textContent=`${kindLabel} · ${ref.id}`;
  }
  function paint(ref,res){setHead(ref,res&&res.state==="VERIFIED"?res.entity:null);bodyEl.replaceChildren(detailBody(ctx,ref,res))}

  function close(){
    if(!isOpen)return;isOpen=false;token++;
    try{if(typeof dialog.close==="function"&&dialog.open)dialog.close();else dialog.removeAttribute("open")}catch{/* yoksay */}
    const back=invoker;invoker=null;
    if(back&&back.isConnected!==false&&back.disabled!==true&&typeof back.focus==="function"){try{back.focus()}catch{/* yoksay */}}
  }
  async function load(ref,myToken){
    let res;try{res=await fetchInspectorDetail(ctx,ref)}catch{res={state:"ERROR",entity:null}}
    if(myToken!==token||!isOpen)return;
    paint(ref,res);
  }
  function open(ref,opener){
    if(!isInspectableRef(ref))return false;
    ensureMounted();
    invoker=opener&&opener!==doc.body?opener:null;
    isOpen=true;const myToken=++token;
    setHead(ref,null);
    bodyEl.replaceChildren(h(doc,"p",{class:"note",role:"status",text:ctx.t("inspector.loading")}));
    try{if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();else dialog.setAttribute("open","")}catch{try{dialog.setAttribute("open","")}catch{/* yoksay */}}
    if(typeof titleEl.focus==="function"){try{titleEl.focus()}catch{/* yoksay */}}
    void load(ref,myToken);
    return true;
  }
  return {dialog,open,close,get isOpen(){return isOpen}};
}
