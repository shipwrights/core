import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { runMigrations, listMigrations } from "../migrations.mjs";

export async function runUpgrade({ projectRoot, pluginRoot }) {
  // v0.1.x → v0.2.x file-system migration: rename .shipwright.yml →
  // .shipwrights.yml, .shipwright/ → .shipwrights/, scripts/shipwright/ →
  // scripts/shipwrights/. Applied before any other upgrade logic so we
  // operate on the canonical v0.2 layout afterwards.
  applyV01ToV02FilesystemMigration(projectRoot);

  const configPath = join(projectRoot, ".shipwrights.yml");
  if (!existsSync(configPath)) {
    console.error("No .shipwrights.yml. Run /shipwrights:init first.");
    process.exit(2);
  }
  const installedPath = join(projectRoot, ".shipwrights", "installed.json");
  const installed = existsSync(installedPath)
    ? JSON.parse(readFileSync(installedPath, "utf8"))
    : { version: 0 };
  const pluginPkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  const targetSchemaVersion = inferSchemaVersion(pluginPkg);

  const fromVersion = installed.version ?? 0;
  if (fromVersion === targetSchemaVersion) {
    if (filesystemRenamed) {
      // Filesystem renames happened even though config schema didn't change.
      commitChanges(projectRoot, pluginPkg.version);
      console.log(
        `✓ Renamed v0.1 files to v0.2 names; plugin already at v${pluginPkg.version}.`,
      );
      return;
    }
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
  const yamlText = `# Shipwrights config\n${toYaml(migrated)}`;

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

  commitChanges(projectRoot, pluginPkg.version);
  console.log(`✓ Upgraded to plugin v${pluginPkg.version}, schema v${targetSchemaVersion}`);
}

let filesystemRenamed = false;

function applyV01ToV02FilesystemMigration(projectRoot) {
  filesystemRenamed = false;
  const renames = [
    [".shipwright.yml", ".shipwrights.yml"],
    [".shipwright", ".shipwrights"],
    [join("scripts", "shipwright"), join("scripts", "shipwrights")],
  ];
  for (const [oldRel, newRel] of renames) {
    const oldPath = join(projectRoot, oldRel);
    const newPath = join(projectRoot, newRel);
    if (existsSync(oldPath) && !existsSync(newPath)) {
      renameSync(oldPath, newPath);
      filesystemRenamed = true;
      console.log(`  renamed ${oldRel} → ${newRel}`);
    }
  }

  // Update references inside the post-merge workflow if the consumer has
  // it from the v0.1 init (path went from scripts/shipwright/ to
  // scripts/shipwrights/).
  const workflowPath = join(
    projectRoot,
    ".github",
    "workflows",
    "post-merge-doc-update.yml",
  );
  if (existsSync(workflowPath)) {
    const content = readFileSync(workflowPath, "utf8");
    const updated = content.replace(
      /scripts\/shipwright\//g,
      "scripts/shipwrights/",
    );
    if (updated !== content) {
      writeFileSync(workflowPath, updated, "utf8");
      filesystemRenamed = true;
      console.log("  updated scripts path in .github/workflows/post-merge-doc-update.yml");
    }
  }
}

function commitChanges(projectRoot, pluginVersion) {
  spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=Shipwrights Upgrade",
      "-c",
      "user.email=shipwrights@noreply.local",
      "commit",
      "-m",
      `chore: upgrade @shipwrights/core to v${pluginVersion}`,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
}

function inferSchemaVersion(pluginPkg) {
  // Schema version is still 1 at v0.2.0 — only the filenames changed, not
  // the .yml content shape. Future schema changes bump this and add a
  // matching migrations/N-to-M.mjs.
  return 1;
}

function isClean(projectRoot) {
  try {
    return execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim() === "";
  } catch {
    return false;
  }
}
