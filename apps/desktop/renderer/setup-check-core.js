// //TR: Bu modül Ayarlar > "Hazır mı?" Founder kurulum denetiminin saf (DOM'suz) çekirdeğidir (A-SETUP-1): yalnız GET /v1/system/executors okumasından (mapExecutors: LOCAL_CLAUDE.cli, readiness.{implementer,reviewer}, claudeProfiles, sandbox) beş satır türetir: Claude CLI, implementer oturumu, reviewer oturumu, test sandbox'ı, çalışan ürün (köprü). Her satır PASS, BLOCKED (kesin kodlarla) ya da UNKNOWN (veri yok/okunamadı) olur; API'nin bildirmediği hiçbir şey PASS sayılmaz, hiçbir komut çalıştırılmaz ya da ayar değiştirilmez.
export const SETUP_ROWS=Object.freeze(["CLI","IMPLEMENTER","REVIEWER","SANDBOX","PRODUCT"]);
export const SETUP_STATES=Object.freeze(["PASS","BLOCKED","UNKNOWN"]);
export const ACCEPTANCE_COMMAND="node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu";
const LAUNCHER_CODES=Object.freeze(["PROVIDER_PROVENANCE_NOT_READY","CLAUDE_PACKAGE_PROVENANCE_REQUIRED","CLAUDE_LAUNCHER_PROVENANCE_CHANGED"]);
const local=exec=>(exec&&Array.isArray(exec.items)?exec.items.find(i=>i&&i.id==="LOCAL_CLAUDE"):null)??null;
const row=(id,state,reasons=[],extra={})=>({id,state,reasons,login:null,providerId:null,...extra});

function cliRow(exec){
  const lc=local(exec),cli=lc?lc.cli:null,rd=exec.readiness;
  if(!cli)return row("CLI","UNKNOWN",["CLI_STATUS_NOT_REPORTED"]);
  if(cli.state==="NOT_FOUND")return row("CLI","BLOCKED",["CLAUDE_CLI_NOT_FOUND"]);
  if(cli.state==="SHIM_UNSUPPORTED")return row("CLI","BLOCKED",["CLAUDE_CLI_SHIM_UNSUPPORTED"]);
  if(!rd||!rd.implementer||!rd.reviewer)return row("CLI","UNKNOWN",["LAUNCHER_PROOF_NOT_REPORTED"]);
  const codes=LAUNCHER_CODES.filter(c=>rd.implementer.blockers.includes(c)||rd.reviewer.blockers.includes(c));
  return codes.length?row("CLI","BLOCKED",codes):row("CLI","PASS");
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
/** exec: ctx.api.executors() sonucu. Okuma yoksa beş satır da UNKNOWN. */
export function buildSetupChecks(exec){
  const readable=Boolean(exec)&&exec.state==="VERIFIED";
  const rows=readable?[cliRow(exec),signInRow(exec,"implementer"),signInRow(exec,"reviewer"),sandboxRow(exec),productRow(exec)]:SETUP_ROWS.map(id=>row(id,"UNKNOWN",["EXECUTOR_STATUS_UNREADABLE"]));
  const count=s=>rows.filter(r=>r.state===s).length,pass=count("PASS"),blocked=count("BLOCKED"),unknown=count("UNKNOWN");
  return {readable,rows,pass,blocked,unknown,kind:blocked>0?"BLOCKED":unknown>0?"UNKNOWN":"ALL_PASS"};
}
