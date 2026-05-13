// Copy the plugin's bundled skills/agents into the consumer's project-local
// .claude/ so Claude Code discovers them.
//
// Layout:
//   .claude/skills/shipwrights-epic/SKILL.md       (each skill folder copied directly)
//   .claude/skills/shipwrights-doctor/SKILL.md
//   ...
//   .claude/skills/stages/refine.md                 (stages keep their own subdir)
//   .claude/agents/product-owner-strategist.md      (each agent copied directly)
//   ...
//
// Why flat: Claude Code reads `.claude/skills/<name>/SKILL.md` at the top
// level — nesting under `.claude/skills/shipwrights/<name>/` makes the
// skill invisible.
//
// Agents are only copied if no user-global agent of the same name exists.
// User-global agents at ~/.claude/agents/<name>.md take precedence per
// Claude Code's resolution rules, and copying ours over them would shadow
// any customisations the user has there.
//
// On every run we remove the previously-installed managed files (tracked
// via .shipwrights/installed-files.json) before copying fresh, so an
// upgrade doesn't leave stale skill folders behind if the bundle's skill
// set changes between versions.

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const TRACK_FILE = join(".shipwrights", "installed-files.json");

const MANAGED_README = `# Managed by @shipwrights/core

The skill folders and agent files in this project that start with
\`shipwrights-\` (and the \`stages/\` subdirectory under skills/) are copied
from \`node_modules/@shipwrights/core\` on every \`shipwrights init\` and
\`shipwrights upgrade\`. Any local edits are overwritten on the next
upgrade.

To customize, see \`.shipwrights.yml\` overrides:
- For an agent: \`agent: { custom: "./.claude/agents/my-agent.md" }\`
- For a stage skill: \`skill: "./.claude/skills/my-stage.md"\`

Don't edit the managed files directly.
`;

/**
 * Recursively copy a directory.
 * @param {string} src
 * @param {string} dest
 */
function copyDirSync(src, dest) {
	cpSync(src, dest, { recursive: true });
}

/**
 * Wire bundled skills + agents into .claude/. Returns the list of paths
 * created (relative to projectRoot) so they can be tracked for cleanup on
 * the next run.
 */
export function installPluginSurfaces({ projectRoot, pluginRoot }) {
	const skillsSrc = join(pluginRoot, "skills");
	const agentsSrc = join(pluginRoot, "agents");
	if (!existsSync(skillsSrc) || !existsSync(agentsSrc)) {
		throw new Error(
			`Cannot find bundled skills/agents at ${pluginRoot}. ` +
				`Is @shipwrights/core installed correctly?`,
		);
	}

	// 1) Clean up previously-installed managed files. Read the track file
	// and remove everything it lists.
	cleanupPrevious(projectRoot);

	// 2) Clean up the v0.2.0/v0.2.1 nested layout if present (pre-fix).
	cleanupLegacyNestedLayout(projectRoot);

	const installed = [];

	// 3) Copy each skill folder flat into .claude/skills/.
	const skillsDestRoot = join(projectRoot, ".claude", "skills");
	mkdirSync(skillsDestRoot, { recursive: true });
	for (const entry of readdirSync(skillsSrc)) {
		const srcPath = join(skillsSrc, entry);
		const destPath = join(skillsDestRoot, entry);
		if (statSync(srcPath).isDirectory()) {
			copyDirSync(srcPath, destPath);
			installed.push(join(".claude", "skills", entry));
		}
	}
	// Drop a MANAGED.md at the skills root.
	writeFileSync(
		join(skillsDestRoot, "SHIPWRIGHTS-MANAGED.md"),
		MANAGED_README,
		"utf8",
	);
	installed.push(join(".claude", "skills", "SHIPWRIGHTS-MANAGED.md"));

	// 4) Copy each agent file flat into .claude/agents/.
	// We always copy — earlier versions skipped when a user-global agent of
	// the same name existed, but that produced a confusingly-empty
	// .claude/agents/ for any consumer who happens to have the same names
	// in their user-global agents dir. To use a user-global customisation
	// instead of the bundled defaults, set `agent: { user: "<name>" }` on
	// the relevant role in .shipwrights.yml.
	const agentsDestRoot = join(projectRoot, ".claude", "agents");
	mkdirSync(agentsDestRoot, { recursive: true });
	for (const file of readdirSync(agentsSrc)) {
		if (!file.endsWith(".md")) continue;
		const srcPath = join(agentsSrc, file);
		const destPath = join(agentsDestRoot, file);
		cpSync(srcPath, destPath);
		installed.push(join(".claude", "agents", file));
	}

	// 5) Write the track file so the next run knows what to remove.
	const trackPath = join(projectRoot, TRACK_FILE);
	mkdirSync(join(projectRoot, ".shipwrights"), { recursive: true });
	writeFileSync(trackPath, JSON.stringify({ installed }, null, 2), "utf8");

	return { installed, skillsRoot: skillsDestRoot, agentsRoot: agentsDestRoot };
}

function cleanupPrevious(projectRoot) {
	const trackPath = join(projectRoot, TRACK_FILE);
	if (!existsSync(trackPath)) return;
	try {
		const { installed = [] } = JSON.parse(readFileSync(trackPath, "utf8"));
		for (const rel of installed) {
			const full = join(projectRoot, rel);
			if (existsSync(full)) {
				rmSync(full, { recursive: true, force: true });
			}
		}
	} catch {
		// Bad track file — ignore and proceed; the install will overwrite.
	}
}

function cleanupLegacyNestedLayout(projectRoot) {
	// v0.2.0/v0.2.1 installed under .claude/skills/shipwrights/ and
	// .claude/agents/shipwrights/. Remove those if present.
	for (const rel of [
		join(".claude", "skills", "shipwrights"),
		join(".claude", "agents", "shipwrights"),
	]) {
		const full = join(projectRoot, rel);
		if (existsSync(full)) {
			rmSync(full, { recursive: true, force: true });
		}
	}
}
