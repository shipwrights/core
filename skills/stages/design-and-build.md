# Stage: design-and-build

Specialists design and implement their slice in parallel on scratch branches. Each writes code, writes tests, runs verify, and signals done.

## Skip when

- Tier is `trivial` — orchestrator implements directly.
- An override `optional_when` evaluates true.

## What you (orchestrator) do

1. **Branch the integration feature branch off `branches.integration`.** Pattern from `branches.patterns.feature` (or `fix` / `chore` per the epic type).
2. **Run `scripts/shipwright/create-scratch.mjs <role>`** for each role this stage owns. That script:
   - Creates `<feature-branch>--<role>` off the feature branch.
   - Stays local-only by default (`scratch.push_to_remote: false`).
   - Records the role + branch in the in-flight register.
3. **Dispatch each specialist agent** in parallel (single message, multiple Agent calls). Each agent receives:
   - The refined epic.
   - The slice section (especially their slice + the contract surface + freeze paths).
   - Their declared `capabilities.scope` (the maximum they may touch).
   - The project's `verify` and `format_fix` commands.
   - The hard rules.
   - Their scratch branch name.
   - Instructions: write code on this branch, commit per logical task, run verify, signal done.
4. **Wait for all specialists to signal done.** Don't advance until every dispatched specialist returns.
5. **For each specialist, run scope verification.** `scripts/shipwright/verify-specialist-scope.mjs <role>` walks the diff vs feature branch, asserts every changed path is in the role's scope and not in `freeze_paths`. Failure → escalate that specialist's branch back to them with the violation list.

## What specialists do (handled in their own agent prompts)

The specialist agent prompts describe their workflow. You just dispatch and wait.

## Parallelism

Determined by the stage's `parallelism:` field. Defaults to `full` for design-and-build. Other options:

- `full` — dispatch all owners simultaneously.
- `sequential` — one at a time, in `owner:` order. Use when contracts emerge as the work proceeds.
- `none` — error if more than one owner declared.

## Failure modes

- **Specialist scratch branch fails verify.** Specialist signals done with a failure note. You either kick back to them (with the failing test names) or escalate.
- **Specialist wrote outside scope.** Scope enforcer rejects. Kick back with the violating paths.
- **Specialist touched a frozen path.** Re-slice required. Escalate to user.
- **Specialist hit a contract drift mid-build.** They escalate with a re-slice request. Escalate to user.

## What you produce

After all specialists signal done:
- N scratch branches, each with their commits.
- Each scratch branch passes the project's verify command on its own.
- Bump epic `status:` to `built` (per scratch branch — the epic stays at `built` until integrate completes).
- Update in-flight register with active specialist list.

You do **not** integrate yet. Integration is its own stage.

## Quality self-check before advancing

- Every dispatched specialist signalled done (none mid-flight).
- Every scratch branch passes scope verification (no out-of-scope writes, no frozen-path edits).
- Every scratch branch passes `verify` independently.
- Epic frontmatter `status: built`.
- In-flight register reflects the current state.
