# Cargo Instructions — Ownership Contract (Phase 0)

## Purpose

This document is the permanent architecture contract for Cargo Instructions: Standard Instructions (Case-owned), Instance Notes (Pack-instance-owned), and Pack Notes (Pack-owned). It must be read before changing `notes`/`instanceNotes` fields, Case↔Instance propagation, or the Inspector's Standard Instructions / Instance Notes surfaces.

Phase 0 was evidence-only: no production code changed, no user-visible functionality changed. This document locks the architecture; implementation proceeds per the phase plan in Section 8.

**Implementation status (2026-07-20):** Phase 1 (Standard Instructions, read-only Inspector card) and Phase 2 (Instance Notes, `instanceNotes`) are both implementation-complete, automated-test-validated, and committed on `feat/inspector-case-notes` at `ffd1d75` and `086004b` respectively. Live browser QA for both is outstanding — this environment has no dev-serve script and no Supabase credentials to authenticate past sign-in (confirmed directly). Phase 3 (Pack Notes Editor access) has not been started. See Section 8 for per-phase evidence.

---

## 1. Approved architecture decisions (locked)

1. **Standard Instructions belong to the Case.** They are template information, never edited from Pack mode, always visible in the Inspector as read-only information. **No modal.** They render directly inside their own Inspector card, explicitly labeled as inherited from the Case.
2. **Case edits propagate to every Pack Instance.** A Pack Instance references a Case by `caseId`; it is not a snapshot. (Validated against the current codebase in Section 4 — this is already true today, by construction, not new work.)
3. **The Pack-instance field is named `instanceNotes`, not `notes`.** The codebase already has `Case.notes`; a distinct name makes ownership unambiguous at every call site and in every diff.

---

## 2. Ownership diagram

```
Case  (src/services/case-library.js — CaseLibrary; canonical record)
├── Standard Instructions   (Case.notes — string | null)
├── Category
├── Manufacturer
├── Weight
├── Dimensions
├── Handling rules (orientationLock, noStackOnTop, maxStackCount, isPallet, ...)
└── Default Properties

        │ referenced by caseId (never copied/snapshotted)
        ▼

Pack Instance  (pack.cases[i] — element of Pack.cases, normalized by normalizeInstance())
├── Position / Rotation / Scale        (transform)
├── Loaded State                       (placement: 'packed' | 'staged', hidden)
├── Instance Notes                     (instanceNotes — implemented Phase 2, `086004b`)
├── Flags                              (orientationLocked, lockedRotation, packedProfile, deliverySequence)
└── Runtime Data                       (orientedDims, groupId)

        │ contained in Pack.cases[]
        ▼

Pack  (src/services/pack-library.js — PackLibrary; canonical record)
├── Truck                              (dimensions, shapeMode, shapeConfig)
├── Pack Notes                         (Pack.notes — string, already exists)
├── Pack Settings                      (title, client, projectName, drawnBy, folderId, groups)
├── AutoPack Results                   (transient; not part of the canonical Pack record)
└── Statistics                         (stats — totalCases, volumeUsed, cog, etc.)
```

This diagram is the single source of truth for where a Cargo Instructions field lives. Any future field must be placed at exactly one of these three levels — never duplicated across levels, never copied down from Case to Instance.

---

## 3. Ownership audit

| Field | Owner | Lives in | Why |
|---|---|---|---|
| Standard Instructions | Case | `CaseLibrary` record, `notes` key, normalized by `case.model.js::normalizeCase` and `normalizer.js::normalizeCase` (both route through the shared `cargo-canonical.js::parseCargoNotes`) | It is template information — describes the *kind* of cargo, identical to name, dimensions, category, and handling rules, all of which already live on the Case and are already shared across every placement of that Case |
| Instance Notes | Pack Instance | `pack.cases[i]`, normalized by `normalizer.js::normalizeInstance` (field does not exist yet — this phase only reserves the name) | It describes *this specific physical unit in this specific load* — e.g. "this one arrived with a dent," a fact that cannot be true of every unit of the Case, so it cannot live on the Case without corrupting every other placement |
| Pack Notes | Pack | `PackLibrary` record, `notes` key, normalized independently in three places: `pack.model.js::normalizePack`, `normalizer.js::normalizePack`, and inline in `pack-library.js::create()` | It describes the load plan as a whole — client, project, drawn-by, and truck live at the same level for the same reason: they describe the Pack, not any one item in it |

**Why Instance Notes cannot be named `notes`:** `Case.notes` and the future Pack-instance field would otherwise share an identical property name across two different owning objects that are frequently handled together in the same function (e.g. `renderSingleInspector(pack, inst, caseData, prefs)` already holds both `inst` and `caseData` in scope simultaneously). A future reader or a future spread/merge (`{...inst, ...caseData}`, a pattern already used elsewhere in this codebase for handling-rule flattening) could silently collide the two. `instanceNotes` removes that possibility structurally, not by convention alone.

---

## 4. Data contract

### Case owns (existing, unchanged by this phase)
- `notes` (Standard Instructions) — string or `null`, trimmed, whitespace-only → `null`. Canonical parser: `cargo-canonical.js::parseCargoNotes`, wired into `canonicalCargoForStorage()`.
- `category`, `manufacturer`, `weight`, `dimensions`, `hazmatClass`, handling-rule fields (`orientationLock`, `noStackOnTop`, `maxStackCount`, `isPallet`, `maxPalletWeight`, `laneItem`, `loadPriority`, `canFlip`, `stopGroup`, `keepTogetherGroup`), `color`.
- Canonical update path: `CaseLibrary.upsert(caseData)`.

### Pack Instance owns (Instance Notes is new; everything else already exists)
- `instanceNotes` — **implemented, Phase 2 (`086004b`).** Same contract as Standard Instructions: string or `null`, trimmed, whitespace-only → `null`. Normalized in `normalizer.js::normalizeInstance` (the only normalizer for instances — there is no `instance.model.js` counterpart to `case.model.js`).
- `transform` (position, rotation, scale), `placement` (`'packed' | 'staged' | null`), `hidden`, `groupId`, `orientationLocked`, `lockedRotation`, `orientedDims`, `deliverySequence`, `packedProfile`.
- Recommended canonical update path for `instanceNotes`: `PackLibrary.updateInstance(packId, instanceId, { instanceNotes })` — an existing, production-used, single-instance patch function (currently used for the `hidden` visibility toggle at `editor-screen.js:4902`). It does not trigger placement/collision revalidation, which is correct for a non-geometric text field.

### Pack owns (existing, unchanged by this phase)
- `notes` (Pack Notes), `title`, `client`, `projectName`, `drawnBy`, `truck`, `cases` (the Instance array), `groups`, `folderId`, `stats`.
- Canonical update path: `PackLibrary.update(packId, patch)` / `PackLibrary.create(packData)`.

### Project-level (not owned by any Cargo Instructions field; listed for completeness of the diagram)
- Truck geometry, Pack Settings, AutoPack Results (transient, not persisted on the Pack record itself — confirmed: `pack.model.js` / `normalizer.js::normalizePack` carry no `autoPackResults`-shaped field), Statistics (`pack.stats`).

---

## 5. Impact report — files that will eventually require modification

No file listed here has been modified in Phase 0. This is a plan, not a change list.

**Phase 1 (Standard Instructions → inline Inspector card, remove modal):**
- `src/screens/editor-screen.js` — remove the modal-based Standard Instructions display (`openCaseNotesModal`, added on this branch) and its Inspector button; add a new, always-visible, read-only card in `renderSingleInspector`, rendering `caseData.notes` directly with a clear "inherited from Case" label. Reuse the existing `.card`, `.tp3d-editor-sub-sm`, `.muted`, and `.tp3d-case-notes-read` classes (the last already added on this branch) — no new CSS class expected.
- `tests/audit/inspector-case-notes.spec.mjs` — the ~5 tests asserting the modal's Add/Edit/Save/Cancel behavior for Standard Instructions must be replaced with tests asserting a static read-only render; the ~10 data-layer tests (normalization, persistence, undo/redo, duplication, import/export) are unaffected and must not be touched.
- `styles/main.css` — likely no change (existing classes cover the read-only card); confirm only if the inline-card layout cannot be produced with `.card` + existing header/body classes already used for Transform/Rotate/Actions.

**Phase 2 (Instance Notes — new field + Inspector UI):**
- `src/core/normalizer.js` — add `instanceNotes` to `normalizeInstance()`.
- `src/screens/editor-screen.js` — new button/card in `renderSingleInspector` (single-selection only, same gating pattern already proven for Standard Instructions and Set Category); new `openInstanceNotesModal` (or inline card, per further product decision — see Open Decisions) targeting `PackLibrary.updateInstance`.
- `tests/audit/inspector-case-notes.spec.mjs` (or a sibling file) — normalization, persistence, undo/redo, Pack duplication, instance-clone non-copy behavior, AutoPack/Truck-Change survival, JSON export/import round trip — all mirroring test patterns already established this branch for Standard Instructions, retargeted at `instanceNotes`/`updateInstance`.
- No change expected to `src/services/autopack-engine.js`, `src/services/autopack-solver.js`, `src/services/pack-library.js`'s reconciliation functions, or `src/packing-core/*` — Section 6 documents why (spread-based instance mutation already preserves unknown fields).

**Phase 3 (Pack Notes — Editor access point):**
- `src/screens/editor-screen.js` — new toolbar/header action opening a notes-only modal that calls `PackLibrary.update(pack.id, { notes })` directly (not through `TruckChangeController`, which the existing Packs-screen Edit Pack modal uses only because it edits truck dimensions in the same form).
- No change expected to `src/screens/packs-screen.js`, `src/services/pack-library.js`, `src/data/models/pack.model.js`, `src/core/normalizer.js`'s `normalizePack`, or the PDF export code in `src/app.js` — Pack Notes already has a full, working data layer; this phase only adds a second UI entry point to the same field.

**Not expected to require modification in any phase**, based on the evidence in Section 6: `src/services/autopack-item-builder.js`, `src/packing-core/*`, `src/core/operation-lifecycle.js`, any Supabase function, `src/core/supabase-client.js`, `src/services/import-export.js`'s spreadsheet column list (Case-level `notes`/Standard Instructions already has a column; neither Instance Notes nor Pack Notes have — or need — a spreadsheet surface, since no spreadsheet import/export exists for Pack or instance data at all today).

---

## 6. Risk assessment

**Migration risk: none identified.** `instanceNotes` is a net-new, optional field. `normalizeInstance()` already treats every optional field (`groupId`, `deliverySequence`, `lockedRotation`, `orientedDims`) as absent-safe (`undefined` → a sensible default, never a thrown error). An old persisted Pack with no `instanceNotes` key on any instance will normalize cleanly to `null`/absent, exactly like every other optional instance field today. No migration script is needed.

**Backward compatibility: none identified.** Adding a new normalized field to `normalizeInstance()` is additive; nothing currently reads or writes a key named `instanceNotes`, so there is no name collision to migrate away from.

**Import/export compatibility:**
- JSON (pack export/import, app/workspace backup): all three levels already round-trip via unconditional object spreads (`{...pack}` in `buildPackExportPayload`, `{...inst}`-style spreads throughout `pack-library.js`), confirmed this audit for Case-level `notes` and by code-path inspection for Pack-level `notes` and the (future) Instance-level `instanceNotes`. No new import/export code is required for JSON.
- Spreadsheet (CSV/XLSX): only Case-level Standard Instructions has a spreadsheet surface today (`import-export.js`'s `indexMap`/`importCaseRows`). Neither Pack Notes nor Instance Notes has, or is being asked to gain, a spreadsheet surface. This is a scope boundary, not a gap.

**Undo/Redo impact: none — already covered.** Both `caseLibrary` and `packLibrary` are in `state-store.js`'s `significant` list, meaning any `CaseLibrary.upsert()` (Standard Instructions) or `PackLibrary.update()`/`updateInstance()` (Pack Notes / Instance Notes) call already produces exactly one history entry per call, with existing Undo/Redo restoring the prior/next value. Confirmed directly this session for Standard Instructions with a `StateStore.undo()` test; the identical mechanism applies to the other two by construction, not by new code.

**Duplicate impact:**
- Duplicating a Case (`CaseLibrary.duplicate`) copies Standard Instructions — correct, since it's Case-owned template data.
- Duplicating a Pack (`PackLibrary.duplicate`) deep-clones the entire object including `cases[]` and `notes` — Pack Notes and (future) Instance Notes on every cloned instance both survive automatically; only `id` is regenerated per instance.
- Cloning a single instance in the Editor (`duplicateInstancesSafely`) preserves `caseId` (so Standard Instructions is inherited, not copied, correctly) but does not currently copy arbitrary source-instance fields into the new instance object — a new instance from this path would correctly start with no Instance Notes, requiring no extra guard code.

**AutoPack impact: none identified.** `autopack-engine.js::buildAutoPackNextCases` rebuilds each placed result via `{...inst, transform:{...}, hidden:false, placement:...}` — a spread of the *original* instance object. Any existing `instanceNotes` on an instance that AutoPack repositions survives untouched; AutoPack never constructs a brand-new instance object from a narrow field list, so it can neither invent nor silently drop Instance Notes. The same is true of Truck Change/reconciliation (`applyCanonicalInstancePose` deep-clones-and-patches, never reconstructs).

**Net risk assessment: low across all three fields.** The two riskiest-sounding requirements — live Case→Instance propagation, and survival through AutoPack/Truck-Change/duplication — are both **already true of the current architecture**, provable from existing code, not features to build.

---

## 7. Change Propagation Policy — validated, not assumed

Claim: "Case edits SHALL propagate to every Pack Instance."

Evidence this is already the current behavior:
1. A Pack Instance never stores a copy of Case fields — only `caseId` (`normalizeInstance`, `pack-library.js::addInstance`). There is no snapshot to go stale.
2. Every Inspector render re-resolves the Case fresh: `renderSingleInspector(pack, inst, caseData, prefs)` receives `caseData` from `CaseLibrary.getById(inst.caseId)`, called anew on every `renderInspector(pack)` invocation — never cached across renders.
3. `src/app.js`'s global `StateStore.subscribe` handler (around line 9787) calls `EditorUI.render()` unconditionally whenever `changes.caseLibrary` is truthy — i.e., on every single `CaseLibrary.upsert()` anywhere in the app, whether from the Cases screen or the Editor itself.

Net effect: editing a Case's Standard Instructions from the Cases screen while the Editor is open, with an instance of that Case selected, already updates the visible Inspector on the very next state-change tick — no page reload, no reselection, no additional code. **This policy requires zero implementation work; it only needs to be documented (this section) so no future change accidentally introduces a snapshot/copy that would break it.**

---

## 8. Implementation plan

1. **Phase 1 — Standard Instructions inline card. DONE — `ffd1d75`.** Removed the Inspector Notes modal prototype (`openCaseNotesModal` and its button) entirely; replaced with an always-visible, read-only "Standard Instructions" section in `renderSingleInspector`'s top Case summary card. Cases-screen `case-modal.js` label updated to match. No persisted-field or normalization change. 17 focused tests, full suite/typecheck/lint clean. Live browser QA outstanding (environment blocker, see Implementation status above).
2. **Phase 2 — Instance Notes. DONE — `086004b`.** Added `instanceNotes` to `normalizeInstance()`; added a single-selection Inspector control wired to `PackLibrary.updateInstance`, with packId/instanceId selection safety mirroring Phase 1's proven pattern. Verified directly (not assumed) that AutoPack and Truck Change/canonical-pose reconciliation already preserve `instanceNotes`. Found and fixed a real gap: `buildSafeDuplicateInstances` was deep-cloning the full source instance and would have copied `instanceNotes` onto a fresh duplicate; it now resets to `null` on duplicate. 16 new focused tests, full suite/typecheck/lint clean. Live browser QA outstanding (same environment blocker).
3. **Phase 3 — Pack Notes Editor access. Not started.** Add a minimal Editor toolbar/header entry point calling `PackLibrary.update(pack.id, { notes })` directly; field-parity test against the existing Packs-screen Edit Pack modal.
4. **Phase 4 (optional, not scoped by this contract) — indicators.** Subtle "has instructions/notes" indicators on Case cards / Pack cards, if pursued; no repository precedent exists for this pattern today, so it would need its own small design decision before implementation.

Each phase is independently shippable and independently revertible; none depends on a later phase's code.

---

## 9. Open decisions (not resolvable from repository evidence)

1. Whether Instance Notes (Phase 2) uses the same modal-free inline-card pattern now mandated for Standard Instructions, or keeps a lightweight modal (since, unlike Standard Instructions, Instance Notes is genuinely editable from the Inspector and a modal's Empty/Edit/Read states may still be the right shape for an *editable* field even though they were ruled out for a *read-only* one). This section's decisions govern Standard Instructions explicitly; they do not by themselves settle Instance Notes' interaction pattern.
2. Exact Inspector card wording/labeling for "inherited from the Case" (Phase 1) and for the Instance Notes card (Phase 2) — a copy decision, not an architecture decision.
