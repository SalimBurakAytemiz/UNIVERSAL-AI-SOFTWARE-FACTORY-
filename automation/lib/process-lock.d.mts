export interface ProcessLockInspection {state:string;active:boolean;stale:boolean;pid?:number;hostname?:string;runId?:string|null}
export function inspectProcessLock(file:string):ProcessLockInspection;
export function clearStaleProcessLock(file:string):{cleared:boolean;state:string};
export function acquireProcessLock(file:string,runId:string):()=>void;
