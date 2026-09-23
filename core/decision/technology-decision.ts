// //TR: Bu dosya teknoloji adaylarını mission-specific kriterlerle kanıtlı olarak karşılaştırmak için temel decision record ve weighted evidence hesaplama sözleşmesini sağlar; otomatik nihai karar değildir.
export interface CriterionEvidence { criterionId:string; weight:number; score:number; evidenceRefs:string[]; uncertainty?:string }
export interface TechnologyCandidate { id:string; name:string; criteria:CriterionEvidence[]; risks:string[]; exitStrategy:string }
export function weightedEvidenceScore(candidate: TechnologyCandidate): number {
  const den=candidate.criteria.reduce((s,c)=>s+c.weight,0); if(!den) return 0;
  return candidate.criteria.reduce((s,c)=>s+c.weight*c.score,0)/den;
}
