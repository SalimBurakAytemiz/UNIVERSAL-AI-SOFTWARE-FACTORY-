// //TR: Bu script local OmniRoute /v1/models endpoint'inden o anda erişilebilen model envanterini keşfeder ve volatile provider/free-tier sayılarını hard-code etmez.
import fs from "node:fs";
const base=process.env.OMNIROUTE_BASE_URL??"http://127.0.0.1:20128/v1";
const key=process.env.OMNIROUTE_API_KEY??"";
const headers=key?{Authorization:`Bearer ${key}`}:{};
const r=await fetch(`${base}/models`,{headers});
if(!r.ok){console.error(`OMNIROUTE_DISCOVERY: FAIL HTTP ${r.status}`);process.exit(2)}
const b=await r.json(); const models=Array.isArray(b?.data)?b.data:[];
fs.mkdirSync(".ai/runtime",{recursive:true});
fs.writeFileSync(".ai/runtime/OMNIROUTE_MODELS.json",JSON.stringify({
 "//TR":"Bu runtime snapshot yalnız keşfedilen model envanteridir; modelin kullanılabilir olması data/cost/certification policy'sini otomatik geçmez.",
 discoveredAt:new Date().toISOString(),baseUrl:base,count:models.length,models:models.map(m=>({id:m.id,owned_by:m.owned_by??null}))
},null,2));
console.log(`OMNIROUTE_DISCOVERY: PASS models=${models.length}`);
