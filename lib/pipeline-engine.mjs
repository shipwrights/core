// Pipeline engine.
//
// Walks the consumer's `pipeline:` array, evaluating skip conditions, dispatching
// owners (the orchestrator agent or specialist agents), and integrating results.
//
// The engine itself does NOT spawn Claude Code agents — that's the host's job
// (Claude Code at runtime, or a CLI shim for tests). The engine returns
// "directives" that say "dispatch role X with these inputs"; the host invokes,
// returns the result; the engine advances.
//
// This separation makes the engine testable from plain Node without a live
// Claude API.

import { runGuards } from "./guard-runner.mjs";
import { evaluatePredicate } from "./predicate.mjs";

export class PipelineEngine {
	constructor({ config, telemetry, lock, projectRoot, host }) {
		this.config = config;
		this.telemetry = telemetry;
		this.lock = lock;
		this.projectRoot = projectRoot;
		this.host = host; // { dispatchAgent, runOrchestratorStep }
	}

	resolveTier(epic) {
		const rules = this.config.tier_routing ?? [];
		for (const rule of rules) {
			if (rule.default) return rule.default;
			if (rule.if && evaluatePredicate(rule.if, { epic })) {
				return rule.tier;
			}
		}
		return "full";
	}

	shouldSkipStage(stage, ctx) {
		if (stage.optional_when) {
			try {
				if (evaluatePredicate(stage.optional_when, ctx)) return true;
			} catch (err) {
				throw new Error(
					`Stage ${stage.stage} optional_when invalid: ${err.message}`,
				);
			}
		}
		const tierDef = this.config.tiers?.[ctx.tier];
		if (tierDef?.skip_stages?.includes(stage.stage)) return true;
		return false;
	}

	rolesForStage(stage) {
		const owners = stage.owner ?? [];
		return owners.map((name) => {
			if (name === "orchestrator")
				return { name: "orchestrator", isOrchestrator: true };
			const role = this.config.roles.find((r) => r.name === name);
			if (!role)
				throw new Error(`Stage ${stage.stage} owner "${name}" not in roles`);
			return role;
		});
	}

	async runStage(stage, ctx) {
		const stageStart = Date.now();
		const roles = this.rolesForStage(stage);
		const dispatched = [];

		if (stage.parallelism === "full" && roles.length > 1) {
			const promises = roles.map((role) => this.#dispatch(role, stage, ctx));
			const results = await Promise.all(promises);
			dispatched.push(...results);
		} else {
			for (const role of roles) {
				dispatched.push(await this.#dispatch(role, stage, ctx));
			}
		}

		const guardCtx = {
			projectRoot: this.projectRoot,
			stage: `before-${stage.stage}`,
			baseRef: ctx.integrationBranch ?? "HEAD~1",
		};
		const guardResults = await runGuards(this.config.guards ?? [], guardCtx);
		const blocking = guardResults.filter((r) => r.status === "block");
		if (blocking.length > 0) {
			this.telemetry?.recordStage({
				epicId: ctx.epicId,
				stage: stage.stage,
				tier: ctx.tier,
				role: "guards",
				durationMs: Date.now() - stageStart,
				status: "blocked",
			});
			return { ok: false, blockedBy: blocking, dispatched };
		}

		this.telemetry?.recordStage({
			epicId: ctx.epicId,
			stage: stage.stage,
			tier: ctx.tier,
			role: roles.map((r) => r.name).join("+"),
			durationMs: Date.now() - stageStart,
			tokensIn: dispatched.reduce((sum, d) => sum + (d.tokensIn ?? 0), 0),
			tokensOut: dispatched.reduce((sum, d) => sum + (d.tokensOut ?? 0), 0),
			status: "ok",
		});

		return { ok: true, dispatched, guards: guardResults };
	}

	async #dispatch(role, stage, ctx) {
		if (role.isOrchestrator) {
			return await this.host.runOrchestratorStep({ stage, ctx });
		}
		return await this.host.dispatchAgent({ role, stage, ctx });
	}

	async runEpic({ epic, integrationBranch }) {
		const tier = this.resolveTier(epic);
		const ctx = {
			epicId: epic.id,
			tier,
			epic,
			integrationBranch,
		};

		const claim = await this.lock.claim({
			branch: ctx.featureBranch ?? "(pending)",
			epic: epic.id,
			stage: "starting",
			tier,
			specialists: [],
		});
		if (!claim.ok) {
			return { ok: false, reason: "lock", claim };
		}

		const transitions = [];
		for (const stage of this.config.pipeline) {
			if (this.shouldSkipStage(stage, ctx)) {
				transitions.push({ stage: stage.stage, skipped: true });
				continue;
			}

			await this.lock.update({
				branch: ctx.featureBranch ?? "(pending)",
				fields: { stage: stage.stage },
			});

			const result = await this.runStage(stage, ctx);
			transitions.push({ stage: stage.stage, ...result });

			if (!result.ok) {
				await this.lock.update({
					branch: ctx.featureBranch ?? "(pending)",
					fields: { stage: `${stage.stage}:blocked` },
				});
				return { ok: false, transitions };
			}
		}

		return { ok: true, transitions };
	}
}

export async function runPipeline(opts) {
	const engine = new PipelineEngine(opts);
	return engine.runEpic(opts);
}
