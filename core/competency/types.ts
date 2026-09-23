// //TR: Bu dosya agent technical genome, skill depth, certification ve review zincirinin runtime type sözleşmesini tanımlar.
export type SkillDepth="AWARENESS"|"WORKING"|"ADVANCED_EXECUTION"|"PRINCIPAL_REVIEW"|"PRINCIPAL_DECISION";
export type CertificationState="REGISTERED"|"TRAINING"|"EVALUATION"|"CERTIFIED"|"ACTIVE"|"STALE"|"RECERTIFICATION"|"RETIRED";
export interface AgentTechnicalGenome { agentId:string; competencyPackId:string; requiredSkillIds:string[]; requiredDepth:SkillDepth; allowedToolAdapterIds:string[]; technicalStandardIds:string[]; departmentHeadAgentId:string; reviewedByAgentIds:string[]; decisionRights:string[]; }
