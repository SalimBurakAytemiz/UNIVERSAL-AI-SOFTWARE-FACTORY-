<!-- //TR: UI-047 güvenlik bulgu ayrıntısı tasarım notu (salt-okunur, yalnız renderer). -->
# UI-047 — Security finding detail (#/assurance, `#qa-secdetail`)

Enhancement of the existing panel (inventory: fold into UI-046); no new screen or route. Renderer-only, text-only (`h()`/`textContent`).

- Source: `run.evidence` SECURITY_REPORT `sca.findings[]` (the server keeps up to 200; the UI shows at most 50 and says so when truncated) and `secrets.gitleaks.items[]` (UI cap 100) from the already-allow-listed `GET /v1/work-runs`.
- Mapping (`assurance-core.js`): whitelisted fields only; severity from the allow-list `CRITICAL|HIGH|MEDIUM|LOW|INFO|UNKNOWN` (anything else `UNKNOWN`); commit 40-hex or null; line safe int or null; malformed entries dropped and counted. `fixedVersion` and any secret value are never carried.
- States: missing or non-array list => "not recorded" (UNKNOWN), never clean; empty list => "no findings" note only when the tool status is exactly `CLEAN` or `FINDINGS`, otherwise (ERROR/PARTIAL/other) the not-recorded UNKNOWN note; truncation note when `truncated`, over the cap, or the aggregate count exceeds the list; no scan => NOT_EXECUTED (no tables); unbound scan keeps the STALE banner.
- No fix/resolved/accepted state, no POST, endpoint, IPC or storage. SAST stays NOT_AVAILABLE. No product verification or design parity claim.
- Tests: `tests/v7-ux-wp-qasec.test.ts`.
