// //TR: Bu dosya agent technical genome, skill depth, certification ve review zincirinin canonical runtime type sözleşmesini tanımlar.
export type SkillDepth="AWARENESS"|"WORKING"|"ADVANCED_EXECUTION"|"PRINCIPAL_REVIEW"|"PRINCIPAL_DECISION";
export const CERTIFICATION_STATES=["REGISTERED","TRAINING","EVALUATING","CERTIFIED","ACTIVE","STALE","RECERTIFICATION","REVOKED","RETIRED"] as const;
export type CertificationState=(typeof CERTIFICATION_STATES)[number];
export interface AgentTechnicalGenome { agentId:string; competencyPackId:string; requiredSkillIds:string[]; requiredDepth:SkillDepth; allowedToolAdapterIds:string[]; technicalStandardIds:string[]; departmentHeadAgentId:string; reviewedByAgentIds:string[]; decisionRights:string[]; }
