# Stage: slice

The orchestrator names which specialist owns which scope and freezes the contract surface. This stage is what makes parallel design+build possible — without a sharp slice, specialists collide at integration.

## Skip when

- Tier is `trivial` or `minimal` — these skip slice; the orchestrator does the whole thing inline.
- The epic already has `## Slice` populated (resuming).

## What you (orchestrator) do

1. **Read the refined epic.** Especially `## Acceptance` and `## Edge cases`.
2. **Identify the specialists this epic needs.** Based on `domain` and the work implied by acceptance:
   - `backend` if API / schema / service changes.
   - `frontend` if UI / component / token changes.
   - `qa` always (unless trivial tier).
   - `browser` if UI surface changed (decided post-build but planned here).
3. **Define the contract surface.** What types, endpoints, error envelopes, shared state will the specialists rely on. The contract surface is what's frozen after this stage.
4. **Allocate scope per role.** Each role's `capabilities.scope` from config is a *maximum* — the slice tightens it to the paths actually relevant to this epic.
5. **Spell out the inter-specialist contract.** Backend's slice describes what frontend will consume. Frontend's slice references what backend ships. Both reference the contract package's exact types.
6. **Write the `## Slice` section** into the epic file. Format:

   ```
   ## Slice

   **Frozen paths** (read-only after this point until re-slice):
   - packages/contracts/src/orders/*

   **Contract surface:**
   - `POST /api/orders/bulk` — body: `BulkOrdersRequest` from `@shop/contracts/orders`
   - Error envelope: standard `{ code, message, details? }`

   **Backend slice:**
   - Implements: `POST /api/orders/bulk` handler, the `BulkOrderService`, the migration for the new index
   - Files: apps/api/src/modules/orders/**, packages/contracts/src/orders/* (frozen — define this slice's types here, then frozen)
   - Tests: handler unit + service integration

   **Frontend slice:**
   - Implements: `<BulkOrderForm />`, list refresh on submit, error toast
   - Files: apps/web/src/app/admin/orders/**, apps/web/src/components/admin/orders/**
   - Consumes: `@shop/contracts/orders/bulk-orders-request`

   **QA slice (post-integrate):**
   - Edge cases for malformed bodies, partial failure, idempotency keys
   - Manual test plan for the human reviewer
   ```

7. **Commit the epic update.** On the feature branch, message: `chore(<id>): slice for <id> — frozen contract paths declared`.
8. **Bump status** to `sliced`.
9. **Hand off to design-and-build.** The slice document is now the input every specialist reads.

## Hard rule: freeze enforcement

Once the slice is committed, the listed `freeze_paths` are read-only for build-stage specialists. The scope-enforcer (`verify-specialist-scope.mjs`) blocks any commit on a scratch branch that touches a frozen path. Re-slicing requires escalation, not improvisation.

## Quality self-check before bumping status

- Every acceptance criterion maps to at least one specialist's slice.
- Every contract type the specialists will share is named explicitly with its file path.
- No two specialists have overlapping write scope (other than the contract surface, which is frozen anyway).
- The slice document tells frontend what backend will produce *before* backend writes a line of code.
- Frozen paths are listed.

## Escalations

- **The contract surface can't be defined upfront.** Some research-flavoured epics (the design IS the implementation). Either: split into a research epic + a build epic, or run the epic with `parallelism: sequential` so specialists go one at a time and the contract emerges as they go.
- **Two specialists need to write the same non-frozen file.** Re-allocate scope, or split the file before slice freezes.
- **A specialist needs a path that's outside their declared `capabilities.scope`.** Escalate to the user — this is a config-level decision.
