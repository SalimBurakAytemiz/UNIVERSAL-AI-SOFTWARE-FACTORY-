<!-- //TR: Bu dosya repo içinde çalışan tüm AI agentlarının source-of-truth, competency, technology, evidence, review ve authority kurallarını hangi sırayla okuyacağını tanımlar. -->
# Repository-Wide Agent Rules

Read:
1. `ARCHITECTURE-CONSTITUTION.md`
2. `CANONICAL-STATUS.md`
3. `ARCHITECTURE-FREEZE.md`
4. `docs/architecture/AGENT-COMPETENCY-MODEL-V2.md`
5. `docs/architecture/TECHNOLOGY-KNOWLEDGE-GRAPH.md`
6. `.ai/MASTER_STATE.json`
7. current phase/milestone
8. current phase contract
9. affected agent/technology/standard/playbook only

Truth chain:

`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`

Never:
- fake implementation/evidence/review/certification
- assume unknown framework knowledge from model memory
- use stale/unverified technology knowledge for critical autonomous action
- bypass Action Gateway for external mutation
- broaden security/customer scope
- leak secrets or bypass DLP/data routing
- copy raw external source into generated source without rights/provenance
- self-approve independent review
- silently weaken tests/policies/invariants.
