<!-- //TR: Bu dosya V6 audit/remediation candidate'ın release ile karıştırılmaması gereken current giriş durumunu ve final artifact sonrası Windows installer giriş noktasını açıklar. -->
# Start Here — V6 Audit/Remediation Candidate

Bu çalışma ağacı **final ZIP veya installation-ready release değildir**. Önce current truth okunur:

1. `CANONICAL-STATUS.md`
2. `audit/V6-FULL-SCAN-PROGRESS.json`
3. ilgili `audit/checkpoints/V6-*.json` checkpoint'i

Current audit tamamlanmadan ve final trust-root yeniden seal edilmeden eski V2/V3/V4 closure dokümanlarını current authority olarak kullanma.

## Final release sonrası Windows giriş noktası

Final artifact release gates'i geçtiğinde installer:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

Installer fail-closed çalışmalıdır. Reviewed source lock, dependency state, trust-root, provider/runtime ve Phase0 kanıtları eksikse autonomous build başlamamalıdır.

`TARGET_MACHINE_PHASE0 = PENDING` olduğu sürece static/source regression target Windows runtime PASS anlamına gelmez.
