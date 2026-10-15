// //TR: Bu test Control Tower 2B kampüs modülünün (model, SVG, liste görünümü, tr/en sözlüğü) 10 bölge/51 bina, determinizm, yalnız canlı run sayımı, eksik veri için sayı uydurmama, GLOBAL_STOP, kaçışlama, SVG/liste paritesi ve reduced-motion davranışını DOM'suz doğrular.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import {buildCampusModel, type CampusInput} from "../apps/desktop/renderer/control-tower/model.js";
import {renderCampusSvg} from "../apps/desktop/renderer/control-tower/render-svg.js";
import {renderCampusList} from "../apps/desktop/renderer/control-tower/list-view.js";
import {STRINGS, LIVE_STATUSES} from "../apps/desktop/renderer/control-tower/locales.js";

// //TR: INT-R3 D-M1-05: WFR-03 hedef kataloğu kanonik registries/role-definitions.json içine taşıyıp sildi; fikstür artık kanonik kayıttan (aynı clusters/guilds/roles biçimi) okunur.
const raw = JSON.parse(fs.readFileSync("registries/role-definitions.json", "utf8"));
const roles: Record<string, number> = {};
for (const r of raw.roles) roles[r.guildId] = (roles[r.guildId] ?? 0) + 1;
const catalog = {
  clusters: raw.clusters.map((c: any) => ({clusterId: c.clusterId, name: c.name})),
  guilds: raw.guilds.map((g: any) => ({guildId: g.guildId, name: g.name, clusterId: g.clusterId})),
  roles
};
const cockpit = (active = false, reason: string | null = null) => ({generatedAt: "2026-10-14T00:00:00.000Z", globalStop: {active, reason}});
const run = (runId: string, status: string, guildId: string | null = "G01") => ({runId, missionId: "msn_1", status, roleId: null, guildId});
const input = (over: Partial<CampusInput> = {}): CampusInput => ({cockpit: cockpit(), catalog, runs: [], ...over});

const attrs = (html: string, tag: RegExp) =>
  [...html.matchAll(tag)].map((m) => ({id: m[1], cluster: m[2], target: m[3], active: m[4], state: m[5]}));
const svgRows = (svg: string) => attrs(svg, /<g class="building"[^>]*data-guild-id="([^"]*)" data-cluster-id="([^"]*)" data-target-roles="([^"]*)" data-active-runs="([^"]*)" data-state="([^"]*)"/g);
const listRows = (html: string) => attrs(html, /<tr data-guild-id="([^"]*)" data-cluster-id="([^"]*)" data-target-roles="([^"]*)" data-active-runs="([^"]*)" data-state="([^"]*)"/g);
// Tags are well delimited because every `>` inside data is escaped; quoted values are stripped before looking for on* attribute names.
const eventAttrs = (html: string) => [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0].replace(/"[^"]*"/g, "")).filter((t) => /\son\w+=/i.test(t));
const countTexts =(svg: string) => [...svg.matchAll(/<text class="count"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe("control tower campus model", () => {
  it("builds 10 districts and 51 buildings from the canonical role registry (role-definitions.json)", () => {
    const m = buildCampusModel(input());
    expect(m.districts).toHaveLength(10);
    expect(m.buildings).toHaveLength(51);
    expect(m.totals).toMatchObject({districts: 10, buildings: 51, targetRoles: raw.roles.length, activeRuns: 0});
    expect(m.globalState).toBe("RUNNING");
    expect(m.campusState).toBe("VERIFIED");
    expect(m.buildings.every((b) => b.state === "VERIFIED" && b.targetRoles === roles[b.guildId])).toBe(true);
    expect(m.tower.name).toBe("UASCO Control Tower");
  });

  it("is deterministic and independent of input ordering; layout stays inside the canvas without overlaps", () => {
    const a = buildCampusModel(input());
    const b = buildCampusModel(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const shuffled = buildCampusModel(input({catalog: {...catalog, clusters: [...catalog.clusters].reverse(), guilds: [...catalog.guilds].reverse()}}));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(a));
    for (const d of a.districts) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(a.canvas.width);
      expect(d.y + d.height).toBeLessThanOrEqual(a.canvas.height);
    }
    for (let i = 0; i < a.districts.length; i++) for (let j = i + 1; j < a.districts.length; j++) {
      const p = a.districts[i], q = a.districts[j];
      const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
      expect(apart, `${p.clusterId} vs ${q.clusterId}`).toBe(true);
    }
    for (const bld of a.buildings) {
      const d = a.districts.find((x) => x.clusterId === bld.clusterId)!;
      expect(bld.x).toBeGreaterThanOrEqual(d.x);
      expect(bld.x + bld.width).toBeLessThanOrEqual(d.x + d.width);
      expect(bld.y + bld.height).toBeLessThanOrEqual(d.y + d.height);
    }
    expect(renderCampusSvg(a, {t: 1.5})).toBe(renderCampusSvg(b, {t: 1.5}));
  });

  it("counts only live statuses, dedupes run ids and never assigns unattributable runs", () => {
    expect([...LIVE_STATUSES]).toEqual(["LEASED", "RUNNING", "CHECKPOINTING", "VERIFYING"]);
    const runs = [
      run("r1", "LEASED"), run("r2", "RUNNING"), run("r3", "CHECKPOINTING"), run("r4", "VERIFYING"),
      run("r5", "QUEUED"), run("r6", "COMPLETED"), run("r7", "FAILED"), run("r8", "CANCELLED"), run("r2", "RUNNING"),
      run("r9", "RUNNING", "G02"), run("r10", "RUNNING", null), run("r11", "RUNNING", "G999")
    ];
    const m = buildCampusModel(input({runs}));
    expect(m.buildings.find((b) => b.guildId === "G01")!.activeRuns).toBe(4);
    expect(m.buildings.find((b) => b.guildId === "G02")!.activeRuns).toBe(1);
    expect(m.buildings.find((b) => b.guildId === "G03")!.activeRuns).toBe(0);
    expect(m.totals.activeRuns).toBe(5);
    expect(m.totals.unattributedActiveRuns).toBe(2);
  });

  it("marks everything UNAVAILABLE with null counts when the cockpit is missing or lacks a boolean stop flag", () => {
    for (const ck of [null, {generatedAt: "x"}, {globalStop: {active: "yes"}}] as any[]) {
      const m = buildCampusModel(input({cockpit: ck, runs: [run("r1", "RUNNING")]}));
      expect(m.globalState).toBe("UNAVAILABLE");
      expect(m.campusState).toBe("UNAVAILABLE");
      expect(m.buildings).toHaveLength(51);
      expect(m.buildings.every((b) => b.state === "UNAVAILABLE" && b.targetRoles === null && b.activeRuns === null)).toBe(true);
      expect(m.totals.targetRoles).toBeNull();
      expect(m.totals.activeRuns).toBeNull();
    }
  });

  it("keeps active runs null when runs are missing and target roles null when the catalog has no role counts", () => {
    const noRuns = buildCampusModel(input({runs: null}));
    expect(noRuns.buildings.every((b) => b.state === "VERIFIED" && b.targetRoles !== null && b.activeRuns === null)).toBe(true);
    expect(noRuns.totals.activeRuns).toBeNull();
    const {roles: _drop, ...bare} = catalog;
    const noRoles = buildCampusModel(input({catalog: bare}));
    expect(noRoles.buildings.every((b) => b.state === "UNAVAILABLE" && b.targetRoles === null && b.activeRuns === null)).toBe(true);
    const partial = buildCampusModel(input({catalog: {...catalog, roles: {...roles, G05: -1 as number}}}));
    expect(partial.buildings.find((b) => b.guildId === "G05")!.state).toBe("UNAVAILABLE");
    expect(partial.buildings.find((b) => b.guildId === "G05")!.targetRoles).toBeNull();
    expect(partial.totals.targetRoles).toBeNull();
  });

  it("draws no districts or buildings without a catalog and invents nothing", () => {
    const m = buildCampusModel({cockpit: cockpit(), catalog: null, runs: [run("r1", "RUNNING")]});
    expect(m.districts).toHaveLength(0);
    expect(m.buildings).toHaveLength(0);
    expect(m.campusState).toBe("UNAVAILABLE");
    expect(m.totals.targetRoles).toBeNull();
    const svg = renderCampusSvg(m, {reducedMotion: true});
    expect(svg).not.toContain('class="building"');
    expect(svg).toContain('class="notice"');
    expect(buildCampusModel(null as any).campusState).toBe("UNAVAILABLE");
  });
});

describe("control tower SVG", () => {
  it("shows no numbers for unknown values", () => {
    const m = buildCampusModel(input({cockpit: null}));
    const svg = renderCampusSvg(m, {reducedMotion: true});
    const counts = countTexts(svg);
    expect(counts).toHaveLength(51);
    expect(counts.every((c) => c === "VERİ YOK")).toBe(true);
    expect(counts.some((c) => /\d/.test(c))).toBe(false);
    expect(svgRows(svg).every((r) => r.target === "na" && r.active === "na" && r.state === "UNAVAILABLE")).toBe(true);
    for (const b of m.buildings) expect(svg).toContain(`<title>${b.name.replace(/&/g, "&amp;")} — veri yok</title>`);
    expect(svg).not.toMatch(/data-target-roles="\d/);
  });

  it("labels known buildings as target roles and active runs", () => {
    const m = buildCampusModel(input({runs: [run("r1", "RUNNING"), run("r2", "VERIFYING")]}));
    const svg = renderCampusSvg(m, {reducedMotion: true});
    expect(countTexts(svg)).toContain(`${roles.G01} hedef rol · 2 aktif`);
    expect(renderCampusSvg(m, {reducedMotion: true, locale: "en"})).toContain(`${roles.G01} target roles · 2 active`);
    expect(svg).toContain("Hedef roller katalog kapasitesidir");
  });

  it("gives every building a title and an accessible label", () => {
    const svg = renderCampusSvg(buildCampusModel(input()), {reducedMotion: true});
    const groups = svg.match(/<g class="building"[^>]*>/g)!;
    expect(groups).toHaveLength(51);
    for (const g of groups) {
      expect(g).toContain('role="img"');
      expect(g).toMatch(/aria-label="[^"]+"/);
    }
    expect(svg.match(/<g class="building"[^>]*><title>[^<]+<\/title>/g)).toHaveLength(51);
  });

  it("draws the GLOBAL_STOP overlay only while stopped and escapes the reason", () => {
    const stopped = buildCampusModel(input({cockpit: cockpit(true, "Founder <b>stop</b> & \"now\""), runs: [run("r1", "RUNNING")]}));
    expect(stopped.globalState).toBe("STOPPED");
    const svg = renderCampusSvg(stopped, {t: 2});
    expect(svg).toContain('class="stopped-overlay"');
    expect(svg).toContain('role="alert"');
    expect(svg).toContain("DURDURULDU");
    expect(svg).toContain("Founder &lt;b&gt;stop&lt;/b&gt; &amp; &quot;now&quot;");
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("<animate");
    const running = renderCampusSvg(buildCampusModel(input()), {reducedMotion: true});
    expect(running).not.toContain("stopped-overlay");
    expect(renderCampusSvg(stopped, {locale: "en"})).toContain("STOPPED");
  });

  it("escapes hostile names in text, title and aria-label", () => {
    expect(eventAttrs('<g onload="x">')).toHaveLength(1);
    expect(eventAttrs('<g aria-label=" onload=x">')).toHaveLength(0);
    const hostile = [`<script>alert(1)</script>`, `"onload="x" & 'y'`, `</title><image href=x onerror=alert(1)>`];
    const cat = {
      clusters: [{clusterId: "CL01", name: hostile[0]}],
      guilds: hostile.map((n, i) => ({guildId: `G0${i + 1}`, name: n, clusterId: "CL01"})),
      roles: {G01: 1, G02: 2, G03: 3}
    };
    const m = buildCampusModel({cockpit: cockpit(), catalog: cat, runs: []});
    for (const locale of ["tr", "en"] as const) {
      const svg = renderCampusSvg(m, {reducedMotion: true, locale});
      const list = renderCampusList(m, {locale});
      for (const out of [svg, list]) {
        expect(out).not.toContain("<script");
        expect(out).not.toContain("<image");
        expect(eventAttrs(out)).toEqual([]);
        expect(out).toContain("&lt;script&gt;");
      }
      expect(svg).toContain("&quot;onload=&quot;x&quot; &amp; &#39;y&#39;");
    }
    const hostileId = buildCampusModel({cockpit: cockpit(), catalog: {clusters: [{clusterId: 'C"><x', name: "n"}], guilds: [{guildId: 'G"><y', name: "g", clusterId: 'C"><x'}], roles: {'G"><y': 1}}, runs: []});
    expect(renderCampusSvg(hostileId, {reducedMotion: true})).not.toMatch(/data-[a-z-]+="[^"]*"><[xy]/);
  });

  it("removes animation elements with reduced motion and only animates live, running campuses", () => {
    const m = buildCampusModel(input({runs: [run("r1", "RUNNING")]}));
    const reduced = renderCampusSvg(m, {t: 3, reducedMotion: true});
    expect(reduced).not.toMatch(/<animate/);
    expect(reduced).not.toMatch(/<set\b/);
    const animated = renderCampusSvg(m, {t: 3});
    expect(animated).toMatch(/<animate/);
    expect(renderCampusSvg(m, {t: 3})).toBe(animated);
    expect(animated).not.toMatch(/<(style|script)\b/);
    expect(animated).not.toMatch(/\sstyle=/);
  });
});

describe("control tower list view and locales", () => {
  it("shows identical ids and counts as the SVG (parity), including unavailable data", () => {
    const models = [
      buildCampusModel(input({runs: [run("r1", "RUNNING"), run("r2", "LEASED", "G07"), run("r3", "QUEUED", "G07")]})),
      buildCampusModel(input({cockpit: null})),
      buildCampusModel(input({runs: null})),
      buildCampusModel(input({cockpit: cockpit(true, "stop")}))
    ];
    for (const m of models) for (const locale of ["tr", "en"] as const) {
      const s = svgRows(renderCampusSvg(m, {reducedMotion: true, locale}));
      const l = listRows(renderCampusList(m, {locale}));
      expect(l).toHaveLength(51);
      expect(l).toEqual(s);
      expect(s.map((r) => r.id)).toEqual(m.buildings.map((b) => b.guildId));
    }
    const list = renderCampusList(models[0]);
    expect(list).toContain("<table>");
    expect(list).toContain('scope="col"');
    expect(list).toContain("Hedef roller katalog kapasitesidir");
    const unavailable = renderCampusList(models[1]);
    expect(unavailable).toContain("veri yok");
    expect(listRows(unavailable).every((r) => r.target === "na")).toBe(true);
    expect(renderCampusList(models[3])).toContain('role="alert"');
  });

  it("keeps tr and en dictionaries key-for-key identical with non-empty values and matching placeholders", () => {
    const tk = Object.keys(STRINGS.tr).sort();
    const ek = Object.keys(STRINGS.en).sort();
    expect(tk).toEqual(ek);
    for (const k of tk) {
      expect(STRINGS.tr[k].length).toBeGreaterThan(0);
      expect(STRINGS.en[k].length).toBeGreaterThan(0);
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(STRINGS.tr[k]), k).toEqual(ph(STRINGS.en[k]));
    }
  });
});
