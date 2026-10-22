//TR: Bu dosya bir projenin ilk koşuya hazır olup olmadığını salt-okunur hesaplar; her kontrol runner/store'un kendi koşul ve gerekçe kodlarını kullanır, yeni kural icat etmez.
import type {Scope, WorkMission as Mission, Project} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {riskAdmitted, RISK_REFUSAL} from "./risk-admission.js";
import {testCommandAllowed} from "./schemas.js";
import {managedRepoCanonical, pathOverlapsDataDir} from "./path-guard.js";

export type ReadinessState = "OK" | "BLOCKED" | "UNKNOWN";
export type ReadinessCheckId = "MISSION" | "RISK" | "REPOSITORY" | "TEST_COMMAND" | "PLAN";
// blocking=false: koşu başlar ama sonuç doğrulanamaz (test komutu yok -> NOT_EXECUTED) ya da plan koşu için şart değildir.
export interface ReadinessCheck { id: ReadinessCheckId; state: ReadinessState; blocking: boolean; reason: string | null; nextAction: string | null }
export interface ProjectReadiness { projectId: string; missionId: string | null; ready: boolean; verifiable: boolean; checks: ReadinessCheck[] }

// //TR: runner.ts rawTestCommand ile AYNI öncelik (mission komutu proje komutunu ezer). runner.ts Lane C'nindir; sapma tests/v7-b1-workos.test.ts'teki eşlik testiyle yakalanır.
export const effectiveTestCommand = (m: Pick<Mission, "testCommand"> | undefined, p: Pick<Project, "testCommand"> | undefined): string[] | undefined => m?.testCommand ?? p?.testCommand;
// Hedef mission: en yeni tamamlanmamış; yoksa null (flow ve readiness aynı seçimi kullanır).
export const targetMission = (missions: Mission[]): Mission | undefined =>
  [...missions].filter(m => m.status !== "COMPLETE").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.missionId.localeCompare(a.missionId))[0];

const ok = (id: ReadinessCheckId, blocking = true): ReadinessCheck => ({id, state: "OK", blocking, reason: null, nextAction: null});
const bad = (id: ReadinessCheckId, reason: string, nextAction: string, blocking = true): ReadinessCheck => ({id, state: "BLOCKED", blocking, reason, nextAction});
const unknown = (id: ReadinessCheckId, blocking = true): ReadinessCheck => ({id, state: "UNKNOWN", blocking, reason: "SOURCE_UNREADABLE", nextAction: null});

// runner.ts stepWorkspace (repo?.path / url / managed / pathOverlapsDataDir) sırası ve gerekçe kodları; yol veya URL asla döndürülmez.
function repositoryCheck(project: Project, dataDir: string): ReadinessCheck {
  const repo = project.repository;
  if (!repo?.path) return bad("REPOSITORY", repo?.url ? "REMOTE_REPO_NOT_SUPPORTED_YET" : "REPOSITORY_NOT_CONFIGURED", "CONFIGURE_REPOSITORY");
  try {
    if (repo.managed === true) return managedRepoCanonical(dataDir, project.projectId, repo.path) ? ok("REPOSITORY") : bad("REPOSITORY", "REPOSITORY_NOT_MANAGED", "CONFIGURE_REPOSITORY");
    return pathOverlapsDataDir(repo.path, dataDir).forbidden ? bad("REPOSITORY", "REPOSITORY_PATH_FORBIDDEN", "CONFIGURE_REPOSITORY") : ok("REPOSITORY");
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
