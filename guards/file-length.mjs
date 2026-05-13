// Built-in guard: enforce file-length limits per language / per pattern.
//
// Config:
//   - name: file-length
//     rules:
//       - pattern: "**/*.ts"
//         max_lines: 250
//       - pattern: "**/*.test.ts"
//         max_lines: 350
//
// Defaults if no rules supplied: language-aware (typescript 250/350, python
// 400/600, go 500/700, rust 400/600, ruby 250/400, java 400/600).

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { minimatch } from "minimatch";

const LANGUAGE_DEFAULTS = [
	{ pattern: "**/*.test.{ts,tsx,js,jsx}", max_lines: 350 },
	{ pattern: "**/*.spec.{ts,tsx,js,jsx}", max_lines: 350 },
	{ pattern: "**/*.{ts,tsx,js,jsx}", max_lines: 250 },
	{ pattern: "**/*.test.py", max_lines: 600 },
	{ pattern: "**/*.py", max_lines: 400 },
	{ pattern: "**/*_test.go", max_lines: 700 },
	{ pattern: "**/*.go", max_lines: 500 },
	{ pattern: "**/*_test.rs", max_lines: 600 },
	{ pattern: "**/*.rs", max_lines: 400 },
	{ pattern: "**/*_spec.rb", max_lines: 400 },
	{ pattern: "**/*.rb", max_lines: 250 },
];

function ruleFor(path, rules) {
	for (const r of rules) {
		if (minimatch(path, r.pattern, { dot: true })) return r;
	}
	return null;
}

export async function run({ projectRoot, changedFiles, config }) {
	const rules = config.rules?.length ? config.rules : LANGUAGE_DEFAULTS;
	const violations = [];

	for (const file of changedFiles) {
		const rule = ruleFor(file, rules);
		if (!rule) continue;
		const fullPath = join(projectRoot, file);
		if (!existsSync(fullPath)) continue;
		let s;
		try {
			s = statSync(fullPath);
		} catch {
			continue;
		}
		if (!s.isFile()) continue;
		const lines = readFileSync(fullPath, "utf8").split("\n").length;
		if (lines > rule.max_lines) {
			violations.push({
				file,
				message: `file has ${lines} lines, exceeds ${rule.pattern} limit of ${rule.max_lines}`,
			});
		}
	}

	return {
		status: violations.length === 0 ? "pass" : "block",
		violations,
	};
}

export default run;
