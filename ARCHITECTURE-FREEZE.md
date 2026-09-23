<!-- //TR: Bu dosya core mimarinin hangi şartlarda frozen kabul edildiğini ve yeni framework/provider/cihaz bulunduğunda repo'nun yeniden tasarlanması yerine hangi extension mekanizmasının kullanılacağını tanımlar. -->
# Architecture Freeze

Core primitive'ler yalnız şu durumda yeniden açılır:

1. Yeni gereksinim mevcut primitive'lerden hiçbiriyle temsil edilemiyorsa,
2. Tool Adapter / Provider Adapter / Resource Kind / Technology Profile / Skill /
   Domain Pack / Mission Blueprint / Plugin ile çözülemiyorsa,
3. yeni bir authority, trust, state veya evidence semantiği gerçekten gerekiyorsa.

Normal genişleme akışı:

`DETECT -> CLASSIFY -> RESEARCH -> SANDBOX -> MODEL -> IMPLEMENT -> TEST -> REVIEW -> CERTIFY -> REGISTER -> ACTIVATE`

Yeni browser, telefon, framework, DB, cloud, model provider, CI aracı veya sektör core'u yeniden açmaz.
