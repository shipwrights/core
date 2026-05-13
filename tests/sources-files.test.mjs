import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSource } from "../sources/files/index.mjs";

function makeRepo() {
	const dir = mkdtempSync(join(tmpdir(), "shipwright-files-src-"));
	mkdirSync(join(dir, "docs/backlog/epics"), { recursive: true });
	return dir;
}

function writeEpic(dir, name, frontmatter) {
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
		.join("\n");
	writeFileSync(
		join(dir, "docs/backlog/epics", name),
		`---\n${fm}\n---\n\n## Why\n\nstub\n`,
	);
}

test("listAvailable filters by status", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-01-a.md", {
		id: "E-01",
		title: "A",
		status: "refined",
		priority: "P1",
		size: "small",
	});
	writeEpic(dir, "E-02-b.md", {
		id: "E-02",
		title: "B",
		status: "shipped",
		priority: "P0",
		size: "small",
	});
	writeEpic(dir, "E-03-c.md", {
		id: "E-03",
		title: "C",
		status: "idea",
		priority: "P2",
		size: "small",
	});
	const src = createSource({ projectRoot: dir });
	const items = await src.listAvailable({ statuses: ["refined", "idea"] });
	const ids = items.map((i) => i.id).sort();
	assert.deepEqual(ids, ["E-01", "E-03"]);
	rmSync(dir, { recursive: true, force: true });
});

test("pickNext respects parents-shipped + priority + size", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-00-parent.md", {
		id: "E-00",
		title: "P",
		status: "shipped",
		priority: "P0",
		size: "small",
	});
	writeEpic(dir, "E-01-blocked.md", {
		id: "E-01",
		title: "A",
		status: "refined",
		priority: "P0",
		size: "small",
		parents: ["E-99"],
	});
	writeEpic(dir, "E-02-ready-low.md", {
		id: "E-02",
		title: "B",
		status: "refined",
		priority: "P3",
		size: "small",
		parents: ["E-00"],
	});
	writeEpic(dir, "E-03-ready-high.md", {
		id: "E-03",
		title: "C",
		status: "refined",
		priority: "P0",
		size: "medium",
		parents: ["E-00"],
	});
	writeEpic(dir, "E-04-ready-high-small.md", {
		id: "E-04",
		title: "D",
		status: "refined",
		priority: "P0",
		size: "small",
		parents: ["E-00"],
	});
	const src = createSource({ projectRoot: dir });
	const next = await src.pickNext();
	// E-04: priority P0, size small (beats E-03 P0/medium and E-02 P3)
	// E-01 is blocked because E-99 isn't shipped.
	assert.equal(next.id, "E-04");
	rmSync(dir, { recursive: true, force: true });
});

test("pickNext returns null when nothing ready", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-01.md", {
		id: "E-01",
		title: "A",
		status: "shipped",
		priority: "P0",
		size: "small",
	});
	writeEpic(dir, "E-02.md", {
		id: "E-02",
		title: "B",
		status: "refined",
		priority: "P0",
		size: "small",
		parents: ["E-99"],
	});
	const src = createSource({ projectRoot: dir });
	const next = await src.pickNext();
	assert.equal(next, null);
	rmSync(dir, { recursive: true, force: true });
});

test("materialize creates a stub when missing", async () => {
	const dir = makeRepo();
	const src = createSource({ projectRoot: dir });
	const r = await src.materialize(
		{
			id: "E-99",
			title: "New idea",
			priority: "P1",
			size: "small",
			domain: "frontend",
		},
		join(dir, "docs/backlog/epics"),
	);
	assert.equal(r.created, true);
	const content = readFileSync(r.epicFilePath, "utf8");
	assert.match(content, /id: E-99/);
	assert.match(content, /status: idea/);
	rmSync(dir, { recursive: true, force: true });
});

test("markStatus mutates frontmatter status", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-01-a.md", {
		id: "E-01",
		title: "A",
		status: "refined",
		priority: "P1",
		size: "small",
	});
	const src = createSource({ projectRoot: dir });
	await src.markStatus("E-01", "shipped");
	const after = readFileSync(join(dir, "docs/backlog/epics/E-01-a.md"), "utf8");
	assert.match(after, /^status: shipped/m);
	rmSync(dir, { recursive: true, force: true });
});

test("attachPR appends a link under Related PRs (creating the section if missing)", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-01-a.md", {
		id: "E-01",
		title: "A",
		status: "refined",
		priority: "P1",
		size: "small",
	});
	const src = createSource({ projectRoot: dir });
	await src.attachPR("E-01", "https://example.com/pr/42");
	const after = readFileSync(join(dir, "docs/backlog/epics/E-01-a.md"), "utf8");
	assert.match(after, /## Related PRs/);
	assert.match(after, /https:\/\/example\.com\/pr\/42/);
	rmSync(dir, { recursive: true, force: true });
});

test("attachPR is idempotent (no duplicate on second call)", async () => {
	const dir = makeRepo();
	writeEpic(dir, "E-01-a.md", {
		id: "E-01",
		title: "A",
		status: "refined",
		priority: "P1",
		size: "small",
	});
	const src = createSource({ projectRoot: dir });
	await src.attachPR("E-01", "https://example.com/pr/42");
	await src.attachPR("E-01", "https://example.com/pr/42");
	const after = readFileSync(join(dir, "docs/backlog/epics/E-01-a.md"), "utf8");
	const matches = after.match(/example\.com\/pr\/42/g);
	assert.equal(matches.length, 1);
	rmSync(dir, { recursive: true, force: true });
});
