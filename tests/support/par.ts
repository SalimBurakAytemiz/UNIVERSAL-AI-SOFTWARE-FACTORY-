// //TR: C-PAR-1 test destek modülü (vitest dosyası DEĞİL; tests/*.test.ts değildir, kayıt gerektirmez): MissionRunner paralel-çalışma testlerinin ortak parçaları. "Yavaş git" modeli (eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR, eşzamansız execFile ile gelirse yalnız sonucu gecikir; gecikme iki yolda aynıdır, shim/PATH gerekmez, Windows'ta da çalışır), depo+store+mission kurulumu ve süreç/grup yardımcıları. Testler iki kayıtlı dosyaya bölünmüştür (heartbeat/planlama ve yazar durdurma) ki hiçbir Windows adımı 600 sn sınırına yaklaşmasın.
import {beforeEach, afterEach, vi, expect} from "vitest";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {testExecutionGate} from "./test-sandbox.js";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {MissionRunner} from "../../core/workos/runner.js";
import {fakeSecurity} from "../../core/workos/security-tools.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import type {RunnerOptions} from "../../core/workos/runner.js";
import type {ExecutorPair} from "../../core/workos/executors.js";

// //TR: "Yavaş git" modeli: eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR (düzeltme öncesi runner), eşzamansız execFile ile gelirse yalnız sonucu gecikir (düzeltme sonrası runner). Gecikme süresi her iki yolda aynıdır; deterministik, shim/PATH gerekmez, Windows'ta da çalışır.
// //TR: C-PAR-1 (test birleştirme): modül mock'u (vi.mock) dosya genelindedir ve başka testlerin child_process'ini etkilerdi. Bu yüzden kaynakların kullandığı VARSAYILAN dışa aktarım nesnesinde (git-isolation.mjs ve runner.ts `import cp ...; cp.spawnSync/cp.execFile` ile çağırır) vi.spyOn kullanılır; casus yalnız bu dosyanın testlerinde kurulur ve her testten sonra geri alınır.
export const slow = {rule: null as null | {ms: number; match: (cwd: string, args: string[]) => boolean}, hits: {sync: 0, async: 0}, observe: null as null | ((cwd: string, args: string[], env: NodeJS.ProcessEnv) => void), observeSync: null as null | ((cwd: string, args: string[]) => void)}; // observe: her git çağrısını (senkron/eşzamansız) gözler; çocuğun ortamını denetleyen testler için
const realSpawnSync = cp.spawnSync, realSpawn = cp.spawn as (...x: unknown[]) => cp.ChildProcess;
const isSlow = (cmd: unknown, args: unknown, opts: unknown) => cmd === "git" && slow.rule !== null && slow.rule.match(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : []);
// //TR: #224 tur 3: eşzamansız git artık `cp.spawn` ile çalışır (execFile `detached`ı yok sayıyordu, bkz. git-async.ts). Yavaş model aynı kalır: eşleşen çağrının "close" olayı ms kadar geciktirilir (gerçek git hemen biter; sonuç gecikir).
// //TR: Teşhis (QA C-PAR, PAR-03 Windows fence'leri 2026-11-03/04: maxLoopStallMs 4161-10469, cpuMs duvar süresinin çok altında = senkron G/Ç beklemesi): stallProbe açıkken ana iş parçacığını bloklayabilen senkron çağrılar (spawnSync, fsyncSync, writeFileSync, rmSync, cpSync) zamanlanır; 50 ms'den uzun olanlar kaydedilir ve başarısızlık iletisi en uzun durmayla örtüşenleri adlarıyla yazar. Yalnız gözlemdir: çağrılar aynen gerçek işleve gider, hiçbir iddia değişmez.
export const syncSpans: {on: boolean; list: Array<{what: string; t0: number; t1: number}>} = {on: false, list: []};
const SPAN_MIN_MS = 50;
const spanned = <T>(what: () => string, f: () => T): T => {
  if (!syncSpans.on) return f();
  const t0 = performance.now();
  try { return f(); } finally { const t1 = performance.now(); if (t1 - t0 >= SPAN_MIN_MS && syncSpans.list.length < 2000) syncSpans.list.push({what: what(), t0, t1}); }
};
const argLabel = (args: unknown): string => (Array.isArray(args) ? args.map(String) : []).filter((x, i, all) => x !== "-c" && all[i - 1] !== "-c").slice(0, 3).map(x => path.basename(x).slice(0, 40)).join(" ");
// //TR: renameSync/copyFileSync/readFileSync burada SARILMAZ: bu dosyayı kullanan testler onları kendi casuslarıyla bozar ve "gerçek" işlevi casus kurulduktan sonra yakalar (sarmalanırsa özyineleme olur).
const FS_SPANNED = ["fsyncSync", "writeFileSync", "rmSync", "cpSync"] as const;
// //TR: WIN-1 v2 (#339 inceleme B1, Windows CI 42059115488): yavaş-git heartbeat senaryoları GİT eşzamansızlığını sınar, diskin dayanıklılık maliyetini değil. Yavaş runner diskinde (fsync 400-650 ms) her store append'i 4 fsync yapar (journal + 3 snapshot); talep zinciri olay döngüsünü 11-19 sn bloklar, bu da TTL'den ve HEAD probunun 10 sn sınırından uzundur (hiçbir TTL kalibrasyonu senaryoyu kurtaramaz). Bu senaryolar fsync'i atlar (çökme yok, dayanıklılık burada sınanmıyor; yavaş dayanıklı yazı zinciri sanal saatli ayrı testte sınanır). Atlanan çağrılar sayılır: test atlamanın gerçekten etkin olduğunu doğrular.
export const durability = {skipFsync: false, skipped: 0};
const realFs = Object.fromEntries(FS_SPANNED.map(n => [n, (fs as unknown as Record<string, (...x: unknown[]) => unknown>)[n]])) as Record<(typeof FS_SPANNED)[number], (...x: unknown[]) => unknown>;
export function installSlowGit() {
  vi.spyOn(cp, "spawnSync").mockImplementation(((...a: Parameters<typeof cp.spawnSync>) => spanned(() => `spawnSync:${path.basename(String(a[0]))} ${argLabel(a[1])}`, () => {
    if (a[0] === "git") slow.observeSync?.(String((a[2] as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(a[1]) ? a[1].map(String) : []); // //TR: yalnız senkron git çağrılarını gözler (span içinde mi sorusu için)
    if (isSlow(a[0], a[1], a[2])) { slow.hits.sync += 1; for (const until = Date.now() + slow.rule!.ms; Date.now() < until;) { /* senkron git: olay döngüsü bloklanır */ } }
    return realSpawnSync(...a);
  })) as typeof cp.spawnSync);
  for (const n of FS_SPANNED) vi.spyOn(fs as unknown as Record<string, (...x: unknown[]) => unknown>, n).mockImplementation((...x: unknown[]) => spanned(() => `${n}:${typeof x[0] === "string" ? path.basename(x[0]).slice(0, 40) : typeof x[0]}`, () => { if (n === "fsyncSync" && durability.skipFsync) { durability.skipped += 1; return undefined; } return realFs[n](...x); }));
  vi.spyOn(cp, "spawn").mockImplementation(((...a: unknown[]) => {
    const [cmd, args, opts] = a as [string, string[], unknown];
    if (cmd === "git") slow.observe?.(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : [], ((opts as {env?: NodeJS.ProcessEnv} | undefined)?.env) ?? {});
    const child = realSpawn(...a);
    if (isSlow(cmd, args, opts)) {
      slow.hits.async += 1; const ms = slow.rule!.ms;
      const delayClose = (orig: (ev: string, l: (...r: unknown[]) => void) => unknown) => (ev: string, l: (...r: unknown[]) => void) => orig(ev, ev === "close" ? (...r: unknown[]) => { setTimeout(() => l(...r), ms); } : l);
      child.on = delayClose(child.on.bind(child) as never) as never; child.once = delayClose(child.once.bind(child) as never) as never;
    }
    return child;
  }) as typeof cp.spawn);
}

export const REPO = path.resolve(import.meta.dirname, "..", "..");
export const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
export const ENGINE = path.join(REPO, "tests", "v7-par-engine.mts");
const TEST_SCRIPT = `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") ? 0 : 1);\n`;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// //TR: Yetim implementer/torun, test "yazar öldürüldü" kanıtını verdikten SONRA <dir>/release dosyası yazılana kadar bekler (en çok ORPHAN_MS): sonuç sabit bir zaman penceresine değil, motor açılış hızından bağımsız bu sinyale bağlıdır. Yazar canlıysa dosya belirince ORPHAN*.txt yazar ve test bunu görür.
export const ORPHAN_MS = 30_000;
// //TR: Yazar GERÇEKTEN park etti mi (yönergeyi okudu, release bekliyor)? Motor 1 bundan önce öldürülürse yazar boş yönergeyle hemen çıkar ve "yazar durdurulmuş mu" sorusu anlamsızlaşır. Motor 1 erken çıkarsa false.
export const writerParked = (dir: string, engineClosed: Promise<unknown>, ms = 120_000): Promise<boolean> => Promise.race([waitUntil(() => fs.existsSync(path.join(dir, "writer-ready")), ms), engineClosed.then(() => false)]);
export const release = async (dir: string) => { fs.writeFileSync(path.join(dir, "release"), "1"); await sleep(1500); };
export const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

// //TR: Her kullanan describe içinde BİR KEZ çağrılır: o describe'ın testleri için tmp dizini + "yavaş git" casusları kurulur ve her testten sonra geri alınır (modül mock'u yok; başka dosyaların child_process'i etkilenmez).
export function parHarness(): {tmp: () => string} {
  let tmp = "";
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-par-")); slow.rule = null; slow.observe = null; slow.hits = {sync: 0, async: 0}; installSlowGit(); });
  afterEach(() => { slow.rule = null; slow.observe = null; slow.observeSync = null; durability.skipFsync = false; durability.skipped = 0; vi.restoreAllMocks(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });
  return {tmp: () => tmp};
}

export function setup(tmp: string, name = "s", seed: Record<string, string> = {}, clock?: () => number) {
  const root = path.join(tmp, name); fs.mkdirSync(root);
  const repo = path.join(root, "src"); fs.mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  for (const [f, content] of Object.entries(seed)) fs.writeFileSync(path.join(repo, f), content);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(root, "data"), runtime = path.join(root, "rt"); fs.mkdirSync(runtime);
  const store = new WorkOsStore(dataDir, clock ? {now: clock} : {});
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
  const base = fake.pair();
  const mkRun = (title: string) => {
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: base.implementer.identity, reviewer: base.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  };
  const runner = (extra: Partial<RunnerOptions> = {}) => new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: base, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(root, "sec")).options, ...extra});
  return {store, dataDir, base, repo, mkRun, runner, status: (id: string) => store.engineGetRun(id)!.status};
}
export const journal = (dataDir: string): Array<{type: string; payload: Record<string, unknown>}> => fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
export const wrapImplementer = (base: ExecutorPair, implement: ExecutorPair["implementer"]["implement"]): ExecutorPair => ({...base, implementer: {...base.implementer, implement}});

export const waitUntil = async (pred: () => boolean, ms: number) => { for (const until = Date.now() + ms; Date.now() < until;) { if (pred()) return true; await sleep(50); } return false; };
// //TR: #224 tur 3 (ST4): stop() sonsuza dek asılırsa (ör. durmuş bir motor yeni adım başlatmayı sürdürürse) test 90 sn'lik zaman aşımına kadar sessizce beklemesin ve `finally`deki ikinci stop() de asılmasın: söz `ms` içinde çözülmezse "STOP_HUNG" döner (sınırlı bekleme; zamanlayıcı her durumda temizlenir).
export const stopWithin = async (p: Promise<unknown>, ms = 15_000): Promise<"OK" | "STOP_HUNG"> => {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p.then(() => "OK" as const), new Promise<"STOP_HUNG">(r => { t = setTimeout(() => r("STOP_HUNG"), ms); })]); } finally { clearTimeout(t); }
};
// //TR: #224 tur 3 (Windows HB-1 onarımı): lease testlerinde olay döngüsü gecikmesini ÖLÇER (50 ms'lik bir zamanlayıcının en büyük sapması) ve harcanan CPU süresini (process.cpuUsage) kaydeder. Başarısızlık iletisine eklenir. Yorum kuralı: TTL'yi aşan bir gecikme, aksi KANITLANMADIKÇA bir gerilemedir. Bu testlerin koruduğu gerileme, olay döngüsünü bloklayan senkron bekleme/iştir: böyle bir bekleme CPU'yu YAKAR ya da bloklar ve duvar süresi boyunca döngü akmaz, yani cpuMs duvar süresine yakındır (senkron iş) ya da döngü tamamen durur; bu bir "marj" değildir. Süreç CPU'dan yoksun kaldıysa cpuMs duvar süresinin çok altındadır ve bu AYRICA gösterilmelidir; tek başına sorunu "marj" yapmaz. Gerçek tolerans TTL değil, TTL eksi bir heartbeat periyodudur: runner heartbeatMs() = floor(TTL/3) (core/workos/runner.ts heartbeatMs, adım heartbeat'i setInterval(renew, heartbeatMs) ~652. satır), iki yenileme arasındaki en uzun boşluk tek bir döngü gecikmesi + en çok bir heartbeat periyodudur; yani ~2/3 TTL'yi (TTL 5 s: 3334 ms, TTL 2 s: 1334 ms) aşan TEK bir gecikme kendi başına fence üretebilir ve bu bir defter boşluğu kanıtı değildir (C2, 2026-11-05 run 41971579107: 3451 ms > 3334 ms). Yalnız gecikme bu toleransın altında kaldığı hâlde fence olduysa sorun gerçek bir lease boşluğudur.
export const stallProbe = (tickMs = 50) => {
  let last = performance.now(), max = 0, win: [number, number] = [0, 0];
  const t0 = performance.now(), cpu0 = process.cpuUsage();
  syncSpans.on = true; syncSpans.list = [];
  const t = setInterval(() => { const n = performance.now(); if (n - last - tickMs > max) { max = n - last - tickMs; win = [last, n]; } last = n; }, tickMs);
  return {
    maxStallMs: () => Math.round(max),
    cpuMs: () => { const u = process.cpuUsage(cpu0); return Math.round((u.user + u.system) / 1000); },
    wallMs: () => Math.round(performance.now() - t0),
    // //TR: En uzun durma penceresiyle örtüşen senkron çağrılar (örtüşme ms'si, büyükten küçüğe, en çok 4) ve bunların pencerenin ne kadarını kapsadığı; kapsam düşükse durma kaydedilmeyen bir işten (CPU, GC, başka senkron G/Ç) gelmiştir.
    blockers: () => {
      const ov = syncSpans.list.map(s => ({what: s.what, ms: Math.min(s.t1, win[1]) - Math.max(s.t0, win[0])})).filter(s => s.ms > 0).sort((x, y) => y.ms - x.ms);
      const covered = Math.min(win[1] - win[0], ov.reduce((n, s) => n + s.ms, 0));
      return `${JSON.stringify(ov.slice(0, 4).map(s => `${s.what}=${Math.round(s.ms)}`))} covered=${Math.round(covered)}/${Math.round(win[1] - win[0])}ms`;
    },
    stop: () => { clearInterval(t); syncSpans.on = false; }
  };
};
// //TR: #224 tur 3 (coordinator delta review, 2 tur): stop() sonucu `finally` içinde YUTULMAZ. Gövde çalışır, sonra (her durumda) cleanup ve sınırlı stop yapılır; gövde hatası BİRİNCİL kalır ve aynı anda oluşan diğer sorunlar (cleanup fırlattı, stop() reddedildi, stop() asıldı) onun iletisine EKLENİR; gövde başarılıysa bu sorunların kendisi başarısızlıktır. Böylece asılı/reddedilen bir stop() testi geçirmez ve gövdenin gerçek hatasını da örtmez.
export const withFinalStop = async (stop: () => Promise<unknown>, body: () => Promise<void> | void, cleanup?: () => void, stopMs = 15_000): Promise<void> => {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
  let bodyFailed = false, bodyError: unknown;
  const also: string[] = [];
  try { await body(); } catch (e) { bodyFailed = true; bodyError = e; }
  try { cleanup?.(); } catch (e) { also.push(`cleanup threw: ${text(e)}`); }
  try { if (await stopWithin(stop(), stopMs) === "STOP_HUNG") also.push("the final stop() never settled"); } catch (e) { also.push(`the final stop() rejected: ${text(e)}`); }
  if (bodyFailed) {
    if (also.length === 0) throw bodyError;
    if (bodyError instanceof Error) { bodyError.message = `${bodyError.message} | ALSO: ${also.join("; ")}`; throw bodyError; }
    throw new Error(`${String(bodyError)} | ALSO: ${also.join("; ")}`, {cause: bodyError});
  }
  if (also.length > 0) throw new Error(also.join("; "));
};
export const procAlive = (pid: number) => { try { process.kill(pid, 0); } catch { return false; } return !(process.platform === "linux" && (() => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return ["Z", "X"].includes(st.slice(st.lastIndexOf(")") + 2, st.lastIndexOf(")") + 3)); } catch { return true; } })()); };
// //TR: Linux'ta `root`un tüm (zombi olmayan) torunları (/proc ppid zinciri); izleme dışı kalan öksüzleri (ppid 1'e geçmiş) bulmaz: çağıran, soy ağacını öldürmeden ÖNCE ölçmelidir.
export const descendantPids = (root: number): number[] => {
  const kids = new Map<number, number[]>();
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try { const st = fs.readFileSync(`/proc/${name}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" "); if (f[0] === "Z" || f[0] === "X") continue; const ppid = Number(f[1]); kids.set(ppid, [...(kids.get(ppid) ?? []), Number(name)]); } catch { /* süreç bitti */ }
  }
  const out: number[] = [];
  for (const queue = [root]; queue.length;) for (const k of kids.get(queue.shift()!) ?? []) { out.push(k); queue.push(k); }
  return out;
};
// //TR: Linux'ta zombi (Z) üyeler yazamaz ve sayılmaz (reaper'sız kapta öldürülen grubun zombileri kill(-pgid, 0)'ı sonsuza dek başarılı tutar); diğer platformlarda kill(…, 0).
export const groupLive = (pgid: number): boolean => {
  if (process.platform !== "linux") { try { process.kill(process.platform === "win32" ? pgid : -pgid, 0); return true; } catch { return false; } }
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try { const st = fs.readFileSync(`/proc/${name}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" "); if (Number(f[2]) === pgid && f[0] !== "Z" && f[0] !== "X") return true; } catch { /* süreç bitti */ }
  }
  return false;
};
