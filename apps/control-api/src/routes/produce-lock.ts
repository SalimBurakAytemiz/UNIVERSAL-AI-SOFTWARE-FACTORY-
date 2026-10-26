//TR: Süreç genelinde AYNI ANDA en çok BİR ücretli üretim (pre-dev produce VE analiz adımı ortak): aynı misyonda ikinci çağrı IN_PROGRESS, başka misyonda BUSY; ikisi de süreç başlatmadan 409. Kilit modül düzeyindedir, böylece iki route ailesi aynı kilidi paylaşır.
let producingMission: string | null = null;

export type ProduceLock = {ok: true; release: () => void} | {ok: false; error: "PREDEV_PRODUCE_IN_PROGRESS" | "PREDEV_PRODUCE_BUSY"};

/** Kilidi alır; alınamazsa 409 hata kodu döner. release() yalnız bu çağrının aldığı kilidi bırakır (çift çağrı zararsız). */
export function tryProduceLock(missionId: string): ProduceLock {
  if (producingMission !== null) return {ok: false, error: producingMission === missionId ? "PREDEV_PRODUCE_IN_PROGRESS" : "PREDEV_PRODUCE_BUSY"};
  producingMission = missionId;
  let held = true;
  return {ok: true, release: () => { if (held) { held = false; producingMission = null; } }};
}
