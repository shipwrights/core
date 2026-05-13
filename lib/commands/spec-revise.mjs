// `shipwrights spec-revise <id> <note>` — record a revision request on a
// drafted spec.
//
// What this does:
//   1. Snapshots the current plan to .shipwrights/specs/<id>.r<N>.md
//   2. Appends the user's note to .shipwrights/specs/<id>.input.md under
//      a `## Revision N` heading.
//   3. Bumps `revisions` in the plan frontmatter.
//   4. Leaves status: drafted so the orchestrator skill can re-run
//      analyze + plan when invoked next.
//
// The actual re-analysis runs inside Claude Code via /shipwrights-spec <id>
// — this CLI piece just records the revision request so the orchestrator
// has something to work from.

import { execSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config-loader.mjs";
import { readPlan, snapshotForRevision } from "../spec/plan-document.mjs";

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

export async function runSpecRevise({ projectRoot, args }) {
	const [id, ...noteParts] = args;
	const note = noteParts.join(" ").trim();

	if (!id || !note) {
		console.error("usage: shipwrights spec-revise <S-id> <note>");
		process.exit(2);
	}

	const config = loadConfig(projectRoot);
	const outputDir = config.spec?.output_dir ?? "docs/backlog/specs";

	const plan = readPlan({ projectRoot, outputDir, id });
	if (!plan) {
		console.error(`No spec with id ${id} under ${outputDir}/.`);
		process.exit(2);
	}
	if (plan.frontmatter.status !== "drafted") {
		console.error(
			`Cannot revise: spec is at status "${plan.frontmatter.status}". Only "drafted" specs accept revisions.`,
		);
		process.exit(2);
	}

	if (!isClean(projectRoot)) {
		console.error("Working tree is dirty. Commit or stash before revising.");
		process.exit(2);
	}

	// Snapshot the current plan.
	const currentRevisions = Number(plan.frontmatter.revisions ?? 0);
	const nextRev = currentRevisions + 1;
	const snapshotPath = snapshotForRevision({
		projectRoot,
		id,
		revisionNumber: nextRev,
		content: plan.raw,
	});

	// Append the note to the input file so the orchestrator picks it up.
	const inputPath = join(
		projectRoot,
		".shipwrights",
		"specs",
		`${id}.input.md`,
	);
	if (!existsSync(inputPath)) {
		writeFileSync(
			inputPath,
			`# ${id} — input\n\n## Task\n\n(missing original)\n`,
			"utf8",
		);
	}
	appendFileSync(
		inputPath,
		`\n\n## Revision ${nextRev}\n\nRequested at ${new Date().toISOString()}\n\n${note}\n`,
		"utf8",
	);

	// Bump revisions counter on the plan.
	const updated = plan.raw.replace(
		/^revisions:\s*\d+/m,
		`revisions: ${nextRev}`,
	);
	// If `revisions:` isn't in the frontmatter yet, insert it.
	const final = /^revisions:/m.test(updated)
		? updated
		: updated.replace(/^---\s*\n/, `---\nrevisions: ${nextRev}\n`);
	writeFileSync(plan.path, final, "utf8");

	spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
	spawnSync(
		"git",
		[
			"-c",
			"user.name=Shipwrights Revise",
			"-c",
			"user.email=shipwrights@noreply.local",
			"commit",
			"-m",
			`chore(spec): request revision ${nextRev} on ${id}`,
		],
		{ cwd: projectRoot, stdio: "inherit" },
	);

	console.log(`\n✓ Revision ${nextRev} recorded for ${id}.`);
	console.log(`  Snapshot: ${snapshotPath}`);
	console.log(`  Note appended to: ${inputPath}`);
	console.log(
		`\nNext: run /shipwrights-spec ${id} in Claude Code to re-run analyze + plan with the revision.`,
	);
}
