// //TR: STALE/OFFLINE önbellek kuralları (ADR-MOB-001 bölüm 5): önbellekten okunan veri her zaman STALE ve yaşıyla etiketlenir, asla taze gösterilmez.
import type { CacheEntry, ContractState, Envelope } from "./types.js";

/** Cached copies older than this are dropped to UNAVAILABLE instead of shown. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedRead {
  readonly state: "STALE" | "UNAVAILABLE";
  /** Age in ms since the phone fetched it; null when the clock is inconsistent. */
  readonly ageMs: number | null;
  readonly ageLabel: string;
  readonly fetchedAtMs: number | null;
  readonly envelope: Envelope | null;
}

export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown age";
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Any cached read is STALE, whatever state the stored envelope carried. */
export function classifyCached(entry: CacheEntry | null, nowMs: number): CachedRead {
  if (entry === null || !Number.isFinite(entry.fetchedAtMs)) {
    return { state: "UNAVAILABLE", ageMs: null, ageLabel: formatAge(null), fetchedAtMs: null, envelope: null };
  }
  const raw = nowMs - entry.fetchedAtMs;
  if (raw < 0) {
    // Clock moved backwards: age cannot be trusted, but it is still never fresh.
    return { state: "STALE", ageMs: null, ageLabel: formatAge(null), fetchedAtMs: entry.fetchedAtMs, envelope: entry.envelope };
  }
  if (raw > MAX_CACHE_AGE_MS) {
    return { state: "UNAVAILABLE", ageMs: raw, ageLabel: formatAge(raw), fetchedAtMs: entry.fetchedAtMs, envelope: null };
  }
  return { state: "STALE", ageMs: raw, ageLabel: formatAge(raw), fetchedAtMs: entry.fetchedAtMs, envelope: entry.envelope };
}

/** A live envelope may only be shown as VERIFIED if the server said VERIFIED; STALE/UNKNOWN stay as sent. */
export function liveState(envelope: Envelope): ContractState {
  return envelope.state;
}
