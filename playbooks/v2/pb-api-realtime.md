<!-- //TR: Bu dosya Realtime/Socket Validation işinin uygulanması, kontrolü ve evidence üretimi için canonical teknik yürütme adımlarını tanımlar. -->
# Realtime/Socket Validation

**Competency:** `QUALITY`

## Adımlar
1. handshake/auth
2. ordering/duplication/loss
3. heartbeat/reconnect
4. backpressure/slow consumer
5. partition/outage
6. load/network impairment
7. evidence

## Zorunlu kapanış
- Runtime gerçekten çalıştırılır.
- Negatif/failure path uygulanabilir olduğu ölçüde test edilir.
- Tool/framework sürümleri evidence'a yazılır.
- Unknown ve not-tested surfaces raporda görünür.
- İlgili Lead/Principal review yapılır.
- Mission riskine göre independent Codex review gerekir.
