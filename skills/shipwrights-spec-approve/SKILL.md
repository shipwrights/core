---
name: shipwrights-spec-approve
description: Approve a drafted spec so the build pipeline can proceed. Re-runs strict citation enforcement against the manifest, flips frontmatter status to `approved`, commits the marker. Invoked as /shipwrights-spec-approve <S-id>.
---

# /shipwrights-spec-approve — accept a drafted spec

You have read the plan document at `<spec.output_dir>/<id>-*.md` and decided it's good to build.

## What you do

1. Validate the spec exists and is at `status: drafted`.
2. Re-run citation enforcement on the plan body against the manifest at `.shipwrights/specs/<id>.manifest.json`. This catches the case where the user edited the plan between draft and approve and introduced uncited claims.
3. Flip frontmatter `status: drafted` → `status: approved`.
4. Commit on a small chore branch: `chore(spec): approve <id>`.
5. Print next-step: hand off to the standard build pipeline (which works against the approved spec the same way it works against an approved epic).

## Hard rules

- Refuse if the spec isn't `drafted`. Other statuses need different handling (revise, cancel, or simply later in the pipeline).
- Refuse if the working tree is dirty. The approve commit should be a clean marker.
- Honour `spec.enforcement`. Strict mode blocks on uncited claims; loose mode warns.

## Failure modes

| Symptom | What to do |
|---|---|
| Spec at `approved`/`building`/... | Refuse; suggest the right next slash command for that state |
| Manifest missing | In strict mode, refuse; in loose mode, warn and proceed |
| Dirty working tree | Refuse; ask user to commit/stash |
| Edits to the plan introduced uncited claims | List them; suggest revise |

## Output

```
✓ Spec <id> approved.
Next: /shipwrights-spec-build <id>
```

The CLI implementation lives at `lib/commands/spec-approve.mjs` — same behaviour either way.
