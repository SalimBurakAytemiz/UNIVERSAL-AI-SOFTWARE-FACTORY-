// //TR: Bu script bir rol için TANIMLI değerlendirme prosedürünü çalıştırır ve kanıtı <veri dizini>/evaluations/staging altına yazar. VARSAYILAN KURU ÇALIŞTIRMADIR (süreç yok, dosya yok); gerçek çalıştırma yalnız --execute ile, CI dışında, allowPaidApi=false iken, Founder'ın etkinleştirdiği LOCAL_CLAUDE ve provenance PASS ile yapılır. audit/evidence, registries ve depo içine yazmaz; kayıt durumlarını değiştirmez (terfi korumalı bir adımdır: docs/authority-requests/LANE-C-role-evaluation-pipeline.md).
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {tsImport} from "tsx/esm/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await tsImport(pathToFileURL(path.join(root, "core/competency/evaluation-cli.ts")).href, import.meta.url);
process.exitCode = await mod.runCli(process.argv.slice(2), {repoRoot: root, env: process.env, out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s)});
