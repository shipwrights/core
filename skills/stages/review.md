# Stage: review

The gatekeeper agent reviews the integrated feature branch against repo conventions, hard rules, and acceptance criteria. They may make small fix-up commits directly on the feature branch.

Optionally followed by browser-review for UI changes (separate stage prompt — `review-browser.md`, invoked when the integrated diff touches UI surface).

## Skip when

- Tier is `trivial` — no review pass.
- An override `optional_when` evaluates true.

## What you (orchestrator) do

1. **Dispatch the gatekeeper agent.** Hand it:
   - The diff vs integration branch (`git diff <integration>..<feature-branch>`).
   - The refined epic (especially `## Acceptance`).
   - The project's hard rules.
   - The project's repo conventions doc (`<state_dir>/../engineering/*-rules.md` if present).
2. **Receive findings.** Three lists:
   - **Blocks** — must fix before PR is human-ready. Each tied to a hard rule, convention, or acceptance criterion.
   - **Fix-ups applied** — gatekeeper made these commits directly on the feature branch.
   - **Suggestions** — non-blocking improvements for the human reviewer.
3. **For each Block:** dispatch the relevant specialist back to their scratch branch (or, if cleanup happened, branch a new fix scratch off the feature branch) to address it. Re-integrate. Re-run verify.
4. **Loop until no Blocks remain.** Bound the loop at 3 cycles. After 3 cycles, escalate to user — the issue isn't a fix-up class.
5. **Capture Suggestions** for the PR description.
6. **Optional: browser review.** If the integrated diff touched UI surface, dispatch the browser-reviewer next (separate stage skill: `review-browser.md`). Their findings go to the same Blocks/Fix-ups/Suggestions categorization.
7. **Bump epic `status:` to `reviewed`** when no Blocks remain.

## Fix-up commits by gatekeeper

Gatekeeper has Edit access (no Write, no Bash) and may make ≤5-line fix-ups directly on the feature branch. They commit themselves with a clear message: `chore(<scope>): fix-up review notes`. You don't dispatch the orchestrator to apply these.

Anything bigger than fix-up scope, the gatekeeper escalates back to the relevant specialist. They don't do refactors.

## Failure modes

- **Block can't be fixed without touching a frozen path.** Re-slice event. Escalate to user.
- **Gatekeeper returns 50 findings.** Push back: ask for prioritized top-N. A 50-item review is signal that something upstream went wrong.
- **Cycle 3 still has Blocks.** Escalate to user — there's a deeper problem the cycle isn't going to solve.

## Quality self-check before advancing

- No Blocks remain.
- All fix-ups are committed; the working tree is clean.
- Verify passes on the post-fix-up tip.
- Suggestions are captured for the PR description.
- Browser review (if applicable) ran and its Blocks were cleared too.
