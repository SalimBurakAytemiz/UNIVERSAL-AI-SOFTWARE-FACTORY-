<!-- //TR: Bu dosya UASCO'nun harici araç/bağımlılıklarını kaynak kodu kopyalamadan provenance ve lisans notlarıyla takip etmek için yazılmıştır. -->
# Third-Party Notices

## OmniRoute
Integration model: external local gateway/executable.
Its source is not copied into UASCO.
Runtime installer records the actually installed package version.

All other dependencies must flow through dependency governance and SBOM.

## Reviewed npm dependencies

`GENERATED_DEPENDENCY_NOTICES_REQUIRED`

Release sırasında reviewed `package-lock.json` + `SBOM-LITE.json` üzerinden `.ai/runtime/THIRD-PARTY-NOTICES.generated.md` üretilmeden release supply-chain gate PASS olamaz. Static bu dosya elle entegre edilen dış sistemleri açıklar; gerçek kurulu npm dependency kimliği/sürümü/lisansı/package provenance'ı generated notice evidence'ında tutulur.
