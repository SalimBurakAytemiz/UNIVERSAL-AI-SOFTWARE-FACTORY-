// //TR: UASCO-T0117: model'e gönderilen istemlerin envanteri ve güncel içerik özetleri. İki tür kaynak vardır:
//  - FILE: prompts/ altındaki fabrika istemleri (korumalı governance öneki; bu modül onları YALNIZ OKUR, hiçbir dosya yazmaz). Yükleyiciler korumalı fabrika kodudur
//    (automation/factory-supervisor.mjs, automation/lib/orchestrator-executors.mjs, automation/lib/review-pipeline.mjs, scripts/claude-reviewer-broker.mjs).
//  - CODE: ürünün kod içi istem şablonları (pre-dev rol istemleri, LOCAL_CLAUDE uygulayıcı/inceleyici istemleri, bulut planlayıcı istemi). Özet, sabit (kanonik) bir girdiyle
//    üretilen metnin özetidir: şablon verisi YA DA birleştirme kodu değişirse özet değişir.
// Kanonik girdiler de sürümlenen içeriğin parçasıdır; değiştirilirse ilgili istemlerin sürümü artırılmalıdır.
import fs from "node:fs";
import path from "node:path";
import {promptDigest} from "./versioning.js";
import {composeRolePrompt, ROLE_PROMPTS} from "../workos/predev/role-prompts.js";
import type {MissionContext} from "../workos/predev/driver.js";
import type {ArtifactKind} from "../workos/predev/types.js";
import {implementPrompt, reviewPrompt, type MissionSpec} from "../workos/executors.js";
import {plannerPrompt} from "../cloud/task-orchestrator.js";
import type {SignedScope} from "../cloud/contracts.js";

/** prompts/ altındaki her istem dosyası (dosya adı -> istem kimliği). Listede olmayan yeni bir istem dosyası testte düşer. */
export const FILE_PROMPTS: Readonly<Record<string, string>> = Object.freeze({
  "prompts/AUTO-BUILDER.md": "factory.auto-builder",
  "prompts/AUTO-REMEDIATION.md": "factory.auto-remediation",
  "prompts/AUTO-REVIEW.md": "factory.auto-review",
  "prompts/AUTO-VALIDATION-FIX.md": "factory.auto-validation-fix",
  "prompts/CLAUDE-REVIEWER-SYSTEM.md": "factory.claude-reviewer-system",
  "prompts/GOVERNED-FROZEN-BUNDLE-REVIEW.txt": "factory.governed-frozen-bundle-review",
  "prompts/RELEASE-AUDIT-REVIEW.txt": "factory.release-audit-review"
});

/** Pre-dev rol isteminin kimliği (sürücü kayıtta bunu kullanır). */
export const rolePromptId = (kind: ArtifactKind): string => `predev.role.${kind}`;

const CANONICAL_BRIEF: MissionContext = {brief: {projectName: "Canonical", isReference: false, label: "canonical", summary: "canonical summary", stakeholders: ["s"], objectives: ["o"], constraints: ["c"], outOfScope: ["x"], notes: ["n"]}, approvedUpstream: {}};
const CANONICAL_SPEC: MissionSpec = {runId: "run_canonical", missionId: "msn_canonical", projectId: "prj_canonical", title: "canonical title", objective: "canonical objective", acceptanceCriteria: ["a1"], riskLevel: "R1", cycle: 0, baseSha: "0".repeat(40)};
const CANONICAL_SCOPE = {jobKinds: ["BUILD", "TEST"], allowNetwork: false, maxCostUsd: 1} as unknown as SignedScope;

/** Kod içi istemler: kimlik -> {kaynak, kanonik girdiyle üretilmiş metin}. */
export function codePrompts(): Record<string, {source: string; text: string}> {
  const out: Record<string, {source: string; text: string}> = {};
  for (const kind of Object.keys(ROLE_PROMPTS) as ArtifactKind[]) out[rolePromptId(kind)] = {source: "core/workos/predev/role-prompts.ts#composeRolePrompt", text: composeRolePrompt(kind, CANONICAL_BRIEF)};
  out["workos.executor.implement"] = {source: "core/workos/executors.ts#implementPrompt", text: implementPrompt(CANONICAL_SPEC)};
  out["workos.executor.review"] = {source: "core/workos/executors.ts#reviewPrompt", text: reviewPrompt(CANONICAL_SPEC, "canonical diff")};
  out["cloud.planner"] = {source: "core/cloud/task-orchestrator.ts#plannerPrompt", text: plannerPrompt("canonical intent", CANONICAL_SCOPE)};
  return out;
}

/** Bütün istemlerin güncel özetleri (FILE istemleri repoRoot altından okunur). */
export function currentPromptDigests(repoRoot: string): Record<string, {source: string; sha256: string}> {
  const out: Record<string, {source: string; sha256: string}> = {};
  for (const [file, id] of Object.entries(FILE_PROMPTS)) out[id] = {source: file, sha256: promptDigest(fs.readFileSync(path.join(repoRoot, file), "utf8"))};
  for (const [id, p] of Object.entries(codePrompts())) out[id] = {source: p.source, sha256: promptDigest(p.text)};
  return out;
}
