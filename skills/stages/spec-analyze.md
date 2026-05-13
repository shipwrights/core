# Stage: spec-analyze

Architect agents propose concrete changes. Every claim about codebase shape, conventions, or impact must cite `path:line` references from the manifest. This is the citation-enforcement stage — the value of the spec pipeline.

## Inputs

- Manifest (`.shipwrights/specs/<id>.manifest.json`)
- Spec text (`.shipwrights/specs/<id>.spec.md`)
- Project's `.shipwrights.yml` (roles, hard rules)

## Dispatch

Based on the spec's surface:

- **Backend or API change** → `node-backend-systems-architect`
- **UI / frontend change** → `frontend-ui-architect`
- **Both** → dispatch in parallel (single message, multiple Agent calls)

Each architect gets:
- The spec body
- The manifest (their citation source)
- Their role's `capabilities.scope` from config (so they know what paths they own)
- Hard rules

Directive:

> You are in **analyze mode** — read-only. Don't write any source code. Produce a structured analysis:
>
> - Files that will change (with one-line description of the change)
> - Endpoint shape (if APIs are involved): request, response shape, error envelope
> - Decisions made + reasoning. **Every decision must cite a manifest path:line.** Example: "Use signed JWT tokens, no DB storage. Cited: apps/api/src/auth/jwt.ts:18 — existing JWT pattern."
> - Risks / what could break
>
> If you need to claim something about the codebase that isn't in the manifest, STOP and report what's missing — don't extrapolate.

## Expected output per architect

Markdown blocks:

```
### Files that will change
- <path> — <change description, cited if convention-related>

### Endpoint (if applicable)
- POST /api/<route>
  - Request: <type> { ... }
  - Response 200: { ... }
  - Response 4xx: <envelope, cited>

### Decisions + reasoning
- **<decision>**: <reasoning, cited>
- ...

### Risks
- <risk 1>
- ...
```

## Hard rules

- **Read-only.** No source file writes. Only `.shipwrights/specs/<id>.analyze-<role>.md` gets created.
- **Citation discipline.** Every architectural claim references a manifest path. The next stage runs the enforcer; uncited claims will block.
- **Stay in scope.** The architect's `capabilities.scope` bounds what files they can claim ownership of. Cross-cut concerns get escalated to the orchestrator.

## Hand-off

Save each architect's output to `.shipwrights/specs/<id>.analyze-<role>.md`. The plan stage (Stage 4) merges them.

## Failure modes

| Symptom | What to do |
|---|---|
| Architect cites a path not in the manifest | Stop, surface the violation, return to discover with the missing-path hint |
| Architect proposes touching a path outside their scope | Escalate — this is a slicing decision |
| Architect can't propose a design without more context | Return to discover with a "need to read X" hint |
