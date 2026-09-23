// //TR: Bu dosya teknoloji adaylarını mission-specific kriterlerle kanıtlı olarak karşılaştırmak için temel decision record ve weighted evidence hesaplama sözleşmesini sağlar; otomatik nihai karar değildir.
export interface CriterionEvidence { criterionId:string; weight:number; score:number; evidenceRefs:string[]; uncertainty?:string }
export interface TechnologyCandidate { id:string; name:string; criteria:CriterionEvidence[]; risks:string[]; exitStrategy:string }
const nonEmpty=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>0;
export function weightedEvidenceScore(candidate: TechnologyCandidate): number {
  if(!candidate||!nonEmpty(candidate.id)||!nonEmpty(candidate.name))throw new Error("Technology candidate identity invalid");
  if(!Array.isArray(candidate.criteria))throw new Error("Technology criteria invalid");
  const seen=new Set<string>();
  for(const c of candidate.criteria){
    if(!nonEmpty(c.criterionId)||seen.has(c.criterionId))throw new Error("Technology criterion identity invalid or duplicate");seen.add(c.criterionId);
    if(!Number.isFinite(c.weight)||c.weight<=0)throw new Error("Technology criterion weight must be positive and finite");
    if(!Number.isFinite(c.score))throw new Error("Technology criterion score must be finite");
    if(!Array.isArray(c.evidenceRefs)||c.evidenceRefs.some(x=>!nonEmpty(x)))throw new Error("Technology criterion evidenceRefs invalid");
  }
  if(candidate.criteria.length===0)return 0;
  const den=candidate.criteria.reduce((s,c)=>s+c.weight,0);if(!Number.isFinite(den)||den<=0)throw new Error("Technology criterion denominator invalid");
  const numerator=candidate.criteria.reduce((s,c)=>s+c.weight*c.score,0);if(!Number.isFinite(numerator))throw new Error("Technology weighted score overflow/non-finite");
  const result=numerator/den;if(!Number.isFinite(result))throw new Error("Technology weighted score invalid");return result;
}
