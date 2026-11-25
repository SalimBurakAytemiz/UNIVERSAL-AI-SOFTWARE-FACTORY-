// //TR: UASCO-T0083 PQ-008 rota doğruluğu testleri: gerçek control-api'nin (buildServer) kayıtlı rotalarına karşı izleme çekirdeğinin NOT_CONNECTED/CONNECTED bayrakları denetlenir; uydurma bayrak kayması (var olmayan rotayı CONNECTED, var olanı NOT_CONNECTED saymak) yakalanır.
import {describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {api, rmTmp, setup} from "./relfx.js";
import {MOBILE_ROUTES, ROUTE_CONNECTION, ROUTE_PATHS} from "../../apps/mobile/src/core/types.js";
import {parseRoutePath, routeTruthProblems} from "../../apps/mobile/src/core/route-truth.js";

/** Registered from tests/v7-b5-work-screens.test.ts (listed in config/validation.json). */
export function registerMobileRouteTruthSuite(): void {
  describe("UASCO-T0083 PQ-008 monitoring core: declared /v1/mobile route flags match the real control-api", () => {
    it("every declared path parses; against the real server every flag is true (today: all NOT_CONNECTED and none registered)", async () => {
      for (const r of MOBILE_ROUTES) expect(parseRoutePath(ROUTE_PATHS[r]), r).not.toBeNull();
      const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-mobile-routes-"));
      try {
        const app = await api(setup(tmp, "tA"));
        try {
          const exists = (method: string, url: string) => app.hasRoute({method: method as never, url});
          expect(exists("GET", "/v1/attention")).toBe(true);   // positive control: the probe sees real routes
          expect(routeTruthProblems(exists)).toEqual([]);
          // drift detection on the same real server: claiming CONNECTED for an absent route is caught
          expect(routeTruthProblems(exists, {...ROUTE_CONNECTION, summary: "CONNECTED"})).toEqual(["summary: marked CONNECTED but GET /v1/mobile/summary is not registered"]);
        } finally { await app.close(); }
      } finally { rmTmp(tmp); }
    }, 120_000);

    it("pure: a NOT_CONNECTED route that exists, a malformed path and an unknown flag are reported", () => {
      const has = new Set(["GET /v1/mobile/runs"]);
      const exists = (m: string, u: string) => has.has(`${m} ${u}`);
      expect(routeTruthProblems(exists)).toEqual(["runs: marked NOT_CONNECTED but GET /v1/mobile/runs exists"]);
      expect(routeTruthProblems(exists, {...ROUTE_CONNECTION, runs: "CONNECTED"})).toEqual([]);   // positive control: a flipped flag that matches reality
      expect(routeTruthProblems(() => false, ROUTE_CONNECTION, {...ROUTE_PATHS, ops: "GET /v1/ops"})).toEqual(["ops: malformed path GET /v1/ops"]);
      expect(routeTruthProblems(() => false, {...ROUTE_CONNECTION, ops: "MAYBE" as never})).toEqual(["ops: unknown connection flag"]);
      expect(parseRoutePath("GET /v1/mobile/missions/:missionId/timeline")).toEqual({method: "GET", url: "/v1/mobile/missions/:missionId/timeline"});
      expect(parseRoutePath("GET /v1/mobile/x y")).toBeNull();
    });
  });
}
