import { loadConfig } from "../config-loader.mjs";
import { LockService } from "../lock-service.mjs";

export async function runStatus({ projectRoot }) {
  const config = loadConfig(projectRoot);
  const lock = await LockService.create({ projectRoot, lockConfig: config.lock ?? {} });
  const rows = await lock.list();
  if (rows.length === 0) {
    console.log("Nothing in flight.");
    console.log("\nTo start an epic:");
    console.log("  /shipwrights-epic <id>      # by id");
    console.log("  /shipwrights-epic           # picks the next ready epic");
    return;
  }

  const cols = ["Branch", "Epic", "Stage", "Tier", "Active specialists", "Updated", "Stale?"];
  const widths = cols.map((c) => c.length);
  const data = rows.map((r) => [
    r.branch,
    r.epic,
    r.stage,
    r.tier,
    (r.specialists ?? []).join(", ") || "—",
    r.updated,
    r.stale ? "⚠ stale" : "",
  ]);
  for (const row of data) {
    row.forEach((v, i) => {
      widths[i] = Math.max(widths[i], String(v).length);
    });
  }
  const fmt = (row) => row.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  console.log("In flight:");
  console.log(fmt(cols));
  console.log(fmt(widths.map((w) => "-".repeat(w))));
  data.forEach((row) => console.log(fmt(row)));
  const stale = rows.filter((r) => r.stale);
  if (stale.length > 0) {
    console.log(`\n${stale.length} stale entries — resume, archive, or delete.`);
  }
}
