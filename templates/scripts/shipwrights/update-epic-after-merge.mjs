#!/usr/bin/env node
// Append the merged PR link to the matching epic's `## Related PRs` section,
// mark the epic shipped, and release its in-flight register row.
//
// Env: PR_NUMBER, PR_TITLE, PR_URL, PR_HEAD_REF, EPICS_DIR (optional, defaults
// to docs/backlog/epics), IN_FLIGHT_PATH (optional, defaults to
// docs/process/in-flight.md).

import {
	appendFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const epicsDir = process.env.EPICS_DIR ?? "docs/backlog/epics";
const prNumber = process.env.PR_NUMBER;
const prTitle = process.env.PR_TITLE;
const prUrl = process.env.PR_URL;
const prHeadRef = process.env.PR_HEAD_REF;
const inFlightPath = process.env.IN_FLIGHT_PATH ?? "docs/process/in-flight.md";

if (!prNumber || !prTitle || !prUrl) {
	console.error("missing required env: PR_NUMBER, PR_TITLE, PR_URL");
	process.exit(2);
}

const conventionalCommit =
	/^(?:feat|fix|chore|refactor|test|docs|perf|build|ci|style|revert)\(([a-z0-9-]+)\):/i;
const titleMatch = prTitle.match(conventionalCommit);
const scope = titleMatch?.[1]?.toLowerCase();

if (!scope || scope === "ops") {
	console.log("no actionable scope - skipping");
	process.exit(0);
}

function parseFrontmatter(content) {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
	if (!match) return null;
	const fm = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		fm[kv[1]] = kv[2].trim();
	}
	return fm;
}

const candidates = readdirSync(epicsDir)
	.filter((n) => n.endsWith(".md") && n !== "README.md")
	.map((n) => {
		const path = join(epicsDir, n);
		const content = readFileSync(path, "utf8");
		return { name: n, path, content, fm: parseFrontmatter(content) };
	})
	.filter((c) => c.fm);

const matched = candidates.find((c) => c.fm.id?.toLowerCase() === scope);
if (!matched) {
	console.log(`no epic with id matching "${scope}" - skipping`);
	process.exit(0);
}

const changedFiles = new Set();
let updated = matched.content;
const link = `- [PR #${prNumber}](${prUrl}) - \`${prTitle}\``;

if (/^status:\s*\S+/m.test(updated)) {
	updated = updated.replace(/^status:\s*\S+/m, "status: shipped");
}

if (updated.includes(prUrl)) {
	console.log(`PR ${prUrl} already recorded`);
} else {
	const sectionRegex = /(\r?\n)## Related PRs\r?\n[\s\S]*?(?=\r?\n## |\s*$)/;
	const sectionMatch = updated.match(sectionRegex);
	if (sectionMatch) {
		const trimmed = sectionMatch[0].replace(/\s+$/, "");
		updated = updated.replace(sectionMatch[0], `${trimmed}\n${link}\n`);
	} else {
		const trailing = updated.endsWith("\n") ? "" : "\n";
		updated = `${updated}${trailing}\n## Related PRs\n\n${link}\n`;
	}
}

if (updated !== matched.content) {
	writeFileSync(matched.path, updated, "utf8");
	changedFiles.add(`${epicsDir}/${matched.name}`);
	console.log(`updated ${epicsDir}/${matched.name}`);
}

if (
	releaseInFlight({
		path: inFlightPath,
		branch: prHeadRef,
		epicId: matched.fm.id,
	})
) {
	changedFiles.add(inFlightPath);
	console.log(`released ${matched.fm.id} from ${inFlightPath}`);
}

if (changedFiles.size === 0) {
	console.log("no changes needed");
	process.exit(0);
}

const out = process.env.GITHUB_OUTPUT;
if (out) {
	const files = [...changedFiles];
	appendFileSync(out, `changed_file=${files[0]}\n`);
	appendFileSync(out, `changed_files=${files.join(" ")}\n`);
}

function releaseInFlight({ path, branch, epicId }) {
	if (!existsSync(path)) return false;
	const text = readFileSync(path, "utf8");
	const rows = [];
	let removed = false;
	for (const line of text.split(/\r?\n/)) {
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((s) => s.trim());
		if (cells.length < 6 || cells[0] === "Branch" || cells[0].startsWith("---"))
			continue;
		const [rowBranch, rowEpic, stage, tier, specialists, updatedAt] = cells;
		const matchesBranch = branch && rowBranch === branch;
		const matchesEpic =
			!branch && rowEpic.toLowerCase() === epicId.toLowerCase();
		if (matchesBranch || matchesEpic) {
			removed = true;
			continue;
		}
		rows.push({
			branch: rowBranch,
			epic: rowEpic,
			stage,
			tier,
			specialists,
			updatedAt,
		});
	}

	if (!removed) return false;

	const header = `# In-flight branches

| Branch | Epic | Stage | Tier | Active specialists | Updated |
|---|---|---|---|---|---|`;
	const body = rows
		.map(
			(row) =>
				`| ${row.branch} | ${row.epic} | ${row.stage} | ${row.tier} | ${row.specialists || "-"} | ${row.updatedAt} |`,
		)
		.join("\n");
	const next =
		rows.length > 0
			? `${header}\n${body}\n`
			: "# In-flight branches\n\n_(none currently in flight)_\n";
	if (next !== text) writeFileSync(path, next, "utf8");
	return next !== text;
}
