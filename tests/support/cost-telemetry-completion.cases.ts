// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-operations.test.ts tarafından içe aktarılır) UASCO-T0111'in tamamlayıcı kısmını YALNIZ sentetik fikstürlerle sınar: 7 günlük seri (eksik gün
// MISSING, maliyeti null; hiçbir zaman 0), atomik anlık görüntü deposu, bütçe kapısı çıkış kodları (yalnız CONTINUE 0), çevrimdışı CLI uçtan uca (tsx alt süreci; ağ yok) ve
// JSON şemasının (core/ops/cost-telemetry-daily.schema.json) çekirdek doğrulayıcıyla uyumu. Gerçek oturum maliyeti verisi depoya girmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import {parseSessionCost, buildDailySnapshot, buildCostSeries, shiftDay, validateDailySnapshot, CostTelemetryError, COST_SERIES_SCHEMA, type CostRecord} from "../../core/ops/cost-telemetry.js";
import {writeDailySnapshot, readSnapshots, readSeries, runCostGate, snapshotFromDump, recordsFromDump, GATE_EXIT, snapshotPath} from "../../core/ops/cost-telemetry-store.js";
import {runCli, parseArgs} from "../../core/ops/cost-telemetry-cli.js";

const ROOT = path.resolve(__dirname, "..", "..");
const raw = (id: string, meta: Record<string, unknown> | null | undefined, extra: Record<string, unknown> = {}) => ({id, session_context: {model: "model-configured"}, external_metadata: meta, ...extra});
const rec = (r: unknown, at: string): CostRecord => { const p = parseSessionCost(r, at); if (!p.ok) throw new Error(p.code); return p.record; };
const snap = (day: string, costs: Array<number | null>) => buildDailySnapshot(costs.map((c, i) => rec(raw(`session_S${i}`, c === null ? {} : {cost_usd: c}), `${day}T12:00:00Z`)), day);

let tmp = "";
export function registerCostTelemetryCompletionCases(): void {
  describe("UASCO-T0111 completion: 7-day series, snapshot store, budget gate, offline CLI, JSON schema (synthetic fixtures; no provider call)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-cost-")); });
    afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("shiftDay walks UTC calendar days across month/year ends and rejects malformed or rolled-over days", () => {
      expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
      expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
      expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
      for (const d of ["2026-02-30", "2026-13-01", "2026-1-01", ""]) expect(() => shiftDay(d, 0), d).toThrow("DAY_INVALID");
    });

    it("buildCostSeries: 7 days ending at endDay; a day without a snapshot is MISSING with null cost (never 0); totals are a lower bound unless all 7 days are COMPLETE", () => {
      const s = buildCostSeries([snap("2026-11-05", [1.5, 0.5]), snap("2026-11-03", [2, null]), snap("2026-10-01", [99])], "2026-11-05");
      expect(s.schema).toBe(COST_SERIES_SCHEMA);
      expect(s.days.map(d => d.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
      expect(s.days.map(d => d.state)).toEqual(["MISSING", "MISSING", "MISSING", "MISSING", "INCOMPLETE", "MISSING", "COMPLETE"]);
      expect(s.days[0]).toEqual({day: "2026-10-30", state: "MISSING", knownCostUsd: null, unknownCostCount: null, sessions: null, routineFires: null});
      expect(s.days[4]).toMatchObject({knownCostUsd: 2, unknownCostCount: 1});
      expect(s.totals).toEqual({knownCostUsd: 4, daysComplete: 1, daysIncomplete: 1, daysMissing: 5, completeness: "INCOMPLETE"});   // out-of-window 99 ignored
      const full = buildCostSeries(Array.from({length: 7}, (_, i) => snap(shiftDay("2026-11-05", -i), [1])), "2026-11-05");
      expect(full.totals).toEqual({knownCostUsd: 7, daysComplete: 7, daysIncomplete: 0, daysMissing: 0, completeness: "COMPLETE"});
      expect(() => buildCostSeries([snap("2026-11-05", [1]), snap("2026-11-05", [2])], "2026-11-05")).toThrow("SERIES_DUPLICATE_DAY:2026-11-05");
      const tampered = {...snap("2026-11-05", [1]), aggregate: {...snap("2026-11-05", [1]).aggregate, knownCostUsd: 0}};
      expect(() => buildCostSeries([tampered], "2026-11-05")).toThrow("SNAPSHOT_INVALID:AGGREGATE_MISMATCH");
      for (const d of [0, 367, 1.5]) expect(() => buildCostSeries([], "2026-11-05", d)).toThrow("SERIES_DAYS_INVALID");
      expect(buildCostSeries([], "2026-11-05", 1).totals).toMatchObject({knownCostUsd: 0, daysMissing: 1, completeness: "INCOMPLETE"});
    });

    it("store: atomic validated write to <dir>/<day>.json (replaces a same-day earlier capture), refuses invalid snapshots and relative dirs, reads the window only", () => {
      const f = writeDailySnapshot(tmp, snap("2026-11-05", [1]));
      expect(f).toBe(path.join(tmp, "2026-11-05.json"));
      expect(validateDailySnapshot(JSON.parse(fs.readFileSync(f, "utf8"))).ok).toBe(true);
      writeDailySnapshot(tmp, snap("2026-11-05", [3]));   // later cumulative capture of the same day
      expect(JSON.parse(fs.readFileSync(f, "utf8")).aggregate.knownCostUsd).toBe(3);
      expect(fs.readdirSync(tmp)).toEqual(["2026-11-05.json"]);   // no temp file left behind
      const bad = {...snap("2026-11-04", [1]), basis: "BILLED"} as never;
      expect(() => writeDailySnapshot(tmp, bad)).toThrow("SNAPSHOT_INVALID:BASIS_INVALID");
      expect(fs.existsSync(path.join(tmp, "2026-11-04.json"))).toBe(false);
      expect(() => writeDailySnapshot("relative/dir", snap("2026-11-05", [1]))).toThrow("DIR_NOT_ABSOLUTE");
      expect(() => snapshotPath(tmp, "../x")).toThrow("DAY_INVALID");
      writeDailySnapshot(tmp, snap("2026-10-01", [50]));
      expect(readSnapshots(tmp, "2026-11-05")).toHaveLength(1);
      expect(readSeries(tmp, "2026-11-05").totals.knownCostUsd).toBe(3);
      fs.writeFileSync(path.join(tmp, "2026-11-03.json"), "{not json");
      expect(() => readSnapshots(tmp, "2026-11-05")).toThrow("SNAPSHOT_UNREADABLE:2026-11-03.json");
    });

    it("gate: exit 0 only for CONTINUE; STOP=3 at/over threshold; UNKNOWN=4 for an unknown cost, a missing/unreadable/tampered snapshot or an invalid threshold", () => {
      writeDailySnapshot(tmp, snap("2026-11-05", [1, 2]));
      expect(runCostGate(tmp, "2026-11-05", 5)).toMatchObject({exitCode: GATE_EXIT.CONTINUE, verdict: {decision: "CONTINUE", spentKnownUsd: 3}});
      expect(runCostGate(tmp, "2026-11-05", 3)).toMatchObject({exitCode: GATE_EXIT.STOP, verdict: {decision: "STOP"}});
      expect(runCostGate(tmp, "2026-11-05", 0)).toMatchObject({exitCode: GATE_EXIT.UNKNOWN, verdict: {reason: "THRESHOLD_INVALID"}});
      expect(runCostGate(tmp, "2026-11-04", 5)).toMatchObject({exitCode: GATE_EXIT.UNKNOWN, verdict: {decision: "UNKNOWN", reason: "SNAPSHOT_MISSING", remainingKnownUsd: null}});
      writeDailySnapshot(tmp, snap("2026-11-03", [1, null]));
      expect(runCostGate(tmp, "2026-11-03", 5)).toMatchObject({exitCode: GATE_EXIT.UNKNOWN, verdict: {reason: "COST_UNKNOWN:1"}});
      const f = path.join(tmp, "2026-11-05.json"), s = JSON.parse(fs.readFileSync(f, "utf8"));
      s.aggregate.knownCostUsd = 0; fs.writeFileSync(f, JSON.stringify(s));
      expect(runCostGate(tmp, "2026-11-05", 5)).toMatchObject({exitCode: GATE_EXIT.UNKNOWN, verdict: {reason: "SNAPSHOT_INVALID:AGGREGATE_MISMATCH"}});
      fs.writeFileSync(f, "{");
      expect(runCostGate(tmp, "2026-11-05", 5).verdict.reason).toBe("SNAPSHOT_UNREADABLE");
      // a snapshot of another day saved under this day's name is refused
      fs.writeFileSync(path.join(tmp, "2026-11-02.json"), JSON.stringify(snap("2026-11-01", [1])));
      expect(runCostGate(tmp, "2026-11-02", 5).verdict.reason).toBe("SNAPSHOT_INVALID:DAY_MISMATCH");
    });

    it("dump -> snapshot: one malformed session rejects the whole dump (never silently skipped); routine fires and token types are kept", () => {
      const at = "2026-11-05T09:00:00Z";
      const dump = {capturedAt: at, sessions: [raw("session_A1", {cost_usd: 1, usage: {input_tokens: 10, output_tokens: 2}}), raw("session_A2", {cost_usd: 0.5}, {trigger_id: "trig_1"})]};
      const r = snapshotFromDump(dump, tmp);
      expect(r.file).toBe(path.join(tmp, "2026-11-05.json"));
      expect(r.snapshot.aggregate).toMatchObject({sessions: 1, routineFires: 1, knownCostUsd: 1.5, tokens: {input: 10, output: 2}});
      expect(() => recordsFromDump({capturedAt: at, sessions: [dump.sessions[0], raw("session_B1", {cost_usd: -1})]})).toThrow("DUMP_RECORD_INVALID:1:COST_INVALID");
      for (const d of [null, [], {sessions: []}, {capturedAt: at}]) expect(() => recordsFromDump(d)).toThrow(CostTelemetryError);
    });

    it("CLI (in-process and as a real tsx child process): snapshot -> series -> gate, exit codes propagate; bad arguments are input errors (exit 2), never 0", () => {
      const dumpFile = path.join(tmp, "dump.json"), out = path.join(tmp, "daily");
      fs.writeFileSync(dumpFile, JSON.stringify({capturedAt: "2026-11-05T09:00:00Z", sessions: [raw("session_C1", {cost_usd: 2})]}));
      expect(runCli(["snapshot", "--input", dumpFile, "--out", out]).exitCode).toBe(0);
      expect(JSON.parse(runCli(["series", "--dir", out, "--end", "2026-11-05"]).out).totals).toMatchObject({knownCostUsd: 2, daysMissing: 6});
      expect(runCli(["gate", "--dir", out, "--day", "2026-11-05", "--threshold", "5"]).exitCode).toBe(0);
      expect(runCli(["gate", "--dir", out, "--day", "2026-11-05", "--threshold", "2"]).exitCode).toBe(3);
      expect(runCli(["gate", "--dir", out, "--day", "2026-11-04", "--threshold", "5"]).exitCode).toBe(4);
      for (const a of [["gate", "--dir", out], ["nope"], ["gate", "--dir"], ["series", "--dir", out, "--end", "2026-11-05", "--days", "x"]]) expect(runCli(a).exitCode, a.join(" ")).toBe(2);
      expect(() => parseArgs(["x", "-bad", "1"])).toThrow("ARG_INVALID");
      const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
      const run = (args: string[]) => spawnSync(process.execPath, [tsx, path.join(ROOT, "core", "ops", "cost-telemetry-cli.ts"), ...args], {encoding: "utf8", timeout: 60_000});
      const stop = run(["gate", "--dir", out, "--day", "2026-11-05", "--threshold", "1"]);
      expect([stop.status, JSON.parse(stop.stdout).decision]).toEqual([3, "STOP"]);
      const unknown = run(["gate", "--dir", out, "--day", "2026-11-01", "--threshold", "10"]);
      expect([unknown.status, JSON.parse(unknown.stdout).reason]).toEqual([4, "SNAPSHOT_MISSING"]);
    });

    it("JSON schema (core/ops/cost-telemetry-daily.schema.json) accepts what the core builds and rejects what the core validator rejects", () => {
      const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "core", "ops", "cost-telemetry-daily.schema.json"), "utf8"));
      const ajv = new (Ajv2020 as unknown as new (o: object) => {compile: (s: object) => ((d: unknown) => boolean)})({strict: true, allErrors: true});
      const validate = ajv.compile(schema);
      const good = snap("2026-11-05", [1.25, null]);
      expect(validate(good)).toBe(true);
      expect(validate(snap("2026-11-05", []))).toBe(true);
      const mut = (f: (s: any) => void) => { const s = JSON.parse(JSON.stringify(good)); f(s); return s; };
      for (const [name, f] of [
        ["unknown cost stored as 0", (s: any) => { s.records[1].costUsd = 0; }],
        ["known cost missing", (s: any) => { s.records[0].costUsd = null; }],
        ["negative cost", (s: any) => { s.records[0].costUsd = -1; }],
        ["billed basis", (s: any) => { s.basis = "BILLED"; }],
        ["extra key", (s: any) => { s.extra = 1; }],
        ["extra record key", (s: any) => { s.records[0].note = "x"; }],
        ["fractional token", (s: any) => { s.records[0].tokens.input = 1.5; }],
        ["bad session id", (s: any) => { s.records[0].sessionId = "x"; }],
        ["extra token key", (s: any) => { s.records[0].tokens.reasoning = 1; }],
        ["non-string model", (s: any) => { s.records[0].model = 7; }]
      ] as Array<[string, (s: any) => void]>) {
        const s = mut(f);
        expect(validate(s), name).toBe(false);
        expect(validateDailySnapshot(s).ok, name).toBe(false);
      }
    });
  });
}
