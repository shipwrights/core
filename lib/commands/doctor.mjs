import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig } from "../config-loader.mjs";
import { resolveRole } from "../role-resolver.mjs";
import { loadSource } from "../source-loader.mjs";

const checks = [];

function ok(label) { checks.push({ status: "pass", label }); }
function warn(label, reason) { checks.push({ status: "warn", label, reason }); }
function fail(label, reason) { checks.push({ status: "fail", label, reason }); }

export async function runDoctor({ projectRoot, pluginRoot }) {
  let config;
  try {
    config = loadConfig(projectRoot);
    ok(`Config: valid (version ${config.version})`);
  } catch (err) {
    fail("Config", err.message);
    return printAndExit();
  }

  for (const role of config.roles) {
    try {
      const resolved = resolveRole(role, { projectRoot });
      const writeRequested = role.capabilities?.can_write === true;
      if (resolved.kind !== "npm" && resolved.content) {
        const tools = (resolved.content.match(/^tools:\s*\[([^\]]+)\]/m) ?? [])[1] ?? "";
        const hasWrite = /\bWrite\b|\bEdit\b/.test(tools);
        if (writeRequested && !hasWrite) {
          warn(`Role ${role.name}`, `agent has no Write/Edit tools but role requests can_write: true`);
          continue;
        }
        if (!writeRequested && /\bWrite\b/.test(tools) && role.capabilities?.can_write === false) {
          warn(`Role ${role.name}`, `agent has Write but role declares can_write: false`);
          continue;
        }
      }
      ok(`Role ${role.name} → ${resolved.kind}`);
    } catch (err) {
      fail(`Role ${role.name}`, err.message);
    }
  }

  for (const stage of config.pipeline) {
    for (const owner of stage.owner) {
      if (owner === "orchestrator") continue;
      if (!config.roles.some((r) => r.name === owner)) {
        fail(`Stage ${stage.stage}`, `owner "${owner}" not in roles`);
      }
    }
  }
  ok(`Pipeline: ${config.pipeline.length} stages`);

  try {
    const source = await loadSource(config.backlog.source, { projectRoot });
    if (typeof source.healthcheck === "function") await source.healthcheck();
    ok(`Backlog source: ${config.backlog.source.kind}`);
  } catch (err) {
    fail(`Backlog source`, err.message);
  }

  const verifyCmd = config.verify?.overrides?.verify ?? config.verify?.detected?.verify;
  if (verifyCmd) {
    ok(`Verify command: ${verifyCmd}`);
  } else {
    warn("Verify command", "none configured");
  }

  for (const guard of config.guards ?? []) {
    if (guard.enabled === false) continue;
    ok(`Guard: ${guard.name}`);
  }

  const lockKind = config.lock?.kind ?? "markdown";
  ok(`Lock service: ${lockKind}`);

  const tlmPath = join(projectRoot, config.telemetry?.log_path ?? ".shipwright/telemetry.jsonl");
  ok(`Telemetry: ${tlmPath}`);

  const requiredLabels = (config.merge?.auto_merge_labels ?? []).concat([config.merge?.block_label].filter(Boolean));
  if (requiredLabels.length > 0) {
    try {
      const out = execSync("gh label list --limit 200 --json name", { cwd: projectRoot, encoding: "utf8" });
      const existing = new Set(JSON.parse(out).map((l) => l.name));
      const missing = requiredLabels.filter((l) => !existing.has(l));
      if (missing.length === 0) ok(`GitHub labels: all ${requiredLabels.length} present`);
      else fail(`GitHub labels`, `missing: ${missing.join(", ")}`);
    } catch {
      warn(`GitHub labels`, "could not query (gh CLI not available)");
    }
  }

  printAndExit();
}

function printAndExit() {
  let pass = 0, fails = 0, warns = 0;
  for (const c of checks) {
    const sym = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✗";
    console.log(`${sym} ${c.label}${c.reason ? ` — ${c.reason}` : ""}`);
    if (c.status === "pass") pass++;
    else if (c.status === "warn") warns++;
    else fails++;
  }
  console.log(`\n${pass} pass, ${warns} warn, ${fails} fail`);
  if (fails > 0) process.exit(1);
}
