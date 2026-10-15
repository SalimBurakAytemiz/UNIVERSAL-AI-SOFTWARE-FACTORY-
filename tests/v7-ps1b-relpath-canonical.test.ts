// //TR: Bu test PS1B-C1-001 düzeltmesini doğrular: renderer (project-core.js) ve main (main.mjs B4 bloğu) aynı kanonik yol kodlayıcısını kullanır; validRelPath'in kabul ettiği her ad (parantez, ünlem, kesme, yıldız, boşluk, Türkçe, en uzun ASCII dışı) için kurulan yol main izin listesinde kabul edilir; kodlanmış üst sınır 300 karakter x 9'a yeter, kanonik olmayan biçimler reddedilir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const desk = path.join(root, "apps", "desktop");
const PID = "prj_" + "ab12".repeat(6);
const mainSrc = fs.readFileSync(path.join(desk, "main.mjs"), "utf8");
const m = /\/\/ B4-ALLOWLIST-BEGIN\n([\s\S]*?)\/\/ B4-ALLOWLIST-END/.exec(mainSrc);
const get = new Function(`${m![1]}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const loadCore = async (): Promise<any> => import(pathToFileURL(path.join(desk, "renderer", "project-core.js")).href);

const NAMES = ["file (1).txt", "it's.md", "a!b.txt", "star*.txt", "(auth)", "New Folder (2)", "a b", "çalışma dosyası (ö).md", "ğüşiöç İĞÜŞÖÇ", "x'y(z)!*", "~._-", "emoji 😀.txt", "ü".repeat(120), "ü".repeat(300), "😀".repeat(150), "(".repeat(300), "a".repeat(300)];

describe("PS1B-C1-001 canonical relative-path encoder shared by renderer and main", () => {
  it("encodes ! ' ( ) * as %XX and equals the main-process encoder", async () => {
    const core = await loadCore();
    expect(core.encodeRelPath("a!b'c(d)e*f g")).toBe("a%21b%27c%28d%29e%2Af%20g");
    const mainEnc = new Function(`${m![1]}\nreturn psEncodeRel;`)() as (v: string) => string;
    for (const n of NAMES) expect(core.encodeRelPath(n)).toBe(mainEnc(n));
  });
  it("whenever validRelPath accepts a name, the built files/file path is accepted by main (single, nested, route groups)", async () => {
    const core = await loadCore();
    let accepted = 0;
    for (const n of NAMES) {
      for (const rel of [n, `src/${n}`.slice(0, 300), `app/(auth)/${n}`.slice(0, 300), `${n}/x`.slice(0, 300)]) {
        if (!core.validRelPath(rel)) continue;
        accepted++;
        for (const p of [core.filesPath(PID, rel), core.filePath(PID, rel)]) {
          expect(p, rel).not.toBeNull();
          expect(get(p), `${rel.slice(0, 40)} (${rel.length})`).toBe(true);
        }
      }
    }
    expect(accepted).toBeGreaterThan(40);
  });
  it("accepts the maximum encoded length for 300-character decoded paths and keeps the 300-character decoded cap", async () => {
    const core = await loadCore();
    const worst = "\u20ac".repeat(300); // 3 byte UTF-8 -> 9 encoded chars each = 2700
    expect(core.validRelPath(worst)).toBe(true);
    expect(core.encodeRelPath(worst).length).toBe(2700);
    expect(get(core.filePath(PID, worst))).toBe(true);
    expect(core.validRelPath("a".repeat(301))).toBe(false);
    expect(get(`/v1/projects/${PID}/file?path=${core.encodeRelPath("a".repeat(301))}`)).toBe(false);
    expect(get(`/v1/projects/${PID}/file?path=${"%E2%82%AC".repeat(301)}`)).toBe(false);
  });
  it("still rejects non-canonical, lowercase, traversal and control encodings after the change", () => {
    for (const bad of ["a(b", "a'b", "a!b", "a*b", "a)b", "a%28b%29%2a", "%2e%2e", "a%5Cb", "a%3Ab", "a%25b", "a%00b", "a%0Ab", "a%2Fb%2F", "%2Fabs", "a%2F%2Fb", "a%2F.%2Fb"])
      expect(get(`/v1/projects/${PID}/file?path=${bad}`), bad).toBe(false);
    expect(get(`/v1/projects/${PID}/file?path=${"a".repeat(2701)}`)).toBe(false);
    expect(get(`/v1/projects/${PID}/files?path=a&path=b`)).toBe(false);
  });
});

describe("PS1B-C1-001 lone surrogates never make the builder throw", () => {
  it("validRelPath rejects lone surrogates so filesPath/filePath return null instead of throwing", async () => {
    const core = await loadCore();
    for (const bad of ["a" + String.fromCharCode(0xd83d), String.fromCharCode(0xde00) + "b", "x/" + String.fromCharCode(0xd800) + "/y"]) {
      expect(core.validRelPath(bad)).toBe(false);
      expect(() => core.filePath(PID, bad)).not.toThrow();
      expect(core.filePath(PID, bad)).toBeNull();
      expect(core.filesPath(PID, bad)).toBeNull();
    }
    expect(core.validRelPath("😀/ok")).toBe(true);
  });
});
