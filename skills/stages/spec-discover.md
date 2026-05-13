# Stage: spec-discover

Read the codebase to ground the spec in reality. The artifact is a **context manifest** — a JSON file listing every file you read and key observations. Later stages may only cite paths from this manifest.

## Inputs

- The user's task description (from `.shipwrights/specs/<id>.input.md`)
- The consumer's `.shipwrights.yml` (esp. `spec.context_depth`)
- Glob access to the project root

## What to do

1. **Identify the surface the task touches.** Grep / Glob for keywords from the description. Walk paths that match.
2. **Read with intent.** For each file, note the line ranges actually relevant — not "read the whole 800-line file." Bound by `spec.context_depth`:
   - `shallow`: 5–10 high-signal files. Entry points, manifest files, the most-likely-affected module.
   - `medium` (default): 20–30 files. Spread across the layers the task touches.
   - `deep`: 50+ files. Wider net; appropriate when the task is cross-cutting or new-area.
3. **Capture observations.** Conventions noted (error envelopes, naming patterns, primitives worth reusing), frameworks detected (Next.js version, ORM, test runner), file-length budgets, hard rules.
4. **Emit the manifest.** Write JSON to `.shipwrights/specs/<id>.manifest.json` with shape:

```json
{
  "spec_id": "S-...",
  "generated_at": "<iso>",
  "task_input": "<first line of task>",
  "files": [
    { "path": "apps/api/src/auth/login.ts", "ranges": ["1-184"] },
    { "path": "apps/web/src/app/login/page.tsx", "ranges": ["1-220"] }
  ],
  "observations": [
    "error envelope: { code, message, details? } at apps/api/src/lib/errors.ts:12",
    "framework: Next.js 16 App Router (apps/web/package.json:18)",
    "test runner: Vitest (apps/web/vitest.config.ts:8)"
  ]
}
```

## Hard rules

- **Read-only.** Never write to source files. Only `.shipwrights/specs/<id>.manifest.json` gets created.
- **Don't list files you didn't actually open.** The manifest is the contract; later stages cite from it. Lying here breaks everything downstream.
- **Bound reads by `spec.context_depth`.** A `shallow` discover that reads 80 files is wrong — flag the inconsistency rather than silently widening.

## Output

The manifest JSON file. Return a one-line summary to the orchestrator: how many files read, key observations count, any notes (e.g. "couldn't find anything matching 'forgot-password'; suggest user supply hints").

## Failure modes

- **Nothing matches.** Manifest with `files: []` and an observation `"no relevant code found matching <terms>"`. Orchestrator halts with a hint.
- **Too many files match.** If the task is "refactor everything," discover should refuse rather than read 500 files. Return a "task scope too wide; split into N specs" suggestion.
- **Reads fail.** Permission errors, missing files — log and continue with what you got; observations note the gap.
