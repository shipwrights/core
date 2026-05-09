import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePredicate } from "../lib/predicate.mjs";

test("equality on identifier paths", () => {
  assert.equal(evaluatePredicate("epic.size == 'small'", { epic: { size: "small" } }), true);
  assert.equal(evaluatePredicate("epic.size == 'small'", { epic: { size: "large" } }), false);
});

test("starts_with / ends_with", () => {
  assert.equal(evaluatePredicate("epic.id starts_with 'ops-'", { epic: { id: "ops-12" } }), true);
  assert.equal(evaluatePredicate("epic.id starts_with 'ops-'", { epic: { id: "E-04-08" } }), false);
  assert.equal(evaluatePredicate("epic.id ends_with '-D'", { epic: { id: "E-04-08-D" } }), true);
});

test("in / not in arrays", () => {
  assert.equal(evaluatePredicate("epic.size in ['small','medium']", { epic: { size: "small" } }), true);
  assert.equal(evaluatePredicate("epic.size not in ['small','medium']", { epic: { size: "large" } }), true);
});

test("&&, ||, parentheses", () => {
  const ctx = { epic: { size: "small", domain: "docs" }, tier: "trivial" };
  assert.equal(evaluatePredicate("epic.size == 'small' && epic.domain == 'docs'", ctx), true);
  assert.equal(
    evaluatePredicate("(tier == 'trivial' || tier == 'minimal') && epic.size != 'large'", ctx),
    true,
  );
});

test("rejects unknown identifiers as undefined (no crash)", () => {
  assert.equal(evaluatePredicate("epic.missing == 'x'", { epic: {} }), false);
});

test("invalid expression throws", () => {
  assert.throws(() => evaluatePredicate("epic.size ==", { epic: {} }));
});
