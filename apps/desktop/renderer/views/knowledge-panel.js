// //TR: Bu görünüm parçası Project Studio > Genel Bakış'taki "Proje bilgisi" panelidir (UI-160, Lane B GET /v1/projects/:id/knowledge): Proje Belleği (karar/bilgi/kaynak/revizyon/not sayıları AYRI, güncel başlar) ve kanıt dizini özeti. Salt okunur; sayılar sunucunun bildirdiği gibidir. TAMPERED bellek için sayı/baş GÖSTERİLMEZ, TORN_TAIL için doğrulanmış önek olduğu söylenir, kanıt YALNIZ örneklenmiş bir sayımdır (en yeni misyonlar, kesilmiş olabilir) ve bağlı değilse/sorgu başarısızsa 0 uydurulmaz. Okunamayan kaynak (404, izin listesi yok, bozuk yanıt) sayı yerine durum notu gösterir.
import {h,panel,stateNote,emptyNote,badge} from "../components.js";
import {formatCount,MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {MEMORY_KINDS,EVIDENCE_KINDS,VERIFICATION_STATUSES,knowledgePath,provenancePath} from "../knowledge-core.js";

// //TR: Seçili girdinin geçmişi görünüm ömrü boyunca tutulur; proje değişince sıfırlanır.
export const knowledgeSel={projectId:null,memId:null};
export function resetKnowledgeSel(){knowledgeSel.projectId=null;knowledgeSel.memId=null}

function stat(ctx,id,label,value){
  return h(ctx.doc,"div",{class:"wf-stat",dataset:{stat:id,value:String(value)}},h(ctx.doc,"span",{class:"wf-stat-num",text:formatCount(value)}),h(ctx.doc,"span",{class:"wf-stat-label",text:label}));
}
function historyBlock(ctx,prov){
  const doc=ctx.doc;
  if(!prov||prov.state!=="VERIFIED")return h(doc,"div",{class:"note",dataset:{memoryHistory:"unreadable"}},stateNote(ctx,prov?.state??"ERROR"));
  const p=prov.provenance;
  return h(doc,"div",{dataset:{memoryHistory:p.id,currentHead:p.currentHeadId}},
    h(doc,"p",{class:"note",text:ctx.t(p.currentHeadId===p.id?"knowledge.hist.isHead":"knowledge.hist.notHead",{head:p.currentHeadId})}),
    h(doc,"ol",{class:"cards",dataset:{memoryLineage:String(p.lineage.length)}},p.lineage.map(s=>h(doc,"li",{class:"card",dataset:{lineageId:s.id,lineageSeq:String(s.seq)}},
      h(doc,"span",{class:"mono",text:s.id})," ",badge(ctx,ctx.t(`knowledge.kind.${s.kind}`))," ",h(doc,"time",{text:formatDateTime(s.at,ctx.i18n.lang)})," ",
      h(doc,"span",{class:"note",text:ctx.t("knowledge.hist.author",{role:s.authorRole})})," ",
      h(doc,"span",{class:"note",text:ctx.t("knowledge.hist.sources",{n:formatCount(s.sources.length)})})," ",
      h(doc,"span",{class:"note mono",text:`${s.hash.slice(0,12)}…`})))));
}
function memorySection(ctx,m,projectId,prov){
  const doc=ctx.doc;
  const head=h(doc,"p",{class:"note",dataset:{knowledgeMemoryState:m.state}},badge(ctx,ctx.t(`knowledge.mem.state.${m.state}`))," ",ctx.t(`knowledge.mem.hint.${m.state}`,{n:formatCount(m.health.tornTailBytes)}));
  if(m.state==="TAMPERED")return h(doc,"div",{dataset:{knowledgeSection:"memory"}},h(doc,"h3",{text:ctx.t("knowledge.mem.title")}),head,h(doc,"p",{class:"note",text:ctx.t("knowledge.mem.noFigures")}));
  const heads=m.currentHeads.length?h(doc,"ul",{class:"cards",dataset:{knowledgeHeads:String(m.currentHeads.length)}},m.currentHeads.map(x=>h(doc,"li",{class:"card",dataset:{memoryId:x.id}},
    badge(ctx,ctx.t(`knowledge.kind.${x.kind}`))," ",h(doc,"strong",{text:x.title})," ",h(doc,"time",{text:formatDateTime(x.at,ctx.i18n.lang)}),x.tags.length?h(doc,"span",{class:"note mono",text:` ${x.tags.join(", ")}`}):null,
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",dataset:{memoryHistoryBtn:x.id},"aria-expanded":knowledgeSel.memId===x.id?"true":"false",text:ctx.t(knowledgeSel.memId===x.id?"knowledge.hist.hide":"knowledge.hist.show"),
      on:{click:async()=>{knowledgeSel.projectId=projectId;knowledgeSel.memId=knowledgeSel.memId===x.id?null:x.id;await ctx.rerender()}}})),
    knowledgeSel.memId===x.id&&provenancePath(projectId,x.id)?historyBlock(ctx,prov):null))):emptyNote(ctx,"knowledge.mem.noHeads");
  return h(doc,"div",{dataset:{knowledgeSection:"memory"}},h(doc,"h3",{text:ctx.t("knowledge.mem.title")}),head,
    h(doc,"div",{class:"wf-stats",role:"group","aria-label":ctx.t("knowledge.mem.statsLabel")},[stat(ctx,"memory-total",ctx.t("knowledge.mem.total"),m.total),...MEMORY_KINDS.map(k=>stat(ctx,`memory-${k}`,ctx.t(`knowledge.kind.${k}`),m.byKind[k]))]),
    h(doc,"h4",{text:ctx.t("knowledge.mem.heads")}),heads);
}
function evidenceSection(ctx,e){
  const doc=ctx.doc,title=h(doc,"h3",{text:ctx.t("knowledge.evd.title")});
  if(e.state!=="AVAILABLE")return h(doc,"div",{dataset:{knowledgeSection:"evidence",knowledgeEvidenceState:e.state}},title,h(doc,"p",{class:"note",role:"status",text:ctx.t(`knowledge.evd.${e.state}`)}));
  const sampled=h(doc,"p",{class:"note",role:"note",dataset:{knowledgeSampled:"1",truncated:e.truncated?"1":"0"},text:ctx.t(e.truncated?"knowledge.evd.sampledTruncated":"knowledge.evd.sampled",{missions:formatCount(e.missionsQueried)})});
  const latest=e.latest.length?h(doc,"ul",{class:"cards",dataset:{knowledgeLatest:String(e.latest.length)}},e.latest.map(x=>h(doc,"li",{class:"card",dataset:{evidenceId:x.evidenceId,verification:x.verification}},
    h(doc,"span",{class:"mono",text:x.evidenceId})," ",badge(ctx,ctx.t(`knowledge.kind.${x.kind}`))," ",badge(ctx,ctx.t(`everif.${x.verification}`))," ",h(doc,"time",{text:x.createdAt?formatDateTime(x.createdAt,ctx.i18n.lang):MISSING})))):emptyNote(ctx,"knowledge.evd.noLatest");
  return h(doc,"div",{dataset:{knowledgeSection:"evidence",knowledgeEvidenceState:"AVAILABLE"}},title,sampled,
    h(doc,"div",{class:"wf-stats",role:"group","aria-label":ctx.t("knowledge.evd.verifLabel")},[stat(ctx,"evidence-total",ctx.t("knowledge.evd.total"),e.total),...VERIFICATION_STATUSES.map(s=>stat(ctx,`evidence-${s}`,ctx.t(`everif.${s}`),e.byVerification[s]))]),
    h(doc,"div",{class:"wf-stats",role:"group","aria-label":ctx.t("knowledge.evd.kindLabel")},EVIDENCE_KINDS.map(k=>stat(ctx,`evidencekind-${k}`,ctx.t(`knowledge.kind.${k}`),e.byKind[k]))),
    h(doc,"h4",{text:ctx.t("knowledge.evd.latest")}),latest);
}
/** Okuma sonucu res = ctx.api.projectKnowledge(projectId); okunamıyorsa yalnız durum notu. */
export async function knowledgePanel(ctx,projectId){
  const doc=ctx.doc,res=knowledgePath(projectId)?await ctx.api.projectKnowledge(projectId):{state:"ERROR",knowledge:null};
  const lead=h(doc,"p",{class:"note",text:ctx.t("knowledge.lead")});
  if(!res||res.state!=="VERIFIED")return panel(ctx,{titleKey:"knowledge.title",id:"studio-ov-knowledge"},lead,stateNote(ctx,res?.state??"ERROR"),h(doc,"p",{class:"note mono",text:`GET ${knowledgePath(projectId)??"/v1/projects/:id/knowledge"}`}));
  const k=res.knowledge;
  if(knowledgeSel.projectId!==projectId)resetKnowledgeSel();
  // //TR: Geçmiş yalnız seçili girdi hâlâ güncel girdiler arasındaysa okunur (eski seçim sessizce düşer).
  const open=k.memory.currentHeads?.some(x=>x.id===knowledgeSel.memId)?knowledgeSel.memId:null;
  if(open===null)resetKnowledgeSel();
  const prov=open!==null?await ctx.api.memoryProvenance(projectId,open):null;
  return panel(ctx,{titleKey:"knowledge.title",id:"studio-ov-knowledge"},lead,memorySection(ctx,k.memory,projectId,prov),evidenceSection(ctx,k.evidence),h(doc,"p",{class:"note mono",text:`GET ${knowledgePath(projectId)}`}));
}
