// //TR: Bu dosya Skill Academy terfisi için bağımsız reviewer kanıt dosyasını doğrular: referans audit/evidence/skill-academy/<learningId>/REVIEWER.json#sha256=<hex> biçiminde olmalı, dosya kök içinde gerçek bir dosya olmalı (sembolik bağ kaçışı reddedilir), bayt sha256'sı sabitlenen değere eşit olmalı ve içerik aynı kayıt/rol/reviewer/implementer/kapsamı adlandırmalıdır; dosya yalnız okunur, hiçbir şey yazılmaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {EVIDENCE_ROOT, distinctIdentity, parseReviewerEvidenceRef, sameIdentity} from "./rules.js";
import type {LearningRecord, PromotionKind} from "./types.js";

const MAX_EVIDENCE_BYTES = 1024 * 1024;
const realOrNull = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
const inside = (base: string, p: string): boolean => { const r = path.relative(base, p); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

export interface ReviewerEvidenceClaim { reviewerIdentity: string; kind: PromotionKind; global: boolean }
export type EvidenceCheck = {ok: true; sha256: string; ref: string} | {ok: false; problem: string};

// Kanıt içeriği beklenen alanları taşımalıdır; "approved" yazan serbest model metni değil, yalnız bu sabitlenmiş ve hash'i doğrulanmış kayıt geçerlidir.
export function verifyReviewerEvidence(repoRoot: string, ref: unknown, rec: Pick<LearningRecord, "learningId" | "roleId" | "implementerIdentity">, claim: ReviewerEvidenceClaim): EvidenceCheck {
  const parsed = parseReviewerEvidenceRef(ref);
  if (!parsed) return {ok: false, problem: "REF_FORMAT"};
  if (parsed.learningId !== rec.learningId) return {ok: false, problem: "REF_NAMES_OTHER_LEARNING"};
  const base = realOrNull(path.resolve(repoRoot, EVIDENCE_ROOT));
  const real = realOrNull(path.resolve(repoRoot, ...parsed.relPath.split("/")));
  if (!base || !real) return {ok: false, problem: "FILE_MISSING"};
  if (!inside(base, real)) return {ok: false, problem: "OUTSIDE_EVIDENCE_ROOT"};
  let raw: Buffer;
  try {
    const st = fs.statSync(real);
    if (!st.isFile()) return {ok: false, problem: "NOT_A_FILE"};
    if (st.size > MAX_EVIDENCE_BYTES) return {ok: false, problem: "TOO_LARGE"};
    raw = fs.readFileSync(real);
  } catch { return {ok: false, problem: "UNREADABLE"}; }
  if (crypto.createHash("sha256").update(raw).digest("hex") !== parsed.sha256) return {ok: false, problem: "SHA256_MISMATCH"};
  let j: Record<string, unknown>;
  try { const v: unknown = JSON.parse(raw.toString("utf8")); if (typeof v !== "object" || v === null || Array.isArray(v)) return {ok: false, problem: "NOT_JSON_OBJECT"}; j = v as Record<string, unknown>; } catch { return {ok: false, problem: "NOT_JSON"}; }
  if (j.learningId !== rec.learningId || j.roleId !== rec.roleId) return {ok: false, problem: "CONTENT_RECORD_MISMATCH"};
  if (j.verdict !== "APPROVED") return {ok: false, problem: "CONTENT_VERDICT_NOT_APPROVED"};
  if (typeof j.reviewerIdentity !== "string" || !sameIdentity(j.reviewerIdentity, claim.reviewerIdentity)) return {ok: false, problem: "CONTENT_REVIEWER_MISMATCH"};
  if (typeof j.implementerIdentity !== "string" || !sameIdentity(j.implementerIdentity, rec.implementerIdentity)) return {ok: false, problem: "CONTENT_IMPLEMENTER_MISMATCH"};
  // WFR04A-C1-F1: kanıt içindeki reviewer ile implementer aynı kanonik kimliğe inerse (biçim farkı, görünmez karakter vb.) kanıt kendi kendini onaydır.
  if (!distinctIdentity(j.reviewerIdentity, j.implementerIdentity)) return {ok: false, problem: "CONTENT_SELF_REVIEW"};
  if (j.promotionKind !== claim.kind) return {ok: false, problem: "CONTENT_KIND_MISMATCH"};
  if (j.scope !== (claim.global ? "GLOBAL" : "TENANT")) return {ok: false, problem: "CONTENT_SCOPE_MISMATCH"};
  return {ok: true, sha256: parsed.sha256, ref: `${parsed.relPath}#sha256=${parsed.sha256}`};
}
