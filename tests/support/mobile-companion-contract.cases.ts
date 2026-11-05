// //TR: UASCO-T0083 sözleşme testi: Mobil Companion istemcisi GERÇEK control-api'ye (buildServer, süreç içi inject; ağ yok) karşı çalışır; /v1/attention ve /v1/control/status yanıtları istemcinin katı ayrıştırıcısından geçer, ekran modelleri gerçek Work OS kayıtlarından türetilir; token'sız/yanlış token reddedilir. Ücretli/gerçek sağlayıcı yok.
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {HDR, rmTmp, setup, tmpRoot, api} from "./relfx.js";
import {createCompanionClient, type CompanionTransport} from "../../apps/mobile/src/companion/api-client.js";
import {approvalDetail, approvalsList, notificationsList, statusOverview} from "../../apps/mobile/src/companion/screens.js";

/** Registered from tests/v7-b1-workos.test.ts (listed in config/validation.json); the suite's hooks are scoped to this describe. */
export function registerMobileCompanionContractSuite(): void {
  describe("UASCO-T0083 mobile companion contract", () => {

    let tmp = "";
    beforeEach(() => { tmp = tmpRoot("uasco-mobile-"); });
    afterEach(() => rmTmp(tmp));

    const injectTransport = (app: {inject: (o: object) => Promise<{statusCode: number; body: string}>}, headers: Record<string, string>): CompanionTransport => ({
      async get(url) { const r = await app.inject({method: "GET", url, headers}); let body: unknown = null; try { body = JSON.parse(r.body); } catch { body = null; } return {status: r.statusCode, body}; },
    });

    describe("UASCO-T0083 companion client against the real control-api (in-process inject)", () => {
      it("reads status + attention from real routes; a PREFLIGHT mission appears as a pending approval with disabled actions", async () => {
        const c = setup(tmp, "tA", {authorize: false});
        c.store.transitionMission({tenantId: "tA"}, c.missionId, "PREFLIGHT", "test", "FOUNDER_LOCAL");
        const app = await api(c);
        try {
          const client = createCompanionClient(injectTransport(app, HDR));
          const [st, at] = [await client.controlStatus(), await client.attention()];
          expect(st).toEqual({kind: "ok", data: {globalStop: {active: false, reason: null}, journal: {state: "OK", reason: null}, verification: null}});
          expect(at.kind).toBe("ok");
          const ov = statusOverview(st, at);
          expect(ov.header.state).toBe("OK");
          expect(ov.attentionCounts?.MISSION_AUTHORIZATION_PENDING).toBe(1);
          const list = approvalsList(at);
          expect(list.rows).toEqual([expect.objectContaining({kind: "MISSION_AUTHORIZATION_PENDING", title: "Add feature", projectId: c.projectId, nextAction: "AUTHORIZE_MISSION"})]);
          const d = approvalDetail(at, list.rows[0].id);
          expect(d.found).toBe(true);
          expect(d.item?.missionId).toBe(c.missionId);
          expect(d.approve).toEqual(expect.objectContaining({enabled: false, desktopRoute: "POST /v1/missions/:id/transition"}));
          expect(notificationsList(at).rows.map(r => r.severity)).toEqual(["ACTION"]);
        } finally { await app.close(); }
      });

      it("empty Work OS -> EMPTY screens (nothing invented); wrong token and wrong Host are DENIED", async () => {
        const c = setup(tmp, "tA");   // AUTHORIZED mission: no attention item
        const app = await api(c);
        try {
          const at = await createCompanionClient(injectTransport(app, HDR)).attention();
          expect(approvalsList(at).header.state).toBe("EMPTY");
          expect(notificationsList(at).rows).toEqual([]);
          expect(await createCompanionClient(injectTransport(app, {...HDR, "x-uasco-control-token": "wrong"})).attention()).toEqual({kind: "denied", code: "FORBIDDEN"});
          expect(await createCompanionClient(injectTransport(app, {...HDR, host: "phone.example:3210"})).controlStatus()).toEqual({kind: "denied", code: "HOST_REJECTED"});
        } finally { await app.close(); }
      });
    });

  });
}
