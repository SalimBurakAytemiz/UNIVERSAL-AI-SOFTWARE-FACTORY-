// //TR: Bu görünüm parçası Proje Studio Genel Bakış'taki "Çalışan ürün" kartıdır (teslimden sonra) ve B-RUN-1 sözleşmesine bağlıdır: durum GET /v1/work-runs/:id/product, başlat/durdur POST .../product/start|stop (boş gövde). Ürün YALNIZ doğrulanmış sandbox sağlayıcısında tek bir köprülü portla çalışır; sunucu reddederse (DEVRUN_SANDBOX_UNAVAILABLE + kesin neden) neden aynen gösterilir ve "ana makinede yine de çalıştır" yolu YOKTUR. Yerel adres YALNIZ bu teslime bağlı, RUNNING, bridged=true ve önizleme AVAILABLE iken gösterilir. Uç nokta masaüstü allow-list'inde yoksa dürüst UNAVAILABLE gösterilir; ürünün çalıştığı ya da doğrulandığı hiçbir koşulda varsayılmaz.
import {h,stateNote,badge,panel} from "../components.js";
import {drafts,statusBlock,recordPost,focusResult} from "../forms.js";
import {buildProductRequest,productOffer} from "../project-core.js";
import {setTab} from "../studio-state.js";

export const PRODUCT_FORM="product-run";
const KEYS=["id:product-start","id:product-stop"];
const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};
/** "KOD" ya da "KOD:ayrıntı": önek çevrilir, ayrıntı ham kalır; bilinmeyen önek ham ve "tanınmadı" notuyla gösterilir. */
export function reasonText(ctx,reason){
  const i=reason.indexOf(":"),head=i<0?reason:reason.slice(0,i),detail=i<0?null:reason.slice(i+1);
  const v=tOr(ctx,`product.reason.${head}`,null);
  if(v===null)return `${reason} (${ctx.t("product.unrecognised")})`;
  if(detail===null)return v;
  const d0=detail.indexOf(":"),dh=d0<0?detail:detail.slice(0,d0),dv=tOr(ctx,`product.detail.${dh}`,null);
  return dv===null?`${v} (${detail})`:`${v} ${dv} (${detail})`;
}
export async function productAction(ctx,project,runId,action){
  const req=buildProductRequest({runId,action});
  if(!req.ok){drafts.status[PRODUCT_FORM]={ok:false,key:"err.runInvalid",vars:{},errors:req.errors};await ctx.rerender();return {ok:false,validation:true}}
  if(action==="start"){
    const yes=await ctx.confirm({title:ctx.t("product.confirm.title"),body:ctx.t("product.confirm.body"),action:ctx.t("product.start"),target:`${project.name} (${runId})`,confirmLabel:ctx.t("product.start")});
    if(yes!==true){drafts.status[PRODUCT_FORM]={ok:false,key:"confirm.cancelled",vars:{},errors:null};await ctx.rerender();focusResult(ctx,PRODUCT_FORM,KEYS);return {ok:false,cancelled:true}}
  }
  drafts.busy[PRODUCT_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[PRODUCT_FORM]=false}
  const ok=recordPost(PRODUCT_FORM,res,`product.done.${action}`);
  await ctx.api.runProduct(runId,{force:true});
  await ctx.rerender();focusResult(ctx,PRODUCT_FORM,KEYS);return {ok,status:res?.status??null};
}
/** run: projenin en son koşusu (ya da null); runsState: koşu/mission okumasının durumu — "VERIFIED" dışındaysa kart "koşu yok" DEMEZ, okuma durumunu gösterir. */
export async function productCard(ctx,project,run,runsState="VERIFIED"){
  const doc=ctx.doc,id="studio-ov-product",lead=h(doc,"p",{class:"note",text:ctx.t("product.lead")});
  if(runsState!=="VERIFIED")return panel(ctx,{titleKey:"product.title",id},lead,stateNote(ctx,runsState,runsState==="UNAVAILABLE"?"product.runsUnavailable":undefined),h(doc,"p",{class:"note",dataset:{productDelivery:"RUNS_"+runsState},text:ctx.t("product.runsUnknown")}));
  if(!run)return panel(ctx,{titleKey:"product.title",id},lead,h(doc,"p",{class:"note",dataset:{productDelivery:"NO_RUN"},text:ctx.t("product.noRun")}));
  const [prod,detail,exec]=await Promise.all([ctx.api.runProduct(run.runId),ctx.api.workRunDetail(run.runId),ctx.api.executors()]);
  if(prod.state!=="VERIFIED")return panel(ctx,{titleKey:"product.title",id},lead,stateNote(ctx,prod.state,prod.state==="UNAVAILABLE"?"product.unavailable":undefined),
    // Okuma yoksa bile Founder'ın yapabileceği tek şey: proje çalıştır sekmesi (aynı doğrulanmış sandbox kapısı sunucuda geçerli).
    h(doc,"p",{class:"note",dataset:{productNext:"RUN_TAB"},text:ctx.t("product.next.runTab")}),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"product-open-run",dataset:{focusKey:"product-open-run"},text:ctx.t("product.openRunTab"),on:{click:async()=>{setTab("run");await ctx.rerender()}}})));
  const p=prod.product,r=p.run,offer=productOffer(p,detail.state==="VERIFIED"&&detail.run?detail.run.delivery:null);
  const sb=exec&&exec.state==="VERIFIED"&&exec.sandbox?exec.sandbox.state:null,busy=drafts.busy[PRODUCT_FORM]===true;
  const sgState=detail.state==="VERIFIED"&&detail.run&&detail.run.delivery?detail.run.delivery.sourceGeneration.state:null;
  const body=[
    h(doc,"p",{},badge(ctx,ctx.t(`devrun.state.${r.status}`),r.status==="RUNNING"&&p.tiedToThisRun?"badge-ok":r.status==="STOPPED"?"":"badge-risk"),
      r.status==="RUNNING"&&p.tiedToThisRun&&!offer.open?h(doc,"span",{class:"note",text:` ${ctx.t(r.bridged===true?"product.noUrl":"product.notBridged")}`}):null),
    offer.open?h(doc,"p",{dataset:{productUrl:r.preview.url}},ctx.t("product.url")+": ",h(doc,"code",{class:"mono",text:r.preview.url})):null,
    offer.otherRunning?h(doc,"p",{class:"note",dataset:{productOther:"1"},text:ctx.t("product.otherRunning")}):null,
    r.reason&&(r.status==="BLOCKED"||r.status==="CRASHED")?h(doc,"p",{class:"note",dataset:{productReason:r.reason},text:reasonText(ctx,r.reason)}):null,
    p.deliveredHeadSha===null?h(doc,"p",{class:"note",dataset:{productCommit:"NONE"},text:ctx.t("product.noCommit")}):null,
    // Başlatılabilirlik B-RUN-1'in kendi koşuludur (kaynak üretimi tamam + teslim commit'i); DELIVERY aşaması DONE (=PRODUCT_VERIFIED) beklenmez.
    offer.deliverable===null?h(doc,"p",{class:"note",dataset:{productDelivery:"UNKNOWN"},text:ctx.t("product.deliveryUnknown")}):
      offer.deliverable===false?h(doc,"p",{class:"note",dataset:{productDelivery:"NOT_DELIVERABLE"},text:ctx.t("product.notDeliverable",{why:p.deliverable&&p.deliverable.reason?p.deliverable.reason:(sgState??"NO_DELIVERED_COMMIT")})}):null,
    h(doc,"p",{class:"note",dataset:{productSandbox:sb??"UNKNOWN"},text:ctx.t(sb==="AVAILABLE"?"product.sandbox.AVAILABLE":sb==="UNAVAILABLE"?"product.sandbox.UNAVAILABLE":"product.sandbox.UNKNOWN")}),
    h(doc,"div",{class:"btn-row"},
      offer.start?h(doc,"button",{type:"button",class:"btn btn-primary",id:"product-start",dataset:{focusKey:"product-start"},disabled:busy,text:ctx.t("product.start"),on:{click:()=>{productAction(ctx,project,run.runId,"start")}}}):null,
      offer.stop?h(doc,"button",{type:"button",class:"btn btn-danger",id:"product-stop",dataset:{focusKey:"product-stop"},disabled:busy,text:ctx.t("product.stop"),on:{click:()=>{productAction(ctx,project,run.runId,"stop")}}}):null,
      h(doc,"button",{type:"button",class:"btn",id:"product-open-run",dataset:{focusKey:"product-open-run"},text:ctx.t("product.openRunTab"),on:{click:async()=>{setTab("run");await ctx.rerender()}}})),
    statusBlock(ctx,PRODUCT_FORM),
    h(doc,"p",{class:"note",text:ctx.t("product.note")})];
  const card=panel(ctx,{titleKey:"product.title",id},lead,...body);
  card.dataset.productState=r.status;card.dataset.productOffer=offer.start?"START":offer.stop?"STOP":"NONE";card.dataset.productRun=run.runId;
  return card;
}
