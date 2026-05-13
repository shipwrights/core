// Plan document writer / reader for /shipwrights-spec.
//
// A plan document is the artifact produced by the spec pipeline before
// the human approval gate. It lives at <output_dir>/<id>-<slug>.md
// (default <output_dir> = docs/backlog/specs/).
//
// The document is the source of truth for spec state. Frontmatter status
// transitions drive the pipeline:
//
//   drafted    → the gate has not been crossed; pipeline halted
//   approved   → user accepted; ready to enter build
//   building   → specialists are working
//   integrated → integration stage complete
//   tested     → QA stage complete
//   reviewed   → gatekeeper stage complete
//   ready-for-human-review → PR opened
//   shipped    → PR merged (set by post-merge workflow)
//   cancelled  → user cancelled before approval (or after if no commits made)
//
// Revising a drafted spec increments `revisions`. The previous plan is
// kept under .shipwrights/specs/<id>.r<N>.md for audit.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

export function specFilename(id, slug) {
	return `${id}-${slug}.md`;
}

export function specPath(projectRoot, outputDir, id, slug) {
	return join(projectRoot, outputDir, specFilename(id, slug));
}

export function generateSpecId(date = new Date()) {
	const yyyy = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(date.getUTCDate()).padStart(2, "0");
	const hash = Math.random().toString(36).slice(2, 6);
	return `S-${yyyy}-${mm}-${dd}-${hash}`;
}

export function slugifyTitle(title) {
	return (
		String(title ?? "untitled")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "untitled"
	);
}

/**
 * Write a fresh plan document. Used at Stage 4 (plan).
 */
export function writePlan({ projectRoot, outputDir, id, slug, content }) {
	const path = specPath(projectRoot, outputDir, id, slug);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
	return path;
}

/**
 * Read a plan document and return { frontmatter, body, path } or null.
 */
export function readPlan({ projectRoot, outputDir, id }) {
	const dir = join(projectRoot, outputDir);
	if (!existsSync(dir)) return null;
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(`${id}-`) && entry.endsWith(".md")) {
			const path = join(dir, entry);
			const content = readFileSync(path, "utf8");
			return parsePlan(content, path);
		}
	}
	return null;
}

export function parsePlan(content, path = null) {
	const match = content.match(FRONTMATTER_RE);
	if (!match) {
		return { frontmatter: {}, body: content, path, raw: content };
	}
	const frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		frontmatter[kv[1]] = parseValue(kv[2]);
	}
	const body = content.slice(match[0].length);
	return { frontmatter, body, path, raw: content };
}

function parseValue(raw) {
	const trimmed = raw.trim();
	if (trimmed === "null") return null;
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return trimmed.replace(/^['"]|['"]$/g, "");
}

/**
 * Update a plan document's status. Returns the updated path.
 */
export function setStatus({ projectRoot, outputDir, id, status }) {
	const plan = readPlan({ projectRoot, outputDir, id });
	if (!plan) throw new Error(`No spec at id ${id} under ${outputDir}`);
	const updated = plan.raw.replace(/^status:\s*\S+/m, `status: ${status}`);
	writeFileSync(plan.path, updated, "utf8");
	return plan.path;
}

/**
 * Snapshot the current plan for revision history.
 * Returns the snapshot path.
 */
export function snapshotForRevision({
	projectRoot,
	id,
	revisionNumber,
	content,
}) {
	const dir = join(projectRoot, ".shipwrights", "specs");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.r${revisionNumber}.md`);
	writeFileSync(path, content, "utf8");
	return path;
}
