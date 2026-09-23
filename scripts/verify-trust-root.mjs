// //TR: Bu script current control repo trust-root hash manifestini doğrular ve feature build başlamadan governance/reviewer/validator kapılarının değişmemiş olmasını fail-closed kontrol eder.
import {verifyTrustRoot} from "../automation/lib/trust-root.mjs";
import fs from "node:fs";
fs.mkdirSync(".ai/runtime",{recursive:true});
const r=verifyTrustRoot(process.cwd());
fs.writeFileSync(".ai/runtime/TRUST_ROOT_VERIFY.json",JSON.stringify({"//TR":"Bu runtime report protected trust-root hash doğrulamasını kaydeder.",checkedAt:new Date().toISOString(),...r},null,2)+"\n");
if(!r.ok){console.error(JSON.stringify(r,null,2));process.exit(1)}
console.log("TRUST_ROOT_VERIFY: PASS");
