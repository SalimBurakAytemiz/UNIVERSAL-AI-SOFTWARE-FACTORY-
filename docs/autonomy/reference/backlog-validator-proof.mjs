//TR: backlog-validator.mjs kaniti: gercek draft BACKLOG_CHECKPOINT.json yapisal olarak gecer (0 READY) ve fail-closed kurallar (yetkisiz READY, karsilanmamis bagimlilikla READY, dup id, bilinmeyen owner/status, eksik/dangling dep, bos/bozuk backlog) reddedilir. Run (Node 24): node docs/autonomy/reference/backlog-validator-proof.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBacklog } from "./backlog-validator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (c, label, got) => { if (c) { passed++; console.log(`PASS  ${label}`); } else { failed++; console.log(`FAIL  ${label}${got !== undefined ? `\n        got: ${JSON.stringify(got)}` : ""}`); } };
const hasCode = (res, code) => !res.ok && res.errors.some((e) => e.code === code);

// 1. the real draft backlog validates structurally (it has 0 READY, so no READY-invariant fires)
const draft = JSON.parse(readFileSync(path.join(HERE, "../backlog-drafts/BACKLOG_CHECKPOINT.json"), "utf8"));
{ const r = validateBacklog(draft); ok(r.ok, "the real draft BACKLOG_CHECKPOINT.json passes the validator (structurally valid, 0 READY)", r.errors); }

// base helpers
const T = (over = {}) => ({ id: "X", owner: "CLOUD", status: "DRAFT_NOT_READY", authorizedBy: null, dependsOn: [], ...over });
const bk = (...tasks) => ({ tasks });

// 2. the core safety invariant: READY requires authorizedBy
ok(hasCode(validateBacklog(bk(T({ status: "READY", authorizedBy: null }))), "UNAUTHORIZED_READY"), "READY without authorizedBy -> UNAUTHORIZED_READY");
ok(hasCode(validateBacklog(bk(T({ status: "READY", authorizedBy: "   " }))), "UNAUTHORIZED_READY"), "READY with blank authorizedBy -> UNAUTHORIZED_READY");
ok(validateBacklog(bk(T({ id: "A", status: "DONE" }), T({ id: "B", status: "READY", authorizedBy: "founder", dependsOn: ["A"] }))).ok, "READY with authorizedBy + all deps DONE -> OK");

// 3. READY cannot have unmet / absent dependencies
ok(hasCode(validateBacklog(bk(T({ id: "A", status: "BLOCKED" }), T({ id: "B", status: "READY", authorizedBy: "founder", dependsOn: ["A"] }))), "READY_WITH_UNMET_DEP"), "READY with a not-DONE dep -> READY_WITH_UNMET_DEP");
ok(hasCode(validateBacklog(bk(T({ id: "B", status: "READY", authorizedBy: "founder", dependsOn: ["ghost"] }))), "READY_WITH_UNMET_DEP"), "READY with an absent dep -> READY_WITH_UNMET_DEP");

// 4. structural fail-closed
ok(hasCode(validateBacklog(bk(T({ id: "D" }), T({ id: "D" }))), "DUPLICATE_ID"), "duplicate task id -> DUPLICATE_ID");
ok(hasCode(validateBacklog(bk(T({ owner: "ROBOT" }))), "OWNER_INVALID"), "unknown owner -> OWNER_INVALID");
ok(hasCode(validateBacklog(bk(T({ status: "SHIPPED" }))), "STATUS_INVALID"), "unknown status -> STATUS_INVALID");
ok(hasCode(validateBacklog(bk(T({ dependsOn: ["ghost"] }))), "DEP_ABSENT_FROM_BACKLOG"), "dangling dependency id -> DEP_ABSENT_FROM_BACKLOG");
ok(hasCode(validateBacklog(bk(T({ id: "" }))), "TASK_ID_INVALID"), "empty task id -> TASK_ID_INVALID");
ok(!validateBacklog({}).ok && validateBacklog({}).errors[0].code === "TASKS_NOT_ARRAY", "no tasks array -> TASKS_NOT_ARRAY");
ok(!validateBacklog({ tasks: [] }).ok && validateBacklog({ tasks: [] }).errors[0].code === "EMPTY_BACKLOG", "empty tasks -> EMPTY_BACKLOG");
ok(!validateBacklog(null).ok, "null backlog -> not ok (fail-closed)");

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
