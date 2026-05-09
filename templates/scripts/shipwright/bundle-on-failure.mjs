#!/usr/bin/env node
// Save a git bundle of a scratch branch's state when integration fails, so
// the work isn't lost and forensics is possible later.
//
//   node scripts/shipwright/bundle-on-failure.mjs <branch> <output-path>

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , branch, output] = process.argv;
if (!branch || !output) {
  console.error("usage: bundle-on-failure.mjs <branch> <output-path>");
  process.exit(2);
}

mkdirSync(dirname(output), { recursive: true });
execSync(`git bundle create "${output}" ${branch}`, { stdio: "inherit" });
console.log(`bundled ${branch} -> ${output}`);
console.log(`restore later with: git fetch ${output} ${branch}:${branch}`);
