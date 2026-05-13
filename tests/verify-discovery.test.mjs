import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverVerifications } from "../lib/verify-discovery.mjs";

function makeTmp() {
	return mkdtempSync(join(tmpdir(), "shipwright-test-"));
}

test("detects pnpm + scripts", () => {
	const dir = makeTmp();
	writeFileSync(join(dir, "pnpm-lock.yaml"), "");
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "x",
			scripts: {
				verify: "pnpm verify",
				lint: "biome lint",
				typecheck: "tsc --noEmit",
			},
		}),
	);
	const r = discoverVerifications(dir);
	assert.equal(r.ecosystem, "node-pnpm");
	assert.equal(r.verify, "pnpm verify");
	assert.equal(r.lint, "pnpm lint");
	assert.equal(r.typecheck, "pnpm typecheck");
	rmSync(dir, { recursive: true, force: true });
});

test("detects go.mod", () => {
	const dir = makeTmp();
	writeFileSync(join(dir, "go.mod"), "module example.com/x\n");
	writeFileSync(join(dir, "main.go"), "package main\n");
	const r = discoverVerifications(dir);
	assert.equal(r.ecosystem, "go");
	assert.equal(r.test, "go test ./...");
	assert.match(r.verify, /go test/);
	rmSync(dir, { recursive: true, force: true });
});

test("falls back gracefully with no manifests", () => {
	const dir = makeTmp();
	const r = discoverVerifications(dir);
	assert.equal(r.verify, null);
	assert.ok(r.notes.some((n) => n.includes("no verify command")));
	rmSync(dir, { recursive: true, force: true });
});
