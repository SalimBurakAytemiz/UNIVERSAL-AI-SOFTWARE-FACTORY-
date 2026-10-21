//TR: Bu dosya Founder'ın proje fikrini doğrulanmış, kalıcı bir intake kaydına çevirir; aynı işlemde projeyi ve ilk mission'ı Work OS store'un genel yöntemleriyle oluşturur (ikinci store yok).
import path from "node:path";
import crypto from "node:crypto";
import AjvModule from "ajv";
import type {Scope, RiskLevel, ProjectType} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {readJsonlRecords, appendJsonlRecord, JsonlTailError} from "./jsonl-tail.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
const text = {type: "string", minLength: 1, maxLength: 4000, pattern: "\\S"};
export const intakeCreateSchema = {
  type: "object", additionalProperties: false, required: ["idea"],
  properties: {
    idea: {type: "string", minLength: 10, maxLength: 4000, pattern: "\\S"},
    title: {type: "string", minLength: 1, maxLength: 120, pattern: "\\S"},
    projectType: {enum: ["web", "api", "library", "cli", "desktop", "mobile", "native", "other"]},
    techStack: {type: "array", maxItems: 20, uniqueItems: true, items: {type: "string", minLength: 1, maxLength: 50, pattern: "^[A-Za-z0-9.+#/ _-]+$"}},
    targetOS: {type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: {enum: ["windows", "macos", "linux", "web", "android", "ios"]}},
    acceptanceCriteria: {type: "array", minItems: 1, maxItems: 50, items: text},
    riskLevel: {enum: ["R0", "R1", "R2", "R3"]},
    idempotencyKey: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$"}
  }
} as const;
const check = ajv.compile(intakeCreateSchema);
export const validateIntakeCreate = (x: unknown): {ok: true} | {ok: false; errors: string} =>
  check(x) ? {ok: true} : {ok: false, errors: ajv.errorsText(check.errors, {separator: " | "})};

export const DEFAULT_ACCEPTANCE = "The delivered application starts and its test suite passes";
export type IntakeSource = "FOUNDER" | "DEFAULT" | "DERIVED";
export interface IntakeRecord {
  intakeId: string; tenantId: string; projectId: string; missionId: string; status: "CREATED";
  idea: string; ideaSha256: string; title: string; riskLevel: RiskLevel; acceptanceCriteria: string[];
  projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  // Her alanın kaynağı açıkça işaretlenir (UI-126): Founder'dan mı geldi, varsayılan mı, türetilmiş mi.
  sources: {title: IntakeSource; acceptanceCriteria: IntakeSource; riskLevel: IntakeSource};
  createdAt: string; createdBy: string;
}
export type IntakeErrorCode = "INTAKE_IDEMPOTENCY_CONFLICT" | "INTAKE_STORE_CORRUPT" | "INTAKE_NOT_FOUND";
export class IntakeError extends Error { constructor(readonly code: IntakeErrorCode) { super(code); this.name = "IntakeError"; } }

const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
const file = (dataDir: string) => path.join(dataDir, "intakes.jsonl");
// Kaydın JSON.stringify başlangıcı (anahtar sırası IntakeRecord literalindeki gibi): yırtık son satır yalnız bunun önekiyse tolere edilir (jsonl-tail.ts).
const RECORD_START = '{"intakeId":"';
function readAll(dataDir: string): IntakeRecord[] {
  try { return readJsonlRecords<IntakeRecord>(file(dataDir), RECORD_START); }
  catch { throw new IntakeError("INTAKE_STORE_CORRUPT"); }
}
export const listIntakes = (dataDir: string, scope: Scope): IntakeRecord[] => readAll(dataDir).filter(r => r.tenantId === scope.tenantId);
export const getIntake = (dataDir: string, scope: Scope, id: string): IntakeRecord | undefined => listIntakes(dataDir, scope).find(r => r.intakeId === id);

export interface IntakeInput {
  idea: string; title?: string; projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  acceptanceCriteria?: string[]; riskLevel?: "R0" | "R1" | "R2" | "R3"; idempotencyKey?: string;
}
export interface IntakeDeps { store: WorkOsStore; scope: Scope; orgId: string; actor: string; environmentId?: string }
const firstLine = (s: string) => s.trim().split(/\r?\n/, 1)[0].slice(0, 80).trim();

// //TR: İdempotency karşılaştırması isteğin TAMAMINI kapsar (idea, title, projectType, techStack, targetOS, acceptanceCriteria, riskLevel): aynı anahtarla farklı gövde sessizce eski kaydı döndürmez (INTAKE_IDEMPOTENCY_CONFLICT, store'un WORKOS_IDEMPOTENCY_CONFLICT kuralıyla uyumlu).
// Özet, kayıtta ayrı bir alan olarak SAKLANMAZ; saklanan kayıttan (alan kaynakları FOUNDER/DEFAULT/DERIVED ile) aynı kuralla yeniden türetilir. Böylece bu alanı yazmayan eski kayıtlar da okunur ve farklı gövdeyi sessizce tekrar oynatamaz.
interface NormalizedRequest { idea: string; title: string | null; projectType: string | null; techStack: string[] | null; targetOS: string[] | null; acceptanceCriteria: string[] | null; riskLevel: string | null }
const requestDigest = (n: NormalizedRequest) => sha(JSON.stringify([n.idea, n.title, n.projectType, n.techStack, n.targetOS, n.acceptanceCriteria, n.riskLevel]));
const requestOf = (i: IntakeInput): NormalizedRequest => ({idea: i.idea.trim(), title: i.title?.trim() || null, projectType: i.projectType ?? null, techStack: i.techStack ?? null, targetOS: i.targetOS ?? null, acceptanceCriteria: i.acceptanceCriteria ?? null, riskLevel: i.riskLevel ?? null});
const requestOfRecord = (r: IntakeRecord): NormalizedRequest => ({idea: r.idea, title: r.sources?.title === "FOUNDER" ? r.title : null, projectType: r.projectType ?? null, techStack: r.techStack ?? null, targetOS: r.targetOS ?? null,
  acceptanceCriteria: r.sources?.acceptanceCriteria === "FOUNDER" ? r.acceptanceCriteria : null, riskLevel: r.sources?.riskLevel === "FOUNDER" ? r.riskLevel : null});

// //TR: Proje ve mission Work OS store'un idempotency anahtarlarıyla (intakeId'den türetilir) oluşturulur; proje ile mission arasında çökme olsa bile aynı istek tekrarında kalan adım tamamlanır ve çift kayıt oluşmaz.
export function submitIntake(deps: IntakeDeps, input: IntakeInput): {intake: IntakeRecord; replayed: boolean} {
  const {store, scope} = deps, dataDir = store.dataDir;
  const ideaSha256 = sha(input.idea.trim());
  const intakeId = "itk_" + (input.idempotencyKey ? sha(`${scope.tenantId}\0${input.idempotencyKey}`) : crypto.randomBytes(12).toString("hex")).slice(0, 24);
  const prior = getIntake(dataDir, scope, intakeId);
  if (prior) {
    if (prior.ideaSha256 !== ideaSha256 || requestDigest(requestOfRecord(prior)) !== requestDigest(requestOf(input))) throw new IntakeError("INTAKE_IDEMPOTENCY_CONFLICT");
    return {intake: prior, replayed: true};
  }
  const title = input.title?.trim() || firstLine(input.idea);
  const riskLevel: RiskLevel = input.riskLevel ?? "R1";
  const acceptanceCriteria = input.acceptanceCriteria ? [...input.acceptanceCriteria] : [DEFAULT_ACCEPTANCE];
  const project = store.createProjectDetailed({
    tenantId: scope.tenantId, orgId: deps.orgId, name: title, environmentId: deps.environmentId ?? "local", createdBy: deps.actor, idempotencyKey: `${intakeId}.p`,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}),
    ...(input.targetOS ? {targetOS: input.targetOS} : {}), acceptanceCriteria
  }).entity;
  const mission = store.createMissionDetailed({
    tenantId: scope.tenantId, projectId: project.projectId, title: `First delivery: ${title}`.slice(0, 200), objective: input.idea.trim(),
    acceptanceCriteria, riskLevel, createdBy: deps.actor, idempotencyKey: `${intakeId}.m`
  }).entity;
  const intake: IntakeRecord = {
    intakeId, tenantId: scope.tenantId, projectId: project.projectId, missionId: mission.missionId, status: "CREATED",
    idea: input.idea.trim(), ideaSha256, title, riskLevel, acceptanceCriteria,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}), ...(input.targetOS ? {targetOS: input.targetOS} : {}),
    sources: {title: input.title?.trim() ? "FOUNDER" : "DERIVED", acceptanceCriteria: input.acceptanceCriteria ? "FOUNDER" : "DEFAULT", riskLevel: input.riskLevel ? "FOUNDER" : "DEFAULT"},
    createdAt: new Date().toISOString(), createdBy: deps.actor
  };
  try { appendJsonlRecord(file(dataDir), intake, RECORD_START); }
  catch (e) { throw e instanceof JsonlTailError ? new IntakeError("INTAKE_STORE_CORRUPT") : e; }
  return {intake, replayed: false};
}
