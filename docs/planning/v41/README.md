<!-- //TR: Bu belge V4.1 PATCHED (241 Task) paketinin cloud-only değişiklikleriyle birleştirilmiş sürümünü, doğrulama sonucunu ve yürütme durumunu kaydeder. -->
# V4.1 PATCHED + CLOUD-ONLY birleşik paket

| Dosya | SHA-256 | Not |
| --- | --- | --- |
| `UASCO_V4_1_FINAL_CANDIDATE_PATCHED.zip` | `10e15cc0…a175e0f` | Founder'ın yüklediği kaynak (241 Task). Değiştirilmedi. |
| `UASCO_V4_1_CLOUD_MERGED.zip` | `3304bdff…7cba22d` | Birleşik paket (256 Task). Tam değerler: `SHA256SUMS.txt`. |

## Kaynak doğrulaması (PATCHED, değiştirilmeden)

`python3 v41/verify.py`: manifest 63/63, yeniden üretim 19 dosya / 0 fark, 68/68 kontrol PASS.

## Birleşik paket doğrulaması

Paket kökünde `python3 v41/verify.py` (çıktı paketteki `16_VERIFY_RUN_LINUX.txt`):

- Manifest 74/74 eşleşiyor. Yeniden üretim: 20 dosya, 0 fark.
- 85/85 kontrol PASS. Ayrıntı:
  - 57 feature, 31 karar (ID'ler PATCHED ile aynı), 102 AC; kanıt PASS sayacı 0.
  - 241 PATCHED ID'nin tamamı korundu, 15 CLOUD-T eklendi, bütün Task ID referansları çözülüyor.
  - Döngü 0. Tier düşmüyor. PATCHED'e göre hiçbir gate kaldırılmadı. Korumalı, yetki-hassas ve güvenlik-hassas dosyalara dokunan her Task ≥T2.
  - 10 sim: 0 deadlock, 0 yazma çakışması. Slot sınırı: D-12 yokken 1, varken ≤3.
  - Negatif testler (claim/lock kapalıyken) ihlali yakalıyor. Reseal lock 24h, pre-kit 8h korunuyor.
  - Founder-PC yalnız `.exe` UAT (UASCO-T0002, T0002.a) için kullanılıyor. UAT'tan önce CLOUD-T0011 (cloud e2e) ve CLOUD-T0006 (hosted installer) PASS zorunlu.
  - PR-231 `DO_NOT_MERGE_AS_IS` olarak işaretli (D-03, D-07).
- Durum: READY_FOR_CODING adayı. Bulut çalışma zamanı (D-03) UNKNOWN olduğu için **PRODUCT_READY değil**.

Birleştirme kuralları CO-1..CO-11 (`v41/cloud_only.py`) ve uygulama günlüğü paketteki `17_CLOUD_ONLY_MERGE_REPORT.md` dosyasında. Bilinçli farklar:

- Override tier'ı PATCHED'den düşükse uygulanmadı.
- Override lane önerisi PATCHED owner kuralına yenildi (`laneHint` alanında).
- PR-231 write-set'i korundu.
- D-23 hiçbir Task'tan kaldırılmadı.
- `UASCO-T0069.b`'nin `T0029:ACCEPTED` bağımlılığı `MERGED` olarak yeniden tiplendi (CO-10). T0029 artık bulut kod Task'ı.
- `sim.py` R4-L1 düzeltmesi: lock süresi kit başladığı anda başlıyor. Düzeltilmiş sim, orijinal PATCHED verisinde de 0 hata veriyor.

## Yürütme durumu (bu dal)

| Task | Durum | Engel |
| --- | --- | --- |
| CLOUD-T0001 | Kodlandı, 23/23 test. CI kaydı korumalı commit olarak hazır. | Merge için D-31 (Founder T2) + bağımsız review. Test kaydı için `TEST_REGISTRATION_APPEND` Founder onayı (FD-10 ön yetkisi doğrulanmadığından kullanılmadı). |
| CLOUD-T0003, CLOUD-T0004 | Başlatılmadı | Tipli bağımlılık `CLOUD-T0001:MERGED` karşılanmadı. |
