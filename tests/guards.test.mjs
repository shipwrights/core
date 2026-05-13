import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run as branchName } from "../guards/branch-name.mjs";
import { run as commitFormat } from "../guards/commit-format.mjs";
import { run as fileLength } from "../guards/file-length.mjs";

function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-guards-"));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.name t", { cwd: dir });
	execSync("git config user.email t@t.com", { cwd: dir });
	writeFileSync(join(dir, "seed"), "");
	execSync('git add -A && git commit -q -m "chore: init"', { cwd: dir });
	return dir;
}

// ---------- file-length ----------

test("file-length: passes when files are within limits", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a.ts"), "const x = 1;\n".repeat(100));
	const r = await fileLength({
		projectRoot: dir,
		changedFiles: ["a.ts"],
		config: { rules: [{ pattern: "**/*.ts", max_lines: 250 }] },
	});
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

test("file-length: blocks when a file exceeds its rule", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "huge.ts"), "x\n".repeat(400));
	const r = await fileLength({
		projectRoot: dir,
		changedFiles: ["huge.ts"],
		config: { rules: [{ pattern: "**/*.ts", max_lines: 250 }] },
	});
	assert.equal(r.status, "block");
	assert.equal(r.violations.length, 1);
	assert.match(r.violations[0].message, /\d+ lines.*exceeds/);
	rmSync(dir, { recursive: true, force: true });
});

test("file-length: language-aware defaults when no rules supplied", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a.ts"), "x\n".repeat(300)); // ts default 250 — should fail
	writeFileSync(join(dir, "a.test.ts"), "x\n".repeat(300)); // test default 350 — should pass
	const r = await fileLength({
		projectRoot: dir,
		changedFiles: ["a.ts", "a.test.ts"],
		config: { rules: [] },
	});
	assert.equal(r.status, "block");
	const failedFiles = r.violations.map((v) => v.file);
	assert.deepEqual(failedFiles, ["a.ts"]);
	rmSync(dir, { recursive: true, force: true });
});

test("file-length: ignores files that don't match any rule", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "huge.txt"), "x\n".repeat(10000));
	const r = await fileLength({
		projectRoot: dir,
		changedFiles: ["huge.txt"],
		config: { rules: [{ pattern: "**/*.ts", max_lines: 250 }] },
	});
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

// ---------- branch-name ----------

test("branch-name: passes on conventional branch names", async () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-01-foo", { cwd: dir });
	const r = await branchName({ projectRoot: dir, config: {} });
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

test("branch-name: passes on long-lived branches", async () => {
	const dir = makeRepo();
	// default branch is master or main on init; rename to dev for the test
	execSync("git checkout -q -b dev", { cwd: dir });
	const r = await branchName({ projectRoot: dir, config: {} });
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

test("branch-name: blocks on bad branch name", async () => {
	const dir = makeRepo();
	execSync("git checkout -q -b WIP-do-the-thing", { cwd: dir });
	const r = await branchName({ projectRoot: dir, config: {} });
	assert.equal(r.status, "block");
	assert.match(r.violations[0].message, /does not match/);
	rmSync(dir, { recursive: true, force: true });
});

test("branch-name: respects custom pattern", async () => {
	const dir = makeRepo();
	execSync("git checkout -q -b ticket-12345", { cwd: dir });
	const r = await branchName({
		projectRoot: dir,
		config: { pattern: "^ticket-\\d+$", allowed_long_lived: [] },
	});
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

// ---------- commit-format ----------

test("commit-format: passes on conventional-commit messages", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a"), "x");
	execSync('git add -A && git commit -q -m "feat(scope): real change"', {
		cwd: dir,
	});
	const r = await commitFormat({
		projectRoot: dir,
		config: { base_ref: "HEAD~1", require_scope: true },
	});
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

test("commit-format: blocks on missing scope when require_scope is true", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a"), "x");
	execSync('git add -A && git commit -q -m "feat: missing scope"', {
		cwd: dir,
	});
	const r = await commitFormat({
		projectRoot: dir,
		config: { base_ref: "HEAD~1", require_scope: true },
	});
	assert.equal(r.status, "block");
	rmSync(dir, { recursive: true, force: true });
});

test("commit-format: passes when require_scope is false", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a"), "x");
	execSync('git add -A && git commit -q -m "feat: bare type"', { cwd: dir });
	const r = await commitFormat({
		projectRoot: dir,
		config: { base_ref: "HEAD~1", require_scope: false },
	});
	assert.equal(r.status, "pass");
	rmSync(dir, { recursive: true, force: true });
});

test("commit-format: blocks on unknown commit type", async () => {
	const dir = makeRepo();
	writeFileSync(join(dir, "a"), "x");
	execSync('git add -A && git commit -q -m "weird(scope): wrong type"', {
		cwd: dir,
	});
	const r = await commitFormat({
		projectRoot: dir,
		config: { base_ref: "HEAD~1" },
	});
	assert.equal(r.status, "block");
	rmSync(dir, { recursive: true, force: true });
});
