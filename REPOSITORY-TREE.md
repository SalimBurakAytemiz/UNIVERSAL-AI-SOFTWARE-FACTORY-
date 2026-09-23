<!-- //TR: Bu dosya Full Woven Canonical Starter'ın source-of-truth klasörlerini ve eski "boş klasör implementation sayılır" hatasını engelleyen registry-first/runtime-proof yaklaşımını gösterir. -->
# Repository Tree

```text
.ai/                         canonical build/checkpoint state
.github/workflows/           CI gates
apps/
  control-api/
  desktop/
automation/                  Claude -> validation -> Codex supervisor skeleton
core/
  action-gateway/
  authority/
  capabilities/
  competency/
  decision/
  knowledge/
  mission/
  policy/
  resources/
docs/
  architecture/
  closure/
  governance/
evaluations/
  agents/                    363 certification contracts
knowledge/
  technologies/              one knowledge-unit contract per seed technology
models/
organization/
  agents/                    363 canonical V2 agent genomes
  departments/               40 department technical charters
playbooks/
  v2/
registries/
  agents.json
  agent-competency-v2.json
  agent-skill-matrix.json
  agent-tool-policy-v2.json
  technologies.json
  technology-relations.json
  technology-agent-depth.json
  skills-v2.json
  phase-contracts-index.json
roadmap/
  contracts/                 every phase has entry/deliverable/test/evidence/review/exit contract
schemas/
scripts/
standards/
  v2/
tests/
```

A registry/file is specification, not runtime proof.
