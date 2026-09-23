<!-- //TR: Bu dosya V3 canonical starter'ın Windows üzerinde tek giriş komutunu ve Phase0 fail-closed kurulum sırasını açıklar. -->
# Start Here — V3

1. ZIP'i ayrı klasöre çıkar.
2. PowerShell'i repository root'ta aç.
3. Çalıştır:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

Installer artifact/preflight/dependency/Git/provider/builder-boundary/evidence/Control Tower/Phase0 kontrollerini loglar.

Autonomous build yalnız `.ai/runtime/PHASE0_ACCEPTANCE.json` kabul kapısından sonra çalışır.

Kaynak gerçekliği için önce `CANONICAL-STATUS.md`, sonra `audit/V3-RE-AUDIT-RESULTS.md` okunur.
