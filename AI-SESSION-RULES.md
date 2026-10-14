<!-- //TR: Bu dosya Claude builder ve governed CLAUDE_REVIEWER oturumlarında (geçmişte Codex dahil) token/context tüketimini azaltmak için minimal boot sırasını, checkpoint kullanımını ve full-repo scan yasağını tanımlar. -->
# AI Session & Context Rules

Boot:
1. AGENTS/model contract
2. `.ai/MASTER_STATE.json`
3. current phase/milestone
4. `NEXT_ACTIONS.md`
5. diff/affected files
6. only related specs/tests/dependencies

Avoid rereading unchanged content.
Avoid reviewing unchanged blocked commits.
Use repository index/context router when available.
Run deterministic validation before expensive reasoning.
When context grows:
`CHECKPOINT -> STATE UPDATE -> NEW SESSION -> CONTINUE`
