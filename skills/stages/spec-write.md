# Stage: spec-write

Turn the task description + manifest into a refined spec. The PO agent owns this stage in "task mode" — they don't write code, only the spec body.

## Inputs

- Task description (`.shipwrights/specs/<id>.input.md`)
- Manifest (`.shipwrights/specs/<id>.manifest.json`)
- Hard rules from `.shipwrights.yml`

## Dispatch

Spawn `product-owner-strategist` with these inputs and a task-mode directive:

> You're refining an ad-hoc task (not a backlog item). Read the manifest's observations — your acceptance must be grounded in what the codebase actually does, not what it "probably" does. If the task is too vague to produce unambiguous acceptance, write a list of clarifying questions to `.shipwrights/specs/<id>.questions.md` and STOP — don't invent answers.

## Expected output

A spec document (no frontmatter yet — that gets added by the plan stage). Structure:

```
### Acceptance
- <criterion 1, testable, references reality from manifest>
- ...

### Out of scope
- <explicit cut 1>
- ...

### Edge cases
- <case 1>
- ...
```

## Hard rules

- **No code writes.** PO produces text.
- **Reality-grounded acceptance.** Each criterion should reference the manifest where possible. Bullet "matches existing error envelope at apps/api/src/lib/errors.ts:12" is good; bare "uses standard errors" is weak.
- **Out-of-scope is required.** Empty out-of-scope is a signal the PO didn't push back on scope. Force at least one explicit cut.

## Failure modes

| Symptom | What to do |
|---|---|
| Task too vague | Write to `.questions.md`, halt the pipeline |
| Task is multi-epic-sized | Write to `.questions.md` with "suggest splitting into N specs"; halt |
| Manifest empty | Defer — discover should have caught this; bubble back |

## Hand-off

Save the spec text to `.shipwrights/specs/<id>.spec.md` for the next stage to pick up. The plan stage (Stage 4) folds this into the final document with frontmatter.
