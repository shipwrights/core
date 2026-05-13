// Spec state machine.
//
// Status transitions are validated here. Invalid transitions throw — the
// frontmatter is the only source of truth for current state, but moves
// between states must follow the graph.

const TRANSITIONS = {
	drafted: ["approved", "drafted", "cancelled"], // drafted → drafted on revise (with counter bump)
	approved: ["building", "cancelled"],
	building: ["integrated", "cancelled"],
	integrated: ["tested"],
	tested: ["reviewed"],
	reviewed: ["ready-for-human-review"],
	"ready-for-human-review": ["shipped", "cancelled"],
	shipped: [],
	cancelled: [],
};

export function assertValidTransition(from, to) {
	const allowed = TRANSITIONS[from] ?? [];
	if (!allowed.includes(to)) {
		throw new Error(
			`Invalid spec transition: ${from} → ${to}. Allowed from "${from}": ${
				allowed.length === 0 ? "(none — terminal state)" : allowed.join(", ")
			}`,
		);
	}
}

export function isTerminal(status) {
	return TRANSITIONS[status]?.length === 0;
}

export function statusesBefore(target) {
	// Topological depth from drafted to target. Used by /shipwrights-spec-cancel
	// to decide whether cancellation is still safe (only before "building").
	const order = [
		"drafted",
		"approved",
		"building",
		"integrated",
		"tested",
		"reviewed",
		"ready-for-human-review",
		"shipped",
	];
	return order.slice(0, order.indexOf(target));
}

export function canCancel(status) {
	// Safe to cancel before code has been written to a branch.
	// After "approved", scratch branches may exist — cancel still works but
	// the caller should clean them up.
	return status !== "shipped" && status !== "cancelled";
}
