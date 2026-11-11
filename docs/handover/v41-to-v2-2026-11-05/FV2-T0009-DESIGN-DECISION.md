# FV2-T0009: Authority Core Extraction, Founder karar dosyası (tasarım; kod/PR yok)

Hazırlayan: V4.1 koordinatörü (session_015dYwazi7LHFCg3dABbSW2P). Tasarım: V2 (session_015dYwb57qx21P4wudU5xauD), 2026-11-11.
Taban: main `77fff2e80289d12d06f88dea87ece1530ba03cfc`, verify-main MAIN_PASS. `automation/factory-v2/` için tüm klasörü kapsayan koruma kuralı yerinde. #421 BLOCKED ve kapalı (review 5850009246).

## Doğrulanmış olgular (V4.1 bağımsız kontrol)
- Görev kimliği **FV2-T0009** boş. Tek geçtiği yer `tests/support/autonomy.cases.ts:314`'teki sentetik çakışma fixture'ı; gerçek registry'yi okumuyor, bu yüzden çakışma yok.
- CI/Node 24.22.2'de `--permission` mevcut (fs, child-process, worker, addons, wasi), ama **`--allow-net` yok**. Ağ, Node izin modelinin dışında kalıyor.
- Bulut konteyneri **uid 0** ile çalışıyor ve `/proc/sys/kernel/yama` yok. Sandbox dışındaki her süreç bütün anahtar ve lease dosyalarını ve diğer süreçlerin belleğini okuyabilir.
- `unshare -rn` (boş ağ namespace'i) yetkisiz olarak çalışıyor. Bu Linux'a özgü; Windows runner'larında yok.
- `automation/factory-v2/merge.mjs:29` V2 merge yetkisini (`reviewAuthorizes`) journal'a yazılmış review verdict'lerine dayandırıyor; bunlar GitHub'dan yeniden doğrulanmıyor.

## Seçenekler
| | K: küçük güvenilir çekirdek (Founder spesifikasyonu) | S: policy sandbox |
|---|---|---|
| Çekirdek / güvenilir kısım | identity, ledger(registryLog), state-journal, ownership + task-lease, shared-registry, ref-doc-store, bridge, v41-guard, cutover, gate-verifier, registry-protection, merge yazma yolu, yeni `core/merge-decision` (GitHub'dan yeniden doğrulama) | mevcut geniş koruma aynen kalır |
| Rutine geçen | supervisor, cloud-orchestrator, model-router, report, quota-governor, failures, review heuristikleri, scheduler, topology, executors, demo-worker, probe-scenario, live-sources okumaları, control/cli'nin rutin yarısı | yalnız `policy/**`: model-router karar fonksiyonları, quota-governor, failures, report üretimi |
| Bu host'ta kanıtlanabilir mi | **Hayır.** Rutin kod alt süreç açabiliyor ve her şey root olarak çalışıyor, dolayısıyla çekirdeğin anahtarlarına ve lease'lerine ulaşabilir. Önce şu önkoşullardan biri gerekir: (a) çekirdek ayrı bir OS kullanıcısında, konteynerde ya da harici imzalayıcıda çalışır; veya (b) rutin kod hiç alt süreç açamaz ve ağa çıkamaz (bu durumda çekirdek tekrar büyür) | **Evet** (Linux): ayrı süreç + `--permission` + `--disallow-code-generation-from-strings` + `env -i` + `unshare -rn` + import yasağı. Netns'in kurulamadığı host'larda (Windows) fail-closed red |
| Kalan risk | (a)/(b) gerçekleşene kadar anahtar ve lease sızıntısı (kritik) | Node sandbox'tan kaçış; Windows'ta sandbox yok (red) |

### Geçmiş PR'lar rutin yoldan geçebilir miydi
- #411 ve #419: bugün de rutin (yalnız test).
- #409: K'da kod satırlarının yaklaşık %99'u rutin, ama çekirdekteki 2 satırlık state-journal değişikliği yüzünden PR bölünmeden rutin olmazdı. S'de 203 kod satırının 128'i policy'ye düşerdi; geri kalanı korumalı.
- #388: K'da kod satırlarının yaklaşık %52'si rutin; S'de yalnız report.
- #408: iki modelde de %0 (LIVE kablolaması).

## Önerilen faz sırası (her faz tek PR; korumalı koda dokunduğu sürece Founder-tier)
1. **R:** FV2-T0009 görev kaydı. Yazan V4.1; içerik `factory-v2-tasks.json` + `task-index.json` + A8 sayım testi.
2. **P1 (koruma daraltılmaz):** davranışı değiştirmeden ayrım. S'nin sandbox host'u ve `policy/**` ile K'nın kod yapısı (`core/` dizini ve veri sözleşmesi) birlikte gelir. Ayrıca:
   - `core/merge-decision`: V2 merge kararı journal yerine GitHub review binding'i, attestation ve CI üzerinden doğrulanır.
   - `CUTOVER-ACCEPTANCE.md` ve `probe/PROBE-ROLE-KEYS.json` çekirdeğe ait korumalı veri dosyaları olur.
3. **P2:** bağımsız güvenlik doğrulaması ve mutasyon kampanyası.
4. **P3 (ayrı Founder kararı):**
   - S için yalnız `policy/**` daraltılır.
   - K için daraltma ancak önkoşul (a) ya da (b) sağlandıktan sonra yapılır. (a) yolu, ortak kimlik / ayrı runtime güvenlik iş akışına bağlı.

## Zorunlu CI'da fail-closed testler
Çekirdek kapanışı statik/AST tarama ile hesaplanır.
- **F1:** çekirdekte izinli liste dışında spawn/exec/fork/Worker kullanımı, ya da `git`/`curl` dışında veya literal olmayan bir program.
- **F2:** literal olmayan `import()`, ya da `require`/`createRequire`/`eval`/`Function`/`vm` kullanımı.
- **F3:** çekirdek sabiti olmayan, parçalardan kurulmuş fs yolu.
- **F4:** çekirdekte yeni dosya, yeniden adlandırma, taşıma ya da harf farkı varken çekirdek listesi hesaplanan kapanışla eşleşmiyor.
- **F5:** `package.json` `imports`/`exports` haritası ya da alias, `#` ile başlayan veya `node:` olmayan bare specifier.
- **F6:** ortam değişkenine bağlı modül yolu.
- **F7:** çekirdek dışından erişilebilen lease ya da yetki kaydı yazma yolu.
- **F8:** çekirdeğin `policy/**` ya da rutin bir modülü import etmesi.
- **F9 (S):** sandbox'ın engellemesi gereken herhangi bir yetenek açık kalıyor (netns veya izin bayrağı eksik).
- **F10 (K):** journal CLEAN dese de GitHub'da binding yoksa veya CI kırmızıysa merge yapılması.

Negatif test olarak eklenecek mutasyonlar: review 5850009246'daki M1–M8, ve yeni M9 (netns kaldırıldı), M10 (rutin koda lease yazma), M11 (journal'daki review verdict'ine güvenme), M12 (env'e bağlı import).

## Korumasız güvenilir yollar (Founder madde 8)
- **`docs/factory-v2/CUTOVER-ACCEPTANCE.md`:** governance yolu değil, floor'da da protected-paths'te de yok. Okuyan yalnız `control.mjs:98` (report) → `report.parseAcceptance`. LIVE, cutover ya da authority kararı bu dosyaya **bağlı değil**. Ama Founder'a gösterilen "koşul MET" bilgisi bu dosyadan geliyor ve rutin bir PR ile değiştirilebilir. Öneri: P1'de korumaya almak.
- **`docs/factory-v2/probe/PROBE-ROLE-KEYS.json`:** korumasız; yalnız PROBE modunda okunuyor. LIVE keyring yalnız `loadCanonicalKeyring` (`identity.mjs:86`, `KEYRING_NOT_LIVE`); probe keyring LIVE'da hiçbir zaman kabul edilmiyor. Risk SHADOW/probe kanıtlarının bütünlüğüyle sınırlı. Öneri: P1'de korumaya almak.
- `automation/lib/task-lease*`, `config/`, `package.json` ve `scripts/ci/` zaten floor/CI_EXECUTED_FLOOR altında. Ek PR gerekmiyor.

## Kapsam dışı
LIVE cutover, yetki kaydı, merge yetkisi devri, ücretli API, harici hesap, #389, #412, STATE.json.
