// `shipwrights spec-cancel <id>` — tombstone a drafted (or pre-shipped)
// spec.
//
// Sets status: cancelled. Doesn't delete the file — it stays as an audit
// trail. The orchestrator will refuse to pick up cancelled specs.

import { execSync, spawnSync } from "node:child_process";
import { loadConfig } from "../config-loader.mjs";
import { readPlan, setStatus } from "../spec/plan-document.mjs";
import { canCancel } from "../spec/state-machine.mjs";

function isClean(projectRoot) {
  try {
    return execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim() === "";
  } catch {
    return false;
  }
}

export async function runSpecCancel({ projectRoot, args }) {
  const id = args[0];
  if (!id) {
    console.error("usage: shipwrights spec-cancel <S-id>");
    process.exit(2);
  }

  const config = loadConfig(projectRoot);
  const outputDir = config.spec?.output_dir ?? "docs/backlog/specs";

  const plan = readPlan({ projectRoot, outputDir, id });
  if (!plan) {
    console.error(`No spec with id ${id} under ${outputDir}/.`);
    process.exit(2);
  }
  const status = plan.frontmatter.status;
  if (!canCancel(status)) {
    console.error(`Cannot cancel: spec is at "${status}" (terminal or already cancelled).`);
    process.exit(2);
  }
  if (!isClean(projectRoot)) {
    console.error("Working tree is dirty. Commit or stash before cancelling.");
    process.exit(2);
  }

  setStatus({ projectRoot, outputDir, id, status: "cancelled" });

  spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
  spawnSync(
    "git",
    [
      "-c", "user.name=Shipwrights Cancel",
      "-c", "user.email=shipwrights@noreply.local",
      "commit", "-m",
      `chore(spec): cancel ${id}`,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  console.log(`\n✓ Spec ${id} cancelled.`);
  console.log(`The file stays in place as an audit trail.`);
  if (status !== "drafted" && status !== "approved") {
    console.log(`\nNote: status was "${status}" — scratch branches may still exist.`);
    console.log(`Clean them up manually with: git branch | grep -- '--' | xargs git branch -D`);
  }
}
