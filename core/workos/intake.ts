//TR: Bu dosya Founder'ın proje fikrini doğrulanmış, kalıcı bir intake kaydına çevirir; aynı işlemde projeyi ve ilk mission'ı Work OS store'un genel yöntemleriyle oluşturur (ikinci store yok).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AjvModule from "ajv";
import type {Scope, RiskLevel, ProjectType} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {WorkOsError} from "./types.js";
import {projectCreateSchema, testCommandAllowed, TEST_COMMAND_EXECUTABLES} from "./schemas.js";

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
    idempotencyKey: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$"},
    // //TR: Test komutu proje formuyla birebir aynı şemayı kullanır (kopya/zayıf şema yok); allowlist denetimi validateIntakeCreate içinde testCommandAllowed ile yapılır.
    testCommand: projectCreateSchema.properties.testCommand
  }
} as const;
const check = ajv.compile(intakeCreateSchema);
export const validateIntakeCreate = (x: unknown): {ok: true} | {ok: false; errors: string} => {
  if (!check(x)) return {ok: false, errors: ajv.errorsText(check.errors, {separator: " | "})};
  // //TR: Proje/mission rotalarıyla aynı reddetme biçimi: izin verilmeyen komut 400 INVALID_BODY olur ve hiçbir şey yazılmaz.
  const tc = (x as {testCommand?: unknown}).testCommand;
  return tc !== undefined && !testCommandAllowed(tc) ? {ok: false, errors: `testCommand[0] must be one of ${TEST_COMMAND_EXECUTABLES.join(",")}`} : {ok: true};
};

export const DEFAULT_ACCEPTANCE = "The delivered application starts and its test suite passes";
export type IntakeSource = "FOUNDER" | "DEFAULT" | "DERIVED";
export interface IntakeRecord {
  intakeId: string; tenantId: string; projectId: string; missionId: string; status: "CREATED";
  idea: string; ideaSha256: string; title: string; riskLevel: RiskLevel; acceptanceCriteria: string[];
  projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  // //TR: testCommand ve özeti yalnız verildiğinde kayda girer; alan olmayan eski kayıtlar ve özetleri değişmez.
  testCommand?: string[]; testCommandSha256?: string;
  // Her alanın kaynağı açıkça işaretlenir (UI-126): Founder'dan mı geldi, varsayılan mı, türetilmiş mi.
  sources: {title: IntakeSource; acceptanceCriteria: IntakeSource; riskLevel: IntakeSource};
  createdAt: string; createdBy: string;
}
export type IntakeErrorCode = "INTAKE_IDEMPOTENCY_CONFLICT" | "INTAKE_STORE_CORRUPT" | "INTAKE_NOT_FOUND";
export class IntakeError extends Error { constructor(readonly code: IntakeErrorCode) { super(code); this.name = "IntakeError"; } }

const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
const file = (dataDir: string) => path.join(dataDir, "intakes.jsonl");
function readAll(dataDir: string): IntakeRecord[] {
  const f = file(dataDir);
  if (!fs.existsSync(f)) return [];
  try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as IntakeRecord); }
  catch { throw new IntakeError("INTAKE_STORE_CORRUPT"); }
}
export const listIntakes = (dataDir: string, scope: Scope): IntakeRecord[] => readAll(dataDir).filter(r => r.tenantId === scope.tenantId);
export const getIntake = (dataDir: string, scope: Scope, id: string): IntakeRecord | undefined => listIntakes(dataDir, scope).find(r => r.intakeId === id);

export interface IntakeInput {
  idea: string; title?: string; projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  acceptanceCriteria?: string[]; riskLevel?: "R0" | "R1" | "R2" | "R3"; idempotencyKey?: string; testCommand?: string[];
}
export interface IntakeDeps { store: WorkOsStore; scope: Scope; orgId: string; actor: string; environmentId?: string }
const firstLine = (s: string) => s.trim().split(/\r?\n/, 1)[0].slice(0, 80).trim();

// //TR: Proje ve mission Work OS store'un idempotency anahtarlarıyla (intakeId'den türetilir) oluşturulur; proje ile mission arasında çökme olsa bile aynı istek tekrarında kalan adım tamamlanır ve çift kayıt oluşmaz.
export function submitIntake(deps: IntakeDeps, input: IntakeInput): {intake: IntakeRecord; replayed: boolean} {
  const {store, scope} = deps, dataDir = store.dataDir;
  // //TR: Route doğrulamasının yanında ikinci savunma: submitIntake'i doğrudan çağıran biri de allowlist dışı komutla hiçbir şey yazdıramaz.
  if (input.testCommand !== undefined && !testCommandAllowed(input.testCommand)) throw new WorkOsError("WORKOS_INVALID_INPUT", "testCommand");
  const ideaSha256 = sha(input.idea.trim());
  // //TR: Test komutu idempotency özetinin parçasıdır (aynı anahtar + farklı komut = çakışma); komut yoksa özet de yoktur, böylece eski istekler/kayıtlar aynen eşleşir.
  const testCommandSha256 = input.testCommand ? sha(JSON.stringify(input.testCommand)) : undefined;
  const intakeId = "itk_" + (input.idempotencyKey ? sha(`${scope.tenantId}\0${input.idempotencyKey}`) : crypto.randomBytes(12).toString("hex")).slice(0, 24);
  const prior = getIntake(dataDir, scope, intakeId);
  if (prior) {
    if (prior.ideaSha256 !== ideaSha256 || prior.testCommandSha256 !== testCommandSha256) throw new IntakeError("INTAKE_IDEMPOTENCY_CONFLICT");
    return {intake: prior, replayed: true};
  }
  const title = input.title?.trim() || firstLine(input.idea);
  const riskLevel: RiskLevel = input.riskLevel ?? "R1";
  const acceptanceCriteria = input.acceptanceCriteria ? [...input.acceptanceCriteria] : [DEFAULT_ACCEPTANCE];
  const project = store.createProjectDetailed({
    tenantId: scope.tenantId, orgId: deps.orgId, name: title, environmentId: deps.environmentId ?? "local", createdBy: deps.actor, idempotencyKey: `${intakeId}.p`,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}),
    ...(input.targetOS ? {targetOS: input.targetOS} : {}), acceptanceCriteria,
    // //TR: Runner test komutunu mission, yoksa proje üzerinden okur (rawTestCommand); intake komutu projeye yazar, mission ona düşer ve VERIFY TEST_COMMAND_NOT_CONFIGURED ile bloklanmaz.
    ...(input.testCommand ? {testCommand: [...input.testCommand]} : {})
  }).entity;
  const mission = store.createMissionDetailed({
    tenantId: scope.tenantId, projectId: project.projectId, title: `First delivery: ${title}`.slice(0, 200), objective: input.idea.trim(),
    acceptanceCriteria, riskLevel, createdBy: deps.actor, idempotencyKey: `${intakeId}.m`
  }).entity;
  const intake: IntakeRecord = {
    intakeId, tenantId: scope.tenantId, projectId: project.projectId, missionId: mission.missionId, status: "CREATED",
    idea: input.idea.trim(), ideaSha256, title, riskLevel, acceptanceCriteria,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}), ...(input.targetOS ? {targetOS: input.targetOS} : {}),
    ...(input.testCommand ? {testCommand: [...input.testCommand], testCommandSha256} : {}),
    sources: {title: input.title?.trim() ? "FOUNDER" : "DERIVED", acceptanceCriteria: input.acceptanceCriteria ? "FOUNDER" : "DEFAULT", riskLevel: input.riskLevel ? "FOUNDER" : "DEFAULT"},
    createdAt: new Date().toISOString(), createdBy: deps.actor
  };
  fs.mkdirSync(dataDir, {recursive: true});
  const fd = fs.openSync(file(dataDir), "a");
  try { fs.writeSync(fd, JSON.stringify(intake) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return {intake, replayed: false};
}
