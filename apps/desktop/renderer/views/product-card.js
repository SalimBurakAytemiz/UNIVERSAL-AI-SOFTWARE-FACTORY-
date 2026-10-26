// //TR: Bu görünüm parçası Proje Studio Genel Bakış'taki "Çalışan ürün" kartıdır (teslimden sonra): dev-run durumu (GET /v1/projects/:id/devrun), yerel URL (yalnız RUNNING + önizleme AVAILABLE + kesin http://127.0.0.1:<port>/ ise), BLOCKED/CRASHED nedeni ve sandbox gerçeği gösterilir. "Ürünü başlat" yalnız akışın DELIVERY aşaması sunucuda DONE iken sunulur, mevcut onaylı POST /v1/projects/:id/devrun/start yolunu kullanır; "Durdur" canlı süreç için her zaman sunulur. Sandbox yoksa başlatma sunucuda reddedilir ve bu dürüstçe yazılır; ürünün doğrulandığı ya da çalıştığı varsayılmaz.
import {h,stateNote,badge,panel} from "../components.js";
import {drafts,statusBlock,recordPost,focusResult} from "../forms.js";
import {buildDevRunRequest,productOffer,flowPath,mapFlow} from "../project-core.js";
import {setTab} from "../studio-state.js";

export const PRODUCT_FORM="product-run";
const KEYS=["id:product-start","id:product-stop"];
const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
export async function productAction(ctx,project,action){
  const req=buildDevRunRequest({projectId:project.projectId,action});
  if(!req.ok){drafts.status[PRODUCT_FORM]={ok:false,key:"err.projectRequired",vars:{},errors:req.errors};await ctx.rerender();return {ok:false,validation:true}}
  if(action==="start"){
    const yes=await ctx.confirm({title:ctx.t("studio.run.confirm.title",{action:ctx.t("studio.run.start")}),body:ctx.t("studio.run.confirm.body"),action:ctx.t("studio.run.start"),target:`${project.name} (${project.projectId})`,confirmLabel:ctx.t("studio.run.start")});
    if(yes!==true){drafts.status[PRODUCT_FORM]={ok:false,key:"confirm.cancelled",vars:{},errors:null};await ctx.rerender();focusResult(ctx,PRODUCT_FORM,KEYS);return {ok:false,cancelled:true}}
  }
  drafts.busy[PRODUCT_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[PRODUCT_FORM]=false}
  const ok=recordPost(PRODUCT_FORM,res,`product.done.${action}`);
  await ctx.api.devrun(project.projectId,{force:true});
  await ctx.rerender();focusResult(ctx,PRODUCT_FORM,KEYS);return {ok,status:res?.status??null};
}
export async function productCard(ctx,project){
  const doc=ctx.doc,id="studio-ov-product";
  const [run,flowRes,exec]=await Promise.all([ctx.api.devrun(project.projectId),ctx.api.raw(flowPath(project.projectId)),ctx.api.executors()]);
  const lead=h(doc,"p",{class:"note",text:ctx.t("product.lead")});
  if(run.state!=="VERIFIED")return panel(ctx,{titleKey:"product.title",id},lead,stateNote(ctx,run.state,run.state==="UNAVAILABLE"?"product.unavailable":undefined));
  const flow=flowRes.ok?mapFlow(flowRes.data):{state:flowRes.state,flow:null},offer=productOffer(run.run,flow.state==="VERIFIED"?flow.flow:null);
  const r=run.run,sb=exec&&exec.state==="VERIFIED"&&exec.sandbox?exec.sandbox.state:null,busy=drafts.busy[PRODUCT_FORM]===true;
  const body=[
    h(doc,"p",{},badge(ctx,ctx.t(`devrun.state.${r.status}`),r.status==="RUNNING"?"badge-ok":r.status==="STOPPED"?"":"badge-risk"),
      r.status==="RUNNING"&&!offer.open?h(doc,"span",{class:"note",text:` ${ctx.t("product.noUrl")}`}):null),
    offer.open?h(doc,"p",{dataset:{productUrl:r.preview.url}},ctx.t("product.url")+": ",h(doc,"code",{class:"mono",text:r.preview.url})):null,
    r.reason&&(r.status==="BLOCKED"||r.status==="CRASHED")?h(doc,"p",{class:"note",dataset:{productReason:r.reason},text:tOr(ctx,`product.reason.${r.reason}`,`${r.reason} (${ctx.t("product.unrecognised")})`)}):null,
    flow.state!=="VERIFIED"?h(doc,"p",{class:"note",dataset:{productDelivery:"UNKNOWN"},text:ctx.t("product.deliveryUnknown")}):
      !offer.deliveryDone?h(doc,"p",{class:"note",dataset:{productDelivery:"NOT_DONE"},text:ctx.t("product.notDelivered")}):null,
    h(doc,"p",{class:"note",dataset:{productSandbox:sb??"UNKNOWN"},text:ctx.t(sb==="AVAILABLE"?"product.sandbox.AVAILABLE":sb==="UNAVAILABLE"?"product.sandbox.UNAVAILABLE":"product.sandbox.UNKNOWN")}),
    h(doc,"div",{class:"btn-row"},
      offer.start?h(doc,"button",{type:"button",class:"btn btn-primary",id:"product-start",dataset:{focusKey:"product-start"},disabled:busy,text:ctx.t("product.start"),on:{click:()=>{productAction(ctx,project,"start")}}}):null,
      offer.stop?h(doc,"button",{type:"button",class:"btn btn-danger",id:"product-stop",dataset:{focusKey:"product-stop"},disabled:busy,text:ctx.t("product.stop"),on:{click:()=>{productAction(ctx,project,"stop")}}}):null,
      h(doc,"button",{type:"button",class:"btn",id:"product-open-run",dataset:{focusKey:"product-open-run"},text:ctx.t("product.openRunTab"),on:{click:async()=>{setTab("run");await ctx.rerender()}}})),
    statusBlock(ctx,PRODUCT_FORM),
    h(doc,"p",{class:"note",text:ctx.t("product.note")})];
  const card=panel(ctx,{titleKey:"product.title",id},lead,...body);
  card.dataset.productState=r.status;card.dataset.productOffer=offer.start?"START":offer.stop?"STOP":"NONE";
  return card;
}
