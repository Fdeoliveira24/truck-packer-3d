# App.js Preparation Change Policy

**Status:** Active

**Date:** 2026-07-21

**Applies to:** PREP-0 and subsequent App.js stabilization-preparation branches until the readiness
gates authorize creation of an App.js Modularization Master Execution Plan

## Purpose

This policy keeps preparation work behavior-neutral, reviewable, and traceable to the verified
post-stabilization baseline. It prevents preparation from becoming an unreviewed refactor or an
implicit modularization effort.

The baseline is recorded in `docs/engineering/app-js-prep-0-baseline-record.md`. The controlling
scope and readiness gates are defined in
`docs/engineering/app-js-stabilization-and-modularization-preparation-plan.md`.

## Governing rule

Preparation may document and characterize the current application. It may not move, redesign, or
silently change it. DEF-001 through DEF-008 remain completed and their behavior is protected as the
regression baseline.

## Allowed changes

### Allowed in PREP-0

Only the following additions are allowed in PREP-0:

- `docs/engineering/app-js-prep-0-baseline-record.md`
- `docs/engineering/app-js-preparation-change-policy.md`

Read-only repository inspection, Graphify queries, and validation commands are allowed because they
do not change application state or tracked files.

### Allowed in a later preparation phase with an approved branch brief

A later preparation branch may make only the changes expressly listed in its reviewed brief, such
as:

- current-state ownership ledgers and lifecycle documentation;
- startup, side-effect, public-surface, and callback inventories;
- behavior-characterization tests and controlled fixtures;
- conversion of source-location assertions into equivalent behavior or architecture assertions;
- recorded test, browser, failure-injection, and readiness-audit evidence;
- status updates to the controlling preparation document.

These allowances do not carry automatically from one branch to the next.

## Changes requiring explicit review and separate authorization

The following are not routine preparation changes. They require a written problem statement,
approved scope, named files, risk assessment, dedicated branch, focused tests, full regression
results, and manual verification where relevant:

- any edit under `src/`;
- any edit under `tests/` or addition of a test dependency/harness;
- any package manifest, lockfile, configuration, build, CI, or deployment change;
- any change to a public/global facade, callback contract, listener, timer, channel, or startup
  order;
- any change to auth, billing, org/workspace, persistence, cross-tab, or operation-lifecycle
  behavior;
- a standalone fix for a newly confirmed defect, including the unresolved
  `window.TruckPackerApp` facade behavior;
- deletion of suspected dead code or removal of compatibility surfaces;
- warning cleanup, logging changes, annotations, or navigation comments in runtime files.

Approval for one item does not authorize adjacent cleanup or structural movement. A standalone
defect fix must preserve the preparation scope: fix the confirmed behavior only, then return to the
last verified preparation baseline.

## Forbidden changes

The following are forbidden throughout stabilization preparation unless and until a separate
Master Execution Plan is authorized:

- extracting, moving, splitting, or renaming App.js responsibilities;
- creating destination modules for future App.js code;
- selecting or implementing an extraction order;
- introducing a replacement architecture, ownership model, state authority, or dependency graph;
- changing the StateStore singleton model or persistence scope model;
- reordering construction, initialization, listeners, subscribers, timers, callbacks, or boot
  phases as cleanup;
- merging or consolidating duplicated-looking auth, billing, workspace, storage, render, or browser
  event paths without behavioral proof and separate approval;
- changing billing entitlement semantics or owner-only money actions;
- weakening user/workspace isolation, freshness, epoch, operation-lifecycle, or stale-result guards;
- weakening, deleting, or skipping tests merely to make future file movement pass;
- mixing refactoring, cleanup, formatting, or dead-code removal with a behavior change;
- broad formatting or unrelated edits;
- claiming modularization readiness from file size, static analysis, or source-text tests alone.

## Review requirements

Every preparation change must state:

- the preparation phase and governing document section;
- confirmed facts versus assumptions or unresolved decisions;
- exact files allowed to change;
- expected behavior impact, which is normally `none`;
- risk level and P0-sensitive surfaces involved;
- automated commands and manual checks required;
- rollback boundary;
- evidence produced for a readiness gate.

Review must reject a change when its scope is broader than its evidence, when a location-based test
is removed without equivalent protection, or when a documentation task includes an unexplained
runtime diff.

## Branch discipline

1. Start each phase from the last reviewed and verified preparation commit.
2. Use one branch per preparation phase or independently reviewed defect. Use the `chore/app-js-`
   prefix for documentation and characterization work; use `fix/app-js-` only for an approved
   standalone defect.
3. Record the base commit and confirm a clean worktree before editing.
4. Put the exact allowed file list in the branch brief before work starts.
5. Do not carry unrelated local changes into the branch. Existing user changes must be preserved
   and excluded from the preparation diff.
6. Do not broaden the phase because adjacent work appears easy.
7. Rebase or stack only from reviewed commits; do not silently absorb an unverified runtime change.

## Commit discipline

- Keep commits atomic and single-purpose.
- Separate documentation, characterization tests, dependency/fixture setup, and approved defect
  fixes into distinct commits.
- Do not combine runtime changes with refactoring, file movement, formatting, or dead-code cleanup.
- Use commit messages that identify the preparation phase and outcome.
- Record the verified commit hash and validation results before starting the next branch.
- If a commit changes an unapproved file, stop and remove that change from the preparation scope
  without disturbing unrelated user work.

## Validation discipline

### Documentation-only change

- confirm `git status --short` lists only the approved Markdown files;
- run a whitespace/diff check for new and tracked files;
- inspect the final diff for source, test, configuration, dependency, or graph-output changes;
- do not claim application test coverage was re-run when it was not required.

### Characterization-test change

- run the focused characterization tests;
- run the DEF-001 through DEF-008 regression set;
- run the full default suite, typecheck, lint, and diff checks;
- document skips, warnings, environment limits, and browser coverage precisely.

### Approved standalone behavior fix

- meet all characterization-test requirements;
- perform the risk-specific browser/manual matrix;
- verify no extraction or unrelated cleanup entered the diff;
- update Graphify after significant code changes in accordance with repository rules;
- record the new baseline only after review and green verification.

## Stop conditions

Stop the branch and request a scope decision when:

- evidence reveals a new production defect;
- intended behavior is ambiguous or conflicts with product/domain rules;
- required work would touch a frozen file not named in the branch brief;
- a test cannot be made behavior-focused without changing production behavior;
- a preparation artifact begins prescribing module destinations or extraction order;
- validation exposes a regression in DEF-001 through DEF-008 or another P0 surface.

The correct response to a stop condition is a documented blocker or a separately approved branch,
not an expanded preparation diff.

## PREP-0 enforcement

For PREP-0, the policy is absolute: add only the baseline record and this policy. Do not modify
`src/`, `tests/`, existing documentation, configuration, dependencies, or generated graph files.
