// //TR: docs/planning/lanes.mjs için TypeScript tip bildirimleri (testlerin strict typecheck'i için); davranış lanes.mjs'tedir.
export declare const LANE_IDS: readonly string[];
export declare const LANE_STATUSES: readonly string[];
export declare const DONE_STATUSES: readonly string[];
export declare class LaneError extends Error { code: string; constructor(code: string); }
export interface Lane {
  readonly id: string; readonly name: string; readonly status: "ACTIVE" | "STANDBY"; readonly owner: string; readonly session: string | null;
  readonly model: string; readonly taskTypes: readonly string[]; readonly packages: readonly string[]; readonly paths: readonly string[];
  readonly dependsOnLanes: readonly string[]; readonly maxActive: number; readonly maxOpenPrs: number; readonly authorityGaps: readonly string[];
}
export interface LaneRegistry {
  readonly capacity: {readonly builderCap: number; readonly ciSlots: number};
  readonly shared: readonly string[];
  readonly lanes: readonly Lane[];
  readonly byId: Map<string, Lane>;
  readonly depth: Map<string, number>;
}
export type Matcher = (normalisedPath: string) => string | null;
export interface InFlight { id: string; laneId: string | null; files: string[]; building: boolean; prOpen: boolean; ciBusy: boolean }
export interface Assignment { taskId: string; lane: string; wave: number; after: string[]; reason: "START" | "AFTER_CONFLICT" | "CAPACITY" }
export interface Deferred { taskId: string; lane: string | null; reason: string }
export interface LanePlan {
  capacity: {builderCap: number; ciSlots: number};
  inFlight: {building: number; ciBusy: number; tasks: {taskId: string; lane: string | null}[]};
  startNow: {taskId: string; lane: string}[];
  assignments: Assignment[];
  deferred: Deferred[];
  lanes: {lane: string; status: string; active: number; openPrs: number; startNow: string[]}[];
}
export declare function covers(entry: string, file: string): boolean;
export declare function pathsOverlap(a: string, b: string): boolean;
export declare function protectedMatcher(pp: unknown): Matcher;
export declare function repoProtectedMatcher(): Matcher;
export declare function loadLaneRegistry(file: string, opts?: {matcher?: Matcher}): LaneRegistry;
export declare function validateLaneRegistry(doc: unknown, opts?: {matcher?: Matcher}): LaneRegistry;
export declare function ownerOf(reg: LaneRegistry, file: string): Lane | null;
export declare function routeTask(task: unknown, reg: LaneRegistry, matcher?: Matcher): {lane?: Lane; error?: string; files: string[]};
export declare function planLanes(input: {tasks: unknown[]; eligible: Set<string>; inFlight?: InFlight[]; registry: LaneRegistry; matcher?: Matcher}): LanePlan;
export declare function planDispatch(input: {tasks: unknown[]; env: {claimedHeads: Set<string>; openPrs: Set<string>; [k: string]: unknown};
  registry: LaneRegistry; evaluate: (t: unknown, env: any) => string[]; claimBranchOf: (id: string) => string; matcher?: Matcher}): LanePlan;
export declare function laneSkips(plan: LanePlan, laneId: string): Map<string, string>;
export declare function laneReport(tasks: unknown[], reg: LaneRegistry, matcher?: Matcher): {
  lanes: {lane: string; name: string; status: string; session: string | null; model: string; tasks: Record<string, number>; gaps: string[]}[];
  unrouted: Record<string, string[]>;
};
