// //TR: Bu görünüm parçası Project Studio > Genel Bakış'taki "Proje bilgisi" panelidir (UI-160, Lane B GET /v1/projects/:id/knowledge): Proje Belleği (karar/bilgi/kaynak/revizyon/not sayıları AYRI, güncel başlar) ve kanıt dizini özeti. Salt okunur; sayılar sunucunun bildirdiği gibidir. TAMPERED bellek için sayı/baş GÖSTERİLMEZ, TORN_TAIL için doğrulanmış önek olduğu söylenir, kanıt YALNIZ örneklenmiş bir sayımdır (en yeni misyonlar, kesilmiş olabilir) ve bağlı değilse/sorgu başarısızsa 0 uydurulmaz. Okunamayan kaynak (404, izin listesi yok, bozuk yanıt) sayı yerine durum notu gösterir.
import {h,panel,stateNote,emptyNote,badge} from "../components.js";
import {drafts,field,statusBlock,setStatus,focusResult} from "../forms.js";
import {formatCount,MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {MEMORY_KINDS,EVIDENCE_KINDS,VERIFICATION_STATUSES,knowledgePath,provenancePath,buildMemorySearch,LIST_RENDER_CAP} from "../knowledge-core.js";

// //TR: Seçili girdinin geçmişi görünüm ömrü boyunca tutulur; proje değişince sıfırlanır.
export const knowledgeSel={projectId:null,memId:null};
export function resetKnowledgeSel(){knowledgeSel.projectId=null;knowledgeSel.memId=null}
// //TR: Bellek arama taslağı ve gönderilen yol; proje değişince sıfırlanır.
export const MEMSEARCH_FORM="knowledge-search";
export const memSearch={projectId:null,kind:"",tag:"",q:"",path:null};
export function resetMemSearch(){memSearch.projectId=null;memSearch.kind="";memSearch.tag="";memSearch.q="";memSearch.path=null;delete drafts.status[MEMSEARCH_FORM]}
const BODY_EXCERPT=400;
export async function submitMemSearch(ctx,projectId){
  const b=buildMemorySearch(projectId,{kind:memSearch.kind,tag:memSearch.tag,q:memSearch.q});
  if(!b.ok){memSearch.projectId=projectId;memSearch.path=null;setStatus(MEMSEARCH_FORM,{ok:false,errors:b.errors});await ctx.rerender();focusResult(ctx,MEMSEARCH_FORM,["id:knowledge-search-submit"]);return {ok:false,validation:true}}
  delete drafts.status[MEMSEARCH_FORM];memSearch.projectId=projectId;memSearch.path=b.path;await ctx.rerender();return {ok:true,path:b.path};
}
function searchForm(ctx,projectId){
  const doc=ctx.doc;
  return h(doc,"div",{class:"form",id:"knowledge-search",dataset:{knowledgeSearch:projectId}},
    h(doc,"h4",{text:ctx.t("knowledge.search.title")}),h(doc,"p",{class:"note",text:ctx.t("knowledge.search.lead")}),
    field(ctx,{id:"knowledge-search-kind",labelKey:"knowledge.search.kind",value:memSearch.kind,onInput:v=>{memSearch.kind=v},options:[{value:"",label:ctx.t("knowledge.search.kindAny")},...MEMORY_KINDS.map(k=>({value:k,label:ctx.t(`knowledge.kind.${k}`)}))]}),
    field(ctx,{id:"knowledge-search-tag",labelKey:"knowledge.search.tag",value:memSearch.tag,onInput:v=>{memSearch.tag=v}}),
    field(ctx,{id:"knowledge-search-q",labelKey:"knowledge.search.q",value:memSearch.q,onInput:v=>{memSearch.q=v},hintKey:"knowledge.search.qHint"}),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"knowledge-search-submit",dataset:{focusKey:"knowledge-search-submit"},text:ctx.t("knowledge.search.submit"),on:{click:()=>submitMemSearch(ctx,projectId)}}),
      h(doc,"button",{type:"button",class:"btn",id:"knowledge-search-clear",text:ctx.t("knowledge.search.clear"),on:{click:async()=>{resetMemSearch();memSearch.projectId=projectId;await ctx.rerender()}}})),
    statusBlock(ctx,MEMSEARCH_FORM));
}
function searchResults(ctx,res){
  const doc=ctx.doc;
  if(!res||res.state!=="VERIFIED")return h(doc,"div",{dataset:{memorySearchResult:"unreadable"}},stateNote(ctx,res?.state??"ERROR"));
  const l=res.list;
  if(!l.records.length)return h(doc,"div",{dataset:{memorySearchResult:"none"}},emptyNote(ctx,"knowledge.search.none"));
  const shown=l.records.slice(0,LIST_RENDER_CAP);
  return h(doc,"div",{dataset:{memorySearchResult:"list",total:String(l.total),shown:String(shown.length)}},
    h(doc,"p",{class:"note",role:"status",text:ctx.t("knowledge.search.count",{shown:formatCount(shown.length),total:formatCount(l.total)})}),
    h(doc,"ul",{class:"cards"},shown.map(r=>h(doc,"li",{class:"card",dataset:{searchMemoryId:r.id}},
      badge(ctx,ctx.t(`knowledge.kind.${r.kind}`))," ",h(doc,"strong",{text:r.title})," ",h(doc,"time",{text:formatDateTime(r.at,ctx.i18n.lang)}),
      r.tags.length?h(doc,"span",{class:"note mono",text:` ${r.tags.join(", ")}`}):null,
      h(doc,"p",{class:"note",text:r.body.length>BODY_EXCERPT?`${r.body.slice(0,BODY_EXCERPT)}…`:r.body}),
      r.body.length>BODY_EXCERPT?h(doc,"p",{class:"note",text:ctx.t("knowledge.search.cut",{n:formatCount(BODY_EXCERPT)})}):null,
      h(doc,"span",{class:"note",text:ctx.t("knowledge.hist.author",{role:r.authorRole})})," ",h(doc,"span",{class:"note",text:ctx.t("knowledge.hist.sources",{n:formatCount(r.sources.length)})}),
      r.supersedes?[" ",h(doc,"span",{class:"note mono",text:ctx.t("knowledge.search.replaces",{id:r.supersedes})})]:null))));
}

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
  if(memSearch.projectId!==projectId){resetMemSearch();memSearch.projectId=projectId}
  const found=memSearch.path!==null?await ctx.api.memoryList(projectId,memSearch.path):null;
  return panel(ctx,{titleKey:"knowledge.title",id:"studio-ov-knowledge"},lead,memorySection(ctx,k.memory,projectId,prov),searchForm(ctx,projectId),memSearch.path!==null?searchResults(ctx,found):null,evidenceSection(ctx,k.evidence),h(doc,"p",{class:"note mono",text:`GET ${knowledgePath(projectId)}`}));
}
