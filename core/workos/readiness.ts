//TR: Bu dosya bir projenin ilk koşuya hazır olup olmadığını salt-okunur hesaplar; her kontrol runner/store'un kendi koşul ve gerekçe kodlarını kullanır, yeni kural icat etmez.
import type {Scope, WorkMission as Mission, Project} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {riskAdmitted, RISK_REFUSAL} from "./risk-admission.js";
import {testCommandAllowed} from "./schemas.js";
import {effectiveTestCommand, repositoryPrecondition, repositoryHeadAsync} from "./runner.js";

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

// runner.ts ile AYNI karar prosedürü (repositoryPrecondition, ardından repositoryHeadAsync: depo kökü ve HEAD, #218); runner WORKSPACE adımı aynı kararla BLOCK eder, readiness artık "OK" deyip sonra BLOCK etmez. EŞZAMANSIZ sürücü şarttır: bu okuma control-api sürecinde (MissionRunner, Global Stop, lease yenileme ile aynı olay döngüsü) çalışır; eşzamanlı spawnSync takılan bir git'te tüm süreci dondururdu. Yol veya URL asla döndürülmez. Yalıtım: host global/system config'i, hook'lar ve ortam izole edilir; depo-yerel .git/config ve include.path hedefleri okunmaya DEVAM eder; yalnız salt-okunur rev-parse çalışır. Sorgunun TOPLAM süresi READINESS_REPO_PROBE_MS ile sınırlıdır; süre dolarsa (takılan git) sonuç BLOCKED değil UNKNOWN'dur (belirlenemedi); süre tek yönlü saatle (performance.now) ölçülür, duvar saati geri alınsa da karar değişmez. Hızlı başarısızlık (git yok, güvenli olmayan sahiplik, depo değil) runner'ın kendi gerekçesiyle BLOCKED kalır.
export const READINESS_REPO_PROBE_MS = 3000;
// //TR: Zaman aşımında yalnız DOĞRUDAN git çocuğu öldürülür ve akışlar yok edilir; `setsid` ile kaçmış bir torun öldürülmez (bilinen sınır) ama bütçeyi artık tutamaz. Probe çocuğu ayrı grup/oturuma alınmaz: terminal sinyalleri ona ulaşır.
// //TR: Aynı depo yolu için eşzamanlı okumalar TEK probu paylaşır (single-flight): N paralel GET, N*k git çocuğu üretmez. Bilinen Windows sınırı (bu PR'dan önce de vardı): git-async kill() Windows'ta `taskkill`'ı eşzamanlı ve zaman aşımsız spawnSync ile çağırır; yani M1 (olay döngüsü) POSIX'te tam, Windows'ta zaman aşımı yolunda yalnız taskkill süresince bloklanır.
const inflight = new Map<string, Promise<ReadinessCheck>>();
async function probeRepository(src: string): Promise<ReadinessCheck> {
  const t0 = performance.now();
  const h = await repositoryHeadAsync(src, {timeoutMs: READINESS_REPO_PROBE_MS});
  if (h.ok) return ok("REPOSITORY");
  return performance.now() - t0 >= READINESS_REPO_PROBE_MS - 100 ? unknown("REPOSITORY") : bad("REPOSITORY", h.reason, "CONFIGURE_REPOSITORY");
}
async function repositoryCheck(project: Project, dataDir: string): Promise<ReadinessCheck> {
  try {
    const r = repositoryPrecondition(project, dataDir);
    if (!r.ok) return bad("REPOSITORY", r.reason, "CONFIGURE_REPOSITORY");
    let p = inflight.get(r.src);
    if (!p) { const q = probeRepository(r.src).finally(() => { inflight.delete(r.src); }); inflight.set(r.src, q); p = q; }
    return await p;
  } catch { return unknown("REPOSITORY"); }
}

export async function deriveReadiness(store: WorkOsStore, scope: Scope, projectId: string): Promise<ProjectReadiness | undefined> {
  const project = store.getProject(scope, projectId);
  if (!project) return undefined;
  const mission = targetMission(store.listMissions(scope, projectId));
  const checks: ReadinessCheck[] = [];
  checks.push(mission ? ok("MISSION") : bad("MISSION", "NO_OPEN_MISSION", "CREATE_MISSION"));
  checks.push(!mission ? unknown("RISK") : riskAdmitted(mission.riskLevel) ? ok("RISK") : bad("RISK", RISK_REFUSAL, "LOWER_RISK_OR_FOUNDER_DECISION"));
  checks.push(await repositoryCheck(project, store.dataDir));
  const tc = effectiveTestCommand(mission, project);
  checks.push(tc === undefined ? bad("TEST_COMMAND", "TEST_COMMAND_MISSING", "SET_TEST_COMMAND", false)
    : testCommandAllowed(tc) ? ok("TEST_COMMAND", false) : bad("TEST_COMMAND", "TEST_COMMAND_NOT_ALLOWED", "SET_TEST_COMMAND", false));
  try {
    checks.push(!mission ? unknown("PLAN", false) : store.listTasks(scope, mission.missionId).length > 0 ? ok("PLAN", false) : bad("PLAN", "NO_PLANNED_TASKS", "PLAN_MISSION", false));
  } catch { checks.push(unknown("PLAN", false)); }
  const ready = checks.filter(c => c.blocking).every(c => c.state === "OK");
  return {projectId, missionId: mission?.missionId ?? null, ready, verifiable: ready && checks.every(c => c.state === "OK"), checks};
}
