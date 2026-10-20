// //TR: Bu modül Resume (global durdurmayı kaldırma) için ortak onay yardımcısıdır: shell durdurma bandı ve Control Tower aynı yolu kullanır; ctx.confirm true dönmeden ctx.resume çağrılmaz, ctx.confirm yoksa kapalı-güvenli davranır ve bekleyen onay varken ikinci tıklama yok sayılır.
const pending=new WeakSet();
export async function confirmAndResume(ctx,{onCancel}={}){
  if(pending.has(ctx))return {ok:false,busy:true};
  pending.add(ctx);
  try{
    let yes=false;
    if(typeof ctx.confirm==="function"){
      yes=(await ctx.confirm({title:ctx.t("resume.confirm.title"),body:ctx.t("resume.confirm.body"),action:ctx.t("resume.confirm.action"),target:ctx.t("resume.confirm.target"),confirmLabel:ctx.t("resume.confirm.ok")}))===true;
    }
    if(!yes){if(typeof onCancel==="function")onCancel(ctx.t("confirm.cancelled"));return {ok:false,cancelled:true}}
    await ctx.resume();
    return {ok:true};
  }finally{pending.delete(ctx)}
}
