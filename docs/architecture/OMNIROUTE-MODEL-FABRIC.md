<!-- //TR: Bu dosya Claude primary builder ve Codex independent reviewer ayrımını korurken OmniRoute/local/free/subscription provider'ları cost+health+quota+data policy ile yönlendirmeyi tanımlar. -->
# Model & OmniRoute Fabric

Preference:
`DETERMINISTIC -> LOCAL -> APPROVED_FREE -> SUBSCRIPTION -> PAID_API_EXPLICIT`

Provider count/quota/pricing are volatile and must be discovered at runtime.

A free provider never bypasses:
customer policy, data class, security, model capability, health, quota or review independence.
