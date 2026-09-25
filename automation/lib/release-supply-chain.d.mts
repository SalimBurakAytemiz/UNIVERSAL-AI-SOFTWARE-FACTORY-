import type {HostPlatform} from "./supply-chain.mjs";
export interface ReleaseSupplyChainOptions {supplyFile?:string;sbomFile?:string;noticesFile?:string;host?:HostPlatform}
export function validateReleaseSupplyChain(root?:string,options?:ReleaseSupplyChainOptions):{ok:boolean;errors:string[];components:any[];platformOptionalComponents:any[];[key:string]:unknown};
export function writeReleaseSupplyChainEvidence(root?:string,options?:ReleaseSupplyChainOptions):any;
