<!-- //TR: Bu index current V6 audit authority ile historical audit zincirini ayırır; eski V2/V3/V4 finding dosyaları current açık bulgu authority değildir. -->
# All Findings Index

## Current authority

1. `audit/V6-FULL-SCAN-PROGRESS.json` — bounded V6 replay/audit ilerlemesi ve current truth.
2. `CANONICAL-STATUS.md` — human-readable current source/release/runtime durumu.
3. `PACK.json` — machine-readable current source kapsamı ve pending gates.
4. `audit/KNOWN-TARGET-MACHINE-PENDING.md` — yalnız gerçek target/runtime ortamında kapanabilecek kontroller.

Current source-level açık P0/P1/P2 ancak current V6 checkpoint/validator evidence ile belirlenir. Historical audit dosyaları current blocker listesi olarak kullanılamaz.

## Historical / audit chain

`audit/history/` altındaki V2/V3/V4 closure, static-audit, SHA manifest ve finding dosyaları provenance/history amacıyla korunur. Bunlar current PASS/CLEAN/closure, final SHA veya release authenticity kanıtı değildir.

Historical audit sonucu ile current source çelişirse **current source + `audit/V6-FULL-SCAN-PROGRESS.json`** esas alınır.
