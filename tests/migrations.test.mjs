import assert from "node:assert/strict";
import { test } from "node:test";
import { listMigrations, runMigrations } from "../lib/migrations.mjs";

test("listMigrations returns an array (may be empty in v0.1)", () => {
	const list = listMigrations();
	assert.ok(Array.isArray(list));
});

test("same-version is a no-op", async () => {
	const config = { version: 1, foo: "bar" };
	const out = await runMigrations(config, 1, 1);
	assert.deepEqual(out, config);
});

test("backward migration is rejected", async () => {
	await assert.rejects(
		() => runMigrations({ version: 5 }, 5, 3),
		/Cannot migrate config backwards/,
	);
});

test("missing chain step throws when no migrations file", async () => {
	// With no migrations registered (v0.1 ships none), going from 1 to 2 should
	// fail with "No migration found from v1 to v2".
	const list = listMigrations();
	if (list.some((m) => m.from === 1 && m.to === 2)) {
		return; // skip — a real migration exists
	}
	await assert.rejects(
		() => runMigrations({ version: 1 }, 1, 2),
		/No migration found from v1 to v2/,
	);
});
