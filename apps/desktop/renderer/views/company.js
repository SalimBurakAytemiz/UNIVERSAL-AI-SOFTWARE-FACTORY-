// //TR: Bu görünüm Company OS'tir (SC-15): CRM (hesap, kişi, fırsat), Finans (fatura, ödeme) ve Hukuk (sözleşme) yalnız GET /v1/company/* gerçek verisinden okunur; salt-okunurdur (kayıt oluşturma/düzenleme kapsam dışı). Kaynak başına dürüst durum (EMPTY/UNAVAILABLE/NOT_CONNECTED/OFFLINE/FAILED/STALE) ayrık rozetle gösterilir, veri uydurulmaz; taslak fatura ödenmiş, fırsat/teklif imzalı görünmez; para birimleri ayrı toplanır. API verisi HTML olarak yorumlanmaz.
import {h,panel,statePill,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {COMPANY_KEYS,COMPANY_PATHS,COMPANY_TABS,TAB_SOURCES,OPEN_STAGES,isLive,companyPillKind,formatMoney,sumByCurrency,invoiceIntegrity,contractIntegrity,accountName,forAccount,emptyResource} from "../company-core.js";

/** Görünüm seçimi (sekme + hesap süzgeci) görünüm ömrü boyunca korunur; periyodik yenileme seçimi bozmaz. */
const sel={tab:"crm",accountId:null};
export function resetCompanyView(){sel.tab="crm";sel.accountId=null}
export function selectedTab(){return sel.tab}

const STAGE_PILL=Object.freeze({LEAD:"ACTIVE",QUALIFIED:"ACTIVE",PROPOSAL:"ACTIVE",WON:"DONE",LOST:"STOPPED"});
const INVOICE_PILL=Object.freeze({DRAFT:"IDLE",ISSUED:"WAITING",PARTIALLY_PAID:"ATTENTION",PAID:"DONE",VOID:"STOPPED"});
const CONTRACT_PILL=Object.freeze({DRAFT:"IDLE",SENT:"WAITING",SIGNED:"DONE",DECLINED:"BLOCKED",EXPIRED:"ATTENTION"});
const PAYMENT_PILL=Object.freeze({PAYMENT:"DONE",REVERSAL:"ATTENTION"});

const srcLabel=key=>`GET ${COMPANY_PATHS[key]}`;
const dash=v=>v===null||v===undefined||v===""?MISSING:v;
const mono=(doc,text)=>text?h(doc,"span",{class:"mono",text}):MISSING;

/** Kayıt durumu rozeti: sözlükte tanımlı değer ikon+yerelleştirilmiş metin; bilinmeyen değer NEUTRAL ve ham metin (uydurma etiket yok). */
function recordPill(ctx,domain,value,map,{kind}={}){
  const known=typeof value==="string"&&Object.prototype.hasOwnProperty.call(map,value);
  if(!known)return statePill(ctx,"NEUTRAL",{label:value?String(value):MISSING});
  return statePill(ctx,kind??map[value],{label:ctx.t(`company.${domain}.${value}`)});
}
function opportunityPill(ctx,o){return recordPill(ctx,"stage",o.stage,STAGE_PILL)}
function invoicePill(ctx,i){return recordPill(ctx,"invoice",i.status,INVOICE_PILL,{kind:invoiceIntegrity(i)==="MISMATCH"?"NOT_VERIFIED":undefined})}
function contractPill(ctx,c){return recordPill(ctx,"contract",c.status,CONTRACT_PILL,{kind:contractIntegrity(c)==="MISSING_EVIDENCE"?"NOT_VERIFIED":undefined})}
function paymentPill(ctx,p){return recordPill(ctx,"payment",p.entryKind,PAYMENT_PILL)}

/** Kaynak durumunun açıklaması: ayrık rozet + sabit durum metni + ipucu; sayı veya kayıt uydurulmaz. */
function stateBlock(ctx,key,res){
  const doc=ctx.doc,state=res.state;
  return h(doc,"div",{class:`company-state state-${String(state).toLowerCase()}`,role:"status",dataset:{companyState:state,source:key}},
    h(doc,"p",{class:"company-state-head"},statePill(ctx,companyPillKind(res)),h(doc,"strong",{text:ctx.t(`company.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`company.hint.${state}`,{source:srcLabel(key)})}),
    res.message&&state!=="NOT_CONNECTED"?h(doc,"p",{class:"note mono",text:res.message}):null);
}
function staleBanner(ctx,key,res){
  const doc=ctx.doc;
  return h(doc,"div",{class:"company-stale",role:"status",dataset:{companyState:"STALE",source:key}},statePill(ctx,"STALE"),
    h(doc,"span",{text:ctx.t("company.stale",{time:formatDateTime(res.asOf,ctx.i18n.lang),cause:ctx.t(`company.state.${res.cause??"ERROR"}`)})}));
}
function emptyBlock(ctx,key){
  const doc=ctx.doc;
  return h(doc,"div",{class:"company-state state-empty",role:"status",dataset:{companyState:"EMPTY",source:key}},
    h(doc,"p",{class:"company-state-head"},statePill(ctx,"EMPTY"),h(doc,"strong",{text:ctx.t("company.state.EMPTY")})),
    h(doc,"p",{class:"note",text:ctx.t(`company.empty.${key}`)}));
}
/** Erişilebilir tablo: caption, scope="col" başlık, sayısal sütunlar sağa hizalı. */
function table(ctx,id,captionKey,cols,rows){
  const doc=ctx.doc;
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table company-table",id,dataset:{companyTable:id}},
    h(doc,"caption",{class:"sr-only",text:ctx.t(captionKey)}),
    h(doc,"thead",{},h(doc,"tr",{},cols.map(c=>h(doc,"th",{scope:"col",class:c.num?"num":undefined,text:ctx.t(c.key)})))),
    h(doc,"tbody",{},rows.map(r=>h(doc,"tr",{dataset:{recordId:r.id}},r.cells.map((cell,i)=>h(doc,"td",{class:cols[i].num?"num":undefined},cell===null||cell===undefined?MISSING:cell)))))));
}
/** Bir kaynağın paneli: başlık + durum rozeti; canlı değilse yalnız dürüst durum, STALE ise uyarı + eski veri, boşsa EMPTY. */
function section(ctx,{id,key,titleKey,res,filtered=null,build}){
  const doc=ctx.doc,live=isLive(res);
  const head=h(doc,"p",{class:"company-pill-row"},statePill(ctx,companyPillKind(res)),h(doc,"span",{class:"company-src mono",text:srcLabel(key)}));
  let body;
  if(!live)body=stateBlock(ctx,key,res);
  else{
    const rows=filtered??res.items;
    body=[res.state==="STALE"?staleBanner(ctx,key,res):null,res.items.length===0?emptyBlock(ctx,key):rows.length?[build(rows)].flat():h(doc,"p",{class:"note",dataset:{filterEmpty:"1"},text:ctx.t("company.filter.none")})].flat();
  }
  return panel(ctx,{titleKey,id,className:"company-section"},head,body);
}

// ---------- KPI ----------
const blockOf=(res,key,value)=>({state:res.state,value:isLive(res)?value:null,loading:false,source:srcLabel(key),asOf:res.asOf});
function moneyList(ctx,totals,skipped,labelKey){
  const doc=ctx.doc;
  if(!totals.length&&!skipped)return null;
  return h(doc,"div",{class:"company-money",dataset:{money:labelKey}},
    totals.length?h(doc,"ul",{class:"money-list","aria-label":ctx.t(labelKey)},totals.map(t=>h(doc,"li",{dataset:{currency:t.currency}},h(doc,"span",{class:"money",text:formatMoney(t.minor,t.currency,ctx.i18n.lang)})))):null,
    skipped?h(doc,"p",{class:"kpi-qual",text:ctx.t("company.kpi.skipped",{n:skipped})}):null);
}
function kpis(ctx,res){
  const doc=ctx.doc,{accounts,opportunities,invoices,contracts}=res;
  const open=isLive(opportunities)?opportunities.items.filter(o=>OPEN_STAGES.includes(o.stage)):[];
  const pipeline=sumByCurrency(open,o=>o.amountMinor);
  const receivable=isLive(invoices)?invoices.items.filter(i=>i.status==="ISSUED"||i.status==="PARTIALLY_PAID"):[];
  const outstanding=sumByCurrency(receivable,i=>i.balanceMinor);
  const signed=isLive(contracts)?contracts.items.filter(c=>c.status==="SIGNED"&&contractIntegrity(c)==="OK"):[];
  const awaiting=isLive(contracts)?contracts.items.filter(c=>c.status==="SENT").length:0;
  const pill=r=>companyPillKind(r);
  return h(doc,"div",{class:"kpi-row company-kpis",role:"group","aria-label":ctx.t("company.kpiGroup")},
    kpiTile(ctx,{id:"company-accounts",iconName:"users",labelKey:"company.kpi.accounts",block:blockOf(accounts,"accounts",accounts.items.length),pillKind:pill(accounts),qualifier:ctx.t("company.kpi.q.accounts")}),
    kpiTile(ctx,{id:"company-opportunities",iconName:"funnel",labelKey:"company.kpi.pipeline",block:blockOf(opportunities,"opportunities",open.length),pillKind:pill(opportunities),qualifier:ctx.t("company.kpi.q.pipeline"),extra:isLive(opportunities)?moneyList(ctx,pipeline.totals,pipeline.skipped,"company.kpi.pipelineAmount"):null}),
    kpiTile(ctx,{id:"company-receivables",iconName:"receipt",labelKey:"company.kpi.receivables",block:blockOf(invoices,"invoices",receivable.length),pillKind:pill(invoices),qualifier:ctx.t("company.kpi.q.receivables"),extra:isLive(invoices)?moneyList(ctx,outstanding.totals,outstanding.skipped,"company.kpi.outstanding"):null}),
    kpiTile(ctx,{id:"company-contracts",iconName:"contract",labelKey:"company.kpi.signed",block:blockOf(contracts,"contracts",signed.length),pillKind:pill(contracts),qualifier:isLive(contracts)?ctx.t("company.kpi.q.signed",{n:awaiting}):ctx.t("company.kpi.q.signedNa")}));
}

// ---------- Tablolar ----------
const acct=(ctx,res,id)=>{
  const doc=ctx.doc;if(!id)return MISSING;
  const name=accountName(res.accounts,id);
  return name?h(doc,"span",{},name):mono(doc,id);
};
const when=(ctx,iso)=>formatDateTime(iso,ctx.i18n.lang);
const money=(ctx,v,cur)=>h(ctx.doc,"span",{class:"money",text:formatMoney(v,cur,ctx.i18n.lang)});
const count=(res,pick)=>isLive(res)?String(res.items.filter(pick).length):MISSING;

function accountsSection(ctx,res){
  const doc=ctx.doc,cols=[{key:"company.col.name"},{key:"company.col.id"},{key:"company.col.created"},{key:"company.col.contacts",num:true},{key:"company.col.opportunities",num:true},{key:"company.col.contracts",num:true},{key:"company.col.invoices",num:true}];
  return section(ctx,{id:"company-accounts",key:"accounts",titleKey:"company.accounts.title",res:res.accounts,filtered:res.accounts.items.filter(a=>!sel.accountId||a.id===sel.accountId),
    build:rows=>table(ctx,"company-accounts-table","company.accounts.title",cols,rows.map(a=>({id:a.id,cells:[dash(a.name),mono(doc,a.id),when(ctx,a.createdAt),
      count(res.contacts,c=>c.accountId===a.id),count(res.opportunities,o=>o.accountId===a.id),count(res.contracts,c=>c.accountId===a.id),count(res.invoices,i=>i.accountId===a.id)]})))});
}
function contactsSection(ctx,res){
  const doc=ctx.doc,cols=[{key:"company.col.name"},{key:"company.col.role"},{key:"company.col.email"},{key:"company.col.account"},{key:"company.col.created"}];
  return section(ctx,{id:"company-contacts",key:"contacts",titleKey:"company.contacts.title",res:res.contacts,filtered:forAccount(res.contacts.items,sel.accountId),
    build:rows=>table(ctx,"company-contacts-table","company.contacts.title",cols,rows.map(c=>({id:c.id,cells:[dash(c.name),dash(c.role),c.email?h(doc,"span",{class:"mono",text:c.email}):MISSING,acct(ctx,res,c.accountId),when(ctx,c.createdAt)]})))});
}
function opportunitiesSection(ctx,res){
  const cols=[{key:"company.col.title"},{key:"company.col.account"},{key:"company.col.stage"},{key:"company.col.amount",num:true},{key:"company.col.updated"}];
  return section(ctx,{id:"company-opps",key:"opportunities",titleKey:"company.opportunities.title",res:res.opportunities,filtered:forAccount(res.opportunities.items,sel.accountId),
    build:rows=>[h(ctx.doc,"p",{class:"note",dataset:{note:"won-not-signed"},text:ctx.t("company.opportunities.note")}),
      table(ctx,"company-opps-table","company.opportunities.title",cols,rows.map(o=>({id:o.id,cells:[dash(o.title),acct(ctx,res,o.accountId),opportunityPill(ctx,o),money(ctx,o.amountMinor,o.currency),when(ctx,o.updatedAt)]})))]});
}
function invoicesSection(ctx,res){
  const doc=ctx.doc,cols=[{key:"company.col.number"},{key:"company.col.account"},{key:"company.col.status"},{key:"company.col.total",num:true},{key:"company.col.paid",num:true},{key:"company.col.balance",num:true},{key:"company.col.due"}];
  return section(ctx,{id:"company-invoices",key:"invoices",titleKey:"company.invoices.title",res:res.invoices,filtered:forAccount(res.invoices.items,sel.accountId),
    build:rows=>[h(doc,"p",{class:"note",dataset:{note:"draft-not-paid"},text:ctx.t("company.invoices.note")}),
      table(ctx,"company-invoices-table","company.invoices.title",cols,rows.map(i=>({id:i.id,cells:[i.number?mono(doc,i.number):h(doc,"span",{class:"note",text:ctx.t("company.invoices.noNumber")}),acct(ctx,res,i.accountId),invoicePill(ctx,i),
        money(ctx,i.totalMinor,i.currency),money(ctx,i.paidMinor,i.currency),money(ctx,i.balanceMinor,i.currency),dash(i.dueDate)]})))]});
}
function paymentsSection(ctx,res){
  const doc=ctx.doc,cols=[{key:"company.col.reference"},{key:"company.col.invoice"},{key:"company.col.kind"},{key:"company.col.amount",num:true},{key:"company.col.received"}];
  // Hesap süzgeci ödemeleri fatura üzerinden süzer; fatura listesi canlı değilse süzme yapılamaz ve ödemeler tümüyle gösterilmez.
  const invs=res.invoices,ids=isLive(invs)?new Set(forAccount(invs.items,sel.accountId).map(i=>i.id)):null;
  const blocked=Boolean(sel.accountId)&&ids===null;
  const filtered=blocked?[]:sel.accountId?res.payments.items.filter(p=>ids.has(p.invoiceId)):res.payments.items;
  const inv=id=>{if(!id)return MISSING;const n=isLive(invs)?invs.items.find(i=>i.id===id)?.number:null;return n?mono(doc,n):mono(doc,id)};
  const node=section(ctx,{id:"company-payments",key:"payments",titleKey:"company.payments.title",res:res.payments,filtered,
    build:rows=>table(ctx,"company-payments-table","company.payments.title",cols,rows.map(p=>({id:p.id,cells:[p.reference?mono(doc,p.reference):mono(doc,p.id),inv(p.invoiceId),paymentPill(ctx,p),money(ctx,p.amountMinor,p.currency),when(ctx,p.receivedAt)]})))});
  if(blocked)node.append(h(doc,"p",{class:"note",dataset:{filterBlocked:"1"},text:ctx.t("company.filter.needInvoices")}));
  return node;
}
function evidenceCell(ctx,c){
  const doc=ctx.doc;
  if(c.status!=="SIGNED")return h(doc,"span",{class:"note",text:ctx.t("company.contracts.notSigned")});
  if(contractIntegrity(c)!=="OK")return h(doc,"span",{class:"note",dataset:{evidence:"missing"},text:ctx.t("company.contracts.evidenceMissing")});
  return h(doc,"span",{dataset:{evidence:"complete"}},h(doc,"span",{text:`${c.signerName} · ${when(ctx,c.signedAt)}`}),h(doc,"br"),h(doc,"span",{class:"mono",text:`sha256:${c.documentSha256.slice(0,12)}…`,title:c.documentSha256}));
}
function contractsSection(ctx,res){
  const cols=[{key:"company.col.title"},{key:"company.col.account"},{key:"company.col.status"},{key:"company.col.signature"},{key:"company.col.sent"}];
  return section(ctx,{id:"company-contracts",key:"contracts",titleKey:"company.contracts.title",res:res.contracts,filtered:forAccount(res.contracts.items,sel.accountId),
    build:rows=>[h(ctx.doc,"p",{class:"note",dataset:{note:"signature-evidence"},text:ctx.t("company.contracts.note")}),
      table(ctx,"company-contracts-table","company.contracts.title",cols,rows.map(c=>({id:c.id,cells:[dash(c.title),acct(ctx,res,c.accountId),contractPill(ctx,c),evidenceCell(ctx,c),when(ctx,c.sentAt)]})))]});
}
const TAB_BODY={
  crm:(ctx,res)=>[accountsSection(ctx,res),opportunitiesSection(ctx,res),contactsSection(ctx,res)],
  finance:(ctx,res)=>[invoicesSection(ctx,res),paymentsSection(ctx,res)],
  legal:(ctx,res)=>[contractsSection(ctx,res)]
};

// ---------- Başlık, kaynak şeridi, sekmeler, süzgeç ----------
function sourceStrip(ctx,res){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources","aria-label":ctx.t("company.sources")},COMPANY_KEYS.map(k=>h(doc,"li",{dataset:{source:k,sourceState:res[k].state}},h(doc,"span",{class:"company-src-name",text:ctx.t(`company.src.${k}`)}),statePill(ctx,companyPillKind(res[k])))));
}
function tabBar(ctx,res){
  const doc=ctx.doc;
  const go=async(k,focus)=>{sel.tab=k;if(focus){const n=doc.getElementById?.(`company-tab-${k}`);if(n)n.focus()}await ctx.rerender();ctx.settleFocus?.({keys:[`id:company-tab-${k}`,"id:company-panel"]})};
  return h(doc,"div",{class:"tabs company-tabs",role:"tablist","aria-label":ctx.t("company.tabs.label")},COMPANY_TABS.map((k,i)=>{
    const on=sel.tab===k,bad=TAB_SOURCES[k].some(s=>!isLive(res[s]));
    return h(doc,"button",{type:"button",role:"tab",id:`company-tab-${k}`,"aria-selected":on?"true":"false","aria-controls":"company-panel",tabindex:on?"0":"-1",dataset:{focusKey:`company-tab-${k}`,tab:k,tabHealth:bad?"degraded":"ok"},
      on:{click:()=>go(k,false),keydown:e=>{
        const d=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;
        if(d){e.preventDefault();go(COMPANY_TABS[(i+d+COMPANY_TABS.length)%COMPANY_TABS.length],true)}
        else if(e.key==="Home"){e.preventDefault();go(COMPANY_TABS[0],true)}
        else if(e.key==="End"){e.preventDefault();go(COMPANY_TABS[COMPANY_TABS.length-1],true)}
      }}},
      h(doc,"span",{text:ctx.t(`company.tab.${k}`)}),bad?h(doc,"span",{class:"tab-flag","aria-hidden":"true",text:" !"}):null,bad?h(doc,"span",{class:"sr-only",text:` (${ctx.t("company.tab.degraded")})`}):null);
  }));
}
function accountFilter(ctx,res){
  const doc=ctx.doc,acc=res.accounts;
  if(!isLive(acc)||acc.items.length===0)return null;
  if(sel.accountId&&!acc.items.some(a=>a.id===sel.accountId))sel.accountId=null;
  const select=h(doc,"select",{id:"company-account-filter",dataset:{focusKey:"company-account-filter"},"aria-describedby":"company-account-filter-hint",
    on:{change:async e=>{const v=e.target.value;sel.accountId=v?v:null;await ctx.rerender();ctx.settleFocus?.({keys:["id:company-account-filter"]})}}},
    h(doc,"option",{value:"",selected:!sel.accountId,text:ctx.t("company.filter.all")}),
    acc.items.map(a=>h(doc,"option",{value:a.id,selected:a.id===sel.accountId,text:a.name??a.id})));
  return h(doc,"div",{class:"filter-row company-filter"},h(doc,"div",{class:"field"},h(doc,"label",{for:"company-account-filter",text:ctx.t("company.filter.account")}),select,h(doc,"p",{class:"field-hint",id:"company-account-filter-hint",text:ctx.t("company.filter.hint")})));
}
function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("company.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.company.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.company.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("company.readonly")}));
}

export async function render(ctx){
  const doc=ctx.doc;
  let res;try{res=await ctx.api.company()}catch{res=Object.fromEntries(COMPANY_KEYS.map(k=>[k,emptyResource("ERROR")]))}
  for(const k of COMPANY_KEYS)if(!res[k])res[k]=emptyResource("UNAVAILABLE");
  const filter=accountFilter(ctx,res);
  return h(doc,"div",{class:"view view-company",dataset:{companyTab:sel.tab}},
    header(ctx),
    kpis(ctx,res),
    panel(ctx,{titleKey:"company.sources",id:"company-sources",className:"company-sources-panel"},sourceStrip(ctx,res)),
    h(doc,"div",{class:"company-toolbar"},tabBar(ctx,res),filter),
    h(doc,"div",{id:"company-panel",role:"tabpanel","aria-labelledby":`company-tab-${sel.tab}`,tabindex:"-1",class:"company-panel"},TAB_BODY[sel.tab](ctx,res)));
}
