# UASCO — Managed Agents PoC (WP-1) Planı ve Onay İhtiyaçları (2026-10-15)

- **Karar:** Founder, F2 sandbox yolu için önce küçük bir PoC istedi (chat 2026-10-15). Faturalama/hesap bağlama kararı sandbox kararından sonraya bırakıldı — ama PoC'nin kendisi bunu gerektirdiği için minimum ihtiyaç aşağıda.
- **Dayanak:** `docs/planning/UASCO_CLAUDE_CLOUD_EXECUTION_FIT_2026-10-15.md` (K önerisi = Managed Agents). Managed Agents = beta, `managed-agents-2026-04-01` başlığı, `POST /v1/sessions`, API anahtarı; resmî belgeli üçüncü-taraf programatik yol.
- **Durum:** Bu bir plan + onay talebidir. Hiçbir oturum açılmadı, API harcanmadı, anahtar bağlanmadı.

## PoC'nin amacı (yalnız teknik uygunluk)
Managed Agents'ın UASCO'nun SandboxProvider sözleşmesine uyacak şekilde gerçekten çalıştığını uçtan uca kanıtlamak:
1. Oturum oluştur (`POST /v1/sessions`, API anahtarıyla, beta başlığıyla).
2. Göreve **UASCO'nun kendi yazdığı önemsiz bir kod parçası** gönder (ör. bir `add(a,b)` fonksiyonu + bir birim testi). **Müşteri verisi, kişisel veri veya güvenilmeyen içerik gönderilmez.**
3. Çalıştırmayı tetikle; durumu/olay akışını oku.
4. Üretilen dosyaları/çıktıyı Files API (`/mnt/session/outputs`) ile geri al.
5. İptal/temizlik ve bütçe davranışını gözlemle.
6. Her adımın gerçek yanıtını kanıt olarak kaydet.

## PoC'nin DOĞRULAYACAĞI şeyler
- Oturum oluşturma + görev gönderme + durum okuma + iptal + çıktı/artefakt alma **programatik olarak** çalışıyor mu.
- Üretilen gerçek kaynak/commit/artefakt Desktop tarafına alınabiliyor mu.
- Bütçe sınırı (`budget` nesnesi) uygulanıyor mu.
- Gecikme ve temel maliyet (bir küçük görev başına) ne.

## PoC'nin DOĞRULAMAYACAĞI şeyler (dürüst sınır)
- **Canlı önizleme** — resmî belgede sandbox'tan açık port/önizleme URL'i yok (NOT_FOUND). PoC bunu çözmez.
- **İzolasyon gücü / madde 12** — hypervisor/kernel/tenant modeli resmî belgede yok; bağımsız negatif güvenlik doğrulaması yine zorunlu. PoC güvenlik doğrulaması DEĞİLDİR.
- **PRODUCT_VERIFIED** — PoC bir yeterlilik denemesidir; ürün doğrulaması değildir.
- **Hukuk/ticari** — Ticari Şartlar D.4 (yeniden satış / rakip ürün / aracılık) soruları Anthropic hukuk onayı gerektirir.

## Sizden gereken (PoC'yi çalıştırmak için)
1. **Bir Anthropic Console API anahtarı.** (Abonelik değil — Console ayrı ürün. Max/Team planları aylık API kredisi içeriyor; Pro içermiyor.) Anahtarı güvenli şekilde bağlamanın yolunu birlikte seçeriz (ortam değişkeni ya da ileride Setup Wizard akışı). Anahtar UASCO loglarına yazılmaz.
2. **Küçük, sınırlı bir harcama onayı** — ör. bu tek PoC için üst sınır birkaç dolar; `budget` nesnesiyle sabitlenir, aşılırsa durur.
3. **Açık veri onayı** — PoC'de yalnız UASCO'nun yazdığı önemsiz bir kod parçasının Anthropic bulutuna gönderilmesine izin. Gerçek proje/müşteri verisi gönderilmez.

Bu üçü olmadan PoC çalıştırılmaz. Dilerseniz anahtarı hiç paylaşmadan, önce PoC harness'ını (resmî endpoint'leri çağıran istemci) yazıp bağımsız review'dan geçiririm; çalıştırma yalnız siz anahtar + onay verince olur.

## Güvenlik ve kapsam
- Yalnız resmî Anthropic endpoint'leri çağrılır; tarayıcı otomasyonu / özel endpoint / bypass yok.
- PoC harness'ı ayrı, gözden geçirilmiş bir paket olur; mevcut güvenlik kapıları ve fail-closed kuralı değişmez.
- Fiziksel-worker planı (D-M1-ISOLATION) iptal edilmez, yalnız **askıya alınır**; PoC CLEAN olursa Managed Agents'ı SandboxProvider olarak benimseme kararını ayrıca size getiririm.
- M1A-MODE c2 ve diğer işler bu PoC'den etkilenmez.

## PoC sonrası (CLEAN olursa) iş paketleri
- WP-2 SandboxProvider adaptörü (Managed Agents'ı doğrulanmış sağlayıcı olarak bağla; doğrulama başarısızsa fail-closed BLOCKED).
- WP-3 Work OS sahipliği (görev kimliği, izin, bütçe, checkpoint ↔ MA oturum/bütçe/akış).
- WP-4 implementer vs bağımsız reviewer ayrımı + gerçek test kanıtı yakalama.
- WP-5 müşteri izolasyonu (tenant başına ayrı Anthropic workspace; son-kullanıcı file_id kabul edilmez).
- WP-6 canlı önizleme çözümü — UNKNOWN (resmî destek yok; ayrı araştırma/karar).
