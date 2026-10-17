// //TR: Bu görünüm Güvence Komuta Merkezi ve Güvenlik Duruşu'dur (FA-V2-PRODUCT, UI-037+046): YALNIZ üç salt-okunur ve zaten izinli GET'ten okunur — GET /v1/work-runs (koşu başına QA testi ve güvenlik taraması kanıtı), GET /v1/reviews (bağımsız inceleme kararları, UI-049) ve GET /v1/cockpit (yalnız evidence bloğu: hash-doğrulanmış kanıt bütünlüğü). Dört sütun (QA kanıtı, güvenlik taraması, bağımsız inceleme, kanıt bütünlüğü) toplu olarak gösterilir ve genel duruş DÜRÜSTTÜR: ASSURED yalnız dört sütunun HEPSİ gerçekten sağlandığında görünür; QA NOT_EXECUTED, güvenlik PASSED değil, inceleme temiz-ve-bağımsız değil ya da kanıt doğrulanmamış/eksik/okunamıyorsa asla görünmez ve tam olarak neyin eksik olduğu adıyla listelenir. Bağımsız inceleme durumları (CLEAN/BLOCKED/NO_VERDICT/NOT_REVIEWED/INDEPENDENCE_UNVERIFIED) sunucudan aynen taşınır. HİÇBİR sayı, duruş veya geçiş UYDURULMAZ: bozuk yanıt tümden ERROR olarak gösterilir (kısmi/tahmini değer yok), okunamayan kaynağın sayıları 0 değil "—" olur ve ilgili sütun UNKNOWN'dır. Ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. Bu görünüm SALT-OKUNURDUR: onay/ret/teslim burada yapılmaz, yalnız mevcut ekranlara gezinme sunulur. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {POSTURE_SOURCES,POSTURE_SOURCE_PATHS,QA_STATES,SECURITY_STATES,REVIEW_STATES,MAX_POSTURE_ROWS,PILL_FOR_RUN_STATUS,UNKNOWN_DETAILS,buildPosture,shortSha} from "../posture-core.js";

/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const failState=state=>state==="OFFLINE"||state==="UNAVAILABLE"?state:"ERROR";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
const safeId=key=>String(key).replace(/[^A-Za-z0-9_-]/g,"_");
/** Sütun durumu -> rozet türü. Başarı rozeti (DONE) yalnız sütun gerçekten OK iken; eksik/doğrulanmamış asla başarı gibi görünmez. */
const PSTATUS_PILL=Object.freeze({OK:"DONE",FAIL:"BLOCKED",INCOMPLETE:"NOT_VERIFIED",NO_DATA:"EMPTY"});
const TIER_PILL=Object.freeze({ASSURED:"DONE",AT_RISK:"BLOCKED",UNVERIFIED:"NOT_VERIFIED"});
/** Koşu başına değer -> rozet türü (renk tek başına anlam taşımaz; her rozet metin taşır). Yürütülmemiş her şey NOT_EXECUTED, bayat kanıt STALE, kısmi/doğrulanamayan NOT_VERIFIED. */
const VALUE_PILL=Object.freeze({
  qa:Object.freeze({EXECUTED:"DONE",FAILED:"FAILED",BLOCKED:"BLOCKED",NOT_EXECUTED:"NOT_EXECUTED",UNVERIFIED:"NOT_VERIFIED"}),
  security:Object.freeze({PASSED:"DONE",PARTIAL:"NOT_VERIFIED",BLOCKED:"BLOCKED",STALE:"STALE",NOT_EXECUTED:"NOT_EXECUTED"}),
  review:Object.freeze({CLEAN:"DONE",BLOCKED:"BLOCKED",NO_VERDICT:"NOT_VERIFIED",NOT_REVIEWED:"NOT_EXECUTED",INDEPENDENCE_UNVERIFIED:"NOT_VERIFIED",STALE:"STALE",NOT_LISTED:"NOT_EXECUTED",UNCONFIRMED:"NOT_VERIFIED"})});
const COUNT_KEYS=Object.freeze({qa:QA_STATES,security:SECURITY_STATES,review:Object.freeze(["CLEAN","STALE","NOT_LISTED","UNCONFIRMED"]),integrity:Object.freeze(["verified","mismatch","missing","unverifiable"])});
const pillarKind=p=>p.status==="UNKNOWN"?failKind(p.detail):PSTATUS_PILL[p.status];
const pillarLabel=(ctx,p)=>p.status==="UNKNOWN"?ctx.t(`posture.state.${failState(p.detail)}`):ctx.t(`posture.pstatus.${p.status}`);
/** Eksik kanıt neden metni: okunamayan kaynak ortak anahtardan, diğerleri sütuna özgü anahtardan gelir. */
const reasonText=(ctx,pillar,code,n)=>UNKNOWN_DETAILS.includes(code)?ctx.t(`posture.reason.UNKNOWN.${code}`):ctx.t(`posture.reason.${pillar}.${code}`,{n:n??0});

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("posture.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.posture.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.posture.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("posture.readonly")}),
    // Dürüstlük uyarısı: duruş yalnız kayıtlı kanıttan türer, ürün doğrulaması değildir.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("posture.honesty")}));
}

/** Okuma hatası bloğu: ayrık durum rozeti + kaynak (GET yolu) ile dürüst açıklama. */
function stateBlock(ctx,res,source){
  const doc=ctx.doc,state=failState(res.state);
  return h(doc,"div",{class:`posture-state state-${state.toLowerCase()}`,role:"status",dataset:{postureState:state,source}},
    h(doc,"p",{class:"posture-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`posture.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`posture.hint.${state}`,{source:`GET ${POSTURE_SOURCE_PATHS[source]}`})}),
    res.message?h(doc,"p",{class:"note mono",text:res.message}):null);
}
/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourcesList(ctx,a){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources posture-sources","aria-label":ctx.t("posture.sources.aria")},POSTURE_SOURCES.map(k=>{
    const st=a.sources[k].state,ok=st==="VERIFIED",kind=ok?"VERIFIED":failKind(st);
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`posture.src.${k}`)}),
      statePill(ctx,kind,{label:ok?ctx.t("posture.src.ok"):undefined}));
  }));
}

// ---- (A) Özet: kaynaklar, genel duruş, eksikler, temel sayılar ----
function overallBlock(ctx,a){
  const doc=ctx.doc,kind=a.tier==="UNKNOWN"?failKind(a.unknownState):TIER_PILL[a.tier];
  return h(doc,"p",{class:"posture-overall panel-meta",dataset:{overall:a.tier}},
    statePill(ctx,kind,{label:ctx.t(`posture.tier.${a.tier}`)}),
    h(doc,"span",{class:"note",text:ctx.t(`posture.tierDesc.${a.tier}`)}));
}
function missingList(ctx,a){
  const doc=ctx.doc;
  if(!a.missing.length)return h(doc,"p",{class:"note",dataset:{missing:"0"},text:ctx.t("posture.missing.none")});
  return h(doc,"ul",{class:"posture-missing","aria-labelledby":"posture-missing-t",dataset:{missing:String(a.missing.length)}},a.missing.map(m=>
    h(doc,"li",{dataset:{missingPillar:m.pillar,missingStatus:m.status,reason:m.code,missingN:m.n===null?"":String(m.n)},text:ctx.t("posture.missing.item",{pillar:ctx.t(`posture.pillar.${m.pillar}`),reason:reasonText(ctx,m.pillar,m.code,m.n)})})));
}
function kpiRow(ctx,a){
  const doc=ctx.doc;
  // Her sayı yalnız KENDİ kaynağı okunduysa gösterilir; aksi halde değer null ("—") ve rozet dürüst durumdur (asla 0).
  const tile=(id,iconName,block,extra={})=>kpiTile(ctx,{id:`posture-${id}`,iconName,labelKey:`posture.kpi.${id}`,block,qualifier:ctx.t(`posture.kpi.q.${id}`),...extra});
  const blockOf=(source,state,value)=>({state,value:state==="VERIFIED"||state==="STALE"?value:null,loading:false,source:`GET ${POSTURE_SOURCE_PATHS[source]}`,asOf:null});
  const pill=p=>p.status==="UNKNOWN"?{}:{pillKind:PSTATUS_PILL[p.status],risk:p.status==="FAIL"};
  const by=a.byPillar,src=a.sources;
  const stateFor=(p,source)=>p.status==="UNKNOWN"?(src[source].state==="VERIFIED"?failState(p.detail):src[source].state):"VERIFIED";
  return h(doc,"div",{class:"kpi-row posture-kpis",role:"group","aria-label":ctx.t("posture.kpi.group")},
    tile("total","tasks",blockOf("workRuns",src.workRuns.state,a.runs)),
    tile("qa","check",blockOf("workRuns",stateFor(by.qa,"workRuns"),by.qa.good),pill(by.qa)),
    tile("security","shield",blockOf("workRuns",stateFor(by.security,"workRuns"),by.security.good),pill(by.security)),
    tile("review","users",blockOf("reviews",stateFor(by.review,"reviews"),by.review.good),pill(by.review)),
    tile("integrity","evidence",blockOf("evidence",by.integrity.status==="UNKNOWN"?stateFor(by.integrity,"evidence"):by.integrity.blockState,by.integrity.good),pill(by.integrity)));
}
function actions(ctx){
  const doc=ctx.doc;
  const btn=(route,key)=>h(doc,"button",{type:"button",class:"btn",id:`ps-open-${route}`,dataset:{focusKey:`ps-open-${route}`,navigate:route},on:{click:()=>ctx.navigate(route)},text:ctx.t(key)});
  return h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("posture.actions.aria")},
    btn("assurance","posture.action.assurance"),btn("readiness","posture.action.readiness"),btn("work","posture.action.work"));
}
function summaryPanel(ctx,res,a){
  const doc=ctx.doc;
  // Durum, eşleyici çıktısının KULLANILABİLİRLİĞİNE göre (a.sources) belirlenir: VERIFIED ama gövdesi eksik bir okuma ERROR gösterilir.
  const failures=POSTURE_SOURCES.filter(k=>a.sources[k].state!=="VERIFIED").map(k=>stateBlock(ctx,{state:a.sources[k].state,message:res[k]?.message},k));
  return panel(ctx,{titleKey:"posture.summary.title",id:"posture-summary",className:"posture-section"},
    h(doc,"p",{class:"note",text:ctx.t("posture.summary.lead")}),
    h(doc,"h3",{class:"posture-sub",text:ctx.t("posture.sources.title")}),
    sourcesList(ctx,a),
    failures,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{posturePartial:a.unreadable.join(",")},text:ctx.t("posture.partial",{sources:a.unreadable.map(k=>ctx.t(`posture.srcShort.${k}`)).join(", ")})}):null,
    h(doc,"h3",{class:"posture-sub",text:ctx.t("posture.overall.title")}),
    overallBlock(ctx,a),
    h(doc,"p",{class:"note",dataset:{note:"not-product-verification"},text:ctx.t("posture.notProduct")}),
    h(doc,"h3",{class:"posture-sub",id:"posture-missing-t",text:ctx.t("posture.missing.title")}),
    missingList(ctx,a),
    h(doc,"h3",{class:"posture-sub",text:ctx.t("posture.kpi.title")}),
    kpiRow(ctx,a),
    h(doc,"p",{class:"note",dataset:{note:"actions"},text:ctx.t("posture.action.hint")}),
    actions(ctx));
}

// ---- (B) Sütun ayrıntıları ----
function countsList(ctx,p,keys,valueKey){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"posture-counts","aria-label":ctx.t(`posture.counts.aria.${p.id}`)},keys.map(k=>
    h(doc,"li",{dataset:{count:k,n:String(p.counts[k])},text:`${ctx.t(`posture.val.${valueKey}.${k}`)}: ${p.counts[k]}`})));
}
function pillarExtras(ctx,a,p){
  const doc=ctx.doc,out=[];
  if(p.id==="security"){
    const l=a.latestSecurity;
    out.push(h(doc,"p",{class:"note",dataset:{field:"latestSecurity",latest:l?l.status:"none"}},l?[ctx.t("posture.security.latest")," ",h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:l.status})," · ",mono(doc,l.runId)]:ctx.t("posture.security.latestNone")));
  }
  if(p.id==="review"){
    // Sunucunun beş durumu AYNEN (ham kod + sayı); yanında güncel head ile karşılaştırılmış türetilmiş durumlar ayrı listede.
    out.push(h(doc,"p",{class:"note",text:ctx.t("posture.review.serverTitle")}));
    out.push(h(doc,"ul",{class:"posture-counts posture-server","aria-label":ctx.t("posture.review.serverAria")},REVIEW_STATES.map(k=>
      h(doc,"li",{dataset:{serverCount:k,n:String(p.server[k])}},h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:k}),`: ${p.server[k]}`))));
    out.push(h(doc,"p",{class:"note",text:ctx.t("posture.review.checkedTitle")}));
    out.push(countsList(ctx,p,COUNT_KEYS.review,"review"));
    if(p.unseen>0)out.push(h(doc,"p",{class:"note",role:"status",dataset:{note:"unseen",n:String(p.unseen)},text:ctx.t("posture.review.unseen",{n:p.unseen})}));
  }
  if(p.id==="integrity")out.push(h(doc,"p",{class:"note",dataset:{field:"integrityAsOf"},text:ctx.t("posture.integrity.asOf",{time:formatDateTime(p.asOf,ctx.i18n.lang),state:ctx.t(`posture.blockState.${p.blockState}`)})}));
  return out;
}
function pillarCard(ctx,a,p){
  const doc=ctx.doc,src=a.sources[p.source];
  let body;
  if(p.status==="UNKNOWN"){
    // Sayılar saklanır: okunamayan kaynağın sayısı 0 değildir.
    body=[h(doc,"p",{class:"note",role:"status",dataset:{withheld:"1",reason:p.detail},text:ctx.t("posture.withheld",{source:`GET ${POSTURE_SOURCE_PATHS[p.source]}`,reason:reasonText(ctx,p.id,p.detail,null)})})];
  }else{
    const keys=COUNT_KEYS[p.id];
    body=[h(doc,"p",{class:"note",dataset:{field:"basis"},text:ctx.t(`posture.basis.${p.source}`,{n:p.total})}),
      p.id==="review"?null:countsList(ctx,p,keys,p.id),
      ...pillarExtras(ctx,a,p)];
  }
  return h(doc,"li",{class:"card posture-pillar",dataset:{pillar:p.id,pillarStatus:p.status,sourceState:src.state}},
    h(doc,"h3",{text:ctx.t(`posture.pillar.${p.id}`)}),
    h(doc,"p",{class:"posture-pillar-head panel-meta"},statePill(ctx,pillarKind(p),{label:pillarLabel(ctx,p)})),
    h(doc,"p",{class:"note",text:ctx.t(`posture.pillarNote.${p.id}`)}),
    body);
}
function pillarsPanel(ctx,a){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"posture.pillars.title",id:"posture-pillars",className:"posture-section"},
    h(doc,"p",{class:"note",text:ctx.t("posture.pillars.lead")}),
    h(doc,"ul",{class:"cards posture-pillar-list","aria-label":ctx.t("posture.pillars.aria")},a.pillars.map(p=>pillarCard(ctx,a,p))));
}

// ---- (C) Koşu başına duruş ----
function valuePill(ctx,pillar,value){return statePill(ctx,VALUE_PILL[pillar][value],{label:ctx.t(`posture.val.${pillar}.${value}`)})}
function runFacts(ctx,row){
  const doc=ctx.doc,t=ctx.t,rows=[];
  const add=(key,label,attrs,...dd)=>rows.push([h(doc,"dt",{text:label}),h(doc,"dd",{dataset:{field:key,...attrs}},...dd)]);
  add("run",t("posture.field.run"),{},statePill(ctx,PILL_FOR_RUN_STATUS[row.status]??"NEUTRAL",{label:row.status})," ",mono(doc,row.step));
  add("mission",t("posture.field.mission"),{},mono(doc,row.missionId));
  add("updated",t("posture.field.updated"),{},h(doc,"time",{datetime:row.updatedAt,text:formatDateTime(row.updatedAt,ctx.i18n.lang)}));
  add("head",t("posture.field.head"),{},row.headSha?h(doc,"span",{class:"mono",title:row.headSha,text:shortSha(row.headSha)}):MISSING);
  add("qa",t("posture.pillar.qa"),{value:row.qa},valuePill(ctx,"qa",row.qa));
  add("security",t("posture.pillar.security"),{value:row.security},valuePill(ctx,"security",row.security));
  // İnceleme: sunucu durumu AYNEN (ham kod); okunamıyorsa kaynağın dürüst durumu (bilinmiyor), asla uydurma yok.
  if(row.review===null)add("review",t("posture.pillar.review"),{value:failState(row.reviewUnread)},statePill(ctx,failKind(row.reviewUnread),{label:t(`posture.state.${failState(row.reviewUnread)}`)})," ",h(doc,"span",{class:"note",text:t(`posture.reason.UNKNOWN.${failState(row.reviewUnread)}`)}));
  else add("review",t("posture.pillar.review"),{value:row.review},valuePill(ctx,"review",row.review),REVIEW_STATES.includes(row.review)?[" ",h(doc,"span",{class:"mono",dataset:{verbatim:"1"},text:row.review})]:null);
  return h(doc,"dl",{class:"posture-facts"},rows.flat());
}
function runCard(ctx,row){
  const doc=ctx.doc;
  return h(doc,"li",{class:"card posture-item",dataset:{postureItem:row.runId,runStatus:row.status,qa:row.qa,security:row.security,review:row.review===null?failState(row.reviewUnread):row.review}},
    h(doc,"h3",{text:row.runId}),
    runFacts(ctx,row));
}
function runsPanel(ctx,res,a){
  const doc=ctx.doc;
  let body;
  if(a.runs===null)body=h(doc,"p",{class:"note",role:"status",dataset:{postureEmpty:"unknown"},text:ctx.t("posture.runs.emptyAll")});
  else if(!a.rows.length)body=h(doc,"p",{class:"note",role:"status",dataset:{postureEmpty:"1"},text:ctx.t("posture.runs.empty")});
  else{
    const shown=a.rows.slice(0,MAX_POSTURE_ROWS);
    body=[shown.length<a.rows.length?h(doc,"p",{class:"note",dataset:{note:"truncated"},text:ctx.t("posture.runs.truncated",{shown:shown.length,total:a.rows.length})}):null,
      a.rows[0].review===null?h(doc,"p",{class:"note",role:"status",dataset:{note:"reviews-unknown"},text:ctx.t("posture.runs.reviewsUnknown")}):null,
      h(doc,"ol",{class:"cards posture-list","aria-label":ctx.t("posture.runs.aria"),dataset:{postureList:String(shown.length)}},shown.map(r=>runCard(ctx,r)))];
  }
  return panel(ctx,{titleKey:"posture.runs.title",id:"posture-runs",className:"posture-section"},
    h(doc,"p",{class:"note",text:ctx.t("posture.runs.lead")}),
    h(doc,"p",{class:"note",dataset:{note:"order"},text:ctx.t("posture.order.note")}),
    body);
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse diğerleri etkilenmez ve düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [workRuns,reviews,evidence]=await Promise.all([
    read(()=>api.commandCenterWorkRuns(),{runs:null}),
    read(()=>api.commandCenterReviews(),{reviews:null}),
    read(()=>api.commandCenterEvidence(),{evidence:null})
  ]);
  const res={workRuns,reviews,evidence};
  const a=buildPosture(res);
  return h(doc,"div",{class:"view view-posture"},header(ctx),summaryPanel(ctx,res,a),pillarsPanel(ctx,a),runsPanel(ctx,res,a));
}
