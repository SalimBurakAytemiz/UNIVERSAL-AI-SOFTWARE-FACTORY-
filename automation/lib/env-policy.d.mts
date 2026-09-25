export interface SafeChildEnvOptions {provider?:string;allowPaidApi?:boolean;denyNetworkOverrides?:boolean}
export function safeChildEnv(policyFile?:string,options?:SafeChildEnvOptions):Record<string,string>;
