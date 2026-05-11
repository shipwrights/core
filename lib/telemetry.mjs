// Cost + duration telemetry. Logs one JSON line per stage transition to a
// configurable JSONL file. Per-epic budget can be enforced via the engine
// when budget_per_epic_tokens is set.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";

const DEFAULT_LOG_PATH = ".shipwrights/telemetry.jsonl";

export class Telemetry {
  constructor({ projectRoot, config = {} } = {}) {
    this.projectRoot = projectRoot;
    this.enabled = config.enabled !== false;
    this.logPath = config.log_path ?? DEFAULT_LOG_PATH;
    this.budget = config.budget_per_epic_tokens ?? null;
    this.onBudgetExceeded = config.on_budget_exceeded ?? "warn";
    this.epicTotals = new Map();
  }

  #path() {
    return isAbsolute(this.logPath) ? this.logPath : join(this.projectRoot, this.logPath);
  }

  log(event) {
    if (!this.enabled) return;
    const path = this.#path();
    mkdirSync(dirname(path), { recursive: true });
    const enriched = { ts: new Date().toISOString(), ...event };
    appendFileSync(path, `${JSON.stringify(enriched)}\n`, "utf8");
  }

  recordStage({ epicId, stage, tier, role, durationMs, tokensIn = 0, tokensOut = 0, status = "ok" }) {
    this.log({
      kind: "stage",
      epicId,
      stage,
      tier,
      role,
      durationMs,
      tokensIn,
      tokensOut,
      tokensTotal: tokensIn + tokensOut,
      status,
    });

    if (this.budget !== null) {
      const total = (this.epicTotals.get(epicId) ?? 0) + tokensIn + tokensOut;
      this.epicTotals.set(epicId, total);
      if (total > this.budget) {
        return this.#onBudget(epicId, total);
      }
    }
    return { withinBudget: true };
  }

  #onBudget(epicId, total) {
    const pct = ((total / this.budget) * 100).toFixed(0);
    const msg = `Epic ${epicId} token budget exceeded: ${total}/${this.budget} (${pct}%)`;
    this.log({ kind: "budget", epicId, total, budget: this.budget, action: this.onBudgetExceeded });
    if (this.onBudgetExceeded === "warn") {
      console.warn(`[shipwright] ${msg}`);
      return { withinBudget: false, action: "warn", message: msg };
    }
    if (this.onBudgetExceeded === "escalate") {
      return { withinBudget: false, action: "escalate", message: msg };
    }
    if (this.onBudgetExceeded === "abort") {
      throw new Error(msg);
    }
    return { withinBudget: false, action: this.onBudgetExceeded, message: msg };
  }

  totalForEpic(epicId) {
    return this.epicTotals.get(epicId) ?? 0;
  }

  reset(epicId) {
    this.epicTotals.delete(epicId);
  }
}
