<!-- //TR: Founder'in 2026-10-18 MAXIMUM CLOUD PARALLEL direktifine verdigi iki kararin kalici kaydi: (1) ayri-kimlikli Cloud governance yetkisi (seal/reseal + FA-LEASE2 D3), eski Local kontroller transfer kanitlanana dek korunur; (2) Actions kesintisi suresince "uret + bagimsiz review, sonra merge". Bu kayit yetkinin kapsamini sabitler; builder KENDISI muhurleme/onay yetkisi kazanmaz. -->

# Founder decisions — 2026-10-18 (MAXIMUM CLOUD PARALLEL PRODUCTION OVERRIDE)

Two decisions recorded from the Founder, with their exact scope and the constraints that bound them.

## Decision 1 — Seal authority: **Separate-identity Cloud governance**

The Founder authorized establishing a **distinct, non-implementer Cloud governance identity** that will hold trust-root seal/re-seal authority and issue the **FA-LEASE2 D3** authority record, so authority no longer depends on Local.

**Exact scope of what this authorizes now:**
- DESIGN + build the separate-identity Cloud governance **mechanism** (non-protected design + scaffold) and the controlled **transfer plan**.

**Hard invariants this authority is bound by (non-negotiable):**
1. **Distinct identity** — the sealing/governance identity is cryptographically and operationally distinct from *every* implementer and from this builder session. A builder can never be the sealer.
2. **No self-approval** — the same agent never seals, approves, or issues a verdict on its own output (directive #9; CLAUDE.md builder contract).
3. **No premature removal of old controls** — the existing Local seal/re-seal/merge controls stay fully active **in parallel** until the new mechanism is independently proven; only then is any old control retired (directive #9).

**What this decision explicitly does NOT authorize:**
- It does **not** let the builder (this session or any implementer) re-seal the trust-root, modify protected trust-root paths, or self-issue the D3 record. The actual key instantiation and the first real seal / D3 issuance are performed by the Founder or by the instantiated distinct governance identity — **never by the builder**. Those remain flagged as Founder/distinct-identity steps.
- It does not grant paid/production/risk-5 authority.

## Decision 2 — Actions CI: **Build + review, merge later**

GitHub Actions is down for the repo (all jobs die in ~3s at runner startup; admin-owned billing/runner issue). The Founder chose: **keep producing and independently reviewing cloud PRs in parallel; batch-merge once Actions is restored.**

- **No gate is weakened.** The required CI checks and the independent governed review remain the merge conditions. Merges simply **wait** for real green CI.
- Interim evidence: `CP-CI` (cloud CI-equivalent) runs the repo's validation + tests on Node ≥24 in a cloud session and emits honest evidence. It is explicitly **not** a governance verdict and **not** a substitute for the required checks at the merge gate.
- Production is **not** stopped by the outage (directive #10): implementers keep building and the governed reviewer keeps reviewing; only the final merge step is deferred.

## Effect on the queue
- New authorized work item **CP-GOV** (owner CLOUD, orchestrator-owned, security-critical): design + non-protected scaffold for the separate-identity Cloud governance mechanism per Decision 1. Not dispatched to a routine implementer because of its criticality.
- `FA-LEASE2` keystone now has an **authorized path** (the separate-identity governance, once built + proven) rather than being indefinitely blocked on Local — but it is not yet unblocked: the mechanism must be built and proven first.
- Merge posture across all cloud-production PRs: **build + review now, merge after Actions is restored** (Decision 2).

## Decision 3 — Feature fan-out: **Continue (directive-derived authority, honest provenance)**

The Founder confirmed (2026-10-18, in-session) that the autonomous production may **continue building read-only feature screens** under the MAXIMUM-CLOUD-PARALLEL directive's "maximum production within current authority" scope.

**Authority basis (the honest provenance to cite):** `FOUNDER-DIRECTIVE:MAXIMUM-CLOUD-PARALLEL-2026-10-18 + fan-out confirmation 2026-10-18`. This is a **directive-level** authorization for a *class* of work — **not** a per-screen Founder approval. Any task's `authorizedBy` for feature screens must cite this directive, and must **not** claim a fabricated per-screen "in-session approval message." (The `FOUNDER-APPROVAL:... in-session message` strings on the L-* tasks in `docs/planning/BACKLOG_CHECKPOINT.json` / PR #16 overclaim provenance and should be relabeled to this directive basis; flagged for the author + governed reviewer.)

**Scope of this authorization (unchanged bounds):** a feature task qualifies only when it is **non-protected** (renderer/locale/styles + an **already-registered** test file; no `config/validation.json` edit, no reseal), **read-only** (allow-listed GETs only; no new endpoint/POST/IPC/backend), needs **no new spend** and **no risk-4/5 authority**. Anything else stays `AUTHORITY_REQUIRED` (as the `B2-*` tasks correctly are) and is escalated, never built. Everything still passes independent review + real CI + the merge gate before it can land; nothing merges while Actions is down (Decision 2).
