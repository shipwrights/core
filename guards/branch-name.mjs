// Built-in guard: branch name matches the configured patterns.
//
// Config:
//   - name: branch-name
//     pattern: "^(feature|fix|chore)/.*$"   # default
//     allowed_long_lived: [dev, develop, main, master]

import { execSync } from "node:child_process";

const DEFAULT_PATTERN =
  /^(?:feature|fix|chore|docs|refactor|test|perf|build|ci|style|revert)\/[a-z0-9][\w/-]*$/;
const DEFAULT_LONG_LIVED = ["dev", "develop", "main", "master"];

export async function run({ projectRoot, config }) {
  let branch;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    return { status: "block", violations: [{ message: `git failed: ${err.message}` }] };
  }

  const longLived = config.allowed_long_lived ?? DEFAULT_LONG_LIVED;
  if (longLived.includes(branch)) return { status: "pass", violations: [] };

  const pattern = config.pattern ? new RegExp(config.pattern) : DEFAULT_PATTERN;
  if (!pattern.test(branch)) {
    return {
      status: "block",
      violations: [
        {
          message: `branch "${branch}" does not match required pattern ${pattern}`,
        },
      ],
    };
  }
  return { status: "pass", violations: [] };
}

export default run;
