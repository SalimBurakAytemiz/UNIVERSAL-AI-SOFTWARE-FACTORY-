// //TR: Bu modül Control Tower SVG/liste modüllerinin KAÇIŞLI işaretleme metnini HTML dizgesi enjekte etmeden DOM düğümlerine çevirir: yalnız izinli eleman/öznitelik adları kabul edilir (on*, style, href, src, xlink reddedilir), değerler setAttribute, metin createTextNode ile yazılır; tanınmayan veya dengesiz işaretlemede null döner (hiçbir şey çizilmez).
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "title", "desc", "defs", "radialGradient", "linearGradient", "stop", "filter", "feGaussianBlur", "feMerge", "feMergeNode", "g", "rect", "circle", "path", "line", "text", "animate"]);
const HTML_TAGS = new Set(["section", "p", "strong", "table", "caption", "thead", "tbody", "tr", "th", "td"]);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const unesc = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
const ATTR_OK = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR_DENY = /^(?:on|style$|href$|src$|xlink|srcdoc|xmlns)/i;
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*="[^"<>]*")*)\s*(\/?)>|([^<>]+)|(.)/gs;
const ATTR = /\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"/g;

/** markup -> DOM düğüm dizisi (kök(ler)); kökler tek bir <svg> veya <section> olur. Geçersizse null. */
export function markupToNodes(doc, markup) {
  const roots = [];
  const stack = [];
  const inSvg = () => stack.some((s) => s.svg);
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(String(markup))) !== null) {
    if (m[6] !== undefined) return null;
    if (m[5] !== undefined) {
      if (stack.length === 0) {
        if (m[5].trim() === "") continue;
        return null;
      }
      stack[stack.length - 1].el.append(doc.createTextNode(unesc(m[5])));
      continue;
    }
    const closing = m[1] === "/", name = m[2], selfClose = m[4] === "/";
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) return null;
      continue;
    }
    const svg = name === "svg" || inSvg();
    if (svg ? !SVG_TAGS.has(name) : !HTML_TAGS.has(name)) return null;
    const el = svg && typeof doc.createElementNS === "function" ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    ATTR.lastIndex = 0;
    let a;
    while ((a = ATTR.exec(m[3])) !== null) {
      if (!ATTR_OK.test(a[1]) || ATTR_DENY.test(a[1])) {
        if (/^xmlns$/i.test(a[1])) continue;
        return null;
      }
      el.setAttribute(a[1], unesc(a[2]));
    }
    if (stack.length === 0) roots.push(el);
    else stack[stack.length - 1].el.append(el);
    if (!selfClose) stack.push({ el, name, svg });
  }
  if (stack.length !== 0 || roots.length === 0) return null;
  return roots;
}
