import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertValidTransition,
	canCancel,
	isTerminal,
} from "../lib/spec/state-machine.mjs";

test("valid transitions don't throw", () => {
	assertValidTransition("drafted", "approved");
	assertValidTransition("approved", "building");
	assertValidTransition("building", "integrated");
	assertValidTransition("integrated", "tested");
	assertValidTransition("tested", "reviewed");
	assertValidTransition("reviewed", "ready-for-human-review");
	assertValidTransition("ready-for-human-review", "shipped");
});

test("revising stays at drafted", () => {
	// drafted → drafted is allowed (revise loop)
	assertValidTransition("drafted", "drafted");
});

test("cancel is allowed from many states", () => {
	for (const from of [
		"drafted",
		"approved",
		"building",
		"ready-for-human-review",
	]) {
		assertValidTransition(from, "cancelled");
	}
});

test("invalid transitions throw", () => {
	assert.throws(() => assertValidTransition("drafted", "building"));
	assert.throws(() => assertValidTransition("approved", "shipped"));
	assert.throws(() => assertValidTransition("shipped", "drafted"));
});

test("isTerminal", () => {
	assert.equal(isTerminal("shipped"), true);
	assert.equal(isTerminal("cancelled"), true);
	assert.equal(isTerminal("drafted"), false);
	assert.equal(isTerminal("approved"), false);
});

test("canCancel: yes from any non-terminal", () => {
	assert.equal(canCancel("drafted"), true);
	assert.equal(canCancel("building"), true);
	assert.equal(canCancel("shipped"), false);
	assert.equal(canCancel("cancelled"), false);
});
