---
name: shipwrights-connect
description: Connect a backlog source (jira, github-issues, files) to a Shipwrights project. Runs the source's setup wizard, reads its written config, merges it into .shipwrights.yml, validates the connection, lands as a single commit. Invoked as /shipwrights-connect [jira|github|files].
---

# /shipwrights-connect — wire a backlog source into the project

Takes a fresh `.shipwrights.yml` from `source: { kind: files }` (the default after `/shipwrights-init`) to a fully connected external source — without the user hand-editing YAML, hand-rolling JQL, or chasing down custom-field IDs.

Pairs with the source package's CLI wizard. The wizard handles the secret-bearing connection step (token masked locally); this skill handles everything around it: detection, install, config merging, commit, validation.

## Inputs

- `/shipwrights-connect` — interactive picker (asks which source).
- `/shipwrights-connect jira` — go directly to Jira.
- `/shipwrights-connect github` — github-issues (stubbed; depends on `@shipwrights/source-github-issues` which is not yet shipped).
- `/shipwrights-connect files` — switch to local files mode (no wizard needed).

## Workflow for Jira

### 1. Preflight

Check, in order:

- **`.shipwrights.yml` exists.** If not: stop, tell user to run `/shipwrights-init` first.
- **Working tree clean for the files you're about to touch** (`.shipwrights.yml`, `.shipwrights/jira.json`, `.gitignore`, `.env.local`). Other unrelated dirty files are fine. Refuse if any target file has uncommitted changes the user hasn't acknowledged.
- **`@shipwrights/source-jira` is reachable.** Try `npx --no-install @shipwrights/source-jira --version`. If it errors, ask the user via AskUserQuestion: "Install `@shipwrights/source-jira` as a devDep?" Detect their package manager from lockfiles (`yarn.lock` → `yarn add -D`, `pnpm-lock.yaml` → `pnpm add -D`, otherwise `npm install -D`).

### 2. Run the source's wizard

If `.shipwrights/jira.json` already exists, ask via AskUserQuestion:
- "Use existing config" — skip to step 3.
- "Re-run setup" — delete `.shipwrights/jira.json` and proceed.

Otherwise, tell the user to run the wizard in their terminal. Use the `!` prefix convention so the command lands in their shell:

```
! npx @shipwrights/source-jira init
```

Explain that the token is masked in the terminal but won't be visible in this chat. Wait for them via AskUserQuestion: "Wizard finished cleanly?"

### 3. Read the written config

- Read `.shipwrights/jira.json`. If missing, the wizard didn't complete: abort with "no jira.json found — run the wizard again."
- Parse and extract: `host`, `email`, `jql`, optional `field_mapping`, optional `status_mapping`.

### 4. Propose the YAML edit

Read `.shipwrights.yml`. Compute the change to `backlog.source`. Show the user the before/after as a diff inside the response (don't just write silently):

```yaml
# before
backlog:
  source: { kind: files }
  state_dir: docs/backlog/epics

# after
backlog:
  source:
    kind: jira
    config:
      host: amali-tech.atlassian.net
      email_env: JIRA_EMAIL
      token_env: JIRA_API_TOKEN
      jql: "project = NVC AND statusCategory != Done"
      field_mapping:
        size: customfield_10026
        parents: customfield_10014
  state_dir: docs/backlog/epics
```

Confirm via AskUserQuestion: "Apply this change to .shipwrights.yml?" — options: yes / no / show me the JQL / adjust state_dir.

If they pick "adjust state_dir", prompt for a new value before continuing.

### 5. Apply

In one commit:

1. Write the updated `.shipwrights.yml`.
2. `git add` the touched files:
   - `.shipwrights.yml` (always)
   - `.shipwrights/jira.json` (already written by wizard)
   - `.gitignore` (already updated by wizard)
   - **Never** `git add .env.local` — verify it's gitignored.
3. Commit: `chore: connect jira backlog source ({host}, project {projectKey})`. Use the `{projectKey}` extracted from `jql` (regex `project\s*=\s*(\w+)`).
4. Print: `Undo with 'git revert HEAD'.`

### 6. Validate

- Run `npx @shipwrights/source-jira healthcheck` via Bash. Report pass/fail.
- If it fails, leave the commit in place but tell the user the specific error. Don't auto-revert — the YAML is likely right; usually the failure is a stale token, missing env var, or restricted Jira permission.

### 7. Hand-off

Print:

```
✓ Connected to Jira (<host>, project <projectKey>).
✓ State dir: <state_dir>

Next:
  /shipwrights-doctor          — verify everything checks out
  /shipwrights-epic <ID>       — materialise an issue and start the pipeline
  /shipwrights-status          — see current pipeline status
```

## Workflow for files

Much simpler — no wizard, no secrets.

1. Read `.shipwrights.yml`. If `backlog.source.kind` is already `files`, tell the user there's nothing to do.
2. Ask for the `state_dir` (default `docs/backlog/epics`).
3. Update `.shipwrights.yml`, ensure the directory exists, commit.

## Workflow for github

Stubbed. Until `@shipwrights/source-github-issues` ships, respond: "GitHub Issues source not yet released — track shipwrights/source-github-issues for status. Use `files` or `jira` for now."

## Hard rules

- **Never write the API token to `.shipwrights.yml` or `.shipwrights/jira.json`.** Token always reads from env (`JIRA_API_TOKEN`). The wizard writes it to `.env.local` which is gitignored.
- **Never ask the user to paste the API token into this chat.** Drive them to the wizard, which masks input in the terminal. The chat conversation persists; the wizard's stdin doesn't.
- **One git commit per invocation.** Undo is `git revert HEAD`.
- **Don't overwrite an existing `backlog.source` of a different kind without user confirmation.** Show the before/after first.
- **Refuse to commit a dirty `.env.local` even if the user asks.** If the wizard wrote to `.env.local` and the user accidentally `git add`ed it before invoking this skill, unstage and refuse the commit — point them at the gitignore line.

## Failure modes

| Symptom | Action |
|---|---|
| No `.shipwrights.yml` | Tell user to run `/shipwrights-init` first. |
| `@shipwrights/source-jira` not installed and user refuses install | Abort cleanly with the manual install command for their package manager. |
| Wizard didn't write `.shipwrights/jira.json` | Wizard failed or was cancelled. Tell user to re-run; don't proceed with a stale or missing config. |
| `backlog.source` already configured for `jira` with a different host | Show the diff, confirm with user. They may be moving Jira tenants — usually yes-overwrite is right. |
| `healthcheck` fails after applying | Leave commit in place, print specific error, suggest fixes: stale token in env, network proxy, project permissions. |
| Working tree dirty in target files | Refuse. Tell user to commit or stash first. Don't try to be clever. |

## Why this skill exists

The CLI wizard (`npx @shipwrights/source-jira init`) handles the connection brilliantly — it normalises hosts, masks tokens, lists projects, auto-detects custom fields, prints actionable error messages. But it stops at writing `.shipwrights/jira.json`. The user is then expected to know how to plumb that into `.shipwrights.yml` so the orchestrator picks it up. That last mile is what this skill closes.
