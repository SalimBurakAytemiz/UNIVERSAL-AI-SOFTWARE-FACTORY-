// //TR: UASCO-T0111 Bu dosya maliyet telemetrisinin YALNIZ yerel dosya G/Ç katmanıdır: doğrulanmış günlük anlık görüntüyü <dir>/<YYYY-MM-DD>.json olarak atomik yazar
// (geçici dosya + rename), pencere içindeki günleri okur ve bütçe kapısını çalıştırır. Ağ, model, sağlayıcı veya ücretli çağrı YOKTUR (D-08 = 0 USD): girdi, koordinatörün
// kaydettiği get_session biçimli bir döküm dosyasıdır. Eksik gün/maliyet asla 0 sayılmaz: kapı, o günün anlık görüntüsü yoksa ya da maliyet bilinmiyorsa UNKNOWN döner.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {buildCostSeries, buildDailySnapshot, decideBudget, parseSessionCost, shiftDay, validateDailySnapshot, CostTelemetryError,
  type BudgetVerdict, type CostRecord, type CostSeries, type DailySnapshot} from "./cost-telemetry.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Bütçe kapısının süreç çıkış kodları: yalnız CONTINUE 0'dır; çağıran (koordinatör) 0 dışındaki her kodda durmalıdır. */
export const GATE_EXIT = Object.freeze({CONTINUE: 0, INPUT_ERROR: 2, STOP: 3, UNKNOWN: 4});

function absDir(dir: string): string {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new CostTelemetryError("DIR_NOT_ABSOLUTE");
  return dir;
}
export const snapshotPath = (dir: string, day: string): string => {
  if (!DAY.test(day)) throw new CostTelemetryError("DAY_INVALID");
  return path.join(absDir(dir), `${day}.json`);
};

/** get_session biçimli döküm: {capturedAt, sessions:[...]}. Bir kayıt bile bozuksa bütün döküm reddedilir (sessizce atlanmaz). */
export function recordsFromDump(raw: unknown): CostRecord[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CostTelemetryError("DUMP_INVALID");
  const d = raw as {capturedAt?: unknown; sessions?: unknown};
  if (typeof d.capturedAt !== "string" || !Array.isArray(d.sessions)) throw new CostTelemetryError("DUMP_INVALID");
  const out: CostRecord[] = [], bad: string[] = [];
  d.sessions.forEach((s, i) => { const p = parseSessionCost(s, d.capturedAt as string); if (p.ok) out.push(p.record); else bad.push(`${i}:${p.code}`); });
  if (bad.length) throw new CostTelemetryError(`DUMP_RECORD_INVALID:${bad.slice(0, 10).join(",")}`);
  return out;
}

/** Doğrulanmış günlük anlık görüntüyü atomik yazar; aynı günün dosyası varsa (kümülatif maliyetin daha yeni yakalaması) yenisiyle değiştirilir. */
export function writeDailySnapshot(dir: string, snapshot: DailySnapshot): string {
  const v = validateDailySnapshot(snapshot);
  if (!v.ok) throw new CostTelemetryError(`SNAPSHOT_INVALID:${v.code}`);
  const file = snapshotPath(dir, snapshot.day);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try { fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, {flag: "wx"}); fs.renameSync(tmp, file); }
  finally { try { fs.rmSync(tmp, {force: true}); } catch { /* yok */ } }
  return file;
}

/** Pencere içindeki (endDay dahil, geriye `days` gün) anlık görüntüleri okur; dosyası olmayan gün atlanır (seride MISSING olur), bozuk dosya fırlatır. */
export function readSnapshots(dir: string, endDay: string, days = 7): unknown[] {
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw new CostTelemetryError("SERIES_DAYS_INVALID");
  const out: unknown[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const file = snapshotPath(dir, shiftDay(endDay, -i));
    if (!fs.existsSync(file)) continue;
    try { out.push(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { throw new CostTelemetryError(`SNAPSHOT_UNREADABLE:${path.basename(file)}`); }
  }
  return out;
}
export function readSeries(dir: string, endDay: string, days = 7): CostSeries { return buildCostSeries(readSnapshots(dir, endDay, days), endDay, days); }

/** Bütçe kapısı: o günün anlık görüntüsü yoksa UNKNOWN (SNAPSHOT_MISSING), bozuksa UNKNOWN (SNAPSHOT_INVALID); aksi halde decideBudget. */
export function runCostGate(dir: string, day: string, thresholdUsd: number): {verdict: BudgetVerdict; exitCode: number} {
  const file = snapshotPath(dir, day);
  const unknown = (reason: string) => ({verdict: {decision: "UNKNOWN" as const, reason, spentKnownUsd: 0, thresholdUsd: Number.isFinite(thresholdUsd) && thresholdUsd > 0 ? thresholdUsd : null, remainingKnownUsd: null}, exitCode: GATE_EXIT.UNKNOWN});
  if (!fs.existsSync(file)) return unknown("SNAPSHOT_MISSING");
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return unknown("SNAPSHOT_UNREADABLE"); }
  const v = validateDailySnapshot(raw);
  if (!v.ok || v.snapshot.day !== day) return unknown(`SNAPSHOT_INVALID:${v.ok ? "DAY_MISMATCH" : v.code}`);
  const verdict = decideBudget(v.snapshot.aggregate, thresholdUsd);
  return {verdict, exitCode: verdict.decision === "CONTINUE" ? GATE_EXIT.CONTINUE : verdict.decision === "STOP" ? GATE_EXIT.STOP : GATE_EXIT.UNKNOWN};
}

/** Döküm -> günlük anlık görüntü -> dosya. `day` verilmezse dökümün yakalama günü kullanılır. */
export function snapshotFromDump(dump: unknown, dir: string, day?: string): {file: string; snapshot: DailySnapshot} {
  const records = recordsFromDump(dump);
  const d = day ?? String((dump as {capturedAt: string}).capturedAt).slice(0, 10);
  const snapshot = buildDailySnapshot(records, d);
  return {file: writeDailySnapshot(dir, snapshot), snapshot};
}
