import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

const PLUGIN_AGENTS_DIR = new URL("../agents/", import.meta.url);

// Map short role names to the bundled agent filename. Consumers naming their
// own roles (e.g., security-reviewer) supply their own agent ref via
// `{ user: ... }` or `{ custom: ... }`.
const BUNDLED_AGENT_FOR_ROLE = {
  po: "product-owner-strategist",
  backend: "node-backend-systems-architect",
  frontend: "frontend-ui-architect",
  qa: "qa-quality-engineer",
  gatekeeper: "code-review-gatekeeper",
  browser: "ux-ui-browser-reviewer",
};

function pluginAgentPath(name) {
  return new URL(`${name}.md`, PLUGIN_AGENTS_DIR).pathname.replace(/^\/(\w):/, "$1:");
}

export function resolveRole(role, { projectRoot }) {
  const ref = role.agent ?? "bundled";

  if (ref === "bundled" || ref?.ref === "bundled") {
    const filename = BUNDLED_AGENT_FOR_ROLE[role.name] ?? role.name;
    const path = pluginAgentPath(filename);
    if (!existsSync(path)) {
      throw new Error(
        `Bundled agent not found for role "${role.name}" at ${path}. ` +
          `Either rename the role to one of [${Object.keys(BUNDLED_AGENT_FOR_ROLE).join(", ")}] ` +
          `or supply { user: ... } / { custom: ... } in agent.`,
      );
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
