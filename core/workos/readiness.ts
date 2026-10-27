//TR: Bu dosya bir projenin ilk koşuya hazır olup olmadığını salt-okunur hesaplar; her kontrol runner/store'un kendi koşul ve gerekçe kodlarını kullanır, yeni kural icat etmez.
import type {Scope, WorkMission as Mission, Project} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {riskAdmitted, RISK_REFUSAL} from "./risk-admission.js";
import {testCommandAllowed} from "./schemas.js";
import {effectiveTestCommand, repositoryPrecondition, repositoryHead} from "./runner.js";

export type ReadinessState = "OK" | "BLOCKED" | "UNKNOWN";
export type ReadinessCheckId = "MISSION" | "RISK" | "REPOSITORY" | "TEST_COMMAND" | "PLAN";
// blocking=false: koşu başlar ama sonuç doğrulanamaz (test komutu yok -> NOT_EXECUTED) ya da plan koşu için şart değildir.
export interface ReadinessCheck { id: ReadinessCheckId; state: ReadinessState; blocking: boolean; reason: string | null; nextAction: string | null }
export interface ProjectReadiness { projectId: string; missionId: string | null; ready: boolean; verifiable: boolean; checks: ReadinessCheck[] }

// Hedef mission: en yeni tamamlanmamış; yoksa null (flow ve readiness aynı seçimi kullanır).
export const targetMission = (missions: Mission[]): Mission | undefined =>
  [...missions].filter(m => m.status !== "COMPLETE").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.missionId.localeCompare(a.missionId))[0];

const ok = (id: ReadinessCheckId, blocking = true): ReadinessCheck => ({id, state: "OK", blocking, reason: null, nextAction: null});
const bad = (id: ReadinessCheckId, reason: string, nextAction: string, blocking = true): ReadinessCheck => ({id, state: "BLOCKED", blocking, reason, nextAction});
const unknown = (id: ReadinessCheckId, blocking = true): ReadinessCheck => ({id, state: "UNKNOWN", blocking, reason: "SOURCE_UNREADABLE", nextAction: null});

// runner.ts ile AYNI saf fonksiyonlar (repositoryPrecondition, ardından repositoryHead: depo kökü ve HEAD kararı, #218); runner WORKSPACE adımı aynı kararla BLOCK eder, readiness artık "OK" deyip sonra BLOCK etmez. Yol veya URL asla döndürülmez. Git yalnız repositoryHead'in yalıtılmış (hook/config/env izole, salt-okunur rev-parse) çağrılarıyla çalışır. Sorgunun TOPLAM süresi READINESS_REPO_PROBE_MS ile sınırlıdır; süre dolarsa (takılan git) sonuç BLOCKED değil UNKNOWN'dur (belirlenemedi); hızlı başarısızlık (git yok, güvenli olmayan sahiplik, depo değil) runner'ın kendi gerekçesiyle BLOCKED kalır.
export const READINESS_REPO_PROBE_MS = 3000;
function repositoryCheck(project: Project, dataDir: string): ReadinessCheck {
  try {
    const r = repositoryPrecondition(project, dataDir);
    if (!r.ok) return bad("REPOSITORY", r.reason, "CONFIGURE_REPOSITORY");
    const t0 = Date.now();
    const h = repositoryHead(r.src, {timeoutMs: READINESS_REPO_PROBE_MS});
    if (h.ok) return ok("REPOSITORY");
    return Date.now() - t0 >= READINESS_REPO_PROBE_MS - 100 ? unknown("REPOSITORY") : bad("REPOSITORY", h.reason, "CONFIGURE_REPOSITORY");
  } catch { return unknown("REPOSITORY"); }
}

export function deriveReadiness(store: WorkOsStore, scope: Scope, projectId: string): ProjectReadiness | undefined {
  const project = store.getProject(scope, projectId);
  if (!project) return undefined;
  const mission = targetMission(store.listMissions(scope, projectId));
  const checks: ReadinessCheck[] = [];
  checks.push(mission ? ok("MISSION") : bad("MISSION", "NO_OPEN_MISSION", "CREATE_MISSION"));
  checks.push(!mission ? unknown("RISK") : riskAdmitted(mission.riskLevel) ? ok("RISK") : bad("RISK", RISK_REFUSAL, "LOWER_RISK_OR_FOUNDER_DECISION"));
  checks.push(repositoryCheck(project, store.dataDir));
  const tc = effectiveTestCommand(mission, project);
  checks.push(tc === undefined ? bad("TEST_COMMAND", "TEST_COMMAND_MISSING", "SET_TEST_COMMAND", false)
    : testCommandAllowed(tc) ? ok("TEST_COMMAND", false) : bad("TEST_COMMAND", "TEST_COMMAND_NOT_ALLOWED", "SET_TEST_COMMAND", false));
  try {
    checks.push(!mission ? unknown("PLAN", false) : store.listTasks(scope, mission.missionId).length > 0 ? ok("PLAN", false) : bad("PLAN", "NO_PLANNED_TASKS", "PLAN_MISSION", false));
  } catch { checks.push(unknown("PLAN", false)); }
  const ready = checks.filter(c => c.blocking).every(c => c.state === "OK");
  return {projectId, missionId: mission?.missionId ?? null, ready, verifiable: ready && checks.every(c => c.state === "OK"), checks};
}
