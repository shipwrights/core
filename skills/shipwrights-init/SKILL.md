---
name: shipwrights-init
description: First-run scaffold for a Shipwright project. Auto-detects language, package manager, verify commands, and project layout. Proposes a config + templates, asks per-file decisions on conflicts, lands as one git commit. Non-destructive by default. Invoke as /shipwrights:init [--dry-run | --non-interactive | --force].
---

# /shipwrights:init — non-destructive project scaffold

Scaffold `.shipwrights.yml` + workflows + scripts + doc templates into a project. Never overwrites silently. Always lands as one git commit so undo is `git revert HEAD`.

## Flags

- `--dry-run` — print the plan, write nothing.
- `--non-interactive` — use defaults; for any conflict, write the plugin's version as `.example` and leave the consumer's file alone.
- `--force` — answer "overwrite" to every conflict prompt. Still lands as one commit.

## What you (the init command) do

### 1. Pre-checks

- Confirm the working tree is clean. Refuse if dirty (unless `--force`).
- Confirm the cwd is a git repository (`git rev-parse --is-inside-work-tree`).
- Read existing `package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` to detect ecosystem.
- Look for an existing `.shipwrights.yml`. If present, refuse — direct user to `/shipwrights:upgrade`.

### 2. Auto-discovery

Run `lib/verify-discovery.mjs` against the project root. It returns a recipe:

```
{
  ecosystem: "node-pnpm" | "node-npm" | "node-yarn" | "go" | "rust" | "python-poetry" | "python-uv" | ...,
  install:    "pnpm install" | ...,
  verify:     "pnpm verify" | "go test ./..." | ...,
  lint:       "pnpm lint" | "cargo clippy" | ...,
  typecheck:  "pnpm typecheck" | "tsc --noEmit" | ...,
  format_fix: "pnpm exec biome check --write" | "gofmt -w ." | ...
}
```

Detect:
- Languages present (file extensions sampled).
- Monorepo vs single-package (`pnpm-workspace.yaml`, `lerna.json`, `turbo.json`, `Cargo.toml` with `workspace`, `go.work`).
- Existing CI workflows under `.github/workflows/`.
- Existing branch protection (warn if `main` allows direct push).
- Existing scripts under `scripts/architecture/` (if so, propose registering them as guards).

### 3. Ask the consumer

Show the discovered recipe + propose questions. Each question has a default the consumer can accept by hitting Enter:

```
Project name? [shop-app-v2]
Integration branch? [dev]
Release branch? [main]
Verify command? [pnpm verify]
Format-fix command? [pnpm exec biome check --write]
Backlog source? [files]   (other options will be available once @shipwrights/source-* packages installed)
Where do epic files live? [docs/backlog/epics]
Which roles to enable?
  [x] po
  [x] backend
  [x] frontend
  [x] qa
  [x] gatekeeper
  [ ] browser              (auto-checked if apps/web/-style dir detected)
For backend, scope paths? [apps/api/**, packages/contracts/**]
For frontend, scope paths? [apps/web/**, packages/contracts/**]
For qa, scope paths? [**/*.test.ts, **/*.spec.ts, **/test/**]
Contract surface (frozen after slice)? [packages/contracts/**]
Push scratch branches to remote? [no]
Default merge strategy? [rebase]
File-length defaults?
  TypeScript source: [250]    test: [350]
Hard rules (one per line, blank to finish):
> Public APIs expose slugs / reference numbers, never raw DB ids
> Append-only ledgers stay append-only
>
```

In `--non-interactive` mode: take all defaults, no prompts. Print the resulting config so the consumer can review.

### 4. Plan files

Walk the plugin's `templates/` directory. For each template path, classify:

- **new** — doesn't exist in the consumer's repo. Will be written.
- **identical** — exists, byte-equal to the rendered template. Skip silently.
- **conflict** — exists with different content. Prompt: skip / overwrite / merge / write-as-`.example` / view-diff.
- **never-overwrite** — list of paths the consumer owns that init refuses to ever write if they exist: `.shipwrights.yml`, files under `<state_dir>/`, `CLAUDE.md`, `AGENTS.md`, `README.md`. If they exist, init skips. If they don't, init writes a starter version.

### 5. Show the plan

```
I will:
  - write 12 new files
  - skip 3 (already correct)
  - merge 2 (3-way diffs you'll review)
  - write 1 as .example (you have a custom version)
  - register 4 verification commands
  - register 6 default file-length rules (TypeScript detected)
  - register 3 default guards (file-length, branch-name, commit-format)
  - install 3 GitHub labels (tier:trivial, tier:minimal, do-not-auto-merge)

Proceed? [y/N/dry-run]
```

In `--dry-run` mode: print the plan and exit without writing. In `--force` mode: skip the confirm.

### 6. Apply

In a single commit:

1. Write `.shipwrights.yml` with the consumer-confirmed values.
2. Write resolved templates from `templates/` to consumer paths, with `{{token}}` substitution against the config.
3. Write any `.example` files chosen during conflict resolution.
4. Stage all changes.
5. Commit: `chore: install @shipwrights/core v<version>`.
6. Print: `Undo with 'git revert HEAD'.`

### 7. Post-install

Print:

```
✓ Shipwright installed at v<version>
✓ Config: .shipwrights.yml
✓ Workflows: .github/workflows/{auto-merge-low-tier.yml, post-merge-doc-update.yml}
✓ Scripts: scripts/shipwrights/

Next steps:
  1. Run /shipwrights:doctor to validate the config + agent availability.
  2. Create GitHub labels (one-time):
     gh label create tier:trivial --color cccccc
     gh label create tier:minimal --color e8e8e8
     gh label create do-not-auto-merge --color d93f0b
  3. Drop an epic stub at <state_dir>/E-XX-XX-stub.md with status: idea, then run /shipwrights:epic E-XX-XX.

Reference: README.md, examples/.
```

## Hard rules

- **One git commit.** No matter how many files were written, they all land in one commit. Undo is `git revert HEAD`.
- **Never overwrite consumer-owned files.** `.shipwrights.yml`, `<state_dir>/*`, `CLAUDE.md`, `AGENTS.md`, `README.md`. If they exist, init proposes alongside (`.example`) or skips.
- **Never modify branch protection.** Print recommendations, don't apply them.
- **Refuse on dirty working tree** unless `--force`.

## Failure modes

- **Working tree dirty** — refuse, instruct user to commit or stash.
- **Not in git** — refuse, instruct user to `git init`.
- **`.shipwrights.yml` already exists** — refuse, point to `/shipwrights:upgrade`.
- **Auto-discovery fails** (no recognizable manifest) — fall back to fully-manual prompts.
- **Template rendering fails on an unrecognized token** — abort, leave nothing written, print the offending token.
