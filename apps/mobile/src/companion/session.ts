// //TR: Mobil Companion bağlantı durumu (UASCO-T0083): her okuma turu iki mevcut rotayı birlikte okur; ikisi de başarılıysa LIVE ve "son başarılı okuma" zamanı güncellenir. Masaüstüne ulaşılamazsa OFFLINE (yetkisizse DENIED, diğer hatada ERROR) olur, son başarılı okuma zamanı gösterilir ve eski veri ASLA güncelmiş gibi sunulmaz (ekranlara başarısız sonuç verilir; satır gösterilmez).
import type {ApiResult, AttentionQueue, CompanionClient, ControlStatus} from "./api-client.js";

export type ConnectionState = "NEVER_READ" | "LIVE" | "OFFLINE" | "DENIED" | "ERROR";
export interface Connection {
  readonly state: ConnectionState;
  /** ISO time of the last round in which BOTH reads succeeded; null = never. */
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
  /** ms between the last success and the last attempt when not LIVE; null otherwise. */
  readonly staleForMs: number | null;
  /** First failure of the last round, e.g. "offline:UNREACHABLE". */
  readonly failure: string | null;
}
export interface ReadRound { readonly status: ApiResult<ControlStatus>; readonly attention: ApiResult<AttentionQueue>; readonly connection: Connection }

const failureOf = (r: ApiResult<unknown>): {state: ConnectionState; code: string} | null =>
  r.kind === "ok" ? null : {state: r.kind === "offline" ? "OFFLINE" : r.kind === "denied" ? "DENIED" : "ERROR", code: `${r.kind}:${r.code}`};

/** Session over the read-only client. now() is injected (epoch ms). Screens receive the round's own results, never a cached snapshot. */
export function createCompanionSession(client: CompanionClient, now: () => number) {
  let lastOk: number | null = null, lastAttempt: number | null = null, fail: {state: ConnectionState; code: string} | null = null;
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
  const connection = (): Connection => {
    if (lastAttempt === null) return {state: "NEVER_READ", lastSuccessAt: null, lastAttemptAt: null, staleForMs: null, failure: null};
    if (fail === null) return {state: "LIVE", lastSuccessAt: iso(lastOk), lastAttemptAt: iso(lastAttempt), staleForMs: null, failure: null};
    return {state: fail.state, lastSuccessAt: iso(lastOk), lastAttemptAt: iso(lastAttempt), staleForMs: lastOk === null ? null : Math.max(0, lastAttempt - lastOk), failure: fail.code};
  };
  return {
    connection,
    async read(): Promise<ReadRound> {
      const t = now();
      const [status, attention] = await Promise.all([client.controlStatus(), client.attention()]);
      lastAttempt = t;
      // A round is LIVE only if both reads succeeded; a partial success never refreshes "last successful read".
      fail = failureOf(status) ?? failureOf(attention);
      if (fail === null) lastOk = t;
      return {status, attention, connection: connection()};
    },
  };
}
