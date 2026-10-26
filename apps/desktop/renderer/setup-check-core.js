// //TR: Bu modül Ayarlar > "Hazır mı?" Founder kurulum denetiminin saf (DOM'suz) çekirdeğidir (A-SETUP-1): yalnız GET /v1/system/executors okumasından (mapExecutors: LOCAL_CLAUDE.cli, readiness.{implementer,reviewer}, claudeProfiles, sandbox) altı satır türetir: Claude CLI, Local Claude yürütücüsü, implementer oturumu, reviewer oturumu, test sandbox'ı, çalışan ürün (köprü). Her satır PASS, BLOCKED (kesin kodlarla) ya da UNKNOWN (veri yok/okunamadı) olur; API'nin bildirmediği hiçbir şey PASS sayılmaz, hiçbir komut çalıştırılmaz ya da ayar değiştirilmez.
export const SETUP_ROWS=Object.freeze(["CLI","EXECUTOR","IMPLEMENTER","REVIEWER","SANDBOX","PRODUCT"]);
export const SETUP_STATES=Object.freeze(["PASS","BLOCKED","UNKNOWN"]);
export const ACCEPTANCE_COMMAND="node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu";
const local=exec=>(exec&&Array.isArray(exec.items)?exec.items.find(i=>i&&i.id==="LOCAL_CLAUDE"):null)??null;
const row=(id,state,reasons=[],extra={})=>({id,state,reasons,login:null,providerId:null,note:null,...extra});

// //TR: CLI/başlatıcı satırı: iki rolün hazırlık okumasında CLAUDE_PROFILE_ ile BAŞLAMAYAN her engelleyici (CLAUDE_CLI_NOT_FOUND, CLAUDE_CLI_SHIM_UNSUPPORTED, başlatıcı kanıtı kodları, ...) bu satırı BLOCKED yapar; böylece sunucunun eklediği yeni bir CLI/başlatıcı kodu da gözden kaçmaz. İki rol de okunmuş ve böyle bir engelleyici yoksa PASS'tır (cli.state yalnız PATH'te bulunamadığını söyleyebilir: bu ayrıntı not olarak kalır). Hazırlık okuması yoksa cli.state'e düşülür.
function cliRow(exec){
  const lc=local(exec),cli=lc?lc.cli:null,rd=exec.readiness;
  const roles=rd?[rd.implementer,rd.reviewer].filter(Boolean):[];
  // //TR: Rol engelleyicilerinden yalnız CLI/başlatıcıya ait olanlar CLI satırına girer: oturum kodları (CLAUDE_PROFILE_*) oturum satırlarına, EXECUTOR_NOT_ENABLED (sunucu bunu her rolün sonuna ekler) YÜRÜTÜCÜ satırına aittir.
  const blockers=[...new Set(roles.flatMap(r=>r.blockers.filter(b=>!b.startsWith("CLAUDE_PROFILE_")&&b!=="EXECUTOR_NOT_ENABLED")))];
  if(blockers.length)return row("CLI","BLOCKED",blockers);
  if(roles.length===2)return row("CLI","PASS",[],{note:cli&&(cli.state==="NOT_FOUND"||cli.state==="SHIM_UNSUPPORTED")?cli.state:null});
  if(cli&&cli.state==="NOT_FOUND")return row("CLI","BLOCKED",["CLAUDE_CLI_NOT_FOUND"]);
  if(cli&&cli.state==="SHIM_UNSUPPORTED")return row("CLI","BLOCKED",["CLAUDE_CLI_SHIM_UNSUPPORTED"]);
  if(!cli)return row("CLI","UNKNOWN",["CLI_STATUS_NOT_REPORTED"]);
  return row("CLI","UNKNOWN",["LAUNCHER_PROOF_NOT_REPORTED"]);
}
// //TR: Yürütücü satırı: sunucunun KULLANDIĞI yürütücü (active.reason) ya da LOCAL_CLAUDE.state; Local Claude etkin değilse (EXECUTOR_NOT_CONFIGURED / NOT_CONFIGURED) motor çalışmaz: BLOCKED EXECUTOR_NOT_ENABLED.
function executorRow(exec){
  const lc=local(exec),active=typeof exec.active==="string"?exec.active:null,st=lc?lc.state:null;
  if(active==="LOCAL_CLAUDE")return row("EXECUTOR","PASS");
  if(active!==null)return row("EXECUTOR","BLOCKED",[active==="EXECUTOR_NOT_CONFIGURED"?"EXECUTOR_NOT_ENABLED":active]);
  if(st===null)return row("EXECUTOR","UNKNOWN",["EXECUTOR_STATUS_NOT_REPORTED"]);
  if(st==="READY")return row("EXECUTOR","UNKNOWN",["ACTIVE_EXECUTOR_NOT_REPORTED"]);
  return row("EXECUTOR","BLOCKED",["EXECUTOR_NOT_ENABLED"]);
}
function signInRow(exec,role){
  const id=role==="implementer"?"IMPLEMENTER":"REVIEWER";
  const p=(Array.isArray(exec.profiles)?exec.profiles:[]).find(x=>x&&x.role===role)??null,x=exec.readiness?exec.readiness[role]??null:null;
  const state=p?p.state:(x?x.profile:null);
  if(!p&&!x)return row(id,"UNKNOWN",["PROFILE_STATUS_NOT_REPORTED"]);
  if(state===null)return row(id,"UNKNOWN",["PROFILE_STATE_UNRECOGNISED"]);
  const own=x?x.blockers.filter(b=>b.startsWith("CLAUDE_PROFILE_")):[];
  const cmd=(p&&p.loginCommand)||(x&&x.loginCommand)||null;
  if(state==="READY"&&own.length===0)return row(id,"PASS");
  if(state==="READY")return row(id,"BLOCKED",own,{login:cmd});
  if(state==="LOGIN_REQUIRED")return row(id,"BLOCKED",own.length?own:["CLAUDE_PROFILE_LOGIN_REQUIRED"],{login:cmd});
  if(state==="REFUSED"){const r=own.find(b=>b.startsWith("CLAUDE_PROFILE_REFUSED"))??(p&&p.reason?`CLAUDE_PROFILE_REFUSED:${p.reason}`:"CLAUDE_PROFILE_REFUSED");return row(id,"BLOCKED",[r])}
  return row(id,"BLOCKED",[`CLAUDE_PROFILE_STATE:${state}`]);
}
function sandboxRow(exec){
  const sb=exec.sandbox;
  if(!sb)return row("SANDBOX","UNKNOWN",["SANDBOX_STATUS_NOT_REPORTED"]);
  if(sb.state==="AVAILABLE")return row("SANDBOX","PASS",[],{providerId:sb.providerId});
  return row("SANDBOX","BLOCKED",[sb.reason??"SANDBOX_UNAVAILABLE",...(sb.detail?[sb.detail]:[])]);
}
function productRow(exec){
  const sb=exec.sandbox;
  if(!sb)return row("PRODUCT","UNKNOWN",["SANDBOX_STATUS_NOT_REPORTED"]);
  if(sb.state!=="AVAILABLE")return row("PRODUCT","BLOCKED",["SANDBOX_UNAVAILABLE"]);
  return row("PRODUCT","UNKNOWN",["BRIDGE_NOT_TESTED"]);
}
/** exec: ctx.api.executors() sonucu. Okuma yoksa tüm satırlar UNKNOWN. */
export function buildSetupChecks(exec){
  const readable=Boolean(exec)&&exec.state==="VERIFIED";
  const rows=readable?[cliRow(exec),executorRow(exec),signInRow(exec,"implementer"),signInRow(exec,"reviewer"),sandboxRow(exec),productRow(exec)]:SETUP_ROWS.map(id=>row(id,"UNKNOWN",["EXECUTOR_STATUS_UNREADABLE"]));
  const count=s=>rows.filter(r=>r.state===s).length,pass=count("PASS"),blocked=count("BLOCKED"),unknown=count("UNKNOWN");
  return {readable,rows,pass,blocked,unknown,kind:blocked>0?"BLOCKED":unknown>0?"UNKNOWN":"ALL_PASS"};
}
