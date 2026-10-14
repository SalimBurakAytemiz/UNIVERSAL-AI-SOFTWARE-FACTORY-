// //TR: Bu modül sol navigasyonu ve sağ akış sekmelerini yerinde (in-place) günceller: düğümler bir kez kurulur, yenilemede yalnız aria-current, etiket, sayaç ve aria-selected değişir; böylece odaklı bağlantı/sekme periyodik yenilemede veya dil değişiminde <body>'ye düşmez.
/** Sol navigasyon listesini kurar (ilk çağrıda) ve her çağrıda yerinde günceller; route öğeleri kararlı kalır. */
export function syncNav(doc,list,routes,{currentId,counts,labelOf,countLabel,makeIcon}){
  const built=list.children.length===routes.length&&routes.every((r,i)=>list.children[i].dataset?.route===r.id);
  if(!built){
    list.replaceChildren(...routes.map(r=>{
      const li=doc.createElement("li"),a=doc.createElement("a"),ic=doc.createElement("span"),lab=doc.createElement("span"),cnt=doc.createElement("span");
      li.dataset.route=r.id;li.className=r.id==="company"?"nav-sep":"";
      a.className="nav-link";a.setAttribute("href",r.hash);a.dataset.route=r.id;
      ic.className="nav-icon";if(makeIcon)ic.append(makeIcon(r));lab.className="nav-label";cnt.className="nav-count";cnt.hidden=true;
      a.append(ic,lab,cnt);li.append(a);return li;
    }));
  }
  routes.forEach((r,i)=>{
    const a=list.children[i].children[0],kids=a.children,lab=kids[1],cnt=kids[2],n=counts?.[r.id],label=labelOf(r);
    a.setAttribute("title",label);if(lab.textContent!==label)lab.textContent=label;
    if(r.id===currentId)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
    if(Number.isSafeInteger(n)&&n>0){cnt.textContent=String(n);cnt.setAttribute("aria-label",countLabel(n));cnt.hidden=false}
    else{cnt.textContent="";cnt.removeAttribute("aria-label");cnt.hidden=true}
  });
}
/** Sağ akış sekme listesini kurar (ilk çağrıda) ve yerinde günceller; onSelect(key,{viaKey}) shell'e bildirir. */
export function syncTabs(doc,tablist,keys,{selected,ariaLabel,labelOf,onSelect}){
  const built=tablist.children.length===keys.length&&keys.every((k,i)=>tablist.children[i].dataset?.tab===k);
  if(!built){
    tablist.setAttribute("role","tablist");tablist.className="tabs";
    tablist.replaceChildren(...keys.map(k=>{
      const b=doc.createElement("button");b.setAttribute("type","button");b.setAttribute("role","tab");b.setAttribute("id",`feedTab-${k}`);b.setAttribute("aria-controls","feedPanel");b.dataset.tab=k;
      b.addEventListener("click",()=>onSelect(k,{viaKey:false}));
      b.addEventListener("keydown",e=>{const i=keys.indexOf(k),d=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;if(d){e.preventDefault();onSelect(keys[(i+d+keys.length)%keys.length],{viaKey:true})}});
      return b;
    }));
  }
  tablist.setAttribute("aria-label",ariaLabel);
  keys.forEach((k,i)=>{
    const b=tablist.children[i],label=labelOf(k);
    b.setAttribute("aria-selected",selected===k?"true":"false");b.setAttribute("tabindex",selected===k?"0":"-1");if(b.textContent!==label)b.textContent=label;
  });
}
