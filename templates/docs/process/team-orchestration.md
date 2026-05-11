# Team orchestration

How a Claude Code session ships epics by spawning specialist sub-agents on scratch branches and integrating their work into a single PR.

## The team

| Role | Default agent | Responsibility |
|------|---------------|----------------|
| Product Owner | product-owner-strategist | Refines an item from the configured backlog source into user stories, acceptance criteria, and definition of done. |
| Backend architect | node-backend-systems-architect | Designs API surface, data model, transactions, event flows. **Writes code on `<feature-branch>--backend` scratch.** |
| Frontend architect | frontend-ui-architect | Designs UI composition, component breakdown, state ownership, accessibility, responsive behaviour. **Writes code on `<feature-branch>--frontend` scratch.** |
| QA | qa-quality-engineer | Writes test strategy and the actual tests on `<feature-branch>--qa`. Produces manual verification plan. |
| Code reviewer | code-review-gatekeeper | Reviews against repo conventions and acceptance criteria. May make small fix-up commits directly on the feature branch. |
| Browser reviewer | ux-ui-browser-reviewer | Exercises the running app via Playwright at named breakpoints. Read-only. Optional stage. |
| Integrating contributor | Claude (this session) | Orchestrator. Slices, dispatches specialists, integrates scratch branches, runs guards, opens the PR. |

The agents above are the bundled defaults. Each is configurable in `.shipwrights.yml` under `roles[].agent` — bundled, user-global, custom path, or npm package.

The orchestrator does **not** write code on the integration feature branch during the build stage — specialists do that on their scratch branches. The orchestrator integrates.

## Pipeline

```
┌─────────┐   ┌────────┐   ┌──────────────────┐   ┌───────────┐   ┌──────┐   ┌────────┐   ┌──────┐
│ Refine  │──▶│ Slice  │──▶│  Design + Build  │──▶│ Integrate │──▶│ Test │──▶│ Review │──▶│ Ship │
└─────────┘   └────────┘   └──────────────────┘   └───────────┘   └──────┘   └────────┘   └──────┘
```

Stages, owners, parallelism, and tier-routing live in `.shipwrights.yml` under `pipeline:` and `tiers:`.

## Decision rights

| Decision | Owner |
|----------|-------|
| Acceptance criteria | PO agent |
| API contract shape | Backend architect |
| Component decomposition | Frontend architect |
| Test coverage threshold | QA agent |
| Scope cuts during build | Orchestrator (escalate to user if blocking) |
| Architecture-level deviations from ADRs | User |
| Storage technology choices | User |
| Pushing to protected branches | User (orchestrator never pushes to protected branches directly) |
| Opening a PR | Orchestrator |

## Owner of record

When two reviewers can plausibly catch the same defect, the *primary* reviewer is on the hook. Secondaries provide redundant coverage but do not block.

| Concern | Primary | Secondary |
|---|---|---|
| Style / formatting / token violations | gatekeeper (static) | browser (rendered) |
| Responsive breakage | browser | — |
| Accessibility — keyboard, focus, ARIA | browser | gatekeeper |
| Public-id leakage | gatekeeper | — |
| Permission-gate correctness | gatekeeper (logic) | browser (UX gating) |
| API contract shape | backend | gatekeeper |
| Schema migration safety | backend | gatekeeper |
| Component decomposition | frontend | gatekeeper |
| Acceptance-criteria coverage | qa | po |
| Test depth | qa | — |

## Working agreement

These remain in force from the project's CLAUDE.md / AGENTS.md:

- Branch names match the project's branch-name guard pattern.
- Conventional commits with the appropriate scope.
- One epic = one PR if size permits; otherwise plan the split.
- The project's `verify` command must pass locally before push.
- Public APIs expose slugs / reference numbers / approved UUIDs, never raw DB ids.
- Append-only ledgers stay append-only.

## How to invoke

```
/shipwrights:epic <id>          # drive a specific epic
/shipwrights:epic               # pick the next ready epic
/shipwrights:status             # see what's in flight
/shipwrights:doctor             # validate config + agents
```
