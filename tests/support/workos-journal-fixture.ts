// //TR: UASCO-T0118: Work OS journal fikstürü. Çok sayıda run gerektiren testler (ör. 503 run) store API'si ile kurulursa her yazı tüm journal'ı yeniden doğruladığı için maliyet karesel büyür (Linux 55 sn, Windows >180 sn). Bu yardımcı girdi şekillerini GERÇEK store'un kendi yazdığı bir şablon journal'dan alır, kimlik/zaman alanlarını değiştirip zinciri store'un kullandığı sha256 (automation/lib/atomic-json.mjs) ile yeniden hesaplar; sonuç journal'ı GERÇEK store load()/replay doğrular (yanlış kopya yüksek sesle düşer). İddia gevşetmez, yalnız fikstür kurulumunu doğrusal yapar.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (store ile aynı sha256 yeniden kullanılır, kopyalanmaz)
import {sha256 as sha256Untyped} from "../../automation/lib/atomic-json.mjs";
import {WorkOsStore} from "../../core/workos/store.js";

const sha256 = sha256Untyped as (value: unknown) => string;
export const JOURNAL_GENESIS = "0".repeat(64);
export interface FixtureEntry { seq: number; prevHash: string; type: string; actor: string; at: string; payload: Record<string, unknown>; hash: string }
export type EntryBody = Pick<FixtureEntry, "type" | "actor" | "at" | "payload">;

export const journalPath = (dataDir: string) => path.join(dataDir, "journal.jsonl");
export function readJournal(dataDir: string): FixtureEntry[] {
  return fs.readFileSync(journalPath(dataDir), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}
// Same construction as the store's private append(): body = {seq, prevHash, type, actor, at, payload}, hash = sha256(body).
export function chainEntries(bodies: EntryBody[], start: {seq: number; hash: string} = {seq: 0, hash: JOURNAL_GENESIS}): FixtureEntry[] {
  const out: FixtureEntry[] = [];
  let seq = start.seq, prev = start.hash;
  for (const b of bodies) {
    const body = {seq: ++seq, prevHash: prev, type: b.type, actor: b.actor, at: b.at, payload: b.payload};
    const entry = {...body, hash: sha256(body)};
    out.push(entry); prev = entry.hash;
  }
  return out;
}
export function writeJournal(dataDir: string, entries: FixtureEntry[]): void {
  fs.mkdirSync(dataDir, {recursive: true});
  fs.writeFileSync(journalPath(dataDir), entries.map(e => JSON.stringify(e) + "\n").join(""));
}
const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g;
const TITLE = "UASCO_T0118_FILLER_TITLE";

// Template = what the REAL store writes for: project, then one mission DRAFT->PREFLIGHT->AUTHORIZED with one queued run.
export function realTemplate(tenantId = "tA"): {project: FixtureEntry; perRun: FixtureEntry[]; projectId: string; missionId: string; runId: string} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-journal-tpl-"));
  try {
    const store = new WorkOsStore(dir);
    const p = store.createProject({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
    const m = store.createMission({tenantId, projectId: p.projectId, title: TITLE, objective: "O", acceptanceCriteria: ["c"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId}, m.missionId, to, "test", "FOUNDER_LOCAL");
    const run = store.createRun({tenantId, missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: "FOUNDER_LOCAL"});
    const all = readJournal(dir);
    return {project: all[0], perRun: all.slice(1), projectId: p.projectId, missionId: m.missionId, runId: run.runId};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

// Writes a journal with one project and `count` queued runs (mission i titled `M${i}`, timestamps strictly increasing from `baseMs`).
// Returns ids in creation order. The journal is only trusted once the real WorkOsStore loads it.
export function writeFillerRunsJournal(dataDir: string, count: number, opts: {tenantId?: string; baseMs?: number} = {}): {projectId: string; missionIds: string[]; runIds: string[]} {
  const tpl = realTemplate(opts.tenantId ?? "tA");
  const baseMs = opts.baseMs ?? Date.parse("2026-01-01T00:00:00.000Z");
  const stamps = [...new Set(tpl.perRun.flatMap(e => JSON.stringify({at: e.at, payload: e.payload}).match(ISO) ?? []))];
  const bodies: EntryBody[] = [{type: tpl.project.type, actor: tpl.project.actor, at: new Date(baseMs - 1000).toISOString(), payload: tpl.project.payload}];
  const projectStamps = JSON.stringify(tpl.project.payload).match(ISO) ?? [];
  for (const s of projectStamps) bodies[0].payload = JSON.parse(JSON.stringify(bodies[0].payload).split(s).join(bodies[0].at));
  const missionIds: string[] = [], runIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const mId = newId("msn"), rId = newId("run");
    missionIds.push(mId); runIds.push(rId);
    for (const e of tpl.perRun) {
      let s = JSON.stringify({type: e.type, actor: e.actor, at: e.at, payload: e.payload});
      s = s.split(tpl.missionId).join(mId).split(tpl.runId).join(rId).split(TITLE).join(`M${i}`);
      stamps.forEach((st, k) => { s = s.split(st).join(new Date(baseMs + i * 1000 + k).toISOString()); });
      bodies.push(JSON.parse(s));
    }
  }
  writeJournal(dataDir, chainEntries(bodies));
  return {projectId: tpl.projectId, missionIds, runIds};
}
