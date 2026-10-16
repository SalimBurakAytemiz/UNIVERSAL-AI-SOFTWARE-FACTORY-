// //TR: Bu modül navigasyon/KPI ikonlarını createElementNS ile SVG olarak üretir (inline script/style yok, CSP uyumlu); ikonlar süslemedir ve ekran okuyuculardan gizlenir.
const NS="http://www.w3.org/2000/svg";
const PATHS=Object.freeze({
  home:"M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z",
  folder:"M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  tasks:"M9 6h11M9 12h11M9 18h11M3.5 6l1.5 1.5L7 5M3.5 12l1.5 1.5L7 11M3.5 18l1.5 1.5L7 17",
  bot:"M12 3v3M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM9 13h.01M15 13h.01M9 17h6",
  shield:"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  rocket:"M12 2c4 2 6 6 6 10l-3 3H9l-3-3c0-4 2-8 6-10zM9 15l-2 5 5-2 5 2-2-5M12 9h.01",
  tower:"M12 3v18M8 21h8M7 8a7 7 0 0 1 10 0M4.5 5.5a11 11 0 0 1 15 0M9.5 11a3.5 3.5 0 0 1 5 0",
  inbox:"M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1 3h6l1-3h5",
  building:"M4 21V5l8-2v18M12 9l8 2v10M2 21h20M8 9h.01M8 13h.01M8 17h.01M16 15h.01M16 18h.01",
  gear:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  search:"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  bell:"M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8zM10 21h4",
  alert:"M12 3l10 18H2zM12 10v5M12 18h.01",
  clock:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  check:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6",
  users:"M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 1 0 0-6M21 20c0-2.5-1.5-4-4-4.5",
  stop:"M8 3h8l5 5v8l-5 5H8l-5-5V8zM12 8v5M12 16h.01",
  user:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  layers:"M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  xcircle:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6",
  ban:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  lock:"M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  plug:"M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5M3 3l18 18",
  wifioff:"M2 8.8a15 15 0 0 1 4-2.3M22 8.8a15 15 0 0 0-10-3.8M5 12.9a10 10 0 0 1 5-2.6M19 12.9a10 10 0 0 0-3-2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18",
  help:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  minuscircle:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8",
  dashedcircle:"M12 3a9 9 0 0 1 3 .5M19.5 9A9 9 0 0 1 21 12M20 16a9 9 0 0 1-2.2 3.5M14 20.5A9 9 0 0 1 12 21M8 20a9 9 0 0 1-3-3M3.5 14A9 9 0 0 1 3 12M4.5 8A9 9 0 0 1 7 5",
  pulse:"M3 12h4l2-6 4 12 2-6h6",
  arrowup:"M12 19V5M6 11l6-6 6 6",
  arrowdown:"M12 5v14M6 13l6 6 6-6",
  minus:"M5 12h14",
  evidence:"M6 3h8l4 4v14H6zM14 3v4h4M9 14l2 2 4-4",
  chevron:"M9 6l6 6-6 6",
  receipt:"M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  contract:"M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h3",
  funnel:"M3 4h18l-7 8v6l-4 2v-8z"
});
export const ICON_NAMES=Object.freeze(Object.keys(PATHS));
export function icon(doc,name,size=20){
  const svg=doc.createElementNS(NS,"svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("width",String(size));svg.setAttribute("height",String(size));
  svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.8");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");
  svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");svg.setAttribute("class","icon");
  const p=doc.createElementNS(NS,"path");p.setAttribute("d",PATHS[name]??PATHS.layers);svg.appendChild(p);return svg;
}
export function sparkline(doc,points,label){
  const svg=doc.createElementNS(NS,"svg");svg.setAttribute("viewBox","0 0 64 20");svg.setAttribute("class","spark");svg.setAttribute("role","img");svg.setAttribute("aria-label",label);
  const line=doc.createElementNS(NS,points?"polyline":"line");
  if(points){line.setAttribute("points",points);line.setAttribute("fill","none")}else{line.setAttribute("x1","0");line.setAttribute("y1","10");line.setAttribute("x2","64");line.setAttribute("y2","10");line.setAttribute("class","spark-empty")}
  svg.appendChild(line);return svg;
}
