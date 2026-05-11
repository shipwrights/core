---
name: shipwrights-upgrade
description: Bump Shipwright templates and config schema in a project. Runs config migrations in order (like Drizzle/Prisma). 3-way merges template changes against the consumer's edits. Lands as one git commit. Invoked as /shipwrights:upgrade.
---

# /shipwrights:upgrade — bump templates + run migrations

When the plugin updates and the consumer wants the new templates, schema fixes, or new defaults — without losing their edits.

## What you do

### 1. Pre-checks

- Working tree clean. Refuse if dirty.
- `.shipwrights.yml` exists. Refuse if not (direct to `/shipwrights:init`).
- Read the current config's `version` field.
- Read the plugin's `lib/migrations/` directory — list of migrations from version N → N+1.

### 2. Run config migrations

For each migration from `<consumer-version>` to `<plugin-current-version>`:

1. Load `migrations/<from>-to-<to>.mjs`.
2. Apply: takes the parsed config, returns the migrated config.
3. Migrations are pure functions — they don't write files; they transform the YAML object.

After all migrations: write the new `.shipwrights.yml` with `version: <plugin-current-version>` and the migrated content. Don't write yet — accumulate; commit at the end.

### 3. Diff templates

For each path under `templates/`:

- Render the current plugin's template against the migrated config. Call this `template-current`.
- Read the consumer's existing file (if any). Call this `consumer-current`.
- Read the plugin's template at the consumer's *previous* installed version. Call this `template-old`. (Tracked via `.shipwrights/installed.json`.)

Three cases:

- **Consumer hasn't edited** — `consumer-current == template-old`. Just write `template-current` over it. No conflict.
- **Plugin hasn't changed** — `template-current == template-old`. Skip silently.
- **Both changed** — 3-way merge between `template-old` (base), `consumer-current` (theirs), `template-current` (ours). If clean: write the merge. If conflicted: write the file with conflict markers and add it to a "conflicts" list for the user to resolve.

### 4. Show the plan

```
Upgrading @shipwrights/core: 0.1.0 → 0.2.0

Config migrations:
  - 1-to-2: rename `lock.kind` → `lock.backend`
  - 2-to-3: add `telemetry.budget_per_epic_tokens` default

Templates:
  - .github/workflows/auto-merge-low-tier.yml: clean update
  - scripts/shipwrights/integrate-scratch.mjs: 3-way merge clean
  - scripts/shipwrights/update-epic-after-merge.mjs: ⚠ CONFLICT — resolve manually
  - docs/process/team-orchestration.md: skipped (consumer-owned)

New files this version:
  - scripts/shipwrights/cost-telemetry.mjs

Proceed? [y/N]
```

### 5. Apply

1. Write the migrated `.shipwrights.yml`.
2. Write resolved + merged templates.
3. Update `.shipwrights/installed.json` with the new version.
4. Stage all changes.
5. If any conflicts: print the conflict list, do NOT commit. Ask user to resolve, then `/shipwrights:upgrade --finalize`.
6. Otherwise: commit `chore: upgrade @shipwrights/core to v<version>`.

### 6. Post-upgrade

Print:

```
✓ Upgraded to <version>
✓ Config migrated through <N> migrations
✓ Templates updated; <K> 3-way merges applied cleanly
✓ <M> new files added

Next: /shipwrights:doctor to validate.
```

## Migrations contract

Each migration is at `migrations/N-to-M.mjs`:

```
export const from = 1
export const to   = 2
export const description = "Rename lock.kind to lock.backend"

export function up(config) {
  if (config.lock?.kind) {
    config.lock = { ...config.lock, backend: config.lock.kind }
    delete config.lock.kind
  }
  return config
}
```

The engine runs migrations in version order. Migrations are pure transforms over parsed YAML — they don't touch the filesystem (the upgrade command does).

## Failure modes

- **Migration throws** — abort the upgrade. Nothing written. Report the migration that failed.
- **3-way merge conflict** — write the file with markers, list it for the user. Don't commit. `--finalize` proceeds after user resolves.
- **Working tree dirty** — refuse.
- **`.shipwrights/installed.json` missing** — fall back to assuming `version: 0` and run all migrations. Warn the user.
