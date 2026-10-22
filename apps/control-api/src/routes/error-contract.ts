//TR: Bu dosya Control API'nin çerçeve düzeyi hatalarını (bozuk JSON, yanlış içerik tipi, aşırı gövde, bozuk URL, beklenmeyen istisna) sabit kodlu {error:"KOD"} gövdesine çevirir; ham mesaj, yol veya yığın yanıta yazılmaz. server.ts'te tek satırla kaydedilir (docs/authority-requests/LANE-B-error-contract.md).

// Fastify hata kodu -> [HTTP durumu, sabit kod]. Bilinmeyen 4xx genel INVALID_REQUEST olur; 5xx ve istisnalar her zaman INTERNAL_ERROR'dır.
const MAP: Readonly<Record<string, readonly [number, string]>> = Object.freeze({
  FST_ERR_CTP_INVALID_JSON_BODY: [400, "INVALID_JSON"], FST_ERR_CTP_EMPTY_JSON_BODY: [400, "INVALID_JSON"],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: [415, "UNSUPPORTED_MEDIA_TYPE"], FST_ERR_CTP_BODY_TOO_LARGE: [413, "BODY_TOO_LARGE"],
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: [400, "INVALID_REQUEST"], FST_ERR_CTP_BODY_TOO_SHORT: [400, "INVALID_REQUEST"],
  FST_ERR_BAD_URL: [400, "BAD_URL"], FST_ERR_MAX_PARAM_LENGTH: [414, "URL_TOO_LONG"]
});
const FIXED = /^[A-Z][A-Z0-9_]*$/;

export function contractFor(err: unknown): { status: number; error: string } {
  const e = err as { code?: unknown; statusCode?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const mapped = MAP[code];
  if (mapped) return { status: mapped[0], error: mapped[1] };
  const sc = typeof e?.statusCode === "number" ? e.statusCode : 500;
  return sc >= 400 && sc < 500 ? { status: sc, error: "INVALID_REQUEST" } : { status: 500, error: "INTERNAL_ERROR" };
}

const REGISTERED = Symbol.for("uasco.errorContract");
// Idempotent: server.ts kaydederse test veya ikinci çağrı aynı örnekte tekrar kurmaz (Fastify setNotFoundHandler'ı iki kez kurmayı reddeder).
export function registerErrorContract(app: any): void {
  if (app[REGISTERED]) return;
  app[REGISTERED] = true;
  app.setErrorHandler((err: unknown, req: any, reply: any) => {
    const c = contractFor(err);
    // Ayrıntı yalnız sunucu log'unda kalır (yanıtta yok).
    if (c.status >= 500) { try { req.log.error({ err }, "CONTROL_API_UNHANDLED_ERROR"); } catch { /* log yok */ } }
    if (!FIXED.test(c.error)) return reply.code(500).send({ error: "INTERNAL_ERROR" });
    return reply.code(c.status).send({ error: c.error });
  });
  app.setNotFoundHandler((_req: any, reply: any) => reply.code(404).send({ error: "NOT_FOUND" }));
}

// Yönlendirici düzeyi hatalar (bozuk URL, aşırı uzun parametre) setErrorHandler'a değil Fastify kurucusundaki `frameworkErrors` seçeneğine gider; aynı eşleme burada da kullanılır.
export function frameworkErrors(err: unknown, _req: unknown, reply: any): void {
  const c = contractFor(err);
  reply.code(c.status).send({ error: c.error });
}
