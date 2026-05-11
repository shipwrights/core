# @shipwrights/core

> An orchestration framework for shipping epics with AI specialists. Drives a backlog item from refinement through ship — refine, slice, design+build, integrate, test, review, ship — by coordinating specialist sub-agents on scratch branches and integrating their work into a single PR.

[![npm version](https://img.shields.io/npm/v/@shipwrights/core.svg)](https://www.npmjs.com/package/@shipwrights/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-89%20passing-brightgreen.svg)](#testing)

## What it is

Shipwrights sits between you and your Claude Code session. You give it a backlog item; it walks the item through a configurable pipeline by spawning specialist sub-agents — PO, backend, frontend, QA, gatekeeper, browser-reviewer — and ships a PR at the end. The orchestrator (Claude Code) coordinates; the specialists own design and build on their own scratch branches; you review what comes out.

The pipeline, roles, source-of-truth (files / GitHub Issues / Jira / custom), guards, and verification commands are all declarative. Shipwrights doesn't lock you into one workflow — it executes whatever workflow you describe in `.shipwrights.yml`.

## Quick start

```bash
# 1. Install
npm install -D @shipwrights/core

# 2. Scaffold (non-destructive, single git commit, dry-runnable)
npx shipwrights init

# 3. Install the deps init added to your devDependencies
npm install

# 4. Validate
npx shipwrights doctor

# 5. One-time: GitHub labels for the auto-merge + post-merge workflows
gh label create tier:trivial --color cccccc
gh label create tier:minimal --color e8e8e8
gh label create do-not-auto-merge --color d93f0b
```

`init` already copied the bundled skills + agents into `.claude/skills/shipwrights/` and `.claude/agents/shipwrights/` for you. Restart your Claude Code session in this project and you'll see five new slash commands:

```
/shipwrights-epic <id>     # drive an epic from refine → ship
/shipwrights-init          # one-time scaffold (you ran this in step 2)
/shipwrights-status        # see what's in flight across orchestrator sessions
/shipwrights-upgrade       # bump templates + run config migrations
/shipwrights-doctor        # validate config + agent availability
```

> **Status:** v0.2.x. The CLI (`init`, `doctor`, `status`, `upgrade`) is stable. `init` and `upgrade` automatically wire `.claude/skills/shipwrights/` and `.claude/agents/shipwrights/` so Claude Code picks up the plugin without manual symlinks. The `shipwright` (singular) CLI alias keeps working through one minor version for v0.1 consumers.

## How it works

```
┌─────────┐   ┌────────┐   ┌──────────────────┐   ┌───────────┐   ┌──────┐   ┌────────┐   ┌──────┐
│ Refine  │──▶│ Slice  │──▶│  Design + Build  │──▶│ Integrate │──▶│ Test │──▶│ Review │──▶│ Ship │
└─────────┘   └────────┘   └──────────────────┘   └───────────┘   └──────┘   └────────┘   └──────┘
   PO           orches-       specialists in            orches-      QA on     gatekeeper    orches-
   read-        trator        parallel on               trator       --qa      read +        trator
   only         defines       scratch branches:         rebases      scratch   small         opens
                contract      backend, frontend         onto         branch    fix-up        PR
                              each on their own         feature                commits to
                              --backend, --frontend     branch in               feature
                                                        fixed order             branch
```

| Stage | Owner | Output |
|---|---|---|
| 1. Refine | `product-owner-strategist` | A refined epic file with acceptance criteria, edge cases, UAT scenarios |
| 2. Slice | orchestrator | A contract surface declaration: who writes where, what's frozen |
| 3. Design + Build | architects in parallel | Code on per-role scratch branches |
| 4. Integrate | orchestrator | Single feature branch with each scratch rebased in order |
| 5. Test | `qa-quality-engineer` | Tests on `--qa` scratch + manual verification plan |
| 6. Review | `code-review-gatekeeper` (+ optional `ux-ui-browser-reviewer`) | Blocks / fix-ups / suggestions |
| 7. Ship | orchestrator | PR into your integration branch |

Tiers (`trivial / minimal / light / full`) skip stages automatically — a docs typo doesn't need a PO + architect + QA pipeline.

## When to reach for Shipwrights (vs alternatives)

| Tool | What it is | When it fits | When Shipwrights fits better |
|---|---|---|---|
| **Plain Claude Code / Cursor** | One agent, conversational | A single change you can hold in one head | When the work spans backend + frontend + tests + review and you want explicit handoffs + scope enforcement |
| **CrewAI / AutoGen / LangGraph** | Python multi-agent frameworks | Building agent applications from primitives | When you want Claude-Code-native + GitHub-native + scratch-branch isolation out of the box |
| **Devin / Cursor Agents / managed AI engineers** | Hosted services that ship PRs autonomously | You want a black box that produces PRs | When you want to *configure* the pipeline (roles, stages, hard rules) per project, and own the agents |
| **GitHub Actions / Argo Workflows** | Workflow engines for CI/CD | Orchestrating builds, deploys, infrastructure | When the workflow's primitives are *AI agents writing code*, not shell jobs |
| **`gh pr create` + manual review** | The status quo | Solo work, short feedback loops | When you want consistent enforcement of acceptance criteria, scope, and review boundaries across many PRs |

Shipwrights is closest in shape to **Prisma** — declarative config (`schema.prisma` ↔ `.shipwrights.yml`), a CLI that operates on it (`prisma migrate` ↔ `shipwrights epic`), and a plugin ecosystem (Prisma Adapters ↔ `@shipwrights/source-*`). The difference: Prisma's domain is your database; Shipwrights' domain is your engineering pipeline.

## CLI reference

```bash
shipwrights init       [--dry-run | --non-interactive | --force]
shipwrights doctor
shipwrights status
shipwrights upgrade
```

| Command | What |
|---|---|
| `init` | Scaffold `.shipwrights.yml` + GitHub workflows + scripts + doc templates. Auto-detects monorepo layout, languages, package manager, and verify command. Never overwrites consumer-owned files (`CLAUDE.md`, `AGENTS.md`, `README.md`, existing epics). Lands as one git commit — undo is `git revert HEAD`. |
| `doctor` | Validate `.shipwrights.yml`, resolve agent refs, check guards / lock service / telemetry / GitHub labels. Exits non-zero on fail; warns are tolerated. |
| `status` | Read the in-flight register. Flags stale entries (>48h with no commits). |
| `upgrade` | Bump templates + run config migrations. 3-way merges against your local edits. Lands as one git commit. v0.2.0 also auto-renames legacy v0.1 paths (`.shipwright.yml` → `.shipwrights.yml`, etc.). |

> The `shipwright` (singular) CLI alias keeps working for one minor-version cycle so v0.1 consumers can migrate without breakage. Run `shipwrights upgrade` to migrate file paths.

## Configuration

The full schema is at [`schemas/shipwrights-config.schema.json`](schemas/shipwrights-config.schema.json). A minimal config:

```yaml
version: 1

branches:
  integration: dev
  release: main
  patterns:
    feature: "feature/<id>-<slug>"
    fix:     "fix/<id>-<slug>"
    chore:   "chore/ops-<slug>"
    scratch: "<feature-branch>--<role>"

roles:
  - name: po
    agent: bundled
    capabilities: { can_write: false }
    invoke_at: [refine]
  - name: backend
    agent: bundled
    capabilities:
      can_write: true
      scope: ["apps/api/**", "packages/contracts/**"]
    invoke_at: [design-and-build]
  - name: gatekeeper
    agent: bundled
    capabilities: { can_write: fixup-only }
    invoke_at: [review]

pipeline:
  - { stage: refine,           owner: [po] }
  - { stage: slice,            owner: [orchestrator], freeze_paths: ["packages/contracts/**"] }
  - { stage: design-and-build, owner: [backend], parallelism: full }
  - { stage: integrate,        owner: [orchestrator] }
  - { stage: review,           owner: [gatekeeper], write_mode: fixup-only }
  - { stage: ship,             owner: [orchestrator] }

backlog:
  source: { kind: files }
  state_dir: docs/backlog/epics

merge:
  strategy: rebase
  stack_depth: 3
  auto_merge_labels: ["tier:trivial", "tier:minimal"]
  block_label: do-not-auto-merge
```

## Key architecture decisions

- **Specialists own design + build on scratch branches.** Orchestrator integrates but doesn't write code during the build stage. Keeps the merge boundary clean and lets you read commits per-role.
- **Scope enforcement is structural, not aspirational.** A specialist's commits get checked against their declared `capabilities.scope` before integration. Out-of-scope writes block.
- **Slice freezes the contract surface.** Paths under `freeze_paths` are read-only for the build stage; changing them requires a re-slice (explicit re-design event).
- **Backlog source is pluggable.** `files` and `github-issues` ship in core; [`@shipwrights/source-jira`](https://www.npmjs.com/package/@shipwrights/source-jira) ships as a separate package. The `BacklogSource` interface is documented in `sources/interface.d.ts`.
- **Guards are pluggable.** `file-length`, `branch-name`, `commit-format` ship in core; project-specific guards (route-access, public-id, etc.) install as separate npm packages.
- **Init is non-destructive.** Never overwrites your `CLAUDE.md`, existing epics, or repo conventions. Always lands as one git commit so undo is `git revert HEAD`.
- **Migrations are first-class.** `/shipwrights-upgrade` runs forward-only pure-function migrations on `.shipwrights.yml` so the schema can evolve without each consumer hand-editing their config.
- **Cost telemetry is built in.** Per-stage JSONL log with optional per-epic token budget (`warn` / `escalate` / `abort`).

## The bundled team

Six specialist sub-agents ship with the plugin:

| Role | Agent | Tool grants |
|---|---|---|
| Product Owner | `product-owner-strategist` | Read, Grep, Glob — produces refined epics, no code |
| Backend architect | `node-backend-systems-architect` | Read, Edit, Write, Bash — writes on `--backend` scratch |
| Frontend architect | `frontend-ui-architect` | Read, Edit, Write, Bash — writes on `--frontend` scratch |
| QA | `qa-quality-engineer` | Read, Edit, Write — writes tests only on `--qa` scratch |
| Code reviewer | `code-review-gatekeeper` | Read, Edit — fix-up scope only (≤5 lines per fix) |
| Browser reviewer | `ux-ui-browser-reviewer` | Read + Playwright MCP — read-only, verifies rendered output |

Every role's `agent:` ref can be `bundled` (the defaults above), `{ user: "..." }` (your `~/.claude/agents/` files), `{ custom: "./path" }` (project-local), or `{ npm: "@org/pkg" }` (third-party).

## Companion packages

```
@shipwrights/core         orchestration framework + CLI + bundled agents
@shipwrights/source-jira  Jira backlog adapter (separate npm package)
```

More adapters under `@shipwrights/source-*` planned: Linear, GitHub Projects.

## Testing

```bash
node --test "tests/**/*.test.mjs"
```

89 tests across 9 files cover: config validation + schema, predicate parser, render-templates (GitHub Actions `${{ }}` pass-through), verify discovery (npm/pnpm/yarn/go/poetry/uv), file-based source adapter, markdown lock service (claim / update / release / stale-detection), scope enforcer, all three built-in guards, telemetry (logging + budget warn/escalate/abort), config migrations, pipeline engine, scratch-branch lifecycle scripts, and CLI integration.

## Status

| | |
|---|---|
| **Stable** | CLI (`init`, `doctor`, `status`, `upgrade`), config schema, source-adapter interface, guard interface, scratch-branch scripts |
| **Stable but evolving** | Bundled agent prompts (may sharpen between minor versions) |
| **Pre-1.0** | Pipeline engine internals, lock-service backends, telemetry shape |
| **Planned** | Browser-reviewer Stage 6b end-to-end (needs dev-server lifecycle wiring), more source adapters |

API may evolve before v1.0. Pin exact versions until v1.

## Migrating from v0.1.x

v0.2.0 renamed CLI / slash commands / config filename / script folders from singular `shipwright` to plural `shipwrights` (to match the `@shipwrights` npm scope). One step:

```bash
npx shipwrights upgrade
```

That command auto-renames `.shipwright.yml` → `.shipwrights.yml`, `.shipwright/` → `.shipwrights/`, `scripts/shipwright/` → `scripts/shipwrights/`, updates the post-merge workflow's script path, and commits all of it in one git commit. The singular CLI alias keeps working through v0.2.x; it'll be removed in v0.3.

## Links

- npm: https://www.npmjs.com/package/@shipwrights/core
- repo: https://github.com/shipwrights/core
- Jira adapter: https://www.npmjs.com/package/@shipwrights/source-jira
- example consumer (a11y-lab): https://github.com/dacostaaboagye/a11y-lab

## License

MIT
