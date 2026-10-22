// //TR: Bu dosya (1) bir rol bağlamasının sağlayıcı rotasının GERÇEKTEN hazır olup olmadığını salt-okunur (dosya yazmadan) raporlar ve (2) çalışan ajanın checkpoint/restore'unu sağlar. Hazır değilse dürüst durum (LOGIN_REQUIRED/REFUSED/UNAVAILABLE) döner; kişisel Claude profiline asla geri düşülmez. Restore, bağlama artık yürütülebilir değilse veya özet bozulmuşsa fail-closed reddeder. Model/ağ/shell yok.
import crypto from "node:crypto";
import {claudeProfileStatus} from "../workos/claude-profiles.js";
import type {ClaudeProfileOptions} from "../workos/claude-profiles.js";
import {AgentError, claudeProfileRoleOf, profileDefect} from "./role-execution.js";
import type {AgentState, RoleExecutionProfile, RunningAgent, ToolUseTrace} from "./role-execution.js";

// //TR: Rota hazırlığı: yalnız doğrulanmış okumadan pozitif durum (READY); diğerleri sabit nedenli.
export type RouteReadiness =
  | {state: "READY"; route: RoleExecutionProfile["providerRoute"]}
  | {state: "NOT_READY"; route: RoleExecutionProfile["providerRoute"]; reason: string};

export function routeReadiness(profile: RoleExecutionProfile, controlRoot: string, o: ClaudeProfileOptions = {}): RouteReadiness {
  const route = profile.providerRoute;
  if (route === "NONE") return {state: "NOT_READY", route, reason: "PROVIDER_ROUTE_MISSING"};
  if (route === "DETERMINISTIC_STUDIO") return {state: "READY", route};
  const role = claudeProfileRoleOf(route);
  if (!role) return {state: "NOT_READY", route, reason: "PROVIDER_ROUTE_UNKNOWN"};
  let s;
  try { s = claudeProfileStatus(controlRoot, role, o); } catch { return {state: "NOT_READY", route, reason: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}; }
  if (s.state === "READY" && s.settings === "PRESENT") return {state: "READY", route};
  if (s.state === "LOGIN_REQUIRED") return {state: "NOT_READY", route, reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"};
  return {state: "NOT_READY", route, reason: `CLAUDE_PROFILE_REFUSED:${s.reason ?? (s.settings !== "PRESENT" ? "SETTINGS_NOT_WRITTEN" : "UNKNOWN")}`};
}

// //TR: Checkpoint: ajanın kalıcı özeti (profil gövdesi DEĞİL, yalnız bağlama parmak izi). Restore sırasında güncel bağlama aynı parmak izini vermelidir.
export interface AgentCheckpoint {
  agentInstanceId: string; roleId: string; runId: string; state: AgentState; toolTrace: ToolUseTrace[]; profileDigest: string; digest: string;
}
const sha = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const profileDigest = (p: RoleExecutionProfile): string => sha(p);

export function checkpointAgent(a: RunningAgent): AgentCheckpoint {
  const body = {agentInstanceId: a.agentInstanceId, roleId: a.roleId, runId: a.runId, state: a.state, toolTrace: a.toolTrace.map(t => ({...t})), profileDigest: profileDigest(a.profile)};
  return {...body, digest: sha(body)};
}

// //TR: Restore fail-closed: özet bozuksa, bağlama yoksa/değiştiyse veya artık tam değilse reddedilir. Durum aynen korunur; yeniden başlatma kararı runner'ındır.
export function restoreAgent(cp: AgentCheckpoint, bindings: readonly RoleExecutionProfile[]): RunningAgent {
  const {digest, ...body} = cp;
  if (typeof digest !== "string" || sha(body) !== digest) throw new AgentError("AGENT_CHECKPOINT_CORRUPT");
  const profile = bindings.find(b => b.roleId === cp.roleId);
  if (!profile) throw new AgentError("AGENT_RESTORE_ROLE_HAS_NO_BINDING");
  if (profileDigest(profile) !== cp.profileDigest) throw new AgentError("AGENT_RESTORE_BINDING_CHANGED");
  const d = profileDefect(profile);
  if (d) throw new AgentError(`AGENT_RESTORE_NOT_EXECUTABLE:${d.reason}`);
  return {agentInstanceId: cp.agentInstanceId, roleId: cp.roleId, runId: cp.runId, profile, state: cp.state, toolTrace: cp.toolTrace.map(t => ({...t}))};
}
