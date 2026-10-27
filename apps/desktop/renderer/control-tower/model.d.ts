// //TR: Bu bildirim dosyası model.js için tip sözleşmesini verir; yalnızca tsc typecheck içindir, runtime davranışı değiştirmez.
export type Locale = "tr" | "en";
export type BuildingState = "VERIFIED" | "UNAVAILABLE";
export type GlobalState = "RUNNING" | "STOPPED" | "UNAVAILABLE";
export interface CatalogInput { clusters: { clusterId: string; name: string }[]; guilds: { guildId: string; name: string; clusterId: string }[]; roles?: Record<string, number> }
export interface RunInput { runId: string; missionId?: string | null; status: string; roleId?: string | null; guildId?: string | null }
export interface CampusInput { cockpit: { globalStop?: { active?: boolean; reason?: string | null } } | null; catalog: CatalogInput | null; runs: RunInput[] | null; runsCutAt?: number | null }
export interface Building { guildId: string; clusterId: string; name: string; x: number; y: number; width: number; height: number; targetRoles: number | null; activeRuns: number | null; state: BuildingState }
export interface District { clusterId: string; name: string; x: number; y: number; width: number; height: number; buildingCount: number; targetRoles: number | null; activeRuns: number | null; state: BuildingState }
export interface CampusModel {
  schema: string; globalState: GlobalState; stopReason: string | null;
  dataState: { cockpit: boolean; catalog: boolean; runs: boolean }; campusState: BuildingState;
  canvas: { width: number; height: number }; tower: { id: string; name: string; x: number; y: number; r: number };
  districts: District[]; buildings: Building[];
  totals: { districts: number; buildings: number; targetRoles: number | null; activeRuns: number | null; unattributedActiveRuns: number | null };
  diagnostics: { orphanGuildIds: string[] };
}
export const MODEL_SCHEMA: string;
export function buildCampusModel(input: CampusInput | null | undefined): CampusModel;
