// Copy the plugin's bundled skills/ and agents/ directories into the
// consumer's project-local .claude/ so Claude Code discovers them without
// any manual symlink step.
//
// Approach: recursive copy. We considered symlinks but Windows refuses to
// create them without admin / developer-mode, and copies make the wired
// content visible in git (which is the source of truth for a project).
//
// Idempotency: removes any existing .claude/skills/shipwrights/ and
// .claude/agents/shipwrights/ before writing, so re-running on a project
// that's already wired produces a clean refresh — useful when the plugin
// is updated and the consumer runs `shipwrights upgrade`.
//
// User customizations: tell consumers NOT to edit files under
// .claude/skills/shipwrights/ or .claude/agents/shipwrights/ directly. To
// override agents, set `agent: { custom: "./.claude/agents/my-po.md" }`
// in `.shipwrights.yml`. To override skills, point the stage's `skill:`
// field at a project-local path. Anything you edit inside the managed
// subtrees will be clobbered on upgrade.

import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const MANAGED_README = `# Managed by @shipwrights/core

This directory is copied from \`node_modules/@shipwrights/core\` on every
\`shipwrights init\` and \`shipwrights upgrade\`. Any local edits here are
overwritten on the next upgrade.

To customize, see \`.shipwrights.yml\` overrides:

- For an agent: set \`agent: { custom: "./.claude/agents/my-agent.md" }\` on
  the relevant role.
- For a stage skill: set \`skill: "./.claude/skills/my-stage.md"\` on the
  relevant pipeline stage.

Don't edit files in this subtree directly.
`;

/**
 * Wire bundled skills + agents into the consumer's project-local .claude/.
 * Safe to call repeatedly: removes the managed subdirectories before each
 * write so stale content from a previous version is replaced cleanly.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot - consumer's project root
 * @param {string} opts.pluginRoot  - @shipwrights/core's location on disk
 * @returns {{ skills: string, agents: string }}
 */
export function installPluginSurfaces({ projectRoot, pluginRoot }) {
  const skillsSrc = join(pluginRoot, "skills");
  const agentsSrc = join(pluginRoot, "agents");
  const skillsDest = join(projectRoot, ".claude", "skills", "shipwrights");
  const agentsDest = join(projectRoot, ".claude", "agents", "shipwrights");

  if (!existsSync(skillsSrc) || !existsSync(agentsSrc)) {
    throw new Error(
      `Cannot find bundled skills/agents at ${pluginRoot}. ` +
        `Is @shipwrights/core installed correctly?`,
    );
  }

  for (const dest of [skillsDest, agentsDest]) {
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
    }
    mkdirSync(dest, { recursive: true });
  }

  cpSync(skillsSrc, skillsDest, { recursive: true });
  cpSync(agentsSrc, agentsDest, { recursive: true });

  writeFileSync(join(skillsDest, "MANAGED.md"), MANAGED_README, "utf8");
  writeFileSync(join(agentsDest, "MANAGED.md"), MANAGED_README, "utf8");

  return { skills: skillsDest, agents: agentsDest };
}
