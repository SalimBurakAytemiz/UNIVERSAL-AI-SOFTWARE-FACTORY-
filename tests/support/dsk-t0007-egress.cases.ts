// //TR: DSK-T0007 sandbox model çıkış proxy'si (gerçek soketler, gerçek model veya dış ağ yok): yalnız izin listesindeki ad:443 için CONNECT tüneli açılır; IP adresi, başka port, düz HTTP, CONNECT dışı yöntem, izin dışı ad, bozuk ve aşırı uzun istek 403/431 ile reddedilir ve upstream'e hiç bağlanılmaz. tests/v7-b3a-runner.test.ts altında kayıtlı (tests-3).
import {describe, it, expect} from "vitest";
import net from "node:net";
import {decideEgress, startEgressProxy, MODEL_EGRESS_ALLOWLIST} from "../../core/sandbox/egress-proxy.js";

const ask = (port: number, head: string) => new Promise<string>(res => {
  const c = net.connect({host: "127.0.0.1", port}, () => c.write(head)); let out = "";
  c.on("data", d => { out += d.toString("latin1"); if (out.includes("\r\n\r\n")) { c.destroy(); res(out); } }); c.on("close", () => res(out)); c.on("error", () => res(out));
});
export function registerDskEgressCases(): void {
 describe("DSK-T0007 model egress proxy (allow-list only, fail-closed)", () => {
  it("decides: only CONNECT <allowed name>:443; everything else has a fixed refusal code", () => {
    expect(decideEgress("CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: x")).toEqual({allow: true, host: "api.anthropic.com", port: 443});
    expect(decideEgress("CONNECT API.Anthropic.com:443 HTTP/1.1")).toMatchObject({allow: true, host: "api.anthropic.com"});
    const code = (h: string) => (decideEgress(h) as {code?: string}).code;
    expect(code("GET http://api.anthropic.com/ HTTP/1.1")).toBe("NOT_CONNECT");
    expect(code("CONNECT 1.1.1.1:443 HTTP/1.1")).toBe("IP_LITERAL");
    expect(code("CONNECT [::1]:443 HTTP/1.1")).toBe("IP_LITERAL");
    expect(code("CONNECT api.anthropic.com:80 HTTP/1.1")).toBe("PORT_NOT_ALLOWED");
    expect(code("CONNECT evil.example.com:443 HTTP/1.1")).toBe("HOST_NOT_ALLOWED");
    expect(code("CONNECT api.anthropic.com.evil.com:443 HTTP/1.1")).toBe("HOST_NOT_ALLOWED");
    expect(code("CONNECT localhost:443 HTTP/1.1")).toBe("MALFORMED");
    expect(code("garbage")).toBe("MALFORMED");
    expect(MODEL_EGRESS_ALLOWLIST.every(h => !h.includes("*"))).toBe(true);
  });
  it("tunnels an allowed name to the upstream and never connects upstream for a refused request", async () => {
    const target = net.createServer(s => s.on("data", d => s.write(Buffer.concat([Buffer.from("ECHO:"), d])))); await new Promise<void>(r => target.listen(0, "127.0.0.1", r));
    const tport = (target.address() as net.AddressInfo).port, upstream: string[] = [], decisions: string[] = [];
    const p = await startEgressProxy({port: 0}, {connect: (h, port) => { upstream.push(`${h}:${port}`); return net.connect({host: "127.0.0.1", port: tport}); }, onDecision: d => decisions.push(d.allow ? "ALLOW" : d.code)});
    const port = (p.address as net.AddressInfo).port;
    for (const h of ["CONNECT evil.example.com:443 HTTP/1.1\r\n\r\n", "CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n", "CONNECT api.anthropic.com:22 HTTP/1.1\r\n\r\n", "GET / HTTP/1.1\r\nHost: api.anthropic.com\r\n\r\n"])
      expect(await ask(port, h)).toMatch(/^HTTP\/1\.1 403 Forbidden/);
    expect(await ask(port, "CONNECT x:443 HTTP/1.1\r\n" + "X: " + "a".repeat(5000))).toMatch(/^HTTP\/1\.1 431/);
    expect(upstream).toEqual([]);
    const tunnel = await new Promise<string>(res => {
      const c = net.connect({host: "127.0.0.1", port}, () => c.write("CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\n")); let out = "", sent = false;
      c.on("data", d => { out += d.toString(); if (!sent && out.includes("200 Connection Established\r\n\r\n")) { sent = true; c.write("hello"); } if (out.includes("ECHO:hello")) { c.destroy(); res(out); } });
    });
    expect(tunnel).toContain("ECHO:hello"); expect(upstream).toEqual(["api.anthropic.com:443"]);
    expect(decisions).toEqual(["HOST_NOT_ALLOWED", "IP_LITERAL", "PORT_NOT_ALLOWED", "NOT_CONNECT", "MALFORMED", "ALLOW"]);
    await p.close(); target.close();
  });
 });
}
