// `shipwrights spec <description>` — entry CLI command for the spec-first
// pipeline.
//
// What this command does on the CLI side (the orchestrator skill running
// inside Claude Code does the actual work via the stage skills):
//
//   1. Parse args (--auto, --context-depth, --output-dir overrides).
//   2. Validate prerequisites: in a git repo, working tree clean,
//      .shipwrights.yml present.
//   3. Allocate a spec id (S-<yyyy-mm-dd>-<hash>).
//   4. Persist the raw task input to .shipwrights/specs/<id>.input.md
//      so the orchestrator skill picks it up and runs the pipeline.
//   5. Print the spec id + next steps.
//
// The orchestrator skill (skills/shipwrights-spec/SKILL.md) is the one
// that actually drives discover → spec → analyze → plan inside Claude
// Code. This CLI is the entrypoint for users running outside Claude Code
// or who want to script the input.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config-loader.mjs";
import { generateSpecId, slugifyTitle } from "../spec/plan-document.mjs";

function parseFlags(args) {
	const flags = {
		auto: false,
		contextDepth: null,
		outputDir: null,
		input: [],
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--auto") flags.auto = true;
		else if (arg === "--context-depth") flags.contextDepth = args[++i];
		else if (arg === "--output-dir") flags.outputDir = args[++i];
		else flags.input.push(arg);
	}
	flags.taskDescription = flags.input.join(" ").trim();
	return flags;
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

function inGit(projectRoot) {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: projectRoot,
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

function confirmAutoMode({ taskDescription, budget, contextDepth, outputDir }) {
	const banner = [
		"",
		"════════════════════════════════════════════════════════════════════",
		"  AUTONOMOUS MODE — no human review of the spec before build.",
		"════════════════════════════════════════════════════════════════════",
		`  Task:           ${taskDescription.slice(0, 120)}${taskDescription.length > 120 ? "…" : ""}`,
		`  Context depth:  ${contextDepth}`,
		`  Output dir:     ${outputDir}`,
		`  Budget:         ${budget ? `${budget.toLocaleString()} tokens per epic` : "(no cap)"}`,
		"",
		"  The spec will still be written to disk for the audit trail, but the",
		"  build stage will start without your review. Safety nets:",
		"    - scope enforcer on every specialist's writes",
		"    - guards run at integration",
		"    - tests + gatekeeper review still gate the PR",
		"",
		"  Confirm? [y/N]",
		"",
	].join("\n");
	process.stdout.write(banner);
}

export async function runSpec({ projectRoot, pluginRoot, args }) {
	const flags = parseFlags(args);

	if (!flags.taskDescription) {
		console.error(
			"usage: shipwrights spec [--auto] [--context-depth shallow|medium|deep] [--output-dir <path>] <task description>",
		);
		process.exit(2);
	}

	if (!inGit(projectRoot)) {
		console.error(
			"Not a git repository. Initialize one first or change directory.",
		);
		process.exit(2);
	}
	if (!isClean(projectRoot)) {
		console.error(
			"Working tree is dirty. Commit or stash before drafting a spec.",
		);
		process.exit(2);
	}

	let config;
	try {
		config = loadConfig(projectRoot);
	} catch (err) {
		console.error("No .shipwrights.yml. Run `shipwrights init` first.");
		console.error(err.message);
		process.exit(2);
	}

	const specConfig = config.spec ?? {};
	const outputDir =
		flags.outputDir ?? specConfig.output_dir ?? "docs/backlog/specs";
	const contextDepth =
		flags.contextDepth ?? specConfig.context_depth ?? "medium";
	const approvalRequired = flags.auto
		? false
		: specConfig.approval_required !== false;
	const budget = config.telemetry?.budget_per_epic_tokens ?? null;

	if (flags.auto) {
		confirmAutoMode({
			taskDescription: flags.taskDescription,
			budget,
			contextDepth,
			outputDir,
		});
		const answer = await readSingleLine();
		if (
			answer.trim().toLowerCase() !== "y" &&
			answer.trim().toLowerCase() !== "yes"
		) {
			console.log("Aborted.");
			process.exit(0);
		}
	}

	// Allocate id + persist input.
	const id = generateSpecId();
	const slug = slugifyTitle(flags.taskDescription.split(/[.\n]/)[0]);
	const inputDir = join(projectRoot, ".shipwrights", "specs");
	mkdirSync(inputDir, { recursive: true });
	const inputPath = join(inputDir, `${id}.input.md`);
	writeFileSync(
		inputPath,
		`# ${id} — input\n\nGenerated at ${new Date().toISOString()}\n\nApproval required: ${approvalRequired}\nContext depth: ${contextDepth}\nOutput dir: ${outputDir}\n\n## Task\n\n${flags.taskDescription}\n`,
		"utf8",
	);

	// Print next-step instructions. The actual pipeline runs inside Claude
	// Code via the /shipwrights-spec slash command, which reads the input
	// file we just wrote and drives discover → spec → analyze → plan.
	console.log(`\n✓ Spec input written: ${inputPath}`);
	console.log(`✓ Allocated id: ${id}`);
	console.log(`✓ Slug: ${slug}`);
	console.log(`✓ Approval required: ${approvalRequired}`);
	console.log(`\nNext:`);
	console.log(`  Open Claude Code in this project and run:`);
	console.log(`    /shipwrights-spec ${id}`);
	console.log(
		`  The orchestrator skill picks up the input, runs the pipeline,`,
	);
	console.log(`  and writes the plan to ${outputDir}/.`);
	if (approvalRequired) {
		console.log(`\nAfter the plan is drafted, review then run one of:`);
		console.log(`  /shipwrights-spec-approve ${id}`);
		console.log(`  /shipwrights-spec-revise ${id} <your note>`);
		console.log(`  /shipwrights-spec-cancel ${id}`);
	} else {
		console.log(
			`\n(--auto mode: the pipeline will proceed straight to build after the plan is written.)`,
		);
	}
}

function readSingleLine() {
	return new Promise((resolve) => {
		process.stdin.resume();
		process.stdin.setEncoding("utf8");
		process.stdin.once("data", (chunk) => {
			process.stdin.pause();
			resolve(chunk.toString());
		});
	});
}
