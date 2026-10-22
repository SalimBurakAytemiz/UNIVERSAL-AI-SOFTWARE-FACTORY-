//TR: Bu dosya Proje Belleği route'larını sağlar (proje başına liste/ayrıntı/güncel görünüm/köken okuma ve append yazma); server.ts'e tek satırlık kayıt gerekir (docs/authority-requests/LANE-B-memory-api.md).
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import {LANE_WRITE_BODY_LIMIT} from "./deps.js";
import type {RouteDeps} from "./deps.js";
import {ProjectMemory} from "../../../../core/knowledge/project-memory.js";
import {ProjectMemoryError, MEMORY_KINDS, MEMORY_ID_RE, PROJECT_ID_RE, type MemoryKind, type MemoryRecord} from "../../../../core/knowledge/project-memory-types.js";

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: true});
addFormatsModule.default(ajv);
// Yazar gövdeden gelmez: sunucu aktörü yazar rolüdür (additionalProperties:false ile istemci author gönderemez). Ayrıntılı sınırları (bayt, sır taraması, supersedes) çekirdek uygular.
const appendSchema = {
  type: "object", additionalProperties: false, required: ["kind", "title", "body"],
  properties: {
    kind: {enum: [...MEMORY_KINDS]}, title: {type: "string", minLength: 1, maxLength: 200, pattern: "\\S"}, body: {type: "string", minLength: 1, maxLength: 32768, pattern: "\\S"},
    sources: {type: "array", maxItems: 32, items: {type: "object", additionalProperties: false, required: ["ref", "retrievedAt"],
      properties: {ref: {type: "string", minLength: 1, maxLength: 2048}, sha256: {type: "string", pattern: "^[0-9a-f]{64}$"}, retrievedAt: {type: "string", format: "date-time"}}}},
    supersedes: {type: "string", pattern: "^mem_[0-9]{6,}$"},
    tags: {type: "array", maxItems: 32, items: {type: "string", minLength: 1, maxLength: 64, pattern: "\\S"}}
  }
} as const;
const check = ajv.compile(appendSchema);
// Sabit kod -> HTTP durumu; çekirdek hata ayrıntısı (yol, sır türü) yanıta yazılmaz, yalnız kod döner.
const STATUS: Record<string, number> = {
  MEMORY_INVALID_PROJECT_ID: 400, MEMORY_PATH_REJECTED: 400, MEMORY_INVALID_INPUT: 400, MEMORY_LIMIT_EXCEEDED: 413, MEMORY_SECRET_REJECTED: 400,
  MEMORY_SUPERSEDES_MISSING: 409, MEMORY_SUPERSEDES_NOT_HEAD: 409, MEMORY_NOT_FOUND: 404, MEMORY_TAMPERED: 503, MEMORY_READ_ONLY: 503, MEMORY_BUSY: 503
};
const MAX_QUERY = 200;

export function registerMemoryRoutes(app: any, d: RouteDeps): void {
  const guard = (fn: (req: any, reply: any) => unknown) => async (req: any, reply: any) => {
    try { return await fn(req, reply); }
    catch (e) { return e instanceof ProjectMemoryError ? reply.code(STATUS[e.code] ?? 500).send({error: e.code}) : d.workosFail(reply, e); }
  };
  // Proje Work OS kaydından tenant kapsamıyla çözülür; başka tenant'ın projesi 404'tür ve bellek dosyasına hiç dokunulmaz.
  const memoryFor = (req: any, reply: any): ProjectMemory | null => {
    if (typeof req.params.id !== "string" || !PROJECT_ID_RE.test(req.params.id)) { reply.code(400).send({error: "INVALID_PROJECT_ID"}); return null; }
    if (!d.getStore().getProject(d.scope, req.params.id)) { reply.code(404).send({error: "WORKOS_NOT_FOUND"}); return null; }
    return new ProjectMemory({rootDir: d.getStore().dataDir, projectId: req.params.id});
  };
  const validMemId = (x: unknown) => typeof x === "string" && MEMORY_ID_RE.test(x);

  // Tüketici ekran: UI-160 Proje Belleği / karar revizyonları (SCREEN_AUDIT_252); salt okunur rotalar yazma kapısı istemez.
  app.get("/v1/projects/:id/memory/health", guard(async (req: any, reply: any) => { const m = memoryFor(req, reply); return m ? {health: m.verify()} : reply; }));
  app.get("/v1/projects/:id/memory/current", guard(async (req: any, reply: any) => { const m = memoryFor(req, reply); return m ? {current: m.currentView(), health: m.verify()} : reply; }));
  app.get("/v1/projects/:id/memory", guard(async (req: any, reply: any) => {
    const m = memoryFor(req, reply); if (!m) return reply;
    const {kind, tag, q} = (req.query ?? {}) as Record<string, unknown>;
    if (kind !== undefined && !(typeof kind === "string" && (MEMORY_KINDS as readonly string[]).includes(kind))) return reply.code(400).send({error: "INVALID_QUERY"});
    for (const v of [tag, q]) if (v !== undefined && (typeof v !== "string" || v.length === 0 || v.length > MAX_QUERY)) return reply.code(400).send({error: "INVALID_QUERY"});
    let records: MemoryRecord[] = typeof q === "string" ? m.search(q) : m.all();
    if (kind !== undefined) records = records.filter(r => r.kind === (kind as MemoryKind));
    if (typeof tag === "string") records = records.filter(r => r.tags.includes(tag));
    return {records, health: m.verify()};
  }));
  app.get("/v1/projects/:id/memory/:memId", guard(async (req: any, reply: any) => {
    const m = memoryFor(req, reply); if (!m) return reply;
    if (!validMemId(req.params.memId)) return reply.code(400).send({error: "INVALID_MEMORY_ID"});
    return {record: m.get(req.params.memId)};
  }));
  app.get("/v1/projects/:id/memory/:memId/provenance", guard(async (req: any, reply: any) => {
    const m = memoryFor(req, reply); if (!m) return reply;
    if (!validMemId(req.params.memId)) return reply.code(400).send({error: "INVALID_MEMORY_ID"});
    return {provenance: m.provenance(req.params.memId)};
  }));
  app.post("/v1/projects/:id/memory", {bodyLimit: LANE_WRITE_BODY_LIMIT}, guard(async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (d.workosStopped()) return reply.code(423).send({error: "GLOBAL_STOP_ACTIVE"});
    const decision = d.workosPolicy("workos.project.memory.append", typeof req.params.id === "string" ? req.params.id : "NONE", body);
    if (!decision.allowed) { d.audit("WORKOS_WRITE_DENIED", {actor: d.actor, action: "workos.project.memory.append", reason: decision.reason}); return reply.code(403).send({error: "ACTION_DENIED", reason: decision.reason}); }
    if (!check(body)) return reply.code(400).send({error: "INVALID_BODY", detail: ajv.errorsText(check.errors, {separator: " | "})});
    const m = memoryFor(req, reply); if (!m) return reply;
    const b = body as {kind: MemoryKind; title: string; body: string; sources?: {ref: string; sha256?: string; retrievedAt: string}[]; supersedes?: string; tags?: string[]};
    let rec: MemoryRecord;
    try { rec = m.append({...b, author: {role: d.actor}}); }
    catch (e) { if (e instanceof ProjectMemoryError) d.audit("WORKOS_MEMORY_APPEND_REFUSED", {actor: d.actor, projectId: req.params.id, reason: e.code}); throw e; }
    d.audit("WORKOS_MEMORY_APPENDED", {actor: d.actor, kind: "memory", projectId: rec.projectId, memoryId: rec.id, memoryKind: rec.kind, supersedes: rec.supersedes});
    return reply.code(201).send({record: rec});
  }));
}
