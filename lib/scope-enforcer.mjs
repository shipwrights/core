import { execSync } from "node:child_process";
import { minimatch } from "minimatch";

export function enforceScope({ projectRoot, role, baseRef, freezePaths = [] }) {
  const scope = role.capabilities?.scope ?? [];
  if (scope.length === 0) {
    return { ok: true, violations: [], frozen: [] };
  }

  let diff;
  try {
    diff = execSync(`git diff --name-only ${baseRef}`, {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    return {
      ok: false,
      violations: [{ message: `git diff failed: ${err.message}` }],
      frozen: [],
    };
  }

  const violations = [];
  const frozen = [];

  for (const path of diff) {
    const inScope = scope.some((pattern) => minimatch(path, pattern, { dot: true }));
    if (!inScope) {
      violations.push({ path, reason: "out of scope" });
      continue;
    }
    const isFrozen = freezePaths.some((pattern) => minimatch(path, pattern, { dot: true }));
    if (isFrozen) {
      frozen.push({ path, reason: "frozen path edited after slice" });
    }
  }

  return {
    ok: violations.length === 0 && frozen.length === 0,
    violations,
    frozen,
  };
}
