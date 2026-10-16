// //TR: Bu dosya ilk-sürüm pre-dev rollerinin prompt ŞABLONLARINI SALT VERİ (TypeScript string sabitleri) olarak tutar; prompts/ KORUNMUŞ önekine HİÇBİR dosya eklemez/değiştirmez (bu şablonlar runtime prompt dosyası değil, kod sabitidir). Her şablon bir CLAUDE_BUILDER'a YALNIZ o tür için tipli sözleşme şeklini üretmesini söyler; açık kurallarla: proje özetinde veya onaylı üst artefaktlarda OLMAYAN gerçekleri ASLA uydurma; izlenebilirlik alanlarını gerçek kimliklerle doldur; bilgi eksikse uydurmak yerine açık bir varsayım/açık-soru maddesi yaz. Şablonlar sır veya ağ adresi taşımaz; yan etkisi yoktur.
import {PRE_DEV_ROLE_MAP} from "./types.js";
import type {ArtifactKind} from "./types.js";
import type {MissionContext} from "./driver.js";

export interface RolePromptTemplate {
  kind: ArtifactKind;
  roleId: string;
  roleTitle: string;
  summary: string;
  // O tür için tam olarak üretilmesi gereken tipli sözleşme alanları (fazladan/eksik alan doğrulayıcıca reddedilir).
  contractFields: readonly string[];
  // İzlenebilirlik kuralları: hangi alanın hangi gerçek üst kimliklere referans vermesi gerektiği.
  traceabilityRules: readonly string[];
  // Dürüstlük kuralları (uydurma yasağı + eksik bilgi için varsayım/açık-soru yönlendirmesi).
  honestyRules: readonly string[];
}

// //TR: Eksik bilgi karşısında dürüst davranış için her türün KENDİ sözleşmesindeki hangi alana açık varsayım/açık-soru yazılacağının yönlendirmesi (uydurma yerine).
const ASSUMPTION_SINK: Readonly<Record<ArtifactKind, string>> = {
  BusinessAnalysis: "assumptions[] (ve ilgiliyse risks[])",
  Requirements: "ilgili requirement'ın acceptanceCriteria[] içine açık bir 'ASSUMPTION:'/'OPEN QUESTION:' maddesi",
  Plan: "outOfScope[] veya ilgili workPackage title'ında açık bir 'ASSUMPTION:'/'OPEN QUESTION:' notu",
  Architecture: "risks[] içine açık bir 'ASSUMPTION:'/'OPEN QUESTION:' maddesi",
  UxSpec: "a11yNotes[] içine açık bir 'ASSUMPTION:'/'OPEN QUESTION:' maddesi"
};

const NO_FABRICATION = "Proje özetinde veya ONAYLI üst artefaktlarda bulunmayan hiçbir gerçeği (isim, sayı, teknoloji, metrik, paydaş) UYDURMA.";
const SHAPE_ONLY = "Yanıtın YALNIZ ve TAM OLARAK bu türün tipli sözleşme şekli olan tek bir JSON nesnesi olsun; fazladan alan, açıklama metni, markdown veya kod çiti EKLEME.";
const MISSING_INFO = (sink: string) => `Bir bilgi eksikse onu UYDURMA; bunun yerine ${sink} içine açık bir varsayım/açık-soru maddesi yaz.`;

export const ROLE_PROMPTS: Readonly<Record<ArtifactKind, RolePromptTemplate>> = {
  BusinessAnalysis: {
    kind: "BusinessAnalysis",
    roleId: PRE_DEV_ROLE_MAP.BusinessAnalysis[0],
    roleTitle: "Business Analyst",
    summary: "Proje özetini, problemi, paydaşları, kimlikli iş hedeflerini (goals), kısıtları, başarı metriklerini, varsayımları ve riskleri çıkar.",
    contractFields: ["problem", "stakeholders", "goals(id,statement)", "constraints", "successMetrics", "assumptions", "risks"],
    traceabilityRules: [
      "Her goal benzersiz bir id taşır (ör. G1, G2); bu id'ler alt Requirements tarafından tracesTo ile referans alınacaktır.",
      "goals yalnız proje özetindeki amaçlardan türetilir; özette olmayan bir hedef ekleme."
    ],
    honestyRules: [NO_FABRICATION, SHAPE_ONLY, MISSING_INFO(ASSUMPTION_SINK.BusinessAnalysis)]
  },
  Requirements: {
    kind: "Requirements",
    roleId: PRE_DEV_ROLE_MAP.Requirements[0],
    roleTitle: "Requirements / Software Analyst",
    summary: "Onaylı Business Analysis hedeflerinden fonksiyonel ve fonksiyonel-olmayan gereksinimleri (kabul kriterleriyle) türet.",
    contractFields: ["functional(id,statement,acceptanceCriteria,tracesTo)", "nonFunctional(id,statement,acceptanceCriteria,tracesTo)"],
    traceabilityRules: [
      "Her requirement'ın tracesTo[] alanı YALNIZ onaylı Business Analysis içindeki GERÇEK goal id'lerine işaret etmeli; var olmayan bir goal id'ye iz düşürme.",
      "En az bir functional requirement bulunmalı; tüm requirement id'leri benzersiz olmalı."
    ],
    honestyRules: [NO_FABRICATION, SHAPE_ONLY, MISSING_INFO(ASSUMPTION_SINK.Requirements)]
  },
  Plan: {
    kind: "Plan",
    roleId: PRE_DEV_ROLE_MAP.Plan[0],
    roleTitle: "Product Owner / Product Manager",
    summary: "Onaylı Requirements'tan kimlikli kapsamı (scope), iş paketlerini (workPackages), kilometre taşlarını (milestones) ve kapsam dışını türet.",
    contractFields: ["scope(id,statement)", "workPackages(id,title,dependsOn,estimate,satisfies)", "milestones(id,title,workPackageIds)", "outOfScope"],
    traceabilityRules: [
      "Her workPackage'ın satisfies[] alanı YALNIZ onaylı Requirements içindeki GERÇEK requirement id'lerine referans vermeli.",
      "Her requirement en az bir workPackage tarafından karşılanmalı (tam kapsama); karşılanmayan requirement bırakma.",
      "workPackage dependsOn[] yalnız var olan workPackage id'lerine işaret etmeli ve kendine bağımlılık içermemeli."
    ],
    honestyRules: [NO_FABRICATION, SHAPE_ONLY, MISSING_INFO(ASSUMPTION_SINK.Plan)]
  },
  Architecture: {
    kind: "Architecture",
    roleId: PRE_DEV_ROLE_MAP.Architecture[0],
    roleTitle: "Architect",
    summary: "Onaylı Plan kapsamını kapsayan bileşenleri, teknoloji seçimlerini (gerekçe + değerlendirilen alternatifler), veri modelini, entegrasyonları, altyapı ihtiyaçlarını ve riskleri türet.",
    contractFields: ["components(id,name,responsibility,covers)", "techChoices(choice,rationale,alternativesConsidered)", "dataModel", "integrations", "infraNeeds", "risks"],
    traceabilityRules: [
      "Her component'in covers[] alanı YALNIZ onaylı Plan içindeki GERÇEK scope id'lerine referans vermeli.",
      "Plan kapsamındaki her madde en az bir component tarafından kapsanmalı (kapsamsız scope bırakma)."
    ],
    honestyRules: [NO_FABRICATION, SHAPE_ONLY, MISSING_INFO(ASSUMPTION_SINK.Architecture)]
  },
  UxSpec: {
    kind: "UxSpec",
    roleId: PRE_DEV_ROLE_MAP.UxSpec[0],
    roleTitle: "UX Designer",
    summary: "Onaylı üst artefaktlara dayanarak ekranları, akışları, UI bileşenlerini ve erişilebilirlik notlarını türet.",
    contractFields: ["screens(id,name)", "flows(id,name,steps)", "components(id,name)", "a11yNotes"],
    traceabilityRules: [
      "En az bir ekran bulunmalı; tüm ekran/akış/bileşen id'leri kendi listesinde benzersiz olmalı.",
      "Akışlar ve ekranlar yalnız onaylı Plan/Requirements kapsamındaki yeteneklerden türetilir; kapsam dışı ekran uydurma."
    ],
    honestyRules: [NO_FABRICATION, SHAPE_ONLY, MISSING_INFO(ASSUMPTION_SINK.UxSpec)]
  }
};

export function getRolePrompt(kind: ArtifactKind): RolePromptTemplate { return ROLE_PROMPTS[kind]; }

// //TR: Şablonu + SALT-OKUNUR mission bağlamını (proje özeti + onaylı üst artefaktlar) tek bir prompt metnine dürüstçe birleştirir. Yetkili kaynak malzeme olarak yalnız bu bağlam gömülür; böylece "özette/üstte olmayanı uydurma" kuralı somutlaşır. Saf string birleştirme; ağ/dosya/sır yok.
export function composeRolePrompt(kind: ArtifactKind, missionContext: MissionContext): string {
  const t = ROLE_PROMPTS[kind];
  const upstreamKinds = Object.keys(missionContext.approvedUpstream);
  const lines: string[] = [
    `# ROL: ${t.roleTitle} (${t.roleId}) — CLAUDE_BUILDER`,
    `# ARTEFAKT TÜRÜ: ${t.kind}`,
    "",
    `## GÖREV`,
    t.summary,
    "",
    `## TİPLİ SÖZLEŞME ALANLARI (tam olarak bunlar)`,
    ...t.contractFields.map(f => `- ${f}`),
    "",
    `## İZLENEBİLİRLİK KURALLARI`,
    ...t.traceabilityRules.map(r => `- ${r}`),
    "",
    `## DÜRÜSTLÜK KURALLARI`,
    ...t.honestyRules.map(r => `- ${r}`),
    "",
    `## YETKİLİ KAYNAK — PROJE ÖZETİ (yalnız buradaki gerçekleri kullan)`,
    JSON.stringify(missionContext.brief),
    "",
    `## YETKİLİ KAYNAK — ONAYLI ÜST ARTEFAKTLAR (${upstreamKinds.length ? upstreamKinds.join(", ") : "yok"})`,
    JSON.stringify(missionContext.approvedUpstream),
    "",
    `## ÇIKTI`,
    `Yalnız ${t.kind} tipli sözleşme şekline uyan tek bir JSON nesnesi döndür.`
  ];
  return lines.join("\n");
}
