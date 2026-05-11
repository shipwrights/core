---
name: shipwrights-doctor
description: Diagnose .shipwrights.yml — schema validity, agent availability, command discoverability, source adapter connectivity, guard registration, lock service reachability, telemetry log writability. Read-only. Invoked as /shipwrights-doctor.
---

# /shipwrights-doctor — diagnose the install

Validates everything Shipwright depends on without modifying anything. Read-only.

## What you check

### 1. Config validity

- `.shipwrights.yml` exists.
- Parses as YAML.
- Validates against `schemas/shipwrights-config.schema.json`.
- Required fields present.
- `version` matches a known schema version.

### 2. Roles → agents

For each role in `roles[]`:
- The agent reference resolves to an existing agent file.
  - `bundled` → `agents/<role>.md` in plugin
  - `user: X` → `~/.claude/agents/X.md`
  - `custom: ./path` → relative to project root
  - `npm: @org/pkg` → installed in node_modules
- The agent file's frontmatter declares `tools:` matching the role's `capabilities.can_write` setting (write-true roles need Write/Edit; read-only roles must not have Write).

### 3. Pipeline references

For each stage in `pipeline[]`:
- Owner role(s) named exist in `roles[]` (or are the literal `orchestrator`).
- The stage skill exists at `skills/stages/<stage>.md` (bundled) or at the path declared by `stage.skill` (override).
- `requires:` and `optional_when:` expressions parse.

### 4. Backlog source

- `backlog.source.kind` resolves to a known adapter (built-in or installed npm package).
- Run the adapter's `healthcheck()` if it exposes one (e.g., Jira: ping the API; files: confirm `state_dir` is writable).

### 5. Verify discovery

- The detected verify commands actually exist (e.g., `pnpm verify` runs without "command not found"). Just `--help` or `--version` — don't actually run verify here.

### 6. Guards

- Each guard's runner resolves (built-in / npm / shell command).
- If `runs.shell:`, confirm the command is invocable.

### 7. Lock service

- The lock backend resolves.
- Markdown: register file exists or is creatable.
- GitHub Issues: token in env var, repo accessible.
- Custom: `healthcheck()` if exposed.

### 8. Telemetry log

- `telemetry.log_path` parent directory is writable.
- File doesn't already exist as a directory.

### 9. GitHub labels

- The three required labels exist in the repo (`tier:trivial`, `tier:minimal`, `do-not-auto-merge`). If missing, propose `gh label create` commands to fix.

## Output

For each check:
- ✓ pass
- ⚠ warn (works but suboptimal)
- ✗ fail (blocks orchestration)

Example:

```
Config:                    ✓ valid (version 1)
Roles → agents:
  po → bundled             ✓ found, read-only tools confirmed
  backend → bundled        ✓ found, write tools confirmed
  frontend → bundled       ✓ found, write tools confirmed
  qa → bundled             ✓ found, write tools confirmed
  gatekeeper → bundled     ✓ found, edit tools confirmed
  browser → bundled        ⚠ found but Playwright MCP not installed; run `claude mcp add playwright`

Pipeline:                  ✓ 7 stages, all owners resolve
Backlog source (files):    ✓ docs/backlog/epics is writable, 12 epic files present
Verify command:            ✓ pnpm verify is invocable
Guards:
  file-length              ✓ bundled
  branch-name              ✓ bundled
  commit-format            ✓ bundled
Lock service (markdown):   ✓ docs/process/in-flight.md exists, 1 active entry
Telemetry log:             ✓ .shipwrights/telemetry.jsonl writable
GitHub labels:             ✗ tier:minimal missing — run: gh label create tier:minimal --color e8e8e8

Summary: 1 fail, 1 warn, 13 pass
```

If there's any fail, exit non-zero. The user fixes, re-runs.

## Failure modes

- **Config doesn't parse** — print the YAML error with line number, exit.
- **A required directory doesn't exist** (e.g., `state_dir`) — propose creating it.
- **Plugin version doesn't match expected migration head** — instruct to `/shipwrights-upgrade`.
