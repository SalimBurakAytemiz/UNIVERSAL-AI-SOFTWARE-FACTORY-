// //TR: Bu test CLOUD-T0001 bulut yürütme sözleşmesinin imzalı kapsam, tenant/proje/ortam bağlama, timeout/retry sınırları, idempotency, olay akışı ve artifact SHA kapılarında fail-closed davrandığını doğrular.
import {describe,it,expect} from "vitest";
import {registerCloudJobQueueCases} from "./support/cloud-jobs.cases.js";        // CLOUD-T0003 iş kuyruğu vakaları (aynı CI kaydı altında koşar)
import {registerQueueLockCases} from "./support/cloud-queue-lock.cases.js";     // CLOUD-T0003 kuyruk kilidi yarış vakaları
import {registerCloudGatewayCases} from "./support/cloud-gateway.cases.js";     // CLOUD-T0004 Control API kapısı vakaları
import {registerCloudTaskOrchestratorCases} from "./support/cloud-task-orchestrator.cases.js";   // CLOUD-T0010 görev DAG vakaları
import {registerCloudConnectionViewCases} from "./support/cloud-connection-view.cases.js"; // CLOUD-T0005 masaüstü bulut bağlantı görünümü vakaları
import {registerWorkosStoreLockCases} from "./support/workos-store-lock.cases.js";   // V3-T1001 store kilidi kurtarma vakaları
import {registerWorkosStoreIoCases} from "./support/workos-store-io.cases.js";     // UASCO-T0042 store işlem başına dayanıklı G/Ç vakaları
import {registerAutonomyCases} from "./support/autonomy.cases.js";             // FD-2026-11-03 kalıcı otonomi karar modülü vakaları
import {registerAutonomyExecutorCases} from "./support/autonomy-executor.cases.js"; // FD-2026-11-03 yürütücü (merge + doğrulama) vakaları
import {registerCommandIntakeCases} from "./support/command-intake.cases.js";   // UASCO-T0010 komut girişi (DRAFT öneri, netleştirme, 3 örnek) vakaları
import {registerCloudArtifactsCases} from "./support/cloud-artifacts.cases.js"; // CLOUD-T0008 artifact deposu ve imzalı teslim vakaları
import {
  CLOUD_CONTRACT_VERSION,MAX_JOB_TIMEOUT_MS,signScope,verifyScopeSignature,validateCloudJobRequest,verifyEventStream,verifyArtifact,
  auditRecordFor,canonicalJson,sha256Hex,type CloudJobRequest,type CloudJobEvent,type UnsignedScope,
} from "../core/cloud/contracts.js";
import {registerModelRouterCases} from "./support/model-router.cases.js";   // UASCO-T0062 routeModel karar kaydı vakaları
import {registerCloudProviderRoutingCases} from "./support/cloud-provider-routing.cases.js"; // CLOUD-T0015 sağlayıcı yönlendirme/kota/fallback vakaları
import {registerCrewCoordinatorCases} from "./support/crew-coordinator.cases.js"; // UASCO-T0045 CrewCoordinator/composeTeam AC bağlama vakaları
import {registerLeaseClaimsCases} from "./support/lease-claims.cases.js";   // UASCO-T0050 pkg-lease1 claim ref / çakışma / çift claim vakaları
import {registerOmniRouteClientCases} from "./support/omniroute-client.cases.js"; // UASCO-T0065 OmniRoute keşif istemcisi loopback vakaları
import {registerTemplateLockfileCases} from "./support/template-lockfile.cases.js"; // V3-T1012.a şablon kilit dosyası / npm ci && npm test vakaları
import {registerCloudDeployCases} from "./support/cloud-deploy.cases.js";     // CLOUD-T0012 ortam ayrımı / anahtar rotasyonu / sağlık / terfi vakaları
import {registerCloudAcceptanceSuite} from "./cloud/acceptance-suite.mjs";   // CLOUD-T0011 ilk bağlı zincir (loopback, LOCAL_STUB)

const SIGNING_FIXTURE="test-scope-key-".repeat(3);
const now=new Date("2026-11-02T12:00:00Z");
const unsigned:UnsignedScope={tenantId:"tenant-001",projectId:"proj-001",environment:"staging",jobKinds:["BUILD","TEST"],allowNetwork:false,maxCostUsd:5,issuedAt:"2026-11-02T11:00:00Z",expiresAt:"2026-11-02T19:00:00Z",keyId:"k-2026-11"};
const keys=new Map([["k-2026-11",SIGNING_FIXTURE]]);
const art={name:"src/app.zip",sha256:sha256Hex("hello"),sizeBytes:5};
function mk(over:Partial<CloudJobRequest>={},scopeOver:Partial<UnsignedScope>={}):CloudJobRequest{
  return {contractVersion:CLOUD_CONTRACT_VERSION,jobId:"job-0001",tenantId:"tenant-001",projectId:"proj-001",environment:"staging",kind:"BUILD",
    idempotencyKey:"idem-0001",timeoutMs:60_000,retry:{maxAttempts:2,backoffMs:1000},needsNetwork:false,estimatedCostUsd:1,
    inputArtifacts:[art],scope:signScope({...unsigned,...scopeOver},SIGNING_FIXTURE),requestedAt:"2026-11-02T11:59:00Z",...over};
}
const ctx=()=>({scopeKeys:keys,now,idempotencyIndex:new Map<string,string>()});
const reason=(r:unknown,c=ctx())=>{const d=validateCloudJobRequest(r,c);return d.ok?"OK":d.reason};

describe("cloud contract: signed scope",()=>{
  it("accepts a well-formed signed request",()=>expect(reason(mk())).toBe("OK"));
  it("rejects short signing secret",()=>expect(()=>signScope(unsigned,"short")).toThrow());
  it("detects tampering of any scope field",()=>{
    const r=mk();expect(reason({...r,scope:{...r.scope,maxCostUsd:500}})).toBe("SCOPE_SIGNATURE_INVALID");
    expect(reason({...r,scope:{...r.scope,jobKinds:["BUILD","TEST","DELIVERY"]}})).toBe("SCOPE_SIGNATURE_INVALID");
    expect(verifyScopeSignature({...r.scope,allowNetwork:true},SIGNING_FIXTURE)).toBe(false);
  });
  it("rejects unknown key id and empty keyring (fail-closed)",()=>{
    expect(reason(mk({},{keyId:"k-other"}))).toBe("SCOPE_KEY_UNKNOWN");
    expect(validateCloudJobRequest(mk(),{scopeKeys:new Map(),now}).ok).toBe(false);
  });
  it("rejects a scope signed with another secret",()=>{
    const r=mk();expect(reason({...r,scope:signScope(unsigned,"other-scope-key-".repeat(3))})).toBe("SCOPE_SIGNATURE_INVALID");
  });
  it("rejects malformed signature",()=>{const r=mk();expect(reason({...r,scope:{...r.scope,signature:"zz"}})).toBe("SCOPE_SIGNATURE_INVALID")});
  it("enforces scope validity window",()=>{
    expect(reason(mk({},{expiresAt:"2026-11-02T11:30:00Z"}))).toBe("SCOPE_EXPIRED");
    expect(reason(mk({},{issuedAt:"2026-11-02T13:00:00Z",expiresAt:"2026-11-02T14:00:00Z"}))).toBe("SCOPE_NOT_YET_VALID");
    expect(reason(mk({},{issuedAt:"2026-11-01T11:00:00Z",expiresAt:"2026-11-03T11:00:00Z"}))).toBe("SCOPE_LIFETIME_TOO_LONG");
  });
  it("binds tenant, project, environment, kind, network and cost to scope",()=>{
    expect(reason(mk({tenantId:"tenant-002"}))).toBe("TENANT_MISMATCH");
    expect(reason(mk({projectId:"proj-002"}))).toBe("PROJECT_MISMATCH");
    expect(reason(mk({environment:"production"}))).toBe("ENVIRONMENT_MISMATCH");
    expect(reason(mk({kind:"DELIVERY"}))).toBe("KIND_NOT_IN_SCOPE");
    expect(reason(mk({needsNetwork:true}))).toBe("NETWORK_NOT_IN_SCOPE");
    expect(reason(mk({estimatedCostUsd:5.01}))).toBe("COST_EXCEEDS_SCOPE");
  });
});

describe("cloud contract: request shape",()=>{
  it("rejects non-objects and wrong contract versions",()=>{
    for(const x of [null,"x",42,[]])expect(reason(x)).toBe("MALFORMED_REQUEST");
    expect(reason({...mk(),contractVersion:"uasco.cloud.v0"})).toBe("CONTRACT_VERSION_UNSUPPORTED");
  });
  it("rejects invalid identifiers",()=>{
    expect(reason(mk({jobId:"../etc"}))).toBe("INVALID_ID");
    expect(reason(mk({idempotencyKey:"   "}))).toBe("INVALID_ID");
  });
  it("bounds timeout to 24h and retry to 3 attempts",()=>{
    expect(reason(mk({timeoutMs:MAX_JOB_TIMEOUT_MS}))).toBe("OK");
    expect(reason(mk({timeoutMs:MAX_JOB_TIMEOUT_MS+1}))).toBe("TIMEOUT_OUT_OF_RANGE");
    expect(reason(mk({timeoutMs:Number.NaN}))).toBe("TIMEOUT_OUT_OF_RANGE");
    expect(reason(mk({retry:{maxAttempts:4,backoffMs:0}}))).toBe("RETRY_OUT_OF_RANGE");
    expect(reason(mk({retry:{maxAttempts:0,backoffMs:0}}))).toBe("RETRY_OUT_OF_RANGE");
    expect(reason(mk({retry:{maxAttempts:1,backoffMs:-1}}))).toBe("RETRY_OUT_OF_RANGE");
  });
  it("rejects negative or non-finite cost",()=>{
    expect(reason(mk({estimatedCostUsd:-1}))).toBe("COST_INVALID");
    expect(reason(mk({estimatedCostUsd:Number.POSITIVE_INFINITY}))).toBe("COST_INVALID");
  });
  it("rejects bad artifacts: path traversal, bad sha, duplicates",()=>{
    expect(reason(mk({inputArtifacts:[{...art,name:"../secret"}]}))).toBe("ARTIFACT_INVALID");
    expect(reason(mk({inputArtifacts:[{...art,name:"/abs"}]}))).toBe("ARTIFACT_INVALID");
    expect(reason(mk({inputArtifacts:[{...art,sha256:"ABC"}]}))).toBe("ARTIFACT_INVALID");
    expect(reason(mk({inputArtifacts:[art,art]}))).toBe("ARTIFACT_INVALID");
  });
  it("rejects requests from the future",()=>expect(reason(mk({requestedAt:"2026-11-02T13:00:00Z"}))).toBe("REQUEST_FROM_FUTURE"));
  it("rejects runtime type confusion",()=>expect(reason({...mk(),needsNetwork:"false"})).toBe("MALFORMED_REQUEST"));
});

describe("cloud contract: idempotency",()=>{
  it("marks identical retry as replay and conflicting reuse as denied",()=>{
    const c=ctx();
    const a=validateCloudJobRequest(mk(),c);expect(a.ok&&a.replay).toBe(false);
    const b=validateCloudJobRequest(mk(),c);expect(b.ok&&b.replay).toBe(true);
    expect(reason(mk({timeoutMs:120_000}),c)).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("scopes idempotency per tenant",()=>{
    const c=ctx();validateCloudJobRequest(mk(),c);
    const r2=mk({tenantId:"tenant-002",timeoutMs:120_000},{tenantId:"tenant-002"});
    expect(reason(r2,c)).toBe("OK");
  });
  it("digest is independent of key order",()=>{
    expect(canonicalJson({b:1,a:{d:2,c:[1,{y:1,x:2}]}})).toBe(canonicalJson({a:{c:[1,{x:2,y:1}],d:2},b:1}));
    expect(()=>canonicalJson({a:Number.NaN})).toThrow();
  });
});

describe("cloud contract: events, artifacts, audit",()=>{
  const ev=(seq:number,type:CloudJobEvent["type"],attempt=1,extra:Partial<CloudJobEvent>={}):CloudJobEvent=>({jobId:"job-0001",seq,type,attempt,at:`2026-11-02T12:00:${String(seq).padStart(2,"0")}Z`,...extra});
  const job={jobId:"job-0001",retry:{maxAttempts:2,backoffMs:0}};
  it("accepts a valid stream with one retry",()=>{
    expect(verifyEventStream([ev(0,"QUEUED"),ev(1,"STARTED"),ev(2,"RETRYING",2),ev(3,"HEARTBEAT",2),ev(4,"ARTIFACT",2,{artifact:art}),ev(5,"SUCCEEDED",2)],job)).toEqual({ok:true,terminal:"SUCCEEDED"});
  });
  it("rejects gaps, foreign jobs, post-terminal events and retry overflow",()=>{
    expect(verifyEventStream([ev(0,"QUEUED"),ev(2,"STARTED")],job)).toMatchObject({ok:false,reason:"SEQ_GAP"});
    expect(verifyEventStream([ev(0,"STARTED")],job)).toMatchObject({ok:false,reason:"FIRST_EVENT_NOT_QUEUED"});
    expect(verifyEventStream([ev(0,"QUEUED",1,{jobId:"other-job"})],job)).toMatchObject({ok:false,reason:"JOB_ID_MISMATCH"});
    expect(verifyEventStream([ev(0,"QUEUED"),ev(1,"STOPPED"),ev(2,"HEARTBEAT")],job)).toMatchObject({ok:false,reason:"EVENT_AFTER_TERMINAL"});
    expect(verifyEventStream([ev(0,"QUEUED"),ev(1,"RETRYING",2),ev(2,"RETRYING",3)],job)).toMatchObject({ok:false,reason:"ATTEMPT_OUT_OF_RANGE"});
    expect(verifyEventStream([ev(0,"QUEUED"),ev(1,"ARTIFACT",1,{artifact:{...art,name:"../x"}})],job)).toMatchObject({ok:false,reason:"ARTIFACT_INVALID"});
  });
  it("rejects non-monotonic time",()=>{
    expect(verifyEventStream([ev(0,"QUEUED",1,{at:"2026-11-02T12:00:10Z"}),ev(1,"STARTED",1,{at:"2026-11-02T12:00:05Z"})],job)).toMatchObject({ok:false,reason:"TIME_NOT_MONOTONIC"});
  });
  it("verifies artifact content against declared sha and size",()=>{
    expect(verifyArtifact(art,Buffer.from("hello"))).toBe(true);
    expect(verifyArtifact(art,Buffer.from("hellO"))).toBe(false);
  });
  it("audit records never carry the scope signature",()=>{
    const r=mk();const d=validateCloudJobRequest(r,ctx());
    const rec=auditRecordFor(r,d,now);
    expect(rec).toMatchObject({decision:"ACCEPTED",jobId:"job-0001",tenantId:"tenant-001"});
    expect(JSON.stringify(rec)).not.toContain(r.scope.signature);
    const denied=auditRecordFor({jobId:"../bad"},validateCloudJobRequest({jobId:"../bad"},ctx()),now);
    expect(denied).toMatchObject({decision:"DENIED",jobId:null,reason:"CONTRACT_VERSION_UNSUPPORTED"});
  });
});

describe("cloud contract: review follow-ups (PR #296 LOW-1, LOW-2, INFO-3)",()=>{
  const job={jobId:"job-0001",retry:{maxAttempts:2,backoffMs:0}};
  const q={jobId:"job-0001",seq:0,type:"QUEUED" as const,attempt:1,at:"2026-11-02T12:00:00Z"};
  it("rejects unknown event types, empty streams and bad artifact sizes",()=>{
    expect(verifyEventStream([],job)).toMatchObject({ok:false,reason:"EMPTY_STREAM"});
    expect(verifyEventStream([q,{...q,seq:1,type:"BOGUS" as unknown as "LOG"}],job)).toMatchObject({ok:false,reason:"UNKNOWN_EVENT_TYPE"});
    for(const sizeBytes of [-1,1.5,Number.NaN])expect(verifyEventStream([q,{...q,seq:1,type:"ARTIFACT",artifact:{...art,sizeBytes}}],job)).toMatchObject({ok:false,reason:"ARTIFACT_INVALID"});
  });
  it("a non-canonical extra field is a deny, never a throw",()=>{
    expect(reason({...mk(),extra:Number.NaN})).toBe("MALFORMED_REQUEST");
    expect(reason({...mk(),extra:BigInt(1)})).toBe("MALFORMED_REQUEST");
  });
  it("an inverted scope window has its own reason code",()=>expect(reason(mk({},{issuedAt:"2026-11-02T11:00:00Z",expiresAt:"2026-11-02T10:00:00Z"}))).toBe("SCOPE_WINDOW_INVALID"));
});

registerCloudJobQueueCases();
registerQueueLockCases();
registerCloudGatewayCases();
registerCloudTaskOrchestratorCases();
registerCloudConnectionViewCases();
registerWorkosStoreLockCases();
registerWorkosStoreIoCases();
registerAutonomyCases();
registerAutonomyExecutorCases();
registerCommandIntakeCases();
registerModelRouterCases();
registerCloudProviderRoutingCases();
registerCloudArtifactsCases();
registerCrewCoordinatorCases();
registerLeaseClaimsCases();
registerOmniRouteClientCases();
registerTemplateLockfileCases();
registerCloudDeployCases();
registerCloudAcceptanceSuite();
