---
name: shipwrights-loop
description: Drive multiple Jira tickets sequentially through the /shipwrights-epic pipeline. Auto-picks the next ticket, watches the PR until merged, transitions Jira to shipped, repeats. Resumable across Claude Code sessions via .shipwrights/loop-state.json. Invoked as /shipwrights-loop [N] | --status | --abort.
---

# /shipwrights-loop — sequential multi-ticket pipeline driver

Composes `/shipwrights-epic` end-to-end across N tickets. Picks one, drives it through the pipeline, watches the PR for merge, hands off Jira status, picks the next.

**Not autopilot.** Each PR still goes through whatever review gate is configured (human or `tier:*` auto-merge label). The loop *watches* — it doesn't merge.

## Inputs

- `/shipwrights-loop [N]` — start a new loop or resume an existing one. `N` = max iterations. Omit for unbounded (a confirmation prompt fires first).
- `/shipwrights-loop --status` — print current loop state, do nothing else.
- `/shipwrights-loop --abort` — discard `.shipwrights/loop-state.json`, cancel any in-progress polling.

## State machine

State lives in `.shipwrights/loop-state.json` (gitignored). Read/write via `lib/loop-state.mjs`. Phases:

| Phase | Meaning |
|---|---|
| `between_epics` | About to pick a new ticket. Initial state. |
| `running_epic` | `/shipwrights-epic` is mid-pipeline. Per-epic progress lives in the epic file's frontmatter + the in-flight register, not here. |
| `awaiting_merge` | PR opened, polling `gh pr view <num>` for `MERGED`. |
| `done` | Terminal. Either iteration cap hit, backlog empty, or user aborted. |

Valid transitions:
- `between_epics → running_epic | done`
- `running_epic → awaiting_merge | between_epics | done`
- `awaiting_merge → between_epics | done`

## Auto-merge warning

When `loop.auto_merge: true` in `.shipwrights.yml` and the loop is starting fresh, print this verbatim before the typed-confirmation prompt. Don't reword it — the wording is the safety mechanism.

```
⚠ AUTO-MERGE ENABLED

With this turned on, /shipwrights-loop will MERGE pull requests itself.

Every PR opened during this loop will be merged automatically once your
required CI checks pass. No human review. No manual gate.

This means:
  • Code reaches your integration branch without a human reading it
  • Branch-protection rules still apply (required checks, required
    reviewers if configured)
  • Cost-cap and stuck-PR safeguards still apply
  • The `do-not-auto-merge` label on a specific PR still skips auto-merge
    for it
  • Once you confirm, this loop runs unattended until done, aborted,
    a PR is declined, or a safeguard fires

To confirm, type exactly:    yes auto-merge

To cancel, type anything else.
```

The user must type the literal string `yes auto-merge`. Anything else — including `yes`, `y`, blank, hitting enter on a default — cancels.

If they cancel, do **not** start the loop. Print: "Auto-merge not confirmed. Loop did not start. Either re-run and confirm, or set `loop.auto_merge: false` in `.shipwrights.yml`."

## Workflow

### Entry: resume-or-start

1. Load existing state via `readState()`. If a state file is present, you're resuming. Skip straight to the appropriate phase; do **not** re-prompt for iteration count or re-show the auto-merge warning — the user already opted in for *this* loop.
2. Print a one-line resume summary so the user sees where they're picking up.
3. If no state file → ask: how many iterations?
   - If user passed `N`: use it.
   - If user passed nothing: print the summary (current candidate count, telemetry budget, intrinsic stops) and ask "Run unbounded? [Y/n]". `Y` → `max_iterations: null`. `n` → ask for a number.
4. **Auto-merge confirmation gate.** Read `loop.auto_merge` from `.shipwrights.yml`. If `true`:
   - Print the warning verbatim (see "Auto-merge warning" section below).
   - Read a single line from stdin via Bash (`read -r ANSWER < /dev/tty` on POSIX; on Windows, use AskUserQuestion with no default option — force a typed answer).
   - Compare exactly to `yes auto-merge` (case-sensitive). Any other input → abort the loop start, print "Auto-merge not confirmed. Loop did not start. Either re-run and confirm, or set `loop.auto_merge: false` in `.shipwrights.yml`."
   - On confirmation, set `state.auto_merge_confirmed = true` *before* writing the initial state.
5. Call `startLoop({ max_iterations, auto_merge_confirmed })` to write the initial state.

### Per-iteration loop

While `state.phase !== "done"`:

#### Phase: between_epics

1. Run `gh auth status` once per loop start. Fail fast if not authenticated.
2. Check telemetry budget. If total spend across this loop exceeds `telemetry.budget_per_epic_tokens × max_iterations`, transition to `done` and tell the user.
3. Call `npx @shipwrights/source-jira pick` to find the next ticket. Parse the id + assignee.
4. **Assignee safety check:** if the ticket is assigned to someone *other than the authenticated user*, pause and ask via AskUserQuestion:
   - "y — work on it anyway"
   - "n — skip and pick the next"
   - "a — abort the loop"
5. **Empty-backlog fallback:** if `pick` returns `(no candidates)`, run a relaxed query (drop the assignee filter via a custom JQL) and show up to 10 unassigned tickets. Ask the user to pick one or several to take. For each picked ticket:
   - Call `node -e "import('@shipwrights/source-jira').then(m => m.createSource({...config}).assignToCurrentUser('<KEY>'))"` to self-assign.
   - Add to the candidate queue.
   If the user picks none, transition to `done`.
6. Transition to `running_epic` with `state.current = { ticket: "<KEY>", started_at: <ts> }`.

#### Phase: running_epic

1. Invoke `/shipwrights-epic <KEY>` via Skill. The skill drives the full pipeline.
2. When the skill returns, locate the PR it opened: `gh pr list --author "@me" --head <branch> --json number,url -t '{{(index . 0).number}} {{(index . 0).url}}'`.
3. Update `state.current = { ...state.current, pr: <num>, prUrl: <url>, branch: <branch> }`.
4. Transition to `awaiting_merge`.

If `/shipwrights-epic` errors or returns "already running" (resume case): inspect the epic file's frontmatter status. If `status` is past `built`, assume the PR was opened previously — find it via `gh pr list --head <branch>` and skip to `awaiting_merge`.

#### Phase: awaiting_merge

1. **One-time auto-merge action.** On entry to this phase (not on every poll), if `state.auto_merge_confirmed === true` AND `state.current.auto_merge_requested !== true`:
   - Inspect PR labels: `gh pr view <num> --json labels --jq '[.labels[].name]'`.
   - If `do-not-auto-merge` is **not** present, call `gh pr merge <num> --auto --squash` (or whichever strategy is in `merge.strategy`). The `--auto` flag tells GitHub to merge once required checks pass — branch-protection rules are still enforced.
   - Set `state.current.auto_merge_requested = true` and persist. This idempotency flag prevents re-issuing the merge call on resume.
   - If `gh pr merge` fails (insufficient permissions, branch protection rejects, etc.), surface the error and pause the loop with options: skip / abort.
2. Poll `gh pr view <num> --json state,mergedAt --jq '.state'` every `loop.poll_interval_seconds` (default 30).
   - Use `Bash` with `run_in_background: false` for each poll (so you can react). Add a short Bash sleep between polls — total budget cap at `loop.stuck_pr_hours` (default 24h) elapsed.
3. Branch on state:
   - **MERGED** → call:
     - `npx @shipwrights/source-jira` programmatic surface to `markStatus("<KEY>", "shipped")` and `attachPR("<KEY>", "<prUrl>")`. (Use `node -e "..."` driving createSource for both.)
     - Call `markCurrentCompleted(state)`. This transitions to `between_epics` (or `done` if cap hit).
   - **CLOSED** (no merge) — PR was declined/closed. Pause and ask:
     - "Continue with next ticket [c] / abort the loop [a]"
   - **OPEN** + `do-not-auto-merge` label present → keep polling silently. (Auto-merge was skipped at step 1 by the same check.)
   - **OPEN** longer than `loop.stuck_pr_hours` with no progress → escalate. Pause, ask user.
4. Between polls, write state to disk so the loop is resumable mid-poll if interrupted.

#### Phase: done

1. Print a summary:
   ```
   Loop complete:
     ✓ NVC-150  QuickBooks Integration – Manual Invoice Sync     PR #123 → merged
     ✓ NVC-149  Email reminder buttons                            PR #124 → merged
     ✓ NVC-303  Option for multiple active templates              PR #125 → merged
   
   3 tickets shipped this session. Total tokens: 1.4M (budget 2.5M).
   ```
2. Call `clearLoop()` to remove the state file.

## Flags

### `--status`

Read `.shipwrights/loop-state.json`. If absent → "No loop in progress." If present → dump:
```
Loop status:
  Started:     2026-05-13T17:00:00Z (4h ago)
  Phase:       awaiting_merge
  Current:     NVC-148  ·  PR #124  ·  branch feature/nvc-148-...
  Completed:   ["NVC-150", "NVC-149"]  (2 tickets)
  Cap:         5 iterations (3 remaining)
```

Exit without doing anything else.

### `--abort`

Confirm with AskUserQuestion: "Discard current loop and clear state? Tickets already merged will stay merged."
- yes → call `clearLoop()`. Tell user how to resume by re-running `/shipwrights-loop`.
- no → print state and exit.

## Hard rules

- **Default is opt-in.** The loop *watches* PRs unless `loop.auto_merge: true` is set in `.shipwrights.yml`. With the default config, merging is GitHub's job (auto-merge label workflow) or the human's.
- **Auto-merge requires typed confirmation.** Never proceed past the confirmation gate on anything other than the literal string `yes auto-merge`. No default-accept. No silent enablement.
- **Auto-merge confirmation is per-loop, not per-config.** Setting `auto_merge: true` is the *opt-in*; typing the confirmation is the *acknowledgement*. Both are required, every new loop.
- **`do-not-auto-merge` label always wins.** Even with auto-merge confirmed, a PR carrying the block label is never merged by the loop.
- **One `gh pr merge` call per PR.** The `auto_merge_requested` flag on `state.current` makes this idempotent across resumes.
- **Branch protection is GitHub's job.** `--auto` flag respects required checks and required reviewers. If a check fails or a reviewer declines, the merge never happens, and the existing stuck-PR escalation fires.
- **One commit per markStatus/attachPR.** No batch updates to Jira.
- **Write state on every transition.** If you interrupt mid-poll the file should reflect where you stopped, not where you started.
- **Respect Ctrl-C.** Catch SIGINT cleanly; preserve state. The next invocation should be able to resume.
- **One loop per project.** If `loop-state.json` exists with `phase !== "done"`, refuse to start a new loop; offer `--abort` instead.
- **Token budget hard stop.** If `state.iteration_count > 0` and total telemetry spend ≥ `telemetry.budget_per_epic_tokens × max_iterations`, transition to `done` with a clear "budget exhausted" message.
- **Assignee safety.** Never silently work on someone else's ticket. The safety check fires before each `running_epic` transition.

## Failure modes

| Symptom | Action |
|---|---|
| `gh auth status` fails | Abort before iteration 1 with the gh login command. |
| `.shipwrights/jira.json` missing | Tell user to run `/shipwrights-connect jira` first. |
| `pick` returns 0 candidates and 0 unassigned-fallback | Transition to `done` with "Backlog empty for this scope." |
| `running_epic` errors mid-pipeline | The epic file frontmatter + in-flight register hold the per-epic state. Tell user to fix and re-invoke `/shipwrights-loop` — it'll resume the same epic. |
| `awaiting_merge` poll exceeds 24h | Pause, ask user: continue waiting / abort / skip-and-pick-next. |
| Stale `loop-state.json` from a crashed prior session | On read, detect phase + age. If `running_epic` and the branch doesn't exist remote → reset to `between_epics` with a warning. |

## Why this skill exists

The orchestrator's design is one PR at a time — that's a correctness invariant (stack-depth-1 prevents merge chaos). But "one PR at a time" doesn't mean "one PR per user invocation." A team backlog is dozens of tickets; making the human type `/shipwrights-epic` between each one is the opposite of orchestrated. This skill closes that gap while preserving the invariant: tickets still flow one at a time, but the human only intervenes at exception points (assignee mismatch, declined PR, budget cap, stuck merge).
