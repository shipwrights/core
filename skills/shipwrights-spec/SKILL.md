---
name: shipwrights-spec
description: Drive a single-task spec-first pipeline. Reads the codebase (with manifest), drafts a spec, runs architect analysis with citations, writes a plan document, halts at the approval gate. Invoked as /shipwrights-spec <description> for a fresh task, or /shipwrights-spec <S-id> to resume an existing draft.
---

# /shipwrights-spec — draft a spec for human approval

You are the orchestrator for a single task. Unlike `/shipwrights-epic`, which drives a refined backlog item through the full pipeline, this skill takes an ad-hoc task description and walks 4 stages of analysis before halting at a human approval gate.

The goal is **a plan document the user can read and approve before any source file is written**.

## What you produce

A single plan document at `<spec.output_dir>/<id>-<slug>.md` (default `docs/backlog/specs/`). The user reviews it, then runs one of:

- `/shipwrights-spec-approve <id>` — proceed to build
- `/shipwrights-spec-revise <id> <note>` — re-run analyze + plan with the note
- `/shipwrights-spec-cancel <id>` — tombstone the draft

If the user invoked `/shipwrights-spec` with `--auto`, you skip the gate and proceed straight to build after writing the plan.

## Inputs

Either:

- A task description string ("add a forgot-password flow"). Allocate a new id, write the input file under `.shipwrights/specs/<id>.input.md`, then run the 4 stages.
- An existing id (`S-<yyyy-mm-dd>-<hash>`). Read the input file, check the plan's status. If `drafted` and `revisions > 0`, you're being asked to redraft after a revision. If `drafted` without revisions, the previous run was interrupted — resume from wherever the manifest / plan are missing.

## The 4 stages

### Stage 1: Discover (read-only)

Read enough of the codebase to ground the spec in reality. Honour `spec.context_depth`:

- `shallow` — read 5-10 high-signal files (entry points, `package.json`, `CLAUDE.md`/`AGENTS.md`, the closest existing module to the task).
- `medium` (default) — read 20-30 files; spread across the layers the task touches.
- `deep` — read 50+ files; everywhere the task could plausibly affect.

Emit a manifest at `.shipwrights/specs/<id>.manifest.json` listing every file read (with line ranges) and key observations (conventions, frameworks, primitives worth reusing).

**Hard rule:** subsequent stages may only cite paths that appear in the manifest. Treat the manifest as the authority. If you discover later that you need to cite a file you didn't read, **stop and re-run discover** rather than guessing.

### Stage 2: Spec (PO agent in task mode)

Dispatch the PO agent with:
- The user's task description
- The manifest (so they ground acceptance criteria in real code)
- Hard rules from `.shipwrights.yml`

The PO returns:
- Acceptance criteria (testable, concrete)
- Out-of-scope cuts (explicit)
- Edge cases

If the input is too vague to write unambiguous acceptance, the PO escalates with a list of clarifying questions. Write the questions to `.shipwrights/specs/<id>.questions.md` and STOP — don't invent answers.

### Stage 3: Analyze (architect agents, read-only)

Based on the spec, identify which architects to dispatch:

- Backend changes implied → `node-backend-systems-architect`
- Frontend changes implied → `frontend-ui-architect`
- Both → dispatch in parallel

Each architect:
- Receives spec + manifest
- Reads concrete files (paths from manifest only)
- Returns: files-that-will-change list, endpoint shapes (if APIs), payload examples, decisions + reasoning

**Every claim they make MUST cite a path:line from the manifest.** A claim like "use Redis for storage (per apps/api/src/cache.ts:34)" passes. A claim like "use Redis for storage" alone fails enforcement at Stage 4.

### Stage 4: Plan (orchestrator)

Consolidate the spec + analyses into a single plan document with this exact section structure:

```markdown
---
id: <S-id>
title: <derived from task or refined by PO>
status: drafted
kind: spec
priority: <inferred or default P2>
created_at: <iso>
revisions: <0 or N>
manifest_ref: .shipwrights/specs/<id>.manifest.json
input_ref: .shipwrights/specs/<id>.input.md
---

## Task
<user input verbatim>

## Codebase analysis
<files read + observations from the manifest, in human-readable form>

## Spec
### Acceptance
- ...
### Out of scope
- ...
### Edge cases
- ...

## Architecture
### Files that will change
- <path> — <one-line description>
### Endpoint (if applicable)
- ...
### Decisions + reasoning
- **<decision>**: <reasoning, with cite>

## User journey
1. ...

## Test plan
- Unit / integration / manual

## Risks
- ...

## Approval
Run one of:
- /shipwrights-spec-approve <S-id>
- /shipwrights-spec-revise <S-id> <note>
- /shipwrights-spec-cancel <S-id>
```

After writing the file, **run the citation enforcer** (`lib/spec/manifest.mjs validateCitations`) against the plan body. If `enforcement: strict` and there are violations:
- Surface the violations to the user
- Update status to `drafted` (gate-blocked) but flag the violations in the message
- Don't proceed even if `--auto` was set

If enforcement passes, print the path to the plan + the three approval-next-step commands.

### Optional: Stage 5 (gate, automatic in --auto mode)

If the user passed `--auto` AND enforcement passed:
- Skip the wait
- Bump status to `approved` directly
- Hand off to the standard build pipeline (Stage 4 of `/shipwrights-epic` and onward)

The plan still gets written to disk for the audit trail.

## Hard rules

- **Never write to source files in stages 1-4.** Discover, spec, analyze, plan are read-only on the consumer's source code. Only `.shipwrights/specs/` and `docs/backlog/specs/` get written.
- **Never bypass the citation enforcer**, even when convenient. Loose mode is opt-in per config; if it's strict, respect it.
- **Don't promise behaviour you couldn't read.** "I'll use the existing X" requires reading X.
- **Don't make scope cuts unilaterally**. If the task implies more than the analysis can handle, escalate to the user with a "split into N specs?" question.

## Failure modes

| Symptom | What to do |
|---|---|
| Task description is too vague | Generate questions, write to `.questions.md`, halt |
| Discover can't find anything matching the task | Manifest with `notes: "no relevant code found"`, halt with a hint to provide examples |
| Architect can't propose a design without changing a frozen path | Escalate — this is a slice-level decision |
| Citation enforcer finds violations | Block; print violations; suggest revise |
| User runs `/shipwrights-spec <id>` on a `cancelled` spec | Refuse with a clear message |

## What to announce

One line per stage transition. Examples:

- "Allocated S-2026-05-12-a8f3. Stage 1: discover (depth: medium)."
- "Discover done. 24 files read. Stage 2: spec."
- "PO returned a refined spec. 5 acceptance bullets, 2 open questions noted. Stage 3: analyze."
- "Backend architect done. 4 files would change. Stage 4: plan."
- "Plan written to docs/backlog/specs/S-2026-05-12-a8f3-forgot-password.md."
- "Citation enforcer: PASSED. Status: drafted. Next: /shipwrights-spec-approve S-2026-05-12-a8f3."

Or if blocked:

- "Citation enforcer: FAILED. 3 uncited claims in ## Architecture. Status: drafted (gate-blocked). Revise or supply citations."
