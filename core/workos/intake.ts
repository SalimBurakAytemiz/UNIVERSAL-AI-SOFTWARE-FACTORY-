//TR: Bu dosya Founder'ın proje fikrini doğrulanmış, kalıcı bir intake kaydına çevirir; aynı işlemde projeyi ve ilk mission'ı Work OS store'un genel yöntemleriyle oluşturur (ikinci store yok). COORD-INTAKE-TEMPLATE: isteğe bağlı template verilirse proje, POST /v1/projects ile aynı yönetilen şablon deposuyla (<dataDir>/projects/<id>/repo) journal kilidi altında kurulur; template idempotencyKey ister, böylece çökme sonrası tekrar ikinci depo kurmaz.
import path from "node:path";
import crypto from "node:crypto";
import AjvModule from "ajv";
import type {Scope, RiskLevel, ProjectType, ProjectTemplate} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {WorkOsError} from "./types.js";
import {projectCreateSchema, testCommandAllowed, TEST_COMMAND_EXECUTABLES} from "./schemas.js";
import {TemplateProvisioner, templateProjectFields} from "./project-provisioner.js";
import type {TemplateStudio} from "./project-provisioner.js";
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
    idempotencyKey: {type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$"},
    // //TR: Test komutu proje formuyla birebir aynı şemayı kullanır (kopya/zayıf şema yok); allowlist denetimi validateIntakeCreate içinde testCommandAllowed ile yapılır.
    testCommand: projectCreateSchema.properties.testCommand,
    // //TR: COORD-INTAKE-TEMPLATE: şablon listesi proje şemasıyla aynı nesnedir (kopya yok). additionalProperties false kalır: istemci repository/path/url/devCommand gönderemez.
    template: projectCreateSchema.properties.template
  }
} as const;
const check = ajv.compile(intakeCreateSchema);
export const validateIntakeCreate = (x: unknown): {ok: true} | {ok: false; errors: string} => {
  if (!check(x)) return {ok: false, errors: ajv.errorsText(check.errors, {separator: " | "})};
  // //TR: Proje/mission rotalarıyla aynı reddetme biçimi: izin verilmeyen komut 400 INVALID_BODY olur ve hiçbir şey yazılmaz.
  const b = x as {testCommand?: unknown; template?: unknown; idempotencyKey?: unknown};
  if (b.testCommand !== undefined && !testCommandAllowed(b.testCommand)) return {ok: false, errors: `testCommand[0] must be one of ${TEST_COMMAND_EXECUTABLES.join(",")}`};
  // //TR: Şablonlu intake yönetilen depo kurar; anahtarsız tekrar (yeni rastgele intakeId) ikinci bir depo ve proje kurardı. Bu yüzden template idempotencyKey olmadan 400 INVALID_BODY'dir.
  if (b.template !== undefined && b.idempotencyKey === undefined) return {ok: false, errors: "template requires idempotencyKey"};
  return {ok: true};
};

export const DEFAULT_ACCEPTANCE = "The delivered application starts and its test suite passes";
export type IntakeSource = "FOUNDER" | "DEFAULT" | "DERIVED";
// //TR: Etkin test komutunun kaynağı: Founder verdi, şablondan geldi ya da hiç yok (empty şablon + komutsuz; VERIFY TEST_COMMAND_NOT_CONFIGURED ile durur).
export type TestCommandSource = "FOUNDER" | "TEMPLATE" | "NONE";
// //TR: Kayıt yalnız şablon bilgisini taşır, depo yolunu TAŞIMAZ (yol projede kalır; intake yanıtında mutlak yol sızmaz).
export interface IntakeRepositoryBlock { kind: "TEMPLATE"; template: ProjectTemplate; managed: true; testCommandSource: TestCommandSource }
export interface IntakeRecord {
  intakeId: string; tenantId: string; projectId: string; missionId: string; status: "CREATED";
  idea: string; ideaSha256: string; title: string; riskLevel: RiskLevel; acceptanceCriteria: string[];
  projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  // //TR: testCommand ve özeti yalnız verildiğinde kayda girer; alan olmayan eski kayıtlar ve özetleri değişmez.
  testCommand?: string[]; testCommandSha256?: string;
  // //TR: repository yalnız template verildiğinde yazılır; şablonsuz ve eski kayıtlar bayt bayt aynı kalır.
  repository?: IntakeRepositoryBlock;
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
  acceptanceCriteria?: string[]; riskLevel?: "R0" | "R1" | "R2" | "R3"; idempotencyKey?: string; testCommand?: string[]; template?: ProjectTemplate;
}
// //TR: studio yalnız test/enjeksiyon dikişidir; route bunu vermez, çekirdek sağlayıcıyı store.dataDir'den kurar.
export interface IntakeDeps { store: WorkOsStore; scope: Scope; orgId: string; actor: string; environmentId?: string; studio?: TemplateStudio }
const TEMPLATE_ENUM: readonly unknown[] = projectCreateSchema.properties.template.enum;
const firstLine = (s: string) => s.trim().split(/\r?\n/, 1)[0].slice(0, 80).trim();

// //TR: İdempotency karşılaştırması isteğin TAMAMINI kapsar (idea, title, projectType, techStack, targetOS, acceptanceCriteria, riskLevel, testCommand, template): aynı anahtarla farklı gövde sessizce eski kaydı döndürmez (INTAKE_IDEMPOTENCY_CONFLICT, store'un WORKOS_IDEMPOTENCY_CONFLICT kuralıyla uyumlu).
// Özet, kayıtta ayrı bir alan olarak SAKLANMAZ; saklanan kayıttan (alan kaynakları FOUNDER/DEFAULT/DERIVED ile; testCommand yalnız Founder değeri; template repository bloğundan) aynı kuralla yeniden türetilir. Böylece bu alanları yazmayan eski kayıtlar da okunur, şablonsuz/komutsuz istekle eşleşir ve farklı gövdeyi sessizce tekrar oynatamaz.
interface NormalizedRequest { idea: string; title: string | null; projectType: string | null; techStack: string[] | null; targetOS: string[] | null; acceptanceCriteria: string[] | null; riskLevel: string | null; testCommand: string[] | null; template: string | null }
const requestDigest = (n: NormalizedRequest) => sha(JSON.stringify([n.idea, n.title, n.projectType, n.techStack, n.targetOS, n.acceptanceCriteria, n.riskLevel, n.testCommand, n.template]));
const requestOf = (i: IntakeInput): NormalizedRequest => ({idea: i.idea.trim(), title: i.title?.trim() || null, projectType: i.projectType ?? null, techStack: i.techStack ?? null, targetOS: i.targetOS ?? null, acceptanceCriteria: i.acceptanceCriteria ?? null, riskLevel: i.riskLevel ?? null,
  testCommand: i.testCommand ?? null, template: i.template ?? null});
const requestOfRecord = (r: IntakeRecord): NormalizedRequest => ({idea: r.idea, title: r.sources?.title === "FOUNDER" ? r.title : null, projectType: r.projectType ?? null, techStack: r.techStack ?? null, targetOS: r.targetOS ?? null,
  acceptanceCriteria: r.sources?.acceptanceCriteria === "FOUNDER" ? r.acceptanceCriteria : null, riskLevel: r.sources?.riskLevel === "FOUNDER" ? r.riskLevel : null,
  testCommand: r.testCommand ?? null, template: r.repository?.template ?? null});

// //TR: Proje ve mission Work OS store'un idempotency anahtarlarıyla (intakeId'den türetilir) oluşturulur; proje ile mission arasında çökme olsa bile aynı istek tekrarında kalan adım tamamlanır ve çift kayıt oluşmaz.
export function submitIntake(deps: IntakeDeps, input: IntakeInput): {intake: IntakeRecord; replayed: boolean} {
  const {store, scope} = deps, dataDir = store.dataDir;
  // //TR: Route doğrulamasının yanında ikinci savunma: submitIntake'i doğrudan çağıran biri de allowlist dışı komutla hiçbir şey yazdıramaz.
  if (input.testCommand !== undefined && !testCommandAllowed(input.testCommand)) throw new WorkOsError("WORKOS_INVALID_INPUT", "testCommand");
  // //TR: COORD-INTAKE-TEMPLATE ikinci savunma (okuma/yazma öncesi): şablon listesi dışı değer ya da anahtarsız şablon doğrudan çağrıda da hiçbir şey yazdıramaz.
  if (input.template !== undefined) {
    if (!TEMPLATE_ENUM.includes(input.template)) throw new WorkOsError("WORKOS_INVALID_INPUT", "template");
    if (!input.idempotencyKey) throw new WorkOsError("WORKOS_INVALID_INPUT", "template requires idempotencyKey");
  }
  const ideaSha256 = sha(input.idea.trim());
  // //TR: Test komutu idempotency özetinin parçasıdır (aynı anahtar + farklı komut = çakışma); komut yoksa özet de yoktur, böylece eski istekler/kayıtlar aynen eşleşir.
  const testCommandSha256 = input.testCommand ? sha(JSON.stringify(input.testCommand)) : undefined;
  const intakeId = "itk_" + (input.idempotencyKey ? sha(`${scope.tenantId}\0${input.idempotencyKey}`) : crypto.randomBytes(12).toString("hex")).slice(0, 24);
  const prior = getIntake(dataDir, scope, intakeId);
  if (prior) {
    // //TR: Tekrar kontrolü isteğin TAMAMINI (şablon ve test komutu dahil) kapsayan özetle yapılır: aynı anahtar + farklı/eksik şablon ya da komut çakışmadır; şablonsuz/komutsuz eski kayıt, şablonsuz/komutsuz istekle (null === null) hâlâ eşleşir.
    if (prior.ideaSha256 !== ideaSha256 || requestDigest(requestOfRecord(prior)) !== requestDigest(requestOf(input))) throw new IntakeError("INTAKE_IDEMPOTENCY_CONFLICT");
    return {intake: prior, replayed: true};
  }
  const title = input.title?.trim() || firstLine(input.idea);
  const riskLevel: RiskLevel = input.riskLevel ?? "R1";
  const acceptanceCriteria = input.acceptanceCriteria ? [...input.acceptanceCriteria] : [DEFAULT_ACCEPTANCE];
  // //TR: Sağlayıcı ön kontrolü store.write'tan önce çalışır (kilit/yazı yok). Şablon alanları POST /v1/projects ile aynı öncelikle türetilir (Founder değeri ?? şablon değeri); şablonsuz dal bugünkü alanları aynen geçirir, proje idempotency özeti değişmez.
  const prov = input.template ? new TemplateProvisioner({dataDir, studio: deps.studio}) : null;
  const tf = input.template ? templateProjectFields(input.template, title, {projectType: input.projectType, testCommand: input.testCommand}) : null;
  const project = store.createProjectDetailed({
    tenantId: scope.tenantId, orgId: deps.orgId, name: title, environmentId: deps.environmentId ?? "local", createdBy: deps.actor, idempotencyKey: `${intakeId}.p`,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}),
    ...(input.targetOS ? {targetOS: input.targetOS} : {}), acceptanceCriteria,
    // //TR: Runner test komutunu mission, yoksa proje üzerinden okur (rawTestCommand); intake komutu projeye yazar, mission ona düşer ve VERIFY TEST_COMMAND_NOT_CONFIGURED ile bloklanmaz.
    ...(input.testCommand ? {testCommand: [...input.testCommand]} : {}),
    // //TR: Yönetilen depo store kilidi altında, findIdem replay kontrolünden SONRA kurulur (replay ikinci depo kurmaz); PROJECT_CREATED append'i başarısız olursa depoyu store siler. Proje kaydedildikten sonra burada discard YOKTUR: aynı anahtarla tekrar projeyi aynı depoyla replay eder.
    ...(input.template && tf && prov ? {
      template: tf.template, projectType: tf.projectType, ...(tf.testCommand ? {testCommand: tf.testCommand} : {}), ...(tf.devCommand ? {devCommand: tf.devCommand} : {}),
      prepareManagedRepository: prov.prepare(input.template, title)
    } : {})
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
    // //TR: Kaydın projectType/testCommand alanları yalnız Founder değeridir (bugünkü gibi); etkin değerler projededir. testCommandSource etkin komutun kaynağını dürüstçe söyler.
    ...(input.template ? {repository: {kind: "TEMPLATE" as const, template: input.template, managed: true as const, testCommandSource: input.testCommand ? "FOUNDER" as const : tf?.testCommand ? "TEMPLATE" as const : "NONE" as const}} : {}),
    sources: {title: input.title?.trim() ? "FOUNDER" : "DERIVED", acceptanceCriteria: input.acceptanceCriteria ? "FOUNDER" : "DEFAULT", riskLevel: input.riskLevel ? "FOUNDER" : "DEFAULT"},
    createdAt: new Date().toISOString(), createdBy: deps.actor
  };
  try { appendJsonlRecord(file(dataDir), intake, RECORD_START); }
  catch (e) { throw e instanceof JsonlTailError ? new IntakeError("INTAKE_STORE_CORRUPT") : e; }
  return {intake, replayed: false};
}
