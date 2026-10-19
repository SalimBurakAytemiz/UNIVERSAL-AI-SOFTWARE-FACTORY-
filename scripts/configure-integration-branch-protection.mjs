// //TR: Bu target-machine helper, integration dalını (varsayılan v7/integration) merge-gate ile korur: zorunlu CI kontrolleri (validate ubuntu + windows) strict modda geçmeden, pending/failed/cancelled iken veya dal base'in gerisindeyken merge IMKANSIZ olur; enforce_admins=true olduğundan admin dahi atlayamaz. required_status_checks=null bırakan main-only configure-github-protection.mjs açığını kapatır (PR #9 Windows CI bitmeden merge edilmişti). Uygulama gh CLI + admin yetkisi ister; başarısızsa dal LOCAL_ONLY korumasında kalır ve merge-gate Local merge-via-gate.mjs sorumluluğundadır. Testleri/timeout'u/güvenlik kurallarını ZAYIFLATMAZ; yalnız kapıyı ekler.
import fs from "node:fs";import cp from "node:child_process";import {githubCliEnv,redactCliText} from "../automation/lib/github-cli-env.mjs";
const env=githubCliEnv();
const BRANCH=process.env.UASCO_INTEGRATION_BRANCH??"v7/integration";
// //TR: Yalnız izinli entegrasyon dalı yapılandırılabilir (ortam değişkeni main'i hedefleyip korumasını değiştiremez); varsayılan kuru çalıştırmadır, PUT yalnız --apply ile yapılır.
const ALLOWED_BRANCHES=["v7/integration"];
const APPLY=process.argv.includes("--apply");
// //TR: Zorunlu kontrol context'leri CI matris iş adlarıyla birebir eşleşmelidir (.github/workflows/ci.yml: job "validate", matrix os -> "validate (<os>)").
const REQUIRED_CONTEXTS=["validate (ubuntu-latest)","validate (windows-latest)"];
function run(c,a,input=null){const r=cp.spawnSync(c,a,{encoding:"utf8",windowsHide:true,input,env});return {status:r.status,stdout:r.stdout??"",stderr:redactCliText(r.stderr??"")}}
let report={"//TR":"Bu runtime report integration-branch merge-gate protection sonucunu taşır.",checkedAt:new Date().toISOString(),branch:BRANCH,apply:APPLY,status:"LOCAL_ONLY",detail:"Not configured"};
const view=ALLOWED_BRANCHES.includes(BRANCH)?run("gh",["repo","view","--json","nameWithOwner,visibility"]):null;
if(!view){report={...report,status:"BLOCKED",detail:`BRANCH_NOT_ALLOWED: only ${ALLOWED_BRANCHES.join(", ")} may be configured by this helper`};}
else if(view.status!==0){report={...report,status:"LOCAL_ONLY",detail:"gh CLI/auth unavailable; integration merge-gate enforced by Local merge-via-gate.mjs only"};}
else{const repo=JSON.parse(view.stdout);
  if(repo.visibility!=="PRIVATE"){report={...report,status:"BLOCKED",detail:"Remote is not private",repo:repo.nameWithOwner};}
  else{
    // //TR: strict=true -> dal base'in gerisindeyse merge reddedilir (yeni base SHA eski yeşil kanıtı geçersiz kılar, yeniden koşu gerekir).
    // enforce_admins=true -> zorunlu kontroller pending/failed iken admin dahi merge edemez (PR #9 türü erken merge IMKANSIZ).
    // //TR: GitHub approving-review ZORUNLULUGU koyulmaz (required_pull_request_reviews:null): tek GitHub kimligi olan solo-maintainer kendi PR'ini onaylayamaz, enforce_admins ile birlikte bu merge'leri kilitlerdi. Review otoritesi repo'nun kendi governed CLAUDE_REVIEWER + kodlu merge gate'idir (SHA-bagli verdict); CI kapisi required_status_checks+enforce_admins ile saglanir.
    const body={required_status_checks:{strict:true,contexts:REQUIRED_CONTEXTS},enforce_admins:true,required_pull_request_reviews:null,restrictions:null,required_linear_history:false,allow_force_pushes:false,allow_deletions:false,block_creations:false,required_conversation_resolution:true,lock_branch:false,allow_fork_syncing:true};
    const ref=encodeURIComponent(BRANCH);
    if(!APPLY){report={...report,repo:repo.nameWithOwner,requiredContexts:REQUIRED_CONTEXTS,status:"DRY_RUN",detail:"No change made; re-run with --apply to PUT this protection body",body};}
    else{
    const put=run("gh",["api","--method","PUT","-H","Accept: application/vnd.github+json",`repos/${repo.nameWithOwner}/branches/${ref}/protection`,"--input","-"],JSON.stringify(body));
    // //TR: Başarısız PUT sessiz LOCAL_ONLY değil, FAIL ve sıfır olmayan çıkıştır.
    report={...report,repo:repo.nameWithOwner,requiredContexts:REQUIRED_CONTEXTS,status:put.status===0?"PASS":"FAIL",detail:put.status===0?"Integration merge-gate configured: required ubuntu+windows checks (strict), enforce_admins; no GitHub approving-review requirement (solo-maintainer safe; governed CLAUDE_REVIEWER + coded merge gate are the review authority)":"Protection API unavailable or denied; Local merge-via-gate.mjs remains the gate",stderr:put.status===0?null:put.stderr.slice(-1000)};
    }
  }
}
fs.mkdirSync(".ai/runtime",{recursive:true});fs.writeFileSync(".ai/runtime/INTEGRATION_BRANCH_PROTECTION.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(report.status==="BLOCKED"||report.status==="FAIL")process.exit(1);
