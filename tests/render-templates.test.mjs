import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../lib/render-templates.mjs";

test("substitutes simple tokens", () => {
  const out = renderTemplate("Hello {{name}}", { name: "world" });
  assert.equal(out, "Hello world");
});

test("traverses nested paths", () => {
  const out = renderTemplate("{{branches.integration}}", { branches: { integration: "dev" } });
  assert.equal(out, "dev");
});

test("indexes arrays by number", () => {
  const out = renderTemplate("{{tags.0}}", { tags: ["alpha", "beta"] });
  assert.equal(out, "alpha");
});

test("preserves GitHub Actions ${{ ... }} unchanged", () => {
  const tmpl = "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nname: {{branches.integration}}";
  const out = renderTemplate(tmpl, { branches: { integration: "main" } });
  assert.equal(out, "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nname: main");
});

test("throws on unresolved token", () => {
  assert.throws(() => renderTemplate("{{missing}}", {}));
});
