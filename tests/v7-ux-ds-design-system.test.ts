// //TR: Bu test FD 2026-11-05 siyah–kırmızı–beyaz tasarım sistemini kilitler: :root token seti TAMDIR (renk, boşluk, tip, yarıçap, yükseklik, odak, kontrol, hareket, kırılım); birincil/tehlike/odak çiftleri WCAG eşiklerini (metin >= 4.5, kenar/odak >= 3) contrast-core.js ile ve bağımsız bir hesapla karşılar; kırmızı (--accent/--primary) yalnız izinli birincil/marka seçicilerinde kullanılır (gövde metni/ikon/dekor değil); odak halkası, reduced-motion, prefers-contrast ve dar pencere kırılımları vardır; components.js button/emptyState ilkelleri yalnız textContent ile mevcut sınıf adlarını üretir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const css = fs.readFileSync(path.join(rend, "styles.css"), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(css)![1];
const tokens: Record<string, string> = {};
for (const m of rootBlock.matchAll(/(--[A-Za-z0-9_-]+):([^;]+);/g)) tokens[m[1]] = m[2].trim();
const lumRef = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(s => s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const refRatio = (a: string, b: string) => { const x = lumRef(a), y = lumRef(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const resolve = (n: string): string => { let v = tokens[n]; for (let i = 0; i < 8 && v?.startsWith("var("); i++) v = tokens[/var\((--[^)]+)\)/.exec(v)![1]]; return v ?? ""; };

describe("FD 2026-11-05 design system: token set is complete", () => {
  it("every DESIGN_TOKEN_GROUPS token is defined in the first :root block (none missing)", async () => {
    const c = await load("contrast-core.js");
    expect(Object.keys(c.DESIGN_TOKEN_GROUPS).sort()).toEqual(["breakpoint", "color", "control", "elevation", "focus", "motion", "radius", "spacing", "type"]);
    expect(c.missingDesignTokens(tokens)).toEqual([]);
    expect(c.missingDesignTokens({})).toEqual(Object.values(c.DESIGN_TOKEN_GROUPS).flat());
    expect(c.missingDesignTokens({"--bg": "  "})).toContain("--bg");
  });
  it("colour tokens resolve to opaque hex and the palette is black/red/white (near-black surfaces, white text, red primary)", () => {
    for (const n of ["--bg", "--bg-2", "--surface", "--surface-2", "--text", "--emphasis", "--accent", "--primary", "--primary-hover", "--primary-active", "--danger", "--danger-bg", "--on-danger", "--focus"]) expect(resolve(n), n).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const n of ["--bg", "--bg-2", "--surface", "--surface-2"]) expect(lumRef(resolve(n)), `${n} near-black`).toBeLessThan(0.02);
    for (const n of ["--text", "--emphasis", "--focus"]) expect(lumRef(resolve(n)), `${n} white`).toBeGreaterThan(0.9);
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (const n of ["--accent", "--primary", "--danger", "--danger-bg"]) { const [r, g, b] = rgb(resolve(n)); expect(r, `${n} red-dominant`).toBeGreaterThan(Math.max(g, b) * 1.5); }
    expect(tokens["--primary"]).toBe("var(--accent)");
    expect(css).toMatch(/color-scheme:dark/);
  });
});

describe("FD 2026-11-05 design system: primary / danger / focus contrast (thresholds unchanged)", () => {
  it("contrast-core rows from styles.css are all AA or better and match an independent computation", async () => {
    const c = await load("contrast-core.js");
    const rows = c.computeContrastRows(tokens);
    for (const k of ["on-primary-primary", "on-primary-primary-hover", "on-primary-primary-active", "on-danger-danger-bg", "on-danger-danger-bg-active", "focus-bg", "focus-surface", "focus-surface-2", "accent-bg", "danger-surface-2", "link-surface", "border-ui-surface-2"]) expect(rows.some((r: any) => r.key === k), k).toBe(true);
    for (const r of rows) {
      expect(r.level, r.key).not.toBe("UNKNOWN");
      expect(r.level, `${r.key} ${r.ratio}`).not.toBe("FAIL");
      expect(r.ratio, r.key).toBeCloseTo(refRatio(c.resolveToken(tokens, r.fg), c.resolveToken(tokens, r.bg)), 6);
    }
  });
  it("text-on-action pairs meet 4.5:1 and the focus ring meets 3:1 on every surface (independent check)", () => {
    const surfaces = ["--bg", "--bg-2", "--surface", "--surface-2"];
    for (const bg of ["--primary", "--primary-hover", "--primary-active"]) expect(refRatio(resolve("--on-primary"), resolve(bg)), `on-primary/${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(refRatio("#031018", resolve("--primary"))).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["--danger-bg", "--danger-bg-active"]) expect(refRatio(resolve("--on-danger"), resolve(bg)), `on-danger/${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const s of surfaces) {
      expect(refRatio(resolve("--focus"), resolve(s)), `focus/${s}`).toBeGreaterThanOrEqual(3);
      for (const t of ["--text", "--muted", "--accent", "--danger", "--ok", "--warn", "--link", "--accent-2", "--purple"]) expect(refRatio(resolve(t), resolve(s)), `${t}/${s}`).toBeGreaterThanOrEqual(4.5);
      expect(refRatio(resolve("--border-ui"), resolve(s)), `border-ui/${s}`).toBeGreaterThanOrEqual(3);
    }
    // //TR: Odak halkası birincil kırmızı düğmenin üstünde de (offset boşluğu olmasa bile) ayırt edilir.
    expect(refRatio(resolve("--focus"), resolve("--primary"))).toBeGreaterThanOrEqual(3);
  });
  it("the prefers-contrast:more overrides only strengthen secondary text and borders", () => {
    const m = /@media \(prefers-contrast:more\)\{\s*:root\{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    const o: Record<string, string> = {};
    for (const x of m![1].matchAll(/(--[a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)) o[x[1]] = x[2];
    for (const [n, v] of Object.entries(o)) expect(refRatio(v, resolve("--surface")), n).toBeGreaterThanOrEqual(refRatio(resolve(n), resolve("--surface")));
  });
});

describe("FD 2026-11-05 design system: red is reserved for primary action, danger and the brand marker", () => {
  // //TR: Kırmızı birincil token'ları (--accent, --primary*) yalnız bu seçicilerde görünür; diğer her yerde nötr --emphasis/--accent-2 kullanılır.
  const ALLOWED = [/^\.skip-link$/, /^\.brand-mark$/, /^\.btn-primary(:hover:not\(:disabled\)|:active:not\(:disabled\))?$/, /^\.nav-link\[aria-current="page"\]$/, /^\.panel-title::before$/];
  // //TR: NB-1: kırmızı tespiti takma adlara dayanıklıdır: var() zincirleri (bileşik değerler dahil) çözülür, ham hex (#rgb/#rrggbb/#rrggbbaa) ve rgb()/rgba() normalize edilir. Tehlike ailesi (--danger*, --on-danger, --glow-risk*) tehlike anlamıdır ve ayrıca izinlidir.
  const toRgb = (v: string): number[] | null => {
    const h = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
    if (h) { let x = h[1]; if (x.length === 3 || x.length === 4) x = [...x].map(c => c + c).join(""); return x.length >= 6 ? [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)) : null; }
    const r = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v.trim());
    return r ? [r[1], r[2], r[3]].map(Number) : null;
  };
  const isRed = (c: number[] | null) => !!c && c[0] >= 150 && c[0] > 1.5 * Math.max(c[1], c[2]);
  const literals = (v: string) => v.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
  const DANGER = /^--(danger|on-danger|glow-risk)/;
  const redOffenders = (text: string, map: Record<string, string>): string[] => {
    const memo = new Map<string, boolean>();
    const primaryRed = (n: string, depth = 0): boolean => {
      if (DANGER.test(n) || depth > 8) return false;
      if (memo.has(n)) return memo.get(n)!;
      const v = map[n] ?? "";
      const out = literals(v).some(l => isRed(toRgb(l))) || [...v.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].some(m => primaryRed(m[1], depth + 1));
      memo.set(n, out); return out;
    };
    const body = text.replace(/\/\*[\s\S]*?\*\//g, ""), off: string[] = [];
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), decl = m[2];
      if (sel === ":root") continue;
      const raw = literals(decl).some(l => isRed(toRgb(l)));
      const viaToken = [...decl.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].some(x => primaryRed(x[1]));
      if (raw) off.push(`${sel} (raw red)`);
      else if (viaToken) for (const s of sel.split(",").map(x => x.trim())) if (!ALLOWED.some(r => r.test(s))) off.push(s);
    }
    return off;
  };
  it("no rule outside the allow-list uses red: var() aliases are resolved and raw hex/rgb reds are caught", () => {
    expect(redOffenders(css, tokens)).toEqual([]);
  });
  it("the red detector itself catches aliases, composite values and raw hex/rgb variants (no evasion)", () => {
    const t = {...tokens, "--alias": "var(--accent)", "--alias2": "var(--alias)", "--shadowy": "0 0 4px var(--primary-hover)", "--warnish": "var(--danger)"};
    const probe = ".a{color:var(--alias2)}\n.b{box-shadow:var(--shadowy)}\n.c{color:#f12}\n.d{border-color:#FF0011cc}\n.e{background:rgb(230, 20, 40)}\n.f{color:var(--warnish)}\n.btn-primary{background:var(--alias)}\n@media (x){\n  .g{outline-color:var(--color-primary)}\n}";
    expect(redOffenders(probe, t)).toEqual([".a", ".b", ".c (raw red)", ".d (raw red)", ".e (raw red)", ".g"]);
  });
  it("LOW: ::selection and the ambient body glow are neutral, not red", () => {
    const sel = /\n::selection\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(sel).toBe("background:var(--emphasis);color:var(--bg)");
    expect(refRatio(resolve("--emphasis"), resolve("--bg"))).toBeGreaterThanOrEqual(7);
    for (const n of ["--ambient-blue", "--ambient-cyan"]) expect(isRed(toRgb(tokens[n])), n).toBe(false);
  });
  it("body text, links and inline link-buttons are white, not red", () => {
    expect(css).toMatch(/body\{[^}]*color:var\(--text\)/);
    expect(css).toMatch(/(^|\n)a\{color:var\(--link\)/);
    expect(css).toMatch(/\.link-btn\{[^}]*color:var\(--link\)/);
    expect(tokens["--link"]).toBe("var(--text)");
  });
});

describe("FD 2026-11-05 design system: focus, motion and responsive coverage", () => {
  it("the global focus ring uses the focus-ring tokens and no shared control removes outlines", () => {
    expect(css).toMatch(/(^|\n):focus-visible\{outline:var\(--focus-ring\);outline-offset:var\(--focus-ring-offset\)\}/);
    expect(tokens["--focus-ring"]).toBe("var(--focus-ring-width) solid var(--focus)");
    expect(css).not.toMatch(/\.(btn|field|nav-link|link-btn)[^{]*\{[^}]*outline\s*:\s*(none|0)\b/);
  });
  it("reduced motion zeroes the motion tokens; responsive breakpoints include the compact (<=480px) window", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*:root\{--motion-hover:0ms;--motion-panel:0ms;--motion-screen:0ms\}/);
    for (const bp of ["2200px", "1700px", "1100px", "760px", "640px", "480px"]) expect(css, bp).toMatch(new RegExp(`@media \\((min|max)-width:${bp}\\)`));
    for (const [t, v] of [["--bp-ultra", "2200px"], ["--bp-wide", "1700px"], ["--bp-medium", "1100px"], ["--bp-narrow", "760px"], ["--bp-zoom", "640px"], ["--bp-compact", "480px"]]) expect(tokens[t], t).toBe(v);
    const compact = css.slice(css.indexOf("@media (max-width:480px)"));
    expect(compact.slice(0, compact.indexOf("\n}"))).not.toMatch(/btn-stop|\.actions[^{]*\{[^}]*display:none/);
  });
  it("primitive rules (buttons, inputs, cards, tables, badges, empty states) carry no raw hex", () => {
    const rule = (sel: string) => { const i = css.indexOf(`\n${sel}{`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
    for (const sel of [".btn", ".btn-danger", ".card", ".panel", ".badge,.pill", ".empty-state", ".field input,.field select,.field textarea", ".table tbody tr:hover", ".kpi"]) {
      const r = rule(sel);
      expect(r, sel).toBeTruthy();
      expect(r, sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

describe("FD 2026-11-05 design system: coordinator visual defects (header, badges, code, card grid)", () => {
  it("the sticky top bar and bottom strip sit on an opaque token surface (no page text shows through)", () => {
    expect(resolve("--surface-raised")).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(tokens["--veil-top"]).toBe("var(--surface-raised)");
    expect(tokens["--veil-strip"]).toBe("var(--surface-raised)");
    expect(css).toMatch(/\.topbar\{[^}]*position:sticky[^}]*background:var\(--veil-top\)/);
    expect(refRatio(resolve("--text"), resolve("--surface-raised"))).toBeGreaterThanOrEqual(7);
  });
  it("status badges/pills are compact inline pills inside grid cards, not full-width bars", () => {
    expect(css).toMatch(/\n\.badge,\.pill,\.chip,\.spill\{justify-self:start;align-self:start;width:max-content;max-width:100%\}/);
  });
  it("long commands wrap inside their own scroll container and card grids cannot force horizontal page scroll", () => {
    const code = /\npre\.code,\.code\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const d of ["max-width:100%", "min-width:0", "overflow:auto", "white-space:pre-wrap", "overflow-wrap:anywhere"]) expect(code, d).toContain(d);
    expect(css).toMatch(/\.cards\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(min\(16rem,100%\),1fr\)\)/);
    expect(css).toMatch(/\.card>\*\{min-width:0;max-width:100%\}/);
  });
});

describe("Layout fixes: sticky nav scroll area, responsive top bar, route notice", () => {
  it("disabled buttons (incl. danger/primary) drop the red fill: muted surface, muted AA label, dashed edge, not-allowed, forced-colors GrayText", () => {
    const r = /\n\.btn:disabled,\.btn-primary:disabled,\.btn-danger:disabled\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const d of ["opacity:1", "background:var(--bg-2)", "border-style:dashed", "color:var(--muted)", "box-shadow:none", "cursor:not-allowed"]) expect(r, d).toContain(d);
    expect(r).not.toMatch(/var\(--(danger|accent|primary)/);
    expect(refRatio(resolve("--muted"), resolve("--bg-2"))).toBeGreaterThanOrEqual(4.5);
    // //TR: Daha sonra gelen hiçbir :disabled kuralı opaklığı düşürmez veya kırmızıyı geri getirmez.
    const later = css.slice(css.indexOf(r) + r.length);
    expect(later).not.toMatch(/:disabled[^{]*\{[^}]*(opacity:\.|var\(--(danger|accent|primary))/);
    expect(css).toMatch(/@media \(forced-colors:active\)\{[^@]*\.btn:disabled,\.btn-primary:disabled,\.btn-danger:disabled\{border:2px dashed GrayText;color:GrayText/);
    expect(css).not.toMatch(/\.btn-stop:disabled/);
  });
  it("registry cards (.integ-row) drop the default h4/p margins and state-head rows space the pill from its label (token-only)", () => {
    expect(css).toMatch(/\n\.integ-row>h4,\.integ-row>p\{margin:0\}/);
    expect(css).toMatch(/\n\.integ-row\{gap:var\(--space-2\);padding:var\(--space-3\) var\(--space-4\)\}/);
    const head = /\n\.academy-state-head,\.install-state-head\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const d of ["display:flex", "flex-wrap:wrap", "align-items:center", "gap:var(--space-2)"]) expect(head, d).toContain(d);
    for (const sel of [".integ-row", ".integ-row>h4", ".integ-name", ".integ-row>p.mono"]) { const m = new RegExp(`\\n${sel.replace(/[.>]/g, c => "\\" + c)}\\{([^}]*)\\}`).exec(css); expect(m, sel).not.toBeNull(); expect(m![1], sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/); }
    expect(refRatio(resolve("--muted"), resolve("--surface"))).toBeGreaterThanOrEqual(4.5);
  });
  it("a facts/kv list is separated from the button row that follows it", () => {
    expect(css).toMatch(/\n\.kv\+\.btn-row,\.facts\+\.btn-row,dl\+\.btn-row\{margin-top:var\(--space-4\)\}/);
  });
  it("NB-3: the focus ring is at least 2px and tabs carry the token focus outline (forced-colors Highlight for the selected tab)", () => {
    const w = /^(\d+(?:\.\d+)?)px$/.exec(tokens["--focus-ring-width"] ?? "");
    expect(w).not.toBeNull();
    expect(Number(w![1])).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/\n\.tabs \[role="tab"\]:focus-visible\{outline:var\(--focus-ring\);outline-offset:var\(--focus-ring-offset\)\}/);
    expect(css).not.toMatch(/\.tabs[^{]*\{[^}]*outline\s*:\s*(none|0)\b/);
    expect(css).toMatch(/@media \(forced-colors:active\)\{[^@]*\n  \.tabs \[role="tab"\]\[aria-selected="true"\]\{border:3px solid Highlight\}/);
    expect(css).toMatch(/@media \(forced-colors:active\)\{[^@]*\n  :focus-visible\{outline:3px solid Highlight\}/);
  });
  it("the focused run card (aria-current / data-run-focused) has a visible white ring meeting 3:1 and a forced-colors outline", () => {
    expect(css).toMatch(/\n\.run-card\[aria-current="true"\],\.run-card\[data-run-focused\]\{border-color:var\(--emphasis\);box-shadow:0 0 0 2px var\(--emphasis\)/);
    for (const s of ["--bg", "--bg-2", "--surface", "--surface-2"]) expect(refRatio(resolve("--emphasis"), resolve(s)), s).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/@media \(forced-colors:active\)\{[^@]*\.run-card\[aria-current="true"\],\.run-card\[data-run-focused\]\{outline:3px solid Highlight/);
  });
  it("styles.css has balanced braces, so no @media block swallows the rules after it (the matrix forced-colors block was left unclosed)", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0, min = 0;
    for (const ch of body) { if (ch === "{") depth++; else if (ch === "}") { depth--; min = Math.min(min, depth); } }
    expect(min).toBe(0);
    expect(depth).toBe(0);
    // //TR: Dosya sonundaki kurallar üst düzeydedir (hiçbir @media içinde değildir).
    const tail = body.slice(body.lastIndexOf("@media"));
    expect(tail.indexOf("\n}")).toBeLessThan(tail.indexOf(".route-notice{"));
  });
  const media = (q: string) => { const i = css.indexOf(`@media (${q}){`); if (i < 0) return ""; const j = css.indexOf("\n}", i); return css.slice(i, j); };
  it("the sidebar nav is its own sticky scroll area directly below the top bar", () => {
    const nav = /\n\.nav\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const d of ["position:sticky", "top:var(--topbar-h)", "align-self:start", "max-height:calc(100vh - var(--topbar-h))", "overflow-y:auto"]) expect(nav, d).toContain(d);
    expect(nav).not.toMatch(/overflow-y:(visible|hidden)/);
    // //TR: Üst çubuk nav'ın üstünde kalır (yapışkan nav onun altına girmez, üstüne çıkmaz).
    const z = (sel: string) => Number(new RegExp(`\\n${sel.replace(".", "\\.")}\\{[^}]*z-index:(\\d+)`).exec(css)?.[1]);
    expect(z(".topbar")).toBeGreaterThan(z(".nav"));
    // //TR: Sayfa sonundaki opak alt şerit yapışkan nav\'ın üstünde çizilir (nav onun üzerine taşmaz).
    expect(z(".strip")).toBeGreaterThan(z(".nav"));
    expect(resolve("--veil-strip")).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(/\n\.topbar\{[^}]*position:sticky;top:0/.test(css)).toBe(true);
  });
  it("every top-bar layout has a --topbar-h token at least as tall as the rows it stacks", () => {
    const rem = (v: string) => { const m = /^([\d.]+)rem$/.exec(v); return m ? Number(m[1]) : NaN; };
    expect(rem(tokens["--topbar-h"])).toBeGreaterThanOrEqual(7.5); // 2 satır (ölçülen 1280px: 122.6px = 7.66rem)
    expect(media("min-width:2200px")).toMatch(/--topbar-h:[\d.]+rem/);
    expect(media("max-width:640px")).toContain("--topbar-h:var(--topbar-h-narrow)");
    expect(rem(tokens["--topbar-h-narrow"])).toBeGreaterThan(rem(tokens["--topbar-h"]));
  });
  it("at <=1100px the search keeps its own column and the context bar wraps instead of scrolling horizontally", () => {
    const m = media("max-width:1100px");
    expect(m).toMatch(/\.topbar\{grid-template-columns:auto minmax\(12rem,1fr\) auto\}/);
    expect(m).toMatch(/\.ctx\{flex-wrap:wrap;overflow-x:visible/);
    expect(m).toContain(".brand-text{display:none}");
    expect(m).not.toMatch(/\.(btn-stop|actions)[^{]*\{[^}]*display:none/);
  });
  it("the shell's unknown-route notice (.route-notice) is styled as a warn-edged row with a wrapping text span", () => {
    const r = /\n\.route-notice\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const d of ["display:flex", "flex-wrap:wrap", "border-left:4px solid var(--warn)", "background:var(--surface-2)", "color:var(--text)"]) expect(r, d).toContain(d);
    expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toMatch(/\.route-notice>span\{[^}]*min-width:0;overflow-wrap:anywhere/);
  });
});

class E {
  tagName: string; children: any[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; textContent = ""; ls: Record<string, Function[]> = {};
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  append(...c: any[]) { this.children.push(...c); }
  appendChild(c: any) { this.children.push(c); return c; }
  addEventListener(ev: string, fn: Function) { (this.ls[ev] ??= []).push(fn); }
}
const doc = {createElement: (t: string) => new E(t), createElementNS: (_n: string, t: string) => new E(t), createTextNode: (t: string) => ({nodeType: 3, textContent: t})};
const ctx = {doc, t: (k: string) => `T(${k})`};

describe("FD 2026-11-05 design system: components.js primitives map onto the backward-compatible classes", () => {
  it("button() emits the existing .btn classes per variant, text via textContent, unknown variant falls back to secondary", async () => {
    const c = await load("components.js");
    expect(c.BUTTON_VARIANTS).toEqual(["secondary", "primary", "danger", "link"]);
    const cls = (o: any) => (c.button(ctx, o) as E).className;
    expect(cls({label: "x"})).toBe("btn");
    expect(cls({label: "x", variant: "primary"})).toBe("btn btn-primary");
    expect(cls({label: "x", variant: "danger", small: true, iconName: "stop"})).toBe("btn btn-danger btn-small btn-icon");
    expect(cls({label: "x", variant: "link"})).toBe("link-btn");
    expect(cls({label: "x", variant: "<script>"})).toBe("btn");
    const b = c.button(ctx, {labelKey: "a.b", disabled: true}) as E;
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("disabled")).toBe("");
    expect(b.children.at(-1).textContent).toBe("T(a.b)");
    const fn = () => {}; const withOn = c.button(ctx, {label: "<b>x</b>", on: {click: fn}}) as E;
    expect(withOn.ls.click).toEqual([fn]);
    expect(withOn.children.at(-1).textContent).toBe("<b>x</b>");
  });
  it("emptyState() renders an icon, dictionary title/body and marks error states distinctly", async () => {
    const c = await load("components.js");
    const e = c.emptyState(ctx, {titleKey: "e.t", bodyKey: "e.b"}) as E;
    expect(e.className).toBe("empty-state");
    expect(e.getAttribute("role")).toBe("status");
    expect(e.dataset.emptyState).toBe("empty");
    expect(e.children.map((x: any) => x.textContent).filter(Boolean)).toEqual(["T(e.t)", "T(e.b)"]);
    const er = c.emptyState(ctx, {titleKey: "e.t", kind: "error"}) as E;
    expect(er.className).toBe("empty-state empty-state-error");
    expect(er.dataset.emptyState).toBe("error");
  });
  it("components.js and contrast-core.js never use HTML string sinks", () => {
    for (const f of ["components.js", "contrast-core.js", "icons.js"]) expect(fs.readFileSync(path.join(rend, f), "utf8"), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(/);
  });
});
