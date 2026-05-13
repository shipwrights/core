import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	clearLoop,
	markCurrentCompleted,
	PHASES,
	readState,
	STATE_FILE,
	startLoop,
	transitionPhase,
	writeState,
} from "../lib/loop-state.mjs";

function makeTmp() {
	return mkdtempSync(join(tmpdir(), "shipwrights-loop-state-"));
}

test("startLoop writes a fresh state file with phase=between_epics", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd, max_iterations: 5 });
		assert.equal(state.phase, "between_epics");
		assert.equal(state.iteration_count, 0);
		assert.equal(state.max_iterations, 5);
		assert.deepEqual(state.completed, []);
		assert.equal(state.current, null);
		assert.ok(existsSync(resolve(cwd, STATE_FILE)));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("startLoop accepts max_iterations=null for unbounded loops", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd, max_iterations: null });
		assert.equal(state.max_iterations, null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("readState returns null when no state file exists", () => {
	const cwd = makeTmp();
	try {
		assert.equal(readState({ cwd }), null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("readState round-trips through writeState", () => {
	const cwd = makeTmp();
	try {
		startLoop({ cwd, max_iterations: 3 });
		const state = readState({ cwd });
		state.current = { ticket: "NVC-150", pr: 123, branch: "feature/nvc-150" };
		writeState(state, { cwd });
		const reloaded = readState({ cwd });
		assert.deepEqual(reloaded.current, state.current);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("readState throws on malformed JSON with a recoverable message", () => {
	const cwd = makeTmp();
	try {
		mkdirSync(resolve(cwd, ".shipwrights"), { recursive: true });
		writeFileSync(resolve(cwd, STATE_FILE), "{not json", "utf8");
		assert.throws(() => readState({ cwd }), /malformed.*--abort/i);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("transitionPhase: between_epics → running_epic is allowed", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd });
		const next = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "NVC-150" } },
			{ cwd },
		);
		assert.equal(next.phase, "running_epic");
		assert.equal(next.current.ticket, "NVC-150");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("transitionPhase: running_epic → awaiting_merge is allowed", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd });
		state = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "X" } },
			{ cwd },
		);
		state = transitionPhase(
			state,
			"awaiting_merge",
			{ current: { ...state.current, pr: 9 } },
			{ cwd },
		);
		assert.equal(state.phase, "awaiting_merge");
		assert.equal(state.current.pr, 9);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("transitionPhase: rejects invalid transitions (between_epics → awaiting_merge)", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd });
		assert.throws(
			() => transitionPhase(state, "awaiting_merge", {}, { cwd }),
			/Invalid transition: between_epics → awaiting_merge/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("transitionPhase: done is terminal", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd });
		state = transitionPhase(state, "done", {}, { cwd });
		assert.throws(
			() => transitionPhase(state, "between_epics", {}, { cwd }),
			/Invalid transition: done/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("markCurrentCompleted bumps counter + moves to between_epics", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd, max_iterations: 3 });
		state = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "NVC-1" } },
			{ cwd },
		);
		state = transitionPhase(
			state,
			"awaiting_merge",
			{ current: { ...state.current, pr: 1 } },
			{ cwd },
		);
		state = markCurrentCompleted(state, { cwd });
		assert.equal(state.phase, "between_epics");
		assert.equal(state.iteration_count, 1);
		assert.deepEqual(state.completed, ["NVC-1"]);
		assert.equal(state.current, null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("markCurrentCompleted at max_iterations moves to done", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd, max_iterations: 1 });
		state = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "NVC-1" } },
			{ cwd },
		);
		state = transitionPhase(
			state,
			"awaiting_merge",
			{ current: state.current },
			{ cwd },
		);
		state = markCurrentCompleted(state, { cwd });
		assert.equal(state.phase, "done");
		assert.equal(state.iteration_count, 1);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("markCurrentCompleted in unbounded loop never moves to done", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd, max_iterations: null });
		for (let i = 0; i < 5; i++) {
			state = transitionPhase(
				state,
				"running_epic",
				{ current: { ticket: `NVC-${i}` } },
				{ cwd },
			);
			state = transitionPhase(
				state,
				"awaiting_merge",
				{ current: state.current },
				{ cwd },
			);
			state = markCurrentCompleted(state, { cwd });
		}
		assert.equal(state.iteration_count, 5);
		assert.equal(state.phase, "between_epics");
		assert.equal(state.completed.length, 5);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("markCurrentCompleted throws when there's no current ticket", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd });
		assert.throws(
			() => markCurrentCompleted(state, { cwd }),
			/no current ticket/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("clearLoop removes the state file", () => {
	const cwd = makeTmp();
	try {
		startLoop({ cwd });
		assert.ok(existsSync(resolve(cwd, STATE_FILE)));
		clearLoop({ cwd });
		assert.ok(!existsSync(resolve(cwd, STATE_FILE)));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("clearLoop is a no-op when no state file exists", () => {
	const cwd = makeTmp();
	try {
		clearLoop({ cwd }); // should not throw
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("PHASES is the exhaustive enum", () => {
	assert.deepEqual(PHASES, [
		"between_epics",
		"running_epic",
		"awaiting_merge",
		"done",
	]);
});

// ---------- auto-merge confirmation field ----------

test("startLoop defaults auto_merge_confirmed to false", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd });
		assert.equal(state.auto_merge_confirmed, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("startLoop accepts auto_merge_confirmed=true and persists it", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd, auto_merge_confirmed: true });
		assert.equal(state.auto_merge_confirmed, true);
		const reloaded = readState({ cwd });
		assert.equal(reloaded.auto_merge_confirmed, true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("startLoop coerces truthy non-boolean to false (defence in depth)", () => {
	const cwd = makeTmp();
	try {
		const state = startLoop({ cwd, auto_merge_confirmed: "yes" });
		assert.equal(state.auto_merge_confirmed, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("auto_merge_confirmed persists through transitionPhase", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd, auto_merge_confirmed: true });
		state = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "X" } },
			{ cwd },
		);
		assert.equal(state.auto_merge_confirmed, true);
		state = transitionPhase(
			state,
			"awaiting_merge",
			{ current: state.current },
			{ cwd },
		);
		assert.equal(state.auto_merge_confirmed, true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("auto_merge_confirmed persists through markCurrentCompleted", () => {
	const cwd = makeTmp();
	try {
		let state = startLoop({ cwd, auto_merge_confirmed: true });
		state = transitionPhase(
			state,
			"running_epic",
			{ current: { ticket: "X" } },
			{ cwd },
		);
		state = transitionPhase(
			state,
			"awaiting_merge",
			{ current: state.current },
			{ cwd },
		);
		state = markCurrentCompleted(state, { cwd });
		assert.equal(
			state.auto_merge_confirmed,
			true,
			"confirmation should survive a completed iteration",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("readState rejects state with non-boolean auto_merge_confirmed", () => {
	const cwd = makeTmp();
	try {
		mkdirSync(resolve(cwd, ".shipwrights"), { recursive: true });
		writeFileSync(
			resolve(cwd, STATE_FILE),
			JSON.stringify({
				version: 1,
				phase: "between_epics",
				iteration_count: 0,
				completed: [],
				current: null,
				auto_merge_confirmed: "true", // string, not boolean
			}),
			"utf8",
		);
		assert.throws(
			() => readState({ cwd }),
			/auto_merge_confirmed must be boolean/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
