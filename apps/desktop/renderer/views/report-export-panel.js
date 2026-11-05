// //TR: UASCO-T0020 Kurucu Yönetim Özeti rapor dışa aktarma paneli: görünümün zaten okuduğu `res` üzerinden JSON / Markdown / CSV üretir ve Blob indirmesiyle masaüstü kayıt penceresine verir (main.mjs'te will-download işleyicisi yoktur; Electron'un yerel kaydet penceresi açılır). Yeni okuma/yazma/IPC/rota yoktur. Durum dürüsttür: dosyanın kaydedildiği DEĞİL, kayıt penceresine verildiği söylenir; Blob/URL yoksa hiçbir şey yapılmaz ve "kullanılamıyor" gösterilir.
import {h,panel} from "../components.js";
import {buildExecutiveReport,renderReport,REPORT_FORMATS} from "../report-export.js";

/** Varsayılan kaydedici: Blob + object URL + <a download>; tıklamadan sonra URL bırakılır. Ortamda Blob/URL yoksa {ok:false,code:"EXPORT_UNAVAILABLE"}. */
export function blobDownload(doc,{fileName,mime,text}){
  const w=doc.defaultView??globalThis,B=w.Blob,U=w.URL;
  if(typeof B!=="function"||!U||typeof U.createObjectURL!=="function"||typeof doc.createElement!=="function")return {ok:false,code:"EXPORT_UNAVAILABLE"};
  let url=null;
  try{
    url=U.createObjectURL(new B([text],{type:`${mime};charset=utf-8`}));
    const a=doc.createElement("a");a.setAttribute("href",url);a.setAttribute("download",fileName);a.hidden=true;
    (doc.body??doc.documentElement).append(a);a.click();a.remove();
    return {ok:true};
  }catch{return {ok:false,code:"EXPORT_FAILED"}}
  finally{if(url){const rel=()=>{try{U.revokeObjectURL(url)}catch{/* yoksay */}};(w.setTimeout??globalThis.setTimeout)(rel,30000)}}
}
export const exportUi={last:null};
/** Tek biçimi üretir ve kaydediciye verir; sonucu exportUi.last'e yazar ve durum düğümünü günceller. */
export function exportReport(ctx,res,format,status){
  const rep=buildExecutiveReport(res,{generatedAt:typeof ctx.now==="function"?new Date(ctx.now()):new Date()});
  const out=renderReport(rep,format,(k,v)=>ctx.t(k,v));
  const r=out?(typeof ctx.saveFile==="function"?ctx.saveFile(out):blobDownload(ctx.doc,out)):{ok:false,code:"EXPORT_FORMAT"};
  exportUi.last={format,ok:r.ok===true,code:r.ok?null:String(r.code??"EXPORT_FAILED"),fileName:out?.fileName??null,rows:rep.ledger.included};
  if(status){
    status.dataset.exportResult=exportUi.last.ok?"HANDED_OFF":exportUi.last.code;
    status.textContent=exportUi.last.ok?ctx.t("report.handedOff",{file:out.fileName,rows:String(rep.ledger.included)}):ctx.t("report.failed",{code:exportUi.last.code});
  }
  return exportUi.last;
}
export function exportPanel(ctx,res){
  const doc=ctx.doc;
  const status=h(doc,"p",{class:"note",id:"executive-export-status",role:"status","aria-live":"polite"});
  const buttons=REPORT_FORMATS.map(f=>h(doc,"button",{type:"button",class:"btn",id:`executive-export-${f}`,dataset:{exportFormat:f,focusKey:`executive-export-${f}`},text:ctx.t(`report.btn.${f}`),on:{click:()=>exportReport(ctx,res,f,status)}}));
  return panel(ctx,{titleKey:"report.title",id:"executive-export",className:"executive-section"},
    h(doc,"p",{class:"note",text:ctx.t("report.lead")}),
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("report.title")},buttons),status);
}
