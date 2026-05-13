import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enforceScope } from "../lib/scope-enforcer.mjs";

function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-scope-"));
	execSync("git init -q", { cwd: dir });
	execSync("git config user.name t", { cwd: dir });
	execSync("git config user.email t@t.com", { cwd: dir });
	writeFileSync(join(dir, "seed"), "");
	execSync("git add -A && git commit -q -m init", { cwd: dir });
	return dir;
}

function commitFile(dir, relPath, content = "x") {
	const full = join(dir, relPath);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
	execSync(`git add "${relPath}"`, { cwd: dir });
	execSync(`git commit -q -m "add ${relPath}"`, { cwd: dir });
}

test("returns ok when role has no declared scope", () => {
	const dir = makeRepo();
	commitFile(dir, "anywhere.txt");
	const r = enforceScope({
		projectRoot: dir,
		role: { name: "x", capabilities: {} },
		baseRef: "HEAD~1",
		freezePaths: [],
	});
	assert.equal(r.ok, true);
	assert.deepEqual(r.violations, []);
	rmSync(dir, { recursive: true, force: true });
});

test("passes when all changes are in scope", () => {
	const dir = makeRepo();
	commitFile(dir, "apps/api/src/handler.ts");
	commitFile(dir, "apps/api/test/handler.test.ts");
	const r = enforceScope({
		projectRoot: dir,
		role: { name: "backend", capabilities: { scope: ["apps/api/**"] } },
		baseRef: "HEAD~2",
		freezePaths: [],
	});
	assert.equal(r.ok, true);
	rmSync(dir, { recursive: true, force: true });
});

test("flags out-of-scope writes", () => {
	const dir = makeRepo();
	commitFile(dir, "apps/api/src/handler.ts");
	commitFile(dir, "apps/web/src/page.tsx");
	const r = enforceScope({
		projectRoot: dir,
		role: { name: "backend", capabilities: { scope: ["apps/api/**"] } },
		baseRef: "HEAD~2",
		freezePaths: [],
	});
	assert.equal(r.ok, false);
	assert.equal(r.violations.length, 1);
	assert.match(r.violations[0].path, /apps\/web/);
	rmSync(dir, { recursive: true, force: true });
});

test("flags frozen-path edits even when in scope", () => {
	const dir = makeRepo();
	commitFile(dir, "packages/contracts/src/api.ts");
	commitFile(dir, "apps/api/src/handler.ts");
	const r = enforceScope({
		projectRoot: dir,
		role: {
			name: "backend",
			capabilities: { scope: ["apps/api/**", "packages/contracts/**"] },
		},
		baseRef: "HEAD~2",
		freezePaths: ["packages/contracts/**"],
	});
	assert.equal(r.ok, false);
	assert.equal(r.frozen.length, 1);
	assert.match(r.frozen[0].path, /packages\/contracts/);
	rmSync(dir, { recursive: true, force: true });
});

test("multiple scope patterns with glob extras work", () => {
	const dir = makeRepo();
	commitFile(dir, "src/foo.test.ts");
	commitFile(dir, "src/foo.spec.ts");
	commitFile(dir, "test/integration.test.ts");
	const r = enforceScope({
		projectRoot: dir,
		role: {
			name: "qa",
			capabilities: {
				scope: ["**/*.test.ts", "**/*.spec.ts", "test/**"],
			},
		},
		baseRef: "HEAD~3",
		freezePaths: [],
	});
	assert.equal(r.ok, true);
	rmSync(dir, { recursive: true, force: true });
});
