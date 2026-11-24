// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-operations.test.ts tarafından içe aktarılır) UASCO-T0111 maliyet telemetrisi çekirdeğini YALNIZ sentetik get_session biçimli fikstürlerle sınar: fail-closed ayrıştırma (eksik maliyet UNKNOWN, negatif/metin/NaN red), oturum başına en son anlık görüntü, günlük toplam, bütçe kararı (UNKNOWN asla CONTINUE değil) ve anlık görüntü şema doğrulaması. Gerçek oturum maliyet verisi yoktur.
import {describe, it, expect} from "vitest";
import {parseSessionCost, aggregateDaily, decideBudget, mayContinue, buildDailySnapshot, validateDailySnapshot, latestPerSession, CostTelemetryError, COST_TELEMETRY_SCHEMA, type CostRecord} from "../../core/ops/cost-telemetry.js";

// Synthetic fixtures only (made-up ids, costs and token counts); no real session data.
const AT = "2026-11-05T10:00:00Z";
const raw = (id: string, meta: Record<string, unknown> | null | undefined, extra: Record<string, unknown> = {}) => ({id, title: "synthetic", session_context: {model: "model-configured"}, external_metadata: meta, ...extra});
const usage = {input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 5};
const rec = (r: unknown, at = AT): CostRecord => { const p = parseSessionCost(r, at); if (!p.ok) throw new Error(p.code); return p.record; };
const code = (r: unknown, at = AT) => { const p = parseSessionCost(r, at); return p.ok ? "OK" : p.code; };

export function registerCostTelemetryCases(): void {
  describe("UASCO-T0111 dev-plane cost telemetry core (pure; synthetic get_session-shaped fixtures)", () => {
    it("parses a full record: API-equivalent cost, token types, served model preferred, routine fire from trigger_id", () => {
      const r = rec(raw("session_A1", {cost_usd: 1.25, last_served_model: "model-served", usage}));
      expect(r).toEqual({sessionId: "session_A1", kind: "SESSION", model: "model-served", capturedAt: AT, day: "2026-11-05", costState: "KNOWN", costUsd: 1.25,
        tokens: {input: 100, output: 20, cacheRead: 900, cacheCreation: 5}, basis: "API_EQUIVALENT"});
      expect(rec(raw("session_A2", {cost_usd: 0}, {trigger_id: "trig_x"})).kind).toBe("ROUTINE_FIRE");
      expect(rec(raw("session_A3", {cost_usd: 0}, {trigger_id: ""})).kind).toBe("SESSION");
      expect(rec(raw("session_A4", {cost_usd: 0})).model).toBe("model-configured");   // falls back to the configured model
      expect(rec(raw("session_A5", {cost_usd: 0})).costState).toBe("KNOWN");             // an explicit 0 is a known 0
    });
    it("a missing or null cost is UNKNOWN (never 0); missing token fields are null", () => {
      for (const meta of [undefined, null, {}, {cost_usd: null}]) {
        const r = rec(raw("session_U1", meta as never));
        expect(r.costState).toBe("UNKNOWN"); expect(r.costUsd).toBeNull();
        expect(r.tokens).toEqual({input: null, output: null, cacheRead: null, cacheCreation: null});
      }
      expect(rec(raw("session_U2", {cost_usd: 1, usage: {input_tokens: 3}})).tokens).toEqual({input: 3, output: null, cacheRead: null, cacheCreation: null});
    });
    it("rejects malformed input fail-closed (no coercion) and accepts the corrected positive control", () => {
      expect(code(null)).toBe("NOT_OBJECT"); expect(code([])).toBe("NOT_OBJECT");
      for (const id of ["", "sess_1", "session_", "session_a-b", 5]) expect(code(raw(id as never, {cost_usd: 1})), String(id)).toBe("SESSION_ID_INVALID");
      for (const at of ["", "2026-11-05", "2026-11-05T10:00:00+01:00", "2026-02-30T10:00:00Z", "not a date"]) expect(code(raw("session_C1", {cost_usd: 1}), at), at).toBe("CAPTURED_AT_INVALID");
      for (const c of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, "1.5", true, {}]) expect(code(raw("session_C2", {cost_usd: c})), String(c)).toBe("COST_INVALID");
      for (const u of [[], "x", {input_tokens: -1}, {output_tokens: 1.5}, {cache_read_input_tokens: "9"}, {cache_creation_input_tokens: 2 ** 60}]) expect(code(raw("session_C3", {cost_usd: 1, usage: u})), JSON.stringify(u)).toBe("TOKENS_INVALID");
      expect(code(raw("session_C4", "meta" as never))).toBe("METADATA_INVALID");
      expect(code(raw("session_C5", {cost_usd: 1, last_served_model: 7}))).toBe("MODEL_INVALID");
      expect(code(raw("session_C5", {cost_usd: 1, last_served_model: "  "}))).toBe("MODEL_INVALID");
      expect(code(raw("session_C6", {cost_usd: 1}, {trigger_id: 3}))).toBe("TRIGGER_INVALID");
      expect(code(raw("session_C7", {cost_usd: 1.5, usage, last_served_model: "m"}), "2026-11-05T10:00:00.123Z")).toBe("OK");
    });
    it("aggregates the latest snapshot per session for one day; unknown cost makes the day INCOMPLETE", () => {
      const rs = [
        rec(raw("session_S1", {cost_usd: 1, usage}), "2026-11-05T01:00:00Z"),
        rec(raw("session_S1", {cost_usd: 3, usage}), "2026-11-05T05:00:00Z"),   // cumulative: supersedes the 1.00 capture
        rec(raw("session_S2", {cost_usd: 0.1}, {trigger_id: "trig_r"}), "2026-11-05T02:00:00Z"),
        rec(raw("session_S2", {cost_usd: 0.2}, {trigger_id: "trig_r"}), "2026-11-05T03:00:00Z"),
        rec(raw("session_S3", {cost_usd: 99}), "2026-11-04T23:59:59Z"),          // other day: ignored
      ];
      const a = aggregateDaily(rs, "2026-11-05");
      expect(a).toEqual({day: "2026-11-05", sessions: 1, routineFires: 1, knownCostUsd: 3.2, unknownCostCount: 0, completeness: "COMPLETE",
        tokens: {input: 100, output: 20, cacheRead: 900, cacheCreation: 5, unknownTokenFields: 4}});
      const b = aggregateDaily([...rs, rec(raw("session_S4", {}), "2026-11-05T06:00:00Z")], "2026-11-05");
      expect(b.unknownCostCount).toBe(1); expect(b.completeness).toBe("INCOMPLETE"); expect(b.knownCostUsd).toBe(3.2);
      expect(aggregateDaily([], "2026-11-05")).toMatchObject({sessions: 0, routineFires: 0, knownCostUsd: 0, completeness: "COMPLETE"});
      expect(() => aggregateDaily(rs, "2026-11-5")).toThrow(CostTelemetryError);
      const conflict = [rec(raw("session_D1", {cost_usd: 1})), rec(raw("session_D1", {cost_usd: 2}))];
      expect(() => latestPerSession(conflict, "2026-11-05")).toThrow("DUPLICATE_CONFLICT:session_D1");
      expect(latestPerSession([conflict[0], conflict[0]], "2026-11-05")).toHaveLength(1);   // an identical re-capture is not a conflict
    });
    it("decideBudget: STOP at/over the threshold, UNKNOWN while any cost is unknown or the threshold is invalid, CONTINUE only when complete and under", () => {
      const known = (c: number) => aggregateDaily([rec(raw("session_B1", {cost_usd: c}))], "2026-11-05");
      const withUnknown = (c: number) => aggregateDaily([rec(raw("session_B1", {cost_usd: c})), rec(raw("session_B2", {}))], "2026-11-05");
      expect(decideBudget(known(4.99), 5)).toEqual({decision: "CONTINUE", reason: "UNDER_THRESHOLD", spentKnownUsd: 4.99, thresholdUsd: 5, remainingKnownUsd: 0.01});
      expect(decideBudget(known(5), 5).decision).toBe("STOP");
      expect(decideBudget(known(7), 5)).toMatchObject({decision: "STOP", reason: "THRESHOLD_REACHED", remainingKnownUsd: -2});
      expect(decideBudget(withUnknown(1), 5)).toMatchObject({decision: "UNKNOWN", reason: "COST_UNKNOWN:1"});
      expect(decideBudget(withUnknown(6), 5).decision).toBe("STOP");   // known spend alone is over: unknown can only add
      for (const t of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5" as never]) expect(decideBudget(known(1), t).reason, String(t)).toBe("THRESHOLD_INVALID");
      const all = [decideBudget(known(1), 5), decideBudget(known(5), 5), decideBudget(withUnknown(1), 5), decideBudget(known(1), 0)];
      expect(all.map(v => [v.decision, mayContinue(v)])).toEqual([["CONTINUE", true], ["STOP", false], ["UNKNOWN", false], ["UNKNOWN", false]]);
    });
    it("daily snapshot: builds, JSON round-trips and validates; tampering is rejected", () => {
      const rs = [rec(raw("session_N1", {cost_usd: 2, usage}), "2026-11-05T01:00:00Z"), rec(raw("session_N2", {}, {trigger_id: "trig_q"}), "2026-11-05T02:00:00Z")];
      const snap = JSON.parse(JSON.stringify(buildDailySnapshot(rs, "2026-11-05")));
      expect(snap.schema).toBe(COST_TELEMETRY_SCHEMA);
      expect(validateDailySnapshot(snap)).toMatchObject({ok: true});
      const bad = (mut: (s: any) => void) => { const s = JSON.parse(JSON.stringify(snap)); mut(s); const r = validateDailySnapshot(s); return r.ok ? "OK" : r.code; };
      expect(bad(s => { s.aggregate.knownCostUsd = 0; })).toBe("AGGREGATE_MISMATCH");
      expect(bad(s => { s.records[1].costState = "KNOWN"; })).toBe("RECORD_COST:session_N2");          // unknown dressed up as known
      expect(bad(s => { s.records[1].costUsd = 0; })).toBe("RECORD_COST:session_N2");                  // unknown silently turned into 0
      expect(bad(s => { s.records[0].costUsd = -1; })).toBe("RECORD_COST:session_N1");
      expect(bad(s => { s.records.push(s.records[0]); })).toBe("RECORD_DUPLICATE:session_N1");
      expect(bad(s => { s.records[0].day = "2026-11-04"; })).toBe("RECORD_DAY:session_N1");
      expect(bad(s => { s.records[0].tokens.input = -5; })).toBe("RECORD_TOKENS:session_N1");
      expect(bad(s => { s.basis = "BILLED"; })).toBe("BASIS_INVALID");
      expect(bad(s => { s.schema = "v0"; })).toBe("SCHEMA_MISMATCH");
      expect(bad(s => { s.extra = 1; })).toBe("UNKNOWN_KEY:extra");
      expect(bad(s => { s.records.pop(); })).toBe("AGGREGATE_MISMATCH");
      expect(bad(() => {})).toBe("OK");
    });
  });
}
