//TR: Bu dosya Founder'ın proje fikrini doğrulanmış, kalıcı bir intake kaydına çevirir; aynı işlemde projeyi ve ilk mission'ı Work OS store'un genel yöntemleriyle oluşturur (ikinci store yok).
import path from "node:path";
import crypto from "node:crypto";
import AjvModule from "ajv";
import type {Scope, RiskLevel, ProjectType, ProjectTemplate} from "./types.js";
import {renderTemplate} from "./project-templates.js";
import type {WorkOsStore} from "./store.js";
import {testCommand as testCommandSchema, testCommandAllowed, TEST_COMMAND_EXECUTABLES} from "./schemas.js";
import {urlHasUserinfo} from "./types.js";
import {readJsonlRecords, appendJsonlRecord, JsonlTailError} from "./jsonl-tail.js";
import {intakeAuthorityFlags, type IntakeAuthorityReason} from "../mission/command-intake.js";

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
    // //TR: testCommand şeması ve izin listesi POST /v1/projects ile AYNIDIR (schemas.ts'ten gelir, çatallanmaz); repository yalnız url taşır (yerel yol IPC /import ile gelir).
    testCommand: testCommandSchema,
    // //TR: template verilirse proje yönetilen bir depoyla (git, ilk commit) kurulur; böylece ilk koşu REPOSITORY_NOT_CONFIGURED ile bloklanmaz. repository ile birlikte verilemez.
    template: {enum: ["web-node", "node-lib", "empty"]},
    repository: {type: "object", additionalProperties: false, required: ["url"], properties: {url: {type: "string", minLength: 1, maxLength: 1000}}},
    // //TR: UASCO-T0011 sunucu kapısı: fikir/başlık/kabul kriterleri yetki bayrağı taşıyorsa (komut girişiyle aynı kurallar) Founder bu bayrakları AÇIKÇA ve TAM olarak onaylamalıdır; onay kayda yazılır ve denetlenir.
    acknowledgedRisks: {type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: {enum: ["PROTECTED_PATH", "INSTRUCTION_LIKE"]}}
  }
} as const;
const check = ajv.compile(intakeCreateSchema);
// //TR: Hata gövdeleri repository.url değerini yansıtmaz; yalnız alan adı döner.
export const validateIntakeCreate = (x: unknown): {ok: true} | {ok: false; errors: string} => {
  if (!check(x)) return {ok: false, errors: ajv.errorsText(check.errors, {separator: " | "})};
  const b = x as {testCommand?: unknown; repository?: {url?: string}};
  if (b.repository?.url !== undefined && urlHasUserinfo(b.repository.url)) return {ok: false, errors: "repository.url must not contain credentials"};
  if ((x as {template?: unknown}).template !== undefined && b.repository !== undefined) return {ok: false, errors: "template and repository are mutually exclusive"};
  if (b.testCommand !== undefined && !testCommandAllowed(b.testCommand)) return {ok: false, errors: `testCommand[0] must be one of ${TEST_COMMAND_EXECUTABLES.join(",")}`};
  return {ok: true};
};

/** UASCO-T0011 sunucu yetki kapısı (istemci kapısından bağımsız): TÜM serbest metin alanları (INTAKE_SCANNED_FIELDS) komut girişinin yetki bayraklarıyla taranır (sınıflandırıcı değişmez).
 *  ENGELLEYEN bayraklar yalnız INSTRUCTION_LIKE ve PROTECTED_PATH'tir (ürün açıklamalarında yanlış pozitif vermeyen ikisi): bunlar varsa acknowledgedRisks TAM olarak aynı küme olmalıdır; eksik/fazla onay ve engelleyen bayrak yokken onay reddedilir.
 *  Diğer dört bayrak (DELETION, PAID_OR_PRODUCTION, SECRETS, MERGE_PUSH_FORCE) ENGELLEMEZ, yalnız kayda yazılır. Tür belirsizliği (KIND_UNKNOWN/AMBIGUOUS) hiç değerlendirilmez. */
export const INTAKE_BLOCKING_REASONS: readonly IntakeAuthorityReason[] = Object.freeze(["PROTECTED_PATH", "INSTRUCTION_LIKE"] as IntakeAuthorityReason[]);
/** #381 B-1: taranan SERBEST METİN alanları (şemadaki her serbest metin alanı; ProjectBrief/prompt'a giden fikir, başlık, techStack, kabul kriterleri dahil). Bir alan ya burada ya INTAKE_UNSCANNED_FIELDS'te olmalıdır (test şemadan doğrular). */
export const INTAKE_SCANNED_FIELDS = Object.freeze(["idea", "title", "techStack", "acceptanceCriteria", "testCommand", "repository"] as const);
/** Taranmayan alanlar ve nedeni: yalnız sabit değerli (enum) alanlar ve hiçbir prompt'a gitmeyen, desenle sınırlı kimlik. */
export const INTAKE_UNSCANNED_FIELDS: Readonly<Record<string, string>> = Object.freeze({projectType: "enum", targetOS: "enum", riskLevel: "enum", template: "enum", acknowledgedRisks: "enum", idempotencyKey: "identifier [A-Za-z0-9._-]{1,100}; stored only as a hash input, never in a brief or prompt"});
/** Girdideki tüm taranan serbest metinler (eksik alan yok sayılır). */
export function intakeFreeTexts(input: Partial<Pick<IntakeInput, "idea" | "title" | "techStack" | "acceptanceCriteria" | "testCommand" | "repository">>): unknown[] {
  return [input.idea, input.title, ...(input.techStack ?? []), ...(input.acceptanceCriteria ?? []), ...(input.testCommand ?? []), input.repository?.url];
}
export function intakeAuthorityCheck(input: Partial<IntakeInput> & Pick<IntakeInput, "idea">): {ok: boolean; flags: IntakeAuthorityReason[]; blocking: IntakeAuthorityReason[]; acknowledged: boolean} {
  const flags = intakeAuthorityFlags(intakeFreeTexts(input));
  const blocking = flags.filter(f => INTAKE_BLOCKING_REASONS.includes(f));
  const ack = input.acknowledgedRisks ?? [];
  const ok = ack.length === blocking.length && blocking.every(f => ack.includes(f));
  return {ok, flags, blocking, acknowledged: ok && blocking.length > 0};
}

export const DEFAULT_ACCEPTANCE = "The delivered application starts and its test suite passes";
export type IntakeSource = "FOUNDER" | "DEFAULT" | "DERIVED";
export interface IntakeRecord {
  intakeId: string; tenantId: string; projectId: string; missionId: string; status: "CREATED";
  idea: string; ideaSha256: string; title: string; riskLevel: RiskLevel; acceptanceCriteria: string[];
  projectType?: ProjectType; techStack?: string[]; targetOS?: string[];
  // URL kayda yazılmaz ve yanıtta dönmez: yalnız varlığı ve özeti (idempotency karşılaştırması için) saklanır.
  testCommand?: string[]; repositorySha256?: string; template?: ProjectTemplate;
  // UASCO-T0011: sunucunun hesapladığı yetki bayrakları (yalnız bayrak varsa) ve Founder'ın açıkça onayladığı ENGELLEYEN bayraklar (yalnız onaylı oluşturmada).
  authorityFlags?: IntakeAuthorityReason[]; acknowledgedRisks?: IntakeAuthorityReason[];
  // Her alanın kaynağı açıkça işaretlenir (UI-126): Founder'dan mı geldi, varsayılan mı, türetilmiş mi.
  sources: {title: IntakeSource; acceptanceCriteria: IntakeSource; riskLevel: IntakeSource};
  createdAt: string; createdBy: string;
}
export type IntakeErrorCode = "INTAKE_AUTHORITY_REQUIRED" | "INTAKE_IDEMPOTENCY_CONFLICT" | "INTAKE_STORE_CORRUPT" | "INTAKE_NOT_FOUND" | "INTAKE_STUDIO_UNAVAILABLE";
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
  testCommand?: string[]; repository?: {url: string}; template?: ProjectTemplate;
  acknowledgedRisks?: IntakeAuthorityReason[];
}
// //TR: studio yalnız template istenirse gerekir; createTemplateRepository ProjectStudio ile aynı sözleşmedir (POST /v1/projects template yolu ile aynı işlev).
export interface IntakeStudioPort { createTemplateRepository(projectId: string, template: ProjectTemplate, projectName: string): {path: string; discard: () => void} }
export interface IntakeDeps { store: WorkOsStore; scope: Scope; orgId: string; actor: string; environmentId?: string; studio?: IntakeStudioPort }
const firstLine = (s: string) => s.trim().split(/\r?\n/, 1)[0].slice(0, 80).trim();

// //TR: İdempotency karşılaştırması isteğin TAMAMINI kapsar (idea, title, projectType, techStack, targetOS, acceptanceCriteria, riskLevel): aynı anahtarla farklı gövde sessizce eski kaydı döndürmez (INTAKE_IDEMPOTENCY_CONFLICT, store'un WORKOS_IDEMPOTENCY_CONFLICT kuralıyla uyumlu).
// Özet, kayıtta ayrı bir alan olarak SAKLANMAZ; saklanan kayıttan (alan kaynakları FOUNDER/DEFAULT/DERIVED ile) aynı kuralla yeniden türetilir. Böylece bu alanı yazmayan eski kayıtlar da okunur ve farklı gövdeyi sessizce tekrar oynatamaz.
interface NormalizedRequest { idea: string; title: string | null; projectType: string | null; techStack: string[] | null; targetOS: string[] | null; acceptanceCriteria: string[] | null; riskLevel: string | null; testCommand: string[] | null; repositorySha256: string | null; template: string | null }
const requestDigest = (n: NormalizedRequest) => sha(JSON.stringify([n.idea, n.title, n.projectType, n.techStack, n.targetOS, n.acceptanceCriteria, n.riskLevel, n.testCommand, n.repositorySha256, n.template]));
const requestOf = (i: IntakeInput): NormalizedRequest => ({idea: i.idea.trim(), title: i.title?.trim() || null, projectType: i.projectType ?? null, techStack: i.techStack ?? null, targetOS: i.targetOS ?? null, acceptanceCriteria: i.acceptanceCriteria ?? null, riskLevel: i.riskLevel ?? null, testCommand: i.testCommand ?? null, repositorySha256: i.repository ? sha(i.repository.url) : null, template: i.template ?? null});
const requestOfRecord = (r: IntakeRecord): NormalizedRequest => ({idea: r.idea, title: r.sources?.title === "FOUNDER" ? r.title : null, projectType: r.projectType ?? null, techStack: r.techStack ?? null, targetOS: r.targetOS ?? null,
  acceptanceCriteria: r.sources?.acceptanceCriteria === "FOUNDER" ? r.acceptanceCriteria : null, riskLevel: r.sources?.riskLevel === "FOUNDER" ? r.riskLevel : null, testCommand: r.testCommand ?? null, repositorySha256: r.repositorySha256 ?? null, template: r.template ?? null});

// //TR: Proje ve mission Work OS store'un idempotency anahtarlarıyla (intakeId'den türetilir) oluşturulur; proje ile mission arasında çökme olsa bile aynı istek tekrarında kalan adım tamamlanır ve çift kayıt oluşmaz.
export function submitIntake(deps: IntakeDeps, input: IntakeInput): {intake: IntakeRecord; replayed: boolean} {
  const {store, scope} = deps, dataDir = store.dataDir;
  // //TR: Derinlemesine savunma: rota zaten denetler; çekirdek de onaysız yetki bayraklı fikirden proje/mission OLUŞTURMAZ.
  const gate = intakeAuthorityCheck(input);
  if (!gate.ok) throw new IntakeError("INTAKE_AUTHORITY_REQUIRED");
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
  // //TR: template -> yönetilen depo + şablonun test/dev komutu ve proje tipi (Founder'ın verdiği testCommand/projectType öncelikli).
  const tpl = input.template ? renderTemplate(input.template, title) : null;
  if (input.template && !deps.studio) throw new IntakeError("INTAKE_STUDIO_UNAVAILABLE");
  const studio = deps.studio, template = input.template;
  const project = store.createProjectDetailed({
    tenantId: scope.tenantId, orgId: deps.orgId, name: title, environmentId: deps.environmentId ?? "local", createdBy: deps.actor, idempotencyKey: `${intakeId}.p`,
    ...((input.projectType ?? tpl?.projectType) ? {projectType: (input.projectType ?? tpl?.projectType) as ProjectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}),
    ...(input.targetOS ? {targetOS: input.targetOS} : {}), acceptanceCriteria,
    ...((input.testCommand ?? tpl?.testCommand) ? {testCommand: (input.testCommand ?? tpl?.testCommand) as string[]} : {}), ...(input.repository ? {repository: {url: input.repository.url}} : {}),
    ...(template && studio ? {template, ...(tpl?.devCommand ? {devCommand: tpl.devCommand} : {}), prepareManagedRepository: (projectId: string) => { const x = studio.createTemplateRepository(projectId, template, title); return {path: x.path, discard: x.discard}; }} : {})
  }).entity;
  const mission = store.createMissionDetailed({
    tenantId: scope.tenantId, projectId: project.projectId, title: `First delivery: ${title}`.slice(0, 200), objective: input.idea.trim(),
    acceptanceCriteria, riskLevel, createdBy: deps.actor, idempotencyKey: `${intakeId}.m`
  }).entity;
  const intake: IntakeRecord = {
    intakeId, tenantId: scope.tenantId, projectId: project.projectId, missionId: mission.missionId, status: "CREATED",
    idea: input.idea.trim(), ideaSha256, title, riskLevel, acceptanceCriteria,
    ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: input.techStack} : {}), ...(input.targetOS ? {targetOS: input.targetOS} : {}),
    ...(input.testCommand ? {testCommand: input.testCommand} : {}), ...(input.repository ? {repositorySha256: sha(input.repository.url)} : {}), ...(input.template ? {template: input.template} : {}),
    ...(gate.flags.length ? {authorityFlags: [...gate.flags]} : {}), ...(gate.acknowledged ? {acknowledgedRisks: [...gate.blocking]} : {}),
    sources: {title: input.title?.trim() ? "FOUNDER" : "DERIVED", acceptanceCriteria: input.acceptanceCriteria ? "FOUNDER" : "DEFAULT", riskLevel: input.riskLevel ? "FOUNDER" : "DEFAULT"},
    createdAt: new Date().toISOString(), createdBy: deps.actor
  };
  try { appendJsonlRecord(file(dataDir), intake, RECORD_START); }
  catch (e) { throw e instanceof JsonlTailError ? new IntakeError("INTAKE_STORE_CORRUPT") : e; }
  return {intake, replayed: false};
}
