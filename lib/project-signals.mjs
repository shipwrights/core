// Detect project signals used by /shipwrights-craft-agent to draft
// project-specific agent prompts. Read-only — never writes to disk.
//
// Returns a structured "signals" object the skill can render into a
// template. Examples of what it surfaces:
//
//   {
//     name: "arms-invoice-frontend-pro",
//     ecosystem: "node-yarn",
//     languages: ["typescript", "vue"],
//     framework: "vue3",            // primary UI framework
//     stack: ["vue", "pinia", "vue-router", "vue-quill", "apexcharts", "axios"],
//     buildTool: "vite",
//     testTool: "vitest",
//     linter: "eslint",
//     formatter: "prettier",
//     styling: "tailwind",
//     monorepo: false,
//     conventions: {
//       hasCLAUDEMd: true,
//       hasAGENTSMd: true,
//       componentsDir: "src/components",
//       storesDir: "src/stores",
//       servicesDir: "src/services",
//     },
//     domainHints: ["invoice", "finance", "quickbooks"], // from README/keywords
//   }

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FRAMEWORK_DEPS = {
  vue3: ["vue@^3", "vue@3", "vue"],
  react: ["react"],
  next: ["next"],
  nuxt: ["nuxt"],
  svelte: ["svelte"],
  angular: ["@angular/core"],
  express: ["express"],
  fastify: ["fastify"],
  hono: ["hono"],
  nestjs: ["@nestjs/core"],
};

const STACK_OF_INTEREST = [
  // state
  "pinia", "vuex", "zustand", "redux", "@reduxjs/toolkit", "jotai", "mobx",
  // routing
  "vue-router", "react-router-dom", "@tanstack/router",
  // data fetching
  "axios", "@tanstack/react-query", "@tanstack/vue-query", "swr",
  // editors
  "@vueup/vue-quill", "quill", "tinymce", "@tinymce/tinymce-react", "@tiptap/core",
  // charts
  "apexcharts", "chart.js", "recharts", "d3",
  // dates
  "dayjs", "date-fns", "luxon", "moment",
  // pdf
  "pdfmake", "@react-pdf/renderer", "jspdf",
  // i18n
  "i18next", "vue-i18n",
  // forms
  "@tanstack/react-form", "@tanstack/form-core", "react-hook-form", "vee-validate",
  // tables
  "@tanstack/table-core", "@tanstack/react-table", "@tanstack/vue-table",
  // utility
  "lodash", "lodash-es", "ramda",
];

const TEST_TOOLS = ["vitest", "jest", "mocha", "ava", "playwright", "@playwright/test", "cypress"];
const LINTERS = ["eslint", "biome", "@biomejs/biome", "rome"];
const FORMATTERS = ["prettier"];
const BUILD_TOOLS = ["vite", "webpack", "rollup", "esbuild", "parcel", "turbo", "nx"];
const STYLING = ["tailwindcss", "@tailwindcss/vite", "sass", "less", "styled-components", "@emotion/react"];

const DOMAIN_KEYWORDS = [
  "invoice", "billing", "payment", "finance", "accounting", "tax", "vat",
  "ecommerce", "checkout", "cart", "order", "inventory", "shipping", "fulfilment",
  "crm", "lead", "customer",
  "auth", "sso", "oauth", "saml",
  "scheduling", "calendar", "appointment", "booking",
  "messaging", "chat", "notification", "email",
  "healthcare", "patient", "medical",
  "education", "student", "course", "learning",
  "logistics", "warehouse", "supply", "tracking",
  "quickbooks", "stripe", "xero", "salesforce", "hubspot", "shopify",
];

export function detectProjectSignals(root) {
  const signals = {
    name: null,
    ecosystem: null,
    languages: [],
    framework: null,
    stack: [],
    buildTool: null,
    testTool: null,
    linter: null,
    formatter: null,
    styling: null,
    monorepo: false,
    conventions: {},
    domainHints: [],
  };

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJSON(pkgPath) ?? {};
    signals.name = pkg.name ?? null;
    signals.ecosystem = detectNodeEcosystem(root);

    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    const depNames = new Set(Object.keys(allDeps));

    signals.framework = detectFramework(depNames);

    for (const dep of STACK_OF_INTEREST) {
      if (depNames.has(dep)) signals.stack.push(dep);
    }
    signals.buildTool = firstMatch(BUILD_TOOLS, depNames);
    signals.testTool = firstMatch(TEST_TOOLS, depNames);
    signals.linter = firstMatch(LINTERS, depNames);
    signals.formatter = firstMatch(FORMATTERS, depNames);
    signals.styling = firstMatch(STYLING, depNames);

    signals.monorepo =
      Array.isArray(pkg.workspaces) ||
      existsSync(join(root, "pnpm-workspace.yaml")) ||
      existsSync(join(root, "turbo.json")) ||
      existsSync(join(root, "lerna.json"));

    // Keywords from package.json + description seed the domain hints.
    const corpus = [
      ...(pkg.keywords ?? []),
      pkg.description ?? "",
      signals.name ?? "",
    ].join(" ").toLowerCase();
    signals.domainHints = DOMAIN_KEYWORDS.filter((kw) => corpus.includes(kw));
  }

  signals.languages = detectLanguages(root);

  signals.conventions = detectConventions(root);

  // README adds to domain hints (top 200 lines).
  const readmePath = ["README.md", "readme.md", "Readme.md"].map((n) => join(root, n)).find(existsSync);
  if (readmePath) {
    const head = readFileSync(readmePath, "utf8").split(/\r?\n/).slice(0, 200).join("\n").toLowerCase();
    for (const kw of DOMAIN_KEYWORDS) {
      if (head.includes(kw) && !signals.domainHints.includes(kw)) {
        signals.domainHints.push(kw);
      }
    }
  }

  return signals;
}

// ----- helpers -----

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function detectNodeEcosystem(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "node-pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "node-yarn";
  if (existsSync(join(root, "bun.lockb"))) return "node-bun";
  if (existsSync(join(root, "package-lock.json"))) return "node-npm";
  return "node-npm";
}

function detectFramework(depNames) {
  for (const [fw, candidates] of Object.entries(FRAMEWORK_DEPS)) {
    for (const c of candidates) {
      if (depNames.has(c)) return fw;
    }
  }
  return null;
}

function firstMatch(candidates, depNames) {
  for (const c of candidates) {
    if (depNames.has(c)) return c;
  }
  return null;
}

function detectLanguages(root, depth = 3) {
  const languages = new Set();
  function walk(dir, level) {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist" || entry.name === "build") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, level + 1);
        continue;
      }
      const ext = entry.name.split(".").pop().toLowerCase();
      if (ext === "ts" || ext === "tsx") languages.add("typescript");
      else if (ext === "js" || ext === "jsx") languages.add("javascript");
      else if (ext === "vue") languages.add("vue");
      else if (ext === "svelte") languages.add("svelte");
      else if (ext === "go") languages.add("go");
      else if (ext === "rs") languages.add("rust");
      else if (ext === "py") languages.add("python");
    }
  }
  walk(root, 0);
  return [...languages].sort();
}

function detectConventions(root) {
  const conv = {
    hasCLAUDEMd: existsSync(join(root, "CLAUDE.md")),
    hasAGENTSMd: existsSync(join(root, "AGENTS.md")),
  };
  // Detect common src/ subdirs.
  const candidatePairs = [
    ["componentsDir", ["src/components", "src/ui/components", "components"]],
    ["storesDir", ["src/stores", "src/store", "store", "stores"]],
    ["servicesDir", ["src/services", "src/api", "src/lib/api"]],
    ["routesDir", ["src/router", "src/routes", "routes", "src/pages"]],
    ["composablesDir", ["src/composables", "src/hooks"]],
    ["testsDir", ["tests", "test", "__tests__", "src/__tests__"]],
  ];
  for (const [key, options] of candidatePairs) {
    for (const opt of options) {
      const full = join(root, opt);
      try {
        if (existsSync(full) && statSync(full).isDirectory()) {
          conv[key] = opt;
          break;
        }
      } catch {}
    }
  }
  return conv;
}
