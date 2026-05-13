import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	extractCitations,
	readManifest,
	validateCitations,
	writeManifest,
} from "../lib/spec/manifest.mjs";

function tmp() {
	return mkdtempSync(join(tmpdir(), "shipwrights-spec-"));
}

test("writeManifest + readManifest round-trip", () => {
	const dir = tmp();
	writeManifest(dir, "S-2026-05-12-abc1", {
		task_input: "add a forgot-password flow",
		files: [
			{ path: "apps/api/src/auth/login.ts", ranges: ["1-184"] },
			{ path: "apps/web/src/app/login/page.tsx", ranges: ["1-220"] },
		],
		observations: ["error envelope at apps/api/src/lib/errors.ts:12"],
	});
	const m = readManifest(dir, "S-2026-05-12-abc1");
	assert.equal(m.spec_id, "S-2026-05-12-abc1");
	assert.equal(m.files.length, 2);
	assert.match(m.observations[0], /error envelope/);
	rmSync(dir, { recursive: true, force: true });
});

test("readManifest returns null when missing", () => {
	const dir = tmp();
	assert.equal(readManifest(dir, "S-nonexistent"), null);
	rmSync(dir, { recursive: true, force: true });
});

test("extractCitations finds path:line patterns inside enforced sections", () => {
	const markdown = `
## Task
A prose sentence that may mention apps/api/src/foo.ts but it should be ignored here.

## Codebase analysis
- Read apps/api/src/auth/login.ts:1-184 for current auth logic.
- Convention at apps/api/src/lib/errors.ts:12.

## Architecture
### Decisions + reasoning
- Use signed JWT tokens (apps/api/src/auth/jwt.ts:18).
- New file at apps/api/src/auth/forgot-password.ts.

## User journey
1. User clicks /login. apps/web/src/app/login/page.tsx is not enforced here.
`;
	const cites = extractCitations(markdown);
	const paths = cites.map((c) => c.path);
	assert.ok(paths.includes("apps/api/src/auth/login.ts"));
	assert.ok(paths.includes("apps/api/src/lib/errors.ts"));
	assert.ok(paths.includes("apps/api/src/auth/jwt.ts"));
	assert.ok(paths.includes("apps/api/src/auth/forgot-password.ts"));
	// Citations from ## Task / ## User journey are NOT enforced and therefore NOT extracted
	assert.equal(paths.includes("apps/web/src/app/login/page.tsx"), false);
});

test("validateCitations: all cited paths present → ok", () => {
	const manifest = {
		files: [
			{ path: "apps/api/src/auth/login.ts" },
			{ path: "apps/api/src/lib/errors.ts" },
			{ path: "apps/api/src/auth/jwt.ts" },
			{ path: "apps/api/src/auth/forgot-password.ts" },
		],
	};
	const markdown = `
## Architecture
- Use apps/api/src/auth/jwt.ts:18 for pattern.
- New file: apps/api/src/auth/forgot-password.ts.
`;
	const r = validateCitations(markdown, manifest);
	assert.equal(r.ok, true);
	assert.equal(r.violations.length, 0);
});

test("validateCitations: cited but not in manifest → violation", () => {
	const manifest = {
		files: [{ path: "apps/api/src/auth/login.ts" }],
	};
	const markdown = `
## Architecture
- Use apps/api/src/auth/login.ts:1-184 — that's in manifest, fine.
- Also use apps/api/src/services/email.ts — NOT in manifest.
`;
	const r = validateCitations(markdown, manifest);
	assert.equal(r.ok, false);
	assert.equal(r.violations.length, 1);
	assert.equal(r.violations[0].path, "apps/api/src/services/email.ts");
});

test("validateCitations: empty markdown → ok (nothing to validate)", () => {
	const r = validateCitations("", { files: [] });
	assert.equal(r.ok, true);
	assert.equal(r.citations.length, 0);
});
