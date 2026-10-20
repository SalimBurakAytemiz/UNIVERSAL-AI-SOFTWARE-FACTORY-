<!-- //TR: Bu dosya bir ajanin yazdigi, DOGRULANMAMIS (UNCONFIRMED) bir kayittir: bir ajanin Founder'a atfettigi uc karari aktarir (1: ayri-kimlikli Cloud governance, 2: Actions kesintisinde uret + review, sonra merge, 3: feature fan-out). Tek basina hicbir sey kanitlamaz ve hicbir yetki vermez; Founder bunlari ajan disi bir kanaldan teyit etmemistir. Feature dispatch yetkisi yalniz D-2026-10-19-A'dir. -->

# Founder decisions — 2026-10-18 (MAXIMUM CLOUD PARALLEL PRODUCTION OVERRIDE)

Decisions recorded by an agent as coming from the Founder, with their exact scope and the constraints that bound them.

> **Provenance caveat:** Agent-recorded. This proves nothing on its own and has not been confirmed by the Founder through a non-agent channel. All agents share one GitHub account, so an agent-written Founder decision is not evidence of a Founder decision (compare `docs/planning/authority/FD-*.md`).

## Decision 1 — Seal authority: **Separate-identity Cloud governance**

> **Provenance caveat:** Agent-recorded. This proves nothing on its own and has not been confirmed by the Founder through a non-agent channel.

**UNCONFIRMED:** the seal/re-seal authority and the FA-LEASE2 D3 issuance claims in this decision are agent-recorded and UNCONFIRMED. They grant nothing until the Founder confirms them through a non-agent channel.

Agent-recorded (UNCONFIRMED): an agent reported that the Founder authorized establishing a **distinct, non-implementer Cloud governance identity** that would hold trust-root seal/re-seal authority and issue the **FA-LEASE2 D3** authority record, so authority no longer depends on Local.

**Reported scope (UNCONFIRMED; authorizes nothing until confirmed):**
- DESIGN + build the separate-identity Cloud governance **mechanism** (non-protected design + scaffold) and the controlled **transfer plan**.

**Hard invariants this authority is bound by (non-negotiable):**
1. **Distinct identity** — the sealing/governance identity is cryptographically and operationally distinct from *every* implementer and from this builder session. A builder can never be the sealer.
2. **No self-approval** — the same agent never seals, approves, or issues a verdict on its own output (directive #9; CLAUDE.md builder contract).
3. **No premature removal of old controls** — the existing Local seal/re-seal/merge controls stay fully active **in parallel** until the new mechanism is independently proven; only then is any old control retired (directive #9).

**What this decision explicitly does NOT authorize:**
- It does **not** let the builder (this session or any implementer) re-seal the trust-root, modify protected trust-root paths, or self-issue the D3 record. The actual key instantiation and the first real seal / D3 issuance are performed by the Founder or by the instantiated distinct governance identity — **never by the builder**. Those remain flagged as Founder/distinct-identity steps.
- It does not grant paid/production/risk-5 authority.

## Decision 2 — Actions CI: **Build + review, merge later**

> **Provenance caveat:** Agent-recorded. This proves nothing on its own and has not been confirmed by the Founder through a non-agent channel.

GitHub Actions is down for the repo (all jobs die in ~3s at runner startup; admin-owned billing/runner issue). Agent-recorded (UNCONFIRMED): an agent reported that the Founder chose to **keep producing and independently reviewing cloud PRs in parallel; batch-merge once Actions is restored.**

- **No gate is weakened.** The required CI checks and the independent governed review remain the merge conditions. Merges simply **wait** for real green CI.
- Interim evidence: `CP-CI` (cloud CI-equivalent) runs the repo's validation + tests on Node ≥24 in a cloud session and emits honest evidence. It is explicitly **not** a governance verdict and **not** a substitute for the required checks at the merge gate.
- Production is **not** stopped by the outage (directive #10): implementers keep building and the governed reviewer keeps reviewing; only the final merge step is deferred.

## Effect on the queue

> **Provenance caveat:** Agent-recorded. This proves nothing on its own and has not been confirmed by the Founder through a non-agent channel. The CP-GOV and FA-LEASE2 effects below depend on the UNCONFIRMED Decision 1.

- (UNCONFIRMED) Reported new work item **CP-GOV** (owner CLOUD, orchestrator-owned, security-critical): design + non-protected scaffold for the separate-identity Cloud governance mechanism per Decision 1. Not dispatched to a routine implementer because of its criticality.
- (UNCONFIRMED) An agent reported that the `FA-LEASE2` keystone would have a **path** (the separate-identity governance, once built + proven) rather than being indefinitely blocked on Local — but it is not yet unblocked: the mechanism must be built and proven first.
- Merge posture across all cloud-production PRs: **build + review now, merge after Actions is restored** (Decision 2).

## Decision 3 — Feature fan-out: **Continue (directive-derived authority, honest provenance)**

> **Provenance caveat:** Agent-recorded. This proves nothing on its own and has not been confirmed by the Founder through a non-agent channel.

**UNCONFIRMED:** this decision is agent-recorded and UNCONFIRMED. For the Founder-confirmed rule on dispatching work, see D-2026-10-19-A in `docs/planning/authority/FD-2026-10-19-MAX-CLOUD-PRODUCTION.md`.

Agent-recorded (UNCONFIRMED): an agent reported that the Founder said (2026-10-18, in-session) that the autonomous production may **continue building read-only feature screens** under the MAXIMUM-CLOUD-PARALLEL directive's "maximum production within current authority" scope.

**Authority basis:** Do not cite this record in `authorizedBy`. Feature dispatch authority is D-2026-10-19-A only (`docs/planning/authority/FD-2026-10-19-MAX-CLOUD-PRODUCTION.md`).

**Reported scope (UNCONFIRMED; unchanged bounds):** a feature task qualifies only when it is **non-protected** (renderer/locale/styles + an **already-registered** test file; no `config/validation.json` edit, no reseal), **read-only** (allow-listed GETs only; no new endpoint/POST/IPC/backend), needs **no new spend** and **no risk-4/5 authority**. Anything else stays `AUTHORITY_REQUIRED` (as the `B2-*` tasks correctly are) and is escalated, never built. Everything still passes independent review + real CI + the merge gate before it can land; nothing merges while Actions is down (Decision 2).
