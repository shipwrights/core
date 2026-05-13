#!/usr/bin/env node
// Rebase a per-role scratch branch onto the current feature branch tip.
// On clean rebase, fast-forwards the feature branch and (optionally) deletes
// the scratch. On conflict, bundles the scratch state for forensics and
// reports the conflict.
//
//   node scripts/shipwrights/integrate-scratch.mjs <role>

import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const role = process.argv[2];
if (!role) {
	console.error("usage: integrate-scratch.mjs <role>");
	process.exit(2);
}

const config = parseYaml(readFileSync(".shipwrights.yml", "utf8"));
const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
	encoding: "utf8",
}).trim();

// Detect whether the orchestrator is on the feature branch (canonical) or
// happens to be standing on the scratch branch. Either should work.
const scratchSuffix = `--${role}`;
let featureBranch;
let scratchBranch;
if (currentBranch.endsWith(scratchSuffix)) {
	scratchBranch = currentBranch;
	featureBranch = currentBranch.slice(0, -scratchSuffix.length);
} else {
	featureBranch = currentBranch;
	const pattern =
		config.branches.patterns.scratch ?? "<feature-branch>--<role>";
	scratchBranch = pattern
		.replace("<feature-branch>", featureBranch)
		.replace("<role>", role);
}

function git(args) {
	return spawnSync("git", args, { stdio: "inherit" });
}

console.log(`integrating ${scratchBranch} into ${featureBranch}`);

const featureTip = execSync(`git rev-parse ${featureBranch}`, {
	encoding: "utf8",
}).trim();

// 1. Switch to scratch and rebase onto current feature tip.
git(["checkout", scratchBranch]);
const rebase = git(["rebase", featureTip]);
if (rebase.status !== 0) {
	console.error("rebase failed");
	if (config.scratch?.bundle_on_failure) {
		const bundlePath = `.shipwrights/bundles/${scratchBranch}-${Date.now()}.bundle`;
		spawnSync(
			"node",
			["scripts/shipwrights/bundle-on-failure.mjs", scratchBranch, bundlePath],
			{ stdio: "inherit" },
		);
		console.error(`bundled to ${bundlePath} for forensics`);
	}
	process.exit(1);
}

// 2. Switch back to feature branch and fast-forward.
git(["checkout", featureBranch]);
const ff = git(["merge", "--ff-only", scratchBranch]);
if (ff.status !== 0) {
	console.error(
		"fast-forward merge failed; the scratch is likely behind. Re-rebase the scratch.",
	);
	process.exit(1);
}

// 3. Delete scratch if cleanup configured.
if (config.scratch?.cleanup_on_integrate) {
	git(["branch", "-D", scratchBranch]);
	if (config.scratch?.push_to_remote) {
		spawnSync("git", ["push", "origin", "--delete", scratchBranch], {
			stdio: "inherit",
		});
	}
}

console.log(`integrated ${scratchBranch} into ${featureBranch}`);
