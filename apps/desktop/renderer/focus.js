// //TR: Bu modül renderer'ın periyodik yenileme sırasında klavye/ekran okuyucu odağını korumasını sağlar: odaklı öğenin kararlı anahtarını (id, data-focus-key, data-kpi, data-retry, data-mission-id) kaydeder, alt ağaç yeniden kurulunca aynı anahtarlı öğeye odağı geri verir; yalnız DOM okur/odak taşır, veriyi HTML olarak yorumlamaz.
const INTERACTIVE_TAGS=new Set(["BUTTON","A","INPUT","SELECT","TEXTAREA","SUMMARY","PRE","OPTION"]);

/** Öğenin kararlı odak anahtarı; yoksa null (geri verilemez). */
export function focusKey(el){
  if(!el)return null;
  if(typeof el.id==="string"&&el.id)return `id:${el.id}`;
  const d=el.dataset??{};
  if(d.focusKey)return `fk:${d.focusKey}`;
  if(d.kpi)return `kpi:${d.kpi}`;
  if(d.retry)return `retry:${d.retry}`;
  if(d.missionId)return `mission:${d.missionId}`;
  return null;
}
/** Odak kullanıcı girdisi veya okuma denetimi üzerindeyse (düğme, bağlantı, alan, log) ana görünüm yeniden kurulmamalıdır. */
export function isInteractive(el){
  if(!el)return false;
  if(INTERACTIVE_TAGS.has(String(el.tagName??"").toUpperCase()))return true;
  return el.isContentEditable===true;
}
/** container içindeki odaklı öğenin anahtarını döndürür; odak dışarıdaysa veya container'ın kendisindeyse null. */
export function captureFocus(doc,container){
  const a=doc.activeElement;if(!a||a===container||!container.contains(a))return null;
  return focusKey(a);
}
/** Kayıtlı anahtara sahip öğeye odağı geri verir; öğe yoksa false. Zaten odaklıysa dokunmaz. */
export function restoreFocus(doc,container,key){
  if(!key)return false;
  const all=container.querySelectorAll("[id],[data-focus-key],[data-kpi],[data-retry],[data-mission-id]");
  for(const n of all){
    if(focusKey(n)!==key)continue;
    if(doc.activeElement!==n){try{n.focus({preventScroll:true})}catch{n.focus()}}
    return true;
  }
  return false;
}
/** fn() container içeriğini yeniden kurar; çalışmadan önce odak anahtarı kaydedilir, sonra geri verilir. */
export function keepFocus(doc,container,fn){
  const key=captureFocus(doc,container),result=fn();restoreFocus(doc,container,key);return result;
}
