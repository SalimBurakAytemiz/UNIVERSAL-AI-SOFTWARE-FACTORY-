export interface HostPlatform {platform:string;arch:string;libc:"glibc"|"musl"|null}
export interface PlatformConstraints {os?:string[]|null;cpu?:string[]|null;libc?:string[]|null}
export function validateSupplyChain(root?:string,policyFile?:string,options?:{requireInstalled?:boolean}):{ok:boolean;errors:string[];lockSha256:string;packageSha256:string;components:any[];policy:any};
export function evaluateAuditDocument(doc:any,blockingSeverities?:string[]):{blockers:any[];low:any[]};
export function hostPlatform(options?:{platform?:string;arch?:string;report?:()=>any}):HostPlatform;
export function platformExcludesHost(constraints:PlatformConstraints|null|undefined,host:HostPlatform):boolean;
