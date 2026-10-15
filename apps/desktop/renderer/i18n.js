// //TR: Bu modül Türkçe varsayılan + İngilizce sözlüklerden çeviri yapar; dil seçimi localStorage'a try/catch ile yazılır, eksik anahtar Türkçe'ye düşer ve statik HTML data-i18n* öznitelikleri uygulanır.
import tr from "./locales/tr.js";
import en from "./locales/en.js";

export const DICTS=Object.freeze({tr,en});
export const LANGS=Object.freeze(["tr","en"]);
export const DEFAULT_LANG="tr";
export const LANG_STORAGE_KEY="uasco.lang";

export const normalizeLang=x=>x==="en"?"en":"tr";
export function readStoredLang(storage){try{return normalizeLang(storage?.getItem(LANG_STORAGE_KEY))}catch{return DEFAULT_LANG}}
export function storeLang(storage,lang){try{storage?.setItem(LANG_STORAGE_KEY,normalizeLang(lang));return true}catch{return false}}
export function translate(lang,key,vars){
  const dict=DICTS[normalizeLang(lang)],s=dict[key]??DICTS.tr[key]??key;
  return String(s).replace(/\{(\w+)\}/g,(m,k)=>vars&&Object.prototype.hasOwnProperty.call(vars,k)?String(vars[k]):m);
}
export function createI18n(storage){
  let lang=readStoredLang(storage);const listeners=new Set();
  const t=(key,vars)=>translate(lang,key,vars);
  return {
    t,get lang(){return lang},
    setLang(next){lang=normalizeLang(next);storeLang(storage,lang);for(const fn of listeners)fn(lang)},
    onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn)},
    applyStatic(root){
      const doc=root.ownerDocument??root;if(doc.documentElement)doc.documentElement.lang=lang;
      for(const n of root.querySelectorAll("[data-i18n]"))n.textContent=t(n.dataset.i18n);
      for(const [attr,ds] of [["aria-label","i18nAria"],["placeholder","i18nPlaceholder"],["title","i18nTitle"]])
        for(const n of root.querySelectorAll(`[data-i18n-${ds.slice(4).toLowerCase()}]`))n.setAttribute(attr,t(n.dataset[ds]));
      if(doc.title!==undefined)doc.title=t("app.title");
    }
  };
}
