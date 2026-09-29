# 252 Ekran İzlenebilirlik — DÜRÜST YENİDEN TEMEL (2026-10-16)

**Amaç:** `SCREEN_TRACEABILITY_252_PLUS.csv` eski (audit) bir temeldir (ec105b7) ve gerçek entegrasyon dalını YANSITMAZ. Bu not, gerçek trunk üzerinde koda karşı çapraz-doğrulanmış dürüst durumu verir. Satır-satır CSV yeniden yazımı değildir; başlık sayıları düzeltir.

## Önemli düzeltme: gerçek trunk nerede
- **Gerçek entegrasyon trunk'ı:** klon `C:\Users\salim\UASCO-wt\v2-journey` (dal `v7/ux-journey`, commit `6f4f53e`). Premium + görünürlük API + Project-Journey burada.
- **Birincil dizin `C:\Users\salim\Desktop\UASCO` ESKİ:** dal `v6/pkg-t4` (`217d429`); renderer yalnız `app.js/index.html/styles.css` içerir (routes.js/views yok). Master'a canlı merge Founder onayına bağlı (bekliyor).
- CSV'deki `commit_sha` 252 satırın hepsinde doldurulmuş değil (NOT_VERIFIED); bu yüzden "inşa edildi" sinyali olarak kullanılamaz.

## Dürüst durum (koda karşı doğrulandı — BOUND = gerçek route + gerçek veri bağlama + test dosyası var)

| Öncelik | BOUND | PARTIAL | DESIGN_ONLY | Toplam |
|---|---|---|---|---|
| P0 | 12 | 27 | 4 | 43 |
| P1 | 2 | 54 | 66 | 122 |
| P2 | 0 | 4 | 83 | 87 |
| **Toplam** | **14** | **85** | **153** | **252** |

- **12 gerçek route:** home, projects, work, workforce, assurance, delivery, tower, inbox, company, academy, journey, settings.
- **74 endpoint** (47 GET / 27 POST). Company POST + repair-torn-tail renderer'dan erişilemez → Company arayüzü tasarımca salt-okunur.
- CSV hiçbir satırda kodun desteklemediği bir route/view/endpoint İDDİA ETMİYOR; hata yönü **eksik-bildirim** (güvenli yön). Yalnız UI-241 küçük endpoint-adı farkı; UI-169/UI-232 allow-list dışı Company POST'a atıf.

## En kritik dürüstlük boşluğu (sadece "daha fazla ekran" değil)
Her satırda `functional_test`/`negative_test` = NOT_EXECUTED, `design_parity` = NOT_VERIFIED, `accessibility` = NOT_VERIFIED, `evidence_path` boş. **BOUND, testin GEÇTİĞİ / piksel-pariteyi / a11y'yi KANITLAMAZ.**
- Renderer fonksiyonel testleri kanonik doğrulamada GEÇİYOR (1208 yeşil) — CSV bunu satır-bazında hiç kaydetmedi (eski).
- Gerçekten yapılmamış kanıt: **piksel-parite ekran görüntüleri + ekran-başı a11y (axe) + satır-başı kanıt kaydı.** FINAL teslim için bu kanıt üretilecek.

## Sıradaki P0 kuyruğu (yeni yetenek, en değerli önce; çoğu yeni backend GEREKTİRMEZ)
1. **UI-236** Kurucu Yönetim Özeti + İcra Defteri — `/v1/cockpit`+`/v1/work-runs` *(paket çalışıyor)*
2. UI-211 İnsan-onay kuyruğu (SLA/öncelik/toplu)
3. UI-016 Nihai analiz onayı *(yeni predev-approve POST + allow-list gerekir)*
4. UI-227 Kalite kapısı / release readiness
5. UI-049 Claude bağımsız review görünürlüğü *(yeni read endpoint gerekir)*
6. UI-037+046 Güvence / güvenlik posture paneli
7. UI-205 Çoklu-proje matrisi (+UI-009 portföy rollup)
8. UI-071 Operasyon & kurtarma runbook
9. UI-074 Provider hub (routing/health)
10. UI-248 First-run kurulum doğrulama

**Dışarıda:** UI-176 mobil (FD-NIHAI-252 attended-local), UI-043/149/188 (FD-REL-1 ile gated deploy/exec).

**Güven:** route/view/endpoint varlığı ~%90 (84 satırın tümü otomatik çapraz-kontrol). 21 override satırı (başlık→view eşlemesi) orta güven. Hiçbir test çalıştırılmadı/UI render edilmedi; bu not yalnız kod-bağlama durumudur.
