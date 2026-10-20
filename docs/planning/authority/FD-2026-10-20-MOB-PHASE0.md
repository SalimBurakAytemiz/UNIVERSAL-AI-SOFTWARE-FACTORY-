<!-- //TR: Founder kararı FD-2026-10-20-MOB-PHASE0 (20 Ekim 2026): Android Mobile Companion için bağlantı modeli A (aynı yerel ağ, güvenli QR eşleştirme + TLS), uzak hedef B (kullanıcının yönettiği VPN/overlay), ilk sürüm salt okunur; PT-035 düzelmeden mobil onay yok; RESUME masaüstünde; ilk sürümde FCM, ücretli LLM ve yeni harici hesap yok. Yalnızca MOB-1…MOB-9 doküman/araştırma/spesifikasyon işlerine yetki verir; kodlama, bağımlılık, yeni API, dinleyici, kimlik doğrulama, protected-file, CI/ruleset, reseal ve ücretli servis yetkisi vermez. -->

# Authority record: FD-2026-10-20-MOB-PHASE0, Android Mobile Companion phase 0 (docs only)

- **Provenance:** the Founder sent this decision in-session to the coordinator session `session_01DmTHw4gBA3wvY1tKM9bk2e` on 2026-10-20, around 05:10Z. This was after reviewing the research and the scope record `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` (PR #85).
- **This record proves nothing on its own.** An agent wrote it into the repository, and every agent shares one GitHub identity. It follows the convention of `docs/planning/authority/FD-2026-10-19-MAX-CLOUD-PRODUCTION.md`: it becomes binding evidence only when the Founder confirms it through a channel an agent cannot produce, and the independent reviewer records that confirmation.
- **Scope of the grant:** documentation, research, screen requirements, UI/UX design specifications, the architecture ADR and the test strategy for MOB-1..MOB-9 only.

## Founder decision (verbatim, Turkish original)

> İlk geliştirme bağlantı modeli A olacak: aynı yerel ağda güvenli QR eşleştirme ve TLS.
>
> Gelecekteki uzaktan kullanım hedefi B olacak: kullanıcı tarafından yönetilen VPN veya güvenli overlay ağ. Açık tünel ve ikinci backend istemiyorum.
>
> İlk mobil sürüm, güvenli bağlantı altyapısı hazır olduğunda salt okunur izleme fonksiyonlarıyla başlayacak.
>
> PT-035 düzeltilmeden mobil onay işlemleri etkinleştirilmeyecek. Mobil STOP ve imzalı onaylar ayrıca değerlendirilecek. RESUME masaüstünde kalacak.
>
> İlk sürümde FCM, ücretli LLM servisi veya yeni harici hesap açılmayacak. Sesli asistan ve push fonksiyonları mimari kapsamda korunacak, ancak ayrı yetkiyle etkinleştirilecek.
>
> Mobile Companion, Android-only React Native + TypeScript olarak mevcut UASCO repository'sinde geliştirilecek. İkinci repository, backend veya Project Memory oluşturulmayacak.
>
> ŞİMDİ VERDİĞİM YETKİ:
>
> MOB-1…MOB-9 için yalnızca dokümantasyon, araştırma, ekran gereksinimleri, UI/UX tasarım spesifikasyonları, mimari ADR ve test stratejisi çalışmalarını hazırlama yetkisi veriyorum.
>
> Önce PR #85'in mevcut CI/review/merge sürecini güvenle tamamla. Sonra MOB-1…MOB-9 görevlerini, mevcut backlog koordinatörü üzerinden ve çakışma oluşturmadan yetkili doküman işleri olarak sırala.
>
> Bu yetki React Native kodlama, dependency kurulumu, yeni API, ağ dinleyicisi, kimlik doğrulama değişikliği, protected-file düzenlemesi, CI/ruleset değişikliği, trust-root reseal veya ücretli servis kullanımı yetkisi vermez.
>
> Mobil çalışması mevcut Desktop Builder ve Reviewer üretimini kesintiye uğratmasın. Global Builder kapasitesini aşma.
>
> Faz 0 sonunda Android ekran haritasını, mimariyi, güvenlik modelini, teknoloji sürümlerinin doğrulamasını ve ilk uygulanabilir kod paketinin kabul kriterlerini raporla.
>
> Uygulama kodlaması için ayrı Founder onayı bekle.

## Answers this decision gives to the open questions of D-2026-10-20-MOBILE-ANDROID section 14

| Question | Founder answer |
|---|---|
| 1. Connectivity | Model **A** first: same-LAN secure QR pairing plus TLS. The remote target is **B**: a user-managed VPN or secure overlay. No open tunnel and no second backend (option C is rejected; D was already excluded). |
| 3 and 4. Decisions from the phone, STOP, RESUME | The first release is **read-only monitoring**. No mobile approvals until PT-035 is fixed. Mobile STOP and signed approvals will be evaluated separately. RESUME stays desktop-only. |
| 5. PT-035 | It must be fixed before any mobile approval is enabled. Approval work stays AUTHORITY_REQUIRED. |
| 8. Push | No FCM in the first release. Push stays in the architecture and needs its own grant. |
| 10. AI assistant | No paid LLM service and no new external account in the first release. Voice and the assistant stay in the architecture and need their own grant. |
| 15. READY rule | Granted for MOB-1..MOB-9 only, as documentation work. |

All other open questions (2, 6, 7, 9, 11-14, 16-25) stay open and are carried into the phase 0 documents as explicit questions.

## How the coordinator applies it

- MOB-1..MOB-9 become `READY`, owner `CLOUD`, `authorizedBy` set to this record, and `requiresNewAuthority: false`. They are dispatched only through the atomic claim (`docs/planning/dispatch.mjs --claim`, heartbeat owner), and only within the global two-builder cap.
- Every MOB-1..MOB-9 package may add or change files only under `docs/mobile/**`. No code, package manifest, lockfile, workflow, protected path, `knowledge/technologies/**` registry entry or desktop renderer file may be touched. MOB-9 records its version verification in `docs/mobile/TECH-VERSIONS.md`. Updating the knowledge registry is a later, separately authorized step.
- Dependencies are tiered so independent documents can be written in parallel without file overlap:
  - **Tier 1:** MOB-1 threat model and security conditions; MOB-2 connectivity and pairing design for model A; MOB-5 React Native Android ADR; MOB-9 technology version verification.
  - **Tier 2:** MOB-3 API contract (after MOB-2); MOB-4 approval and STOP design, design-only and not enabled (after MOB-1); MOB-8 test, build and release strategy (after MOB-5 and MOB-9).
  - **Tier 3:** MOB-6 read-screen specifications (after MOB-3 and MOB-5); MOB-7 action, security and voice screen specifications, design-only (after MOB-4 and MOB-5).
- Desktop READY tasks keep priority. The dispatcher takes the first eligible task in file order, so any new desktop READY batch is inserted before the MOB block in `BACKLOG_CHECKPOINT.json`.
- **Not granted (unchanged):** React Native code, dependency install, new API, network listener, authentication change, protected-file edit, CI or ruleset change, trust-root reseal, paid service, new external account, and application coding (MOB-11..MOB-31 stay AUTHORITY_REQUIRED).
- **End of phase 0:** a report covering the Android screen map, the architecture, the security model, technology version verification, and the acceptance criteria for the first implementable code package. Coding then waits for a separate Founder approval.
