<!-- //TR: Bu belge SC-14 Proje Belleği (I-DP-039, UI-160) çekirdek modülünün ne olduğunu, durumunu ve API entegrasyonu için hâlâ gerekenleri kısaca anlatır. -->
# Project Memory core (SC-14 / I-DP-039, PQ-007)

**Status: TESTED (unit, Linux). Not INTEGRATED.** Windows: NOT_EXECUTED. No endpoint, IPC or UI exists yet.

## What exists

- `core/knowledge/project-memory-types.ts` defines the kinds, the limits, the record and health types, and `ProjectMemoryError`.
- `core/knowledge/project-memory.ts` defines the `ProjectMemory` class. It takes an injected `rootDir`, a `projectId` (`prj_` + 24 hex) and an optional `now()` clock.
- Storage is one append-only JSONL file per project at `<rootDir>/projects/<projectId>/memory/journal.jsonl`, with a lock file next to it from the existing `process-lock` helper.
- Each record carries `seq`, `id` (`mem_NNNNNN`), `at`, `kind`, `projectId`, `title`, `body`, `sources[{ref, sha256?, retrievedAt}]`, `supersedes?`, `tags`, `author{role, sessionId?}`, `prevHash` and `hash`. The `kind` is one of `DECISION`, `FACT`, `SOURCE`, `REVISION` or `NOTE`.
- `hash` is the canonical sha256 over every other field, using the same helper as the Work OS store. The chain starts at 64 zeros.
- `verify()` returns one of these states and never repairs or truncates the file:

  | State | Meaning |
  |---|---|
  | `OK` | The chain is intact. |
  | `ABSENT` | No journal file exists. |
  | `TAMPERED` | A record was edited or reordered, has a bad field or a bad supersedes, or there is foreign trailing data. The reason is reported, e.g. `HASH_MISMATCH:n`, `SEQUENCE_BROKEN:n`, `CHAIN_BROKEN:n` or `TRAILING_GARBAGE`. |
  | `TORN_TAIL` | The last line is a partial prefix of the expected next record. |

- What the API allows in each state:
  - **`TAMPERED`:** reads and writes both fail with `MEMORY_TAMPERED`.
  - **`TORN_TAIL`:** reads return the verified prefix, and writes fail with `MEMORY_READ_ONLY`.
- Queries:
  - `list({kind, tag})`;
  - `search(text)`, a plain case-insensitive match that never treats the text as a regex;
  - `currentView()`, which gives the head of each supersession chain plus its history;
  - `provenance(id)`, which gives the lineage with sources, authors and hashes, plus the current head;
  - `get(id)` and `all()`.
- Writes fail closed in these cases:
  - **Invalid project id:** a projectId that does not match the pattern.
  - **Unsafe path:** a root or memory path that cannot be canonicalized or resolves outside the root, including through a symlink (`core/workos/path-guard.ts`).
  - **Secrets:** any secret in the title, body, source refs, tags or sessionId (`core/workos/secret-scan.ts`). The error names only the kinds found, never the value.
  - **Size limits:**
    - the body is at most 32 KB (UTF-8 bytes);
    - there are at most 32 sources;
    - the title is at most 200 characters.
  - **Malformed input:** an unknown kind, or malformed sources, tags or author.
  - **Bad supersedes target:** a supersedes that points to a missing id (`MEMORY_SUPERSEDES_MISSING`), or to a record that is already superseded (`MEMORY_SUPERSEDES_NOT_HEAD`), so chains stay linear.
- The module adds no network access, no new dependency and no global state.
- Tests are in the `SC-14 Project Memory core` block of `tests/technology-discovery.test.ts`.

## What integration still needs

- **API and desktop wiring.** HTTP routes go in `apps/control-api/src/server.ts` and the desktop GET allow-list in `apps/desktop/main.mjs`. Both are protected trust-root files, so this **requires Founder protected-file authority**.
  - A proposal is in `PROJECT-MEMORY-INTEGRATION.proposed.patch`. It is **not applied**.
  - It passes `git apply --check` against `v7/integration` a910883 and typechecked in an isolated copy.
  - It is not tested at the HTTP level.
- **UI.** The UI-160 screen (memory revisions and decision versions) has no route or view yet.
- **Authorization.** Author role binding and per-role write authorization are not decided. The proposal uses the server actor.
- **Retention and export.** Retention, export and the tenant-wide backup policy are not designed.
- **Repair.** No repair flow exists. A `TORN_TAIL` repair would need an approved, quarantine-first flow like the Work OS `REL-FX-4` one.
