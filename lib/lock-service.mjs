// Lock service abstraction.
//
// Default backend: markdown register at docs/process/in-flight.md.
// Alternative backends: github-issues (label-based) and custom (npm package).
//
// All backends implement the same interface so /shipwrights-status and the
// pipeline engine work without knowing which backend is configured.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_REGISTER_PATH = "docs/process/in-flight.md";
const HEADER = `| Branch | Epic | Stage | Tier | Active specialists | Updated |
|---|---|---|---|---|---|`;

function readRegister(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    if (m[1] === "Branch" || m[1].startsWith("---")) continue;
    rows.push({
      branch: m[1],
      epic: m[2],
      stage: m[3],
      tier: m[4],
      specialists: m[5].trim() ? m[5].split(",").map((s) => s.trim()) : [],
      updated: m[6],
    });
  }
  return rows;
}

function writeRegister(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const body = rows
    .map(
      (r) =>
        `| ${r.branch} | ${r.epic} | ${r.stage} | ${r.tier} | ${(r.specialists ?? []).join(", ") || "—"} | ${r.updated} |`,
    )
    .join("\n");
  const content = rows.length > 0
    ? `# In-flight branches\n\n${HEADER}\n${body}\n`
    : `# In-flight branches\n\n_(none currently in flight)_\n`;
  writeFileSync(path, content, "utf8");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

class MarkdownLock {
  constructor({ projectRoot, registerPath = DEFAULT_REGISTER_PATH, staleAfterHours = 48 } = {}) {
    this.projectRoot = projectRoot;
    this.registerPath = join(projectRoot, registerPath);
    this.staleAfterHours = staleAfterHours;
  }

  async list() {
    const rows = readRegister(this.registerPath);
    return rows.map((r) => ({ ...r, stale: this.#isStale(r) }));
  }

  async claim({ branch, epic, stage, tier, specialists = [] }) {
    const rows = readRegister(this.registerPath);
    const existing = rows.find((r) => r.epic === epic);
    if (existing && existing.branch !== branch) {
      return { ok: false, reason: `epic ${epic} already in flight on ${existing.branch}`, existing };
    }
    const updated = todayIso();
    if (existing) {
      Object.assign(existing, { stage, tier, specialists, updated });
    } else {
      rows.push({ branch, epic, stage, tier, specialists, updated });
    }
    writeRegister(this.registerPath, rows);
    return { ok: true };
  }

  async update({ branch, fields }) {
    const rows = readRegister(this.registerPath);
    const row = rows.find((r) => r.branch === branch);
    if (!row) return { ok: false, reason: `no register entry for ${branch}` };
    Object.assign(row, fields, { updated: todayIso() });
    writeRegister(this.registerPath, rows);
    return { ok: true };
  }

  async release({ branch }) {
    const rows = readRegister(this.registerPath);
    const next = rows.filter((r) => r.branch !== branch);
    writeRegister(this.registerPath, next);
    return { ok: true };
  }

  #isStale(row) {
    try {
      const out = execSync(
        `git log -1 --since="${this.staleAfterHours} hours ago" --format=%h ${row.branch}`,
        { cwd: this.projectRoot, encoding: "utf8" },
      ).trim();
      return out.length === 0;
    } catch {
      return false;
    }
  }
}

class GithubIssuesLock {
  constructor({ projectRoot, repo, labelPrefix = "in-flight", staleAfterHours = 48 }) {
    this.projectRoot = projectRoot;
    this.repo = repo;
    this.labelPrefix = labelPrefix;
    this.staleAfterHours = staleAfterHours;
  }

  #gh(args) {
    return execSync(`gh ${args}`, { cwd: this.projectRoot, encoding: "utf8" });
  }

  async list() {
    const out = this.#gh(
      `issue list --repo ${this.repo} --label "${this.labelPrefix}" --state open --json number,title,labels,updatedAt --limit 100`,
    );
    const issues = JSON.parse(out);
    return issues.map((i) => {
      const labels = i.labels.map((l) => l.name);
      const stage = labels.find((l) => l.startsWith("stage:"))?.slice(6) ?? "unknown";
      const tier = labels.find((l) => l.startsWith("tier:"))?.slice(5) ?? "unknown";
      return {
        branch: i.title.match(/^\[(.+?)\]/)?.[1] ?? "unknown",
        epic: i.title.replace(/^\[.+?\]\s*/, ""),
        stage,
        tier,
        specialists: labels.filter((l) => l.startsWith("specialist:")).map((l) => l.slice(11)),
        updated: i.updatedAt.slice(0, 10),
        stale: this.#isStale(i.updatedAt),
        issueNumber: i.number,
      };
    });
  }

  #isStale(updatedAt) {
    const ms = Date.now() - new Date(updatedAt).getTime();
    return ms / 36e5 > this.staleAfterHours;
  }
  // claim/update/release omitted in v1 — implement when github-issues is enabled
}

const BUILTIN_LOCKS = {
  markdown: MarkdownLock,
  "github-issues": GithubIssuesLock,
};

export class LockService {
  static async create({ projectRoot, lockConfig = {} }) {
    const kind = lockConfig.kind ?? "markdown";
    if (BUILTIN_LOCKS[kind]) {
      const Cls = BUILTIN_LOCKS[kind];
      return new Cls({ projectRoot, ...(lockConfig.config ?? {}) });
    }
    if (kind === "custom") {
      const pkg = lockConfig.config?.package;
      if (!pkg) throw new Error("lock.kind: custom requires lock.config.package");
      const resolved = require.resolve(pkg, { paths: [projectRoot] });
      const mod = await import(resolved);
      const factory = mod.createLock ?? mod.default;
      return factory({ projectRoot, ...(lockConfig.config ?? {}) });
    }
    throw new Error(`Unknown lock kind: ${kind}`);
  }
}
