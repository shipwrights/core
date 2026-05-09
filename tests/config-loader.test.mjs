import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../lib/config-loader.mjs";

const MINIMAL_VALID = {
  version: 1,
  branches: {
    integration: "dev",
    release: "main",
    patterns: {
      feature: "feature/<id>-<slug>",
      fix: "fix/<id>-<slug>",
      chore: "chore/ops-<slug>",
      scratch: "<feature-branch>--<role>",
    },
  },
  roles: [
    { name: "po", agent: "bundled", capabilities: { can_write: false }, invoke_at: ["refine"] },
  ],
  pipeline: [{ stage: "refine", owner: ["po"] }],
  backlog: { source: { kind: "files" } },
  verify: {},
  merge: { strategy: "rebase" },
};

test("validates a minimal config", () => {
  const r = validateConfig(MINIMAL_VALID);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("rejects missing required field", () => {
  const broken = JSON.parse(JSON.stringify(MINIMAL_VALID));
  delete broken.merge;
  const r = validateConfig(broken);
  assert.equal(r.ok, false);
});

test("rejects invalid stage owner shape", () => {
  const broken = JSON.parse(JSON.stringify(MINIMAL_VALID));
  broken.pipeline[0].owner = "po";
  const r = validateConfig(broken);
  assert.equal(r.ok, false);
});

test("loads from disk and applies extends", () => {
  const dir = mkdtempSync(join(tmpdir(), "shipwright-cfg-"));
  const baseYaml = `version: 1
branches:
  integration: dev
  release: main
  patterns:
    feature: "feature/<id>-<slug>"
    fix: "fix/<id>-<slug>"
    chore: "chore/ops-<slug>"
    scratch: "<feature-branch>--<role>"
roles:
  - name: po
    agent: bundled
    capabilities: { can_write: false }
    invoke_at: [refine]
pipeline:
  - stage: refine
    owner: [po]
backlog:
  source: { kind: files }
verify: {}
merge:
  strategy: rebase
`;
  writeFileSync(join(dir, "base.yml"), baseYaml);
  writeFileSync(
    join(dir, ".shipwright.yml"),
    `extends: ./base.yml\nbranches:\n  integration: develop\n`,
  );
  const cfg = loadConfig(dir);
  assert.equal(cfg.branches.integration, "develop");
  assert.equal(cfg.branches.release, "main");
  rmSync(dir, { recursive: true, force: true });
});
