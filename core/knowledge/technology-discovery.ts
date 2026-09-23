// //TR: Bu dosya bir Mission/repo içinde registry'de olmayan teknoloji görüldüğünde model hafızasından tahmin etmek yerine explicit GAP ve controlled acquisition lifecycle üretir.
export type DiscoveryState =
  | "DETECTED" | "IDENTIFIED" | "SOURCE_PINNED" | "RESEARCHED" | "SANDBOXED"
  | "KNOWLEDGE_MODELED" | "EVALUATED" | "INDEPENDENTLY_REVIEWED" | "CERTIFIED" | "REGISTERED" | "ACTIVE";

export interface TechnologyCandidate {
  rawName: string;
  normalizedName?: string;
  state: DiscoveryState;
  sourceRefs: string[];
  missionId: string;
  detectedFrom: string;
}

export interface KnownTechnology {
  id: string;
  name: string;
  aliases: string[];
}

export function findTechnology(
  raw: string,
  known: KnownTechnology[]
): KnownTechnology | undefined {
  const needle=raw.trim().toLowerCase();
  return known.find(t =>
    t.name.toLowerCase()===needle ||
    t.aliases.some(a=>a.toLowerCase()===needle)
  );
}

export function requireKnownOrGap(
  raw: string,
  known: KnownTechnology[],
  missionId: string,
  detectedFrom: string
): KnownTechnology | TechnologyCandidate {
  const found=findTechnology(raw,known);
  if(found) return found;
  return {rawName:raw,state:"DETECTED",sourceRefs:[],missionId,detectedFrom};
}
