// //TR: Bu görünüm İlk Çalıştırma Kurulum Doğrulaması'dır (FA-V2-PRODUCT, UI-248): YALNIZ üç salt-okunur ve zaten izinli GET'ten okunur — GET /v1/install (kurulum raporu: bileşenler ve Phase-0 bağı), GET /v1/phase0 (Phase-0 kabul raporu: kontroller) ve GET /v1/system/executors (AI yürütücüleri, sandbox, Claude profilleri; mevcut executors() erişimcisi). Bu ekran ilk açılış sihirbazı (`firstrun`) DEĞİLDİR. Doğrulama kararı sunucudan AYNEN gösterilir (VERIFIED, PENDING, REJECTED); hiçbir durum yükseltilmez, hiçbir kaynaktan genel bir "kurulum tamam" kararı türetilmez. VERIFIED/ACTIVE rozeti yalnız gerçek sunucu sinyali söylüyorsa vardır. Okunamayan kaynak (ya da doğrulanmamış raporun bileşenleri) için sayı 0 değil "—" ve dürüst durum rozeti görünür. Dosya yolu, dosya özeti ve imza değeri gösterilmez (eşleyici zaten taşımaz). Bu görünüm SALT-OKUNURDUR: kurulum/etkinleştirme/yazma eylemi yoktur; tek eylem mevcut Ayarlar ekranına gezinmedir. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile,stateNote} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {INSTALL_SOURCES,INSTALL_SOURCE_PATHS,buildInstall} from "../install-core.js";

/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
/** Sunucu doğrulama kararı -> rozet türü. VERIFIED rozeti yalnız sunucu VERIFIED derse; etiket her zaman ham karardır (AYNEN). */
const VERIFY_PILL=Object.freeze({VERIFIED:"VERIFIED",PENDING:"WAITING",REJECTED:"BLOCKED"});
/** Yürütücü durumu -> rozet türü; etiket ham durumdur. Bağlı/hazır görünümü yalnız sunucunun READY/AVAILABLE sinyaliyle; bilinmeyen durum NEUTRAL. */
const EXEC_PILL=Object.freeze({READY:"ACTIVE",NOT_CONFIGURED:"NOT_CONNECTED",CLI_NOT_FOUND:"UNAVAILABLE",PROVENANCE_MISSING:"UNAVAILABLE",TEST_ONLY:"NOT_VERIFIED"});
const SANDBOX_PILL=Object.freeze({AVAILABLE:"ACTIVE",UNAVAILABLE:"UNAVAILABLE"});
const verifyPill=(ctx,v)=>statePill(ctx,VERIFY_PILL[v],{label:v});
const rawPill=(ctx,map,s)=>statePill(ctx,s===null||s===undefined?"NEUTRAL":map[s]??"NEUTRAL",s?{label:s}:{});

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("install.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.install.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.install.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("install.readonly")}),
    // Dürüstlük uyarısı: doğrulama sunucudan aynen, okunamayan kaynak doğrulanmış/bağlı değil, okunamayan sayı 0 değil.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("install.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`install-state state-${state.toLowerCase()}`,role:"status",dataset:{installState:state,source}},
    h(doc,"p",{class:"install-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`install.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`install.hint.${state}`,{source:`GET ${INSTALL_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}
/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). "Okuma başarılı" kurulum doğrulaması DEĞİLDİR. */
function sourcesList(ctx,a){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources install-sources","aria-label":ctx.t("install.sources.aria")},INSTALL_SOURCES.map(k=>{
    const st=a.sources[k].state,okay=st==="VERIFIED",kind=okay?"VERIFIED":failKind(st);
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`install.src.${k}`)}),
      statePill(ctx,kind,{label:okay?ctx.t("install.src.ok"):undefined}));
  }));
}
function sourcesPanel(ctx,res,a){
  const doc=ctx.doc;
  const failures=INSTALL_SOURCES.filter(k=>a.sources[k].state!=="VERIFIED").map(k=>stateBlock(ctx,{state:a.sources[k].state,message:res[k]?.message},k));
  return panel(ctx,{titleKey:"install.sources.title",id:"install-sources",className:"install-section"},
    h(doc,"p",{class:"note",text:ctx.t("install.sources.lead")}),
    sourcesList(ctx,a),
    failures,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{installPartial:a.unreadable.join(",")},text:ctx.t("install.partial",{sources:a.unreadable.map(k=>ctx.t(`install.srcShort.${k}`)).join(", ")})}):null);
}

// ---- (A) Doğrulama kararları ----
const timeEl=(ctx,iso)=>h(ctx.doc,"time",{datetime:iso,text:formatDateTime(iso,ctx.i18n.lang)});
const fact=(ctx,key,body)=>h(ctx.doc,"div",{class:"fact install-fact",dataset:{fact:key}},h(ctx.doc,"span",{class:"fact-label",text:ctx.t(`install.field.${key}`)}),h(ctx.doc,"p",{},body));
function errorList(ctx,errors){
  const doc=ctx.doc;
  return errors.length?h(doc,"div",{class:"fact install-fact",dataset:{fact:"errors",n:String(errors.length)}},
    h(doc,"span",{class:"fact-label",text:ctx.t("install.errors.title",{n:errors.length})}),
    h(doc,"ul",{class:"install-errors"},errors.map(e=>h(doc,"li",{class:"mono",dataset:{errorCode:e},text:e})))):null;
}
/** Bir raporun karar kartı. data okunamadıysa (null) tüm değerler "—" ve dürüst durum rozeti; doğrulama uydurulmaz. */
function verdictCard(ctx,kind,data,srcState,finalField){
  const doc=ctx.doc,t=ctx.t;
  if(data===null){
    const st=failState(srcState);
    return h(doc,"li",{class:"card install-card",dataset:{card:kind,verification:"UNREAD",sourceState:st}},
      h(doc,"h3",{text:t(`install.card.${kind}`)}),
      h(doc,"p",{},statePill(ctx,failKind(st),{label:t(`install.state.${st}`)})," ",h(doc,"span",{class:"mono",text:MISSING})),
      h(doc,"p",{class:"note",text:t("install.card.withheld",{source:t(`install.srcShort.${kind}`)})}));
  }
  const v=data.verification;
  return h(doc,"li",{class:"card install-card",dataset:{card:kind,verification:v,final:data[finalField]}},
    h(doc,"h3",{text:t(`install.card.${kind}`)}),
    h(doc,"p",{class:"install-verdict"},verifyPill(ctx,v)),
    h(doc,"p",{class:"note",dataset:{note:`verdict-${v}`},text:t(`install.verdict.${v}`)}),
    h(doc,"div",{class:"facts"},
      fact(ctx,finalField==="final"?"final":"phase0Final",h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:data[finalField]})),
      v==="VERIFIED"?fact(ctx,"installId",mono(doc,data.installId)):null,
      v==="VERIFIED"?fact(ctx,"generatedAt",data.generatedAt?timeEl(ctx,data.generatedAt):MISSING):null,
      v==="VERIFIED"?fact(ctx,"schema",mono(doc,data.schemaVersion)):null,
      v==="VERIFIED"&&data.sourceCommit?fact(ctx,"sourceCommit",mono(doc,data.sourceCommit)):null,
      kind==="phase0"&&v==="VERIFIED"?fact(ctx,"signed",t(data.signed?"install.signed.yes":"install.signed.no")):null,
      errorList(ctx,data.errors)));
}
function crossCheck(ctx,a){
  const doc=ctx.doc,r=a.reconcile;
  if(r===null)return null;
  return r.agree
    ?h(doc,"p",{class:"note",dataset:{reconcile:"agree"},text:ctx.t("install.reconcile.agree",{final:r.phase0})})
    :h(doc,"p",{class:"note",role:"status",dataset:{reconcile:"mismatch",install:r.install,phase0:r.phase0},text:ctx.t("install.reconcile.mismatch",{install:r.install,phase0:r.phase0})});
}
function verdictPanel(ctx,a){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"install.verify.title",id:"install-verification",className:"install-section"},
    h(doc,"p",{class:"note",text:ctx.t("install.verify.lead")}),
    h(doc,"ul",{class:"cards install-cards","aria-label":ctx.t("install.verify.aria")},
      verdictCard(ctx,"install",a.install,a.sources.install.state,"phase0Final"),
      verdictCard(ctx,"phase0",a.phase0,a.sources.phase0.state,"final")),
    crossCheck(ctx,a));
}

// ---- (B) Bileşenler ve kontroller ----
/** Doğrulanmamış (PENDING/REJECTED) ya da okunamayan raporun bileşen/kontrol sayısı 0 değil "—"dir; gerekçe metinle söylenir. */
function withheldKey(data,base){return data===null?`${base}.withheld.UNREAD`:`${base}.withheld.${data.verification}`}
function componentsPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t,ins=a.install,live=ins!==null&&ins.verification==="VERIFIED";
  const src=`GET ${INSTALL_SOURCE_PATHS.install}`;
  const tile=(id,iconName,value)=>kpiTile(ctx,{id:`install-${id}`,iconName,labelKey:`install.kpi.${id}`,block:{state:live?"VERIFIED":"UNAVAILABLE",value:live?value:null,loading:false,source:src,asOf:live?ins.generatedAt:null},qualifier:t(`install.kpi.q.${id}`),
    pillKind:live?(id==="present"&&a.counts.present<a.counts.total?"ATTENTION":"VERIFIED"):ins===null?undefined:VERIFY_PILL[ins.verification]});
  let body;
  if(!live)body=stateNote(ctx,"UNAVAILABLE",withheldKey(ins,"install.components"));
  else if(!ins.components.length)body=h(doc,"p",{class:"note",role:"status",dataset:{componentsEmpty:"1"},text:t("install.components.empty")});
  else body=h(doc,"ul",{class:"cards install-components","aria-label":t("install.components.aria")},ins.components.map(c=>
    h(doc,"li",{class:"card",dataset:{component:c.id,present:c.present?"1":"0",status:c.status}},
      h(doc,"h4",{class:"mono",text:c.id}),
      h(doc,"p",{},statePill(ctx,c.present?"NEUTRAL":"NOT_EXECUTED",{label:t(c.present?"install.component.present":"install.component.absent")})," ",h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:c.status})))));
  return panel(ctx,{titleKey:"install.components.title",id:"install-components",className:"install-section"},
    h(doc,"p",{class:"note",text:t("install.components.lead")}),
    h(doc,"div",{class:"kpi-row install-kpis",role:"group","aria-label":t("install.kpi.group")},tile("total","tasks",live?a.counts.total:null),tile("present","folder",live?a.counts.present:null)),
    body);
}
function checksPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t,p=a.phase0,live=p!==null&&p.verification==="VERIFIED";
  let body;
  if(!live)body=stateNote(ctx,"UNAVAILABLE",withheldKey(p,"install.checks"));
  else if(!p.checks.length)body=h(doc,"p",{class:"note",role:"status",dataset:{checksEmpty:"1"},text:t("install.checks.empty")});
  else body=[h(doc,"ul",{class:"cards install-checks","aria-label":t("install.checks.aria")},p.checks.map(c=>
      h(doc,"li",{class:"card",dataset:{check:c.name,status:c.status}},h(doc,"h4",{class:"mono",text:c.name}),h(doc,"p",{},h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:c.status}))))),
    p.inputs?h(doc,"p",{class:"note",dataset:{field:"inputs",total:String(p.inputs.total),present:String(p.inputs.present)},text:t("install.checks.inputs",{present:p.inputs.present,total:p.inputs.total})}):null];
  return panel(ctx,{titleKey:"install.checks.title",id:"install-checks",className:"install-section"},h(doc,"p",{class:"note",text:t("install.checks.lead")}),body);
}

// ---- (C) AI yürütücüleri ----
function executorsPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t,ex=a.executors;
  let body;
  if(ex===null)body=stateNote(ctx,failState(a.sources.executors.state),"install.exec.withheld");
  else{
    const list=ex.items.length
      ?h(doc,"ul",{class:"cards exec-list install-executors","aria-label":t("install.exec.aria")},ex.items.map(e=>{
        const nameKey=`exec.name.${e.id}`,name=t(nameKey)===nameKey?e.id:t(nameKey);
        return h(doc,"li",{class:"card",dataset:{executor:e.id,state:e.state??"UNKNOWN"}},
          h(doc,"h4",{text:name}),
          h(doc,"p",{},rawPill(ctx,EXEC_PILL,e.state)," ",e.state===null?h(doc,"span",{class:"mono",text:MISSING}):null),
          e.testOnly?h(doc,"p",{class:"note",text:t("exec.testOnlyNote")}):null);
      }))
      :h(doc,"p",{class:"note",role:"status",dataset:{executorsEmpty:"1"},text:t("install.exec.none")});
    const sb=ex.sandbox;
    const sandbox=h(doc,"div",{class:"fact install-fact",dataset:{fact:"sandbox",sandbox:sb?sb.state:"unknown"}},
      h(doc,"span",{class:"fact-label",text:t("install.exec.sandbox")}),
      h(doc,"p",{},sb===null?[statePill(ctx,"NEUTRAL"),h(doc,"span",{text:" "+t("install.exec.sandbox.unknown")})]:[rawPill(ctx,SANDBOX_PILL,sb.state),sb.reason?h(doc,"span",{class:"mono",dataset:{field:"reason"},text:" "+sb.reason}):null]));
    const profiles=ex.profiles.length
      ?h(doc,"ul",{class:"cards exec-profiles install-profiles","aria-label":t("install.exec.profiles")},ex.profiles.map(p=>
        h(doc,"li",{class:"card",dataset:{profile:p.role,state:p.state??"UNKNOWN"}},h(doc,"h4",{text:t(`exec.profile.role.${p.role}`)}),h(doc,"p",{},rawPill(ctx,EXEC_PILL,p.state)))))
      :null;
    body=[list,sandbox,profiles];
  }
  return panel(ctx,{titleKey:"install.exec.title",id:"install-executors",className:"install-section"},h(doc,"p",{class:"note",text:t("install.exec.lead")}),body);
}

/** Tek eylem: mevcut Ayarlar ekranına gezinme (yazma/POST yok); yürütücüler orada yönetilir. */
function actionsPanel(ctx){
  const doc=ctx.doc,t=ctx.t;
  return h(doc,"div",{class:"btn-row install-actions",role:"group","aria-label":t("install.action.group")},
    h(doc,"p",{class:"note",dataset:{note:"actions"},text:t("install.action.hint")}),
    h(doc,"button",{type:"button",class:"btn",id:"install-open-settings","aria-label":t("install.action.settings.aria"),dataset:{focusKey:"install-open-settings",navigate:"settings"},on:{click:()=>ctx.navigate("settings")},text:t("install.action.settings")}));
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [install,phase0,executors]=await Promise.all([
    read(()=>api.installInstall(),{install:null}),
    read(()=>api.installPhase0(),{phase0:null}),
    read(()=>api.executors(),{items:null})
  ]);
  const res={install,phase0,executors};
  const a=buildInstall(res);
  return h(doc,"div",{class:"view view-install"},header(ctx),sourcesPanel(ctx,res,a),verdictPanel(ctx,a),componentsPanel(ctx,a),checksPanel(ctx,a),executorsPanel(ctx,a),actionsPanel(ctx));
}
