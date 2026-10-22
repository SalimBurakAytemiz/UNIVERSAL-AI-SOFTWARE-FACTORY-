// //TR: Bu script 599 rol için yürütme profili ÖNERİLERİNİ (registries/role-execution-profiles.json) yalnız depo içi kaynaklardan ve core/agents/role-profile-derivation.ts ile deterministik olarak üretir. --check modu kayıtlı dosyanın yeniden üretimle BAYT-AYNI olduğunu doğrular (farklıysa 1 ile çıkar, hiçbir şey yazmaz). Bu çıktı bağlama DEĞİLDİR; hiçbir rolü yürütülebilir/certified yapmaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {tsImport} from "tsx/esm/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "registries/role-execution-profiles.json";
const INPUTS = {
  roleDefinitions: "registries/role-definitions.json", skills: "registries/skills-v2.json", technologies: "registries/technologies.json",
  competency: "registries/agent-competency-v2.json", skillMatrix: "registries/agent-skill-matrix.json", toolPolicy: "registries/agent-tool-policy-v2.json", reviewGraph: "registries/agent-review-graph-v2.json"
};
const check = process.argv.includes("--check");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const fail = (m) => { console.error("ROLE_EXECUTION_PROFILES: FAIL " + m); process.exit(1); };

const raw = {}, digests = {};
for (const [k, rel] of Object.entries(INPUTS)) { const b = fs.readFileSync(path.join(root, rel)); digests[rel] = sha(b); raw[k] = JSON.parse(b.toString("utf8")); }
const evaluationFileNames = fs.readdirSync(path.join(root, "evaluations", "agents")).filter((n) => n.endsWith(".json")).sort();
const mod = await tsImport(path.join(root, "core/agents/role-profile-derivation.ts"), import.meta.url);
const inputs = mod.buildDerivationInputs({...raw, evaluationFileNames});
const profiles = mod.deriveRoleProfiles(inputs);
const doc = {
  "//TR": "Bu dosya 599 rol için yürütme profili ÖNERİLERİDİR (PROPOSED_DERIVED): yalnız depo içi kaynaklardan scripts/build-role-execution-profiles.mjs ile türetilir, elle düzenlenmez. Bağlama/sertifika/çalışma durumu DEĞİLDİR; kaynak bir şey söylemiyorsa alan boştur ve gap kimliği yazılır.",
  schemaVersion: mod.PROFILE_SCHEMA_VERSION, status: "PROPOSED_DERIVED_NOT_RUNTIME", authority: INPUTS.roleDefinitions,
  neverGranted: mod.NEVER_GRANTED, inputs: digests, counts: mod.summarizeProfiles(profiles), profiles
};
// Başlık okunur (2 boşluk), her profil TEK satır: dosya küçük kalır ve rol başına satır farkı okunur.
const {profiles: _p, ...head} = doc;
const headText = JSON.stringify(head, null, 2);
const text = headText.slice(0, -2) + ',\n  "profiles": [\n' + profiles.map((p) => "    " + JSON.stringify(p)).join(",\n") + "\n  ]\n}\n";
const target = path.join(root, OUT);
if (check) {
  let current = null; try { current = fs.readFileSync(target, "utf8"); } catch { /* yok */ }
  if (current !== text) fail(`${OUT} is not byte-identical to a fresh rebuild (run: node scripts/build-role-execution-profiles.mjs)`);
  console.log(`ROLE_EXECUTION_PROFILES: PASS (byte-identical rebuild) roles=${profiles.length} sha256=${sha(text)}`);
} else {
  fs.writeFileSync(target, text);
  console.log(`ROLE_EXECUTION_PROFILES: WROTE ${OUT} roles=${profiles.length} sha256=${sha(text)}`);
}
