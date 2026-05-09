# Epic files

Each `.md` file in this directory represents an epic that Shipwright is driving (or has shipped). The PO agent materialises files from the configured backlog source; the orchestrator advances them through the pipeline.

## Frontmatter contract

```yaml
---
id: E-XX-XX                      # unique within this dir
title: Short imperative title
status: idea | discovery | refined | designed | sliced | planned | built | integrated | tested | reviewed | ready-for-human-review | shipped
priority: P0 | P1 | P2 | P3
domain: frontend | backend | full-stack | infra | security | docs
owner: claude | <human-handle>
parents: []                      # other epic ids this depends on
acceptance:
  - User-facing criterion
  - Another criterion
size: small | medium | large
---
```

## Body sections

```
## Why
The user, the outcome, the constraint.

## Acceptance
Mirrors frontmatter `acceptance:`, expanded.

## Out of scope
Explicit cuts.

## Edge cases
Failure modes and unhappy paths.

## UAT scenarios
Manual flows that demonstrate the criteria are met.

## Dependencies
Other epic ids this depends on (mirrors frontmatter `parents:`).

## Open questions
Anything the PO couldn't resolve from input + context.

## Slice
Filled at Stage 2 by the orchestrator. Names what each specialist owns.

## Design — backend / frontend
Filled at Stage 3 by the relevant architect.

## Test plan
Filled at Stage 5 by QA.

## Related PRs
Auto-appended on merge by the post-merge workflow.
```

## Lifecycle

- `status: shipped` epics are immutable. Re-opening creates a new epic with `parents: [<old-id>]`.
- `priority` may change at any time.
- Orchestrator only mutates `status:` and the additive sections (`## Slice`, `## Design — *`, `## Tasks`, `## Test plan`, `## Related PRs`, `## Open questions`).
