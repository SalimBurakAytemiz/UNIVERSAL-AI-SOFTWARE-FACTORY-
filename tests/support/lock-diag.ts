// //TR: C-PAR03-DIAG-1: LOCK_TIMEOUT tanısını (store.writeStats().lastLockTimeout) tek satırlık metne çevirir. vitest İÇE AKTARMAZ: hem hbDiag (vitest) hem de ayrı süreçte çalışan tests/v7-par-engine.mts bunu kullanır. Salt okunur biçimlendirme; davranış değişmez.
interface LockTimeoutLike {
  atWall: number; waitedMs: number; retries: number; limitMs: number;
  lastError: {code: string | null; message: string}; failures: Record<string, number>;
  file: {state: string; code: string | null; sizeBytes: number | null; mtimeAgeMs: number | null};
  open: {ok: boolean; code: string | null};
  holder: {state: string; code: string | null; pid: number | null; hostname: string | null; runId: string | null; startedAt: string | null; ageMs: number | null; pidAlive: boolean | null; ownPid: boolean};
  deletePendingSuspected: boolean; suspicion: string[];
}
export interface LockDiagStats { lockTimeouts: number; lockRetries: number; lockWaitMsTotal: number; lockWaitMsMax: number; lastLockTimeout: LockTimeoutLike | null }
export const lockDiagText = (stats: LockDiagStats): string => {
  const t = stats.lastLockTimeout;
  if (stats.lockTimeouts === 0 || t === null) return `lock timeouts: 0 (lock retries ${stats.lockRetries}, total wait ${stats.lockWaitMsTotal} ms, longest ${stats.lockWaitMsMax} ms)`;
  const h = t.holder;
  return [
    `LOCK_TIMEOUT x${stats.lockTimeouts}: last waited ${t.waitedMs} ms of ${t.limitMs} ms (${t.retries} retries) at wall=${t.atWall}`,
    `holder ${h.state} pid=${h.pid ?? "?"}${h.ownPid ? " (THIS process)" : ""} alive=${h.pidAlive ?? "?"} runId=${h.runId ?? "?"} host=${h.hostname ?? "?"} startedAt=${h.startedAt ?? "?"} age=${h.ageMs ?? "?"} ms${h.code ? ` readCode=${h.code}` : ""}`,
    `lock file ${t.file.state}${t.file.code ? `/${t.file.code}` : ""} size=${t.file.sizeBytes ?? "?"} mtimeAge=${t.file.mtimeAgeMs ?? "?"} ms; open ${t.open.ok ? "ok" : `FAILED/${t.open.code ?? "?"}`}`,
    `last acquire error ${t.lastError.code ?? "-"}: ${t.lastError.message}`,
    `acquire failures ${JSON.stringify(t.failures)}`,
    `deletePendingSuspected=${t.deletePendingSuspected}${t.suspicion.length > 0 ? ` [${t.suspicion.join(", ")}]` : ""}`
  ].join("; ");
};
