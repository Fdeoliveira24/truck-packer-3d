# App.js PREP-0 Baseline Record

**Status:** Verified preparation baseline

**Date:** 2026-07-21

**Phase:** PREP-0 — baseline and change-control hygiene

**Branch family:** App.js stabilization preparation

## Purpose

This record fixes the starting point for App.js modularization preparation after completion of the
production-defect stabilization program. PREP-0 is documentation-only. It does not change tests,
production code, application behavior, or runtime ownership.

The controlling preparation plan is
`docs/engineering/app-js-stabilization-and-modularization-preparation-plan.md`. Changes made from
this baseline must also follow `docs/engineering/app-js-preparation-change-policy.md`.

## Current state

| Item | Baseline |
| --- | --- |
| Current branch | `chore/app-js-prep-0-baseline-hygiene` |
| Baseline parent | `e4085a1` — `docs: add app js stabilization modularization preparation plan` |
| Branch family | `app-js` stabilization preparation |
| Stabilization state | Complete before PREP-0 |
| Production defects | DEF-001 through DEF-008 completed |
| PREP-0 runtime impact | None |
| PREP-0 source/test impact | None |
| Worktree at phase start | Clean |

The stabilization commits are present in the current branch ancestry:

| Stabilization phase | Commit | Completed defects |
| --- | --- | --- |
| Data integrity boundaries | `8d4a51b` | DEF-001, DEF-002, DEF-003 |
| Cross-tab reliability | `8ff5120` | DEF-004, DEF-007 |
| Operation lifecycle guards | `b2fb7c4` | DEF-005 |
| Auth reliability | `acf65ca` | DEF-006, DEF-008 |

## Completed stabilization work

- User/workspace history boundaries prevent undo/redo from restoring prior-scope data.
- Legacy migration preserves valid application data before removing legacy records.
- Pending persistence is handled safely at user/workspace scope transitions.
- Cross-tab workspace ordering accepts valid fresh-tab changes and rejects stale or wrong-scope
  messages.
- Packs, Cases, dialogs, editor mutations, and shortcuts respect the authoritative operation
  lifecycle where required.
- Invite state is retained for retryable failures and cleared for terminal outcomes.
- Billing coordination retries after an abandoned lock expires.
- Canonical logout completes without a competing timer-driven reload.

These completed outcomes are the regression baseline. PREP-0 does not reopen or reinterpret them.
A future reproducible regression must be tracked as a new finding with its own approved scope.

## Verification baseline

| Check | Recorded result |
| --- | --- |
| Stabilization-focused tests | 20 passed out of 20 |
| Full suite | 1,140 passed, 5 skipped, 0 failed |
| Typecheck | Passed |
| Lint | 0 errors |
| Signed-out browser validation | Passed |

The signed-out browser result confirms that the validated session remained stable without the
removed timed reload behavior. Authenticated owner/member, billing, invite, and same/cross-tab
matrices remain preparation evidence to complete; their absence does not invalidate the completed
stabilization baseline.

## Known remaining preparation work

The following work remains before a modularization execution plan may be written:

1. Document current state, persistence, listener, timer, channel, global, callback, and startup
   ownership.
2. Establish behavior-level characterization for startup, auth, billing, workspace switching,
   persistence, operation lifecycle, invite, logout, and failure recovery.
3. Retain genuine architectural invariants while removing test dependence on symbols remaining in
   `src/app.js` when file location is not the behavior under test.
4. Resolve and test the intended final `window.TruckPackerApp` public surface, including the
   feature-detected Leave Workspace and Transfer Ownership callbacks.
5. Complete authenticated owner/admin/member and same-tab/cross-tab browser verification.
6. Complete failure-injection evidence for unavailable services, timeouts, invalid persisted state,
   storage failure, stale responses, and partial initialization.
7. Perform a readiness re-audit against the gates in the controlling preparation plan.

None of this work authorizes extraction, module movement, destination design, or runtime ownership
changes.

## Frozen files and subsystems during PREP-0

### Frozen file scopes

- `src/` — no additions, edits, moves, renames, or deletions.
- `tests/` — no additions, edits, moves, renames, or deletions.
- Runtime configuration, dependency manifests, build scripts, and deployment files.
- Existing engineering and product documents, except when a later task explicitly names them.
- `graphify-out/` artifacts; PREP-0 contains no code change requiring a graph update.

### Frozen runtime subsystems

- App.js composition, boot sequence, initialization order, and ready/fatal handoff.
- Authentication, session stability, profile enforcement, and logout.
- Billing state, entitlement gates, checkout/portal actions, refresh pump, and cross-tab locks.
- Organization context, workspace selection, switching, rollback, and cross-tab synchronization.
- StateStore, scoped persistence, migration, autosave, history, and transient-state reset behavior.
- OperationLifecycle, AutoPack, Unpack, Truck Change, preview capture, and editor mutation guards.
- Root StateStore subscriber, global listeners, timers, channels, custom events, and retry behavior.
- Public and ambient globals, including `window.TruckPackerApp`, `window.OrgContext`, and
  `window.__TP3D_BILLING`.

Frozen means behavior and ownership remain unchanged. Read-only inspection and documentation of
the current behavior are permitted under the change policy.

## PREP-0 completion condition

PREP-0 is complete when this baseline record and the preparation change policy are reviewed, the
only branch changes are those two Markdown files, and documentation whitespace checks pass. No
application tests need to be re-run because PREP-0 changes neither source nor tests.
