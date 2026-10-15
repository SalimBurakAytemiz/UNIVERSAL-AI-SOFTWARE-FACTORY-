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
/** Kayıtlı anahtara sahip öğeye odağı geri verir; odak gerçekten o öğeye taşındıysa true, öğe yoksa veya odaklanamıyorsa (devre dışı, display:none, ör. boş .form-status) false. Zaten odaklıysa dokunmaz. */
export function restoreFocus(doc,container,key){
  if(!key)return false;
  const all=container.querySelectorAll("[id],[data-focus-key],[data-kpi],[data-retry],[data-mission-id]");
  for(const n of all){
    if(focusKey(n)!==key||n.disabled===true)continue;
    if(takeFocus(doc,n))return true;
  }
  return false;
}
/** Odak gövdeye (veya hiçbir yere) düştüyse true. */
export function focusLost(doc){const a=doc.activeElement;return !a||a===doc.body||a===doc.documentElement}
/** focus() odaklanamayan öğede (devre dışı, display:none — ör. boş .form-status — veya tabindex'siz kap) sessizce hiçbir şey yapmaz; odak ancak activeElement ile doğrulanınca kabul edilir, aksi halde null döner ve çağıran sıradaki adaya geçer (PS1B-C4-001). */
function takeFocus(doc,n){
  if(doc.activeElement!==n){try{n.focus({preventScroll:true})}catch{try{n.focus()}catch{/* odaklanamadı */}}}
  return doc.activeElement===n?n:null;
}
/** Bir eylem veya yeniden çizimden sonra odağı belirlenimci biçimde yerleştirir, asla gövdeye bırakmaz: (1) odak container içinde canlı ve etkin bir öğede ise dokunmaz; (2) sırayla `keys` (focusKey biçiminde, ör. "id:x") içinden odağı gerçekten alan ilk öğe; (3) container içindeki odağı alan ilk `data-focus-first` öğesi; (4) `#view-title`. Odaklanamayan aday (devre dışı, gizli, boş durum bloğu) atlanır ve sıradakine geçilir. Odaklanan öğeyi döndürür, hiçbiri yoksa null. */
export function settleFocus(doc,container,{keys=[]}={}){
  const a=doc.activeElement,onTitle=Boolean(a)&&a.id==="view-title";
  if(a&&a!==doc.body&&a!==container&&container.contains(a)&&a.disabled!==true&&a.isConnected!==false&&!onTitle)return a;
  const all=container.querySelectorAll("[id],[data-focus-key],[data-kpi],[data-retry],[data-mission-id],[data-focus-first]");
  const tryNode=n=>n.disabled===true?null:takeFocus(doc,n);
  for(const key of keys){
    if(!key)continue;
    for(const n of all){if(focusKey(n)===key){const got=tryNode(n);if(got)return got}}
  }
  for(const n of all){if(n.dataset?.focusFirst){const got=tryNode(n);if(got)return got}}
  if(onTitle)return a;
  for(const n of all){if(n.id==="view-title"){const got=tryNode(n);if(got)return got}}
  return null;
}
/** fn() container içeriğini yeniden kurar; çalışmadan önce odak anahtarı kaydedilir, sonra geri verilir. */
export function keepFocus(doc,container,fn){
  const key=captureFocus(doc,container),result=fn();restoreFocus(doc,container,key);return result;
}
