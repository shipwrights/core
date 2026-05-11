// Backlog source adapter contract.
//
// Any package exporting `createSource(config) -> BacklogSource` is a valid
// adapter. Packages can be `@shipwrights/source-<kind>` (auto-discovered by
// kind name) or any npm package referenced by full name in `.shipwrights.yml`.

export type EpicStatus =
  | "idea"
  | "discovery"
  | "refined"
  | "designed"
  | "sliced"
  | "planned"
  | "built"
  | "integrated"
  | "tested"
  | "reviewed"
  | "ready-for-human-review"
  | "shipped";

export interface BacklogItem {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  size?: string;
  domain?: string;
  parents?: string[];
  metadata?: Record<string, unknown>;
}

export interface PickCriteria {
  /** Filter to items with these statuses; default ["refined", "ready"] (adapter-defined). */
  statuses?: string[];
  /** Filter to items at or above this priority. */
  minPriority?: string;
  /** Caller-defined tags to match. */
  tags?: string[];
}

export interface MaterializeResult {
  /** Path of the epic file written. */
  epicFilePath: string;
  /** Whether the file was newly created (vs updated). */
  created: boolean;
}

export interface BacklogSource {
  /** Light health check. Throws on unrecoverable problems (auth, missing dir, etc.). */
  healthcheck?: () => Promise<void>;

  /** All actionable items. Adapter decides what "actionable" means. */
  listAvailable(filter?: PickCriteria): Promise<BacklogItem[]>;

  /** The next item the orchestrator should work on, by adapter-specific priority. */
  pickNext(criteria?: PickCriteria): Promise<BacklogItem | null>;

  /** Write or rewrite the epic file from this item. */
  materialize(item: BacklogItem, targetDir: string): Promise<MaterializeResult>;

  /** Write back status changes (epic shipped, etc.) to the source system. */
  markStatus(itemId: string, status: EpicStatus): Promise<void>;

  /** Record a PR url against the item. */
  attachPR(itemId: string, prUrl: string): Promise<void>;
}

export type SourceFactory = (config: Record<string, unknown> & { projectRoot: string }) =>
  | BacklogSource
  | Promise<BacklogSource>;
