// //TR: UASCO-T0121 (RW-049) ürün/meta satır payı ölçüm aracı testleri: scripts/metrics/product-share.mjs yolları kurallar dosyasından (G7 §12) sınıflar, enjekte PR listesi ve ağsız geçici git deposundaki gerçek "Merge pull request #N" birleşmeleri üzerinden payı, sayıları ve pencereyi hesaplar; ≥%40/30 PR hedefi yalnız bilgilendirme durumudur. Kayıtlı tests/review-governance.test.ts'ten çalışır (korunan validation.json kaydı gerekmez).
import {describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..", "..");
const script = path.join(root, "scripts", "metrics", "product-share.mjs");
const rulesFile = path.join(root, "scripts", "metrics", "product-share.rules.json");
const load = async (): Promise<any> => import(pathToFileURL(script).href);
const rules = () => JSON.parse(fs.readFileSync(rulesFile, "utf8"));
const f = (p: string, added: number, deleted = 0, binary = false) => ({path: p, added, deleted, binary});

export function registerProductShareCases() {
  describe("UASCO-T0121 product/meta line share (RW-049)", () => {
    it("the committed rules file is the G7 §12 rule and declares an informational 40%/30-PR target", async () => {
      const m = await load();
      const doc = rules();
      expect(doc.schema).toBe(m.RULES_SCHEMA);
      expect(doc.target).toMatchObject({minProductShare: 0.4, windowPrs: 30, mode: "INFORMATIONAL"});
      const g7 = fs.readFileSync(path.join(root, "docs/closure/uasco-remaining-work/evidence/G7-workplan.md"), "utf8");
      expect(g7).toContain("PRODUCT = `apps/desktop|control-api|mobile` (non-md), `core/**`");
      expect(doc.source.startsWith("docs/closure/uasco-remaining-work/evidence/G7-workplan.md")).toBe(true);
    });

    it("classifies paths by the rules file (first match wins, md excluded from product)", async () => {
      const m = await load();
      const c = m.loadRules(rules()).classify;
      const cases: [string, string][] = [
        ["apps/desktop/main.mjs", "PRODUCT"], ["apps/control-api/src/routes/intake.ts", "PRODUCT"], ["apps/mobile/src/core/types.ts", "PRODUCT"],
        ["core/workos/intake.ts", "PRODUCT"], ["apps/mobile/README.md", "DOC_PRODUCT"], ["tests/v7-b7-installer.test.ts", "TEST"],
        ["tests/support/x.cases.ts", "TEST"], [".github/workflows/ci.yml", "META_CI"], ["scripts/ci/uasco-review/a.mjs", "META_CI"],
        ["package-lock.json", "META_CI"], ["docs/cloud-production/ci/x.md", "META_CI"], ["docs/cloud-production/plan.md", "META_GOV"],
        ["config/validation.json", "META_GOV"], ["registries/agents.json", "META_GOV"], ["automation/lib/x.mjs", "META_GOV"],
        ["docs/lanes/LANE-A-mutants.json", "META_GOV"], ["docs/planning/autonomy/task-index.json", "META_GOV"],
        ["docs/ux/flows.md", "DOC_PRODUCT"], ["README.md", "DOC_PRODUCT"], ["tsconfig.json", "META_OTHER"],
        ["apps\\desktop\\renderer\\app.js", "PRODUCT"], ["./core/a.ts", "PRODUCT"], ["applications/x.ts", "META_OTHER"], ["coreutils/x.ts", "META_OTHER"],
      ];
      for (const [p, want] of cases) expect(c(p), p).toBe(want);
    });

    it("reads the classification from configuration, not hard-coded paths", async () => {
      const m = await load();
      const prs = [{number: 1, files: [f("tests/a.test.ts", 60), f("core/a.ts", 40)]}];
      expect(m.computeShare(prs, rules()).productShare).toBe(0.4);
      const custom = {...rules(), productClasses: ["PRODUCT", "TEST"]};
      expect(m.computeShare(prs, custom).productShare).toBe(1);
      const swapped = {...rules(), rules: [{class: "PRODUCT", include: ["tests/**"]}, {class: "TEST", include: ["core/**"]}]};
      expect(m.computeShare(prs, swapped).productShare).toBe(0.6);
    });

    it("computes share, counts and window over an injected newest-first list, and reports the target as informational", async () => {
      const m = await load();
      const prs = [
        {number: 12, files: [f("core/a.ts", 30, 10), f("tests/a.test.ts", 40), f("docs/lanes/x.json", 20)]},
        {number: 11, files: [f("config/x.json", 5, 5), f("assets/logo.png", 0, 0, true)]},
        {number: 10, files: [f("apps/desktop/x.js", 50, 0)]},
        {number: 9, files: [f("core/z.ts", 999)]},
      ];
      const r = m.computeShare(prs, rules(), {window: 3});
      expect(r.schema).toBe(m.OUTPUT_SCHEMA);
      expect(r.window).toEqual({requested: 3, prs: 3, newestPr: 12, oldestPr: 10});
      expect(r.lines).toEqual({total: 160, product: 90, byClass: {META_GOV: 30, META_OTHER: 0, PRODUCT: 90, TEST: 40}});
      expect(r.productShare).toBe(0.5625);
      expect(r.prs).toEqual({total: 3, touchingProduct: 2});
      expect(r.binaryFiles).toBe(1);
      expect(r.target).toEqual({minProductShare: 0.4, windowPrs: 30, mode: "INFORMATIONAL", status: "INSUFFICIENT_DATA"});
      const many = Array.from({length: 30}, (_, i) => ({number: 100 - i, files: [f("core/a.ts", 40), f("tests/a.test.ts", 60)]}));
      expect(m.computeShare(many, rules()).target.status).toBe("MET");
      const low = many.map((p) => ({...p, files: [f("core/a.ts", 39), f("tests/a.test.ts", 61)]}));
      expect(m.computeShare(low, rules()).target.status).toBe("NOT_MET");
      expect(m.computeShare([{number: 1, files: []}], rules()).productShare).toBeNull();
    });

    it("rejects invalid rules, windows and line counts", async () => {
      const m = await load();
      expect(() => m.computeShare([], {...rules(), schema: "x"})).toThrow(/RULES_INVALID/);
      expect(() => m.computeShare([], {...rules(), rules: []})).toThrow(/RULES_INVALID/);
      expect(() => m.computeShare([], {...rules(), productClasses: ["NOPE"]})).toThrow(/RULES_INVALID/);
      expect(() => m.computeShare([], {...rules(), rules: [{class: "PRODUCT", include: ["a/{b"]}]})).toThrow(/RULES_INVALID/);
      expect(() => m.computeShare([], rules(), {window: 0})).toThrow(/WINDOW_INVALID/);
      expect(() => m.computeShare([{number: 1, files: [f("core/a.ts", -1)]}], rules())).toThrow(/LINES_INVALID/);
    });

    it("parses git numstat including binary files and both rename forms", async () => {
      const m = await load();
      expect(m.parseNumstat("3\t1\tcore/a.ts\n-\t-\tlogo.png\n2\t0\tcore/{old => new}/b.ts\n1\t1\tdocs/x.md => core/x.ts\n")).toEqual([
        f("core/a.ts", 3, 1), f("logo.png", 0, 0, true), f("core/new/b.ts", 2, 0), f("core/x.ts", 1, 1),
      ]);
      expect(m.renamedTarget("core/{ => sub}/b.ts")).toBe("core/sub/b.ts");
      expect(() => m.parseNumstat("garbage")).toThrow(/NUMSTAT_UNPARSEABLE/);
    });

    // //TR: UASCO-T0118: bu senaryo gerçek git (init/commit/merge) ve iki CLI alt süreci çalıştırır; GitHub Windows runner'da vitest'in 5 sn varsayılanını aşabildi (#446, run 45426246495, validate-windows-shard 1: 6943 ms). Yalnız bu teste süre bütçesi verilir; dosya geneli setConfig yok, hiçbir iddia değişmez.
    it("collects merged PRs from a real local git history with no network, skipping non-PR merges, and the CLI prints one JSON line", {timeout: 60_000}, async () => {
      const m = await load();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-t0121-"));
      const env = {...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_NOSYSTEM: "1", HOME: dir};
      const g = (...a: string[]) => { const r = spawnSync("git", a, {cwd: dir, env, encoding: "utf8"}); expect(r.status, r.stderr).toBe(0); return r.stdout; };
      const write = (p: string, lines: number) => { fs.mkdirSync(path.dirname(path.join(dir, p)), {recursive: true}); fs.writeFileSync(path.join(dir, p), Array.from({length: lines}, (_, i) => `l${i}`).join("\n") + "\n"); };
      try {
        g("init", "-q", "-b", "main"); write("README.md", 1); g("add", "-A"); g("commit", "-q", "-m", "init");
        const pr = (n: number | null, branch: string, files: [string, number][]) => {
          g("checkout", "-q", "-b", branch); for (const [p, l] of files) write(p, l); g("add", "-A"); g("commit", "-q", "-m", branch);
          g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "-m", n === null ? `Merge branch '${branch}'` : `Merge pull request #${n} from x/${branch}`, branch);
        };
        pr(1, "a", [["core/a.ts", 10], ["tests/a.test.ts", 30]]);
        pr(null, "b", [["core/ignored.ts", 500]]);
        pr(2, "c", [["docs/lanes/x.json", 20], ["apps/desktop/x.js", 20]]);
        const prs = m.collectFromGit({cwd: dir, ref: "main", window: 30});
        expect(prs.map((p: any) => p.number)).toEqual([2, 1]);
        const r = m.computeShare(prs, rules(), {window: 30, ref: "main", source: "git"});
        expect(r.lines).toMatchObject({total: 80, product: 30});
        expect(r.productShare).toBe(0.375);
        expect(r.window).toEqual({requested: 30, prs: 2, newestPr: 2, oldestPr: 1});
        expect(m.collectFromGit({cwd: dir, ref: "main", window: 1}).map((p: any) => p.number)).toEqual([2]);
        const cli = spawnSync(process.execPath, [script, "--ref", "main", "--window", "30"], {cwd: dir, encoding: "utf8"});
        expect(cli.status, cli.stderr).toBe(0);
        const lines = cli.stdout.trim().split("\n");
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({source: "git", ref: "main", productShare: 0.375, target: {status: "INSUFFICIENT_DATA", mode: "INFORMATIONAL"}});
        fs.writeFileSync(path.join(dir, "prs.json"), JSON.stringify([{number: 5, files: [f("core/a.ts", 1)]}]));
        const inj = spawnSync(process.execPath, [script, "--input", "prs.json"], {cwd: dir, encoding: "utf8"});
        expect(inj.status, inj.stderr).toBe(0);
        expect(JSON.parse(inj.stdout)).toMatchObject({source: "injected", productShare: 1});
        expect(spawnSync(process.execPath, [script, "--bogus"], {cwd: dir, encoding: "utf8"}).status).toBe(2);
        expect(spawnSync(process.execPath, [script, "--ref", "no-such-ref"], {cwd: dir, encoding: "utf8"}).status).toBe(1);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });
  });
}
