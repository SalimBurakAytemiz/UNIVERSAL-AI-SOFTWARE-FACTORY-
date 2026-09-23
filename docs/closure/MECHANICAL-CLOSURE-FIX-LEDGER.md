<!-- //TR: Bu ledger son mekanik red-team audit bulgularının V2 artifact içinde hangi dosya/mekanizma ile kapatıldığını ve target-machine doğrulaması gereken maddeleri görünür kılar. -->
> **HISTORICAL_FIX_LEDGER_NOT_CURRENT_AUTHORITY** — //TR: Bu belge geçmiş audit/specification bağlamını korur; current PASS/CLEAN/closure/release authority değildir. Current truth için `CANONICAL-STATUS.md` ve `audit/V6-FULL-SCAN-PROGRESS.json` kullanılır.
# Mechanical Closure Fix Ledger

## CLOSED IN SOURCE / STATICALLY VERIFIED

- **Review-before-merge:** isolated run worktree + local commit + frozen Codex review + CLEAN + ff-only merge + non-force push. `automation/factory-supervisor.mjs`, `automation/lib/git-ops.mjs`.
- **No push before CLEAN:** `config/automation.json` + `scripts/validate-mechanical-closure.mjs` static order gate.
- **Moving goalpost:** Cycle-1 blocker freeze, Cycle-2+ ordinary new blocker downgrade. `automation/lib/review-governance.mjs`.
- **Strict Codex output:** single JSON + schema validation; unsafe string-CLEAN parser removed.
- **Blocker admissibility:** basis refs, causality, scope, reproduction, evidence, confidence and remediation acceptance required.
- **Prompt injection boundary:** review prompt explicitly treats repository content as untrusted data.
- **Protected trust root:** governance/prompts/validators/config/phase contracts/supervisor/CI-critical files are hash-protected and normal feature build cannot change them.
- **Change scope:** exact changed-file guard; exact staging; test deletion/skip/assertion reduction and dependency drift controls.
- **Config enforcement:** paid API, production and Risk-5 defaults are fail-closed in supervisor milestone policy gate.
- **Git fail-closed:** real repository/clean-tree checks throw on Git command failure.
- **Process lock:** same-repo concurrent supervisor blocked; foreign-host lock fails closed.
- **Crash resume:** atomic digest-chained checkpoint with explicit CLEAN_READY/PUSH stages.
- **Quota/auth/network classification:** retryable infrastructure failure separated from review findings and does not consume review cycles.
- **Central run logs:** runId/events.jsonl/redacted bounded logs/summary/evidence refs.
- **Evidence retention:** package completion attestation copied to durable runtime evidence ledger separate from run-log retention.
- **Global Stop:** Control API + Control Tower stop/resume; long model commands poll stop and terminate process tree.
- **Roadmap speed:** 149 acceptance phases retained, 148 post-Phase0 phases grouped into 34 coherent review packages; dependency DAG/build waves/parallel lanes/critical path exist.
- **Milestone auto-advance:** supervisor processes up to configured package budget per invocation and wrapper auto-resumes retry/more-work states.
- **Phase contracts:** every phase carries exact dependencies, phase-specific acceptance, mandatory failure cases, required artifacts, scope/risk and now phase-specific deliverable/validation/evidence/review/exit text.
- **Schemas:** canonical object schemas reject unknown properties and semantic critical review/install schemas are strict.
- **One-click install:** artifact -> preflight -> dependencies -> validation -> Git -> provider auth -> Control Tower smoke -> Phase0 -> optional autostart, with INSTALL_STEPS/INSTALL_REPORT.
- **Control Tower:** Phase0/install/scheduler/runs/events/redacted logs/retry/Global Stop visible on Day-0 screen.
- **Deterministic dependencies:** exact direct dependency versions; package-lock is generated before initial Git baseline then `npm ci` is required.

## TARGET-MACHINE PROOF REQUIRED BEFORE INSTALLATION_GO

These cannot be honestly certified inside this restricted artifact-generation environment:

- Node **24+** actual target installation.
- npm registry download and generated `package-lock.json`.
- `npm ci`, TypeScript typecheck and Vitest on target.
- Claude CLI authentication/network smoke.
- Codex CLI authentication/network smoke.
- Electron + Control API smoke on target Windows desktop.
- Windows Task Scheduler autostart.
- Optional OmniRoute current CLI/provider compatibility.
- Private remote/API visibility and remote branch protection if a remote is configured.

`PHASE0_ACCEPTANCE.json` must remain BLOCKED until required target-machine proofs exist.
