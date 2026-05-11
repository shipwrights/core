#!/usr/bin/env node
// Create a per-role scratch branch off the current feature branch.
//
//   node scripts/shipwrights/create-scratch.mjs <role>
//
// Reads .shipwrights.yml for branch patterns. Stays local-only unless
// scratch.push_to_remote is true.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const role = process.argv[2];
if (!role) {
  console.error("usage: create-scratch.mjs <role>");
  process.exit(2);
}

const config = parseYaml(readFileSync(".shipwrights.yml", "utf8"));
const featureBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
if (config.branches.integration === featureBranch) {
  console.error("create-scratch must be run from a feature branch, not the integration branch");
  process.exit(2);
}

const pattern = config.branches.patterns.scratch ?? "<feature-branch>--<role>";
const scratchBranch = pattern.replace("<feature-branch>", featureBranch).replace("<role>", role);

execSync(`git checkout -b ${scratchBranch}`, { stdio: "inherit" });

if (config.scratch?.push_to_remote) {
  execSync(`git push -u origin ${scratchBranch}`, { stdio: "inherit" });
}

console.log(`created scratch branch: ${scratchBranch}`);
console.log(`(local-only: ${!config.scratch?.push_to_remote})`);
