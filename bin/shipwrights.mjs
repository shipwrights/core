#!/usr/bin/env node
// Shipwrights CLI entry point. Backs the slash commands with executable
// behaviour for environments outside Claude Code (CI, local scripts).
//
//   shipwrights init           [--dry-run | --non-interactive | --force]
//   shipwrights doctor
//   shipwrights status
//   shipwrights upgrade
//   shipwrights spec <description>        [--auto] [--context-depth ...] [--output-dir ...]
//   shipwrights spec-approve <S-id>
//   shipwrights spec-revise  <S-id> <note>
//   shipwrights spec-cancel  <S-id>

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "init": {
      const { runInit } = await import("../lib/commands/init.mjs");
      await runInit({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("../lib/commands/doctor.mjs");
      await runDoctor({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "status": {
      const { runStatus } = await import("../lib/commands/status.mjs");
      await runStatus({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "upgrade": {
      const { runUpgrade } = await import("../lib/commands/upgrade.mjs");
      await runUpgrade({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "spec": {
      const { runSpec } = await import("../lib/commands/spec.mjs");
      await runSpec({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "spec-approve": {
      const { runSpecApprove } = await import("../lib/commands/spec-approve.mjs");
      await runSpecApprove({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "spec-revise": {
      const { runSpecRevise } = await import("../lib/commands/spec-revise.mjs");
      await runSpecRevise({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case "spec-cancel": {
      const { runSpecCancel } = await import("../lib/commands/spec-cancel.mjs");
      await runSpecCancel({ projectRoot: process.cwd(), pluginRoot: root, args });
      break;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      printHelp();
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(2);
    }
  }
}

function printHelp() {
  console.log(`
Shipwrights — orchestration framework for shipping epics with AI specialists.

Usage:
  shipwrights init                       [--dry-run | --non-interactive | --force]
  shipwrights doctor
  shipwrights status
  shipwrights upgrade

  shipwrights spec <description>         [--auto] [--context-depth ...] [--output-dir ...]
  shipwrights spec-approve <S-id>
  shipwrights spec-revise  <S-id> <note>
  shipwrights spec-cancel  <S-id>

For full docs: https://github.com/shipwrights/core
`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
