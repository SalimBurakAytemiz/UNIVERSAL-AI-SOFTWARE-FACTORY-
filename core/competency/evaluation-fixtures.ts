// //TR: Bu dosya rol değerlendirme hattının SABİT golden verilerini (görev metni, plantlanmış kusurlu diff'ler) salt veri olarak tutar. Burada hiçbir şey çalıştırılmaz; dijestleri kanıt kaydına yazılır, böylece fikstür değişirse eski kanıt başka bir prosedüre ait sayılır.
import crypto from "node:crypto";

export const GOLDEN_FILE_VERSION = "golden-file-v1";
// //TR: Developer golden görevi: tek dosya, tam içerik; oracle bayt düzeyindedir (model metni karar vermez).
export const GOLDEN_FILE = {
  path: "greeting.txt", content: "hello\n",
  seed: {"README.md": "# evaluation seed\n"} as Readonly<Record<string, string>>,
  title: "Add greeting file",
  objective: "Create a file named greeting.txt at the repository root whose content is exactly the single line `hello` followed by a newline. Change no other file.",
  acceptanceCriteria: ["greeting.txt exists at the repository root", "its content is exactly `hello` followed by one newline", "no other file is created, modified or deleted"]
} as const;

export const GOLDEN_REVIEW_VERSION = "golden-review-v1";
// //TR: Reviewer golden vakaları: temiz (tek satırlık doğru değişiklik -> CLEAN beklenir) ve plantlanmış komut enjeksiyonu (-> BLOCKED + en az bir bulgu beklenir). Seed ortak, değişiklik vaka başına.
export interface ReviewCase { id: string; expected: "CLEAN" | "BLOCKED"; title: string; objective: string; acceptanceCriteria: string[]; change: Readonly<Record<string, string>> }
export const GOLDEN_REVIEW_SEED: Readonly<Record<string, string>> = {"README.md": "# evaluation seed\n"};
export const GOLDEN_REVIEW_CASES: readonly ReviewCase[] = [
  {id: "clean-greeting", expected: "CLEAN", title: "Add greeting file", objective: "Create greeting.txt containing exactly `hello` and a newline; change nothing else.", acceptanceCriteria: ["greeting.txt contains `hello` and one newline", "no other file changes"],
    change: {"greeting.txt": "hello\n"}},
  {id: "planted-command-injection", expected: "BLOCKED", title: "Show the git log of a requested ref", objective: "Add a helper that returns the git log for a ref chosen by the caller.", acceptanceCriteria: ["returns the log for the requested ref"],
    change: {"log.js": 'const {execSync} = require("child_process");\nmodule.exports = function gitLog(ref) {\n  return execSync("git log " + ref).toString();\n};\n'}}
];

export const sha256Json = (x: unknown): string => crypto.createHash("sha256").update(JSON.stringify(x), "utf8").digest("hex");
export const FIXTURE_DIGESTS = {
  [GOLDEN_FILE_VERSION]: sha256Json({GOLDEN_FILE}),
  [GOLDEN_REVIEW_VERSION]: sha256Json({GOLDEN_REVIEW_SEED, GOLDEN_REVIEW_CASES})
} as const;
