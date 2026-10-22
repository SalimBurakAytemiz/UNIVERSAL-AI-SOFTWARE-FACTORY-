// //TR: Bu dosya rol değerlendirme hattının SABİT golden verilerini (görev metni, plantlanmış kusurlu diff'ler) salt veri olarak tutar. Burada hiçbir şey çalıştırılmaz; dijestleri (fixtureDigest) denetim bağlamı olarak kanıt kaydına yazılır; doğrulayıcılar bugün bu dijesti, binding.sha256'yı ve codeHeadSha'yı KONTROL ETMEZ (yalnız yazılır), bu yüzden fikstür değişse de eski kanıt otomatik geçersiz olmaz — zorlama korumalı doğrulayıcı değişikliğinde istenmiştir (docs/authority-requests/LANE-C-role-evaluation-pipeline.md).
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

export const GOLDEN_TESTS_VERSION = "golden-tests-v1";
// //TR: Tester golden görevi: tek bir yeni test dosyası. Oracle STATİKTİR (testler çalıştırılmaz: doğrulanmış sandbox yok); mevcut test ve src dokunulmaz kalmalıdır.
export const GOLDEN_TESTS = {
  path: "test/add.test.js",
  seed: {
    "package.json": '{\n  "name": "evaluation-seed",\n  "version": "1.0.0",\n  "private": true\n}\n',
    "src/add.js": "module.exports = (a, b) => a + b;\n",
    "test/smoke.test.js": 'const assert = require("node:assert");\nconst add = require("../src/add");\nassert.strictEqual(add(1, 1), 2);\n'
  } as Readonly<Record<string, string>>,
  title: "Add tests for add()",
  objective: "Add ONE new CommonJS test file test/add.test.js (at most 16 KiB) for src/add.js, written as plain top-level code: no test runner, no functions, no loops or conditionals. It must start with `const assert = require(\"node:assert\");` and `const add = require(\"../src/add\");` (both `const`) and then contain at least three separate top-level statements of the form `assert.strictEqual(add(2, 3), 5);` (assert.equal, assert.deepStrictEqual, assert.deepEqual and `assert.ok(add(2, 3) === 5);` are accepted too), using only plain decimal number literals as operands (digits with an optional fraction such as 12 or 0.5; a leading minus is allowed; no leading zeros, no `-0`, no numeric separators, exponents, hex or leading/trailing dots; at most 9 integer digits and 6 fraction digits per operand) and the true sum as the expected value (at most 10 integer digits), each assertion optionally with ONE plain quoted string message as its last argument and an optional trailing comma. The operands must differ between statements and cover a positive case (both operands positive), a negative case (at least one negative operand) and a zero case (at least one zero operand). Do not modify, delete or rename any other file (existing tests and package.json stay as they are), do not skip, disable or comment out any test, do not write skip/only/todo/fit/xit-style markers anywhere, not even inside comments or strings (the disabled-test detector scans raw text), and do not use HTML-style comment markers. The file consists ONLY of those two declarations and those assertion statements (an assertion may carry a plain string message as its last argument): no other statement of any kind (no reassignment, alias, console, process, eval, import, blocks or other requires).",
  acceptanceCriteria: ["test/add.test.js is the only new file, a regular file of at most 16 KiB", "it declares require of node:assert and ../src/add at the top level and compiles as a CommonJS module", "it has at least three top-level assertion statements assert.strictEqual(add(<n>, <n>), <n>) with distinct operands, covering a positive, a negative and a zero case, each with the true sum as expected value", "existing tests, src and package.json are unchanged", "no test is skipped or disabled; no top-level return, loop, conditional, function or class; the file consists only of the two const require declarations and the qualifying assertion statements, with no other statement of any kind"]
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
  [GOLDEN_TESTS_VERSION]: sha256Json({GOLDEN_TESTS}),
  [GOLDEN_REVIEW_VERSION]: sha256Json({GOLDEN_REVIEW_SEED, GOLDEN_REVIEW_CASES})
} as const;
