// Given a signals object from project-signals.mjs, propose a set of
// project-specific agents that would be worth generating. Pure function.
//
// Each proposal has:
//   {
//     slug: "arms-frontend-vue-specialist",       // file name (no .md)
//     archetype: "frontend",                       // template family
//     name: "Frontend Vue specialist (ARMS)",      // human-readable
//     reason: "Vue 3 + Pinia + vue-quill detected",
//     wireToRole: "frontend",                       // optional — which role this would take over
//   }
//
// The skill renders these into a numbered list and asks the user to pick.

export function proposeAgents(signals) {
  const proposals = [];
  const base = projectShortName(signals);

  // ----- Frontend -----
  if (signals.framework === "vue3") {
    proposals.push({
      slug: `${base}-frontend-vue-specialist`,
      archetype: "frontend-vue",
      name: `Frontend Vue specialist (${base})`,
      reason: describeFrontendStack(signals),
      wireToRole: "frontend",
    });
  } else if (
    signals.framework === "react" ||
    signals.framework === "next"
  ) {
    proposals.push({
      slug: `${base}-frontend-react-specialist`,
      archetype: "frontend-react",
      name: `Frontend React specialist (${base})`,
      reason: describeFrontendStack(signals),
      wireToRole: "frontend",
    });
  } else if (signals.framework === "svelte") {
    proposals.push({
      slug: `${base}-frontend-svelte-specialist`,
      archetype: "frontend-svelte",
      name: `Frontend Svelte specialist (${base})`,
      reason: describeFrontendStack(signals),
      wireToRole: "frontend",
    });
  }

  // ----- Backend (Node-flavoured for now) -----
  if (
    signals.framework === "express" ||
    signals.framework === "fastify" ||
    signals.framework === "hono" ||
    signals.framework === "nestjs"
  ) {
    proposals.push({
      slug: `${base}-backend-${signals.framework}-specialist`,
      archetype: "backend-node",
      name: `Backend ${signals.framework} specialist (${base})`,
      reason: `${signals.framework} detected`,
      wireToRole: "backend",
    });
  }

  // ----- Domain expert (only if we found strong domain hints) -----
  if (signals.domainHints.length >= 1) {
    proposals.push({
      slug: `${base}-domain-expert`,
      archetype: "domain",
      name: `Domain expert (${base})`,
      reason: `domain hints: ${signals.domainHints.slice(0, 6).join(", ")}`,
      // Domain expert doesn't take over a pipeline role — it's available as
      // an additional consultant the orchestrator (or a user) can call.
      wireToRole: null,
    });
  }

  // ----- QA (only when test tooling is present) -----
  if (signals.testTool) {
    proposals.push({
      slug: `${base}-qa-engineer`,
      archetype: "qa",
      name: `QA engineer (${base})`,
      reason: `tests use ${signals.testTool}`,
      wireToRole: "qa",
    });
  }

  // ----- PDF / chart specialist (project-specific, opt-in feel) -----
  if (signals.stack.some((d) => /pdf/i.test(d))) {
    proposals.push({
      slug: `${base}-pdf-rendering-specialist`,
      archetype: "pdf-rendering",
      name: `PDF rendering specialist (${base})`,
      reason: `pdf libs in deps: ${signals.stack.filter((d) => /pdf/i.test(d)).join(", ")}`,
      wireToRole: null,
    });
  }

  return proposals;
}

// ----- helpers -----

export function projectShortName(signals) {
  const raw = signals.name ?? "project";
  // strip @scope/, hyphenate, lowercase, trim
  const cleaned = raw.replace(/^@[^/]+\//, "").toLowerCase();
  // Take up to 3 hyphenated tokens for brevity (e.g. arms-invoice-frontend-pro -> arms-invoice-frontend).
  return cleaned.split("-").slice(0, 3).join("-");
}

function describeFrontendStack(signals) {
  const bits = [signals.framework];
  for (const item of ["pinia", "redux", "@reduxjs/toolkit", "zustand", "@tanstack/react-query", "@tanstack/vue-query", "vue-router", "react-router-dom"]) {
    if (signals.stack.includes(item)) bits.push(item);
  }
  if (signals.styling) bits.push(signals.styling);
  if (signals.buildTool) bits.push(signals.buildTool);
  return `${bits.filter(Boolean).join(" + ")} detected`;
}
