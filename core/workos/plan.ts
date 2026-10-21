//TR: Bu dosya bir mission'ın görev planını (sıralı görevler + bağımlılıklar) doğrular ve Work OS store'un genel createTask yöntemiyle kalıcı yazar; mission başına tek plan, aynı gövde tekrarında idempotent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AjvModule from "ajv";
import type {Scope, WorkTask} from "./types.js";
import type {WorkOsStore} from "./store.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
export const planCreateSchema = {
  type: "object", additionalProperties: false, required: ["tasks"],
  properties: {
    tasks: {
      type: "array", minItems: 1, maxItems: 50,
      items: {
        type: "object", additionalProperties: false, required: ["title"],
        properties: {
          title: {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"},
          // Yalnız önceki görevlerin dizinleri: döngü yapı gereği imkansızdır.
          dependsOn: {type: "array", maxItems: 49, uniqueItems: true, items: {type: "integer", minimum: 0, maximum: 48}}
        }
      }
    }
  }
} as const;
const check = ajv.compile(planCreateSchema);
export interface PlanInput { tasks: {title: string; dependsOn?: number[]}[] }
export function validatePlanCreate(x: unknown): {ok: true} | {ok: false; errors: string} {
  if (!check(x)) return {ok: false, errors: ajv.errorsText(check.errors, {separator: " | "})};
  const tasks = (x as PlanInput).tasks;
  for (let i = 0; i < tasks.length; i++) for (const d of tasks[i].dependsOn ?? []) if (d >= i) return {ok: false, errors: `tasks[${i}].dependsOn must reference an earlier task`};
  return {ok: true};
}

export type PlanErrorCode = "PLAN_ALREADY_EXISTS" | "MISSION_NOT_PLANNABLE" | "PLAN_STORE_CORRUPT" | "PLAN_MISSION_NOT_FOUND";
export class PlanError extends Error { constructor(readonly code: PlanErrorCode) { super(code); this.name = "PlanError"; } }
interface PlanRecord { missionId: string; tenantId: string; digest: string; taskIds: string[]; createdAt: string; createdBy: string }
const PLANNABLE = new Set(["DRAFT", "PREFLIGHT", "AUTHORIZED", "PLANNED"]);
const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
const file = (dir: string) => path.join(dir, "plans.jsonl");
function readPlans(dir: string): PlanRecord[] {
  if (!fs.existsSync(file(dir))) return [];
  try { return fs.readFileSync(file(dir), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as PlanRecord); } catch { throw new PlanError("PLAN_STORE_CORRUPT"); }
}

export function submitPlan(store: WorkOsStore, scope: Scope, actor: string, missionId: string, input: PlanInput): {tasks: WorkTask[]; replayed: boolean} {
  const mission = store.getMission(scope, missionId);
  if (!mission) throw new PlanError("PLAN_MISSION_NOT_FOUND");
  const digest = sha(JSON.stringify(input.tasks.map(t => ({title: t.title, dependsOn: [...(t.dependsOn ?? [])].sort((a, b) => a - b)}))));
  const prior = readPlans(store.dataDir).find(p => p.tenantId === scope.tenantId && p.missionId === missionId);
  if (prior) {
    if (prior.digest !== digest) throw new PlanError("PLAN_ALREADY_EXISTS");
    return {tasks: store.listTasks(scope, missionId).filter(t => prior.taskIds.includes(t.taskId)), replayed: true};
  }
  if (!PLANNABLE.has(mission.status)) throw new PlanError("MISSION_NOT_PLANNABLE");
  // Plan kaydı olmadan görev varsa (başka yoldan açılmış) ikinci bir plan kurulmaz; yarım kalmış kendi planımız ise aşağıdaki deterministik anahtarlar kalanı tamamlar.
  const own = (i: number) => `plan.${missionId}.${i}`;
  const created: WorkTask[] = [];
  for (let i = 0; i < input.tasks.length; i++) {
    const t = input.tasks[i];
    const r = store.createTaskDetailed({tenantId: scope.tenantId, missionId, title: t.title, dependsOn: (t.dependsOn ?? []).map(d => created[d].taskId), actor, idempotencyKey: own(i)});
    created.push(r.entity);
  }
  const rec: PlanRecord = {missionId, tenantId: scope.tenantId, digest, taskIds: created.map(t => t.taskId), createdAt: new Date().toISOString(), createdBy: actor};
  fs.mkdirSync(store.dataDir, {recursive: true});
  const fd = fs.openSync(file(store.dataDir), "a");
  try { fs.writeSync(fd, JSON.stringify(rec) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return {tasks: created, replayed: false};
}
