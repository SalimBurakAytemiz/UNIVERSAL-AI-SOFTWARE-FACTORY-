// //TR: Bu modül hash tabanlı yönlendirme tablosunu tanımlar: sol navigasyondaki 8 Factory alanı sabit sırada, ardından Company OS ve Ayarlar (B5: Güvence ve Gelen Kutusu artık gerçek görünümdür); her alanın route id'si, başlığı ve ya gerçek görünümü ya da planlı paketi (dürüst "henüz uygulanmadı" paneli) vardır.
// Planlı paket numaraları yol haritası göstergesidir; tek yerde burada tutulur.
export const ROUTES=Object.freeze([
  {id:"home",hash:"#/home",icon:"home",factory:true,view:"home"},
  {id:"projects",hash:"#/projects",icon:"folder",factory:true,view:"projects"},
  {id:"work",hash:"#/work",icon:"tasks",factory:true,view:"work"},
  {id:"workforce",hash:"#/workforce",icon:"bot",factory:true,view:"workforce",plannedPackage:"B3"},
  {id:"assurance",hash:"#/assurance",icon:"shield",factory:true,view:"assurance"},
  {id:"delivery",hash:"#/delivery",icon:"rocket",factory:true,view:"planned",plannedPackage:"B6"},
  {id:"tower",hash:"#/tower",icon:"tower",factory:true,view:"tower"},
  {id:"inbox",hash:"#/inbox",icon:"inbox",factory:true,view:"inbox"},
  {id:"company",hash:"#/company",icon:"building",factory:false,view:"planned",plannedPackage:"B7"},
  {id:"settings",hash:"#/settings",icon:"gear",factory:false,view:"settings"}
]);
export const DEFAULT_ROUTE="home";
export const FACTORY_AREA_ORDER=Object.freeze(["home","projects","work","workforce","assurance","delivery","tower","inbox"]);
export const PLAN_ITEM_COUNT=3;
export const routeById=id=>ROUTES.find(r=>r.id===id)??null;
/** "#/projects" -> "projects"; bilinmeyen/boş hash varsayılan rotaya düşer. */
export function routeFromHash(hash){
  const m=/^#\/([a-z]+)\/?$/.exec(String(hash??""));const r=m?routeById(m[1]):null;return r?r.id:DEFAULT_ROUTE;
}
