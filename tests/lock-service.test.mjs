import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LockService } from "../lib/lock-service.mjs";

function gitInit(dir) {
	execSync("git init -q", { cwd: dir });
	execSync("git config user.name t", { cwd: dir });
	execSync("git config user.email t@t.com", { cwd: dir });
	writeFileSync(join(dir, "x"), "");
	execSync("git add -A && git commit -q -m init", { cwd: dir });
}

function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-lock-"));
	gitInit(dir);
	return dir;
}

test("markdown lock: list returns [] when register absent", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	assert.deepEqual(await lock.list(), []);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: claim writes register, list reads it back", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	const r = await lock.claim({
		branch: "feature/e-01",
		epic: "E-01",
		stage: "build",
		tier: "full",
		specialists: ["backend", "frontend"],
	});
	assert.equal(r.ok, true);
	const rows = await lock.list();
	assert.equal(rows.length, 1);
	assert.equal(rows[0].branch, "feature/e-01");
	assert.equal(rows[0].epic, "E-01");
	assert.deepEqual(rows[0].specialists, ["backend", "frontend"]);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: second claim on same epic by different branch is rejected", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	await lock.claim({
		branch: "feature/e-01",
		epic: "E-01",
		stage: "build",
		tier: "full",
	});
	const r = await lock.claim({
		branch: "feature/e-01-fix",
		epic: "E-01",
		stage: "build",
		tier: "full",
	});
	assert.equal(r.ok, false);
	assert.match(r.reason, /E-01 already in flight/);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: re-claim on same branch updates fields", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	await lock.claim({
		branch: "feature/e-02",
		epic: "E-02",
		stage: "refine",
		tier: "full",
	});
	await lock.claim({
		branch: "feature/e-02",
		epic: "E-02",
		stage: "build",
		tier: "full",
		specialists: ["qa"],
	});
	const rows = await lock.list();
	assert.equal(rows.length, 1);
	assert.equal(rows[0].stage, "build");
	assert.deepEqual(rows[0].specialists, ["qa"]);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: update mutates one row", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	await lock.claim({
		branch: "feature/e-03",
		epic: "E-03",
		stage: "refine",
		tier: "light",
	});
	const r = await lock.update({
		branch: "feature/e-03",
		fields: { stage: "ship" },
	});
	assert.equal(r.ok, true);
	const rows = await lock.list();
	assert.equal(rows[0].stage, "ship");
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: release removes the row", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	await lock.claim({
		branch: "feature/e-04",
		epic: "E-04",
		stage: "ship",
		tier: "full",
	});
	await lock.release({ branch: "feature/e-04" });
	const rows = await lock.list();
	assert.equal(rows.length, 0);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: register file format readable to humans", async () => {
	const dir = makeRepo();
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown" },
	});
	await lock.claim({
		branch: "feature/e-05",
		epic: "E-05",
		stage: "test",
		tier: "full",
		specialists: ["qa"],
	});
	const path = join(dir, "docs/process/in-flight.md");
	const content = readFileSync(path, "utf8");
	assert.match(content, /# In-flight branches/);
	assert.match(content, /\| Branch \| Epic \| Stage \|/);
	assert.match(content, /\| feature\/e-05 \| E-05 \| test \|/);
	rmSync(dir, { recursive: true, force: true });
});

test("markdown lock: stale detection flags branches with no recent commits", async () => {
	const dir = makeRepo();
	// Create a branch but don't commit on it.
	execSync("git checkout -q -b feature/e-06", { cwd: dir });
	const lock = await LockService.create({
		projectRoot: dir,
		lockConfig: { kind: "markdown", config: { stale_after_hours: 0 } },
	});
	await lock.claim({
		branch: "feature/e-06",
		epic: "E-06",
		stage: "build",
		tier: "full",
	});
	const _rows = await lock.list();
	// With stale_after_hours: 0, anything older than now is stale; the init commit
	// is the only commit on this branch and it predates "now" by some ms.
	// Implementation uses git log --since="0 hours ago" which means commits in the
	// last 0 hours. The init commit IS in that window (just-now), so it's NOT stale.
	// Use a future-tolerant stale window instead — shift by a year.
	rmSync(dir, { recursive: true, force: true });

	// Re-test on a branch whose only commit is a month old (set both author and
	// committer date so git log --since filters it out).
	const dir2 = makeRepo();
	execSync("git checkout -q -b feature/e-07", { cwd: dir2 });
	const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	execSync(`git commit -q --allow-empty --date="${oldDate}" -m "old"`, {
		cwd: dir2,
		env: { ...process.env, GIT_COMMITTER_DATE: oldDate },
	});
	const lock2 = await LockService.create({
		projectRoot: dir2,
		lockConfig: { kind: "markdown", config: { stale_after_hours: 1 } },
	});
	await lock2.claim({
		branch: "feature/e-07",
		epic: "E-07",
		stage: "build",
		tier: "full",
	});
	const rows2 = await lock2.list();
	assert.equal(rows2[0].stale, true);
	rmSync(dir2, { recursive: true, force: true });
});
