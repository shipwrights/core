# Stage: ship

The orchestrator pushes the feature branch, opens the PR, links the epic, and updates state.

## What you (orchestrator) do

1. **Push the feature branch** to `origin`. If you've been pushing scratch branches and integrating locally, this is the first push of the feature branch. Use `git push -u origin <feature-branch>` (without `--no-verify` — the pre-push hook running verify is a final safety net).
2. **Open the PR.** Title: `<type>(<scope>): <one-line summary>` per the project's commit conventions. The scope is the epic id (or `ops` for chore branches).
3. **PR body.** Use the project's PR template if one exists at `.github/PULL_REQUEST_TEMPLATE.md`. Otherwise:

   ```
   ## Summary
   <one paragraph from the epic ## Why>

   ## Changes
   <bullet list per role's slice, summarizing what they shipped>

   ## Acceptance criteria
   <each criterion from the epic, with a "✓ verified by …" reference>

   ## Test plan
   <QA's manual plan>

   ## Browser review (if run)
   <coverage summary + any non-blocking findings>

   ## Linked epic
   <state_dir>/<id>-<slug>.md
   ```

4. **Apply the auto-merge label** if the tier's `auto_merge: true`. Typically `tier:trivial` or `tier:minimal`. The auto-merge workflow (template) handles the merge once CI passes.
5. **Bump epic `status:` to `ready-for-human-review`.**
6. **Update the in-flight register.** Mark the row as awaiting merge. Don't remove yet — keep until the PR actually merges so a second orchestrator doesn't try to chain on top of an unmerged PR.
7. **Print the PR URL** to the user. Note any:
   - Suggestions captured during review for the human to decide on.
   - Manual verification steps they need to run.
   - Open questions the PO surfaced.

## Hard rules

- **Never push to `branches.integration` or `branches.release` directly.** PR only.
- **Never merge the PR yourself.** The user merges (unless auto-merge is configured for the tier).
- **Don't skip pre-push hook with `--no-verify`** unless the hook has already passed once on this exact tip and you're force-pushing.

## Failure modes

- **Push rejected (branch protection / non-fast-forward).** Diagnose. If the integration branch advanced while you were working, rebase the feature branch and retry.
- **PR creation fails.** Usually auth. Don't auto-fix; report.
- **Pre-push verify hook fails.** The integration is wrong somewhere. Don't `--no-verify`; trace the failure.

## Post-merge

The post-merge-doc-update workflow (template, `.github/workflows/post-merge-doc-update.yml`) handles:
- Bumping the epic file's `status: shipped`.
- Appending the merged PR URL to `## Related PRs`.
- Removing the row from the in-flight register.

That happens via a follow-up `tier:trivial` PR which auto-merges via the auto-merge workflow.

## Quality self-check before signalling done

- Feature branch pushed.
- PR opened with full body.
- Auto-merge label applied if applicable.
- Epic frontmatter `status: ready-for-human-review`.
- In-flight register updated.
- PR URL printed for the user.
