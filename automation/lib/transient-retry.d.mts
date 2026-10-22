export interface RetryAttemptResult {ok:boolean;transient?:boolean;message?:string;[key:string]:unknown}
export interface RetryOptions {maxAttempts?:number;backoffMs?:readonly number[];sleep?:(ms:number)=>Promise<void>;onRetry?:(result:RetryAttemptResult,attempt:number,maxAttempts:number,waitMs:number)=>void}
export const DEFAULT_MAX_ATTEMPTS:number;
export const DEFAULT_BACKOFF_MS:readonly number[];
export function retryTransient<T extends RetryAttemptResult>(attempt:(n:number)=>T|Promise<T>,options?:RetryOptions):Promise<T&{attempts:number}>;
