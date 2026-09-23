<!-- //TR: Bu indeks closure klasöründeki belgelerin current authority olmadığını ve V6 current truth kaynaklarını açıkça ayırır. -->
# Closure Documents — Authority Boundary

`docs/closure/` altındaki belgeler tarihsel audit, historical fix ledger veya reference specification materyalidir. İçlerinde görülen eski `PASS`, `CLEAN`, `CLOSED`, V2/V3/V4, teknoloji sayısı veya review-cycle ifadeleri yalnız belgenin üretildiği artifact bağlamına aittir.

Current authority:

1. `CANONICAL-STATUS.md`
2. `audit/V6-FULL-SCAN-PROGRESS.json`
3. current bounded checkpoint under `audit/checkpoints/`
4. executable source + canonical validators

Bu klasördeki hiçbir belge tek başına `SOURCE_LEVEL_CLOSURE`, `TARGET_MACHINE_PHASE0`, final trust-root seal veya release authenticity kanıtı değildir.
