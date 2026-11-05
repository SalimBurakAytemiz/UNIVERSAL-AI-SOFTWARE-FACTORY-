// //TR: UASCO-T0083 sözleşme testi (ve RESUME_RUN ayrıştırma uyumu): Mobil Companion istemcisi GERÇEK control-api'ye (buildServer, süreç içi inject; ağ yok) karşı çalışır; /v1/attention ve /v1/control/status yanıtları istemcinin katı ayrıştırıcısından geçer, ekran modelleri gerçek Work OS kayıtlarından türetilir; token'sız/yanlış token reddedilir. Ücretli/gerçek sağlayıcı yok.
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {HDR, rmTmp, setup, tmpRoot, api} from "./relfx.js";
import {createCompanionClient, parseAttention, type CompanionTransport} from "../../apps/mobile/src/companion/api-client.js";
import {approvalAction, approvalDetail, approvalsList, notificationsList, statusOverview} from "../../apps/mobile/src/companion/screens.js";

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


    describe("UASCO-T0083 x T0049 (3): RESUME_RUN parse compatibility", () => {
      const ZERO = {RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, MISSION_FOUNDER_ATTENTION: 0, MISSION_AUTHORIZATION_PENDING: 0, MISSION_BLOCKED: 0, TASK_BLOCKED: 0};
      const it0 = (o: Record<string, unknown>) => ({kind: "RUN_NEEDS_DECISION", nextAction: "REVIEW_RUN", projectId: "prj_1", missionId: "msn_1", runId: "run_1", taskId: null,
        title: "Blocked run", reason: "PROVIDER_QUOTA", since: "2026-11-05T10:00:00.000Z", ...o});
      const body = (items: unknown[]) => ({attention: {items, counts: {...ZERO, RUN_NEEDS_DECISION: items.length}, truncated: false, source: "WORKOS"}});
      it("a RUN_NEEDS_DECISION item with RESUME_RUN no longer makes the queue MALFORMED; RESUME_RUN on another kind still does; old REVIEW_RUN items unchanged", () => {
        const q = parseAttention(body([it0({nextAction: "RESUME_RUN", reason: "PROVIDER_QUOTA (resume after 2026-11-05T12:00:00.000Z)"})]));
        expect(q?.items.map(i => i.nextAction)).toEqual(["RESUME_RUN"]);
        expect(approvalAction(q!.items[0]).approve).toEqual(expect.objectContaining({enabled: false, desktopRoute: null}));   // still read-only on the phone
        expect(parseAttention(body([it0({})]))?.items.map(i => i.nextAction)).toEqual(["REVIEW_RUN"]);   // positive control: older server shape
        expect(parseAttention({attention: {items: [it0({kind: "MISSION_BLOCKED", nextAction: "RESUME_RUN", runId: null})], counts: {...ZERO, MISSION_BLOCKED: 1}, truncated: false, source: "WORKOS"}})).toBeNull();
      });
    });

  });
}
