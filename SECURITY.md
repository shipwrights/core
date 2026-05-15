# Security Policy

## Supported versions

We actively maintain the latest minor release line. Bug-fix releases land against the latest minor as patch versions.

| Version | Supported |
|---|---|
| 0.6.x   | yes |
| 0.5.x   | best-effort backport for critical issues |
| < 0.5   | no |

## Reporting a vulnerability

**Please don't open public issues for security problems.**

Use either of these private channels:

1. **GitHub Private Vulnerability Reporting** (preferred)
   On the repo, open the **Security** tab → **Report a vulnerability**. This routes directly to the maintainer with full GitHub auditing.

2. **Email**
   `solomon.aboagye@amalitech.com` — include "shipwrights security" in the subject so it doesn't get lost.

Please include in your report:

- A description of the issue and the impact you observed.
- Steps to reproduce (a minimal `.shipwrights.yml`, command sequence, expected vs actual).
- The version of `@shipwrights/core` you tested against.
- Any proof-of-concept code, screenshots, or logs.

## What to expect

- **Acknowledgement**: within 3 business days.
- **Initial assessment**: within 7 business days — we'll tell you whether we consider it a security issue, our severity rating, and our planned next step.
- **Fix and release**: severity-dependent. Critical issues get a patch release within ~7 days; lower-severity issues land in the next normal release.
- **Coordinated disclosure**: we'll work with you on disclosure timing. The default is "fix shipped + 7 days" before public disclosure.
- **Credit**: with your permission, we'll credit you in the release notes.

## Out of scope

The project is a CLI / Claude Code plugin that orchestrates other tools (git, gh, npm, the user's installed source adapters). Issues that arise from:

- The user's own scripts or templates after `init`/`upgrade`
- The user's `.shipwrights.yml` configuration (e.g., enabling auto-merge in a repo without proper review)
- Third-party agents installed via `agent: user:` or `agent: npm:`
- The orchestrator running on a compromised host

…are not vulnerabilities in this project, but we'll still acknowledge the report and help where we can.
