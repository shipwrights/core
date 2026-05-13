import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { importFromPath } from "../lib/import-from-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Regression test for the Windows bug where `await import("D:\\...")` throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME because ESM requires a file:// URL. Loading
// a real bundled module via an absolute filesystem path proves the path →
// file URL conversion happened correctly on whatever platform CI runs on.
test("importFromPath loads a module from an absolute filesystem path", async () => {
	const absolutePath = resolve(here, "../guards/file-length.mjs");
	const mod = await importFromPath(absolutePath);
	assert.ok(typeof mod.run === "function" || typeof mod.default === "function");
});

test("importFromPath handles a Windows-style drive-letter path", async () => {
	if (process.platform !== "win32") return; // assertion only meaningful on Windows
	const absolutePath = resolve(here, "../guards/file-length.mjs");
	assert.match(absolutePath, /^[A-Z]:\\/i, "should look like a Windows path");
	const mod = await importFromPath(absolutePath);
	assert.ok(mod);
});
