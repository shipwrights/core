import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { renderTemplate } from "../lib/render-templates.mjs";

const TEMPLATE_CONTEXT = {
	branches: { integration: "dev" },
	backlog: { state_dir: "docs/backlog/epics" },
	merge: {
		strategy: "rebase",
		auto_merge_labels: ["tier:trivial", "tier:minimal"],
		block_label: "do-not-auto-merge",
	},
};

test("substitutes simple tokens", () => {
	const out = renderTemplate("Hello {{name}}", { name: "world" });
	assert.equal(out, "Hello world");
});

test("traverses nested paths", () => {
	const out = renderTemplate("{{branches.integration}}", {
		branches: { integration: "dev" },
	});
	assert.equal(out, "dev");
});

test("indexes arrays by number", () => {
	const out = renderTemplate("{{tags.0}}", { tags: ["alpha", "beta"] });
	assert.equal(out, "alpha");
});

test("preserves GitHub Actions ${{ ... }} unchanged", () => {
	const tmpl =
		"GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nname: {{branches.integration}}";
	const out = renderTemplate(tmpl, { branches: { integration: "main" } });
	assert.equal(out, "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nname: main");
});

test("throws on unresolved token", () => {
	assert.throws(() => renderTemplate("{{missing}}", {}));
});

test("renders GitHub workflow templates as parseable workflow YAML", () => {
	for (const rel of [
		"templates/github/workflows/auto-merge-low-tier.yml",
		"templates/github/workflows/post-merge-doc-update.yml",
	]) {
		const template = readFileSync(join(process.cwd(), rel), "utf8");
		const rendered = renderTemplate(template, TEMPLATE_CONTEXT);
		assert.doesNotMatch(rendered, /(?<!\$)\{\{/);
		assert.match(rendered, /\$\{\{ secrets\./);
		assert.doesNotThrow(() => parseYaml(rendered), rel);
	}
});

test("post-merge workflow stages multiline changed files safely", () => {
	const template = readFileSync(
		join(process.cwd(), "templates/github/workflows/post-merge-doc-update.yml"),
		"utf8",
	);
	const rendered = renderTemplate(template, TEMPLATE_CONTEXT);
	assert.match(rendered, /while IFS= read -r file/);
	assert.match(rendered, /git add -- "\$file"/);
	assert.doesNotMatch(rendered, /git add \$CHANGED_FILES/);
});
