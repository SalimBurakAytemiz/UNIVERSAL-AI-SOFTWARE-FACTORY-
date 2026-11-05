// //TR: Factory V2 test paketinin CI kaydı: canonical doğrulama yalnız config/validation.json'da listelenen tests/*.test.ts dosyalarını koşar; bu modül factory-v2 senaryolarını tests/v7-cloud-contracts.test.ts (tests-8 adımı) altında, Linux ve Windows doğrulamasında çalıştırır.
import "./factory-v2.test.mjs";
import "./bridge.test.mjs";
import "./registry.test.mjs";
import "./security.test.mjs";
import "./probe.test.mjs";
