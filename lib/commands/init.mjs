// `shipwright init` — non-destructive scaffold.
//
// Walks templates/, classifies each path against the consumer's repo, asks
// per-conflict decisions (or applies defaults in --non-interactive mode),
// renders templates with config tokens, and lands everything as one git
// commit so undo is `git revert HEAD`.

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stringify as toYaml } from "yaml";
import { discoverVerifications } from "../verify-discovery.mjs";
import { renderTemplate } from "../render-templates.mjs";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";

const NEVER_OVERWRITE = [
  ".shipwright.yml",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
];

const DEFAULT_LABELS = {
  trivial: { name: "tier:trivial", color: "cccccc" },
  minimal: { name: "tier:minimal", color: "e8e8e8" },
  block:   { name: "do-not-auto-merge", color: "d93f0b" },
};

function parseFlags(args) {
  return {
    dryRun: args.includes("--dry-run"),
    nonInteractive: args.includes("--non-interactive"),
    force: args.includes("--force"),
  };
}

function gitClean(projectRoot) {
  try {
    const out = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" });
    return out.trim().length === 0;
  } catch {
    return false;
  }
}

function isInsideGit(projectRoot) {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: projectRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push({ rel: relative(base, full), absolute: full });
    }
  }
  return out;
}

function rl() {
  return readline.createInterface({ input, output });
}

async function ask(question, defaultValue = "") {
  const r = rl();
  const ans = await new Promise((res) => r.question(`${question} [${defaultValue}] `, res));
  r.close();
  return ans.trim() || defaultValue;
}

async function askYesNo(question, defaultYes = true) {
  const def = defaultYes ? "Y/n" : "y/N";
  const ans = (await ask(question, def)).toLowerCase();
  if (ans === "y" || ans === "yes") return true;
  if (ans === "n" || ans === "no") return false;
  return defaultYes;
}

function detectMonorepoLayout(projectRoot) {
  const isMonorepo =
    existsSync(join(projectRoot, "pnpm-workspace.yaml")) ||
    existsSync(join(projectRoot, "lerna.json")) ||
    existsSync(join(projectRoot, "turbo.json"));
  const hasApi = existsSync(join(projectRoot, "apps", "api"));
  const hasWeb = existsSync(join(projectRoot, "apps", "web"));
  const hasContracts = existsSync(join(projectRoot, "packages", "contracts"));
  return { isMonorepo, hasApi, hasWeb, hasContracts };
}

function defaultRolesForLayout(layout) {
  const roles = [
    {
      name: "po",
      agent: "bundled",
      capabilities: { can_write: false },
      invoke_at: ["refine"],
    },
  ];

  if (layout.hasApi || layout.isMonorepo) {
    roles.push({
      name: "backend",
      agent: "bundled",
      capabilities: {
        can_write: true,
        scope: layout.isMonorepo
          ? ["apps/api/**", "packages/contracts/**", "packages/database/**", "packages/domain/**"]
          : ["src/**", "test/**"],
      },
      invoke_at: ["design-and-build"],
      parallel_with: ["frontend", "qa"],
    });
  }

  if (layout.hasWeb) {
    roles.push({
      name: "frontend",
      agent: "bundled",
      capabilities: {
        can_write: true,
        scope: ["apps/web/**", "packages/contracts/**"],
      },
      invoke_at: ["design-and-build"],
      parallel_with: ["backend", "qa"],
    });
  }

  roles.push({
    name: "qa",
    agent: "bundled",
    capabilities: {
      can_write: "tests-only",
      scope: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**"],
    },
    invoke_at: ["test"],
  });

  roles.push({
    name: "gatekeeper",
    agent: "bundled",
    capabilities: { can_write: "fixup-only" },
    invoke_at: ["review"],
  });

  if (layout.hasWeb) {
    roles.push({
      name: "browser",
      agent: "bundled",
      capabilities: { can_write: false },
      invoke_at: ["review-browser"],
    });
  }

  return roles;
}

function defaultPipelineForRoles(roles) {
  const hasPo = roles.some((r) => r.name === "po");
  const hasQa = roles.some((r) => r.name === "qa");
  const hasGatekeeper = roles.some((r) => r.name === "gatekeeper");
  const hasBrowser = roles.some((r) => r.name === "browser");
  const buildOwners = roles
    .filter((r) => ["backend", "frontend"].includes(r.name))
    .map((r) => r.name);
  // For projects with no specialists, the orchestrator owns the build itself.
  const designAndBuildOwners = buildOwners.length > 0 ? buildOwners : ["orchestrator"];

  const stages = [];
  if (hasPo) {
    stages.push({
      stage: "refine",
      owner: ["po"],
      optional_when: "tier == 'trivial' || tier == 'minimal'",
    });
  }
  stages.push({
    stage: "slice",
    owner: ["orchestrator"],
    requires: "refine | tier:minimal",
    freeze_paths: ["packages/contracts/**"],
  });
  stages.push({
    stage: "design-and-build",
    owner: designAndBuildOwners,
    parallelism: designAndBuildOwners.length > 1 ? "full" : "sequential",
    on_specialist_failure: "bundle-and-escalate",
    on_scope_violation: "escalate",
  });
  if (buildOwners.length > 0) {
    stages.push({
      stage: "integrate",
      owner: ["orchestrator"],
      integrate_order: buildOwners,
      on_conflict: "escalate",
    });
  }
  if (hasQa) {
    stages.push({ stage: "test", owner: ["qa"] });
  }
  if (hasGatekeeper) {
    stages.push({ stage: "review", owner: ["gatekeeper"], write_mode: "fixup-only" });
  }
  if (hasBrowser) {
    stages.push({ stage: "review-browser", owner: ["browser"], optional_when: "false" });
  }
  stages.push({ stage: "ship", owner: ["orchestrator"] });
  return stages;
}

function buildDefaultConfig({ projectRoot, recipe, layout, projectName }) {
  const roles = defaultRolesForLayout(layout);
  const pipeline = defaultPipelineForRoles(roles);

  return {
    version: 1,
    project: { name: projectName, languages: recipe.languages },
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
    scratch: {
      push_to_remote: false,
      bundle_on_failure: true,
      cleanup_on_integrate: true,
    },
    roles,
    pipeline,
    tier_routing: [
      { if: "epic.size == 'small' && epic.domain == 'docs'", tier: "trivial" },
      { if: "epic.id starts_with 'audit-' || epic.id starts_with 'ops-'", tier: "minimal" },
      { if: "epic.size == 'medium'", tier: "light" },
      { default: "full" },
    ],
    tiers: {
      trivial: { skip_stages: ["refine", "slice", "design-and-build"], auto_merge: true },
      minimal: { skip_stages: ["refine", "slice"], auto_merge: true },
      light:   { skip_stages: ["refine"], auto_merge: false },
      full:    { skip_stages: [], auto_merge: false },
    },
    backlog: { source: { kind: "files" }, state_dir: "docs/backlog/epics" },
    verify: { detected: filterDetected(recipe), overrides: {} },
    guards: [
      { name: "file-length", enabled: true, rules: [], on_violation: "block" },
      { name: "branch-name", enabled: true, on_violation: "block" },
      { name: "commit-format", enabled: true, on_violation: "block" },
    ],
    merge: {
      strategy: "rebase",
      stack_depth: 3,
      auto_merge_labels: [DEFAULT_LABELS.trivial.name, DEFAULT_LABELS.minimal.name],
      block_label: DEFAULT_LABELS.block.name,
    },
    lock: { kind: "markdown", config: { stale_after_hours: 48 } },
    telemetry: {
      enabled: true,
      log_path: ".shipwright/telemetry.jsonl",
      on_budget_exceeded: "warn",
    },
    hard_rules: [
      "Public APIs expose slugs / reference numbers, never raw DB ids",
      "Append-only ledgers stay append-only",
    ],
  };
}

function filterDetected(recipe) {
  const out = {};
  for (const k of ["install", "verify", "test", "lint", "typecheck", "format_fix"]) {
    if (recipe[k]) out[k] = recipe[k];
  }
  return out;
}

function classifyTemplate({ srcAbs, destAbs, context }) {
  const tmpl = readFileSync(srcAbs, "utf8");
  let rendered;
  try {
    rendered = renderTemplate(tmpl, context);
  } catch (err) {
    return { kind: "render-error", message: err.message };
  }
  if (!existsSync(destAbs)) return { kind: "new", rendered };
  const existing = readFileSync(destAbs, "utf8");
  if (existing === rendered) return { kind: "identical", rendered };
  return { kind: "conflict", rendered, existing };
}

function shouldNeverOverwrite(rel) {
  return NEVER_OVERWRITE.some((p) => rel === p || rel.startsWith(`${p}/`));
}

async function resolveConflict(rel, { nonInteractive, force }) {
  if (force) return "overwrite";
  if (nonInteractive) return "example";
  console.log(`\nConflict: ${rel}`);
  const ans = (
    await ask(
      "(s)kip / (o)verwrite / (e)xample / (v)iew-diff",
      "s",
    )
  ).toLowerCase();
  if (ans === "o" || ans === "overwrite") return "overwrite";
  if (ans === "e" || ans === "example") return "example";
  if (ans === "v" || ans === "view-diff") return "view-diff";
  return "skip";
}

function showDiff(existing, rendered) {
  const a = existing.split("\n");
  const b = rendered.split("\n");
  const max = Math.max(a.length, b.length);
  console.log("\n--- existing");
  console.log("+++ rendered");
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.log(`- ${a[i]}`);
      if (b[i] !== undefined) console.log(`+ ${b[i]}`);
    }
  }
  console.log();
}

export async function runInit({ projectRoot, pluginRoot, args = [] }) {
  const flags = parseFlags(args);

  if (!isInsideGit(projectRoot)) {
    console.error("Not a git repository. Run `git init` first.");
    process.exit(2);
  }
  if (!gitClean(projectRoot) && !flags.force) {
    console.error("Working tree is dirty. Commit or stash, then re-run (or pass --force).");
    process.exit(2);
  }

  const configPath = join(projectRoot, ".shipwright.yml");
  if (existsSync(configPath)) {
    console.error(".shipwright.yml already exists. Use /shipwright:upgrade to bump.");
    process.exit(2);
  }

  console.log("Detecting project shape...");
  const recipe = discoverVerifications(projectRoot);
  const layout = detectMonorepoLayout(projectRoot);

  const projectName = flags.nonInteractive
    ? require_pkg_name(projectRoot)
    : await ask("Project name?", require_pkg_name(projectRoot));

  const config = buildDefaultConfig({ projectRoot, recipe, layout, projectName });

  if (!flags.nonInteractive) {
    config.branches.integration = await ask("Integration branch?", config.branches.integration);
    config.branches.release = await ask("Release branch?", config.branches.release);
    if (recipe.verify) {
      const v = await ask("Verify command?", recipe.verify);
      config.verify.detected.verify = v;
    }
  }

  // Walk templates, classify, plan.
  const templatesDir = join(pluginRoot, "templates");
  const allTemplates = walkFiles(templatesDir);
  // Render context: the config + a name-keyed view of roles for templates
  // that want `roles.<name>.agent` style access.
  const rolesByName = {};
  for (const r of config.roles) {
    rolesByName[r.name] = {
      agent: typeof r.agent === "string" ? r.agent : (r.agent?.user ?? r.agent?.custom ?? "bundled"),
    };
  }
  const renderContext = { ...config, roles: rolesByName };
  const plan = [];

  for (const tmpl of allTemplates) {
    const dest = templateDestination(tmpl.rel, projectRoot);
    if (shouldNeverOverwrite(relative(projectRoot, dest))) {
      const exists = existsSync(dest);
      if (exists) {
        plan.push({ rel: tmpl.rel, dest, action: "skip-protected", reason: "consumer-owned" });
        continue;
      }
    }
    const cl = classifyTemplate({ srcAbs: tmpl.absolute, destAbs: dest, context: renderContext });
    if (cl.kind === "render-error") {
      console.error(`Template render error in ${tmpl.rel}: ${cl.message}`);
      process.exit(2);
    }
    if (cl.kind === "identical") {
      plan.push({ rel: tmpl.rel, dest, action: "skip-identical" });
      continue;
    }
    if (cl.kind === "new") {
      plan.push({ rel: tmpl.rel, dest, action: "write", content: cl.rendered });
      continue;
    }
    let resolution = await resolveConflict(tmpl.rel, flags);
    if (resolution === "view-diff") {
      showDiff(cl.existing, cl.rendered);
      resolution = await resolveConflict(tmpl.rel, flags);
    }
    if (resolution === "overwrite") plan.push({ rel: tmpl.rel, dest, action: "overwrite", content: cl.rendered });
    else if (resolution === "example") plan.push({ rel: tmpl.rel, dest, action: "example", content: cl.rendered });
    else plan.push({ rel: tmpl.rel, dest, action: "skip-conflict" });
  }

  // Add the .shipwright.yml itself.
  const yamlText = `# Shipwright config — see https://github.com/shipwrights/core\n${toYaml(config)}`;
  plan.push({ rel: ".shipwright.yml", dest: configPath, action: "write", content: yamlText });

  // Show the plan.
  console.log("\nPlan:");
  for (const p of plan) {
    const tag = {
      write: "+",
      overwrite: "~",
      example: ".example",
      "skip-identical": "=",
      "skip-conflict": "−",
      "skip-protected": "−",
    }[p.action];
    const reason = p.reason ? ` (${p.reason})` : "";
    console.log(`  ${tag} ${relative(projectRoot, p.dest)}${reason}`);
  }
  console.log();

  if (flags.dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  if (!flags.force && !flags.nonInteractive) {
    if (!(await askYesNo("Proceed?", true))) {
      console.log("Aborted.");
      return;
    }
  }

  for (const p of plan) {
    if (p.action === "skip-identical" || p.action === "skip-conflict" || p.action === "skip-protected") continue;
    const target = p.action === "example" ? `${p.dest}.example` : p.dest;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, p.content, "utf8");
  }

  // The scratch-branch lifecycle scripts (templates/scripts/shipwright/*.mjs)
  // import `yaml` and `minimatch`. They run from the consumer's repo, so the
  // consumer needs those modules resolvable from its node_modules. Add to
  // devDependencies if missing.
  const consumerPkgPath = join(projectRoot, "package.json");
  if (existsSync(consumerPkgPath)) {
    const pkg = JSON.parse(readFileSync(consumerPkgPath, "utf8"));
    pkg.devDependencies = pkg.devDependencies ?? {};
    let added = false;
    if (!pkg.devDependencies.yaml && !pkg.dependencies?.yaml) {
      pkg.devDependencies.yaml = "^2.6.0";
      added = true;
    }
    if (!pkg.devDependencies.minimatch && !pkg.dependencies?.minimatch) {
      pkg.devDependencies.minimatch = "^10.0.0";
      added = true;
    }
    if (added) {
      writeFileSync(consumerPkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }
  }

  // installed.json marker for /shipwright:upgrade
  const installedDir = join(projectRoot, ".shipwright");
  mkdirSync(installedDir, { recursive: true });
  writeFileSync(
    join(installedDir, "installed.json"),
    JSON.stringify({ version: config.version, installedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );

  // Single git commit.
  const pkgVersion = require_plugin_version(pluginRoot);
  const commitMsg = `chore: install @shipwrights/core v${pkgVersion}`;
  spawnSync("git", ["add", "-A"], { cwd: projectRoot, stdio: "inherit" });
  spawnSync(
    "git",
    [
      "-c",
      "user.name=Shipwright Init",
      "-c",
      "user.email=shipwright@noreply.local",
      "commit",
      "-m",
      commitMsg,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  console.log(`\n✓ Shipwright installed at v${pkgVersion}`);
  console.log("✓ Undo with `git revert HEAD`");
  console.log("\nNext:");
  console.log("  pnpm install                         # install yaml + minimatch (added to devDependencies)");
  console.log("  /shipwright:doctor                   # validate");
  console.log("  gh label create tier:trivial --color cccccc");
  console.log("  gh label create tier:minimal --color e8e8e8");
  console.log("  gh label create do-not-auto-merge --color d93f0b");
  console.log("  /shipwright:epic <id>                # drive your first epic");
}

function templateDestination(rel, projectRoot) {
  // templates/github/** -> .github/**
  // templates/scripts/** -> scripts/**
  // templates/docs/** -> docs/**
  const forward = rel.replace(/\\/g, "/");
  const normalized = forward.replace(/^github\//, ".github/");
  return resolve(projectRoot, normalized);
}

function require_pkg_name(projectRoot) {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return "my-project";
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).name ?? "my-project";
  } catch {
    return "my-project";
  }
}

function require_plugin_version(pluginRoot) {
  const pkgPath = join(pluginRoot, "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}
