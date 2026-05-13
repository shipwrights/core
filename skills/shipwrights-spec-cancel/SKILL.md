---
name: shipwrights-spec-cancel
description: Tombstone a drafted or in-flight spec. Sets status to `cancelled`; the file stays in place for audit. Refuses on shipped or already-cancelled specs. Invoked as /shipwrights-spec-cancel <S-id>.
---

# /shipwrights-spec-cancel — abandon a spec

Use this when:
- The drafted spec is wrong-direction and revising won't fix it
- Priorities changed and the work isn't needed anymore
- The spec was created by mistake

## What you do

1. Validate spec exists.
2. Refuse if `status` is `shipped` or already `cancelled` (terminal states).
3. Flip frontmatter to `status: cancelled`.
4. Commit: `chore(spec): cancel <id>`.
5. If the spec was past `approved`, note that scratch branches may exist (`<feature>--backend`, `--frontend`, `--qa`) and need manual cleanup.

## Hard rules

- The file is **not deleted**. It stays as an audit trail.
- After `cancel`, the orchestrator (`/shipwrights-spec`, `/shipwrights-spec-approve`, `-revise`) refuses to act on this id.
- Cancelling mid-build leaves scratch branches; the user cleans them up.

## Output

```
✓ Spec <id> cancelled.
The file stays in place as an audit trail.
```

If past `approved`:

```
Note: status was "<previous-status>" — scratch branches may still exist.
Clean them up manually with: git branch | grep -- '--' | xargs git branch -D
```

CLI implementation: `lib/commands/spec-cancel.mjs`.
