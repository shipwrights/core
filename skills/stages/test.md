# Stage: test

QA writes tests on a `--qa` scratch branch and produces a manual verification plan for the human reviewer.

## Skip when

- Tier is `trivial` — no QA pass.
- Tier is `minimal` AND the change doesn't touch auth / payments / data integrity / production-path code. Otherwise QA still runs.

## What you (orchestrator) do

1. **Create the QA scratch branch.** `scripts/shipwright/create-scratch.mjs qa`.
2. **Dispatch the QA agent.** Hand it:
   - The integrated diff (`git diff <feature-branch> <integration>`).
   - The refined epic (especially `## Acceptance` and `## Edge cases`).
   - The project's verify and test commands.
   - The hard rules.
   - QA's scope (typically test paths only).
3. **Wait.** QA writes tests + a manual plan, signals done.
4. **Run scope verification.** QA's commits must touch test paths only.
5. **Integrate the QA scratch onto the feature branch** via `integrate-scratch.mjs qa`.
6. **Run verify** on the integrated tip — the tests should now run as part of the suite.
7. **Capture QA's manual plan** for the PR description.

## Failure modes

- **QA found a source bug.** They flag it; they don't fix it. You re-open the relevant specialist's scratch branch, dispatch them with QA's report, then re-integrate + re-run QA.
- **QA's tests don't pass on integration.** Either the tests are wrong or the source is. Triage: if the source is wrong, kick back to the relevant specialist; if the test is wrong, kick back to QA.
- **An acceptance criterion isn't testable as written.** QA flags it; orchestrator escalates to PO for re-refinement (or to user to amend criteria).

## What you produce

- Tests on the feature branch, integrated.
- A `## Test plan` section in the epic with QA's enumerated coverage + manual plan.
- Epic at `status: tested`.

## Quality self-check before advancing

- Every acceptance criterion is covered by at least one test.
- QA's scratch was integrated cleanly.
- Verify passes on the post-test integration.
- Manual plan is captured for the PR description.
