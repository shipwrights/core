# Migrations

Each file here transforms a `.shipwrights.yml` from one schema version to the next. They run automatically on `/shipwrights-upgrade`.

## Naming

`<from>-to-<to>.mjs` — e.g., `1-to-2.mjs` migrates from version 1 to version 2.

## Contract

```js
export const description = "Short human-readable description";

export function up(config) {
  // Pure transform. Mutate-and-return or build-and-return — both fine.
  // Don't touch the filesystem; that's the upgrade command's job.
  return config;
}
```

## Rules

- Migrations are **forward-only**. No `down()`.
- Migrations are **pure**. No I/O. No network. No file writes.
- Migrations must be **idempotent** if a consumer runs the same one twice (defensive — the upgrade flow tracks state, but bugs happen).
- Every breaking schema change ships with a migration. No exceptions.

## Why

Without migrations, every breaking schema change taxes every consumer. With them, `/shipwrights-upgrade` is just `npm update && /shipwrights-upgrade`. The plugin can evolve.
