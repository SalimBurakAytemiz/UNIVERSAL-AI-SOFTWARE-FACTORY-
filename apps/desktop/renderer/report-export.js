// //TR: UASCO-T0020 rapor dışa aktarma çekirdeği (DOM'suz, saf): Kurucu Yönetim Özeti görünümünün ZATEN okuduğu veriden (executiveSummary KPI blokları + İcra Defteri koşu satırları) JSON / Markdown / CSV raporu üretir. Yeni okuma, yazma veya rota yoktur; okunamayan kaynak 0 değil kendi dürüst durumuyla (null değer) raporlanır. CSV hücreleri formül enjeksiyonuna karşı nötrlenir (=,+,-,@,TAB,CR ile başlayan hücre "'" ile başlar), Markdown hücrelerinde | ve satır sonu kaçışlanır.
import {executiveSummary,MAX_LEDGER_ROWS} from "./executive-core.js";

export const REPORT_FORMATS=Object.freeze(["json","md","csv"]);
export const REPORT_MIME=Object.freeze({json:"application/json",md:"text/markdown",csv:"text/csv"});
export const REPORT_SCHEMA="uasco.executive-report/v1";
export const LEDGER_COLUMNS=Object.freeze(["runId","missionId","missionTitle","projectId","status","step","cycle","createdAt","updatedAt","headSha","reviewVerdict","deliveryState","reason"]);
const KPI_KEYS=Object.freeze(["projects","missions","approvals","evidence","inProgress","runs","deliveries","attention"]);
const isOk=r=>Boolean(r)&&r.state==="VERIFIED";
const iso=d=>{const t=d instanceof Date?d.getTime():new Date(d).getTime();return Number.isFinite(t)?new Date(t).toISOString():null};

/** Görünümün okuma sonucu `res` ({cockpit,missions,workRuns,attention}) -> rapor nesnesi. Değerler yalnız VERIFIED kaynaklardan gelir; diğerleri state + null. */
export function buildExecutiveReport(res,{generatedAt=new Date()}={}){
  const r=res??{};
  const {kpis}=executiveSummary({cockpit:r.cockpit,missions:r.missions,runs:r.workRuns,attention:r.attention});
  const titles=isOk(r.missions)&&r.missions.missions?new Map(r.missions.missions.items.map(m=>[m.missionId,m.title])):null;
  const runs=isOk(r.workRuns)&&r.workRuns.runs?r.workRuns.runs:null;
  const rows=runs?runs.items.slice(0,MAX_LEDGER_ROWS).map(x=>({runId:x.runId,missionId:x.missionId,missionTitle:titles?titles.get(x.missionId)??null:null,projectId:x.projectId,status:x.status,step:x.step,cycle:x.cycle,
    createdAt:x.createdAt,updatedAt:x.updatedAt,headSha:x.headSha??null,reviewVerdict:x.review&&x.review.verdict?x.review.verdict:null,deliveryState:x.delivery?.state??null,reason:x.reason??null})):[];
  return {schema:REPORT_SCHEMA,generatedAt:iso(generatedAt),
    sources:{cockpit:r.cockpit?.state??"ERROR",missions:r.missions?.state??"ERROR",workRuns:r.workRuns?.state??"ERROR",attention:r.attention?.state??"ERROR"},
    kpis:Object.fromEntries(KPI_KEYS.map(k=>[k,{state:kpis[k].state,value:kpis[k].value,source:kpis[k].source}])),
    ledger:{state:runs?"VERIFIED":(r.workRuns?.state??"ERROR"),total:runs?runs.total:null,included:rows.length,truncated:runs?rows.length<runs.total:false,rows}};
}

/** CSV hücresi: RFC 4180 kaçışı + formül enjeksiyonu nötrleme. null/undefined -> boş hücre. */
export function csvCell(v){
  if(v===null||v===undefined)return "";
  let s=String(v);
  if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;
  return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
/** Markdown tablo hücresi: | ve satır sonları kaçışlanır, ters eğik çizgi korunur; null -> "—". */
export function mdCell(v){
  if(v===null||v===undefined||v==="")return "—";
  return String(v).replace(/\\/g,"\\\\").replace(/\|/g,"\\|").replace(/\r?\n|\r/g," ");
}
export function reportToJson(rep){return `${JSON.stringify(rep,null,2)}\n`}
/** CSV: İcra Defteri satırları (başlık satırı + en çok MAX_LEDGER_ROWS satır); CRLF satır sonu. */
export function reportToCsv(rep){
  const lines=[LEDGER_COLUMNS.join(","),...rep.ledger.rows.map(row=>LEDGER_COLUMNS.map(c=>csvCell(row[c])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
/** Markdown: başlık, kaynak durumları, KPI tablosu, defter tablosu. t(key,vars) çevirisi yalnız başlıklar içindir; veri hücreleri kaçışlanır. */
export function reportToMarkdown(rep,t=k=>k){
  const out=[`# ${mdCell(t("report.md.title"))}`,"",`${mdCell(t("report.md.generated"))}: ${mdCell(rep.generatedAt)}`,`${mdCell(t("report.md.schema"))}: ${mdCell(rep.schema)}`,"",
    `## ${mdCell(t("report.md.sources"))}`,"",...Object.entries(rep.sources).map(([k,v])=>`- ${mdCell(k)}: ${mdCell(v)}`),"",
    `## ${mdCell(t("report.md.kpis"))}`,"",`| ${mdCell(t("report.md.kpi"))} | ${mdCell(t("report.md.state"))} | ${mdCell(t("report.md.value"))} | ${mdCell(t("report.md.source"))} |`,"| --- | --- | --- | --- |",
    ...Object.entries(rep.kpis).map(([k,b])=>`| ${mdCell(k)} | ${mdCell(b.state)} | ${mdCell(b.value)} | ${mdCell(b.source)} |`),"",
    `## ${mdCell(t("report.md.ledger"))}`,""];
  if(rep.ledger.state!=="VERIFIED")out.push(`${mdCell(t("report.md.ledgerState"))}: ${mdCell(rep.ledger.state)}`);
  else if(!rep.ledger.rows.length)out.push(mdCell(t("report.md.ledgerEmpty")));
  else{
    if(rep.ledger.truncated)out.push(mdCell(t("report.md.truncated",{shown:rep.ledger.included,total:rep.ledger.total})),"");
    out.push(`| ${LEDGER_COLUMNS.map(mdCell).join(" | ")} |`,`| ${LEDGER_COLUMNS.map(()=>"---").join(" | ")} |`,...rep.ledger.rows.map(row=>`| ${LEDGER_COLUMNS.map(c=>mdCell(row[c])).join(" | ")} |`));
  }
  return `${out.join("\n")}\n`;
}
/** Biçim -> {fileName,mime,text}; bilinmeyen biçim null (fail-closed). Dosya adı yalnız [A-Za-z0-9._-] içerir. */
export function renderReport(rep,format,t){
  if(!REPORT_FORMATS.includes(format))return null;
  const stamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(rep.generatedAt))?String(rep.generatedAt).slice(0,19).replace(/[-:]/g,""):"unknown";
  const text=format==="json"?reportToJson(rep):format==="csv"?reportToCsv(rep):reportToMarkdown(rep,t);
  return {fileName:`uasco-executive-report-${stamp}.${format}`,mime:REPORT_MIME[format],text};
}
