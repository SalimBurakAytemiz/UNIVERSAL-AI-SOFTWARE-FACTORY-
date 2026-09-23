<!-- //TR: Bu index projenin aylar boyunca yapılan bütün önemli audit/closure dosyalarını tek yerde listeler; current open status için V4-CURRENT-OPEN-FINDINGS.md esas alınır. -->
# All Findings Index

## Current

1. `audit/V4-CURRENT-OPEN-FINDINGS.md` — bugün yeniden doğrulanan açıklar; en güncel durum.
2. `audit/DEPENDENCY-FREE-RECHECK.log` — mevcut source üzerinde tekrar çalıştırılan validator sonuçları.
3. `audit/KNOWN-TARGET-MACHINE-PENDING.md` — yalnız Windows/real providers/remote üzerinde kapanabilecek kontroller.

## Historical / closure chain

`audit/history/` altında konuşma boyunca oluşturulan audit ve closure dosyalarının tamamı korunur. Bunlar current açıkların hepsinin hâlâ var olduğu anlamına gelmez; tarihsel bulgu zinciridir.

Önemli tarihsel sıralama:

- `UASCO-ULTIMATE-ARCHITECTURE-CLOSURE-SPEC-TR.md`
- `UASCO-TECHNICAL-COMPETENCY-CLOSURE-AUDIT-TR.md`
- `UASCO-ALL-AGENT-TECHNICAL-DEPTH-REAUDIT-TR.md`
- `UASCO-FULL-RED-TEAM-GAP-AUDIT-TR.md`
- `UASCO-MECHANICAL-CLOSURE-RED-TEAM-AUDIT-TR.md`
- `UASCO-V2-RE-AUDIT-NEW-GAPS-TR.md`
- `UASCO-V3-RE-AUDIT-RESULTS-TR.md`
- `UASCO-FINAL-COMPLETENESS-AUDIT.md`

Historical audit sonucu ile current source çelişirse **current source + V4 current findings** esas alınır.
