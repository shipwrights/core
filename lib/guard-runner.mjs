import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { importFromPath } from "./import-from-path.mjs";

const require = createRequire(import.meta.url);

const BUILTIN_GUARDS = {
	"file-length": () => import("../guards/file-length.mjs"),
	"branch-name": () => import("../guards/branch-name.mjs"),
	"commit-format": () => import("../guards/commit-format.mjs"),
};

async function loadGuard(guard, { projectRoot }) {
	if (BUILTIN_GUARDS[guard.name]) {
		const mod = await BUILTIN_GUARDS[guard.name]();
		return { kind: "fn", run: mod.run ?? mod.default };
	}

	const runs = guard.runs;
	if (runs?.bundled && BUILTIN_GUARDS[runs.bundled]) {
		const mod = await BUILTIN_GUARDS[runs.bundled]();
		return { kind: "fn", run: mod.run ?? mod.default };
	}
	if (runs?.shell) {
		return { kind: "shell", cmd: runs.shell };
	}
	if (runs?.npm) {
		let resolved;
		try {
			resolved = require.resolve(runs.npm, { paths: [projectRoot] });
		} catch (err) {
			throw new Error(
				`Guard "${guard.name}" npm package not found: ${runs.npm}`,
			);
		}
		const mod = await importFromPath(resolved);
		return { kind: "fn", run: mod.run ?? mod.default };
	}

	throw new Error(`Guard "${guard.name}" has no resolvable runner`);
}

function changedFiles(projectRoot, baseRef) {
	try {
		const out = execSync(`git diff --name-only ${baseRef}`, {
			cwd: projectRoot,
			encoding: "utf8",
		});
		return out.split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

export async function runGuards(guards, ctx) {
	const { projectRoot, baseRef = "HEAD~1", stage } = ctx;
	const results = [];

	for (const guard of guards) {
		if (guard.enabled === false) continue;
		if (guard.stages && stage && !guard.stages.includes(stage)) continue;

		let runner;
		try {
			runner = await loadGuard(guard, { projectRoot });
		} catch (err) {
			results.push({ name: guard.name, status: "block", error: err.message });
			continue;
		}

		const guardCtx = {
			projectRoot,
			changedFiles: changedFiles(projectRoot, baseRef),
			config: { ...guard, ...ctx },
		};

		let result;
		if (runner.kind === "fn") {
			try {
				result = await runner.run(guardCtx);
			} catch (err) {
				result = { status: "block", violations: [{ message: err.message }] };
			}
		} else if (runner.kind === "shell") {
			const r = spawnSync(runner.cmd, {
				cwd: projectRoot,
				shell: true,
				stdio: "pipe",
				encoding: "utf8",
			});
			result = {
				status: r.status === 0 ? "pass" : "block",
				violations:
					r.status === 0
						? []
						: [
								{
									message:
										r.stdout?.trim() || r.stderr?.trim() || `exit ${r.status}`,
								},
							],
			};
		}

		const final = {
			name: guard.name,
			status: result.status,
			violations: result.violations ?? [],
		};

		if (result.status !== "pass" && guard.on_violation === "warn") {
			final.status = "warn";
		}
		results.push(final);
	}

	return results;
}
