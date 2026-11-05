// //TR: PQ-008 izleme çekirdeği rota doğruluk denetimi (UASCO-T0083): types.ts'deki MOB-3 rota bayraklarının (NOT_CONNECTED/CONNECTED) sunucunun gerçek kayıtlı rotalarıyla uyuşmasını saf bir işlevle denetler; NOT_CONNECTED rota sunucuda VARSA ya da CONNECTED rota YOKSA sorun döner (bayrak kayması fark edilir). G/Ç yok: rota varlığı enjekte edilir.
import {MOBILE_ROUTES, ROUTE_CONNECTION, ROUTE_PATHS, type Connection, type MobileRoute} from "./types.js";

/** "GET /v1/mobile/x" -> {method: "GET", url: "/v1/mobile/x"}; null for a malformed declaration. */
export function parseRoutePath(decl: string): {method: string; url: string} | null {
  const m = /^(GET|POST|PUT|PATCH|DELETE) (\/v1\/mobile(?:\/[A-Za-z0-9:_-]+)+)$/.exec(decl);
  return m ? {method: m[1], url: m[2]} : null;
}

/**
 * Problems between the declared connection flags and the routes a server really registers.
 * `exists(method, url)` must answer for the exact declared path (with `:param` segments as declared).
 */
export function routeTruthProblems(
  exists: (method: string, url: string) => boolean,
  connection: Readonly<Record<MobileRoute, Connection>> = ROUTE_CONNECTION,
  paths: Readonly<Record<MobileRoute, string>> = ROUTE_PATHS,
): string[] {
  const out: string[] = [];
  for (const r of MOBILE_ROUTES) {
    const p = parseRoutePath(paths[r]);
    if (!p) { out.push(`${r}: malformed path ${paths[r]}`); continue; }
    const present = exists(p.method, p.url);
    if (connection[r] === "NOT_CONNECTED" && present) out.push(`${r}: marked NOT_CONNECTED but ${paths[r]} exists`);
    if (connection[r] === "CONNECTED" && !present) out.push(`${r}: marked CONNECTED but ${paths[r]} is not registered`);
    if (connection[r] !== "NOT_CONNECTED" && connection[r] !== "CONNECTED") out.push(`${r}: unknown connection flag`);
  }
  return out;
}
