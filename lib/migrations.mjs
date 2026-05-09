// Config schema migrations. Each migration is a pure function over the parsed
// config object. The plugin ships migrations from version N to N+1 under
// migrations/ at the repo root.
//
// `/shipwright:upgrade` calls runMigrations(config, fromVersion, toVersion) and
// gets back the migrated config. The upgrade command writes the result; the
// migrations themselves never touch the filesystem.

import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+-to-\d+\.mjs$/.test(name))
    .map((name) => {
      const m = name.match(/^(\d+)-to-(\d+)\.mjs$/);
      return {
        from: Number(m[1]),
        to: Number(m[2]),
        path: join(MIGRATIONS_DIR, name),
      };
    })
    .sort((a, b) => a.from - b.from);
}

export async function runMigrations(config, fromVersion, toVersion) {
  if (fromVersion === toVersion) return config;
  if (fromVersion > toVersion) {
    throw new Error(
      `Cannot migrate config backwards (from v${fromVersion} to v${toVersion})`,
    );
  }

  const all = listMigrations();
  const chain = [];
  let cursor = fromVersion;
  while (cursor < toVersion) {
    const next = all.find((m) => m.from === cursor);
    if (!next) {
      throw new Error(
        `No migration found from v${cursor} to v${cursor + 1}; chain is incomplete`,
      );
    }
    chain.push(next);
    cursor = next.to;
  }

  let migrated = config;
  for (const step of chain) {
    const mod = await import(step.path);
    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${step.from}-to-${step.to} missing up() export`);
    }
    migrated = mod.up(migrated);
    migrated.version = step.to;
  }

  return migrated;
}
