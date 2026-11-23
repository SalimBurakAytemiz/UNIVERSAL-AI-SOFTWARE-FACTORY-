// //TR: Factory V2 güvenli devir: canlı alan sahipliği yalnız (a) eski sahibin fence token'ıyla imzaladığı HANDOVER kaydı ve lease'i bırakması ya da (b) eski lease'in süresinin dolması ile yeni Supervisor'a geçer; devirden sonra eski sahip yeni claim/yazı yapamaz (fence). Bu modül devri canlı etkinleştirmez; canlı devir eski V4.1 oturumunun katılımını gerektirir.
import {Ownership, supervisorLeaseId} from "./ownership.mjs";
export function handover({store, domain, from, to, journal, inFlight = []}) {
  // from: Ownership currently holding the domain; to: {environment, workerId, sessionId, ttlMs, now}
  const fence = from.fence(); // old owner must still hold it: a lost owner cannot hand over
  const record = {kind: "HANDOVER", idempotencyKey: `handover:${fence.token}`, data: {domain, fromSession: from.sessionId, toSession: to.sessionId, fromToken: fence.token, fromEpoch: fence.epoch, inFlight}};
  journal?.append(record, {epoch: journal.maxFenceEpoch, token: fence.token});
  if (!from.release()) throw new Error("HANDOVER_RELEASE_FAILED");
  const next = new Ownership(store, {leaseId: supervisorLeaseId(domain), ...to});
  const a = next.acquire();
  if (!a.granted) throw new Error("HANDOVER_ACQUIRE_FAILED"); // a third party raced in: fail closed, nobody new is promoted silently
  return {owner: next, inFlight};
}
