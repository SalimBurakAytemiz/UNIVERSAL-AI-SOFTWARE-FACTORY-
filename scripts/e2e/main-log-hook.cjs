// //TR: Electron `-r` ile ana süreçte uygulama kodundan ÖNCE yüklenir: stdout/stderr çıktısını E2E_MAIN_LOG dosyasına da ekler; Playwright bağlandıktan sonra eklenen dinleyicilerin kaçırdığı erken çıktı (başlatma hatası) böylece rapora girebilir. Yalnız dosyaya ekler, davranışı değiştirmez.
const fs = require("node:fs"), file = process.env.E2E_MAIN_LOG;
if (file) for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => { try { fs.appendFileSync(file, typeof chunk === "string" ? chunk : Buffer.from(chunk)); } catch { /* günlük yazılamazsa sessizce geç */ } return write(chunk, ...rest); };
}
