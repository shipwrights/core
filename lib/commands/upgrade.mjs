import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { runMigrations, listMigrations } from "../migrations.mjs";

export async function runUpgrade({ projectRoot, pluginRoot }) {
  const configPath = join(projectRoot, ".shipwright.yml");
  if (!existsSync(configPath)) {
    console.error("No .shipwright.yml. Run /shipwright:init first.");
    process.exit(2);
  }
  const installedPath = join(projectRoot, ".shipwright", "installed.json");
  const installed = existsSync(installedPath)
    ? JSON.parse(readFileSync(installedPath, "utf8"))
    : { version: 0 };
  const pluginPkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  const targetSchemaVersion = inferSchemaVersion(pluginPkg);

  const fromVersion = installed.version ?? 0;
  if (fromVersion === targetSchemaVersion) {
    console.log("Already up to date.");
    return;
  }

  const config = parseYaml(readFileSync(configPath, "utf8"));
  console.log(`Upgrading config v${fromVersion} → v${targetSchemaVersion}`);
  const migrations = listMigrations().filter((m) => m.from >= fromVersion && m.to <= targetSchemaVersion);
  for (const m of migrations) {
    const mod = await import(m.path);
    console.log(`  - ${m.from}-to-${m.to}: ${mod.description ?? ""}`);
  }
  const migrated = await runMigrations(config, fromVersion, targetSchemaVersion);
  const yamlText = `# Shipwright config\n${toYaml(migrated)}`;

  if (!isClean(projectRoot)) {
    console.error("Working tree dirty. Commit or stash first.");
    process.exit(2);
  }

  writeFileSync(configPath, yamlText, "utf8");
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(
    installedPath,
    JSON.stringify({ version: targetSchemaVersion, upgradedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );

  spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=Shipwright Upgrade",
      "-c",
      "user.email=shipwright@noreply.local",
      "commit",
      "-m",
      `chore: upgrade @shipwrights/core to v${pluginPkg.version}`,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
  console.log(`✓ Upgraded to plugin v${pluginPkg.version}, schema v${targetSchemaVersion}`);
}

function inferSchemaVersion(pluginPkg) {
  // For now, schema version is hardcoded at 1. Future versions bump alongside
  // breaking schema changes. Tracked here so migrations chain correctly.
  return 1;
}

function isClean(projectRoot) {
  try {
    return execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim() === "";
  } catch {
    return false;
  }
}
