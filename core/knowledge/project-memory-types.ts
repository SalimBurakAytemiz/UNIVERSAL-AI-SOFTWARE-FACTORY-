// //TR: Bu dosya SC-14 Proje Belleği (I-DP-039) çekirdek modülünün tiplerini, sınırlarını ve hata kodlarını tanımlar; kayıtlar append-only, hash zincirli JSONL'dir ve API'ye bağlı değildir.
export const MEMORY_KINDS = ["DECISION", "FACT", "SOURCE", "REVISION", "NOTE"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export const MEMORY_LIMITS = Object.freeze({
  bodyBytes: 32 * 1024,
  sources: 32,
  titleChars: 200,
  tags: 32,
  refChars: 2048
});

export const PROJECT_ID_RE = /^prj_[0-9a-f]{24}$/;
export const MEMORY_ID_RE = /^mem_[0-9]{6,}$/;

export interface MemorySource { ref: string; sha256?: string; retrievedAt: string }
export interface MemoryAuthor { role: string; sessionId?: string }

export interface MemoryRecord {
  seq: number;
  id: string;
  at: string;
  kind: MemoryKind;
  projectId: string;
  title: string;
  body: string;
  sources: MemorySource[];
  supersedes?: string;
  tags: string[];
  author: MemoryAuthor;
  prevHash: string;
  hash: string;
}

export interface AppendMemoryInput {
  kind: MemoryKind;
  title: string;
  body: string;
  sources?: MemorySource[];
  supersedes?: string;
  tags?: string[];
  author: MemoryAuthor;
}

// Doğrulama yalnız rapor eder; hiçbir durumda dosya onarılmaz veya kesilmez.
export type MemoryHealthState = "OK" | "ABSENT" | "TAMPERED" | "TORN_TAIL";
export interface MemoryHealth { state: MemoryHealthState; reason: string | null; records: number; lastSeq: number; lastHash: string; tornTailBytes: number }

export interface CurrentViewEntry { head: MemoryRecord; history: string[] }
export interface ProvenanceStep { id: string; seq: number; at: string; kind: MemoryKind; author: MemoryAuthor; sources: MemorySource[]; hash: string }
export interface Provenance { id: string; currentHeadId: string; lineage: ProvenanceStep[] }

export type ProjectMemoryErrorCode =
  | "MEMORY_INVALID_PROJECT_ID" | "MEMORY_PATH_REJECTED" | "MEMORY_INVALID_INPUT" | "MEMORY_LIMIT_EXCEEDED"
  | "MEMORY_SECRET_REJECTED" | "MEMORY_SUPERSEDES_MISSING" | "MEMORY_SUPERSEDES_NOT_HEAD" | "MEMORY_NOT_FOUND"
  | "MEMORY_TAMPERED" | "MEMORY_READ_ONLY" | "MEMORY_BUSY";

export class ProjectMemoryError extends Error {
  constructor(readonly code: ProjectMemoryErrorCode, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ProjectMemoryError";
  }
}
