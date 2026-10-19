export interface LeaseRecord {taskId:string;environment:string;workerId:string;sessionId:string;headSha:string|null;epoch:number;token:string;acquiredAt:number;heartbeatAt:number;expiresAt:number}
export interface LeaseStore {createIfAbsent(taskId:string,record:LeaseRecord):{created:boolean;current:LeaseRecord|null};read(taskId:string):LeaseRecord|null;cas(taskId:string,expected:LeaseRecord,record:LeaseRecord):{ok:boolean;current:LeaseRecord|null};remove(taskId:string,expected:LeaseRecord):{ok:boolean}}
export interface LeaseOwner {taskId:string;environment:string;workerId:string;sessionId:string;token?:string}
export interface ClaimArgs extends LeaseOwner {headSha?:string|null;now:number;ttlMs:number}
export interface RenewArgs {taskId:string;environment:string;workerId:string;sessionId:string;token:string;now:number;ttlMs:number}
export interface ReleaseArgs {taskId:string;environment:string;workerId:string;sessionId:string;token:string}
export function isValidLeaseRecord(record:unknown):record is LeaseRecord;
export function leaseVersion(record:unknown):string|null;
export function isExpired(record:LeaseRecord|null|undefined,now:number):boolean;
export function reclaimableBy(record:LeaseRecord|null|undefined,now:number):boolean;
export function claim(store:LeaseStore,a:ClaimArgs):{status:"GRANTED"|"HELD";record:LeaseRecord|null;previous?:LeaseRecord};
export function renew(store:LeaseStore,a:RenewArgs):{status:"RENEWED"|"LOST";record:LeaseRecord|null};
export function release(store:LeaseStore,a:ReleaseArgs):{status:"RELEASED"|"NOOP"};
