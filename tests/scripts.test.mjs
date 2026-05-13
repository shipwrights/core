// Integration tests for the scratch-branch lifecycle scripts that ship as
// templates. Each test sets up a real git repo, runs the script, and asserts
// the side effects.

import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(here, "..");
const SCRIPTS = join(PLUGIN_ROOT, "templates", "scripts", "shipwrights");

const MIN_CONFIG = `version: 1
branches:
  integration: dev
  release: main
  patterns:
    feature: "feature/<id>-<slug>"
    fix: "fix/<id>-<slug>"
    chore: "chore/ops-<slug>"
    scratch: "<feature-branch>--<role>"
scratch:
  push_to_remote: false
  bundle_on_failure: true
  cleanup_on_integrate: true
roles:
  - name: backend
    agent: bundled
    capabilities:
      can_write: true
      scope: ["apps/api/**", "packages/contracts/**"]
    invoke_at: [design-and-build]
  - name: frontend
    agent: bundled
    capabilities:
      can_write: true
      scope: ["apps/web/**"]
    invoke_at: [design-and-build]
pipeline:
  - stage: slice
    owner: [orchestrator]
    freeze_paths: ["packages/contracts/**"]
  - stage: build
    owner: [backend, frontend]
    parallelism: full
backlog:
  source: { kind: files }
  state_dir: docs/backlog/epics
verify: {}
merge:
  strategy: rebase
`;

function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-scripts-"));
	execSync("git init -q -b dev", { cwd: dir });
	execSync("git config user.name t", { cwd: dir });
	execSync("git config user.email t@t.com", { cwd: dir });
	writeFileSync(join(dir, ".shipwrights.yml"), MIN_CONFIG);
	mkdirSync(join(dir, "apps/api/src"), { recursive: true });
	mkdirSync(join(dir, "apps/web/src"), { recursive: true });
	mkdirSync(join(dir, "packages/contracts/src"), { recursive: true });
	writeFileSync(join(dir, "apps/api/src/server.ts"), "export const x = 1;\n");
	writeFileSync(join(dir, "apps/web/src/page.tsx"), "export const y = 2;\n");
	writeFileSync(
		join(dir, "packages/contracts/src/index.ts"),
		"export type Z = string;\n",
	);
	execSync('git add -A && git commit -q -m "chore: init"', { cwd: dir });
	// Install yaml + minimatch into the repo so the scripts can import them
	// — in a real consumer install they get these via the consumer's own deps,
	// here we link from the plugin's own node_modules.
	mkdirSync(join(dir, "node_modules"), { recursive: true });
	// Best-effort symlink; if it fails (Windows), skip — most scripts work
	// without these because we'll spawn node from this dir but with NODE_PATH
	// pointing back to the plugin's modules.
	return dir;
}

function runScript(scriptName, args, cwd) {
	return spawnSync("node", [join(SCRIPTS, scriptName), ...args], {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			NODE_PATH: join(PLUGIN_ROOT, "node_modules"),
		},
	});
}

// ---------- create-scratch ----------

test("create-scratch branches off the feature branch", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-01", { cwd: dir });
	const r = runScript("create-scratch.mjs", ["backend"], dir);
	assert.equal(r.status, 0, r.stderr);
	const branches = execSync("git branch", { cwd: dir, encoding: "utf8" });
	assert.match(branches, /feature\/e-01--backend/);
	rmSync(dir, { recursive: true, force: true });
});

test("create-scratch refuses on integration branch", () => {
	const dir = makeRepo();
	// already on dev
	const r = runScript("create-scratch.mjs", ["backend"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /must be run from a feature branch/);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- verify-specialist-scope ----------

test("verify-specialist-scope passes on in-scope writes", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-01", { cwd: dir });
	execSync("git checkout -q -b feature/e-01--backend", { cwd: dir });
	writeFileSync(join(dir, "apps/api/src/server.ts"), "export const x = 2;\n");
	execSync('git add -A && git commit -q -m "feat(backend): tweak"', {
		cwd: dir,
	});
	const r = runScript("verify-specialist-scope.mjs", ["backend"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /scope verified/);
	rmSync(dir, { recursive: true, force: true });
});

test("verify-specialist-scope blocks on out-of-scope writes", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-01", { cwd: dir });
	execSync("git checkout -q -b feature/e-01--backend", { cwd: dir });
	writeFileSync(join(dir, "apps/web/src/page.tsx"), "export const y = 3;\n");
	execSync('git add -A && git commit -q -m "feat(backend): wrong scope"', {
		cwd: dir,
	});
	const r = runScript("verify-specialist-scope.mjs", ["backend"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /out-of-scope/);
	rmSync(dir, { recursive: true, force: true });
});

test("verify-specialist-scope blocks on frozen-path writes", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-01", { cwd: dir });
	execSync("git checkout -q -b feature/e-01--backend", { cwd: dir });
	writeFileSync(
		join(dir, "packages/contracts/src/index.ts"),
		"export type Z = number;\n",
	);
	execSync(
		'git add -A && git commit -q -m "feat(backend): forbidden contract change"',
		{ cwd: dir },
	);
	const r = runScript("verify-specialist-scope.mjs", ["backend"], dir);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /frozen-path writes/);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- update-epic-after-merge ----------

test("update-epic-after-merge appends PR link to matching epic", () => {
	const dir = makeRepo();
	mkdirSync(join(dir, "docs/backlog/epics"), { recursive: true });
	writeFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"---\nid: E-01\ntitle: Foo\nstatus: refined\n---\n\n## Why\n\nx\n",
	);
	const r = spawnSync("node", [join(SCRIPTS, "update-epic-after-merge.mjs")], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			PR_NUMBER: "42",
			PR_TITLE: "feat(e-01): something",
			PR_URL: "https://example.com/pr/42",
		},
	});
	assert.equal(r.status, 0, r.stderr);
	const after = readFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"utf8",
	);
	assert.match(after, /^status: shipped/m);
	assert.match(after, /## Related PRs/);
	assert.match(after, /PR #42/);
	rmSync(dir, { recursive: true, force: true });
});

test("update-epic-after-merge releases the matching in-flight row", () => {
	const dir = makeRepo();
	mkdirSync(join(dir, "docs/backlog/epics"), { recursive: true });
	mkdirSync(join(dir, "docs/process"), { recursive: true });
	writeFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"---\nid: E-01\ntitle: Foo\nstatus: ready-for-human-review\n---\n",
	);
	writeFileSync(
		join(dir, "docs/process/in-flight.md"),
		"# In-flight branches\n\n| Branch | Epic | Stage | Tier | Active specialists | Updated |\n|---|---|---|---|---|---|\n| feature/e-01 | E-01 | awaiting merge | minimal | - | 2026-05-13 |\n| feature/e-02 | E-02 | build | full | backend | 2026-05-13 |\n",
	);
	const outputPath = join(dir, "github-output.txt");
	const r = spawnSync("node", [join(SCRIPTS, "update-epic-after-merge.mjs")], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			PR_NUMBER: "42",
			PR_TITLE: "feat(e-01): something",
			PR_URL: "https://example.com/pr/42",
			PR_HEAD_REF: "feature/e-01",
			GITHUB_OUTPUT: outputPath,
		},
	});
	assert.equal(r.status, 0, r.stderr);
	const register = readFileSync(join(dir, "docs/process/in-flight.md"), "utf8");
	assert.doesNotMatch(register, /feature\/e-01/);
	assert.match(register, /feature\/e-02/);
	const output = readFileSync(outputPath, "utf8");
	assert.match(
		output,
		/changed_files=.*docs\/backlog\/epics\/E-01-foo.md.*docs\/process\/in-flight.md/,
	);
	rmSync(dir, { recursive: true, force: true });
});

test("update-epic-after-merge no-ops on ops scope", () => {
	const dir = makeRepo();
	mkdirSync(join(dir, "docs/backlog/epics"), { recursive: true });
	writeFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"---\nid: E-01\ntitle: Foo\nstatus: refined\n---\n",
	);
	const r = spawnSync("node", [join(SCRIPTS, "update-epic-after-merge.mjs")], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			PR_NUMBER: "5",
			PR_TITLE: "chore(ops): bump deps",
			PR_URL: "https://example.com/pr/5",
		},
	});
	assert.equal(r.status, 0);
	const after = readFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"utf8",
	);
	assert.equal(after.includes("PR #5"), false);
	rmSync(dir, { recursive: true, force: true });
});

test("update-epic-after-merge is idempotent", () => {
	const dir = makeRepo();
	mkdirSync(join(dir, "docs/backlog/epics"), { recursive: true });
	writeFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"---\nid: E-01\ntitle: Foo\nstatus: refined\n---\n",
	);
	const env = {
		...process.env,
		PR_NUMBER: "100",
		PR_TITLE: "feat(e-01): a thing",
		PR_URL: "https://example.com/pr/100",
	};
	spawnSync("node", [join(SCRIPTS, "update-epic-after-merge.mjs")], {
		cwd: dir,
		encoding: "utf8",
		env,
	});
	spawnSync("node", [join(SCRIPTS, "update-epic-after-merge.mjs")], {
		cwd: dir,
		encoding: "utf8",
		env,
	});
	const after = readFileSync(
		join(dir, "docs/backlog/epics/E-01-foo.md"),
		"utf8",
	);
	const matches = after.match(/PR #100/g) ?? [];
	assert.equal(matches.length, 1);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- bundle-on-failure ----------

test("bundle-on-failure produces a valid git bundle", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-bundle", { cwd: dir });
	writeFileSync(join(dir, "apps/api/src/extra.ts"), "export const z = 3;\n");
	execSync('git add -A && git commit -q -m "feat: add"', { cwd: dir });
	const bundlePath = join(dir, ".shipwrights/bundles/test.bundle");
	const r = spawnSync(
		"node",
		[join(SCRIPTS, "bundle-on-failure.mjs"), "feature/e-bundle", bundlePath],
		{ cwd: dir, encoding: "utf8" },
	);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(existsSync(bundlePath), true);
	// git bundle verify should pass
	const v = spawnSync("git", ["bundle", "verify", bundlePath], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.equal(v.status, 0, v.stderr);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- integrate-scratch (clean rebase) ----------

test("integrate-scratch rebases and fast-forwards on clean diff", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-int", { cwd: dir });
	// Create a backend scratch with a non-overlapping change.
	execSync("git checkout -q -b feature/e-int--backend", { cwd: dir });
	writeFileSync(join(dir, "apps/api/src/added.ts"), "export const a = 1;\n");
	execSync('git add -A && git commit -q -m "feat(backend): add"', { cwd: dir });
	execSync("git checkout -q feature/e-int", { cwd: dir });
	const r = runScript("integrate-scratch.mjs", ["backend"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(existsSync(join(dir, "apps/api/src/added.ts")), true);
	// Scratch should be cleaned up.
	const branches = execSync("git branch", { cwd: dir, encoding: "utf8" });
	assert.equal(branches.includes("feature/e-int--backend"), false);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- v0.1.3 regression — integrate-scratch run from scratch branch ----------

test("integrate-scratch works when run from the scratch branch (not just feature)", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-from-scratch", { cwd: dir });
	execSync("git checkout -q -b feature/e-from-scratch--backend", { cwd: dir });
	writeFileSync(join(dir, "apps/api/src/x.ts"), "export const a = 1;\n");
	execSync('git add -A && git commit -q -m "feat(backend): add"', { cwd: dir });
	// Stay on the scratch branch — earlier the script appended --backend
	// unconditionally producing feature/e-from-scratch--backend--backend.
	const r = runScript("integrate-scratch.mjs", ["backend"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(existsSync(join(dir, "apps/api/src/x.ts")), true);
	rmSync(dir, { recursive: true, force: true });
});

// ---------- v0.1.3 regression — verify-scope uses merge-base, not feature tip ----------

test("verify-specialist-scope ignores orchestrator commits on feature since branch", () => {
	const dir = makeRepo();
	execSync("git checkout -q -b feature/e-mb", { cwd: dir });
	// Cut scratch off feature.
	execSync("git checkout -q -b feature/e-mb--backend", { cwd: dir });
	writeFileSync(join(dir, "apps/api/src/in-scope.ts"), "export const a = 1;\n");
	execSync('git add -A && git commit -q -m "feat(backend): in-scope"', {
		cwd: dir,
	});
	// Now simulate orchestrator commits on the feature branch AFTER scratch
	// was cut. These changes touch out-of-scope paths from the backend's
	// perspective (UI), but they are NOT scratch-side changes.
	execSync("git checkout -q feature/e-mb", { cwd: dir });
	writeFileSync(join(dir, "apps/web/src/orch.tsx"), "export const o = 1;\n");
	execSync('git add -A && git commit -q -m "chore: orch tweak"', { cwd: dir });
	// Going back to scratch and running scope-check: pre-fix, this would flag
	// apps/web/src/orch.tsx as an out-of-scope write by backend. Post-fix,
	// merge-base isolates only what scratch wrote.
	execSync("git checkout -q feature/e-mb--backend", { cwd: dir });
	const r = runScript("verify-specialist-scope.mjs", ["backend"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /scope verified/);
	rmSync(dir, { recursive: true, force: true });
});
