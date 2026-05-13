// Files source adapter.
//
// Treats <state_dir>/*.md as both the source of truth and the materialised
// form. listAvailable() returns epic files at status: idea or refined.
// pickNext() applies parent-shipped + priority + size ordering.
// materialize() is a no-op (the file already exists).

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const SIZE_ORDER = { small: 0, medium: 1, large: 2 };

function parseFrontmatter(content) {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
	if (!match) return null;
	const fm = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		let value = kv[2].trim();
		if (value.startsWith("[") && value.endsWith("]")) {
			value = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		}
		fm[kv[1]] = value;
	}
	return fm;
}

function readEpics(epicsDir) {
	if (!existsSync(epicsDir)) return [];
	return readdirSync(epicsDir)
		.filter((name) => name.endsWith(".md") && name !== "README.md")
		.map((name) => {
			const path = join(epicsDir, name);
			const content = readFileSync(path, "utf8");
			const fm = parseFrontmatter(content);
			return { name, path, content, fm };
		})
		.filter((e) => e.fm);
}

function toBacklogItem(epic) {
	const fm = epic.fm;
	return {
		id: fm.id,
		title: fm.title,
		description: fm.title,
		status: fm.status ?? "idea",
		priority: fm.priority,
		size: fm.size,
		domain: fm.domain,
		parents: Array.isArray(fm.parents) ? fm.parents : [],
		metadata: { sourcePath: epic.path },
	};
}

function readinessScore(item, allItems) {
	const parents = item.parents ?? [];
	const allShipped = parents.every((pid) => {
		const parent = allItems.find((i) => i.id === pid);
		return parent && (parent.status === "shipped" || parent.status === "done");
	});
	if (!allShipped) return null;
	const pri = PRIORITY_ORDER[item.priority] ?? 99;
	const size = SIZE_ORDER[item.size] ?? 99;
	return [pri, size, item.id];
}

export function createSource({
	projectRoot,
	state_dir = "docs/backlog/epics",
} = {}) {
	const epicsDir = join(projectRoot, state_dir);

	return {
		async healthcheck() {
			if (!existsSync(epicsDir)) {
				mkdirSync(epicsDir, { recursive: true });
			}
		},

		async listAvailable(filter = {}) {
			const epics = readEpics(epicsDir).map(toBacklogItem);
			const statuses = filter.statuses ?? [
				"idea",
				"refined",
				"designed",
				"planned",
				"built",
				"tested",
				"reviewed",
			];
			return epics.filter((e) => statuses.includes(e.status));
		},

		async pickNext(_criteria = {}) {
			const epics = readEpics(epicsDir).map(toBacklogItem);
			const candidates = [];
			for (const item of epics) {
				if (item.status === "shipped" || item.status === "done") continue;
				const score = readinessScore(item, epics);
				if (score === null) continue;
				candidates.push({ item, score });
			}
			candidates.sort((a, b) => {
				for (let i = 0; i < a.score.length; i++) {
					if (a.score[i] < b.score[i]) return -1;
					if (a.score[i] > b.score[i]) return 1;
				}
				return 0;
			});
			return candidates[0]?.item ?? null;
		},

		async materialize(item, targetDir) {
			const dir = targetDir ?? epicsDir;
			const expectedPath =
				item.metadata?.sourcePath ??
				join(dir, `${item.id}-${slugify(item.title)}.md`);
			const created = !existsSync(expectedPath);
			if (created) {
				mkdirSync(dir, { recursive: true });
				const stub = `---\nid: ${item.id}\ntitle: ${item.title}\nstatus: idea\npriority: ${item.priority ?? "P2"}\ndomain: ${item.domain ?? "full-stack"}\nowner: claude\nparents: []\nacceptance: []\nsize: ${item.size ?? "medium"}\n---\n\n## Why\n\n${item.description ?? ""}\n`;
				writeFileSync(expectedPath, stub, "utf8");
			}
			return { epicFilePath: expectedPath, created };
		},

		async markStatus(itemId, status) {
			const epics = readEpics(epicsDir);
			const target = epics.find((e) => e.fm.id === itemId);
			if (!target) return;
			const updated = target.content.replace(
				/^status:\s*\S+/m,
				`status: ${status}`,
			);
			if (updated !== target.content)
				writeFileSync(target.path, updated, "utf8");
		},

		async attachPR(itemId, prUrl) {
			const epics = readEpics(epicsDir);
			const target = epics.find((e) => e.fm.id === itemId);
			if (!target) return;
			const link = `- [PR](${prUrl})`;
			let updated = target.content;
			if (/^## Related PRs/m.test(updated)) {
				if (updated.includes(prUrl)) return;
				updated = updated.replace(
					/(## Related PRs[\s\S]*?)(?=\n## |\s*$)/,
					(m) => `${m.replace(/\s+$/, "")}\n${link}\n`,
				);
			} else {
				updated = updated.replace(/\s*$/, `\n\n## Related PRs\n\n${link}\n`);
			}
			writeFileSync(target.path, updated, "utf8");
		},
	};
}

function slugify(s) {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

export default createSource;
