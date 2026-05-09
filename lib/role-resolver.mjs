import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

const PLUGIN_AGENTS_DIR = new URL("../agents/", import.meta.url);

function pluginAgentPath(name) {
  return new URL(`${name}.md`, PLUGIN_AGENTS_DIR).pathname.replace(/^\/(\w):/, "$1:");
}

export function resolveRole(role, { projectRoot }) {
  const ref = role.agent ?? "bundled";

  if (ref === "bundled" || ref?.ref === "bundled") {
    const path = pluginAgentPath(role.name);
    if (!existsSync(path)) {
      throw new Error(`Bundled agent not found for role "${role.name}" at ${path}`);
    }
    return { kind: "bundled", path, content: readFileSync(path, "utf8") };
  }

  if (ref?.user) {
    const userPath = join(homedir(), ".claude", "agents", `${ref.user}.md`);
    if (!existsSync(userPath)) {
      throw new Error(`User-global agent "${ref.user}" not found at ${userPath}`);
    }
    return { kind: "user", path: userPath, content: readFileSync(userPath, "utf8") };
  }

  if (ref?.custom) {
    const customPath = isAbsolute(ref.custom) ? ref.custom : resolve(projectRoot, ref.custom);
    if (!existsSync(customPath)) {
      throw new Error(`Custom agent for role "${role.name}" not found at ${customPath}`);
    }
    return { kind: "custom", path: customPath, content: readFileSync(customPath, "utf8") };
  }

  if (ref?.npm) {
    return { kind: "npm", package: ref.npm };
  }

  throw new Error(`Unrecognized agent ref shape for role "${role.name}": ${JSON.stringify(ref)}`);
}
