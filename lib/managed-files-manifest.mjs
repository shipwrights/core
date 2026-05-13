// Track which files the @shipwrights/core upgrade flow has rendered into the
// consumer's project, and the hash of each rendered output. The manifest lets
// `/shipwrights-upgrade` distinguish three cases for any managed file:
//
//   1. File doesn't exist           → safe to write.
//   2. File exists, hash matches what we last wrote → safe to overwrite (the
//      user hasn't edited since the last refresh).
//   3. File exists but hash differs from what we last wrote, or no entry in the
//      manifest exists at all → user edited (or the file pre-dates plugin
//      management). Refuse to overwrite; tell the user.
//
// Manifest lives at .shipwrights-managed.json at the project root — top-level,
// committed, intentionally outside .shipwrights/ so it isn't swept up by
// gitignore patterns that target the runtime/state directory.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_FILENAME = ".shipwrights-managed.json";
const MANIFEST_VERSION = 1;

/**
 * The set of plugin-shipped template files that /shipwrights-upgrade may
 * refresh against the consumer's repo. Kept in one place so init and
 * upgrade agree on which paths are "managed" and need manifest tracking.
 *
 * Relative paths under `templates/` in the plugin. The destination in the
 * consumer's repo is the same path with `github/` mapping to `.github/`.
 */
export const MANAGED_TEMPLATE_RELS = [
	"github/workflows/auto-merge-low-tier.yml",
	"github/workflows/post-merge-doc-update.yml",
	"scripts/shipwrights/bundle-on-failure.mjs",
	"scripts/shipwrights/create-scratch.mjs",
	"scripts/shipwrights/integrate-scratch.mjs",
	"scripts/shipwrights/update-epic-after-merge.mjs",
	"scripts/shipwrights/verify-specialist-scope.mjs",
];

export function templateDestPath(rel, projectRoot) {
	const normalized = rel.replace(/\\/g, "/").replace(/^github\//, ".github/");
	return resolve(projectRoot, normalized);
}

export function manifestPath(projectRoot) {
	return resolve(projectRoot, MANIFEST_FILENAME);
}

export function readManifest(projectRoot) {
	const path = manifestPath(projectRoot);
	if (!existsSync(path)) {
		return { _comment: comment(), version: MANIFEST_VERSION, files: {} };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed.version !== MANIFEST_VERSION) {
			// Unknown future version — treat as empty rather than blow up.
			return { _comment: comment(), version: MANIFEST_VERSION, files: {} };
		}
		return {
			_comment: parsed._comment ?? comment(),
			version: MANIFEST_VERSION,
			files: parsed.files ?? {},
		};
	} catch {
		// Malformed — treat as empty. The user can git-revert if they care.
		return { _comment: comment(), version: MANIFEST_VERSION, files: {} };
	}
}

export function writeManifest(projectRoot, manifest) {
	const path = manifestPath(projectRoot);
	const out = {
		_comment: comment(),
		version: MANIFEST_VERSION,
		files: manifest.files ?? {},
	};
	writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, "utf8");
}

export function hashContent(content) {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * Decide what to do with a single managed file, given the rendered content
 * the plugin wants to write, the current state on disk, and what the manifest
 * recorded the last time we wrote this file.
 *
 * Returns one of:
 *   { action: "write", renderedHash }
 *   { action: "skip", reason: "unchanged", renderedHash }
 *   { action: "skip", reason: "user-edited", manifestHash, currentHash, renderedHash }
 *   { action: "skip", reason: "preexisting", currentHash, renderedHash }
 */
export function decideFileAction({ destPath, rendered, manifestHashForKey }) {
	const renderedHash = hashContent(rendered);
	if (!existsSync(destPath)) {
		return { action: "write", renderedHash };
	}
	const currentContent = readFileSync(destPath, "utf8");
	const currentHash = hashContent(currentContent);
	if (currentHash === renderedHash) {
		return { action: "skip", reason: "unchanged", renderedHash };
	}
	if (!manifestHashForKey) {
		return {
			action: "skip",
			reason: "preexisting",
			currentHash,
			renderedHash,
		};
	}
	if (manifestHashForKey !== currentHash) {
		return {
			action: "skip",
			reason: "user-edited",
			manifestHash: manifestHashForKey,
			currentHash,
			renderedHash,
		};
	}
	// File matches what we last wrote — user hasn't touched it, safe to refresh.
	return { action: "write", renderedHash };
}

// ----- helpers -----

function comment() {
	return (
		"Managed by @shipwrights/core. Tracks the hash of each rendered template " +
		"at last upgrade. Commit this file. Editing it manually breaks change " +
		"detection — let /shipwrights-upgrade maintain it."
	);
}
