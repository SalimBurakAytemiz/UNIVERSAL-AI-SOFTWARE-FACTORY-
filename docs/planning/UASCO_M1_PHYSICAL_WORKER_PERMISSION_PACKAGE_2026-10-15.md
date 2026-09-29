# UASCO Tam M1 — Ayrı Fiziksel Worker: İzin ve Etki Paketi (2026-10-15)

- **Karar:** D-M1-ISOLATION-PATH-2026-10-15 — güvenilmeyen/AI üretimi proje kodunun tam M1'de çalıştırılacağı izolasyon = ayrı bir fiziksel makine (constrained UASCO remote worker). Her iki bağımsız analiz de #1 seçti. Özel launcher yok.
- **Durum:** Bu bir izin talebidir. Hiçbir şey kurulmadı, hiçbir sistem değişmedi. Worker makinesinin tedariki ve üzerindeki kurulum **sizin elinizle** yapılır.
- **Dayanak:** `docs/planning/UASCO_M1_SUPPORTED_ISOLATION_PLAN_2026-10-15.md` (Seçenek 6).

## Neden bu yol

- Ana bilgisayarınıza **hiç dokunulmaz**: kurulum, BIOS, sürüm yükseltme, firewall, politika ve yönetici değişikliği yok.
- En güçlü izolasyon: ayrı donanım, ayrı çekirdek. Güvenilmeyen kod `.claude` kimlik bilgilerinizden, UASCO repolarından, Trust Kernel kayıtlarından ve diğer projelerden fiziksel olarak ayrı.
- Kod şirket dışına çıkmaz (buluttan farkı bu); kendi donanımınızda kalır.
- Ağ varsayılan-kapalı, bir kod bayrağı değil fiziksel/router gerçeği.
- Negatif testleri bağımsız uzman doğrudan o makinede çalıştırabilir; UASCO escape testi yazmaz.

## Mimari (özet)

- Worker, UASCO runner-agent'ını çalıştırır. Ana PC yalnız iş gönderir ve sonucu **yeniden doğrular**.
- UASCO tarafı, INT-R3'te hazır olan "sandbox yoksa çalıştırma yok" kapısına (`core/workos/execution-gate.ts`) ince bir uzak-çalıştırma SandboxProvider'ı olarak bağlanır. Yeni launcher kodu yok.
- Çalışma kopyası worker'a gönderilir (`.git` olmadan, reparse-safe), test/komut orada çalışır, sonuç yapılandırılmış biçimde geri alınır.

## Sizden beklenen kararlar (her biri ayrı)

- **KARAR-1 (donanım):** Boşta bir PC veya ucuz bir mini-PC/NUC'u UASCO worker'ı olarak ayırın. Ana bilgisayarınızda hiçbir değişiklik olmaz. *Tedarik sizin; UASCO satın alma yapmaz.*
- **KARAR-2 (ağ):** Worker için izole bir ağ segmenti (kendi VLAN/alt ağı, gateway'siz, veya küçük bir switch). Bağımlılıklar ana PC tarafında `npm ci --ignore-scripts` ile önceden indirilir (D-SBX-9); worker'ın internete çıkışı yoktur.
- **KARAR-3 (kanal):** Worker'a tek, kimlik doğrulamalı, varsayılan-kapalı bir kanal (SSH veya WinRM) + UASCO runner-agent. Sonuçlar ana PC'de yeniden doğrulanır.
- **KARAR-4 (bağımsız doğrulama):** Negatif/kaçış test paketini bağımsız bir güvenlik uzmanı veya laboratuvarı **o worker üzerinde** çalıştırıp imzalar. UASCO escape testi yazmaz. Kapı, 0 ESCAPED / 0 INCONCLUSIVE olana kadar fail-closed kalır. Uzman/takvim şu an **UNKNOWN**.

## Etki ve geri alma

| Öğe | Ana PC'ye etki | Geri alma |
|---|---|---|
| Worker makinesi | Yok | Makineyi kapat/kaldır |
| İzole ağ | Yok (ayrı segment) | Segmenti kaldır |
| SSH/WinRM kanalı | Ana PC'de giden tek bağlantı; gelen kural yok (host→worker yönü tercih edilir) | UASCO'da provider'ı kapat; anahtarı sil |
| UASCO provider | Kod; korumalı dosyalar FA-V2-PRODUCT/FA-SBX kapsamında | Provider'ı kapat → kapı BLOCKED'a döner; commit revert |

- **Önemli dürüstlük notu (eleştirmen N-5/N-6):** Önizleme/devrun kanalının yönü **host→worker** olacak; ana PC'de gelen firewall kuralı veya reverse-tunnel açılmayacak. Eğer ileride ana PC'de herhangi bir kural/port gerekirse, bu ayrı bir KARAR olarak önünüze gelir; aksi halde o özellik worker-içi kalır.

## Önkoşullar ve ETA etkisi

- Bu paket **M0, REL-FX ve M1a'yı engellemez.** Onlar mevcut yetkiyle sürüyor.
- Tam M1 (öncelik E) kritik yolu iki UNKNOWN'a bağlı: (a) worker donanımının hazır olması, (b) bağımsız uzmanın negatif testleri çalıştırma takvimi.
- Bu yüzden tam M1 için sahte-kesin bir tarih vermiyorum. Donanım hazır + uzman takvimi belli olunca P50/P80/P95'i yeniden hesaplayıp sunacağım.
- Provider arayüzünün UASCO tarafı (uzak-çalıştırma istemcisi + self-test iskeleti), worker gelmeden **mevcut yetki içinde** hazırlanabilir; böylece donanım gelince bağlanması kısa sürer. Bunu M1a'dan sonra, ayrı bir pakette yapacağım.

## İstenmeyen / verilmemiş

Ana PC'de kurulum, BIOS/VT-x, sürüm yükseltme, Hyper-V/Sandbox/WSL, sürücü, firewall/politika değişikliği; sandbox'a internet yeteneği; bulut/uzak hesap; host üzerinde sandbox'sız kod çalıştırma. Bu paket bunların hiçbirini istemez.
