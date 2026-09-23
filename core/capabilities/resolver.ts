// //TR: Bu dosya Mission'ın istediği capability'yi sağlayabilecek tool adapter ve execution resource adaylarını ortak sözleşmeyle eşleştiren temel resolver'ı sağlar.
export interface ToolAdapterRecord {
  id: string;
  category: string;
  capabilities: string[];
  healthy: boolean;
}
export interface ResourceCandidate {
  id: string;
  capabilities: string[];
  ready: boolean;
}

export function resolveCapability(
  capability: string,
  tools: ToolAdapterRecord[],
  resources: ResourceCandidate[]
): { tools: ToolAdapterRecord[]; resources: ResourceCandidate[] } {
  return {
    tools: tools.filter(t => t.healthy && t.capabilities.includes(capability)),
    resources: resources.filter(r => r.ready && r.capabilities.includes(capability))
  };
}
