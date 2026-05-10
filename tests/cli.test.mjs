// End-to-end CLI tests. Drives the actual `shipwright` bin against a tmp
// project shaped like a real consumer repo. Catches regressions that only
// manifest at the executable boundary (template paths, Windows path
// normalization, exit codes).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(here, "..");
const BIN = join(PLUGIN_ROOT, "bin", "shipwright.mjs");

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

test("init scaffolds a fresh project in non-interactive mode", () => {
  const dir = makeMonorepo();
  const r = sw(["init", "--non-interactive"], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Shipwright installed/);
  // Spot check the resulting tree
  assert.equal(existsSync(join(dir, ".shipwright.yml")), true);
  assert.equal(existsSync(join(dir, ".github/workflows/auto-merge-low-tier.yml")), true);
  assert.equal(existsSync(join(dir, "scripts/shipwright/integrate-scratch.mjs")), true);
  assert.equal(existsSync(join(dir, "docs/process/in-flight.md")), true);
  // Single git commit was made
  const log = execSync('git log --oneline', { cwd: dir, encoding: "utf8" });
  assert.match(log, /chore: install @shipwrights\/core/);
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

test("init refuses to re-run when .shipwright.yml exists", () => {
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
  assert.equal(existsSync(join(dir, ".shipwright.yml")), false);
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
  assert.ok(pkg.devDependencies?.minimatch, "minimatch should be in devDependencies");
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
