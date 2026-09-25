import type {SpawnSyncOptions,SpawnSyncReturns} from "node:child_process";
export function isolatedGitEnv(baseEnv?:NodeJS.ProcessEnv):NodeJS.ProcessEnv;
export function isolatedGitArgs(args:string[]):string[];
export function spawnGitSync(cwd:string,args:string[],options?:SpawnSyncOptions):SpawnSyncReturns<string>;
export function gitIsolationDescriptor():{globalConfig:string;systemConfig:string;hooks:string};
