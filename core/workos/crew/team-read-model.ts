// //TR: Bu dosya Agent Team Composer'ın önerdiği ekip için SAF (pure) bir okuma-modeli/özet üretir: önerilen rolleri guild ve cluster bazında sayılarla, gerekçelerle (rationale) ve boşluklarla (gaps) dürüst biçimde gruplar. Bu özet sonradan Desktop'ta GÖSTERIM içindir ama burada HIÇBIR Desktop/control-api KODU kurulmaz; yalnız salt-veri bir görünümdür. Yan etki, model/ağ/shell YOKTUR. Dürüstlük: özet N canlı ajan ya da certified worker İMA ETMEZ; sayılar rol TANIMI sayısıdır ve liveAgentCount/certifiedWorkerCount sabit 0 taşınır.
import {FIRST_DELIVERY_BINDINGS} from "../../agents/first-delivery-bindings.js";
import {profileDefect} from "../../agents/role-execution.js";
import type {NotExecutableReason} from "../../agents/role-execution.js";
import type {ProposedTeam, RoleCatalog, RoleSelection, CapabilityGap} from "./team-composer.js";

// //TR: Bir guild altındaki önerilen roller: guildId + (katalogdan gelen) ad + clusterId + rol kimlikleri + sayı.
export interface GuildTeamSummary {
  readonly guildId: string;
  readonly guildName: string;
  readonly clusterId: string;
  readonly roleIds: readonly string[];
  readonly count: number;
}
// //TR: Bir cluster altındaki önerilen roller: clusterId + ad + o cluster'daki önerilen guild sayısı + rol sayısı.
export interface ClusterTeamSummary {
  readonly clusterId: string;
  readonly clusterName: string;
  readonly guildCount: number;
  readonly roleCount: number;
}
// //TR: Önerilen bir rol TANIMININ yürütülebilirlik durumu (canlı ajan DEĞİL, sertifika DEĞİL): tam bağlaması varsa EXECUTABLE, yoksa sabit neden kodlu NOT_EXECUTABLE.
export interface RoleExecutability {
  readonly roleId: string;
  readonly status: "EXECUTABLE" | "NOT_EXECUTABLE";
  readonly reason?: NotExecutableReason;
}
// //TR: Tam özet görünümü. byGuild/byCluster kararlı (kimliğe göre sıralı) gruplardır. selections/gaps composer çıktısından aynen taşınır. honestyNotice ve 0 sayaçlar çıktının bir ÖNERI olduğunu (aktivasyon değil) ve canlı ajan/certified worker ima etmediğini korur.
export interface TeamSummary {
  readonly projectName: string;
  readonly isReference: boolean;
  readonly advisory: true;
  readonly totalProposedRoleDefinitions: number;
  readonly liveAgentCount: 0;
  readonly certifiedWorkerCount: 0;
  readonly byCluster: readonly ClusterTeamSummary[];
  readonly byGuild: readonly GuildTeamSummary[];
  readonly executability: readonly RoleExecutability[];
  readonly executableRoleDefinitionCount: number;
  readonly selections: readonly RoleSelection[];
  readonly gaps: readonly CapabilityGap[];
  readonly honestyNotice: string;
}

// //TR: Önerilen ekibi guild/cluster bazında SAF biçimde özetler. Guild/cluster adları SALT-OKUNUR katalogdan alınır (bilinmiyorsa dürüstçe "UNKNOWN_GUILD:<id>" / "UNKNOWN_CLUSTER:<id>" yazılır, uydurma ad üretilmez). Deterministik: tüm gruplar kimliğe göre sıralanır ve girdi çıktıyı birebir belirler.
export function summarizeProposedTeam(team: ProposedTeam, catalog: RoleCatalog): TeamSummary {
  const guildName = new Map<string, string>();
  for (const g of catalog.guilds) guildName.set(g.guildId, g.name);
  const clusterName = new Map<string, string>();
  for (const c of catalog.clusters) clusterName.set(c.clusterId, c.name);

  // guildId -> {clusterId, roleIds}
  const byGuildMap = new Map<string, {clusterId: string; roleIds: string[]}>();
  // clusterId -> {guilds:Set, roleCount}
  const byClusterMap = new Map<string, {guilds: Set<string>; roleCount: number}>();
  for (const sel of team.selections) {
    const g = byGuildMap.get(sel.guildId) ?? {clusterId: sel.clusterId, roleIds: []};
    g.roleIds.push(sel.roleId); byGuildMap.set(sel.guildId, g);
    const c = byClusterMap.get(sel.clusterId) ?? {guilds: new Set<string>(), roleCount: 0};
    c.guilds.add(sel.guildId); c.roleCount++; byClusterMap.set(sel.clusterId, c);
  }

  const byGuild: GuildTeamSummary[] = [...byGuildMap.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    .map(([guildId, v]) => ({
      guildId,
      guildName: guildName.get(guildId) ?? `UNKNOWN_GUILD:${guildId}`,
      clusterId: v.clusterId,
      roleIds: [...v.roleIds].sort(),
      count: v.roleIds.length
    }));
  const byCluster: ClusterTeamSummary[] = [...byClusterMap.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    .map(([clusterId, v]) => ({
      clusterId,
      clusterName: clusterName.get(clusterId) ?? `UNKNOWN_CLUSTER:${clusterId}`,
      guildCount: v.guilds.size,
      roleCount: v.roleCount
    }));

  const executability: RoleExecutability[] = team.selections.map(sel => {
    const b = FIRST_DELIVERY_BINDINGS.find(x => x.roleId === sel.roleId);
    if (!b) return {roleId: sel.roleId, status: "NOT_EXECUTABLE", reason: "ROLE_HAS_NO_BINDING"};
    const d = profileDefect(b);
    return d ? {roleId: sel.roleId, status: "NOT_EXECUTABLE", reason: d.reason} : {roleId: sel.roleId, status: "EXECUTABLE"};
  });
  return {
    projectName: team.projectName,
    isReference: team.isReference,
    advisory: true,
    totalProposedRoleDefinitions: team.proposedRoleDefinitionCount,
    liveAgentCount: 0,
    certifiedWorkerCount: 0,
    byCluster,
    byGuild,
    executability,
    executableRoleDefinitionCount: executability.filter(e => e.status === "EXECUTABLE").length,
    selections: team.selections,
    gaps: team.gaps,
    honestyNotice: team.honestyNotice
  };
}
