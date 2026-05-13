import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	generateSpecId,
	parsePlan,
	readPlan,
	setStatus,
	slugifyTitle,
	snapshotForRevision,
	writePlan,
} from "../lib/spec/plan-document.mjs";

function tmp() {
	return mkdtempSync(join(tmpdir(), "shipwrights-plan-"));
}

test("generateSpecId follows S-yyyy-mm-dd-<hash> shape", () => {
	const id = generateSpecId(new Date("2026-05-12T12:00:00Z"));
	assert.match(id, /^S-2026-05-12-[a-z0-9]{4}$/);
});

test("slugifyTitle: lowercase + hyphenate + truncate", () => {
	assert.equal(
		slugifyTitle("Add Forgot-Password Flow!"),
		"add-forgot-password-flow",
	);
	assert.equal(slugifyTitle(""), "untitled");
	const long = "A".repeat(200);
	assert.ok(slugifyTitle(long).length <= 60);
});

test("writePlan + readPlan round-trip", () => {
	const dir = tmp();
	const content = `---
id: S-2026-05-12-test
title: Test spec
status: drafted
kind: spec
revisions: 0
---

## Task
Sample body.
`;
	const path = writePlan({
		projectRoot: dir,
		outputDir: "docs/backlog/specs",
		id: "S-2026-05-12-test",
		slug: "test-spec",
		content,
	});
	assert.ok(existsSync(path));
	const plan = readPlan({
		projectRoot: dir,
		outputDir: "docs/backlog/specs",
		id: "S-2026-05-12-test",
	});
	assert.equal(plan.frontmatter.id, "S-2026-05-12-test");
	assert.equal(plan.frontmatter.status, "drafted");
	assert.equal(plan.frontmatter.revisions, 0);
	assert.match(plan.body, /^## Task/m);
	rmSync(dir, { recursive: true, force: true });
});

test("parsePlan handles missing frontmatter", () => {
	const r = parsePlan("Just a body without frontmatter.");
	assert.deepEqual(r.frontmatter, {});
	assert.match(r.body, /Just a body/);
});

test("setStatus updates only the status line", () => {
	const dir = tmp();
	const content = `---
id: S-x
title: x
status: drafted
revisions: 0
---

## Task
x
`;
	writePlan({
		projectRoot: dir,
		outputDir: "specs",
		id: "S-x",
		slug: "x",
		content,
	});
	setStatus({
		projectRoot: dir,
		outputDir: "specs",
		id: "S-x",
		status: "approved",
	});
	const updated = readPlan({ projectRoot: dir, outputDir: "specs", id: "S-x" });
	assert.equal(updated.frontmatter.status, "approved");
	assert.equal(updated.frontmatter.revisions, 0);
	rmSync(dir, { recursive: true, force: true });
});

test("snapshotForRevision writes to .shipwrights/specs/<id>.r<N>.md", () => {
	const dir = tmp();
	const path = snapshotForRevision({
		projectRoot: dir,
		id: "S-r-test",
		revisionNumber: 1,
		content: "snapshot body",
	});
	assert.ok(existsSync(path));
	assert.match(path, /\.shipwrights[/\\]specs[/\\]S-r-test\.r1\.md$/);
	assert.equal(readFileSync(path, "utf8"), "snapshot body");
	rmSync(dir, { recursive: true, force: true });
});
