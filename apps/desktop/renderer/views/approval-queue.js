// //TR: Bu görünüm parçası Gelen Kutusu'nun en üstündeki tek "Onay kuyruğu"dur (Final Approval Center): Founder kararı bekleyen her öğe türüne göre gruplanır; her öğe konuyu, risk düzeyini, onaylamanın ne yaptığını ve ilgili ekrana derin bağlantıyı gösterir. Eylem YALNIZ mevcut, izinli rota ile ve açık onay penceresinin arkasındadır: Preflight mission'ı yetkilendir (AUTHORIZED; performTransition kendi onayını ister) ya da engelle (BLOCKED; gerekçe zorunlu, burada ayrıca onay istenir). Teslim ve Founder dikkati kararları aşağıdaki mevcut karar kartlarındadır (oraya odak taşınır). Pre-dev taslağı kanıt girdisi ister ve Proje Yolculuğu'nda verilir; koşu kararının onay/ret rotası yoktur: ikisi de burada salt okunurdur ve nedeni yazılır. API verisi yalnız h()/textContent ile yazılır.
import {h,panel,badge,statusLabel,stateNote} from "../components.js";
import {drafts,selection,field,statusBlock,setStatus,focusResult} from "../forms.js";
import {performTransition,actionStatusId} from "../work-actions.js";
import {buildTransitionRequest} from "../work-core.js";
import {AQ_MODE,AQ_LINK} from "../approval-queue-core.js";

// Anahtarlar düz metin olarak yazılır (yerelleştirme taraması için).
const GROUP_KEY=Object.freeze({AUTHORIZATION:"aq.group.AUTHORIZATION",DELIVERY:"aq.group.DELIVERY",FOUNDER_ATTENTION:"aq.group.FOUNDER_ATTENTION",PREDEV_DRAFT:"aq.group.PREDEV_DRAFT",RUN_DECISION:"aq.group.RUN_DECISION"});
const EFFECT_KEY=Object.freeze({AUTHORIZATION:"aq.effect.AUTHORIZATION",DELIVERY:"aq.effect.DELIVERY",FOUNDER_ATTENTION:"aq.effect.FOUNDER_ATTENTION",PREDEV_DRAFT:"aq.effect.PREDEV_DRAFT",RUN_DECISION:"aq.effect.RUN_DECISION"});
const READONLY_KEY=Object.freeze({PREDEV_DRAFT:"aq.readonly.PREDEV_DRAFT",RUN_DECISION:"aq.readonly.RUN_DECISION"});
const LINK_KEY=Object.freeze({work:"aq.link.work",journey:"aq.link.journey"});

/** //TR: Engelleme (BLOCKED) bir ret kararıdır: gerekçe önce doğrulanır (eksikse onay penceresi açılmaz, hata gösterilir), sonra açık onay istenir; pencere açıkken kilit tutulur (ikinci basış ikinci pencere/istek açmaz). Vazgeçilirse ya da onay işlevi yoksa istek gitmez. Yetkilendirme (AUTHORIZED) yüksek riskli geçiştir ve performTransition'ın kendi onay penceresinden geçer. */
export async function submitQueueTransition(ctx,item,to){
  const sid=actionStatusId(item.missionId),reason=drafts.reasons[item.missionId]??"";
  if(drafts.busy[sid]===true)return {ok:false,busy:true};
  const args={missionId:item.missionId,title:item.title,from:item.status,to,reason,statusId:sid};
  if(to!=="BLOCKED")return performTransition(ctx,args);
  const probe=buildTransitionRequest({missionId:item.missionId,from:item.status,to,reason,confirmed:true});
  if(!probe.ok)return performTransition(ctx,args); // doğrulama hatasını tek yerden gösterir; istek gönderilmez
  drafts.busy[sid]=true;let yes=false;
  try{yes=typeof ctx.confirm==="function"?(await ctx.confirm({title:ctx.t("aq.confirm.block.title"),body:ctx.t("aq.confirm.block.body"),action:ctx.t("aq.confirm.block.action",{from:statusLabel(ctx,item.status)}),target:`${item.title} (${item.missionId})`,confirmLabel:ctx.t("aq.confirm.block.ok")}))===true:false}
  finally{drafts.busy[sid]=false}
  if(!yes){setStatus(sid,{ok:false,key:"confirm.cancelled",vars:{},errors:null});await ctx.rerender();focusResult(ctx,sid,[`id:aq-BLOCKED-${item.missionId}`]);return {ok:false,cancelled:true}}
  return performTransition(ctx,args);
}
function linkButton(ctx,item){
  const route=AQ_LINK[item.kind];
  return h(ctx.doc,"button",{type:"button",class:"btn",id:`aq-open-${item.kind}-${item.missionId}`,dataset:{focusKey:`aq-open-${item.kind}-${item.missionId}`,aqLink:route},
    on:{click:()=>{selection.missionId=item.missionId;ctx.navigate(route)}},text:ctx.t(LINK_KEY[route])});
}
function itemCard(ctx,item){
  const doc=ctx.doc,mode=AQ_MODE[item.kind],sid=actionStatusId(item.missionId),busy=drafts.busy[sid]===true;
  const facts=[h(doc,"dt",{text:ctx.t("aq.f.subject")}),h(doc,"dd",{},h(doc,"span",{text:item.title})," ",h(doc,"span",{class:"mono",text:item.missionId})),
    h(doc,"dt",{text:ctx.t("aq.f.risk")}),h(doc,"dd",{dataset:{aqRisk:item.riskLevel??""}},item.riskLevel?badge(ctx,item.riskLevel,"badge-risk"):h(doc,"span",{class:"task-unknown",text:ctx.t("aq.unknown")})),
    ...(item.runId?[h(doc,"dt",{text:ctx.t("aq.f.run")}),h(doc,"dd",{class:"mono",text:item.runId})]:[]),
    ...(item.artifactId?[h(doc,"dt",{text:ctx.t("aq.f.artifact")}),h(doc,"dd",{},h(doc,"span",{text:ctx.t(`journey.kind.${item.phaseKind}`)})," ",h(doc,"span",{class:"mono",text:item.artifactId}))]:[]),
    h(doc,"dt",{text:ctx.t("aq.f.effect")}),h(doc,"dd",{dataset:{aqEffect:item.kind},text:ctx.t(EFFECT_KEY[item.kind])})];
  let action=null;
  if(mode==="TRANSITION"&&item.actions.length){
    action=h(doc,"div",{},
      field(ctx,{id:`aq-reason-${item.missionId}`,labelKey:"work.transition.reason",value:drafts.reasons[item.missionId]??"",onInput:v=>{drafts.reasons[item.missionId]=v},hintKey:"aq.reasonHint"}),
      h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("aq.actions",{title:item.title})},item.actions.map(a=>h(doc,"button",{type:"button",class:`btn${a.type==="approve"?" btn-primary":""}`,id:`aq-${a.to}-${item.missionId}`,
        dataset:{focusKey:`aq-${a.to}-${item.missionId}`,aqAction:a.type,to:a.to},disabled:busy,on:{click:()=>{if(drafts.busy[sid]!==true)submitQueueTransition(ctx,item,a.to)}},
        text:ctx.t(a.type==="approve"?"aq.action.authorize":"aq.action.block")}))),
      statusBlock(ctx,sid));
  }else if(mode==="DECIDE"){
    action=h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn btn-primary",id:`aq-decide-${item.missionId}`,dataset:{focusKey:`aq-decide-${item.missionId}`,aqDecide:item.missionId},
      on:{click:()=>{const n=doc.getElementById?.(`ib-open-${item.missionId}`);if(n&&typeof n.focus==="function"){if(typeof n.scrollIntoView==="function")n.scrollIntoView({block:"nearest"});n.focus()}}},text:ctx.t("aq.action.decideBelow")}));
  }else{
    action=h(doc,"p",{class:"note",role:"note",dataset:{aqReadonly:item.kind},text:ctx.t(READONLY_KEY[item.kind]??"aq.readonly.generic")});
  }
  return h(doc,"li",{class:"card aq-item",dataset:{aqItem:item.missionId,aqKind:item.kind,aqMode:mode}},
    h(doc,"h4",{text:item.title}),h(doc,"dl",{class:"kv"},facts),action,h(doc,"div",{class:"btn-row"},linkButton(ctx,item)));
}
function unknownNotes(ctx,q){
  const doc=ctx.doc,u=q.unknown,out=[];
  const note=(k,key,vars)=>out.push(h(doc,"p",{class:"note note-unknown",role:"status",dataset:{aqUnknown:k},text:ctx.t(key,vars)}));
  if(u.runs)note("runs","aq.unknown.runs");
  if(u.attention)note("attention","aq.unknown.attention");
  if(u.predevUnread>0)note("predev","aq.unknown.predev",{n:u.predevUnread});
  if(u.predevSkipped>0)note("predevSkipped","aq.unknown.predevSkipped",{n:u.predevSkipped});
  return out;
}
/** q: buildApprovalQueue sonucu. */
export function approvalQueuePanel(ctx,q){
  const doc=ctx.doc;
  let body;
  if(q.state!=="READY")body=stateNote(ctx,q.state);
  else{
    const counts=h(doc,"ul",{class:"inline-list",dataset:{aqCounts:"1"}},q.groups.map(g=>h(doc,"li",{dataset:{aqCount:g.kind,n:String(g.items.length)}},h(doc,"strong",{text:String(g.items.length)})," ",ctx.t(GROUP_KEY[g.kind]))));
    const groups=q.groups.filter(g=>g.items.length).map(g=>h(doc,"section",{class:"aq-group",id:`aq-group-${g.kind}`,"aria-label":ctx.t(GROUP_KEY[g.kind]),dataset:{aqGroup:g.kind}},
      h(doc,"h3",{text:`${ctx.t(GROUP_KEY[g.kind])} (${g.items.length})`}),h(doc,"ul",{class:"cards"},g.items.map(it=>itemCard(ctx,it)))));
    body=h(doc,"div",{},
      h(doc,"p",{class:"panel-meta",role:"status",dataset:{aqTotal:String(q.total)},text:q.total?ctx.t("aq.total",{n:q.total}):ctx.t("aq.empty")}),
      counts,...unknownNotes(ctx,q),...groups);
  }
  return panel(ctx,{titleKey:"aq.title",id:"inbox-queue",className:"inbox-section"},h(doc,"p",{class:"note",text:ctx.t("aq.lead")}),body);
}
