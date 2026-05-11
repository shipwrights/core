---
name: shipwrights-status
description: Read the in-flight register and report what's currently being driven through the pipeline. Includes stale-entry detection (>48h with no commit). Invoked as /shipwrights:status.
---

# /shipwrights:status — what's in flight

Read the configured lock service and report on every active orchestration.

## What you do

1. **Load `.shipwrights.yml`** to determine the lock backend.
2. **Query the lock service** via `lib/lock-service.mjs` (the engine handles the kind dispatch; markdown / github-issues / custom).
3. **Render the table:**

   ```
   In flight:
   | Branch              | Epic     | Stage     | Tier  | Active specialists | Updated    | Stale? |
   |---------------------|----------|-----------|-------|--------------------|------------|--------|
   | feature/e-04-09     | E-04-09  | build     | full  | backend, frontend  | 2026-05-09 |        |
   | feature/e-04-08     | E-04-08  | review    | light | —                  | 2026-05-07 | ⚠ 48h  |

   Stale entries (>48h with no commit on the branch):
   - feature/e-04-08 has no commits since 2026-05-07 14:23. Resume, archive, or delete?
   ```

4. **Stale detection:** for each entry, check `git log --since=<48h ago> <branch>` (or whatever threshold is in `lock.config.stale_after_hours`). If empty, mark stale.

5. **Print a footer:**

   ```
   Lock backend: markdown (docs/process/in-flight.md)
   Stale threshold: 48h

   Operations:
     /shipwrights:epic <id>          — start or resume an epic
     /shipwrights:doctor             — validate config + agent availability
   ```

## When the register has no entries

Print:

```
Nothing in flight.

To start an epic:
  /shipwrights:epic <id>      — by id from your backlog
  /shipwrights:epic           — picks the next ready epic from <backlog source>
```

## Failure modes

- **Lock backend unreachable** (e.g., GitHub API down for the github-issues lock). Print the error, suggest checking auth / network.
- **Markdown register file missing** — propose creating it (writes empty register).
- **Permissions** — if the configured lock backend requires a token the orchestrator doesn't have, fail with a clear message naming which env var to set.
