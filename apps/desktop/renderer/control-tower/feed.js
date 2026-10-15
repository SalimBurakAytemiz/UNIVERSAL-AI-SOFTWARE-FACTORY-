// //TR: Bu modül kabuğun gerçek okuma modelini (cockpit.globalStop veya /v1/control/status, /v1/roles sayfaları, /v1/work-runs) Control Tower kampüs modelinin girdisine çevirir; kaynak yoksa null verir ve hiçbir sayı, ad veya atama uydurmaz (lonca/küme adı katalogda yoksa kimliktir, run yalnız rol kimliği kayıtlı bir loncaya ait olduğunda binaya atanır).

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Global stop: önce cockpit (boolean active biliniyorsa), sonra /v1/control/status; ikisi de yoksa null (UNAVAILABLE). */
export function globalStopSource(cockpit, control) {
  const g = cockpit && cockpit.data && cockpit.data.globalStop;
  if (g && g.known === true) return { globalStop: { active: g.active === true, reason: g.reason ?? null } };
  if (control && control.state === "VERIFIED") return { globalStop: { active: control.active === true, reason: control.reason ?? null } };
  return null;
}

/** Rol listesinden katalog: küme/lonca kimlikleri ve lonca başına kayıtlı rol sayısı (hedef kapasite); liste VERIFIED değilse veya boşsa null. */
export function catalogFromRoles(roles) {
  if (!roles || roles.state !== "VERIFIED" || !Array.isArray(roles.items) || roles.items.length === 0) return null;
  const clusters = new Map();
  const guilds = new Map();
  const counts = {};
  for (const r of roles.items) {
    clusters.set(r.clusterId, { clusterId: r.clusterId, name: r.clusterId });
    if (!guilds.has(r.guildId)) guilds.set(r.guildId, { guildId: r.guildId, name: r.guildId, clusterId: r.clusterId });
    counts[r.guildId] = (counts[r.guildId] ?? 0) + 1;
  }
  return {
    clusters: [...clusters.values()].sort((a, b) => cmp(a.clusterId, b.clusterId)),
    guilds: [...guilds.values()].sort((a, b) => cmp(a.guildId, b.guildId)),
    roles: counts
  };
}

/** work-runs listesinden run girdisi; rol kimliği kayıtlı bir loncaya eşleniyorsa guildId verilir, aksi halde null (tahmin yok). Liste VERIFIED değilse null. */
export function runsFromWorkRuns(workRuns, roles) {
  if (!workRuns || workRuns.state !== "VERIFIED" || !Array.isArray(workRuns.items)) return null;
  const guildOf = new Map();
  if (roles && roles.state === "VERIFIED" && Array.isArray(roles.items)) for (const r of roles.items) guildOf.set(r.roleId, r.guildId);
  return workRuns.items.map((x) => ({
    runId: x.runId,
    missionId: x.missionId ?? null,
    status: x.status,
    roleId: x.role ?? null,
    guildId: (x.role && guildOf.get(x.role)) || null
  }));
}

export function buildCampusInput({ cockpit, control, roles, workRuns }) {
  return { cockpit: globalStopSource(cockpit, control), catalog: catalogFromRoles(roles), runs: runsFromWorkRuns(workRuns, roles) };
}
