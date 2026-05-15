# Contributing to `@shipwrights/core`

Thanks for thinking about contributing! This file covers the practical stuff: how to set up, what to run before opening a PR, and what we look for in changes.

## Quick start

```bash
git clone https://github.com/shipwrights/core.git
cd core
npm install
npm test
```

If `npm test` is green, you're set up.

## How we work

### Branch names

| Prefix | Use for |
|---|---|
| `feat/<slug>` | New features |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Tooling, deps, docs, internal cleanup |
| `docs/<slug>` | Documentation-only changes |
| `test/<slug>` | Test-only changes (no production code) |

Lowercase, hyphen-separated. Keep slugs short and specific (e.g. `fix/upgrade-clobber-on-windows`, not `fix/bug`).

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body — what changed and why, not how>
```

Examples:
- `feat: add /shipwrights-loop skill`
- `fix(upgrade): use file:// URLs for dynamic import on Windows`
- `docs: clarify auto-merge confirmation flow`

The first line stays under ~70 chars. The body explains the *why* — readers can see the *what* in the diff.

### Pull requests

1. Fork the repo (or branch directly if you're a maintainer).
2. Create a branch following the naming convention above.
3. Write the change + tests in the same commit (or commits — they get squashed at merge).
4. Push, open a PR using the template that auto-loads.
5. CI runs `npm test` on every push. Wait for green before requesting review.
6. A maintainer reviews, asks questions, requests changes if needed.
7. On approval, the PR is squash-merged into `main` with `--rebase --delete-branch`.

### Tests

Tests are required for any code change that's not pure formatting. Tests live in `tests/` and run via `node:test`. Use the existing test files as shape templates.

Useful test commands:

```bash
npm test                          # full suite
node --test tests/foo.test.mjs    # one file
```

### Code style

We use [Biome](https://biomejs.dev/) for formatting and linting.

```bash
npm run format    # auto-format
npm run lint      # check
```

If `npm run lint` complains, fix it before pushing — CI will fail otherwise.

## What we look for in changes

### Good PR shape

- One coherent change per PR. Mixing a refactor with a bug fix makes both harder to review.
- Tests describe behaviour, not implementation. A test that pins `internalHelper.foo === 3` is brittle.
- Doc updates land in the same PR as the behaviour they describe.
- Breaking changes are flagged in the PR title (`!` after the type, e.g. `feat!:`) and explained in the body.

### Things that get pushed back

- Code that doesn't have tests.
- Renaming variables / reformatting unrelated files alongside a bug fix.
- PRs without a clear use case in the body — *why* this change, not just *what*.
- "While I was in there..." cleanups bundled with the actual fix.

### Security

If you find a security issue, please don't open a public issue. See [`SECURITY.md`](SECURITY.md) for how to report privately.

## Code of conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainer notes

Currently a single maintainer (`@dacostaaboagye`). Once a second maintainer joins, the `main` branch protection will require one approval before merge. Until then, the maintainer self-merges after CI passes and verifying their own diff.
