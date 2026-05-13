// Context manifest for /shipwrights-spec.
//
// During the discover stage, an agent reads files from the consumer's
// repo and emits a manifest. The manifest is the contract: subsequent
// stages (spec, analyze, plan) may only cite paths that appear here.
//
// Format: JSON at .shipwrights/specs/<S-id>.manifest.json
//
// {
//   "spec_id": "S-2026-05-12-a8f3",
//   "generated_at": "2026-05-12T...",
//   "task_input": "<one-line summary>",
//   "files": [
//     { "path": "apps/api/src/auth/login.ts", "ranges": ["1-184"] },
//     ...
//   ],
//   "observations": [
//     "error envelope: { code, message, details? } at apps/api/src/lib/errors.ts:12",
//     ...
//   ]
// }
//
// The strict enforcement mode walks the plan document for citation-like
// references (path:line, path:start-end, or bare path) and refuses to
// proceed past Stage 4 (plan) unless every cited path is present in the
// manifest's `files` list. Loose mode warns but does not block.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Citation pattern. Matches a path like `apps/api/src/foo.ts` optionally
// followed by `:42` or `:1-184`. The boundary excludes word chars / `/`
// / `-` so we don't match in the middle of a longer identifier, but
// allows `.` after the extension so sentence-ending periods don't block
// matches (common case: "...at apps/foo.ts.").
const CITATION_PATTERN =
  /(?<![\w./-])([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|md|mdx|json|yml|yaml|go|py|rb|java|rs|cs|html|css|sql))(?::(\d+(?:-\d+)?))?(?![\w/-])/g;

// Plan-document sections whose contents are subject to citation enforcement.
// Other sections (Task, User journey, Test plan, Risks) are prose and not
// gated.
const ENFORCED_SECTIONS = [
  "## Codebase analysis",
  "## Architecture",
  "## Endpoint",
  "## Endpoints",
];

export function manifestPath(projectRoot, specId) {
  return join(projectRoot, ".shipwrights", "specs", `${specId}.manifest.json`);
}

export function writeManifest(projectRoot, specId, manifest) {
  const path = manifestPath(projectRoot, specId);
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    spec_id: specId,
    generated_at: new Date().toISOString(),
    ...manifest,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

export function readManifest(projectRoot, specId) {
  const path = manifestPath(projectRoot, specId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Extract citations from a chunk of markdown. Returns an array of
 * { path, range?, snippet } found within the enforced sections.
 */
export function extractCitations(planMarkdown) {
  const sections = splitSections(planMarkdown);
  const citations = [];
  for (const heading of ENFORCED_SECTIONS) {
    const body = sections[heading];
    if (!body) continue;
    let match;
    while ((match = CITATION_PATTERN.exec(body)) !== null) {
      citations.push({
        path: match[1],
        range: match[2] ?? null,
        section: heading,
      });
    }
    CITATION_PATTERN.lastIndex = 0;
  }
  return citations;
}

function splitSections(markdown) {
  const sections = {};
  const lines = markdown.split(/\r?\n/);
  let currentHeading = null;
  let buffer = [];
  for (const line of lines) {
    const headingMatch = line.match(/^## .+$/);
    if (headingMatch) {
      if (currentHeading) sections[currentHeading] = buffer.join("\n");
      currentHeading = line.trim();
      buffer = [];
    } else if (currentHeading) {
      buffer.push(line);
    }
  }
  if (currentHeading) sections[currentHeading] = buffer.join("\n");
  return sections;
}

/**
 * Validate that every citation in `planMarkdown` resolves to a file in
 * the manifest. Returns { ok, violations } — violations is a list of
 * citations whose path is not in the manifest.
 *
 * @param {string} planMarkdown
 * @param {{ files: Array<{path: string}> }} manifest
 */
export function validateCitations(planMarkdown, manifest) {
  const citations = extractCitations(planMarkdown);
  const knownPaths = new Set((manifest.files ?? []).map((f) => f.path));
  const violations = citations.filter((c) => !knownPaths.has(c.path));
  return { ok: violations.length === 0, citations, violations };
}
