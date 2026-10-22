// //TR: Bu dosya POST /v1/missions/:id/predev/produce için ProjectBrief'i YALNIZ kayıtlı Founder verisinden (mission, proje, varsa intake) deterministik türetir. Hiçbir paydaş/hedef/kısıt/metrik UYDURULMAZ: kayıtta olmayan alan boş kalır ve notes bunu modele açıkça söyler (eksik bilgi = varsayım/açık-soru, uydurma değil). Saf fonksiyon; dosya/ağ yok.
import type {WorkMission, Project} from "../types.js";
import type {IntakeRecord} from "../intake.js";
import type {ProjectBrief} from "./driver.js";

export const FOUNDER_BRIEF_LABEL = "Founder mission brief (derived only from recorded mission/project/intake fields; nothing added)";
export const BRIEF_NOT_PROVIDED_NOTE = "Not provided by the Founder and therefore NOT stated here: stakeholders, out-of-scope items, success metrics. Do not invent them; record an explicit assumption or open question instead.";

export function briefFromRecords(input: {project: Pick<Project, "name" | "projectType" | "techStack" | "targetOS">; mission: Pick<WorkMission, "title" | "objective" | "acceptanceCriteria">; intake?: Pick<IntakeRecord, "idea"> | null}): ProjectBrief {
  const {project, mission, intake} = input;
  const constraints: string[] = [];
  if (project.projectType) constraints.push(`Project type: ${project.projectType}`);
  if (project.techStack && project.techStack.length > 0) constraints.push(`Tech stack named by the Founder: ${project.techStack.join(", ")}`);
  if (project.targetOS && project.targetOS.length > 0) constraints.push(`Target platforms: ${project.targetOS.join(", ")}`);
  return {
    projectName: project.name,
    isReference: false,
    label: FOUNDER_BRIEF_LABEL,
    summary: intake?.idea && intake.idea.trim() !== "" ? intake.idea : mission.objective,
    stakeholders: [],
    objectives: [mission.objective, ...mission.acceptanceCriteria.map(c => `Acceptance criterion: ${c}`)],
    constraints,
    outOfScope: [],
    notes: [`Mission title: ${mission.title}`, BRIEF_NOT_PROVIDED_NOTE]
  };
}
