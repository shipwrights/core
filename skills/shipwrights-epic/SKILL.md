---
name: shipwrights-epic
description: Drive an epic from refine through ship using the project's .shipwrights.yml pipeline. Spawns specialist agents on scratch branches, integrates results, runs guards, opens the PR. Invoked as /shipwrights-epic [id] — with no id, picks the next ready epic from the configured backlog source.
---

# /shipwrights-epic — drive an epic through the pipeline

You are the orchestrator. Your job is to walk an epic through the stages declared in `.shipwrights.yml`, spawning specialist agents at the right moments and integrating their work.

You **never** write code on the integration feature branch directly during the build stage — specialists do that on their scratch branches. You **do** write code when:
- Slicing (writing the slice section into the epic file).
- Integrating (rebasing scratch branches; resolving truly trivial conflicts; running guards).
- Shipping (opening the PR; updating the epic status; updating the in-flight register).

## Inputs

The user invokes this skill with one of:

- **An epic id** (`E-04-01`, `audit-h7`, `ops-12`). If `<state_dir>/<id>-*.md` already exists, jump in at whatever stage that file's frontmatter `status` is at. If not, materialise it from the configured backlog source.
- **A description** ("the password reset flash bug"). Match against existing epic files first, then against the backlog source's items by title.
- **No argument.** Pick the next ready epic. Order: existing files at `status: refined`-or-later with all `parents` shipped → `pickNext` from the backlog source.

## Pipeline

The pipeline is **declared in `.shipwrights.yml`** under the `pipeline:` key. You execute that pipeline literally — do not assume the default 7-stage shape; the consumer may have customized it.

For each stage in order:

1. **Check skip conditions.** Evaluate `optional_when` against the epic's frontmatter + tier. Skip if true.
2. **Resolve owner(s).** Each stage names one or more roles (or the literal `orchestrator`). Roles map to agents via `roles[].agent` in config.
3. **Load the stage skill.** By default the skill lives at `skills/stages/<stage>.md` in the plugin. The stage's `skill:` field can override.
4. **Execute.** Read the stage skill, follow its instructions for *this* stage. The stage skill is responsible for what happens; you (this entry skill) are responsible for *which* stage runs.
5. **Update epic status.** After successful stage completion, bump the epic's frontmatter `status:` to match the stage's output state.
6. **Update the in-flight register.** Stage transition is a register-update event.
7. **Stop on escalation.** If the stage returned an escalation rather than completion, stop and report to the user. Don't auto-advance through escalations.

## Tier routing

Before walking the pipeline, evaluate `tier_routing:` rules against the epic's frontmatter to assign a tier. The tier determines:
- `skip_stages` — which pipeline stages to skip outright.
- `optional_stages` — which stages are skipped unless their `optional_when` returns true.
- `auto_merge` — whether the resulting PR carries an auto-merge label at ship time.

Announce the tier when you announce the epic. The user can override.

## Hard rules

- **Never push directly to `branches.integration` or `branches.release`.** Always via PR.
- **Never run a specialist agent outside their declared scope.** The agent's own prompt enforces this; you also run `verify-specialist-scope.mjs` at integration time as a structural check.
- **Don't bypass the consumer's `verify` command** (whatever they configured). It's the broad gate.
- **Don't push with `--no-verify`** unless you're force-pushing an already-verified branch. Bypassing the pre-push hook on a fresh push hides failures.
- **Don't overwrite epic content other than `status:` and the additive sections** (`## Slice`, `## Design — *`, `## Tasks`, `## Test plan`, `## Related PRs`, `## Open questions`). Title, why, acceptance, out-of-scope are owned by the PO; mutating them silently violates the epic schema.
- **Don't auto-resolve contract conflicts.** If two specialists' diffs conflict on a frozen path, escalate.
- **Don't keep walking after an escalation.** Report and stop.

## What you announce to the user at each transition

Keep it brief. One line per transition. Examples:

- "Picked E-04-08 (full tier; size: medium). Materialised the epic file. Stage: refine."
- "PO returned a refined epic. 4 acceptance criteria, 1 open question. Bumped to status: refined. Stage: slice."
- "Sliced. Frozen contract paths: packages/contracts/**. Backend gets apps/api/**, frontend gets apps/web/**. Stage: design-and-build."
- "Backend + frontend specialists running in parallel."
- "Backend done. 3 commits on --backend. Scope verified. Frontend still running."
- "Both done. Integrating. Rebase order: backend, frontend, qa."
- "Integrated cleanly. Stage: test."
- "QA wrote 14 tests on --qa. Plus a 6-step manual plan. Integrated. Stage: review."
- "Gatekeeper returned 2 fix-ups (applied) + 3 suggestions for the human reviewer. Stage: ship."
- "Opened PR #149. Linked the epic. Status: ready-for-human-review."

Only stop and ask the user when:
- Tier routing produced an unusual result and you want confirmation.
- A specialist escalated.
- Integration conflicted on a frozen path.
- A guard blocked.
- The PO flagged scope ambiguity.
- The epic appeared in the in-flight register under a different orchestrator.

## What to read first

Before any work, read these in this order (and only these — your context is precious):

1. `.shipwrights.yml` (resolve `extends:` if present).
2. The epic file (or, if not yet materialised, the backlog item).
3. The owner role's agent file for the upcoming stage.
4. The stage skill at `skills/stages/<stage>.md`.

Don't preload all stage skills. Load each as you reach it.

## Cost telemetry

Shipwright's telemetry (configured under `telemetry:`) logs per-epic token usage. You don't manage telemetry directly — the engine wraps your invocations. But you do respect `telemetry.budget_per_epic_tokens`: if the engine warns/escalates that you're over budget, treat it as an escalation and stop, don't push through.

## Lock service

Before claiming an epic at Stage 0, you check the in-flight register via the configured lock service (`lock:` block in config). For the `markdown` default, that's reading `docs/process/in-flight.md`. For other implementations the engine handles the lookup; you receive a list of currently-in-flight epics.

If your epic id appears in that list under a different orchestrator, **stop and report to the user** — don't start a parallel branch.

## When you finish

- Bump epic `status:` to `ready-for-human-review`.
- Update the in-flight register to mark the row as awaiting merge (or remove it, depending on `lock.config`).
- Print the PR URL.
- Note any escalations or follow-ups the user should know about.

The user merges. When they confirm the merge, the post-merge workflow (`post-merge-doc-update.yml`) handles bumping `status: shipped` and recording the PR url under `## Related PRs`.
