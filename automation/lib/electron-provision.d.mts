export const ELECTRON_CACHE_DIR:string;
export interface ElectronTarget {version:string;platform:string;arch:string;artifact:string;expectedSha256:string;url:string;dir:string;distDir:string;archiveFile:string;exe:string;exePath:string;manifestFile:string}
export interface ZipEntry {name:string;isDirectory:boolean;method:number;csize:number;usize:number;localOffset:number}
export function fileSha256(file:string):string;
export function electronTarget(root:string,options?:{platform?:string;arch?:string}):ElectronTarget;
export function allowedDownloadUrl(raw:unknown):boolean;
export function readZipEntries(zipPath:string):ZipEntry[];
export function verifyProvisionedElectron(root:string,options?:{platform?:string;arch?:string;assertSeal?:(root:string)=>unknown}):Promise<string>;
