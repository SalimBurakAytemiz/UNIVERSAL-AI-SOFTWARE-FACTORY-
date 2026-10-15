// //TR: Bu dosya kokpit-tüketilebilir SAF pre-dev okuma modelini tanımlar: pre-dev fazı ve her artefaktın durumu YALNIZ kayıtlardan türetilir (NOT_STARTED/DRAFT/SUBMITTED/APPROVED/REJECTED). Dizi yoksa dürüst boş durumlar döner (sahte veri yok). Bu paket hiçbir şey RENDER etmez; yalnız okuma modeli alanlarını üretir.
import {ARTIFACT_KINDS, PRE_DEV_ROLE_MAP} from "./types.js";
import type {ArtifactKind, PreDevArtifact, PreDevPhase, PreDevSequence} from "./types.js";

export type ArtifactReadState = "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export interface ArtifactSummary {
  state: ArtifactReadState; artifactId: string | null; version: number | null; authorRoleId: string | null;
  approved: boolean; evidenceRefs: string[]; mappedRoleIds: readonly string[];
}
export interface PreDevReadModel {
  schemaVersion: 1; missionId: string; active: boolean; phase: PreDevPhase | "NOT_STARTED"; preDevId: string | null;
  artifacts: Record<ArtifactKind, ArtifactSummary>;
}

const emptySummary = (kind: ArtifactKind): ArtifactSummary => ({
  state: "NOT_STARTED", artifactId: null, version: null, authorRoleId: null, approved: false, evidenceRefs: [], mappedRoleIds: PRE_DEV_ROLE_MAP[kind]
});

// //TR: Saf okuma modeli: dizi kaydı ve artefakt kayıtlarından türetilir; yan etkisi yoktur, hiçbir alan tahminle doldurulmaz. sequence null ise mission pre-dev istenmemiştir (mevcut yolunu izler).
export function derivePreDevReadModel(missionId: string, sequence: PreDevSequence | null, artifacts: Readonly<Record<string, PreDevArtifact>>): PreDevReadModel {
  const summaries = {} as Record<ArtifactKind, ArtifactSummary>;
  for (const kind of ARTIFACT_KINDS) {
    const id = sequence?.artifacts[kind];
    const art = id ? artifacts[id] : undefined;
    summaries[kind] = art
      ? {state: art.state, artifactId: art.id, version: art.version, authorRoleId: art.authorRoleId, approved: art.state === "APPROVED", evidenceRefs: [...art.evidenceRefs], mappedRoleIds: PRE_DEV_ROLE_MAP[kind]}
      : emptySummary(kind);
  }
  return {
    schemaVersion: 1, missionId, active: sequence !== null, phase: sequence ? sequence.phase : "NOT_STARTED",
    preDevId: sequence?.preDevId ?? null, artifacts: summaries
  };
}
