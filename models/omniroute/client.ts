// //TR: Bu client OmniRoute discovery'yi loopback veya açıkça approved gateway host ile sınırlar; URL credential/redirect/hang üzerinden credential egress'ini fail-closed engeller.
export interface OmniModel { id: string; owned_by?: string }
const LOOPBACK=new Set(["127.0.0.1","localhost","::1","[::1]"]);
export async function discoverOmniRouteModels(
  baseUrl = process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1",
  apiKey = process.env.OMNIROUTE_API_KEY ?? "",
  options: {approvedGatewayHosts?:string[];timeoutMs?:number}={}
): Promise<OmniModel[]> {
  let url:URL;try{url=new URL(baseUrl)}catch{throw new Error("OMNIROUTE_BASE_URL_INVALID")}
  if(!["http:","https:"].includes(url.protocol))throw new Error("OMNIROUTE_PROTOCOL_DENIED");
  if(url.username||url.password)throw new Error("OMNIROUTE_URL_CREDENTIAL_DENIED");
  const allowed=new Set([...LOOPBACK,...(options.approvedGatewayHosts??[]).map(x=>x.toLowerCase())]);
  if(!allowed.has(url.hostname.toLowerCase()))throw new Error("OMNIROUTE_GATEWAY_HOST_NOT_APPROVED");
  const timeoutMs=options.timeoutMs??10_000;if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>30_000)throw new Error("OMNIROUTE_TIMEOUT_INVALID");
  const endpoint=new URL(url.toString().replace(/\/$/,"")+"/models");
  const headers:Record<string,string>={};if(apiKey)headers.Authorization=`Bearer ${apiKey}`;
  const response=await fetch(endpoint,{headers,redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error(`OmniRoute discovery failed: HTTP ${response.status}`);
  const body=await response.json() as {data?:OmniModel[]};
  if(!Array.isArray(body.data))return [];
  if(body.data.some(x=>!x||typeof x.id!=="string"||!x.id.trim()))throw new Error("OMNIROUTE_MODEL_ID_INVALID");
  return body.data;
}
