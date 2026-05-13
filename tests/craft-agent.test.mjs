import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectSignals } from "../lib/project-signals.mjs";
import { proposeAgents, projectShortName } from "../lib/propose-agents.mjs";
import { renderAgent } from "../lib/render-agent.mjs";

function makeProject(setup) {
  const dir = mkdtempSync(join(tmpdir(), "shipwrights-craft-"));
  setup(dir);
  return dir;
}

// ---------- project-signals ----------

test("detectProjectSignals on a vue3 + pinia + tailwind project", () => {
  const dir = makeProject((d) => {
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({
        name: "arms-invoice-frontend-pro",
        keywords: ["invoice", "finance"],
        description: "ARMS invoice management frontend",
        dependencies: {
          vue: "^3.5",
          pinia: "^3",
          "vue-router": "^4",
          "@vueup/vue-quill": "^1.2",
          apexcharts: "^5",
          pdfmake: "^0.2",
          axios: "^1",
        },
        devDependencies: {
          vite: "^6",
          vitest: "^3",
          eslint: "^9",
          prettier: "^3",
          tailwindcss: "^4",
        },
      }),
      "utf8",
    );
    writeFileSync(join(d, "yarn.lock"), "");
    mkdirSync(join(d, "src/components"), { recursive: true });
    mkdirSync(join(d, "src/stores"), { recursive: true });
    mkdirSync(join(d, "src/services"), { recursive: true });
    writeFileSync(join(d, "src/components/App.vue"), "");
    writeFileSync(join(d, "src/main.ts"), "");
  });
  try {
    const s = detectProjectSignals(dir);
    assert.equal(s.name, "arms-invoice-frontend-pro");
    assert.equal(s.ecosystem, "node-yarn");
    assert.equal(s.framework, "vue3");
    assert.ok(s.stack.includes("pinia"));
    assert.ok(s.stack.includes("vue-router"));
    assert.ok(s.stack.includes("@vueup/vue-quill"));
    assert.ok(s.stack.includes("pdfmake"));
    assert.equal(s.buildTool, "vite");
    assert.equal(s.testTool, "vitest");
    assert.equal(s.linter, "eslint");
    assert.equal(s.styling, "tailwindcss");
    assert.equal(s.conventions.componentsDir, "src/components");
    assert.equal(s.conventions.storesDir, "src/stores");
    assert.ok(s.domainHints.includes("invoice"));
    assert.ok(s.domainHints.includes("finance"));
    assert.ok(s.languages.includes("typescript"));
    assert.ok(s.languages.includes("vue"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectProjectSignals returns mostly-null signals on an empty dir", () => {
  const dir = makeProject(() => {});
  try {
    const s = detectProjectSignals(dir);
    assert.equal(s.name, null);
    assert.equal(s.framework, null);
    assert.deepEqual(s.stack, []);
    assert.equal(s.testTool, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectProjectSignals: react + react-query + zustand", () => {
  const dir = makeProject((d) => {
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({
        name: "store-front",
        dependencies: {
          react: "^18",
          "react-router-dom": "^6",
          "@tanstack/react-query": "^5",
          zustand: "^4",
        },
        devDependencies: {
          jest: "^29",
        },
      }),
      "utf8",
    );
  });
  try {
    const s = detectProjectSignals(dir);
    assert.equal(s.framework, "react");
    assert.ok(s.stack.includes("@tanstack/react-query"));
    assert.ok(s.stack.includes("zustand"));
    assert.equal(s.testTool, "jest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- propose-agents ----------

test("proposeAgents on vue3 project suggests frontend + qa + domain + pdf when applicable", () => {
  const signals = {
    name: "arms-invoice-frontend-pro",
    framework: "vue3",
    stack: ["pinia", "vue-router", "pdfmake"],
    testTool: "vitest",
    styling: "tailwindcss",
    buildTool: "vite",
    domainHints: ["invoice", "finance"],
    languages: ["typescript", "vue"],
    conventions: {},
  };
  const proposals = proposeAgents(signals);
  const slugs = proposals.map((p) => p.slug);
  assert.ok(slugs.some((s) => s.includes("frontend-vue-specialist")), "frontend-vue suggested");
  assert.ok(slugs.some((s) => s.includes("qa-engineer")), "qa suggested");
  assert.ok(slugs.some((s) => s.includes("domain-expert")), "domain suggested");
  assert.ok(slugs.some((s) => s.includes("pdf-rendering-specialist")), "pdf suggested");
});

test("proposeAgents on react project suggests frontend-react", () => {
  const signals = {
    name: "shop",
    framework: "react",
    stack: ["@tanstack/react-query"],
    testTool: "jest",
    domainHints: [],
    languages: ["typescript"],
    conventions: {},
  };
  const proposals = proposeAgents(signals);
  const frontend = proposals.find((p) => p.archetype === "frontend-react");
  assert.ok(frontend, "frontend-react proposal exists");
  assert.equal(frontend.wireToRole, "frontend");
});

test("proposeAgents on backend-only project does not suggest a frontend agent", () => {
  const signals = {
    name: "api",
    framework: "fastify",
    stack: [],
    testTool: "vitest",
    domainHints: [],
    languages: ["typescript"],
    conventions: {},
  };
  const proposals = proposeAgents(signals);
  assert.ok(!proposals.some((p) => p.archetype.startsWith("frontend")));
  assert.ok(proposals.some((p) => p.archetype === "backend-node"));
});

test("projectShortName: strips @scope/ and trims to 3 tokens", () => {
  assert.equal(
    projectShortName({ name: "@acme/super-long-service-name-with-extras" }),
    "super-long-service",
  );
  assert.equal(
    projectShortName({ name: "arms-invoice-frontend-pro" }),
    "arms-invoice-frontend",
  );
  assert.equal(projectShortName({}), "project");
});

// ---------- render-agent ----------

test("renderAgent produces well-formed frontmatter + body for frontend-vue", () => {
  const signals = {
    name: "arms-invoice-frontend",
    framework: "vue3",
    stack: ["pinia", "vue-router", "@vueup/vue-quill"],
    testTool: "vitest",
    styling: "tailwindcss",
    buildTool: "vite",
    languages: ["typescript", "vue"],
    conventions: {
      componentsDir: "src/components",
      storesDir: "src/stores",
      hasCLAUDEMd: true,
    },
    domainHints: ["invoice"],
  };
  const proposal = {
    slug: "arms-invoice-frontend-vue-specialist",
    archetype: "frontend-vue",
    name: "Frontend Vue specialist (arms-invoice-frontend)",
    reason: "vue3 + pinia + tailwindcss + vite detected",
    wireToRole: "frontend",
  };
  const md = renderAgent(proposal, signals);

  // Frontmatter present
  assert.match(md, /^---\n/);
  assert.match(md, /^name: arms-invoice-frontend-vue-specialist$/m);
  assert.match(md, /^description: .+generated by \/shipwrights-craft-agent/m);
  assert.match(md, /^tools: All tools$/m);
  // Closing frontmatter delimiter on its own line.
  assert.match(md, /^---$\n\n# /m);
  // Body mentions detected stack
  assert.match(md, /vue3/i);
  assert.match(md, /pinia/i);
  assert.match(md, /vue-quill/i);
  assert.match(md, /vitest/);
  assert.match(md, /src\/components/);
  assert.match(md, /CLAUDE\.md/);
  // Reason line preserved
  assert.match(md, /vue3 \+ pinia \+ tailwindcss \+ vite detected/);
});

test("renderAgent: domain archetype handles no detected hints gracefully", () => {
  const signals = {
    name: "x",
    framework: null,
    stack: [],
    testTool: null,
    languages: [],
    conventions: {},
    domainHints: [],
  };
  const proposal = {
    slug: "x-domain-expert",
    archetype: "domain",
    name: "Domain expert (x)",
    reason: "manual request",
    wireToRole: null,
  };
  const md = renderAgent(proposal, signals);
  assert.match(md, /no specific domain detected/i);
});

test("renderAgent: throws on unknown archetype", () => {
  assert.throws(
    () => renderAgent({ archetype: "bogus" }, {}),
    /no template for archetype bogus/,
  );
});
