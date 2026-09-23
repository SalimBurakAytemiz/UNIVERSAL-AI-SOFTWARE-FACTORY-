export function dependencyState(root:string):{lockSha256:string;packageSha256:string};
export function ensureDependencies(root:string,options?:{npmCommand?:string;cacheDir?:string|null;preferOffline?:boolean;spawnSync?:Function}):{mode:string;lockSha256:string;packageSha256:string};
