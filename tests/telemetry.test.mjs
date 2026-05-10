import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry } from "../lib/telemetry.mjs";

function makeDir() {
  return mkdtempSync(join(tmpdir(), "shipwright-tlm-"));
}

test("disabled telemetry writes nothing", () => {
  const dir = makeDir();
  const t = new Telemetry({ projectRoot: dir, config: { enabled: false } });
  t.recordStage({
    epicId: "E-01",
    stage: "refine",
    tier: "full",
    role: "po",
    durationMs: 1234,
  });
  const path = join(dir, ".shipwright/telemetry.jsonl");
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true, force: true });
});

test("enabled telemetry appends one JSON line per recordStage call", () => {
  const dir = makeDir();
  const t = new Telemetry({ projectRoot: dir, config: { enabled: true, log_path: ".sw/log.jsonl" } });
  t.recordStage({ epicId: "E-01", stage: "refine", tier: "full", role: "po", durationMs: 100, tokensIn: 500, tokensOut: 1500 });
  t.recordStage({ epicId: "E-01", stage: "slice", tier: "full", role: "orchestrator", durationMs: 50 });
  const path = join(dir, ".sw/log.jsonl");
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.epicId, "E-01");
  assert.equal(first.tokensTotal, 2000);
  rmSync(dir, { recursive: true, force: true });
});

test("budget warn returns withinBudget false but doesn't throw", () => {
  const dir = makeDir();
  const t = new Telemetry({
    projectRoot: dir,
    config: {
      enabled: true,
      budget_per_epic_tokens: 1000,
      on_budget_exceeded: "warn",
    },
  });
  // Suppress the warn log
  const origWarn = console.warn;
  console.warn = () => {};
  const r1 = t.recordStage({ epicId: "E-01", stage: "x", tier: "full", role: "r", durationMs: 1, tokensIn: 600, tokensOut: 0 });
  const r2 = t.recordStage({ epicId: "E-01", stage: "y", tier: "full", role: "r", durationMs: 1, tokensIn: 600, tokensOut: 0 });
  console.warn = origWarn;
  assert.equal(r1.withinBudget, true);
  assert.equal(r2.withinBudget, false);
  assert.equal(r2.action, "warn");
  rmSync(dir, { recursive: true, force: true });
});

test("budget escalate returns withinBudget false with action: escalate", () => {
  const dir = makeDir();
  const t = new Telemetry({
    projectRoot: dir,
    config: {
      enabled: true,
      budget_per_epic_tokens: 100,
      on_budget_exceeded: "escalate",
    },
  });
  const r = t.recordStage({ epicId: "E-01", stage: "x", tier: "full", role: "r", durationMs: 1, tokensIn: 200, tokensOut: 0 });
  assert.equal(r.withinBudget, false);
  assert.equal(r.action, "escalate");
  rmSync(dir, { recursive: true, force: true });
});

test("budget abort throws", () => {
  const dir = makeDir();
  const t = new Telemetry({
    projectRoot: dir,
    config: {
      enabled: true,
      budget_per_epic_tokens: 100,
      on_budget_exceeded: "abort",
    },
  });
  assert.throws(() =>
    t.recordStage({ epicId: "E-01", stage: "x", tier: "full", role: "r", durationMs: 1, tokensIn: 200, tokensOut: 0 }),
  );
  rmSync(dir, { recursive: true, force: true });
});

test("totalForEpic / reset work", () => {
  const dir = makeDir();
  const t = new Telemetry({
    projectRoot: dir,
    config: { enabled: true, budget_per_epic_tokens: 10000, on_budget_exceeded: "warn" },
  });
  t.recordStage({ epicId: "E-01", stage: "x", tier: "full", role: "r", durationMs: 1, tokensIn: 100, tokensOut: 200 });
  t.recordStage({ epicId: "E-01", stage: "y", tier: "full", role: "r", durationMs: 1, tokensIn: 50, tokensOut: 50 });
  assert.equal(t.totalForEpic("E-01"), 400);
  t.reset("E-01");
  assert.equal(t.totalForEpic("E-01"), 0);
  rmSync(dir, { recursive: true, force: true });
});
