import { execSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { importFromPath } from "../import-from-path.mjs";
import { installPluginSurfaces } from "../install-plugin-surfaces.mjs";
import {
	MANAGED_TEMPLATE_RELS,
	decideFileAction,
	readManifest,
	templateDestPath,
	writeManifest,
} from "../managed-files-manifest.mjs";
import { listMigrations, runMigrations } from "../migrations.mjs";
import { renderTemplate } from "../render-templates.mjs";

export async function runUpgrade({ projectRoot, pluginRoot, args = [] }) {
	const force = args.includes("--force");
	// v0.1.x → v0.2.x file-system migration: rename .shipwright.yml →
	// .shipwrights.yml, .shipwright/ → .shipwrights/, scripts/shipwright/ →
	// scripts/shipwrights/. Applied before any other upgrade logic so we
	// operate on the canonical v0.2 layout afterwards.
	applyV01ToV02FilesystemMigration(projectRoot);

	const configPath = join(projectRoot, ".shipwrights.yml");
	if (!existsSync(configPath)) {
		console.error("No .shipwrights.yml. Run /shipwrights-init first.");
		process.exit(2);
	}
	const installedPath = join(projectRoot, ".shipwrights", "installed.json");
	const installed = existsSync(installedPath)
		? JSON.parse(readFileSync(installedPath, "utf8"))
		: { version: 0 };
	const pluginPkg = JSON.parse(
		readFileSync(join(pluginRoot, "package.json"), "utf8"),
	);
	const targetSchemaVersion = inferSchemaVersion(pluginPkg);
	const config = parseYaml(readFileSync(configPath, "utf8"));

	if (!filesystemRenamed && !isClean(projectRoot)) {
		console.error("Working tree dirty. Commit or stash first.");
		process.exit(2);
	}

	// Always refresh the .claude/ surfaces so the user gets the latest
	// bundled skills + agents after a plugin update.
	installPluginSurfaces({ projectRoot, pluginRoot });
	console.log(
		"  refreshed .claude/skills/shipwrights/ + .claude/agents/shipwrights/",
	);
	const templateResult = refreshManagedTemplates({
		projectRoot,
		pluginRoot,
		config,
		force,
	});
	for (const rel of templateResult.refreshed) {
		console.log(`  refreshed ${rel}`);
	}
	for (const { rel, reason } of templateResult.skipped) {
		const explanation =
			reason === "user-edited"
				? "user-edited since last upgrade — left alone"
				: reason === "preexisting"
					? "pre-existing and not tracked — left alone (run /shipwrights-init to claim or hand-edit and commit)"
					: reason;
		console.log(`  skipped  ${rel}  (${explanation})`);
	}

	const fromVersion = installed.version ?? 0;
	if (fromVersion === targetSchemaVersion) {
		if (filesystemRenamed) {
			// Filesystem renames happened even though config schema didn't change.
			commitChanges(projectRoot, pluginPkg.version);
			console.log(
				`✓ Renamed v0.1 files + refreshed .claude/ surfaces; plugin at v${pluginPkg.version}.`,
			);
			return;
		}
		// No config migration to do, but the .claude/ surface may still need a
		// commit if its contents changed.
		if (!isClean(projectRoot)) {
			commitChanges(projectRoot, pluginPkg.version);
			console.log(
				`✓ Refreshed .claude/ surfaces for plugin v${pluginPkg.version}.`,
			);
			return;
		}
		console.log("Already up to date.");
		return;
	}

	console.log(`Upgrading config v${fromVersion} → v${targetSchemaVersion}`);
	const migrations = listMigrations().filter(
		(m) => m.from >= fromVersion && m.to <= targetSchemaVersion,
	);
	for (const m of migrations) {
		const mod = await importFromPath(m.path);
		console.log(`  - ${m.from}-to-${m.to}: ${mod.description ?? ""}`);
	}
	const migrated = await runMigrations(
		config,
		fromVersion,
		targetSchemaVersion,
	);
	const yamlText = `# Shipwrights config\n${toYaml(migrated)}`;

	writeFileSync(configPath, yamlText, "utf8");
	mkdirSync(dirname(installedPath), { recursive: true });
	writeFileSync(
		installedPath,
		JSON.stringify(
			{ version: targetSchemaVersion, upgradedAt: new Date().toISOString() },
			null,
			2,
		),
		"utf8",
	);

	commitChanges(projectRoot, pluginPkg.version);
	console.log(
		`✓ Upgraded to plugin v${pluginPkg.version}, schema v${targetSchemaVersion}`,
	);
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
			console.log(
				"  updated scripts path in .github/workflows/post-merge-doc-update.yml",
			);
		}
	}
}

function refreshManagedTemplates({ projectRoot, pluginRoot, config, force = false }) {
	const rolesByName = {};
	for (const role of config.roles ?? []) {
		rolesByName[role.name] = {
			agent:
				typeof role.agent === "string"
					? role.agent
					: (role.agent?.user ?? role.agent?.custom ?? "bundled"),
		};
	}
	const context = { ...config, roles: rolesByName };
	const manifest = readManifest(projectRoot);
	const refreshed = [];
	const skipped = [];

	for (const rel of MANAGED_TEMPLATE_RELS) {
		const src = join(pluginRoot, "templates", rel);
		if (!existsSync(src)) continue;
		const dest = templateDestPath(rel, projectRoot);
		const rendered = renderTemplate(readFileSync(src, "utf8"), context);

		const decision = decideFileAction({
			destPath: dest,
			rendered,
			manifestHashForKey: manifest.files[rel],
		});

		const shouldWrite =
			decision.action === "write" ||
			(force && decision.action === "skip" && decision.reason !== "unchanged");

		if (shouldWrite) {
			mkdirSync(dirname(dest), { recursive: true });
			writeFileSync(dest, rendered, "utf8");
			manifest.files[rel] = decision.renderedHash;
			refreshed.push(relativePath(projectRoot, dest));
			continue;
		}

		if (decision.reason === "unchanged") {
			// Already in sync; record the hash so future upgrades don't treat
			// it as "preexisting".
			manifest.files[rel] = decision.renderedHash;
			continue;
		}
		skipped.push({
			rel: relativePath(projectRoot, dest),
			reason: decision.reason,
		});
	}

	writeManifest(projectRoot, manifest);
	return { refreshed, skipped };
}

function relativePath(projectRoot, absolutePath) {
	return absolutePath.slice(projectRoot.length + 1).replace(/\\/g, "/");
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

function inferSchemaVersion(_pluginPkg) {
	// Schema version is still 1 at v0.2.0 — only the filenames changed, not
	// the .yml content shape. Future schema changes bump this and add a
	// matching migrations/N-to-M.mjs.
	return 1;
}

function isClean(projectRoot) {
	try {
		return (
			execSync("git status --porcelain", {
				cwd: projectRoot,
				encoding: "utf8",
			}).trim() === ""
		);
	} catch {
		return false;
	}
}
