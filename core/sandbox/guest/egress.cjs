// //TR: DSK-T0007 konuk (WSL2) tarafı çıkış proxy'si: core/sandbox/egress-proxy.ts ile AYNI karar kuralı (test bu ikisinin aynı kararı verdiğini tablo ile denetler). Dış (ağlı) namespace'te unix soketinde dinler; yalnız izin listesindeki ad:443 için CONNECT tüneli açar, gerisini 403 ile reddeder; istek gövdesi okunmaz ve kaydedilmez.
"use strict";
const net = require("node:net");
const ALLOW = ["api.anthropic.com", "claude.ai", "console.anthropic.com", "statsig.anthropic.com"];
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
function decide(head) {
  const line = head.split("\r\n", 1)[0] || "";
  const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
  if (!m) return {allow: false, code: "MALFORMED"};
  if (m[1] !== "CONNECT") return {allow: false, code: "NOT_CONNECT"};
  const t = /^([^:\[\]]+):(\d{1,5})$/.exec(m[2]);
  if (!t) return {allow: false, code: m[2].includes("[") ? "IP_LITERAL" : "MALFORMED"};
  const host = t[1].toLowerCase(), port = Number(t[2]);
  if (net.isIP(host)) return {allow: false, code: "IP_LITERAL"};
  if (!HOST_RE.test(host)) return {allow: false, code: "MALFORMED"};
  if (port !== 443) return {allow: false, code: "PORT_NOT_ALLOWED"};
  if (!ALLOW.includes(host)) return {allow: false, code: "HOST_NOT_ALLOWED"};
  return {allow: true, host, port: 443};
}
module.exports = {decide, ALLOW};
if (require.main === module) {
  const sock = process.argv[2];
  const srv = net.createServer(c => {
    let buf = Buffer.alloc(0);
    const onData = d => {
      buf = Buffer.concat([buf, d]); const end = buf.indexOf("\r\n\r\n");
      if (end < 0) { if (buf.length > 4096) c.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n"); return; }
      c.off("data", onData); const dec = decide(buf.subarray(0, end).toString("latin1"));
      if (!dec.allow) { c.end("HTTP/1.1 403 Forbidden\r\nX-UASCO-Egress: " + dec.code + "\r\n\r\n"); return; }
      const up = net.connect({host: dec.host, port: 443});
      up.once("connect", () => { c.write("HTTP/1.1 200 Connection Established\r\n\r\n"); const rest = buf.subarray(end + 4); if (rest.length) up.write(rest); c.pipe(up); up.pipe(c); });
      up.on("error", () => c.destroy()); c.on("error", () => up.destroy());
    };
    c.on("data", onData); c.on("error", () => c.destroy());
  });
  srv.listen(sock);
  const stop = () => srv.close(() => process.exit(0)); process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
