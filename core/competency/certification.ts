// //TR: Bu dosya agent/skill/technology bilgisinin REGISTERED'dan CERTIFIED'a kanıtsız atlamasını engelleyen certification lifecycle ve high-risk readiness kontrollerini sağlar.
import {CERTIFICATION_STATES,type CertificationState} from "./types.js";
export {CERTIFICATION_STATES};
export type {CertificationState};

const transitions: Record<CertificationState, CertificationState[]> = {
  REGISTERED:["TRAINING","EVALUATING","RETIRED"],
  TRAINING:["EVALUATING","RETIRED"],
  EVALUATING:["CERTIFIED","REGISTERED","REVOKED"],
  CERTIFIED:["ACTIVE","STALE","REVOKED"],
  ACTIVE:["STALE","RECERTIFICATION","REVOKED","RETIRED"],
  STALE:["RECERTIFICATION","REVOKED","RETIRED"],
  RECERTIFICATION:["ACTIVE","REVOKED","RETIRED"],
  REVOKED:["RECERTIFICATION","RETIRED"],
  RETIRED:[]
};

export function canCertificationTransition(from: CertificationState, to: CertificationState): boolean {
  return transitions[from].includes(to);
}

export function assertHighRiskCompetencyReady(input: {
  skillState: CertificationState;
  technologyState: CertificationState;
  sourceFresh: boolean;
  holdoutPassed: boolean;
  independentReviewPassed: boolean;
}): void {
  const active = new Set<CertificationState>(["CERTIFIED","ACTIVE"]);
  if(!active.has(input.skillState)) throw new Error("Skill is not certified/current");
  if(!active.has(input.technologyState)) throw new Error("Technology knowledge is not certified/current");
  if(!input.sourceFresh) throw new Error("Technology/source knowledge is stale or unverified");
  if(!input.holdoutPassed) throw new Error("Hidden holdout evaluation has not passed");
  if(!input.independentReviewPassed) throw new Error("Independent review is missing");
}
