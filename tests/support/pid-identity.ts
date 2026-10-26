// //TR: YALNIZ TEST: "bu süreç artık ölü mü" denetimleri için süreç kimliği (pid + başlangıç zamanı) yardımcısı; vitest dosyası DEĞİL (tests/*.test.ts değildir, kayıt gerektirmez). Windows pid'leri hızla yeniden kullanır: çıplak pidAlive(pid) (process.kill(pid, 0); EPERM canlı sayılır) gerçekten sonlanmış sürecin pid'ini alan yeni ve ilgisiz bir süreci "canlı" okuyabilir (Windows CI: v7-ps1a-project-studio restart/stop, v7-ps1a-c2 restart). Kimlik süreç canlıyken yakalanır; yakalama ÖLÜMCÜL DEĞİLDİR (yoğun runner'da başlangıç zamanı okunamazsa null) ve null kimlik bugünkü çıplak pidAlive denetimine düşer, yani hiçbir denetim bugünkünden zayıf değildir. Ürün kodu bu dosyayı import etmez.
import {pidAlive, processStartTime, startTimeMs} from "../../core/workos/devrun.js";

export interface PidIdentity { pid: number; start: string | null }

// Saat payı: başlangıç zamanı yakalama çağrısından (seenAt) bu kadar sonra görünen süreç, canlı olduğu bilinen asıl süreç olamaz.
// Linux başlangıç zamanı açılış anı tahmininden türetilir (ölçülen sapma ~10 ms), Windows/diğer saatler doğrudan sistem saatidir.
const CLOCK_SLACK_MS = process.platform === "linux" ? 250 : 50;

/**
 * Süreç canlı olduğu bilinirken çağrılır (durdur/yeniden başlat çağrısından ÖNCE). Okuma çağrı anında başlar
 * (Linux: /proc eşzamanlı okunur; Windows: powershell hemen başlatılır), bu yüzden zamanlamaya duyarlı yerlerde
 * söz önce alınıp sonra beklenebilir. Okunamazsa veya okunan süreç çağrıdan sonra oluşmuşsa (beklerken pid yeniden
 * kullanılmış) start = null: denetim çıplak pidAlive'a düşer.
 */
export async function captureIdentity(pid: number): Promise<PidIdentity> {
  const seenAt = Date.now();
  const start = await processStartTime(pid).catch(() => null);
  const ms = startTimeMs(start);
  return {pid, start: start !== null && ms !== null && ms > seenAt + CLOCK_SLACK_MS ? null : start};
}

/**
 * Yakalanan süreç hâlâ canlı mı? pid ölü -> false. Kimlik yoksa (start null) -> çıplak pidAlive (bugünkü davranış).
 * pid canlı ama başlangıç zamanı okunamıyor -> yeniden kullanım kanıtlanamaz: pid hâlâ canlıysa true (fail-closed).
 * Aksi halde yalnız başlangıç zamanı aynıysa true (farklıysa pid yeni ve ilgisiz bir sürece geçmiştir).
 */
export async function sameProcessAlive(id: PidIdentity): Promise<boolean> {
  if (!pidAlive(id.pid)) return false;
  if (id.start === null) return true;
  const now = await processStartTime(id.pid).catch(() => null);
  if (now === null) return pidAlive(id.pid);
  return now === id.start;
}
