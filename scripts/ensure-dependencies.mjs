// //TR: Target/startup dependency kapısı source-reviewed lock zorunluluğu ve digest-aware deterministic npm ci kurulumunu ortak helper üzerinden uygular.
import {ensureDependencies} from "../automation/lib/dependency-install.mjs";
try{const r=ensureDependencies(process.cwd());console.log(`DEPENDENCIES_READY: ${r.mode} lock=${r.lockSha256}`)}catch(error){console.error(error instanceof Error?error.message:String(error));process.exit(1)}
