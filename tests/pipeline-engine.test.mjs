import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { PipelineEngine } from "../lib/pipeline-engine.mjs";
import { LockService } from "../lib/lock-service.mjs";
import { Telemetry } from "../lib/telemetry.mjs";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "shipwright-eng-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.name t", { cwd: dir });
  execSync("git config user.email t@t.com", { cwd: dir });
  writeFileSync(join(dir, "seed"), "");
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

const baseConfig = () => ({
  version: 1,
  branches: { integration: "dev", release: "main", patterns: { feature: "f", fix: "x", chore: "c", scratch: "s" } },
  roles: [
    { name: "po", agent: "bundled", capabilities: { can_write: false } },
    { name: "backend", agent: "bundled", capabilities: { can_write: true, scope: ["**"] } },
  ],
  pipeline: [
    { stage: "refine", owner: ["po"], optional_when: "tier == 'minimal'" },
    { stage: "build", owner: ["backend"] },
    { stage: "ship", owner: ["orchestrator"] },
  ],
  tier_routing: [
    { if: "epic.size == 'small'", tier: "minimal" },
    { default: "full" },
  ],
  tiers: {
    minimal: { skip_stages: ["refine"], auto_merge: true },
    full: { skip_stages: [], auto_merge: false },
  },
  backlog: { source: { kind: "files" } },
  verify: {},
  guards: [],
  merge: { strategy: "rebase" },
});

function mockHost(calls) {
  return {
    runOrchestratorStep: async ({ stage }) => {
      calls.push({ stage: stage.stage, role: "orchestrator" });
      return { ok: true, role: "orchestrator" };
    },
    dispatchAgent: async ({ role, stage }) => {
      calls.push({ stage: stage.stage, role: role.name });
      return { ok: true, tokensIn: 100, tokensOut: 200 };
    },
  };
}

test("resolveTier picks first matching rule", () => {
  const dir = makeRepo();
  const engine = new PipelineEngine({
    config: baseConfig(),
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock: null,
    projectRoot: dir,
    host: mockHost([]),
  });
  assert.equal(engine.resolveTier({ size: "small" }), "minimal");
  assert.equal(engine.resolveTier({ size: "large" }), "full");
  rmSync(dir, { recursive: true, force: true });
});

test("shouldSkipStage skips per tier.skip_stages", () => {
  const dir = makeRepo();
  const engine = new PipelineEngine({
    config: baseConfig(),
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock: null,
    projectRoot: dir,
    host: mockHost([]),
  });
  const stage = { stage: "refine", owner: ["po"], optional_when: "tier == 'minimal'" };
  assert.equal(engine.shouldSkipStage(stage, { tier: "minimal", epic: { size: "small" } }), true);
  assert.equal(engine.shouldSkipStage(stage, { tier: "full", epic: { size: "large" } }), false);
  rmSync(dir, { recursive: true, force: true });
});

test("runEpic walks pipeline and dispatches in order", async () => {
  const dir = makeRepo();
  const calls = [];
  const lock = await LockService.create({ projectRoot: dir, lockConfig: { kind: "markdown" } });
  const engine = new PipelineEngine({
    config: baseConfig(),
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock,
    projectRoot: dir,
    host: mockHost(calls),
  });
  const r = await engine.runEpic({ epic: { id: "E-01", size: "large" }, integrationBranch: "dev" });
  assert.equal(r.ok, true);
  // size: large → full tier (skip_stages: []), so all 3 stages run
  assert.deepEqual(calls.map((c) => c.stage), ["refine", "build", "ship"]);
  rmSync(dir, { recursive: true, force: true });
});

test("runEpic skips refine on minimal tier", async () => {
  const dir = makeRepo();
  const calls = [];
  const lock = await LockService.create({ projectRoot: dir, lockConfig: { kind: "markdown" } });
  const engine = new PipelineEngine({
    config: baseConfig(),
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock,
    projectRoot: dir,
    host: mockHost(calls),
  });
  const r = await engine.runEpic({ epic: { id: "E-02", size: "small" }, integrationBranch: "dev" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((c) => c.stage), ["build", "ship"]);
  rmSync(dir, { recursive: true, force: true });
});

test("runEpic refuses to claim if epic already in flight", async () => {
  const dir = makeRepo();
  const lock = await LockService.create({ projectRoot: dir, lockConfig: { kind: "markdown" } });
  await lock.claim({ branch: "feature/e-99", epic: "E-99", stage: "build", tier: "full" });
  const engine = new PipelineEngine({
    config: baseConfig(),
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock,
    projectRoot: dir,
    host: mockHost([]),
  });
  const r = await engine.runEpic({ epic: { id: "E-99", size: "large" }, integrationBranch: "dev" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "lock");
  rmSync(dir, { recursive: true, force: true });
});

test("parallelism: full dispatches owners simultaneously", async () => {
  const dir = makeRepo();
  const calls = [];
  const config = baseConfig();
  config.roles.push({ name: "frontend", agent: "bundled", capabilities: { can_write: true, scope: ["**"] } });
  config.pipeline = [
    {
      stage: "build",
      owner: ["backend", "frontend"],
      parallelism: "full",
    },
  ];
  const lock = await LockService.create({ projectRoot: dir, lockConfig: { kind: "markdown" } });
  const engine = new PipelineEngine({
    config,
    telemetry: new Telemetry({ projectRoot: dir, config: { enabled: false } }),
    lock,
    projectRoot: dir,
    host: mockHost(calls),
  });
  const r = await engine.runEpic({ epic: { id: "E-03", size: "large" }, integrationBranch: "dev" });
  assert.equal(r.ok, true);
  // Both owners called
  const buildCalls = calls.filter((c) => c.stage === "build").map((c) => c.role).sort();
  assert.deepEqual(buildCalls, ["backend", "frontend"]);
  rmSync(dir, { recursive: true, force: true });
});
