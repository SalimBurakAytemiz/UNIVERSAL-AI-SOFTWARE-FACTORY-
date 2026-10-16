// //TR: Bu modül hash tabanlı yönlendirme tablosunu tanımlar: sol navigasyondaki 8 Factory alanı sabit sırada, ardından Company OS ve Ayarlar (B5: Güvence ve Gelen Kutusu artık gerçek görünümdür); her alanın route id'si, başlığı ve ya gerçek görünümü ya da planlı paketi (dürüst "henüz uygulanmadı" paneli) vardır.
// //TR: UX WP3: Company OS artık gerçek görünümdür (views/company.js, GET /v1/company/*); app.js (korumalı) görünümleri VIEWS tablosundan sabit anahtarla seçtiği için rota "planned" ev sahibi modülüne bağlı kalır ve views/planned.js `component` alanı olan rotayı gerçek görünüme devreder; plannedPackage yoktur.
// //TR: UX WP-DELIVERY: Teslimat & SRE artık gerçek görünümdür (views/delivery.js, salt-okunur GET /health + /v1/control/status + /v1/founder-attention + /v1/work-runs); gerçek üretim deploy ve canlı SRE izleme Founder kapılı BLOCKED/NOT_CONNECTED olarak gösterilir, uptime/SLO/olay metriği uydurulmaz; rota WP3 Company OS ile aynı biçimde `component` ile devreder ve plannedPackage yoktur.
// //TR: UX WP-AGENTS: AI İş Gücü (workforce) artık canlı /v1/roles rol kataloğuna bağlı gerçek ve tam bir görünümdür; eski plannedPackage:"B3" (kısmi/planlı) etiketi kaldırıldı (app.js VIEWS değişmez).
// //TR: FA-V2-PRODUCT (WP-ACADEMY): Skill Academy (Öğrenme & Yetkinlik) alanı Company OS/Teslimat ile aynı desende `component:"academy"` ile planned.js üzerinden gerçek görünüme (views/academy.js, salt-okunur GET /v1/academy) devreder; app.js VIEWS değişmez, plannedPackage yoktur. Bu bir öğrenme/yetkinlik KATALOĞUDUR, sertifika/eğitim kanıtı değildir (öğrenme yetki vermez).
// Planlı paket numaraları yol haritası göstergesidir; tek yerde burada tutulur.
export const ROUTES=Object.freeze([
  {id:"home",hash:"#/home",icon:"home",factory:true,view:"home"},
  {id:"projects",hash:"#/projects",icon:"folder",factory:true,view:"projects"},
  {id:"work",hash:"#/work",icon:"tasks",factory:true,view:"work"},
  {id:"workforce",hash:"#/workforce",icon:"bot",factory:true,view:"workforce"},
  {id:"assurance",hash:"#/assurance",icon:"shield",factory:true,view:"assurance"},
  {id:"delivery",hash:"#/delivery",icon:"rocket",factory:true,view:"planned",component:"delivery"},
  {id:"tower",hash:"#/tower",icon:"tower",factory:true,view:"tower"},
  {id:"inbox",hash:"#/inbox",icon:"inbox",factory:true,view:"inbox"},
  {id:"company",hash:"#/company",icon:"building",factory:false,view:"planned",component:"company"},
  {id:"academy",hash:"#/academy",icon:"layers",factory:false,view:"planned",component:"academy"},
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
