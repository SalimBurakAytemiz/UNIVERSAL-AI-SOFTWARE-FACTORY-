# Hibrit Bulut Doğrulama Pilotu — İZİN-ÖNCESİ HAZIRLIK (2026-10-16)

**Talimat:** FD-HYBRID-PILOT-2026-10-16. **Durum:** yalnızca izin gerektirmeyen hazırlık yapıldı. **Hiçbir kaynak buluta YÜKLENMEDİ**, hiçbir harcama/push/politika değişikliği yapılmadı. Mevcut geliştirme (UI-236 paketi) durdurulmadı.

## 1. Pilot için seçilen gerçek iş
**Sabit, doğrulanabilir bir commit'in bulut-güvenli bağımsız doğrulaması + yerel ile birebir karşılaştırma.**
- **Hedef commit:** `6f4f53e2d5c73df6ef8f157b998fb04a810404b0` (v7/ux-journey trunk, dev.3 tabanı). Sabit kimlik = adil ölçüm; kritik yolu durdurmaz.
- **Bulut-GÜVENLİ altküme (Linux'ta geçerli):** `tsc` typecheck + statik validatörler + **platform-bağımsız** Vitest shard'ları + statik güvenlik taraması + diff'in bağımsız kod incelemesi.
- **BULUTTA ÇALIŞTIRILMAYACAK (Linux'ta geçerli sayılamaz → yerelde kalır):** Windows'a özgü gerçek-process/PowerShell/installer shard'ları (bs1-*, aut2, lv1 real-git/process, ps1a/ps1b, b7-installer, sbx8, Get-FileHash/pwsh). *Bunlar bulutta "doğrulandı" sayılmayacak.*
- Bulut reviewer yerel implementer'dan bağımsız (ayrı ortam, salt-okunur commit).

## 2. Buluta aktarılacak dosyalar + güvenlik kontrolü
- **İçerik:** trunk'taki 2298 izlenen kaynak dosya (apps/, core/, automation/, scripts/, config/, tests/, package.json/lock, tsconfig, vitest config). Kaynak metin; ikili/gizli yok.
- **Hazırlanan izole paket (yerelde, YÜKLENMEDİ):** `scratchpad/pilot-snapshot.bundle` — **sıkıştırılmış tek-commit snapshot, 235 commit geçmişi YOK**, 3.97 MB, `git bundle verify` = OK. İkinci kanonik repo/otorite değildir.
- **Varsayılan `claude --cloud` ne gönderirdi:** tüm dal geçmişi (235 commit) ≈ 4.6 MB — yine de güvenli, ama geçmişi taşır; snapshot paketi geçmişi sıyırır (daha güvenli).
- **Boyut:** her seçenek ~4-5 MB → 100 MB bundle limitinin ~20 katı altında.
- **Gizli-veri taraması (KANIT):** yüksek-sinyal secret pattern (sk-ant-/AKIA/ghp_/xox*/PRIVATE KEY/AIza) = **0 isabet**. `.npmrc` = yalnız registry politikası, token YOK. `.env.example` = boş şablon (`OMNIROUTE_API_KEY=` boş). `.ai/*.md`+`MASTER_STATE.json` = küçük iç-durum metni (secret değil). İzlenmeyenler (node_modules, `.ai/cache` electron ikilileri, dist-installer, audit/reviews, docs/planning untracked, `.claude/`) bundle'a **dahil değil**.
- **Dürüst risk notları:** (a) kimlik-bilgisi oto-filtresinin worktree/submodule boşlukları var — paketimiz düz klon + elle doğrulandı, güvenli; (b) varsayılan `--cloud` tam geçmiş taşır → snapshot paketi önerilir.

## 3. Gereken açık Founder izni (KARAR KAPISI)
1. **Veri aktarımı onayı** — snapshot paketinin Anthropic bulutuna yüklenmesi için açık onay (sert kapı; verilmedi).
2. **Kurum politikası:** `allow_remote_sessions` **Owner tarafından** açılmalı (claude.ai/admin-settings/claude-code). Ayrıca kurum **ZDR/HIPAA/CMEK olmamalı** (bunlar bulut oturumunu bloklar). Hesap Anthropic ile girişli olmalı (Bedrock/Vertex değil).
3. **Harcama:** GEREKMİYOR — resmî doküman: *"counts toward your plan's usage limits ... no separate charge for the cloud VM."* Managed Agents (ücretli) KULLANILMAYACAK; yalnız Max-dahil `claude --cloud`. **ANCAK aynı Max haftalık kotasını paylaşır** (ek kapasite değil).

## 4. Ölçülen gerçek süre farkı
**BEKLEMEDE.** Bulut yarısı onaya bağlı (henüz çalıştırılmadı). Yerel temel ölçüm, makine boştayken (UI-236 bitince) alınacak; **uydurma sayı verilmeyecek.** Bağlam: yerel impl+reviewer bazı entegrasyonlarda ~90 dk; tam kanonik ~40 dk.

## 5. Öneri (ön/dürüst — kesin karar için ölçüm şart)
- Yöntem uygulanabilir ve güvenli (küçük, secret'sız aktarım; ek harcama yok).
- **Önemli uyarı — kazanç beklenenden az olabilir:** bulut oturumları **aynı Max kotasını paylaşır** → bulut doğrulama kota TÜKETİMİNİ azaltmaz; kazanç yalnız **duvar-saati paralelliği + yerel CPU/RAM boşaltma**. Gerçek darboğaz 23:00 raporunda **düşük eşzamanlılık (1.31)** idi, CPU doygunluğu değil (şu an %4 yük, 8 çekirdek, bol boşluk). Yani ucuz kaldıraç **yerel eşzamanlılığı artırmak** olabilir — ama o da kotayla sınırlı. Bulut kota eklemez.
- Windows'a özgü testler bulutta geçerli olmadığından bulut en çok **platform-bağımsız altküme + review + statik analizi** devralır; Windows gerçek-process/installer gate yerelde kalır.
- **Karar:** teoriyle kalıcı yapma; tek kontrollü pilotu ONAYLA → gerçek sayıları ölç → net kazanç varsa yalnız uygun bağımsız test/review işlerini aşamalı yönlendir.

**Kaynak:** [Use Claude Code in the cloud — resmî doküman](https://code.claude.com/docs/en/claude-code-on-the-web)
