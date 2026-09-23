export function appendControlAudit(file:string,event:string,details?:Record<string,unknown>,options?:{maxBytes?:number;maxBackups?:number;maxEventBytes?:number}):unknown;
export function readUtf8Tail(file:string,maxBytes?:number):{text:string;truncated:boolean};
export function readJsonlTail(file:string,options?:{maxEvents?:number;maxBytes?:number}):{events:unknown[];truncated:boolean};
