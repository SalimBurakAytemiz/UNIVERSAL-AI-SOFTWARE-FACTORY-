// //TR: Bu modül Project Studio'nun oturum içi arayüz durumunu tutar (açık proje çalışma alanı ve sekmesi, dosya gezgini konumu, diff seçimi, sihirbaz/içe aktarma taslakları, idempotency izleyicisi); taslaklar periyodik yenilemede veya dil değişiminde silinmez, hiçbir değer kalıcı depolamaya yazılmaz ve token/yol bilgisi tutulmaz.
import {createIdempotencyTracker} from "./work-core.js";
import {STUDIO_TABS} from "./project-core.js";

const freshWizard=()=>({name:"",template:"web-node",projectType:"",techStack:[""],targetOS:[],acceptanceCriteria:[""],maxRuns:"",maxTokens:"",devCommand:[""],testCommand:[""]});
const freshImport=()=>({projectId:"",kind:"git",path:"",pickedFor:null});
const freshStudio=()=>({projectId:null,tab:"overview",dir:"",file:null,diffFrom:"",diffTo:"",diffRequested:false,commit:"",lastCreated:null});

export const studio=freshStudio();
export const wizard=freshWizard();
export const importDraft=freshImport();
export const studioTrackers={wizard:createIdempotencyTracker(),idea:createIdempotencyTracker()};
// //TR: Kurucu fikri -> ilk mission taslağı (POST /v1/missions gövdesi); oturum içi, kalıcı değil. missionId yalnız sunucu 201/200 yanıtından gelir.
const freshIdea=()=>({title:"",objective:"",criteria:[""],riskLevel:"R1",missionId:null,missionTitle:null});
export const ideaDraft=freshIdea();
export function resetIdea(){Object.assign(ideaDraft,freshIdea());studioTrackers.idea.reset()}
export const studioUi={wizardOpen:false,importOpen:false};

/** Çalışma alanını açar; proje değişince dosya/diff konumu sıfırlanır. */
export function openProject(id,tab="overview"){
  if(studio.projectId!==id){studio.dir="";studio.file=null;studio.diffFrom="";studio.diffTo="";studio.diffRequested=false;studio.commit=""}
  studio.projectId=id;studio.tab=STUDIO_TABS.includes(tab)?tab:"overview";
}
export function closeProject(){studio.projectId=null;studio.tab="overview";studio.dir="";studio.file=null;studio.diffRequested=false}
export function setTab(tab){if(STUDIO_TABS.includes(tab))studio.tab=tab}
export function resetWizard(){Object.assign(wizard,freshWizard());studioTrackers.wizard.reset()}
export function resetImport(){Object.assign(importDraft,freshImport())}
export function resetStudio(){Object.assign(studio,freshStudio());resetWizard();resetIdea();resetImport();studioUi.wizardOpen=false;studioUi.importOpen=false}
