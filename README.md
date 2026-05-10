# Shipwright

> Ship epics with AI specialists. Coordinates designer/architect/QA/reviewer agents across scratch branches and integrates the result into a single PR.

Shipwright is a Claude Code plugin and orchestration framework. It drives an epic from refinement through ship by spawning specialist sub-agents (PO, backend architect, frontend architect, QA, reviewer, browser-reviewer), letting each work on their own scratch branch, and integrating the results into a single feature PR. The pipeline, roles, source-of-truth, guards, and verification commands are all declarative — you describe your workflow in `.shipwright.yml`, Shipwright runs it.

## Highlights

- **Specialists own design + build.** Each writes code on their own scratch branch; the orchestrator integrates.
- **Declarative pipeline.** Stages, owners, parallelism, and tier-routing live in YAML. The plugin doesn't lock you into one workflow.
- **Auto-discovered verification.** Reads your `package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` and proposes the right `verify` / `lint` / `typecheck` commands.
- **Pluggable backlog sources.** Files, GitHub Issues built in. Jira, Linear, custom adapters via separate npm packages.
- **Pluggable guards.** File-length, branch-name, commit-format built in. Project-specific guards as separate packages.
- **Non-destructive `init`.** Plans before it writes, asks per-file when conflicts exist, lands as one git commit so undo is `git revert`.
- **First-class migrations.** Config schema versioned; `/shipwright:upgrade` runs migrations like Drizzle/Prisma.
- **Lock service interface.** Markdown register by default; swap to GitHub Issues or a hosted API by changing one config block.
- **Cost telemetry.** Per-epic token usage logged; configurable budget with warn/escalate/abort.

## Install

```bash
npm install -D @shipwrights/core
# or
pnpm add -D @shipwrights/core
```

Or as a Claude Code plugin (recommended):

```
/plugin add @shipwrights/core
```

## Quick start

```bash
/shipwright:init               # scaffold .shipwright.yml + workflows + scripts
/shipwright:doctor             # verify the config + agent availability
/shipwright:epic E-04-01       # drive an epic through the pipeline
/shipwright:status             # see what's in flight
```

## Slash commands

| Command | Purpose |
|---|---|
| `/shipwright:init` | First-run scaffold. Non-destructive, dry-runnable, single git commit. |
| `/shipwright:epic [id]` | Drive an epic from refine → ship. With no id, picks the next ready epic. |
| `/shipwright:status` | Read the in-flight register. |
| `/shipwright:upgrade` | Bump templates and config schema. 3-way merge against your edits. |
| `/shipwright:doctor` | Diagnose `.shipwright.yml`, agent availability, command discoverability. |

## Configuration

Shipwright reads `.shipwright.yml` at the repo root. Minimum config:

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
pipeline:
  - stage: refine
    owner: [po]
  - stage: slice
    owner: [orchestrator]
    freeze_paths: ["packages/contracts/**"]
  - stage: design-and-build
    owner: [backend, frontend, qa]
    parallelism: full
  - stage: integrate
    owner: [orchestrator]
    integrate_order: [backend, frontend, qa]
  - stage: review
    owner: [gatekeeper]
    write_mode: fixup-only
  - stage: ship
    owner: [orchestrator]
backlog:
  source: { kind: files }
  state_dir: docs/backlog/epics
verify: {}
merge:
  strategy: rebase
  stack_depth: 3
```

See `examples/` for full configs covering monorepo + Jira, single-package Go, mixed Python/Node, and minimal trivial-only setups.

## How it works

```
┌─────────┐   ┌────────┐   ┌──────────────────┐   ┌───────────┐   ┌──────┐   ┌────────┐   ┌──────┐
│ Refine  │──▶│ Slice  │──▶│  Design + Build  │──▶│ Integrate │──▶│ Test │──▶│ Review │──▶│ Ship │
└─────────┘   └────────┘   └──────────────────┘   └───────────┘   └──────┘   └────────┘   └──────┘
   PO          orches-          specialists            orches-       QA on     gatekeeper    orches-
   read-       trator           in parallel on         trator        --qa      read +        trator
   only        defines          scratch branches:      rebases       scratch   small         opens
               contract         backend, frontend      onto          branch    fix-up        PR
                                each on their own      feature                 commits to
                                --backend, --frontend  branch in                feature
                                                       fixed order              branch
```

Stage names map 1:1 to skills under `skills/stages/`. Each stage's owner-role is invoked with the appropriate context. Orchestrator coordinates; specialists own their slice.

## Status

v0.1.1 — first release with publish-ready test coverage. APIs may change before v1.0. Pin exact versions until v1.

## Testing

```bash
node --test "tests/**/*.test.mjs"
```

85 tests across 9 files cover: config validation + schema, predicate parser, render-templates (with GitHub Actions `${{ }}` pass-through), verify discovery (npm/pnpm/yarn/go/poetry/uv), file-based source adapter (listAvailable / pickNext / materialize / markStatus / attachPR), markdown lock service (claim / update / release / stale-detection), scope enforcer (in-scope / out-of-scope / frozen-paths), all three built-in guards (file-length / branch-name / commit-format), telemetry (logging + budget warn/escalate/abort), config migrations, pipeline engine (tier resolution / stage skip / parallelism), scratch-branch lifecycle scripts (create / verify-scope / integrate / bundle / update-epic-after-merge), and CLI integration (init / doctor / status / upgrade / help).

## License

MIT
