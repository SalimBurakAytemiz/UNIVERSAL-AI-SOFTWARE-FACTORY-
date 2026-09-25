export interface NpmInvocation {command:string;prefixArgs:string[];mode:"PATH_NPM"|"NODE_BUNDLED_NPM_CLI"}
export interface NpmInvocationOptions {platform?:string;execPath?:string;lstatSync?:(p:string)=>{isFile():boolean}}
export function resolveNpmInvocation(options?:NpmInvocationOptions):NpmInvocation;
export function npmSpawnArgs(args:string[],options?:NpmInvocationOptions):{command:string;args:string[]};
