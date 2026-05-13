// Built-in guard: validate Conventional Commits on the diff.
//
// Reads the commit list since the configured base ref and ensures each commit
// matches `<type>(<scope>): <subject>` per the project's allowed types and
// (optionally) required scope set.

import { execSync } from "node:child_process";

const DEFAULT_TYPES = [
	"feat",
	"fix",
	"chore",
	"docs",
	"refactor",
	"test",
	"perf",
	"build",
	"ci",
	"style",
	"revert",
];

function commitMessages(projectRoot, baseRef) {
	try {
		const log = execSync(`git log --no-merges --format=%s ${baseRef}..HEAD`, {
			cwd: projectRoot,
			encoding: "utf8",
		});
		return log.split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

export async function run({ projectRoot, config }) {
	const types = config.types ?? DEFAULT_TYPES;
	const baseRef = config.base_ref ?? "HEAD~10";
	const requireScope = config.require_scope !== false;

	const typesGroup = types.join("|");
	const pattern = requireScope
		? new RegExp(`^(?:${typesGroup})\\(([a-z0-9][\\w-]*)\\)!?:\\s.+`)
		: new RegExp(`^(?:${typesGroup})(?:\\(([a-z0-9][\\w-]*)\\))?!?:\\s.+`);

	const messages = commitMessages(projectRoot, baseRef);
	const violations = [];
	for (const msg of messages) {
		if (!pattern.test(msg)) {
			violations.push({
				message: `commit subject does not match conventional-commit pattern: "${msg}"`,
			});
		}
	}
	return {
		status: violations.length === 0 ? "pass" : "block",
		violations,
	};
}

export default run;
