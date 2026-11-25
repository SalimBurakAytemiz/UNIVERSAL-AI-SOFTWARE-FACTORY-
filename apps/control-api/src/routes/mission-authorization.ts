// //TR: DSK-T0008 P-B: görev başı kapsamlı yetki rotaları. GET /v1/missions/:id/authorization (geçerli kayıt ve canlı/expired/revoked durumu), POST /v1/missions/:id/authorization ({maxRisk, maxRuns, expiresAt}; politika: en çok 20 koşu, en çok 7 gün, risk = mission riski) ve POST /v1/missions/:id/authorization/revoke ({}). Yazmalar ortak kapılardan geçer (Global Stop 423, action-gateway 403, sıkı gövde 400); kayıt journal'dadır ve runner bunu koşu almadan önce uygular. Bu modül yalnız server.ts kaydı ile etkinleşir (korumalı değişiklik).
import type {FastifyInstance} from "fastify";
import type {RouteDeps} from "./deps.js";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";

const MISSION_ID_RE = /^msn_[0-9a-f]{24}$/;
/** The local Founder principal (the desktop app's only principal); grant/revoke are Founder-only. */
export const FOUNDER_PRINCIPAL = "FOUNDER_LOCAL";
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
/** Strict body: exactly {maxRisk, maxRuns, expiresAt}; any other key is refused (no scope widening, spend or risky-action field can be smuggled in). */
export function validateGrantBody(x: unknown): {ok: true} | {ok: false; errors: string} {
  if (!isObj(x)) return {ok: false, errors: "BODY_NOT_OBJECT"};
  const keys = Object.keys(x).sort().join(",");
  if (keys !== "expiresAt,maxRisk,maxRuns") return {ok: false, errors: "BODY_KEYS_INVALID"};
  if (typeof x.maxRisk !== "string" || typeof x.expiresAt !== "string" || !Number.isSafeInteger(x.maxRuns)) return {ok: false, errors: "BODY_TYPES_INVALID"};
  return {ok: true};
}
const emptyBody = (x: unknown): {ok: true} | {ok: false; errors: string} => (isObj(x) && Object.keys(x).length === 0 ? {ok: true} : {ok: false, errors: "BODY_MUST_BE_EMPTY"});
export const authorizationState = (a: {revokedAt: string | null; expiresAt: string} | undefined, nowMs: number): "NONE" | "REVOKED" | "EXPIRED" | "LIVE" =>
  !a ? "NONE" : a.revokedAt !== null ? "REVOKED" : Date.parse(a.expiresAt) <= nowMs ? "EXPIRED" : "LIVE";

export function registerMissionAuthorizationRoutes(app: FastifyInstance, d: RouteDeps): void {
  const gate = (reply: any, action: string, missionId: string, body: unknown, validate: (x: unknown) => {ok: true} | {ok: false; errors: string}): boolean => {
    // #446 N9: granting or revoking a real-run authorization is a Founder decision; any other principal is refused before any other check.
    if (d.actor !== FOUNDER_PRINCIPAL) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action, reason: "FOUNDER_ONLY"}); reply.code(403).send({error: "ACTION_DENIED", reason: "FOUNDER_ONLY"}); return false; }
    if (d.workosStopped()) { reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"}); return false; }
    const dec = d.workosPolicy(action, missionId, body);
    if (!dec.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action, reason: dec.reason}); reply.code(403).send({error: "ACTION_DENIED", reason: dec.reason}); return false; }
    const v = validate(body); if (!v.ok) { reply.code(400).send({error: "INVALID_BODY", detail: v.errors}); return false; }
    return true;
  };
  app.get<{Params: {id: string}}>("/v1/missions/:id/authorization", async (req, reply) => {
    if (!MISSION_ID_RE.test(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    try {
      const st = d.getStore(); if (!st.getMission(d.scope, req.params.id)) return reply.code(404).send({error: "WORKOS_NOT_FOUND"});
      const a = st.getMissionAuthorization(d.scope, req.params.id);
      return {authorization: a ?? null, state: authorizationState(a, Date.now())};
    } catch (e) { return d.workosFail(reply, e); }
  });
  app.post<{Params: {id: string}}>("/v1/missions/:id/authorization", {bodyLimit: LANE_WRITE_BODY_LIMIT}, async (req, reply) => {
    if (!MISSION_ID_RE.test(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    const body = req.body ?? {};
    if (!gate(reply, "workos.mission.authorization.grant", req.params.id, body, validateGrantBody)) return reply;
    try {
      const a = d.getStore().grantMissionAuthorization(d.scope, req.params.id, body as never, d.actor);
      d.audit("WORKOS_MISSION_AUTHORIZATION_GRANTED", {actor: d.actor, missionId: a.missionId, authId: a.authId, maxRisk: a.maxRisk, maxRuns: a.maxRuns, expiresAt: a.expiresAt});
      return {authorization: a, state: authorizationState(a, Date.now())};
    } catch (e) { return d.workosFail(reply, e); }
  });
  app.post<{Params: {id: string}}>("/v1/missions/:id/authorization/revoke", {bodyLimit: LANE_WRITE_BODY_LIMIT}, async (req, reply) => {
    if (!MISSION_ID_RE.test(req.params.id)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
    const body = req.body ?? {};
    if (!gate(reply, "workos.mission.authorization.revoke", req.params.id, body, emptyBody)) return reply;
    try {
      const a = d.getStore().revokeMissionAuthorization(d.scope, req.params.id, d.actor);
      d.audit("WORKOS_MISSION_AUTHORIZATION_REVOKED", {actor: d.actor, missionId: a.missionId, authId: a.authId});
      return {authorization: a, state: authorizationState(a, Date.now())};
    } catch (e) { return d.workosFail(reply, e); }
  });
}
