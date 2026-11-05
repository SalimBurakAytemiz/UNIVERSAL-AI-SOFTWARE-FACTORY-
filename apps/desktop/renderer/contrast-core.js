// //TR: Bu modül Ayarlar > Tema kontrast laboratuvarının saf (DOM'suz) çekirdeğidir (PQ-004): WCAG 2.x göreli parlaklık ve kontrast oranını, stil sayfasındaki token DEĞERLERİNDEN hesaplar (elle yazılmış oran yoktur); var(--x) takma adlarını çözer, opak olmayan/çözülemeyen renkler için oran UYDURMAZ (UNKNOWN). Saklama, POST veya yeni uç nokta yoktur.
const HEX_RE=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VAR_RE=/^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;
/** Token çiftleri: [anahtar, ön plan token'ı, arka plan token'ı, tür]; tür "text" ise AA 4.5 / AAA 7, "ui" ise (bileşen kenarı) AA 3. */
export const CONTRAST_PAIRS=Object.freeze([
  ["text-bg","--text","--bg","text"],["text-surface","--text","--surface","text"],["text-surface-2","--text","--surface-2","text"],
  ["muted-bg","--muted","--bg","text"],["muted-surface","--muted","--surface","text"],
  ["accent-surface","--accent","--surface","text"],["ok-surface","--ok","--surface","text"],["warn-surface","--warn","--surface","text"],["danger-surface","--danger","--surface","text"],
  ["on-accent-accent","--on-accent","--accent","text"],["on-danger-danger-bg","--on-danger","--danger-bg","text"],
  ["border-ui-surface","--border-ui","--surface","ui"],["focus-surface","--focus","--surface","ui"],
  // //TR: FD 2026-11-05 tasarım sistemi: birincil (kırmızı) eylem durumları, bağlantı ve odak halkası en koyu/en açık zeminlerde.
  ["muted-surface-2","--muted","--surface-2","text"],["accent-bg","--accent","--bg","text"],["accent-surface-2","--accent","--surface-2","text"],["danger-surface-2","--danger","--surface-2","text"],
  ["on-primary-primary","--on-primary","--primary","text"],["on-primary-primary-hover","--on-primary","--primary-hover","text"],["on-primary-primary-active","--on-primary","--primary-active","text"],
  ["on-danger-danger-bg-active","--on-danger","--danger-bg-active","text"],["link-surface","--link","--surface","text"],
  ["border-ui-surface-2","--border-ui","--surface-2","ui"],["focus-bg","--focus","--bg","ui"],["focus-surface-2","--focus","--surface-2","ui"],["primary-bg","--primary","--bg","ui"]
].map(p=>Object.freeze(p)));
/** //TR: Tasarım sistemi token grupları (FD 2026-11-05): stil sayfası :root bloğu bu adların HEPSİNİ tanımlamalıdır; eksik varsa missingDesignTokens listeler. */
export const DESIGN_TOKEN_GROUPS=Object.freeze({
  color:Object.freeze(["--bg","--bg-2","--surface","--surface-2","--border","--border-ui","--text","--muted","--emphasis","--link","--link-hover","--accent","--accent-2","--on-accent","--primary","--primary-hover","--primary-active","--on-primary","--danger","--danger-bg","--danger-bg-active","--danger-border","--on-danger","--ok","--warn","--purple","--focus"]),
  spacing:Object.freeze(["--space-1","--space-2","--space-3","--space-4","--space-5","--space-6","--space-8","--space-10","--space-12","--space-16"]),
  type:Object.freeze(["--font-ui","--font-mono","--fs-caption","--fs-label","--fs-body","--fs-h3","--fs-h2","--fs-kpi-sm","--fs-kpi","--fs-title","--lh-tight","--lh-body","--fw-regular","--fw-medium","--fw-bold","--fw-heavy"]),
  radius:Object.freeze(["--radius-sm","--radius-md","--radius-lg","--radius-xl","--radius-pill","--radius"]),
  elevation:Object.freeze(["--elev-0","--elev-1","--elev-2","--elev-3"]),
  focus:Object.freeze(["--focus","--focus-ring-width","--focus-ring-offset","--focus-ring"]),
  control:Object.freeze(["--control-h","--control-h-sm","--control-pad-x"]),
  motion:Object.freeze(["--motion-hover","--motion-panel","--motion-screen"]),
  breakpoint:Object.freeze(["--bp-ultra","--bp-wide","--bp-medium","--bp-narrow","--bp-zoom","--bp-compact"])
});
/** Token haritasında tanımlı olmayan (boş/eksik) tasarım sistemi token adları; tam set için boş dizi. */
export function missingDesignTokens(tokens){
  return Object.values(DESIGN_TOKEN_GROUPS).flat().filter(n=>typeof tokens?.[n]!=="string"||!tokens[n].trim());
}
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
