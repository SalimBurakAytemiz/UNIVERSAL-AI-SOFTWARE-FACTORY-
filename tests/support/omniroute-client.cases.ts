// //TR: UASCO-T0065 / V3-AC-F028-1 gerileme koruması: gerçek OmniRoute keşif istemcisini yalnız loopback HTTP sunucusuna karşı (ağ/ücret yok) çalıştırır; model id keşfi, onaysız host/URL credential/protokol reddi, redirect ve askıda kalmada anahtar sızmaması, kota/429 durumunda fail-closed hata (ikinci yola devretmek için) kanıtlanır.
import {describe,it,expect,beforeAll,afterAll,afterEach} from "vitest";
import http from "node:http";
import type {AddressInfo} from "node:net";
import {discoverOmniRouteModels} from "../../models/omniroute/client.js";

type Hit={method:string;url:string;auth:string|undefined};
type Srv={base:string;hits:Hit[];reply:(req:http.IncomingMessage,res:http.ServerResponse)=>void;close:()=>Promise<void>};
const KEY="test-omniroute-key-not-a-secret";
async function serve():Promise<Srv>{
  const s:Srv={base:"",hits:[],reply:(_q,r)=>{r.writeHead(500);r.end()},close:async()=>{}};
  const server=http.createServer((req,res)=>{s.hits.push({method:req.method??"",url:req.url??"",auth:req.headers.authorization});s.reply(req,res)});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  s.base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  s.close=()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r())});
  return s;
}
const json=(body:unknown,status=200)=>(_q:http.IncomingMessage,r:http.ServerResponse)=>{r.writeHead(status,{"content-type":"application/json"});r.end(JSON.stringify(body))};

export function registerOmniRouteClientCases():void{
  describe("UASCO-T0065 OmniRoute discovery client against a loopback gateway (V3-AC-F028-1)",()=>{
    let gw:Srv,other:Srv;
    beforeAll(async()=>{gw=await serve();other=await serve()});
    afterAll(async()=>{await gw.close();await other.close()});
    afterEach(()=>{gw.hits.length=0;other.hits.length=0;delete process.env.OMNIROUTE_BASE_URL;delete process.env.OMNIROUTE_API_KEY});

    it("discovers model ids with one GET <base>/models, sending the key only as a Bearer header to the loopback gateway",async()=>{
      gw.reply=json({object:"list",data:[{id:"anthropic/claude-opus-x",owned_by:"anthropic"},{id:"openai/gpt-y"}]});
      const models=await discoverOmniRouteModels(gw.base+"/",KEY,{timeoutMs:2000});
      expect(models.map(m=>m.id)).toEqual(["anthropic/claude-opus-x","openai/gpt-y"]);
      expect(models[0]).toEqual({id:"anthropic/claude-opus-x",owned_by:"anthropic"});
      expect(gw.hits).toEqual([{method:"GET",url:"/v1/models",auth:`Bearer ${KEY}`}]);
    });

    it("no key -> no Authorization header; env defaults are honoured; a missing data array is an empty list",async()=>{
      gw.reply=json({object:"list"});
      process.env.OMNIROUTE_BASE_URL=gw.base;process.env.OMNIROUTE_API_KEY="";
      expect(await discoverOmniRouteModels()).toEqual([]);
      expect(gw.hits).toEqual([{method:"GET",url:"/v1/models",auth:undefined}]);
    });

    it("a malformed model id fails closed (no partial list)",async()=>{
      for(const bad of [[{id:"ok"},{id:""}],[{id:"ok"},{id:"   "}],[{id:7}],[null],[{}]]){
        gw.reply=json({data:bad});
        await expect(discoverOmniRouteModels(gw.base,KEY,{timeoutMs:2000})).rejects.toThrow("OMNIROUTE_MODEL_ID_INVALID");
      }
    });

    it("unapproved host, URL credentials, non-http protocol and malformed URL are refused before any request",async()=>{
      const cases:[string,string][]=[
        ["http://gateway.example.com/v1","OMNIROUTE_GATEWAY_HOST_NOT_APPROVED"],
        ["http://10.0.0.5:20128/v1","OMNIROUTE_GATEWAY_HOST_NOT_APPROVED"],
        ["http://127.0.0.1.nip.io/v1","OMNIROUTE_GATEWAY_HOST_NOT_APPROVED"],
        [gw.base.replace("http://","http://user:pw@"),"OMNIROUTE_URL_CREDENTIAL_DENIED"],
        [gw.base.replace("http://","http://user@"),"OMNIROUTE_URL_CREDENTIAL_DENIED"],
        ["file:///etc/passwd","OMNIROUTE_PROTOCOL_DENIED"],
        [gw.base.replace("http:","ftp:"),"OMNIROUTE_PROTOCOL_DENIED"],
        ["not a url","OMNIROUTE_BASE_URL_INVALID"],
      ];
      for(const [u,code] of cases)await expect(discoverOmniRouteModels(u,KEY,{timeoutMs:2000}),u).rejects.toThrow(code);
      // approval is explicit and per host: approving another host does not open this one
      await expect(discoverOmniRouteModels("http://gateway.example.com/v1",KEY,{approvedGatewayHosts:["other.example.com"],timeoutMs:2000})).rejects.toThrow("OMNIROUTE_GATEWAY_HOST_NOT_APPROVED");
      expect(gw.hits).toEqual([]);
    });

    it("an explicitly approved external gateway (approval list is case-insensitive) is the only non-loopback host reached; fetch is faked, nothing leaves the process",async()=>{
      const real=globalThis.fetch,calls:{url:string;auth:string|null;redirect:string|undefined}[]=[];
      globalThis.fetch=(async(input:URL|RequestInfo,init?:RequestInit)=>{
        calls.push({url:String(input),auth:new Headers(init?.headers).get("authorization"),redirect:init?.redirect});
        return new Response(JSON.stringify({data:[{id:"hosted/model-z"}]}),{status:200,headers:{"content-type":"application/json"}});
      }) as typeof fetch;
      try{
        expect(await discoverOmniRouteModels("https://gw.example.com/v1",KEY,{approvedGatewayHosts:["GW.Example.COM"],timeoutMs:2000})).toEqual([{id:"hosted/model-z"}]);
        await expect(discoverOmniRouteModels("https://gw2.example.com/v1",KEY,{approvedGatewayHosts:["GW.Example.COM"],timeoutMs:2000})).rejects.toThrow("OMNIROUTE_GATEWAY_HOST_NOT_APPROVED");
      }finally{globalThis.fetch=real}
      expect(calls).toEqual([{url:"https://gw.example.com/v1/models",auth:`Bearer ${KEY}`,redirect:"error"}]);
    });

    it("loopback hostnames are matched case-insensitively (LOCALHOST reaches the gateway)",async()=>{
      gw.reply=json({data:[{id:"m"}]});
      expect(await discoverOmniRouteModels(gw.base.replace("127.0.0.1","LOCALHOST"),KEY,{timeoutMs:2000})).toEqual([{id:"m"}]);
      expect(gw.hits.length).toBe(1);
    });

    it("a redirect is refused: the key never reaches the redirect target",async()=>{
      gw.reply=(_q,r)=>{r.writeHead(302,{location:other.base+"/models"});r.end()};
      other.reply=json({data:[{id:"leak"}]});
      await expect(discoverOmniRouteModels(gw.base,KEY,{timeoutMs:2000})).rejects.toThrow();
      expect(gw.hits.length).toBe(1);
      expect(other.hits).toEqual([]);
    });

    it("quota / rate limit (HTTP 429) and server errors fail closed with the status, never an empty model list",async()=>{
      for(const status of [429,401,500,503]){
        gw.reply=json({error:{message:"rate limited"}},status);
        await expect(discoverOmniRouteModels(gw.base,KEY,{timeoutMs:2000}),String(status)).rejects.toThrow(`OmniRoute discovery failed: HTTP ${status}`);
      }
    });

    it("a hanging gateway is abandoned at the timeout; out-of-range timeouts are refused up front",async()=>{
      gw.reply=()=>{/* never answers */};
      const t0=Date.now();
      await expect(discoverOmniRouteModels(gw.base,KEY,{timeoutMs:150})).rejects.toThrow();
      expect(Date.now()-t0).toBeLessThan(5000);
      gw.hits.length=0;
      for(const timeoutMs of [99,30_001,Number.NaN,Number.POSITIVE_INFINITY])
        await expect(discoverOmniRouteModels(gw.base,KEY,{timeoutMs})).rejects.toThrow("OMNIROUTE_TIMEOUT_INVALID");
      expect(gw.hits).toEqual([]);
    },20_000);
  });
}
