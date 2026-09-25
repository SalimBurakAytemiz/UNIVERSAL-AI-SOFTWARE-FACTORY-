// //TR: Bu script OmniRoute discovery ağ sınırını policy ile fail-closed uygular; key uzak/redirect edilen hosta sızamaz ve istek timeout ile sınırlıdır.
import fs from "node:fs";
const policy=JSON.parse(fs.readFileSync("config/omniroute-policy.json","utf8"));
const raw=process.env.OMNIROUTE_BASE_URL??policy.endpoint; const key=process.env.OMNIROUTE_API_KEY??"";
let base;try{base=new URL(raw)}catch{throw new Error("OMNIROUTE_BASE_URL_INVALID")}
if(!["http:","https:"].includes(base.protocol))throw new Error("OMNIROUTE_PROTOCOL_DENIED");
if(base.username||base.password)throw new Error("OMNIROUTE_URL_CREDENTIAL_DENIED");
const allowed=new Set((policy.allowedGatewayHosts??[]).map(x=>String(x).toLowerCase()));if(!allowed.has(base.hostname.toLowerCase()))throw new Error("OMNIROUTE_GATEWAY_HOST_NOT_APPROVED");
const timeoutMs=Number(policy.requestTimeoutMs??10000);if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new Error("OMNIROUTE_TIMEOUT_INVALID");
const endpoint=new URL(base.toString().replace(/\/$/,"")+"/models"); const headers=key?{Authorization:`Bearer ${key}`}:{ };
const r=await fetch(endpoint,{headers,redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
if(!r.ok){console.error(`OMNIROUTE_DISCOVERY: FAIL HTTP ${r.status}`);process.exit(2)}
const b=await r.json(); const models=Array.isArray(b?.data)?b.data:[];if(models.some(m=>!m||typeof m.id!=="string"||!m.id.trim()))throw new Error("OMNIROUTE_MODEL_ID_INVALID");
fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/OMNIROUTE_MODELS.json",JSON.stringify({"//TR":"Bu runtime snapshot yalnız policy-approved OmniRoute endpointinden keşfedilen model envanteridir; kullanılabilirlik data/cost/certification policy geçişi değildir.",discoveredAt:new Date().toISOString(),baseUrl:base.toString(),count:models.length,models:models.map(m=>({id:m.id,owned_by:m.owned_by??null}))},null,2)+"\n");
console.log(`OMNIROUTE_DISCOVERY: PASS models=${models.length}`);
