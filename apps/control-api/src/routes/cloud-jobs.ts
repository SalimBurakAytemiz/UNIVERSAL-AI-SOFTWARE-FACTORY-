//TR: Bu dosya CLOUD-T0005 için salt-okunur bulut iş durumu route'larını sağlar (GET /v1/cloud/jobs ve /v1/cloud/jobs/:id); yalnız çağıranın tenant'ı görünür, kuyruk yoksa dürüst NOT_CONFIGURED döner, lease/worker/imza alanı ve worker'ın serbest metni asla dönmez (yalnız sabit messageCode). server.ts'e tek satırlık kayıt gerekir (Kurucu kapılı).
import type {CloudJobQueue} from "../cloud/jobs.js";

export const CLOUD_JOBS_PATH = "/v1/cloud/jobs";
/** core/cloud/contracts.ts ID_RE ve renderer CLOUD_ID_RE ile aynı desen. */
export const CLOUD_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

export interface CloudJobRouteDeps {
  /** Sunucunun bulut iş kuyruğu; yapılandırılmamışsa null (yerel yedek YOK). */
  queue: () => CloudJobQueue | null;
  /** Diğer route'larla aynı kaynak: sunucunun RouteDeps.scope değeri (istemciden asla alınmaz). */
  scope: {tenantId: string};
}

export function registerCloudJobRoutes(app: any, d: CloudJobRouteDeps): void {
  const tenant = () => (typeof d.scope?.tenantId === "string" && d.scope.tenantId.length > 0 ? d.scope.tenantId : null);
  app.get(CLOUD_JOBS_PATH, async (_req: any, reply: any) => {
    try {
      const q = d.queue(), t = tenant();
      if (!q || !t) return {state: "NOT_CONFIGURED", jobs: []};
      return {state: "OK", stopped: q.isStopped, jobs: q.list(t, 100)};
    } catch {
      return reply.code(500).send({error: "CLOUD_JOBS_UNAVAILABLE"});
    }
  });
  app.get(`${CLOUD_JOBS_PATH}/:id`, async (req: any, reply: any) => {
    const id = req.params?.id;
    if (typeof id !== "string" || !CLOUD_JOB_ID_RE.test(id)) return reply.code(400).send({error: "INVALID_JOB_ID"});
    try {
      const q = d.queue(), t = tenant();
      if (!q || !t) return reply.code(503).send({error: "CLOUD_RUNTIME_NOT_CONFIGURED"});
      const job = q.summary(t, id);
      return job ? {job} : reply.code(404).send({error: "JOB_NOT_FOUND"});
    } catch {
      return reply.code(500).send({error: "CLOUD_JOBS_UNAVAILABLE"});
    }
  });
}
