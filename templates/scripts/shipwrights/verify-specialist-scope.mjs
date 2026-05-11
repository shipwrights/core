#!/usr/bin/env node
// Verify that a specialist's commits on their scratch branch only touched
// paths within their declared scope and did not touch any frozen path.
//
//   node scripts/shipwrights/verify-specialist-scope.mjs <role>
//
// Exits 0 if clean, 1 if violations. Designed to be run by integrate-scratch
// before the rebase is allowed.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { minimatch } from "minimatch";

const role = process.argv[2];
if (!role) {
  console.error("usage: verify-specialist-scope.mjs <role>");
  process.exit(2);
}

const config = parseYaml(readFileSync(".shipwrights.yml", "utf8"));
const featureBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const pattern = config.branches.patterns.scratch ?? "<feature-branch>--<role>";

function inferFeatureFromScratch(branch) {
  return branch.replace(`--${role}`, "");
}

let scratchBranch;
let baseFeature;
if (featureBranch.endsWith(`--${role}`)) {
  scratchBranch = featureBranch;
  baseFeature = inferFeatureFromScratch(scratchBranch);
} else {
  scratchBranch = pattern.replace("<feature-branch>", featureBranch).replace("<role>", role);
  baseFeature = featureBranch;
}

const roleConfig = config.roles.find((r) => r.name === role);
if (!roleConfig) {
  console.error(`role "${role}" not found in .shipwrights.yml`);
  process.exit(2);
}
const scope = roleConfig.capabilities?.scope ?? [];
if (scope.length === 0) {
  console.log(`role "${role}" has no declared scope; skipping enforcement`);
  process.exit(0);
}

const sliceStage = config.pipeline.find((s) => s.stage === "slice");
const freezePaths = sliceStage?.freeze_paths ?? [];

// Use merge-base so we only see paths the SCRATCH branch changed, not paths
// the feature branch advanced on after the scratch was cut. Without this,
// orchestrator commits on the feature branch (e.g. config tweaks) get
// flagged as out-of-scope writes by the specialist.
const mergeBase = execSync(`git merge-base ${baseFeature} ${scratchBranch}`, {
  encoding: "utf8",
}).trim();
const diff = execSync(`git diff --name-only ${mergeBase}..${scratchBranch}`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const violations = [];
const frozen = [];
for (const path of diff) {
  const inScope = scope.some((p) => minimatch(path, p, { dot: true }));
  if (!inScope) {
    violations.push(path);
    continue;
  }
  if (freezePaths.some((p) => minimatch(path, p, { dot: true }))) {
    frozen.push(path);
  }
}

if (violations.length === 0 && frozen.length === 0) {
  console.log(`scope verified: ${diff.length} files, all in scope, no frozen paths`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`out-of-scope writes by role "${role}":`);
  for (const v of violations) console.error(`  - ${v}`);
}
if (frozen.length > 0) {
  console.error(`frozen-path writes after slice (re-slice required):`);
  for (const f of frozen) console.error(`  - ${f}`);
}
process.exit(1);
