#!/usr/bin/env node
// Shipwright CLI entry point. Backs the slash commands with executable
// behaviour for environments outside Claude Code (CI, local scripts).
//
//   shipwright init [--dry-run | --non-interactive | --force]
//   shipwright doctor
//   shipwright status
//   shipwright upgrade [--finalize]

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
Shipwright — orchestration framework for shipping epics with AI specialists.

Usage:
  shipwright init     [--dry-run | --non-interactive | --force]
  shipwright doctor
  shipwright status
  shipwright upgrade  [--finalize]

For full docs: https://github.com/dacostaaboagye/shipwright
`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
