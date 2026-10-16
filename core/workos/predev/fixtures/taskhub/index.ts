// //TR: Bu dosya TaskHub pre-dev artefakt fixture'larını (BusinessAnalysis, Requirements, Plan, Architecture, UxSpec) tür-anahtarlı tek bir sabit olarak toplar. Her değer ilgili UASCO role-builder rolünün GERÇEK çıktısıdır (ayrı dosyalarda); burada yalnız tür->içerik eşlemesi yapılır. Hiçbir içerik burada üretilmez/değiştirilmez; yan etki ve ağ/sır yoktur.
import type {ArtifactContent, ArtifactKind} from "../../types.js";
import {TASKHUB_BUSINESS_ANALYSIS} from "./business-analysis.js";
import {TASKHUB_REQUIREMENTS} from "./requirements.js";
import {TASKHUB_PLAN} from "./plan.js";
import {TASKHUB_ARCHITECTURE} from "./architecture.js";
import {TASKHUB_UX_SPEC} from "./ux-spec.js";

export {TASKHUB_BUSINESS_ANALYSIS, TASKHUB_REQUIREMENTS, TASKHUB_PLAN, TASKHUB_ARCHITECTURE, TASKHUB_UX_SPEC};

// //TR: Tür başına genuine TaskHub artefakt içeriği; test, enjekte edilen BuilderPort'tan bu içeriği JSON metni olarak döndürür.
export const TASKHUB_ARTIFACTS: Readonly<Record<ArtifactKind, ArtifactContent>> = {
  BusinessAnalysis: TASKHUB_BUSINESS_ANALYSIS,
  Requirements: TASKHUB_REQUIREMENTS,
  Plan: TASKHUB_PLAN,
  Architecture: TASKHUB_ARCHITECTURE,
  UxSpec: TASKHUB_UX_SPEC
};
