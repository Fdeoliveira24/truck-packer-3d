# App.js Production Defect Fix Plan

**Date:** 2026-07-21
**Audit:** [App.js Production Defect Audit](./app-js-production-defect-audit.md)
**Scope:** Eight confirmed defects only. No modularization, extraction, redesign, or unrelated cleanup.

## Implementation principles

- Preserve current APIs and ownership boundaries.
- Add the smallest state-boundary or lifecycle guard that prevents the confirmed trigger.
- Keep viewing, navigation, camera control, and unrelated behavior unchanged.
- Add focused regression coverage beside existing tests.
- Make every phase independently reviewable and validate only its affected surfaces before moving
  to the next phase.

Branches are intentionally stacked in execution order. Each phase branch starts from the preceding
phase's verified commit so the final Phase 4 branch represents the complete stabilization result.

## Phase 1 — Data integrity boundaries

**Branch:** `fix/app-js-data-integrity-boundaries`
**Defects:** DEF-001, DEF-002, DEF-003
**Commit:** `fix: protect scoped data integrity boundaries`

### DEF-001 — Scoped history reset

1. Extend `StateStore.replace()` with an explicit history-reset option.
2. Rebase history to the replacement state's history slice when that option is set.
3. Use the option only in workspace/user empty, loaded, and seeded state replacements.
4. Leave imports and ordinary same-scope changes on the existing undo stack.

**Focused verification:**

- A→B replacement followed by Undo/Redo cannot restore A.
- Multiple same-scope edits still undo and redo normally.

### DEF-002 — Non-destructive legacy migration

1. Stop deleting or destructively copying the legacy payload during initial read.
2. Recognize combined legacy workspace arrays as a valid fallback payload.
3. Defer splitting while user or workspace scope is unresolved.
4. Once both scopes are resolved, write the workspace payload first, verify it, write/verify the
   user preferences payload, then remove the unscoped source if applicable.
5. Recover user-scoped combined payloads left by the prior migration implementation.

**Focused verification:**

- Anonymous/no-org load returns legacy packs/cases without deleting the source.
- Authenticated workspace load writes the split payload and only then removes the source.
- A simulated failed migration keeps the source payload intact.
- Already split storage behavior remains unchanged.

### DEF-003 — Autosave flush before boundary changes

1. Add `flush()` and `cancel()` controls to the existing debounce return value.
2. Expose `Storage.flushPendingSave()` and `Storage.cancelPendingSave()` without changing normal
   `saveSoon()` behavior.
3. Flush before workspace scope changes, confirmed user isolation, signed-out cleanup, logout local
   reset, and confirmed no-workspace clearing.
4. Keep `suspendAutoSave` active during replacement so the boundary reset does not enqueue a new
   save.

**Focused verification:**

- A pending A edit is written to A before scope B is selected.
- Flushing executes once and cancels the delayed callback.
- Scope replacement itself does not schedule stale persistence.

### Phase 1 exit gate

- Focused StateStore/storage/autosave tests pass.
- Related existing persistence and user-switch invariant tests pass.
- Lint/typecheck for changed files have no new errors.
- Diff contains no billing, cross-tab, operation, or auth behavior changes beyond the required
  boundary flush call sites.

## Phase 2 — Cross-tab reliability

**Branch:** `fix/app-js-cross-tab-reliability`
**Defects:** DEF-004, DEF-007
**Commit:** `fix: improve cross tab state reliability`

### DEF-004 — Globally comparable workspace ordering

1. Retain the existing payload, event, storage key, user guard, and workspace application flow.
2. Anchor local epochs to wall time and derive incoming order from the strongest available
   epoch/timestamp value, so a fresh tab does not restart at one.
3. Use the existing tab identifier as a deterministic tie-break when two tabs emit the same logical
   version.
4. Apply the same stale comparator to storage and local custom-event handlers.
5. Cancel the legacy active-org fallback only after a canonical payload is parsed and accepted.

**Focused verification:**

- A fresh tab's newer timestamp outranks an established tab's older counter-only epoch.
- A valid low local counter cannot be rejected solely because the tab is new.
- Equal epochs resolve deterministically by tab ID.
- Wrong-user, same-tab, malformed, and genuinely older payloads remain rejected.
- A rejected canonical payload does not cancel the legacy refresh fallback.

### DEF-007 — Retry after dead billing lock

1. Read the current lock timestamp through the existing key compatibility layer.
2. Compute a bounded delay from the remaining TTL plus a small expiry margin.
3. Keep the existing single retry and shared-result handling.

**Focused verification:**

- A fresh foreign lock produces a delay at or beyond its remaining TTL.
- An almost-expired or invalid lock uses a bounded minimum delay.
- A retry-tagged request does not create an unbounded loop.

### Phase 2 exit gate

- Focused org-order and billing-lock tests pass.
- Existing auth/org/billing invariants pass.
- No entitlement semantics, backend calls, or workspace-switch ordering are otherwise changed.

## Phase 3 — Operation lifecycle protection

**Branch:** `fix/app-js-operation-lifecycle-guards`
**Defect:** DEF-005
**Commit:** `fix: protect mutations during active operations`

1. Inject the existing `OperationLifecycle` instance into Packs/Cases and their import-dialog
   factories.
2. Add one small busy-check helper in each screen and dialog, using the existing toast pattern.
3. Guard pack/case create, open/switch, edit, rename, duplicate, delete, import, folder/category
   mutation, move, and Packs-screen truck-change operations at their commit edges.
4. Pass a `beforeMutate` guard into the shared Case modal so Save and Add Category re-check the
   lifecycle.
5. Reuse `editorMutationBlocked()` at the uncovered editor New Case, visibility, category, Item
   Notes, and manual-position commits.
6. Guard `clearPackPreview()` in `ExportService`.
7. Do not block screen navigation, viewing, export/read-only actions, or camera controls.

**Focused verification:**

- Every identified Packs/Cases/dialog/editor mutation entry point checks the shared lifecycle at
  the commit edge, including after asynchronous confirmation or file parsing.
- Navigation remains unguarded and available.
- Preview capture retains its existing lifecycle behavior; preview clearing is rejected while busy.
- Existing AutoPack/Unpack/Truck Change lifecycle tests pass.

### Phase 3 exit gate

- Focused screen/lifecycle source-contract tests pass.
- Existing operation-lifecycle and AutoPack tests pass.
- No second lock, new global state, or UI pattern is introduced.

## Phase 4 — Auth reliability

**Branch:** `fix/app-js-auth-reliability`
**Defects:** DEF-006, DEF-008
**Commit:** `fix: improve authentication recovery reliability`

### DEF-006 — Retryable invite token retention

1. Add a small terminal-failure classifier based on the backend's established safe messages.
2. Centralize pending-token removal.
3. Remove the token after success or confirmed terminal failure only.
4. Retain it for network, timeout, server, malformed-response, or unexpected failures so startup or
   a later auth refresh can retry.

**Focused verification:**

- Success and expired/revoked/not-found/wrong-email failures clear the token.
- Network and generic server failures preserve memory and session-storage copies.
- Raw tokens remain absent from logs and rendered copy.

### DEF-008 — Deterministic logout without timer reload

1. Remove the logout fallback timer and its reload path.
2. Route the custom signed-out event through the existing destructive signed-out cleanup.
3. Preserve the user-initiated flag before releasing the logout latch.
4. If the auth wrapper does not emit the event, complete the same cleanup after `signOut()` settles.
5. Keep canonical storage, org, billing, user-switch, and overlay cleanup behavior.

**Focused verification:**

- No timer or reload exists in the user-initiated logout path.
- The custom signed-out event reaches full signed-out cleanup.
- A missing/delayed Supabase auth callback still leaves deterministic signed-out UI and cleared
  authority.
- Existing cross-tab logout and transient signed-out guards pass.

### Phase 4 exit gate

- Focused invite/logout tests pass.
- Existing auth, invite, user-switch, and billing isolation invariants pass.
- No auth timeout, session, or backend authorization semantics are weakened.

## Final validation

After Phase 4:

1. run all focused tests added for DEF-001 through DEF-008;
2. run `npm test` once;
3. run `npm run lint`, `npm run -s typecheck`, and `git diff --check`;
4. perform a signed-out browser startup smoke test;
5. update Graphify because production source changed; and
6. record authenticated browser scenarios as remaining QA if credentials are unavailable.
