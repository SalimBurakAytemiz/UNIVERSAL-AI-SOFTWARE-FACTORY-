export interface GlobalStopState {active:boolean;reason?:string;actor?:string;activatedAt?:string;[key:string]:unknown}
export function globalStopState(file:string):GlobalStopState|null;
export function assertNotStopped(file:string):void;
export function activateGlobalStop(file:string,reason?:string,actor?:string):void;
export function clearGlobalStop(file:string,actor?:string):{active:false;clearedAt:string;actor:string};
