<!-- //TR: Builder envanter raporları (V4.1 teslim modu, 2026-11-05 ~19:25Z): her builder'ın push edilmemiş yerel işi, HELD dalları ve süpersede edilmiş dalları. Yalnız yerelde kalan iş burada açıkça "risk" olarak işaretlenir. -->
# Builder inventory reports (2026-11-05 ~19:25Z, V4.1 delivery mode)

Each builder reported its unpushed local commits, comparing local and remote branches by SHA and patch-id.

| Builder | Unpushed local work | Notes |
|---|---|---|
| A | **2 local-only follow-ups:** `t0116-fu` ee5366e0 (T0116 review NB-1/NB-2/LOW + manifest heartbeat line); `t0065-fu` f129c29e (T0065 omniroute-client pins). Requested from A as patches, to be pushed HELD. | T0117 d6a0cfe2 discarded (D owns T0117). Bell 2297c341 pushed by the coordinator. |
| C | none | #403 (T0111, draft) 9b5740a2 delivered. Idle. |
| D | **local-only:** `reviewer-oauth-probe` 47d6c4ba (Founder-held OAuth probe). Requested as a patch. | t0117 71acc4cf is held as a patch by the coordinator (prompts to be read; exclude trig_01BiCM). qa-n2-ps1a is superseded by the #361 head. qa-windows-flakes has nothing pending. |
| E | none | 9 branches: PRs #364 #372 #374 #381 #386 #390; HELD command-field-on-364 23208871, attention-flags a5b1a18b, reconnect-f1 3bb7bf21. AUD-022 diffs are preserved in `founder-proposals/aud022/` (sha256 verified). |
| F | none | Current stack: #385 aff94627 → polish-2-2 a9f48863 → polish-3-2 11c08cad → a11y-2 32eb0aba. Superseded (do not merge): design-system 73300c9f (#365 closed), layout-fixes 4d5df0a1 (#376), polish-2 d363e08f, polish-3 cb11201e, a11y 4c6004af. Open item: re-pin the visual-parity palette (Founder). |
| G | not yet reported | Assurance-core newest-500 work in progress. |
| H | none | PRs #366 #373 #379 #383 #387. HELD: 373-f1 80ce14b9, 379-nb a386d43e, tour-a11y bf2fed4b, work-polish da252f6c. Screenshots and reports under /tmp are reproducible from scripts on the branches. |
| I | none | Two local-only empty branches at 5518e36b. The #393/#395 conflict resolution is planned (keep both sides). |

## Task-index staleness audit (Builder A, read-only, base 59c06dd)

A. The index says not done, but the task is merged (20): T0116 → #332; T0006 → #318 #323 #329; V3-T1001 → #303 #321; V3-T1012.a → #324; T0010 → #312; T0045 → #309; T0050 → #319 #320 #326; T0062 → #311 #316 #317; T0065 → #322; CLOUD-T0001/2/3/4/5/8/10/11/12/15 (see the PRs in the audit).

B. The task is MISSING/PROPOSED but has an open PR: T0088 #398, T0111 #403, T0124 #396, T0129 #391, V3-T1016 #360, V3-T1032 #380, T0004.A #386, T0016.A #390.

C. Open PRs on SPLIT/BLOCKED IDs (FOUNDER_REQUIRED): T0007 #370; T0011 #372 #381; T0020 #374; T0081 #400; T0083 #367 #399; V3-T1027 #363.

D. Other:
- CLOUD-T0016 is used in #361 and in merged commits, but it is absent from the index.
- UASCO-T0124 (#396) is a supervisor-only register task ("LLM yazmaz"). A builder PR on it may clash with the task's owner, so a Founder decision is recommended before it merges.

The index is supervisor-owned and was not edited.
