# Stage: review-browser (optional)

Browser-based UX/UI review via Playwright MCP. Verifies rendered behaviour at the project's named breakpoints, accessibility, interaction states, and permission-affected screens.

## Skip when

- The integrated diff doesn't touch UI surface (no changes under `apps/web/**` or equivalent UI paths declared in config).
- Tier is `trivial` or `minimal`.
- The browser-reviewer role isn't enabled in `.shipwright.yml`.

## When to run

The orchestrator triggers this stage automatically when one or more of these is true in the integrated diff:

- Files under the project's UI scope (`frontend` role's `capabilities.scope`).
- Changes to design-token files (project-configured).
- Changes to `packages/contracts/**` (could affect rendered shapes).
- Changes to permission-seed files (could change UX gating).
- Changes to error-envelope handling (could change visible error UI).

The decision is data-driven — no human judgement; the engine evaluates the diff against trigger paths from config.

## What you (orchestrator) do

1. **Start the dev server** (or have the consumer's CI environment do it). The exact command comes from config; typically `pnpm dev` or `npm run dev`.
2. **Wait for the server to be ready.** Tail the dev log for the readiness marker (typically `Ready in`); time out after a configured wait.
3. **Dispatch the browser-reviewer agent.** Hand it:
   - The dev server URL.
   - The list of routes affected by the diff (computed from changed files).
   - The project's named breakpoints.
   - The list of roles to test for permission-affected screens.
   - The refined epic's `## Acceptance` (so they can verify against criteria, not vibes).
4. **Receive findings** in three categories: Blocks, Major, Minor. Plus a coverage report.
5. **Stop the dev server.**
6. **For each Block:** treat it like a gatekeeper Block — dispatch the relevant specialist to fix on a fix scratch branch, re-integrate, re-run.
7. **For each Major:** treat as a Suggestion (capture for PR description; human reviewer decides).
8. **Capture Minors** for the PR description.

## Failure modes

- **Server fails to start.** The integrated build is broken. Kick back to backend or frontend (whichever is implicated).
- **Server starts but a route 500s.** Same — broken integration.
- **Playwright can't reach a route.** Often a permission gate misconfigured. Flag for backend triage.
- **Browser-reviewer found a major a11y violation.** Block. Kick back to frontend.

## Quality self-check before advancing

- Dev server stopped cleanly.
- All Blocks cleared and re-verified.
- Coverage report names which routes × breakpoints × roles were exercised, and why anything wasn't.
- Major + Minor findings captured for the PR.
