---
name: shipwrights-craft-agent
description: Generate project-specific Shipwrights agents from detected project signals. Drops .md files into .claude/agents/ so Claude Code discovers them natively and the orchestrator can dispatch by name. Invoked as /shipwrights-craft-agent [<slug> "<description>"] | --list | --remove <slug>.
---

# /shipwrights-craft-agent — generate project-specific agents

Generic bundled agents (`product-owner-strategist`, `node-backend-systems-architect`, …) carry every team's project context in the prompt at runtime. That works, but at scale it's expensive and noisy. Project-specific agents bake the conventions in once: directory layout, framework choice, in-house terminology, idiomatic patterns. The orchestrator (and you, ad-hoc) get a sharper specialist for the cost of one well-crafted markdown file.

This skill writes those files.

## Inputs

- `/shipwrights-craft-agent` — auto-detect mode. Scan the project, propose a set of agents, ask which to generate.
- `/shipwrights-craft-agent <slug> "<description>"` — explicit mode. Draft a single agent the user described in their own words.
- `/shipwrights-craft-agent --list` — show all agents currently at `.claude/agents/<name>.md`, with which are bundled vs user-crafted.
- `/shipwrights-craft-agent --remove <slug>` — delete a previously-crafted agent (refuses to remove bundled agents).

## Workflow — auto-detect mode

### 1. Preflight

- `.shipwrights.yml` exists (this skill is for already-initialised projects). If not: tell user to run `/shipwrights-init` first.
- `.claude/agents/` exists (created by `/shipwrights-init`). If not: tell user to run `/shipwrights-upgrade` first.

### 2. Scan the project

Run via Bash (one-liner using the lib helper) and capture the JSON:

```bash
node -e "import('@shipwrights/core/lib/project-signals.mjs').then(m => console.log(JSON.stringify(m.detectProjectSignals(process.cwd()))))"
```

Or read it via `lib/project-signals.mjs` directly. Surface the headline to the user:

```
Detected:
  Project:    arms-invoice-frontend-pro
  Stack:      vue3 + pinia + vue-router + vue-quill + apexcharts + pdfmake
  Build:      vite
  Tests:      vitest
  Styling:    tailwindcss
  Conv:       src/components, src/stores, src/services, src/router
  Domain:     invoice, finance, quickbooks
```

### 3. Propose agents

Call `proposeAgents(signals)` from `lib/propose-agents.mjs`. It returns 0–6 proposals based on what was detected. Print as a numbered list, with the `reason` so the user sees why each was suggested:

```
Proposed agents:
  1) arms-invoice-frontend-vue-specialist
       Vue 3 specialist for the ARMS project.
       Reason: vue3 + pinia + vue-router + tailwindcss + vite detected.
       Would take over the "frontend" role in .shipwrights.yml.

  2) arms-invoice-domain-expert
       Domain expert (consultant, not a coding role).
       Reason: domain hints: invoice, finance, quickbooks.
       Not wired to a role.

  3) arms-invoice-qa-engineer
       QA engineer (vitest-aware).
       Reason: tests use vitest.
       Would take over the "qa" role in .shipwrights.yml.

  4) arms-invoice-pdf-rendering-specialist
       PDF specialist (pdfmake).
       Reason: pdf libs in deps: pdfmake.
       Not wired to a role.
```

Ask via AskUserQuestion: "Generate which? [pick a number, comma-separated, all, none]"

### 4. Render

For each chosen proposal, call `renderAgent(proposal, signals)` from `lib/render-agent.mjs` to get the agent's markdown content. Show the user a preview of each one (collapsed if many) and ask: "Write these N files? [y/n/show-diff]".

On `show-diff`: print each file's full content.

### 5. Write

Write each to `.claude/agents/<slug>.md`. If a file with that name already exists:

- If it's bundled (one of: `product-owner-strategist`, `node-backend-systems-architect`, `frontend-ui-architect`, `qa-quality-engineer`, `code-review-gatekeeper`, `ux-ui-browser-reviewer`) — **refuse**. Ask the user to pick a different slug.
- If it's user-crafted — ask: overwrite? skip? rename?

After writing, run `git add .claude/agents/<files>` and commit:
```
chore: craft project-specific shipwrights agents (<N> generated)
```

### 6. Offer to wire into roles

For each proposal with a `wireToRole` (e.g., `frontend`, `qa`), read `.shipwrights.yml` and show the user:

```yaml
roles:
  - name: frontend
    # before
    agent: bundled
    # after
    agent: user: arms-invoice-frontend-vue-specialist
```

Ask: "Update .shipwrights.yml to use these agents in their roles? [y/n]"

On yes, edit `.shipwrights.yml`, stage it, and **amend the same commit** (so undo is still one revert). On no, leave `.shipwrights.yml` alone — the agent files are written; they're discoverable ad-hoc (`@<slug>` in Claude Code chat), just not wired into the pipeline.

### 7. Print summary

```
✓ Wrote 4 agents to .claude/agents/
✓ Wired 2 into roles (frontend, qa)
✓ Committed as: chore: craft project-specific shipwrights agents (4 generated)

You can now:
  • @arms-invoice-frontend-vue-specialist  — invoke directly in Claude Code chat
  • /shipwrights-loop                       — orchestrator will use the wired agents
  • git revert HEAD                         — undo this entire change
```

## Workflow — explicit mode

`/shipwrights-craft-agent arms-quickbooks-integrator "Specialist for the QuickBooks REST API integration we're building under NVC-150"`

1. Validate the slug (kebab-case, doesn't collide with bundled names).
2. Skip the proposal step. Build a single proposal manually:
   ```js
   {
     slug: "arms-quickbooks-integrator",
     archetype: "domain",                   // domain template by default for explicit mode
     name: "QuickBooks integrator (ARMS)",
     reason: "user request: Specialist for the QuickBooks REST API integration...",
     wireToRole: null,
   }
   ```
3. Render with `renderAgent` against the detected signals.
4. Show preview, confirm, write, commit.

Explicit-mode agents default to `wireToRole: null` — they're available as consultants, not pipeline-role replacements. The user can wire them manually if they want.

## Hard rules

- **Never overwrite a bundled agent.** The six bundled slugs (above) are reserved. Even with `--force`, refuse.
- **Never put secrets in an agent.** Sanity-check the rendered content for what looks like an env var or token; refuse to write and flag if so.
- **One commit per invocation.** Multiple agents + the optional YAML edit land in one commit. Undo is `git revert HEAD`.
- **Refuse on dirty working tree** for the touched files. Other dirty files are fine.
- **Always show preview before writing.** Users should see exactly what's going to disk; don't hide content behind a "trust me" prompt.
- **The skill drafts; the user reviews.** A generated agent is a starting point — encourage editing before commit. The proposal/preview UX should make editing easy (paste back into chat to iterate before write).

## Failure modes

| Symptom | Action |
|---|---|
| No `.shipwrights.yml` | Tell user to run `/shipwrights-init` first. |
| No `.claude/agents/` | Tell user to run `/shipwrights-upgrade` first. |
| Project signals come back empty (no package.json, no detected stack) | Skip the auto-detect proposal step. Tell user explicit mode is still available. |
| Proposed slug collides with bundled name | Suggest a project-prefixed alternative (e.g., `<project-prefix>-frontend-ui-architect`). |
| User picks "none" | Exit cleanly. Don't make a commit if nothing was written. |
| `.shipwrights.yml` YAML edit fails (malformed) | Roll back the YAML change but keep the written agent files. Tell the user to wire them manually. |

## Why this skill exists

Generic agents have to be told the project's conventions on every invocation. That's tokens spent re-establishing context every time, and it's also a quality risk — generic agents drift toward generic decisions. Project-specific agents bake the convention in once. The orchestrator becomes faster, cheaper, and a sharper fit for the codebase.

The output is also a great onboarding artifact: a new engineer reading `.claude/agents/<project>-frontend-vue-specialist.md` learns the project's frontend rules in one page.
