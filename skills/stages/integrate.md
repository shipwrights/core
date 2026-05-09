# Stage: integrate

The orchestrator merges scratch branches into the feature branch in a deterministic order, runs guards at the boundary, and produces a single coherent feature branch.

## Skip when

- Tier is `trivial` (no specialists ran).
- No scratch branches exist (the previous stage didn't produce any).

## What you (orchestrator) do

1. **Read `integrate.order:`** from the stage config (e.g., `[backend, frontend, qa]` — though qa is typically post-integrate, not part of this stage).
2. **For each role in order**, run `scripts/shipwright/integrate-scratch.mjs <role>`:
   - The script rebases `<feature-branch>--<role>` onto the current tip of the feature branch.
   - On clean rebase: fast-forwards the feature branch to the new tip. Deletes the scratch branch (if `scratch.cleanup_on_integrate: true`).
   - On conflict: stops. Calls `bundle-on-failure.mjs` to save the scratch state. Reports the conflict.
3. **After each role's integration, run guards** configured to fire at `before-integrate` (or unscoped guards). Block if any guard returns `block`.
4. **Run the project's `verify` command** on the integrated feature branch. The combined diff has to pass — passing in isolation per scratch isn't sufficient.
5. **Bump epic `status:` to `integrated`** when all roles done and verify clean.
6. **Update in-flight register** to remove the active-specialist list (none active now; epic is back to whole-branch state).

## Conflict handling

`integrate.on_conflict:` from config:

- `escalate` (default) — stop, save state via bundle, report to user. Don't auto-resolve.
- `auto-rebase` — only safe for trivial conflicts (whitespace, import-order). Reserved for future; not in v1.

## Frozen-path conflicts

If two scratch branches both touched a frozen path (slice contract surface), this is a contract drift. The scope enforcer should have caught it during build, but if it slipped through:

1. Stop integration immediately.
2. Bundle the scratch state.
3. Escalate as a re-slice event.

Don't try to merge contract changes from two branches. The slice was wrong; that's a design event, not a merge event.

## Verify failure post-integration

If `verify` passes per-scratch but fails post-integration, the failure is interaction between specialists' work. This is the integration's whole reason for existence.

1. Identify which specialist's commits introduced the regression (`git bisect` if needed; usually it's the most recent integration).
2. Kick back to that specialist with the failing test / type / lint output.
3. They fix on their scratch branch (re-create from the now-modified feature branch tip if needed).
4. Re-run integration.

## What you produce

- A single feature branch with all specialists' commits in `integrate.order`.
- Scratch branches deleted (if cleanup configured).
- Epic at `status: integrated`.
- Guards passed.
- Project verify command clean.

## Quality self-check before advancing

- Feature branch tip = sum of all integrated scratch commits, in order.
- No scratch branches still exist (or kept intentionally per config).
- All `before-integrate` guards passed.
- `verify` clean on the integrated state.
- No frozen-path mutations in the final diff.
