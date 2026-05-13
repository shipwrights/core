// Persistent state for /shipwrights-loop.
//
// File: .shipwrights/loop-state.json
//
// Phases the state machine can be in:
//   - "between_epics" — about to pick a new ticket
//   - "running_epic"  — /shipwrights-epic is mid-pipeline; per-epic state
//                       lives in the epic file's frontmatter + the in-flight
//                       register, not here
//   - "awaiting_merge" — PR opened, polling gh pr view <num> for MERGED
//   - "done"          — N iterations complete or aborted; safe to delete file
//
// The skill is the orchestrator of these transitions. This module is pure —
// reads, writes, applies transitions, validates shape. No side effects beyond
// the state file itself.

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export const PHASES = Object.freeze([
	"between_epics",
	"running_epic",
	"awaiting_merge",
	"done",
]);

export const STATE_FILE = ".shipwrights/loop-state.json";

/**
 * Initialise a fresh loop state and write it to disk. Pass max_iterations=null
 * for unbounded. Pass auto_merge_confirmed=true ONLY after the user has typed
 * the exact confirmation phrase ("yes auto-merge").
 */
export function startLoop({
	cwd = process.cwd(),
	max_iterations = null,
	auto_merge_confirmed = false,
} = {}) {
	const state = {
		version: 1,
		started_at: new Date().toISOString(),
		max_iterations,
		iteration_count: 0,
		completed: [],
		current: null,
		phase: "between_epics",
		auto_merge_confirmed: auto_merge_confirmed === true,
	};
	writeState(state, { cwd });
	return state;
}

/**
 * Load state from disk. Returns null if the state file doesn't exist.
 */
export function readState({ cwd = process.cwd() } = {}) {
	const path = resolve(cwd, STATE_FILE);
	if (!existsSync(path)) return null;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(
			`${STATE_FILE} exists but is malformed JSON: ${err.message}. ` +
				`Run \`/shipwrights-loop --abort\` to discard and start over.`,
		);
	}
	validate(parsed);
	return parsed;
}

/**
 * Persist state. Always rewrites the file atomically-enough (single write
 * call; no temp-file dance since we don't worry about concurrent writers —
 * the lock is the existence of an in-progress loop).
 */
export function writeState(state, { cwd = process.cwd() } = {}) {
	validate(state);
	const path = resolve(cwd, STATE_FILE);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Move the state into a new phase. Validates that the transition is
 * permitted. Returns the updated state (also persisted).
 */
export function transitionPhase(state, nextPhase, patch = {}, { cwd } = {}) {
	if (!PHASES.includes(nextPhase)) {
		throw new Error(`Invalid phase: ${nextPhase}`);
	}
	if (!isValidTransition(state.phase, nextPhase)) {
		throw new Error(`Invalid transition: ${state.phase} → ${nextPhase}`);
	}
	const next = { ...state, ...patch, phase: nextPhase };
	writeState(next, { cwd });
	return next;
}

/**
 * Mark the current ticket completed and bump the counter. Moves phase to
 * either "between_epics" (more work to do) or "done" (max_iterations hit).
 */
export function markCurrentCompleted(state, { cwd } = {}) {
	if (!state.current) {
		throw new Error("markCurrentCompleted: no current ticket to complete");
	}
	const completed = [...state.completed, state.current.ticket];
	const iteration_count = state.iteration_count + 1;
	const reachedCap =
		state.max_iterations != null && iteration_count >= state.max_iterations;
	const nextPhase = reachedCap ? "done" : "between_epics";
	const next = {
		...state,
		iteration_count,
		completed,
		current: null,
		phase: nextPhase,
	};
	writeState(next, { cwd });
	return next;
}

/**
 * Delete the state file. Called by --abort and after "done" phase.
 */
export function clearLoop({ cwd = process.cwd() } = {}) {
	const path = resolve(cwd, STATE_FILE);
	if (existsSync(path)) {
		rmSync(path, { force: true });
	}
}

// ----- validation -----

function validate(state) {
	if (state == null || typeof state !== "object") {
		throw new Error("loop-state: must be an object");
	}
	if (state.version !== 1) {
		throw new Error(`loop-state: unsupported version ${state.version}`);
	}
	if (!PHASES.includes(state.phase)) {
		throw new Error(`loop-state: invalid phase ${state.phase}`);
	}
	if (typeof state.iteration_count !== "number" || state.iteration_count < 0) {
		throw new Error(
			"loop-state: iteration_count must be a non-negative number",
		);
	}
	if (
		state.max_iterations != null &&
		(typeof state.max_iterations !== "number" || state.max_iterations < 1)
	) {
		throw new Error("loop-state: max_iterations must be null or >= 1");
	}
	if (!Array.isArray(state.completed)) {
		throw new Error("loop-state: completed must be an array");
	}
	if (state.current != null) {
		if (typeof state.current !== "object") {
			throw new Error("loop-state: current must be an object or null");
		}
		if (typeof state.current.ticket !== "string") {
			throw new Error("loop-state: current.ticket must be a string");
		}
	}
	if (
		state.auto_merge_confirmed !== undefined &&
		typeof state.auto_merge_confirmed !== "boolean"
	) {
		throw new Error("loop-state: auto_merge_confirmed must be boolean");
	}
}

function isValidTransition(from, to) {
	const allowed = {
		between_epics: ["running_epic", "done"],
		running_epic: ["awaiting_merge", "between_epics", "done"],
		awaiting_merge: ["between_epics", "done"],
		done: [],
	};
	return allowed[from]?.includes(to) ?? false;
}
