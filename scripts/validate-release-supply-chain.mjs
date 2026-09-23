// //TR: Bu protected release gate reviewed supply-chain/SBOM/license provenance uyumunu doğrular ve generated third-party notice evidence'ını üretir.
import {writeReleaseSupplyChainEvidence} from "../automation/lib/release-supply-chain.mjs";
try{const r=writeReleaseSupplyChainEvidence(process.cwd());console.log(`RELEASE_SUPPLY_CHAIN: PASS components=${r.componentCount}`)}catch(e){console.error(`RELEASE_SUPPLY_CHAIN: FAIL ${e.message??e}`);process.exit(1)}
