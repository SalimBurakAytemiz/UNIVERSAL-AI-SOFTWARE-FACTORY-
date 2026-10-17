export type VerdictResult="CLEAN"|"BLOCKED"|"INCONCLUSIVE"|"INVALID";
export interface LeaseVerdict {readonly taskId:string;readonly reviewedSha:string;readonly reviewerSessionId:string;readonly implementerSessionId:string;readonly result:VerdictResult;readonly reviewerIdentity:string;readonly builderIdentity:string}
export const VERDICT_RESULTS:readonly VerdictResult[];
export function bindVerdict(v:{taskId:string;reviewedSha:string;reviewerSessionId:string;implementerSessionId:string;result:string;reviewerIdentity:string;builderIdentity:string}):LeaseVerdict;
export function verifyVerdict(verdict:LeaseVerdict|null|undefined,o:{expectedHeadSha:string;implementerSessionId?:string}):{ok:boolean;reason:string};
