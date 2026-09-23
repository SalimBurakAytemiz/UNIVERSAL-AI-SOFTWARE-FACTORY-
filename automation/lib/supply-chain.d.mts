export function validateSupplyChain(root?:string,policyFile?:string,options?:{requireInstalled?:boolean}):{ok:boolean;errors:string[];lockSha256:string;packageSha256:string;components:any[];policy:any};
export function evaluateAuditDocument(doc:any,blockingSeverities?:string[]):{blockers:any[];low:any[]};
