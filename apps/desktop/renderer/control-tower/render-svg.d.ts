// //TR: Bu bildirim dosyası render-svg.js için tip sözleşmesini verir; yalnızca tsc typecheck içindir.
import type { CampusModel, Locale } from "./model.js";
export function renderCampusSvg(model: CampusModel, opts?: { t?: number; reducedMotion?: boolean; locale?: Locale }): string;
