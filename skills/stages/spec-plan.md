# Stage: spec-plan

Consolidate spec + architect analyses into one plan document the user reads, then enforce citations and write the document.

## Inputs

- Manifest (`.shipwrights/specs/<id>.manifest.json`)
- Spec body (`.shipwrights/specs/<id>.spec.md`)
- Architect analyses (`.shipwrights/specs/<id>.analyze-<role>.md`)
- Task input (`.shipwrights/specs/<id>.input.md`)
- `.shipwrights.yml` for `spec.output_dir`, `spec.enforcement`, `spec.approval_required`

## What you (orchestrator) do

1. **Compose the plan document** with the structure below (exact section headings — the citation enforcer keys off `## Codebase analysis` and `## Architecture`).

```markdown
---
id: <S-id>
title: <derived from PO's spec title or task first sentence>
status: drafted
kind: spec
priority: <PO's priority or P2>
created_at: <iso>
revisions: <0 unless redrafting>
manifest_ref: .shipwrights/specs/<id>.manifest.json
input_ref: .shipwrights/specs/<id>.input.md
---

## Task
<task input verbatim>

## Codebase analysis
- Files read: <bulleted list from manifest>
- Conventions: <observations from manifest>
- Frameworks: <observations from manifest>

## Spec
### Acceptance
<from spec body>
### Out of scope
<from spec body>
### Edge cases
<from spec body>

## Architecture
### Files that will change
<from architect analyses, merged across roles>
### Endpoints (if applicable)
<from architect analyses>
### Decisions + reasoning
<from architect analyses, merged>

## User journey
<derived: walk the spec from a user's perspective, step-by-step>

## Test plan
- Unit: <from architect risks + spec acceptance>
- Integration: <from architect endpoints>
- Manual: <from spec edge cases>

## Risks
<merged from architects + spec edge cases>

## Approval
Run one of:
- /shipwrights-spec-approve <S-id>
- /shipwrights-spec-revise <S-id> <note>
- /shipwrights-spec-cancel <S-id>
```

2. **Compute the slug** from the title (lowercase, hyphenated, ≤60 chars). Spec file lives at `<spec.output_dir>/<id>-<slug>.md`.

3. **Run the citation enforcer.** Use `lib/spec/manifest.mjs validateCitations(planBody, manifest)`. If `enforcement: strict` and violations exist:
   - Write the plan file anyway (so the user can see what was drafted)
   - Bump status from `drafted` to `drafted` (no-op — gate-blocked)
   - Return an escalation listing the violations

4. **If enforcement passes**, write the plan file and:
   - If `--auto` flag was on AND `approval_required` is `false` → bump status to `approved` directly and hand off to the build pipeline (Stage 4 of `/shipwrights-epic` and onward).
   - Otherwise → keep status `drafted`; halt at the gate.

5. **Commit on a chore branch.** `chore(spec): draft <S-id>`. Push (optional per config). Don't open a PR — drafts aren't PRs; only approved+built specs become PRs.

## Hard rules

- The plan document is **single source of truth** for spec state.
- The exact section headings matter (`## Codebase analysis`, `## Architecture`) — the enforcer parses by these.
- Never write to source files. Only `<output_dir>/<id>-<slug>.md` + the chore commit.
- The user gets ONE plan per draft; revisions snapshot the previous and re-run.

## Hand-off

Return to the user (via the orchestrator skill) with the plan path and the next-step prompts. If the gate is on, that's the end of this run; the user re-engages via approve / revise / cancel.
