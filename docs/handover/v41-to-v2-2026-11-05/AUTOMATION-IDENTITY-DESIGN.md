# Ayrı, minimum yetkili otomasyon kimliği + CODEOWNERS/ruleset tasarımı (Founder madde 8)

Durum: **yalnız tasarım.** Hesap, token, secret, GitHub App, ruleset ya da izinlerde hiçbir değişiklik yapılmadı. Her adım Founder'ın ayrıca açık onayını gerektirir.
Hazırlayan: V4.1 koordinatörü, 2026-11-12. Kanıt: 2026-11-10 incelemesi (#355 merge'ü araştırması).

## 1. Bugünkü durum (doğrulanmış)
- Bulut oturumlarındaki `gh` token'ı süreli bir **kullanıcı token'ı**dır (`Github-Authentication-Token-Expiration` başlığı var, `X-Oauth-Scopes` boş). Token `SalimBurakAytemiz` olarak çalışır ve repo izni `admin=true`'dur. Tüm oturumlar bu token'ı paylaşır.
- Founder'ın arayüzden yaptığı merge, executor merge'ü ve #355 merge'ü GitHub kaydında ayırt edilemez. Üçünde de actor `SalimBurakAytemiz`, committer `GitHub` (web-flow), `performed_via_github_app = none`.
- `v7/integration` ruleset'i 25433316:
  - PR zorunlu, ama `required_approving_review_count=0` ve `require_code_owner_review=false`;
  - zorunlu kontroller yalnız `validate (ubuntu-latest)` ve `validate (windows-latest)`;
  - `bypass_actors=[]`.
- Registry ruleset'i 26607801: `non_fast_forward` ve `deletion` kuralları, 0 bypass, `current_user_can_bypass=never`.
- Repoda `CODEOWNERS` dosyası yok. `UASCO Independent Review` zorunlu bir kontrol değil ve 401 veriyor (#412).
- T2/T3 ayrımı yalnız executor kodunda var (`FOUNDER_REQUIRED`). Token'a sahip herhangi bir oturum merge API'sini doğrudan çağırarak bu ayrımı atlayabilir.

### 1a. V2 ölçümleri (2026-11-12, salt-okunur; FV2-T0009 tasarımı E1–E8)
- **E1:** Konteyner uid 0 ve tüm capability'ler açık; seccomp, Yama ve LSM yok.
- **E2/E3:** Bir süreç 0600 izinli anahtar dosyasını okuyabiliyor; yalnız stdin'den verilen bir sır başka bir sürecin belleğinde (`/proc/<pid>/mem`) görülebiliyor.
- **E4/E5:** Ajan proxy'si GitHub kimlik bilgisini **her sürece** enjekte ediyor. Ayrı, root olmayan bir OS kullanıcısı bile `GET /user` ile 200 ve `SalimBurakAytemiz` sonucunu alıyor. OS kullanıcısı ayrımı anahtarı ve belleği korur, **GitHub yetkisini korumaz**.
- **E7:** İki ruleset'te de bypass yok; ama kimin merge ya da push yapabileceği konusunda bir kısıt da yok. Main ve registry için "tek yazıcı" kuralı yalnız konvansiyonla sağlanıyor.
- **Sonuç:** GitHub yetki ayrımı, **ortam düzeyindeki kimlik bilgisi** ile yapılmalı. Rutin ortamların proxy secret'ı, admin ve administration yetkisi olmayan otomasyon kimliği olmalı. Founder ve çekirdek kimliği yalnız ayrı bir ortamda bulunmalı.

## 2. Hedef model
| Kimlik | Kim | İzin | Yapabildikleri |
|---|---|---|---|
| Founder (kişisel hesap) | yalnız Founder | admin | governance onayı (code owner review), T3 merge, ruleset/secret yönetimi |
| `uasco-automation` (GitHub App veya ayrı bot hesabı) | V4.1 executor ve builder oturumları | `contents:write`, `pull_requests:write`, `checks:read`, `actions:read`, `metadata:read`; **admin YOK**, `administration` YOK, `secrets` YOK | branch push, PR açma, rutin (T0–T2) PR merge |
| `uasco-reviewer` App (mevcut reviewer App kimliği) | bağımsız review iş akışı | `pull_requests:write` (yalnız review), `checks:write` | yalnız review ve check yazmak; merge yetkisi yok |

İlkeler:
- Founder'ın kişisel token'ı hiçbir bulut oturumuna verilmez.
- Otomasyon kimliği hiçbir ruleset'in bypass listesinde yer almaz.
- Otomasyon kimliği code owner değildir.

## 3. CODEOWNERS (öneri; `.github/CODEOWNERS`)
Aşağıdaki governance ve güvenlik yollarının sahibi `@SalimBurakAytemiz` olur:
```
/docs/planning/autonomy/      @SalimBurakAytemiz
/docs/planning/authority/     @SalimBurakAytemiz
/docs/planning/v41/           @SalimBurakAytemiz
/docs/planning/cloud-only/    @SalimBurakAytemiz
/docs/planning/merge-gate.mjs @SalimBurakAytemiz
/docs/planning/merge-gate.proof.mjs @SalimBurakAytemiz
/docs/planning/merge_gate.md  @SalimBurakAytemiz
/.claude/                     @SalimBurakAytemiz
/.github/                     @SalimBurakAytemiz
/automation/lib/              @SalimBurakAytemiz
/automation/factory-v2/       @SalimBurakAytemiz
/config/                      @SalimBurakAytemiz
/prompts/                     @SalimBurakAytemiz
/scripts/ci/                  @SalimBurakAytemiz
/scripts/validate-*           @SalimBurakAytemiz
/scripts/run-validation.mjs   @SalimBurakAytemiz
/package.json                 @SalimBurakAytemiz
/package-lock.json            @SalimBurakAytemiz
/CLAUDE.md                    @SalimBurakAytemiz
/AGENTS.md                    @SalimBurakAytemiz
/docs/factory-v2/CUTOVER-ACCEPTANCE.md       @SalimBurakAytemiz
/docs/factory-v2/probe/PROBE-ROLE-KEYS.json  @SalimBurakAytemiz
```
- `automation/factory-v2/` girdisi, FV2-T0009 P3 ayrı Founder kararıyla daraltılana kadar tüm klasörü kapsar. Daraltma kararı alındığında bu girdi `core/` ve çekirdek verisiyle sınırlanır.
- `docs/planning/autonomy/STATE.json` bugün `GOVERNANCE_EXEMPT` (FV2-T0008 writeback). CODEOWNERS'ta muaf tutmak için `/docs/planning/autonomy/STATE.json` satırının sahipsiz bırakılması (boş owner) gerekir. Bu, Founder kararına bağlıdır.

## 4. Ruleset değişikliği (öneri; `v7/integration`, 25433316)
- `require_code_owner_review: true`.
- `required_approving_review_count`:
  - **0** kalırsa code owner incelemesinin onaysız PR'larda zorlanıp zorlanmadığı GitHub'ın davranışına bağlıdır.
  - **Uygulamadan önce bir test PR'ıyla doğrulanmalıdır.**
  - Davranış kanıtlanmazsa seçenek: 1 onay zorunlu olur ve rutin PR'ları bağımsız reviewer App onaylar (otomasyon kimliği değil). Bu, reviewer App'in review'u `APPROVE` olarak yazmasını gerektirir. Ayrı bir karar.
- `dismiss_stale_reviews_on_push: true` (zaten açık).
- `require_last_push_approval: true`: son push'u yapan kişi kendi PR'ını onaylayamaz.
- `bypass_actors: []` korunur.
- İsteğe bağlı: `UASCO Independent Review` kontrolü, #412 onarılıp kararlı hale geldikten sonra zorunlu kontrol listesine eklenir.

## 5. Uygulama sırası (her adım ayrı Founder onayı)
1. **Hazırlık (salt-okunur):** mevcut token ve App kurulumlarının, ayrıca hangi oturumların hangi token'ı kullandığının envanteri.
2. **Otomasyon kimliğinin oluşturulması:** GitHub App ya da bot hesap. *Yeni hesap ya da kimlik bilgisi gerektirir (NEW_ACCOUNT_OR_CREDENTIAL); Founder yapar.*
3. Bulut ortamlarının token'ının otomasyon kimliğine çevrilmesi. Founder'ın kişisel token'ı ortamlardan kaldırılır.
4. CODEOWNERS PR'ı (Founder-tier, `.github/` altında).
5. Test PR'ıyla code owner davranışının doğrulanması: T3 yolu onaysız merge edilemez, rutin yol etkilenmez.
6. Ruleset güncellemesi (Founder, GitHub ayarlarından).
7. Executor'ın beklenen merger kimliğini doğrulaması (`merged_by` = otomasyon kimliği), ayrıca T3 PR'larda `merged_by` = Founder kontrolü. Bu ayrı bir kod değişikliğidir.

## 6. Geri dönüş
- Ruleset değişikliği GitHub ayarlarından tek adımda geri alınır.
- CODEOWNERS dosyası revert edilebilir.
- Token değişikliği, ortam secret'ının eski değere döndürülmesiyle geri alınır. Bunu yalnız Founder yapar.

## 7. FV2-T0009 ile bağlantı
- K modelinin güvenlik önkoşulu "çekirdek, rutin koddan ayrı bir runtime veya kimlikte çalışır" ile aynı köke dayanır: ortak kimlik ve ortak root runtime.
- Ayrı otomasyon kimliği tek başına çekirdek izolasyonunu sağlamaz. Ancak GitHub tarafında T3 ile T2 arasındaki ayrımı teknik olarak zorunlu kılar ve merge'lerin kimliğini kanıtlanabilir yapar.
