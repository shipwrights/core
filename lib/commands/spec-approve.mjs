// `shipwrights spec-approve <id>` — flip a drafted spec to approved so the
// build pipeline can proceed.
//
// Enforces:
//   - spec exists at the configured output_dir
//   - current status is `drafted` (only state from which approve is valid)
//   - citation manifest still resolves (re-run strict enforcement before
//     approval — protects against drafted plans whose manifest was deleted
//     between drafting and approving)
//   - working tree is clean (so the approve commit is a no-noise marker)

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config-loader.mjs";
import { readManifest, validateCitations } from "../spec/manifest.mjs";
import { readPlan, setStatus } from "../spec/plan-document.mjs";
import { assertValidTransition } from "../spec/state-machine.mjs";

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

export async function runSpecApprove({ projectRoot, args }) {
	const id = args[0];
	if (!id) {
		console.error("usage: shipwrights spec-approve <S-id>");
		process.exit(2);
	}

	const config = loadConfig(projectRoot);
	const outputDir = config.spec?.output_dir ?? "docs/backlog/specs";
	const enforcement = config.spec?.enforcement ?? "strict";

	const plan = readPlan({ projectRoot, outputDir, id });
	if (!plan) {
		console.error(`No spec with id ${id} under ${outputDir}/.`);
		process.exit(2);
	}

	const currentStatus = plan.frontmatter.status;
	try {
		assertValidTransition(currentStatus, "approved");
	} catch (err) {
		console.error(err.message);
		process.exit(2);
	}

	// Re-run citation validation before approving. The drafted spec went
	// through the gate once, but a careful approve re-runs in case the
	// manifest was deleted or the plan edited.
	const manifest = readManifest(projectRoot, id);
	if (!manifest) {
		if (enforcement === "strict") {
			console.error(
				`Manifest not found at .shipwrights/specs/${id}.manifest.json. Cannot validate citations.`,
			);
			console.error(
				`To proceed anyway, set spec.enforcement: loose in .shipwrights.yml.`,
			);
			process.exit(2);
		}
		console.warn(
			`[shipwrights] manifest not found; loose mode — skipping citation check.`,
		);
	} else {
		const result = validateCitations(plan.body, manifest);
		if (!result.ok && enforcement === "strict") {
			console.error(
				`Citation enforcement failed: ${result.violations.length} uncited claim(s):`,
			);
			for (const v of result.violations) {
				console.error(
					`  ${v.section}: ${v.path}${v.range ? `:${v.range}` : ""}`,
				);
			}
			console.error(
				`Either revise the plan or set spec.enforcement: loose to bypass.`,
			);
			process.exit(2);
		}
		if (!result.ok) {
			console.warn(
				`[shipwrights] ${result.violations.length} uncited claim(s) (loose mode):`,
			);
			for (const v of result.violations) {
				console.warn(
					`  ${v.section}: ${v.path}${v.range ? `:${v.range}` : ""}`,
				);
			}
		}
	}

	if (!isClean(projectRoot)) {
		console.error("Working tree is dirty. Commit or stash before approving.");
		process.exit(2);
	}

	setStatus({ projectRoot, outputDir, id, status: "approved" });

	spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
	spawnSync(
		"git",
		[
			"-c",
			"user.name=Shipwrights Approve",
			"-c",
			"user.email=shipwrights@noreply.local",
			"commit",
			"-m",
			`chore(spec): approve ${id}`,
		],
		{ cwd: projectRoot, stdio: "inherit" },
	);

	console.log(`\n✓ Spec ${id} approved.`);
	console.log(
		`Next: run /shipwrights-spec-build ${id} in Claude Code (or set --auto on the original draft).`,
	);
}
