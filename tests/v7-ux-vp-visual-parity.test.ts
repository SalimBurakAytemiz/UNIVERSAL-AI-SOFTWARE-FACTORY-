// //TR: Bu test V7 VISUAL-PARITY premium görsel-kod yükseltmesini kilitler: tasarım token'ları onaylı referans (NIHAI bölüm-2 başlangıç paleti: canvas/surface/elevated/border/focus/fg/muted/success/caution ve AA'ya ayarlı danger) ile uzlaşır ve kilit metin/zemin çiftleri WCAG AA (>=4.5:1) karşılar; premium kompozisyon (katmanlı yükseklik, ince ışık kenarı, tip ölçeği, KPI sayı ölçeği, panel bölüm işareti) TOKEN TABANLIDIR (paylaşılan bileşen kurallarında gömülü hex yoktur); parıltı yalnız odak/seçili/canlı/risk içindir; reduced-motion ve forced-colors yeni yüzeyleri de kapsar. Not: gerçek Windows ekran görüntüsü/piksel regresyonu bu pakette DEĞİLDİR (ayrı TEST-variant render koşum hattı); burada yalnız görsel-KOD parite iyileştirmesi doğrulanır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const css = fs.readFileSync(path.join(rend, "styles.css"), "utf8");

const tok = (n: string): string => (new RegExp(`--${n}:(#[0-9a-fA-F]{6})`).exec(css) ?? [])[1] ?? "";
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// //TR: Belirli bir CSS kural gövdesini (selector{...}) döndürür; selector'ın tam eşleşmesi için başına sınır konur.
const rule = (sel: string): string => {
  const i = css.indexOf(sel + "{");
  if (i < 0) return "";
  return css.slice(i + sel.length + 1, css.indexOf("}", i));
};

describe("V7 VISUAL-PARITY: design tokens reconcile with the approved reference palette", () => {
  // //TR: NIHAI bölüm-2 başlangıç değerleri renderer token adlarına eşlenir; danger AA için ayarlı varyanttır.
  const START: Record<string, string> = { bg: "#050E1E", surface: "#0A1D37", "surface-2": "#102844", border: "#214F75", focus: "#16B8FF", text: "#F1F8FF", muted: "#A5BAD2", ok: "#16DC9B", warn: "#FFBC42" };
  it("exact reference start values are kept for canvas/surface/elevated/border/focus/fg/muted/success/caution", () => {
    for (const [name, hex] of Object.entries(START)) expect(tok(name).toUpperCase(), name).toBe(hex.toUpperCase());
  });
  it("danger is the reference danger family, AA-adjusted from #FA4D69", () => {
    expect(tok("danger").toUpperCase(), "danger").toMatch(/^#FA4[0-9A-F]/);
    // //TR: AA ayarı başlangıç tonuna çok yakın kalır (kanal başına <= 4).
    const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
    const d = tok("danger"), ref = "#FA4D69";
    for (const i of [1, 3, 5]) expect(Math.abs(ch(d, i) - ch(ref, i)), `channel ${i}`).toBeLessThanOrEqual(4);
  });
  it("key text/background token pairs meet WCAG AA (>=4.5:1) on the reconciled palette", () => {
    const pairs: [string, string][] = [["text", "bg"], ["text", "surface"], ["text", "surface-2"], ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"], ["muted", "bg-2"], ["accent", "bg"], ["accent", "surface"], ["accent", "surface-2"], ["on-danger", "danger-bg"], ["danger", "bg-2"], ["ok", "bg-2"], ["warn", "bg-2"], ["accent-2", "bg-2"], ["purple", "bg-2"], ["focus", "bg"]];
    for (const [fg, bg] of pairs) { expect(tok(fg), fg).toMatch(/^#/); expect(tok(bg), bg).toMatch(/^#/); expect(ratio(tok(fg), tok(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5); }
  });
});

describe("V7 VISUAL-PARITY: premium composition is token-driven (single source of truth)", () => {
  it("adds the premium scale tokens (type rhythm, KPI number, bevel + layered elevation)", () => {
    for (const t of ["--fs-h3:", "--fs-h2:", "--fs-kpi:", "--fs-kpi-sm:", "--hairline:", "--inner-top:"]) expect(css, t).toContain(t);
    // //TR: Yükseklik katmanlıdır (anahtar + üst ışık kenarı); düz tek gölge değil.
    expect(rule(":root"), "elev-2 layered").toMatch(/--elev-2:[^;]*var\(--inner-top\)/);
  });
  it("shared card/KPI/panel surfaces reference tokens and carry no embedded hex", () => {
    for (const sel of [".kpi", ".panel", ".card", ".kpi-icon", ".area-card", ".strip-item"]) {
      const body = rule(sel);
      expect(body, sel).toBeTruthy();
      expect(body, `${sel} hex-free`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    expect(rule(".kpi"), ".kpi radius").toContain("var(--radius-xl)");
    expect(rule(".kpi"), ".kpi elevation").toContain("var(--elev-2)");
    // //TR: Bağımsız .kpi-value kuralı KPI sayı ölçeğini kullanır (.kpi-na .kpi-value renk geçişi değil).
    expect(css, ".kpi-value scale").toMatch(/\.kpi-value\{[^}]*var\(--fs-kpi\)/);
    expect(rule(".panel"), ".panel elevation").toContain("var(--elev-2)");
  });
  it("adds the reference-style section marker on panel titles", () => {
    expect(css, "panel-title marker").toMatch(/\.panel-title::before\{[^}]*background:linear-gradient\(180deg,var\(--accent\),var\(--accent-2\)\)/);
  });
  it("keeps the neon-glow discipline: KPI/card base surfaces use neutral elevation, not an outer glow", () => {
    // //TR: Parıltı yalnız odak/seçili/canlı/risk içindir; taban kartlar glow-md/glow-lg taşımaz.
    for (const sel of [".kpi", ".card", ".panel"]) expect(rule(sel), `${sel} no base glow`).not.toMatch(/var\(--glow-(md|lg)\)/);
    // //TR: Risk ve canlı vurgusu hâlâ parıltıyı kullanır (regresyon koruması).
    expect(rule(".kpi-risk"), "risk glow").toContain("glow-risk");
    expect(rule(".kpi-live"), "live glow").toContain("glow-live");
  });
});

describe("V7 VISUAL-PARITY: a11y and high-contrast coverage for the new surfaces", () => {
  it("forced-colors neutralizes decorative shadows and the accent marker", () => {
    const fc = css.slice(css.indexOf("@media (forced-colors:active)"));
    expect(fc, "shadow reset").toMatch(/\.kpi,\.panel,\.card,\.area-card,\.strip-item,\.ct-map\{box-shadow:none\}/);
    expect(fc, "marker reset").toMatch(/\.panel-title::before\{background:Highlight\}/);
  });
  it("reduced-motion remains globally honored and no new auto-playing animation is introduced", () => {
    expect(css).toContain("prefers-reduced-motion:reduce");
    // //TR: Yeni premium efektler statik (gölge/degrade); yalnız mevcut pulse/stop-glow animasyonları vardır.
    const anims = [...css.matchAll(/animation:([a-z-]+)\s/g)].map(m => m[1]);
    for (const a of anims) expect(["pulse", "stop-glow"], a).toContain(a);
  });
  it("no network/import and no raw hex leaks into the token-only WP section blocks", () => {
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/);
    const wp = css.slice(css.indexOf("UX WP-PROJECTS"));
    expect(wp, "WP blocks stay token-only").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
