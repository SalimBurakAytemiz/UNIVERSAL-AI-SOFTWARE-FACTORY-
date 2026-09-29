# UASCO — GitHub + Anthropic Cloud Hibrit: TEK ONAY PAKETİ (2026-10-17)

**Talimat:** FD-GITHUB-CLOUD-HYBRID-2026-10-17. **Durum:** yalnızca izinli hazırlık yapıldı. **Hiçbir push/bulut-aktarım/korumalı-dal değişikliği YAPILMADI.** Çalışan yerel ajanlar (UI-236, UI-049, kapasite ölçer) durdurulmadı. Bu belge tek, sınırları belirlenmiş onay paketidir; yeni mimari değildir.

---

## 1. Son kaynak dalı (push edilecek)
- **İçerik:** güncel CLEAN entegrasyon trunk'ı `6f4f53e` (premium Desktop + görünürlük API + Project-Journey; kanonik yeşil; dev.3 artefakt review CLEAN). Push anında CLEAN olmuş UI-236 (renderer) + UI-049 (backend) bunun üstüne eklenir.
- **Hedef:** mevcut PRIVATE GitHub repo'suna **YENİ, EK bir dal**: önerilen ad `v7/integration`. **Ek niteliktedir** — `master` ve (varsa) `v6` dallarına DOKUNULMAZ, force-push YOK. GitHub'da şu an yalnız `master` var; v6 geçmişi GitHub'da yok, dolayısıyla ezilecek bir şey yok.
- Yerel teslim hattı şu an GitHub'a bağlı DEĞİL (trunk origin = yerel `PUSH_DISABLED` klon). Push, bu hattı ilk kez GitHub'a ekler.

## 2. Aktarım kapsamı
- **2298 izlenen kaynak dosya**, ~30 MB ağaç / ~4.6 MB paketli geçmiş (235 commit). Yalnız kaynak metin. İkili yok: `node_modules`, electron cache (`.ai/cache`), `dist-installer`, build çıktıları izlenmiyor → aktarıma dahil değil.
- **GitHub push:** yeni dal `v7/integration` repo'ya yazılır.
- **Bulut aktarımı:** repo GitHub'da olunca Anthropic Cloud Sessions kodu **GitHub'dan klonlar** (ayrı bundle yüklemesi gerekmez). Bulut oturumları **ayrı iş dallarında** çalışır.

## 3. Güvenlik sonucu
- **Repo PRIVATE** (doğrulandı: `visibility=PRIVATE`, `isPrivate=true`).
- **Ağaç secret taraması:** 0 yüksek-sinyal isabet (sk-ant/AKIA/ghp_/xox*/PRIVATE KEY/AIza).
- **TÜM GEÇMİŞ denetimi:** tüm commit'lerde eklenen hassas-tip dosya YALNIZ `.npmrc` (doğrulandı: yalnız registry politikası, **token YOK**). Hiçbir commit'te `.env`/`.pem`/`.key`/`id_rsa`/`.pfx`/`.p12` yok. `.env.example` = boş şablon (`OMNIROUTE_API_KEY=` boş).
- Kişisel dosya / credential / gereksiz artefakt izlenen ağaçta yok.
- **Sonuç: aktarıma güvenli.**

## 4. Gereken açık onay (TEK paket — hepsi birlikte)
Aşağıdaki üç gated eylem için tek, açık Founder onayı gerekir; onaysız yapılmaz:
1. **GitHub push** — CLEAN entegrasyon içeriğinin **yeni `v7/integration` dalına** push'u (ek; `master`/`v6` değişmez; force-push yok).
2. **Anthropic Cloud bağlantısı + GitHub üzerinden kaynak aktarımı** — (a) kurum `allow_remote_sessions` politikasını **Owner olarak açın** (claude.ai/admin-settings/claude-code); (b) Claude GitHub App'i bu repo'ya kurun/yetkilendirin; (c) bulut oturumlarının bu private repo'yu klonlamasına izin verin. Kurum ZDR/HIPAA/CMEK OLMAMALI (bunlar bulut oturumunu bloklar).
3. **Korumalı ana dal** — `master` korumalı kalır (DEĞİŞTİRİLMEZ). Entegrasyon `v7/integration` üzerinde PR/merge ile yürür; `master`'a terfi (gerekirse) ayrı, ileri bir onaydır.
- **Maliyet:** Max dışında EK ÜCRET YOK (ücretli API/Managed Agents/VPS/kredi/abonelik yok). Bulut oturumları **aynı Max kotasını paylaşır**.

**Onay geldiğinde** ilave mimari araştırma açmadan: `v7/integration` push → GitHub App + politika doğrula → bulut oturumlarını ayrı dallarda başlat → aşağıdaki dağıtımı işlet.

## 5. Aktif yerel/bulut görev dağılımı
**YEREL (şu an çalışıyor):** UI-236 (renderer: Yönetim Özeti+İcra Defteri) + UI-049 (backend: salt-okunur review-verdict endpoint) **eşzamanlı** + kapasite ölçer. Süregelen: frontend, backend, Desktop, UX, Windows'a özgü geliştirme + Windows'a özgü testler + installer.
**BULUT (onay sonrası, ayrı dallarda):** bağımsız Claude review (CLEAN commit'ler), platform-uyumlu (Linux-güvenli) testler, statik güvenlik/analiz, uygun bağımsız kodlama. **Windows'a özgü testler yerelde kalır** (Linux'ta geçerli sayılmaz).
**Sahiplik + PR/merge:** tek kanonik otorite = `v7/integration`. CLEAN iş → kontrollü entegrasyon kuyruğu (PR → reviewer kapısı → merge). FAIL → geliştiriciye geri. **Codex review YOK.** Zorunlu test + bağımsız Claude reviewer kapıları korunur (GOV2).

---
*Kaynak doğrulamaları: `gh repo view` (PRIVATE), `git ls-remote` (yalnız master), tüm-geçmiş secret-dosya denetimi, ağaç secret taraması. Resmî bulut yöntemi: [code.claude.com/docs/en/claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web).*
