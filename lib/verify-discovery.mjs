import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function detectNodeRunner(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function nodeRunCommand(runner, script) {
  if (runner === "npm") return `npm run ${script}`;
  if (runner === "yarn") return `yarn ${script}`;
  return `${runner} ${script}`;
}

function detectLanguagesByExtensions(root, depth = 3) {
  const languages = new Set();
  function walk(dir, level) {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full, level + 1);
        continue;
      }
      if (name.endsWith(".ts") || name.endsWith(".tsx")) languages.add("typescript");
      else if (name.endsWith(".js") || name.endsWith(".jsx")) languages.add("javascript");
      else if (name.endsWith(".py")) languages.add("python");
      else if (name.endsWith(".go")) languages.add("go");
      else if (name.endsWith(".rs")) languages.add("rust");
      else if (name.endsWith(".rb")) languages.add("ruby");
      else if (name.endsWith(".java")) languages.add("java");
      else if (name.endsWith(".kt")) languages.add("kotlin");
      else if (name.endsWith(".swift")) languages.add("swift");
    }
  }
  walk(root, 0);
  return [...languages];
}

export function discoverVerifications(projectRoot) {
  const recipe = {
    ecosystem: null,
    install: null,
    verify: null,
    test: null,
    lint: null,
    typecheck: null,
    format_fix: null,
    languages: detectLanguagesByExtensions(projectRoot),
    notes: [],
  };

  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJSON(pkgPath);
    const runner = detectNodeRunner(projectRoot);
    recipe.ecosystem = `node-${runner}`;
    recipe.install = `${runner} install${runner === "npm" ? "" : ""}`;
    if (runner === "npm") recipe.install = "npm install";
    if (pkg?.scripts) {
      const scripts = pkg.scripts;
      if (scripts.verify) recipe.verify = nodeRunCommand(runner, "verify");
      else if (scripts.ci) recipe.verify = nodeRunCommand(runner, "ci");
      else if (scripts.test) recipe.verify = nodeRunCommand(runner, "test");
      if (scripts.test) recipe.test = nodeRunCommand(runner, "test");
      if (scripts.lint) recipe.lint = nodeRunCommand(runner, "lint");
      if (scripts.typecheck) recipe.typecheck = nodeRunCommand(runner, "typecheck");
      else if (scripts["type-check"]) recipe.typecheck = nodeRunCommand(runner, "type-check");
      if (scripts.format) recipe.format_fix = nodeRunCommand(runner, "format");
    }
    if (existsSync(join(projectRoot, "biome.json")) || existsSync(join(projectRoot, "biome.jsonc"))) {
      recipe.format_fix ??= `${runner === "npm" ? "npx" : runner} biome check . --write`;
    }
    if (existsSync(join(projectRoot, "turbo.json"))) {
      recipe.notes.push("turborepo detected");
    }
    if (existsSync(join(projectRoot, "pnpm-workspace.yaml"))) {
      recipe.notes.push("pnpm workspace detected");
    }
  }

  if (existsSync(join(projectRoot, "Cargo.toml"))) {
    if (!recipe.ecosystem) {
      recipe.ecosystem = "rust";
      recipe.install = "cargo fetch";
    }
    recipe.test ??= "cargo test";
    recipe.verify ??= "cargo test && cargo clippy -- -D warnings";
    recipe.lint ??= "cargo clippy -- -D warnings";
    recipe.format_fix ??= "cargo fmt";
  }

  if (existsSync(join(projectRoot, "go.mod"))) {
    if (!recipe.ecosystem) {
      recipe.ecosystem = "go";
      recipe.install = "go mod download";
    }
    recipe.test ??= "go test ./...";
    recipe.verify ??= "go test ./... && go vet ./...";
    recipe.lint ??= "go vet ./...";
    recipe.format_fix ??= "gofmt -w .";
  }

  if (existsSync(join(projectRoot, "pyproject.toml"))) {
    const text = readFileSync(join(projectRoot, "pyproject.toml"), "utf8");
    if (text.includes("[tool.poetry]")) {
      recipe.ecosystem ??= "python-poetry";
      recipe.install ??= "poetry install";
      recipe.test ??= "poetry run pytest";
      recipe.verify ??= "poetry run pytest && poetry run ruff check";
    } else if (text.includes("[tool.uv]") || existsSync(join(projectRoot, "uv.lock"))) {
      recipe.ecosystem ??= "python-uv";
      recipe.install ??= "uv sync";
      recipe.test ??= "uv run pytest";
      recipe.verify ??= "uv run pytest && uv run ruff check";
    } else {
      recipe.ecosystem ??= "python";
      recipe.test ??= "pytest";
      recipe.verify ??= "pytest";
    }
  }

  if (!recipe.verify) {
    recipe.notes.push("no verify command auto-detected; supply one in .shipwright.yml verify.overrides");
  }

  return recipe;
}
