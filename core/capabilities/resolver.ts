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

// //TR: C-RDY-2a: sağlık bilgisi çağıranın verdiği bir boolean'dan DEĞİL, kod destekli adaptör gerçeklik haritasından gelir (core/capabilities/adapter-reality.ts): bir araç YALNIZ haritada kodu doğrulanmış (PRESENT) VE yoklaması gözlenmiş (READY) ise sağlıklıdır. Kayıt defterinin implementation alanı okunmaz; haritada kaydı olmayan araç sağlıksızdır. Yapısal tip kullanılır (ajan modüllerine bağımlılık yok).
export interface AdapterRealityLike { codePath: "PRESENT" | "ABSENT"; probe: "READY" | "FAILED" | "NOT_OBSERVED" }
export function resolveCapabilityFromReality(
  capability: string,
  tools: readonly Omit<ToolAdapterRecord, "healthy">[],
  resources: ResourceCandidate[],
  reality: ReadonlyMap<string, AdapterRealityLike>
): { tools: Omit<ToolAdapterRecord, "healthy">[]; resources: ResourceCandidate[] } {
  return {
    tools: tools.filter(t => { const e = reality.get(t.id); return e !== undefined && e.codePath === "PRESENT" && e.probe === "READY" && t.capabilities.includes(capability); }),
    resources: resources.filter(r => r.ready && r.capabilities.includes(capability))
  };
}
