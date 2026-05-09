# Stage: refine

The PO agent turns a raw backlog input into a refined epic file.

## Skip when

- The epic file already exists with `status: refined` or later — you're resuming, not refining.
- Tier is `trivial` or `minimal` — these skip refine per the tier defaults.
- An override `optional_when` evaluates true against the epic frontmatter.

## What you (orchestrator) do

1. **Resolve the input.** If an epic id was given but no file exists, ask the configured backlog source for the item. If a description was given, match against backlog items.
2. **Gather context.** Read the project's CLAUDE.md / AGENTS.md, the closest ADR, the relevant audit doc. Don't load everything — pick what's likely relevant from the input.
3. **Spawn the PO agent.** Hand it:
   - The raw backlog input (item from source).
   - The project context you gathered.
   - The project's epic-file schema (from `<state_dir>/README.md` if present, otherwise the default schema in `templates/docs/backlog/README.md`).
   - The hard rules from `.shipwright.yml`.
4. **Receive the refined epic.** It will be markdown text.
5. **Write the file.** At `<state_dir>/<id>-<slug>.md`. If the file existed (e.g., status: idea), overwrite. If not, create.
6. **Bump status.** `status: refined`.
7. **Commit on a chore branch.** `chore/ops-refine-<id>` with message `chore(ops): refine <id> via PO agent`. Push. (Light tier folds this into the feature branch instead — see tier rules.)

## Inputs to the PO

- Backlog item (id, title, description, status, priority, size hints if available).
- Project context (paths to read, not content).
- Hard rules (verbatim from config).
- Epic-file schema (frontmatter required fields + body section conventions).

## Output the PO returns

A single markdown document the orchestrator writes to `<state_dir>/<id>-<slug>.md`.

## Escalations to expect

- **Scope ambiguity.** The PO can't write unambiguous acceptance from the input. They surface it under `## Open questions`. Stop, report to user.
- **Missing dependencies.** The input names dependencies on other backlog items the PO can't resolve. Stop, report.
- **Conflicting requirements.** Two parts of the input contradict. Stop, report.

## What you skip on minimal / trivial tiers

If tier is `minimal` (ops/audit) or `trivial`, the PO is not invoked. The orchestrator copies the backlog item's user story + notes verbatim into a refined-shaped epic file and bumps status to `refined`. Note in the user-facing message that PO was skipped because the input was self-describing.
