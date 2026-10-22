// //TR: Bu modül Ayarlar > Tema kontrast laboratuvarının saf (DOM'suz) çekirdeğidir (PQ-004): WCAG 2.x göreli parlaklık ve kontrast oranını, stil sayfasındaki token DEĞERLERİNDEN hesaplar (elle yazılmış oran yoktur); var(--x) takma adlarını çözer, opak olmayan/çözülemeyen renkler için oran UYDURMAZ (UNKNOWN). Saklama, POST veya yeni uç nokta yoktur.
const HEX_RE=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VAR_RE=/^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
/** Token çiftleri: [anahtar, ön plan token'ı, arka plan token'ı, tür]; tür "text" ise AA 4.5 / AAA 7, "ui" ise (bileşen kenarı) AA 3. */
export const CONTRAST_PAIRS=Object.freeze([
  ["text-bg","--text","--bg","text"],["text-surface","--text","--surface","text"],["text-surface-2","--text","--surface-2","text"],
  ["muted-bg","--muted","--bg","text"],["muted-surface","--muted","--surface","text"],
  ["accent-surface","--accent","--surface","text"],["ok-surface","--ok","--surface","text"],["warn-surface","--warn","--surface","text"],["danger-surface","--danger","--surface","text"],
  ["on-accent-accent","--on-accent","--accent","text"],["on-danger-danger-bg","--on-danger","--danger-bg","text"],
  ["border-ui-surface","--border-ui","--surface","ui"],["focus-surface","--focus","--surface","ui"]
].map(p=>Object.freeze(p)));
export const CONTRAST_TOKENS=Object.freeze([...new Set(CONTRAST_PAIRS.flatMap(p=>[p[1],p[2]]))]);

/** Yalnız opak #rgb/#rrggbb ayrıştırılır; diğer biçimler (rgba, adlı renk) null: oran uydurulmaz. */
export function parseHex(v){
  const m=HEX_RE.exec(String(v??"").trim());if(!m)return null;
  let h=m[1];if(h.length===3)h=[...h].map(c=>c+c).join("");
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
}
const lin=c=>{const s=c/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4};
export const luminance=rgb=>0.2126*lin(rgb[0])+0.7152*lin(rgb[1])+0.0722*lin(rgb[2]);
export function contrastRatio(a,b){
  const x=luminance(a),y=luminance(b),hi=Math.max(x,y),lo=Math.min(x,y);
  return (hi+0.05)/(lo+0.05);
}
/** var(--x) zincirini (en çok 8 adım, döngü korumalı) token haritasında çözer; çözülemezse null. */
export function resolveToken(tokens,name){
  let v=tokens?.[name];
  for(let i=0;i<8&&typeof v==="string";i++){
    const m=VAR_RE.exec(v.trim());if(!m)return v.trim();
    v=tokens[m[1]];
  }
  return null;
}
/** Düzey: text için AAA>=7, AA>=4.5; ui için AA>=3; altı FAIL. Oran yoksa UNKNOWN. */
export function gradeContrast(ratio,kind){
  if(!Number.isFinite(ratio))return "UNKNOWN";
  if(kind==="text")return ratio>=7?"AAA":ratio>=4.5?"AA":"FAIL";
  return ratio>=3?"AA":"FAIL";
}
/** Token haritasından satırlar; ratio 2 ondalıkla gösterilir ama sınıflama tam değerle yapılır. */
export function computeContrastRows(tokens){
  return CONTRAST_PAIRS.map(([key,fg,bg,kind])=>{
    const f=parseHex(resolveToken(tokens,fg)),b=parseHex(resolveToken(tokens,bg));
    const ratio=f&&b?contrastRatio(f,b):null;
    return {key,fg,bg,kind,fgValue:f?resolveToken(tokens,fg):null,bgValue:b?resolveToken(tokens,bg):null,ratio,level:gradeContrast(ratio??NaN,kind)};
  });
}
/** Çalışan sayfanın hesaplanmış stilinden token değerlerini okur (stil sayfasının gerçek değerleri); okunamazsa boş harita (tüm satırlar UNKNOWN). */
export function readTokens(doc){
  const out={};
  try{
    const cs=doc?.defaultView?.getComputedStyle?.(doc.documentElement);
    if(cs&&typeof cs.getPropertyValue==="function")for(const n of CONTRAST_TOKENS){const v=cs.getPropertyValue(n);if(typeof v==="string"&&v.trim())out[n]=v.trim()}
  }catch{/* okunamadı: UNKNOWN */}
  return out;
}
