# In-flight branches

Single source of truth for which feature/fix/chore branches are currently being driven by Shipwright. Read this on Stage 0; update on Stage 4 entry and on Stage 7 exit.

## Why this file exists

Multiple orchestrator sessions can run in parallel — one human running two Claude Code windows, two collaborators each driving an epic. They don't see each other's working state. Without a shared register, both can branch off `{{branches.integration}}`, both can pick the same item from the backlog, both can commit work that conflicts at push time. This register is a 60-second read that prevents the collision.

## How to use

**On Stage 0** (pick the epic): `/shipwrights:status` reads this. If the epic you're about to pick is already in flight, escalate — don't start a parallel branch.

**On Stage 4 entry** (build): a row is added when the orchestrator cuts the feature branch.

**On Stage 7 exit** (ship): the row is updated to mark the PR as awaiting merge. It's removed when the PR actually merges (handled by `post-merge-doc-update.yml`).

**Stale entries** (>48h with no commit on the branch and no orchestrator activity): `/shipwrights:status` flags them. The user decides whether to resume, archive, or delete.

## Format

| Branch | Epic | Stage | Tier | Active specialists | Updated |
|---|---|---|---|---|---|

_(none currently in flight)_

## Branches NOT to register

- The orchestrator's own session-housekeeping branches that get committed and pushed within the same minute.
- Experimental local-only branches that may not become PRs.

If unsure, register it. The cost of an extra row is zero; the cost of a missed collision is real.
