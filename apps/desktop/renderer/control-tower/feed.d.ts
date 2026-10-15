// //TR: Bu bildirim dosyası feed.js için tip sözleşmesini verir; yalnızca tsc typecheck içindir.
import type { CampusInput } from "./model.js";
export function globalStopSource(cockpit: unknown, control: unknown): CampusInput["cockpit"];
export function catalogFromRoles(roles: unknown): CampusInput["catalog"];
export function runsFromWorkRuns(workRuns: unknown, roles: unknown): CampusInput["runs"];
export function buildCampusInput(src: { cockpit?: unknown; control?: unknown; roles?: unknown; workRuns?: unknown }): CampusInput;
