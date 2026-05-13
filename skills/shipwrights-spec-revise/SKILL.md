---
name: shipwrights-spec-revise
description: Record a revision request against a drafted spec, snapshot the current plan for history, append the note to the input, bump revisions counter. The actual re-analysis happens when /shipwrights-spec <id> is invoked next. Invoked as /shipwrights-spec-revise <S-id> <note>.
---

# /shipwrights-spec-revise — request changes to a drafted spec

You've read the plan and want substantive changes. Use this when the architect's analysis missed a constraint, picked the wrong approach, or the spec's acceptance is incomplete.

## What you do

1. Validate spec exists and is at `status: drafted`.
2. Snapshot the current plan to `.shipwrights/specs/<id>.r<N>.md` (N = revision counter + 1).
3. Append the note to `.shipwrights/specs/<id>.input.md` under a `## Revision N` heading.
4. Bump `revisions` in the plan frontmatter (or insert it if missing).
5. Leave `status: drafted` — the orchestrator skill will pick up the revised input next time `/shipwrights-spec <id>` is invoked.
6. Commit: `chore(spec): request revision N on <id>`.

## Hard rules

- Refuse if the spec isn't `drafted`. After approval, mid-pipeline changes need different handling (rerun specific stages, or cancel + new draft).
- Refuse if no note is supplied. A revision without a note is meaningless.
- Refuse if working tree is dirty.

## Output

```
✓ Revision N recorded for <id>.
  Snapshot: .shipwrights/specs/<id>.r<N>.md
  Note appended to: .shipwrights/specs/<id>.input.md

Next: /shipwrights-spec <id>     # re-runs analyze + plan with the revision
```

## Why snapshot the previous plan?

Audit trail. The user can compare revision N to revision N-1 by `diff .shipwrights/specs/<id>.r<N>.md docs/backlog/specs/<id>-*.md`. Useful when a chain of revisions is converging or diverging.

CLI implementation: `lib/commands/spec-revise.mjs`.
