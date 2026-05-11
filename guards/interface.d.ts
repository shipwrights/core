// Guard adapter contract.
//
// Bundled guards live under `guards/`. External guards are npm packages or
// shell commands declared in `.shipwrights.yml` under `guards[].runs`.

export interface GuardContext {
  projectRoot: string;
  changedFiles: string[];
  config: Record<string, unknown>;
}

export interface GuardViolation {
  file?: string;
  line?: number;
  message: string;
}

export interface GuardResult {
  status: "pass" | "warn" | "block";
  violations?: GuardViolation[];
}

export type Guard = (ctx: GuardContext) => GuardResult | Promise<GuardResult>;
