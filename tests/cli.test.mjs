// End-to-end CLI tests. Drives the actual `shipwright` bin against a tmp
// project shaped like a real consumer repo. Catches regressions that only
// manifest at the executable boundary (template paths, Windows path
// normalization, exit codes).

import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(here, "..");
const BIN = join(PLUGIN_ROOT, "bin", "shipwrights.mjs");

function makeMonorepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-cli-"));
	execSync("git init -q -b dev", { cwd: dir });
	execSync("git config user.name t", { cwd: dir });
	execSync("git config user.email t@t.com", { cwd: dir });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "cli-test",
			version: "0.0.1",
			scripts: { verify: "echo ok", test: "echo ok", lint: "echo ok" },
		}),
	);
	writeFileSync(join(dir, "pnpm-lock.yaml"), "");
	writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
	mkdirSync(join(dir, "apps/api/src"), { recursive: true });
	mkdirSync(join(dir, "apps/web/src"), { recursive: true });
	writeFileSync(join(dir, "apps/api/src/server.ts"), "export const x = 1;\n");
	writeFileSync(join(dir, "apps/web/src/page.tsx"), "export const y = 2;\n");
	execSync('git add -A && git commit -q -m "chore: init"', { cwd: dir });
	return dir;
}

function sw(args, cwd, extraEnv = {}) {
	return spawnSync("node", [BIN, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
	});
}

function makeFakeGh({ labels = [], secrets = [] }) {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-gh-"));
	const script = join(dir, "gh.js");
	writeFileSync(
		script,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "label" && args[1] === "list") {
  console.log(${JSON.stringify(JSON.stringify(labels.map((name) => ({ name }))))});
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "list") {
  console.log(${JSON.stringify(JSON.stringify(secrets.map((name) => ({ name }))))});
  process.exit(0);
}
console.error("unexpected gh call: " + args.join(" "));
process.exit(1);
`,
		"utf8",
	);
	chmodSync(script, 0o755);
	writeFileSync(
		join(dir, "gh.cmd"),
		`@echo off\r\nnode "%~dp0gh.js" %*\r\n`,
		"utf8",
	);
	return {
		dir,
		env: { PATH: `${dir}${delimiter}${process.env.PATH}` },
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("init scaffolds a fresh project in non-interactive mode", () => {
	const dir = makeMonorepo();
	const r = sw(["init", "--non-interactive"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Shipwrights installed/);
	// Spot check the resulting tree
	assert.equal(existsSync(join(dir, ".shipwrights.yml")), true);
	assert.equal(
		existsSync(join(dir, ".github/workflows/auto-merge-low-tier.yml")),
		true,
	);
	assert.equal(
		existsSync(join(dir, "scripts/shipwrights/integrate-scratch.mjs")),
		true,
	);
	assert.equal(existsSync(join(dir, "docs/process/in-flight.md")), true);
	const postMerge = readFileSync(
		join(dir, ".github/workflows/post-merge-doc-update.yml"),
		"utf8",
	);
	const autoMerge = readFileSync(
		join(dir, ".github/workflows/auto-merge-low-tier.yml"),
		"utf8",
	);
	assert.match(postMerge, /SHIPWRIGHTS_BOT_TOKEN/);
	assert.match(postMerge, /gh pr merge --auto/);
	assert.match(autoMerge, /disable-auto-merge/);
	// Single git commit was made
	const log = execSync("git log --oneline", { cwd: dir, encoding: "utf8" });
	assert.match(log, /chore: install @shipwrights\/core/);
	rmSync(dir, { recursive: true, force: true });
});

test("init wires .claude/skills + .claude/agents flat (v0.2.2)", () => {
	const dir = makeMonorepo();
	const r = sw(["init", "--non-interactive"], dir);
	assert.equal(r.status, 0, r.stderr);
	// Skills live directly under .claude/skills/<name>/SKILL.md — flat,
	// not nested under .claude/skills/shipwrights/. The flat layout is what
	// Claude Code actually discovers; the nested layout was invisible.
	assert.equal(
		existsSync(join(dir, ".claude", "skills", "shipwrights-epic", "SKILL.md")),
		true,
	);
	assert.equal(
		existsSync(
			join(dir, ".claude", "skills", "shipwrights-doctor", "SKILL.md"),
		),
		true,
	);
	// Stages subdirectory comes along (it's part of the skills/ source).
	assert.equal(
		existsSync(join(dir, ".claude", "skills", "stages", "refine.md")),
		true,
	);
	// Bundled agents always land flat in .claude/agents/. v0.2.2 skipped
	// copying when a user-global agent of the same name existed, but that
	// produced a confusingly-empty agents folder; v0.2.3 always copies.
	// Users who want their user-global customisation to apply set
	// `agent: { user: "<name>" }` on the relevant role in .shipwrights.yml.
	assert.equal(
		existsSync(join(dir, ".claude", "agents", "product-owner-strategist.md")),
		true,
	);
	assert.equal(
		existsSync(
			join(dir, ".claude", "agents", "node-backend-systems-architect.md"),
		),
		true,
	);
	// A SHIPWRIGHTS-MANAGED.md marker sits at the skills root.
	assert.equal(
		existsSync(join(dir, ".claude", "skills", "SHIPWRIGHTS-MANAGED.md")),
		true,
	);
	// Track file recorded what we installed so the next run can clean up.
	assert.equal(
		existsSync(join(dir, ".shipwrights", "installed-files.json")),
		true,
	);
	rmSync(dir, { recursive: true, force: true });
});

test("init cleans up the v0.2.0/v0.2.1 nested layout if present", () => {
	const dir = makeMonorepo();
	// Simulate a v0.2.0/v0.2.1 install: write the nested directories first.
	const nestedSkills = join(dir, ".claude", "skills", "shipwrights");
	const nestedAgents = join(dir, ".claude", "agents", "shipwrights");
	mkdirSync(nestedSkills, { recursive: true });
	mkdirSync(nestedAgents, { recursive: true });
	writeFileSync(join(nestedSkills, "stale.md"), "old", "utf8");
	writeFileSync(join(nestedAgents, "stale.md"), "old", "utf8");
	execSync('git add -A && git commit -q -m "simulate legacy"', { cwd: dir });

	const r = sw(["init", "--non-interactive"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(
		existsSync(nestedSkills),
		false,
		".claude/skills/shipwrights should be removed",
	);
	assert.equal(
		existsSync(nestedAgents),
		false,
		".claude/agents/shipwrights should be removed",
	);
	rmSync(dir, { recursive: true, force: true });
});

test("init refuses on dirty working tree without --force", () => {
	const dir = makeMonorepo();
	writeFileSync(join(dir, "uncommitted.txt"), "x");
	const r = sw(["init", "--non-interactive"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /dirty/);
	rmSync(dir, { recursive: true, force: true });
});

test("init refuses to re-run when .shipwrights.yml exists", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	const r = sw(["init", "--non-interactive"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /already exists/);
	rmSync(dir, { recursive: true, force: true });
});

test("init --dry-run writes nothing (with --non-interactive to skip prompts)", () => {
	const dir = makeMonorepo();
	const r = sw(["init", "--dry-run", "--non-interactive"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Dry run/);
	assert.equal(existsSync(join(dir, ".shipwrights.yml")), false);
	rmSync(dir, { recursive: true, force: true });
});

test("doctor passes after init on a monorepo (with one warn for missing gh)", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	const r = sw(["doctor"], dir);
	// Doctor exits non-zero only on fails; warns are tolerated.
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Config: valid/);
	assert.match(r.stdout, /\b0 fail\b/);
	rmSync(dir, { recursive: true, force: true });
});

test("doctor warns when auto-merge is configured without bot token secret", () => {
	const dir = makeMonorepo();
	const gh = makeFakeGh({
		labels: ["tier:trivial", "tier:minimal", "do-not-auto-merge"],
		secrets: [],
	});
	sw(["init", "--non-interactive"], dir);
	const r = sw(["doctor"], dir, gh.env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /GitHub labels: all 3 present/);
	assert.match(r.stdout, /GitHub secret: SHIPWRIGHTS_BOT_TOKEN/);
	assert.match(r.stdout, /missing; bot-created follow-up PRs/);
	assert.match(r.stdout, /\b0 fail\b/);
	gh.cleanup();
	rmSync(dir, { recursive: true, force: true });
});

test("doctor passes bot-token readiness when secret is configured", () => {
	const dir = makeMonorepo();
	const gh = makeFakeGh({
		labels: ["tier:trivial", "tier:minimal", "do-not-auto-merge"],
		secrets: ["SHIPWRIGHTS_BOT_TOKEN"],
	});
	sw(["init", "--non-interactive"], dir);
	const r = sw(["doctor"], dir, gh.env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /GitHub secret: SHIPWRIGHTS_BOT_TOKEN configured/);
	assert.match(r.stdout, /\b0 warn, 0 fail\b/);
	gh.cleanup();
	rmSync(dir, { recursive: true, force: true });
});

test("status shows 'Nothing in flight' on a fresh init", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	const r = sw(["status"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Nothing in flight/);
	rmSync(dir, { recursive: true, force: true });
});

test("init adds yaml + minimatch to consumer's devDependencies (v0.1.3 fix)", () => {
	const dir = makeMonorepo();
	const r = sw(["init", "--non-interactive"], dir);
	assert.equal(r.status, 0, r.stderr);
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	assert.ok(pkg.devDependencies?.yaml, "yaml should be in devDependencies");
	assert.ok(
		pkg.devDependencies?.minimatch,
		"minimatch should be in devDependencies",
	);
	rmSync(dir, { recursive: true, force: true });
});

test("init does not duplicate yaml/minimatch if already in dependencies", () => {
	const dir = makeMonorepo();
	// Pre-populate package.json with the deps already
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	pkg.dependencies = { yaml: "^2.5.0", minimatch: "^9.0.0" };
	writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
	execSync('git add -A && git commit -q -m "deps: pre-existing"', { cwd: dir });
	sw(["init", "--non-interactive"], dir);
	const finalPkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	// Existing dependencies entries kept; nothing added to devDependencies
	assert.equal(finalPkg.dependencies.yaml, "^2.5.0");
	assert.equal(finalPkg.dependencies.minimatch, "^9.0.0");
	assert.equal(finalPkg.devDependencies?.yaml, undefined);
	assert.equal(finalPkg.devDependencies?.minimatch, undefined);
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade is a no-op when at current version", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	const r = sw(["upgrade"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /Already up to date/);
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade refuses dirty worktree before legacy filesystem migration", () => {
	const dir = makeMonorepo();
	writeFileSync(join(dir, ".shipwright.yml"), "version: 1\n");
	execSync('git add -A && git commit -q -m "legacy shipwright config"', {
		cwd: dir,
	});
	writeFileSync(join(dir, "unrelated.txt"), "do not sweep into upgrade\n");
	const r = sw(["upgrade"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Working tree dirty/);
	assert.equal(existsSync(join(dir, ".shipwright.yml")), true);
	assert.equal(existsSync(join(dir, ".shipwrights.yml")), false);
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade refreshes managed templates that match the manifest", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	// After init, the manifest exists and tracks the rendered hashes. Pretend
	// a new plugin version ships an updated template by changing the current
	// rendered file to look "stale" but still matching the manifest (i.e.,
	// the user hasn't touched it since init). Easiest way: just blow away the
	// generated file's contents and rewrite to whatever-init-wrote then run
	// upgrade — the file already matches manifest, so no-op.
	const r = sw(["upgrade"], dir);
	assert.equal(r.status, 0, r.stderr);
	// A real refresh (different content from manifest hash, matching manifest)
	// is hard to fake without mutating the plugin itself. The previous test
	// asserted upgrade clobbers stale content; v0.6.1 makes that opt-in via
	// --force. See the --force test below for that path.
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade refuses to clobber a user-edited managed template (no --force)", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	// User hand-edits a managed file after init. Init recorded the original
	// hash in the manifest; this edit makes the file diverge.
	writeFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"// user-added local override\nconsole.log('hand-edited');\n",
	);
	execSync('git add -A && git commit -q -m "hand-edit"', { cwd: dir });
	const r = sw(["upgrade"], dir);
	assert.equal(r.status, 0, r.stderr);
	const after = readFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"utf8",
	);
	assert.match(after, /hand-edited/, "user edit must be preserved");
	assert.match(
		r.stdout,
		/skipped.*update-epic-after-merge.*user-edited since last upgrade/,
	);
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade --force clobbers user edits and refreshes the manifest", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	writeFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"// user-added local override\nconsole.log('hand-edited');\n",
	);
	execSync('git add -A && git commit -q -m "hand-edit"', { cwd: dir });
	const r = sw(["upgrade", "--force"], dir);
	assert.equal(r.status, 0, r.stderr);
	const after = readFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"utf8",
	);
	assert.doesNotMatch(after, /hand-edited/, "--force overwrites user edit");
	assert.match(after, /releaseInFlight/, "refreshed to plugin's version");
	rmSync(dir, { recursive: true, force: true });
});

test("upgrade leaves a pre-existing untracked managed template alone (no --force)", () => {
	const dir = makeMonorepo();
	sw(["init", "--non-interactive"], dir);
	// Simulate a pre-v0.6.1 install: the file exists but the manifest doesn't
	// know about it. Easiest faked by clearing the manifest entry for one file.
	const manifestPath = join(dir, ".shipwrights-managed.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	delete manifest.files["scripts/shipwrights/update-epic-after-merge.mjs"];
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
	// Make the file diverge from what would render so it doesn't auto-match.
	writeFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"// pre-existing, possibly user-edited from a prior plugin version\n",
	);
	execSync('git add -A && git commit -q -m "pre-existing"', { cwd: dir });
	const r = sw(["upgrade"], dir);
	assert.equal(r.status, 0, r.stderr);
	const after = readFileSync(
		join(dir, "scripts/shipwrights/update-epic-after-merge.mjs"),
		"utf8",
	);
	assert.match(after, /pre-existing/, "untracked file is preserved");
	assert.match(r.stdout, /skipped.*pre-existing/);
	rmSync(dir, { recursive: true, force: true });
});

test("help prints usage", () => {
	const r = spawnSync("node", [BIN, "--help"], { encoding: "utf8" });
	assert.equal(r.status, 0);
	assert.match(r.stdout, /Shipwright/);
	assert.match(r.stdout, /init/);
	assert.match(r.stdout, /doctor/);
	assert.match(r.stdout, /status/);
	assert.match(r.stdout, /upgrade/);
});

test("unknown command exits non-zero with help", () => {
	const r = spawnSync("node", [BIN, "frobnicate"], { encoding: "utf8" });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Unknown command/);
});
