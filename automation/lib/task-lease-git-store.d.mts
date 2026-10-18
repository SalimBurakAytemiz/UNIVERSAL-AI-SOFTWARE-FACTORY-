import type {LeaseStore} from "./task-lease.mjs";
export interface GitResult {status:number;stdout:string;stderr?:string}
export function createLocalGitRefStore(o:{repoDir:string;refPrefix?:string}):LeaseStore;
export function createRemoteRefStore(o:{runGit:(args:string[],input?:string)=>GitResult;remote?:string;refPrefix?:string}):LeaseStore;
