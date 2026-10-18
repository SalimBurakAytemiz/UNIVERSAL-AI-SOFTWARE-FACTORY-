// //TR: UI-197 Uzman Rol Taksonomisi saf çekirdeği: yalnız GET /v1/roles öğelerindeki mevcut alanlardan (clusterId, guildId, proficiencyStatus) küme->lonca ağacı ve sayılar türetilir; "genom" alanı uydurulmaz, ağ/yazma yoktur; sıralama deterministiktir (kimliğe göre, yerel ayardan bağımsız).
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function buildTaxonomy(items){
  const clusters=new Map();
  for(const it of Array.isArray(items)?items:[]){
    if(!it||typeof it.clusterId!=="string"||typeof it.guildId!=="string")continue;
    let c=clusters.get(it.clusterId);
    if(!c){c={clusterId:it.clusterId,roles:0,certified:0,guilds:new Map()};clusters.set(it.clusterId,c)}
    let g=c.guilds.get(it.guildId);
    if(!g){g={guildId:it.guildId,roles:0,certified:0};c.guilds.set(it.guildId,g)}
    const cert=it.proficiencyStatus==="CERTIFIED"?1:0;
    c.roles++;g.roles++;c.certified+=cert;g.certified+=cert;
  }
  const list=[...clusters.values()].sort((a,b)=>cmp(a.clusterId,b.clusterId)).map(c=>({clusterId:c.clusterId,roles:c.roles,certified:c.certified,guilds:[...c.guilds.values()].sort((a,b)=>cmp(a.guildId,b.guildId))}));
  return {clusters:list,clusterCount:list.length,guildCount:list.reduce((n,c)=>n+c.guilds.length,0),roleCount:list.reduce((n,c)=>n+c.roles,0)};
}
