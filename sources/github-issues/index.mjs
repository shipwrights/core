// GitHub Issues source adapter.
//
// Treats GitHub Issues with a configured label set as the backlog.
// Materialise creates an epic file from the issue's title + body. Status
// changes write back to the issue (close on shipped, label changes for
// intermediate states). attachPR adds a comment + closes if appropriate.

import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

function gh(args, cwd) {
  return execSync(`gh ${args}`, { cwd, encoding: "utf8" });
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function epicIdFromIssue(issue, idPrefix = "GH") {
  const fromLabel = issue.labels?.find((l) => /^id:/.test(l.name));
  if (fromLabel) return fromLabel.name.replace(/^id:/, "").toUpperCase();
  return `${idPrefix}-${issue.number}`;
}

export function createSource({
  projectRoot,
  repo,
  labels = ["backlog"],
  state_dir = "docs/backlog/epics",
  idPrefix = "GH",
} = {}) {
  if (!repo) {
    throw new Error("github-issues source requires `repo` config (owner/name)");
  }
  const epicsDir = join(projectRoot, state_dir);

  function listIssues(filter = {}) {
    const labelArg = (filter.labels ?? labels).map((l) => `--label "${l}"`).join(" ");
    const out = gh(
      `issue list --repo ${repo} ${labelArg} --state open --json number,title,body,labels,milestone,updatedAt --limit 200`,
      projectRoot,
    );
    return JSON.parse(out);
  }

  return {
    async healthcheck() {
      try {
        gh(`repo view ${repo} --json name`, projectRoot);
      } catch (err) {
        throw new Error(`Cannot access repo ${repo} via gh CLI: ${err.message}`);
      }
      if (!existsSync(epicsDir)) mkdirSync(epicsDir, { recursive: true });
    },

    async listAvailable(filter = {}) {
      const issues = listIssues(filter);
      return issues.map((i) => ({
        id: epicIdFromIssue(i, idPrefix),
        title: i.title,
        description: i.body,
        status: "idea",
        priority: extractLabel(i, "priority:") ?? "P2",
        size: extractLabel(i, "size:") ?? "medium",
        domain: extractLabel(i, "domain:") ?? "full-stack",
        parents: [],
        metadata: { issueNumber: i.number, repo },
      }));
    },

    async pickNext(criteria = {}) {
      const items = await this.listAvailable(criteria);
      const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
      items.sort((a, b) => (order[a.priority] ?? 99) - (order[b.priority] ?? 99));
      return items[0] ?? null;
    },

    async materialize(item, targetDir) {
      const dir = targetDir ?? epicsDir;
      mkdirSync(dir, { recursive: true });
      const slug = slugify(item.title);
      const path = join(dir, `${item.id}-${slug}.md`);
      const created = !existsSync(path);
      if (created) {
        const stub = `---\nid: ${item.id}\ntitle: ${item.title}\nstatus: idea\npriority: ${item.priority}\ndomain: ${item.domain}\nowner: claude\nparents: []\nacceptance: []\nsize: ${item.size}\nsource:\n  kind: github-issues\n  repo: ${item.metadata.repo}\n  issue: ${item.metadata.issueNumber}\n---\n\n## Why\n\n${item.description ?? ""}\n`;
        writeFileSync(path, stub, "utf8");
      }
      return { epicFilePath: path, created };
    },

    async markStatus(itemId, status) {
      // For now: status changes write a comment + add a status:<x> label.
      // Closing on shipped is opt-in via config to avoid surprises.
      try {
        const issues = listIssues();
        const target = issues.find((i) => epicIdFromIssue(i, idPrefix) === itemId);
        if (!target) return;
        gh(`issue edit ${target.number} --repo ${repo} --add-label "status:${status}"`, projectRoot);
      } catch (err) {
        console.warn(`[shipwright] gh status update failed: ${err.message}`);
      }
    },

    async attachPR(itemId, prUrl) {
      try {
        const issues = listIssues();
        const target = issues.find((i) => epicIdFromIssue(i, idPrefix) === itemId);
        if (!target) return;
        gh(
          `issue comment ${target.number} --repo ${repo} --body "Shipped via ${prUrl}"`,
          projectRoot,
        );
      } catch (err) {
        console.warn(`[shipwright] gh attachPR failed: ${err.message}`);
      }
    },
  };
}

function extractLabel(issue, prefix) {
  return issue.labels?.find((l) => l.name.startsWith(prefix))?.name.slice(prefix.length);
}

export default createSource;
