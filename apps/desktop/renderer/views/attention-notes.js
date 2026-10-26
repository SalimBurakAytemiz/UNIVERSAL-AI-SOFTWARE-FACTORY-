// //TR: Bu küçük görünüm parçası Founder dikkat kuyruğunun "kesildi" ve "okunamayan öğe" notlarını üretir (Gelen Kutusu paneli ve Control Tower aynı notları kullanır); sayılar sunucunun sayaçlarıdır, öğe uydurulmaz.
import {h} from "../components.js";
import {formatCount} from "../model.js";

/** q: attention.queue ({items,total,truncated,dropped}); en çok iki not düğümü döner (boş dizi olabilir). */
export function attentionNotes(ctx,q){
  const doc=ctx.doc;
  if(!q)return [];
  return [
    q.truncated?h(doc,"p",{class:"note",dataset:{attentionTruncated:"1"},text:ctx.t("attention.truncated",{shown:formatCount(q.items.length),total:formatCount(q.total)})}):null,
    q.dropped>0?h(doc,"p",{class:"note",dataset:{attentionDropped:String(q.dropped)},text:ctx.t("attention.dropped",{n:formatCount(q.dropped)})}):null
  ].filter(Boolean);
}
