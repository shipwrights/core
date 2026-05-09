#!/usr/bin/env node
// Append the merged PR link to the matching epic's `## Related PRs` section.
// Used by the post-merge GitHub Actions workflow to keep epic files current
// without manual edits.
//
// Env: PR_NUMBER, PR_TITLE, PR_URL, EPICS_DIR (optional, defaults to
// docs/backlog/epics).

import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const epicsDir = process.env.EPICS_DIR ?? "docs/backlog/epics";
const prNumber = process.env.PR_NUMBER;
const prTitle = process.env.PR_TITLE;
const prUrl = process.env.PR_URL;

if (!prNumber || !prTitle || !prUrl) {
  console.error("missing required env: PR_NUMBER, PR_TITLE, PR_URL");
  process.exit(2);
}

const conventionalCommit =
  /^(?:feat|fix|chore|refactor|test|docs|perf|build|ci|style|revert)\(([a-z0-9-]+)\):/i;
const titleMatch = prTitle.match(conventionalCommit);
const scope = titleMatch?.[1]?.toLowerCase();

if (!scope || scope === "ops") {
  console.log("no actionable scope — skipping");
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
  console.log(`no epic with id matching "${scope}" — skipping`);
  process.exit(0);
}

let updated = matched.content;
const link = `- [PR #${prNumber}](${prUrl}) - \`${prTitle}\``;

if (updated.includes(`/pull/${prNumber})`)) {
  console.log(`PR #${prNumber} already recorded — no change`);
  process.exit(0);
}

const sectionRegex = /(\r?\n)## Related PRs\r?\n[\s\S]*?(?=\r?\n## |\s*$)/;
const sectionMatch = updated.match(sectionRegex);
if (sectionMatch) {
  const trimmed = sectionMatch[0].replace(/\s+$/, "");
  updated = updated.replace(sectionMatch[0], `${trimmed}\n${link}\n`);
} else {
  const trailing = updated.endsWith("\n") ? "" : "\n";
  updated = `${updated}${trailing}\n## Related PRs\n\n${link}\n`;
}

if (updated === matched.content) {
  console.log("no changes needed");
  process.exit(0);
}

writeFileSync(matched.path, updated, "utf8");
const changedFile = `${epicsDir}/${matched.name}`;
console.log(`updated ${changedFile}`);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `changed_file=${changedFile}\n`);
