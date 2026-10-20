# UI-106 — Empty-state next step (journey / executive)

//TR: Bu belge #/journey sıfır-mission durumu ve #/executive boş defter için "Work'ü aç" gezinme düğmesini açıklar; yalnız renderer, yeni uç nokta/POST/IPC/depolama yok.

- `#/journey`: mission listesi okunabilir ama boşsa mevcut not korunur, `data-empty-next="journey-missions"` bloğu ve `journey-empty-open-work` düğmesi (`ctx.navigate("work")`) eklenir; "Pick a mission above" yerine `journey.noMission.none` gösterilir.
- `#/executive`: İcra Defteri okunabilir ama boşsa `data-empty-next="executive-ledger"` bloğu ve `executive-empty-open-work` düğmesi eklenir.
- Fail-closed: OFFLINE/UNAVAILABLE/ERROR, dolu liste veya `ctx.navigate` yoksa düğme çizilmez.
- Tasarım eşdeğerliği veya PRODUCT_VERIFIED iddia edilmez; illüstrasyon varyantları DESIGN-EVIDENCE-UNAVAILABLE.
