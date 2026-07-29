# Business Identity Contract v1

**Status:** Completed and approved

**Approved:** 2026-07-28

**Scope:** Product and data architecture contract only

## Purpose

This document is the permanent v1 contract for human-facing business identity in Cargo Planner. It defines ownership, naming, validation, uniqueness, duplication, migration, import, and presentation rules for Cases, Load Plans, and packed Case instances.

This contract does not implement fields, UI, migrations, generators, validation, import behavior, reporting, server persistence, or synchronization. Those changes require separately approved implementation phases.

The existing internal `Pack` architecture remains authoritative. “Load Plan” is the customer-facing name; `PackLibrary`, `pack`, `pack.id`, `packLibrary`, `currentPackId`, and the existing JSON keys remain unchanged.

---

## 1. Identity concepts

The following concepts are separate and must never be substituted for one another.

| Concept | Meaning | V1 rule |
|---|---|---|
| Technical identity | Permanent application ownership and relationship identity | Existing UUIDs remain authoritative. Business identity never changes UUIDs, relationships, geometry, packing, ownership, timestamps, ordering, or history. |
| Display identity | Editable descriptive label shown most prominently in ordinary UI | Case `name` and Load Plan `title` remain editable and remain the primary descriptive labels. |
| Business identity | Cargo Planner’s human-facing operational reference | Case `itemCode` when present and required Load Plan `loadPlanNumber`. |
| External reference | Optional value supplied by a customer or another system | Load Plan `customerReference`. It is neither Cargo Planner technical identity nor Cargo Planner business identity. |

Names and titles must never become identity keys. Business identifiers must never replace UUIDs. External references must never authorize lookup, merge, overwrite, access, or ownership.

---

## 2. V1 field summary

| Entity | Technical identity | Display identity | Business identity | External reference |
|---|---|---|---|---|
| Case | Existing `case.id` UUID | Existing editable `name` | Optional `itemCode`, customer label **Item Code** | None in v1 |
| Load Plan / internal Pack | Existing `pack.id` UUID | Existing editable `title` | Required `loadPlanNumber`, customer label **Load Plan Number** | Optional `customerReference`, customer label **Customer Reference** |
| Packed Case instance | Existing `instance.id` UUID and existing `caseId` relationship | Derived from the referenced Case and presentation context | None in v1 | None in v1 |

Handling Unit IDs and every other packed-instance business identifier remain deferred.

---

## 3. Field contracts

### 3.1 Case `itemCode`

| Property | Contract |
|---|---|
| Internal field | `itemCode` |
| Customer label | Item Code |
| Purpose | Optional Cargo Planner operational reference for one Case library record |
| Type | `string \| null` |
| Required | No |
| Entry | User-entered initially; never generated automatically in v1 |
| Editability | Editable with uniqueness validation |
| Uniqueness | Workspace-unique when present, using normalized case-insensitive comparison |
| Empty value | `null` |
| Maximum | 64 characters after normalization |
| Duplication | A duplicated Case receives a new UUID and `itemCode: null`; ordinary Case properties continue to copy |
| Migration | Existing Cases may retain `itemCode: null` |
| Presentation | Case Name remains primary; Item Code is secondary when populated |

`itemCode` is Cargo Planner’s business identifier for a Case. It is not a SKU, manufacturer part number, barcode, external-system key, or alternate Case name unless a user deliberately enters the same visible value.

No import path may automatically map `SKU`, `Product Code`, or another semantically different column into `itemCode`.

### 3.2 Load Plan `loadPlanNumber`

| Property | Contract |
|---|---|
| Internal field | `loadPlanNumber` on the existing Pack record |
| Customer label | Load Plan Number |
| Purpose | Cargo Planner’s operational reference for one Load Plan |
| Type | Non-empty string on every canonical saved Load Plan |
| Required | Yes for canonical saved Load Plans |
| Entry | Generated automatically when absent; user-editable afterward |
| Editability | Editable with uniqueness validation |
| Uniqueness | Workspace-unique using normalized case-insensitive comparison |
| Empty value | Not valid on a canonical saved Load Plan |
| Maximum | 64 characters after normalization |
| Default generation | Random and non-sequential; recommended initial form `LP-XXXXXXXX`, using eight Crockford Base32 characters with collision check and retry |
| Duplication | A duplicated Load Plan receives a new UUID and a new generated Load Plan Number |
| Migration | Existing canonical Load Plans missing the field receive generated numbers |
| Presentation | Load Plan Number is the operational reference; Title remains the descriptive name |

Generated Load Plan Numbers must not encode:

- dates or time;
- workspace names or slugs;
- customers or Customer References;
- Load Plan titles;
- lifecycle status;
- user names;
- mutable record information; or
- a global or workspace sequence.

The generated number is independent of `pack.id`. The existing UUID remains the technical identity and must not be replaced, exposed as the Load Plan Number, or regenerated merely because the number changes.

### 3.3 Load Plan `customerReference`

| Property | Contract |
|---|---|
| Internal field | `customerReference` on the existing Pack record |
| Customer label | Customer Reference |
| Purpose | Optional reference received from a customer or another external system |
| Type | `string \| null` |
| Required | No |
| Entry | User-entered |
| Editability | Editable |
| Uniqueness | Not unique |
| Empty value | `null` |
| Maximum | 64 characters after normalization |
| Duplication | Cleared when duplicating a whole Load Plan |
| Migration | Existing Load Plans receive no value |
| Presentation | Shown only when populated |

Customer Reference is not a Cargo Planner identity. Matching Customer References never authorize merge, overwrite, relationship repair, access, or deduplication.

### 3.4 Packed Case instance

No business-identity or external-reference field is approved for packed instances in v1.

The existing instance UUID remains permanent and authoritative for that instance. The existing `caseId` remains the relationship to the Case definition. Presentation values such as Case Name plus an occurrence number are derived labels, not stored identity.

Handling Unit IDs, Unit Numbers, serialized-unit references, and optional barcode references remain deferred until a real unit-level operational workflow is approved.

---

## 4. Normalization and validation

The following rules apply to `itemCode`, `loadPlanNumber`, and `customerReference` unless a stricter generated-value rule is stated.

1. Apply Unicode NFKC normalization.
2. Trim surrounding whitespace.
3. Convert an empty optional value to `null`.
4. Reject control characters.
5. Reject carriage returns, line feeds, and all other line breaks.
6. Enforce a maximum of 64 characters after normalization.
7. Preserve the user’s entered display casing.
8. Derive a case-insensitive normalized comparison value for uniqueness and search.
9. Do not expose or independently edit the comparison value.
10. Generated values may use a stricter barcode-compatible character set.

Comparison normalization and display storage are separate:

- the stored display value preserves casing after NFKC and trimming;
- the derived comparison value is used for uniqueness and lookup;
- a normalized comparison key is not a second identity field;
- display plus comparison combinations are derived behavior, not independently editable data.

Client-side workspace uniqueness is the initial enforcement boundary because Cases and Load Plans are currently local-first. When authoritative cargo server persistence is approved, the server must enforce uniqueness against the authoritative cargo tenancy/workspace key. A workspace slug is not that authority and must never be used as the uniqueness owner, access credential, or identity prefix.

---

## 5. Ownership

### 5.1 Case-owned fields

| Field/value | Stored or derived | Mutability | Notes |
|---|---|---|---|
| `case.id` | Stored | Immutable | Permanent technical identity |
| Case creation identity | Stored | Immutable | Duplication creates a new record and new UUID |
| `name` | Stored | Editable | Primary visible descriptive label |
| `itemCode` | Stored | Editable with validation | Optional workspace-unique business identity |
| Existing dimensions, weight, category, manufacturer, instructions, handling rules, and Case metadata | Stored | Existing rules | Business Identity v1 does not change their ownership or behavior |
| Normalized Item Code comparison | Derived | Not editable | Used only for comparison, uniqueness, and search |

### 5.2 Packed-instance-owned fields

| Field/value | Stored or derived | Mutability | Notes |
|---|---|---|---|
| `instance.id` | Stored | Immutable | Permanent technical identity for the instance |
| `caseId` | Stored relationship | Existing rules | References the authoritative Case UUID |
| Transform, placement, visibility, orientation, grouping, packed profile, delivery sequence, and Item Notes | Stored | Existing rules | Unchanged by this contract |
| Case Name shown for an instance | Derived | Not independently editable | Resolved from the referenced Case |
| Occurrence number or checklist position | Derived | Not editable identity | Presentation order only |
| Handling Unit ID | Not present | Not applicable | Deferred |

### 5.3 Load-Plan-owned fields

| Field/value | Stored or derived | Mutability | Notes |
|---|---|---|---|
| `pack.id` | Stored | Immutable | Permanent technical identity |
| Load Plan creation identity | Stored | Immutable | Duplication creates a new Pack and UUID |
| `title` | Stored | Editable | Primary descriptive name |
| `loadPlanNumber` | Stored | Editable with validation | Required workspace-unique business identity |
| `customerReference` | Stored | Editable | Optional, not unique, external reference |
| Existing client, project, drawn-by, notes, truck, groups, Cases, statistics, folder, thumbnail, and timestamps | Stored | Existing rules | Unchanged by this contract |
| Normalized Load Plan Number comparison | Derived | Not editable | Used only for comparison, uniqueness, and search |
| Normalized Customer Reference search value | Derived | Not editable | Does not create uniqueness or identity |

### 5.4 Presentation/export-owned values

| Value | Stored or derived | Contract |
|---|---|---|
| Primary/secondary text hierarchy | Derived presentation | Case Name primary, Item Code secondary; Load Plan Number operational, Title descriptive |
| Empty-value omission | Derived presentation | Item Code and Customer Reference are omitted when `null` |
| Checklist row number | Derived presentation | Never identity |
| PDF/CSV/JSON labels and column order | Presentation/export contract | May expose approved stored values but never become ownership or identity |
| Generated filename | Derived presentation | Never identity |
| Barcode/QR/RFID encoding | Not present in v1 | Deferred |

---

## 6. Mutability summary

| Category | Fields |
|---|---|
| Immutable | Existing Case UUID, Pack UUID, instance UUID, and record creation identity |
| Editable | Case Name, Load Plan Title, Customer Reference, and existing editable descriptive fields |
| Editable with uniqueness validation | Item Code when present; required Load Plan Number |
| Derived and not independently editable | Normalized comparison values, case-insensitive search keys, instance display name, occurrence/checklist number, presentation hierarchy, and export formatting |

Changing a business identifier does not change the UUID, relationship graph, Case geometry, instance transform, packing result, ownership, ordering, timestamps except through already approved ordinary edit behavior, or historical record identity.

---

## 7. Duplication

### Duplicate Case

A duplicated Case must:

- receive a new Case UUID;
- set `itemCode: null`;
- preserve the existing Case-duplication behavior for Name and ordinary Case properties;
- preserve no identity relationship to the source beyond ordinary copied descriptive/cargo data.

### Duplicate whole Load Plan

A duplicated Load Plan must:

- receive a new Pack UUID;
- receive a new generated Load Plan Number;
- set `customerReference: null`;
- preserve the existing title-copy behavior;
- preserve referenced Case UUIDs and their Item Codes;
- preserve the existing packed-instance UUID regeneration behavior;
- preserve all other existing whole-Load-Plan duplication semantics unless separately approved.

### Duplicate packed instance

Packed-instance UUID behavior remains unchanged. No Handling Unit ID exists to copy or regenerate in v1.

---

## 8. Imports and conflicts

1. A matching business identifier never authorizes overwrite.
2. A matching external reference never authorizes overwrite.
3. Only explicit Item Code aliases may map to `itemCode`: `itemCode`, `item_code`, and `item code`.
4. `SKU`, `Product Code`, manufacturer part number, barcode, and other semantically different columns must not silently map to Item Code.
5. A supplied conflicting Item Code or Load Plan Number must be reported and require resolution.
6. A supplied conflicting identifier must not be silently overwritten, merged, cleared, or renumbered.
7. Missing required Load Plan Numbers may be generated.
8. Missing optional Item Codes and Customer References remain `null`.
9. Unaffected records may still import within the existing import transaction boundary.
10. An individual Load Plan import that is currently atomic remains atomic; an unresolved conflict blocks that Load Plan payload rather than committing a partial Load Plan.
11. Spreadsheet rows and independent batch entries that do not conflict may continue when the existing importer already supports row/entry-level continuation.
12. Existing UUIDs and UUID reference resolution remain authoritative.

Import conflict reporting must distinguish at least:

- normalized identifier collision;
- missing required Load Plan Number that was generated;
- optional field omitted;
- semantically unsupported alias such as SKU; and
- unresolved record requiring user action.

This contract does not approve update-in-place import, confidence-based auto-merge, or a generalized external-reference mapping layer.

---

## 9. Migration and compatibility

The Business Identity Phase 1 migration must be additive and idempotent.

It must:

- preserve every existing Case, Pack, and instance UUID;
- preserve every existing `caseId` relationship;
- preserve timestamps and library ordering;
- preserve geometry, packing, visibility, placement, groups, notes, thumbnails, statistics, and existing metadata;
- preserve current JSON keys, discriminators, and internal Pack APIs;
- accept legacy JSON in which all three v1 fields are absent;
- allow existing Cases to retain `itemCode: null`;
- assign generated Load Plan Numbers only to existing canonical Load Plans missing a valid number;
- leave Customer Reference absent/`null` unless it already appears in a future compatible payload;
- produce the same valid result when run more than once;
- avoid ordinary Undo history; and
- persist through the existing local/offline storage boundary without creating server state.

Migration is not an edit action. It must not appear as an ordinary user Undo step or cause an Undo operation to remove a required Load Plan Number.

New JSON may carry the additive fields, but existing UUIDs and the established Pack JSON vocabulary remain authoritative. No `loadPlanId`, parallel Pack object, compatibility wrapper, or UUID replacement is permitted.

---

## 10. Presentation and reporting

### Case

1. Case Name remains the primary visible label.
2. Item Code is secondary when populated.
3. A missing Item Code produces no placeholder business identity.
4. UUIDs are not substituted into customer-facing presentation.

### Load Plan

1. Load Plan Number is the operational reference.
2. Title remains the descriptive name.
3. Customer Reference appears only when populated.
4. UUIDs are not substituted into customer-facing presentation.

V1 does not add workspace-configurable primary-label preferences. The presentation hierarchy is fixed so every user sees the same meaning.

Export and reporting integrations belong to a later approved phase. This section defines their eventual hierarchy but does not add a PDF field, CSV column, JSON behavior, manifest, physical label, screen, or styling change now.

---

## 11. Persistence, offline use, and future server authority

Initial uniqueness enforcement is client-side and workspace-scoped because current Case and Load Plan persistence is local-first.

V1 implementation must not introduce a global sequence or require network access to create a Load Plan. Random Crockford Base32 generation plus workspace collision check and retry permits offline creation without weakening the UUID identity layer.

Future server persistence must:

- keep UUIDs as technical primary identity;
- use the authoritative cargo tenancy/workspace key for uniqueness;
- enforce Item Code uniqueness only when present;
- enforce Load Plan Number uniqueness;
- treat client checks as advisory rather than authoritative;
- return synchronization conflicts explicitly; and
- never use a workspace slug as tenancy, authorization, or uniqueness authority.

The detailed server contract remains out of scope for v1.

---

## 12. V1 non-goals

Business Identity v1 does not:

- change application behavior by itself;
- rename internal Pack fields or APIs;
- change UUID ownership;
- change Case-to-instance relationships;
- add packed-instance identity;
- add schemas or Supabase tables;
- add UI, forms, filters, search, sort, exports, reports, manifests, or labels;
- add barcode, QR, RFID, EPC, UPC, or scanning behavior;
- add aliases, revisions, lifecycle, provenance, issuance, or publishing state;
- add workspace-configurable display preferences; or
- add detailed format-versioning or synchronization architecture.

---

## 13. Future Extensions — Explicitly Out of Scope for V1

Every extension below requires a separate product/data contract before implementation.

### 13.1 Case aliases and alternate names

- **Purpose:** Support additional search names, legacy catalog names, abbreviations, or customer-specific labels without changing Case Name.
- **Product trigger:** Users repeatedly need to find one Case under multiple meaningful names.
- **Likely data owner:** Case.
- **Dependencies:** Search semantics, alias uniqueness policy, import mapping, and editing permissions.
- **Migration/compatibility risks:** Duplicate aliases, collisions with primary names, noisy search results, and old imports that treated names as duplicate keys.
- **Relationship to v1 identity:** Aliases describe the Case identified by its UUID; they do not replace Name or Item Code.
- **V1 status:** No alias field, screen, abstraction, import behavior, or implementation is being added now.

### 13.2 Case revisions and version lineage

- **Purpose:** Represent materially different approved versions of a Case definition while preserving lineage.
- **Product trigger:** Dimensions, weight, handling rules, or instructions require auditable revision history rather than ordinary editing.
- **Likely data owner:** Case lineage with separately identified Case revisions.
- **Dependencies:** Revision semantics, effective dates, Pack snapshot behavior, migration, and published-data policy.
- **Migration/compatibility risks:** Existing instances may resolve to the wrong revision; JSON and duplication may lose lineage; mutable edits may be confused with new revisions.
- **Relationship to v1 identity:** UUID remains technical identity; Item Code does not encode revision and must not become a lineage key by itself.
- **V1 status:** No revision field, lineage object, screen, abstraction, or implementation is being added now.

### 13.3 Lifecycle and provenance metadata

- **Purpose:** Record origin, source system, author, verification state, archival state, or data stewardship.
- **Product trigger:** Compliance, support, data-quality, or operational workflows require attributable record history.
- **Likely data owner:** The Case or Load Plan record, with event/audit ownership where appropriate.
- **Dependencies:** Roles, audit retention, timestamps, server persistence, and privacy policy.
- **Migration/compatibility risks:** Invented historical provenance, mutable audit data, cross-workspace leakage, and incompatible offline edits.
- **Relationship to v1 identity:** Provenance describes an identified record; it never becomes UUID, business identifier, or external reference.
- **V1 status:** No provenance field, event model, screen, abstraction, or implementation is being added now.

### 13.4 Multiple typed external references

- **Purpose:** Store distinct PO, shipment, booking, ERP, WMS, customer, carrier, or source-system references simultaneously.
- **Product trigger:** One optional Customer Reference can no longer represent real concurrent integration needs without ambiguity.
- **Likely data owner:** Case or Load Plan, with type/source/value entries owned at the same entity level.
- **Dependencies:** Type taxonomy, source-system identity, uniqueness policy, permissions, import/export mapping, and search.
- **Migration/compatibility risks:** Splitting existing Customer Reference values incorrectly, duplicate source/value pairs, and losing source semantics.
- **Relationship to v1 identity:** Typed references remain external metadata and never replace UUID, Item Code, or Load Plan Number.
- **V1 status:** No typed-reference field, collection, screen, abstraction, or implementation is being added now.

### 13.5 Import identity-confidence scoring

- **Purpose:** Explain how strongly imported data appears to match existing records without automatically treating uncertain evidence as identity.
- **Product trigger:** High-volume integrations need assisted conflict review across UUID, business identifier, external reference, names, and physical attributes.
- **Likely data owner:** Import job/result, not the Case or Load Plan identity record.
- **Dependencies:** Import job model, explainable scoring, review UX, thresholds, audit logs, and rollback.
- **Migration/compatibility risks:** False merges, non-deterministic results, hidden overwrites, and changed legacy import outcomes.
- **Relationship to v1 identity:** V1 identifiers may be evidence, but a confidence score never authorizes overwrite or changes identity.
- **V1 status:** No score field, matching service, review screen, abstraction, or implementation is being added now.

### 13.6 Workspace-configurable primary-label preferences

- **Purpose:** Let a workspace choose whether operational screens emphasize Name, Item Code, Title, or Load Plan Number.
- **Product trigger:** Valid customer workflows consistently require a different primary visual hierarchy from the v1 fixed hierarchy.
- **Likely data owner:** Workspace preferences.
- **Dependencies:** Workspace-scoped preferences, permissions, accessibility, responsive behavior, exports, and cross-user consistency.
- **Migration/compatibility risks:** Inconsistent labels across users and exports, hidden names, confusing support evidence, and stale preference state.
- **Relationship to v1 identity:** Preferences change presentation only; they do not change field ownership or identity.
- **V1 status:** No preference field, setting, screen, abstraction, or implementation is being added now.

### 13.7 Packed-instance and Handling Unit IDs

- **Purpose:** Give a specific physical unit a durable operational reference for scanning, custody, loading, or unloading.
- **Product trigger:** A real workflow must distinguish multiple physical units of the same Case beyond their instance UUID and screen position.
- **Likely data owner:** Packed Case instance.
- **Dependencies:** Issuance timing, uniqueness scope, duplication, labels, scanning, offline generation, and lifecycle policy.
- **Migration/compatibility risks:** Fabricated historical IDs, accidental copying during duplication, renumbering after reorder, and ambiguity across Load Plans.
- **Relationship to v1 identity:** Handling Unit identity would be separate from Case Item Code, Load Plan Number, `instance.id`, and occurrence number.
- **V1 status:** No Handling Unit field, Unit Number, screen, abstraction, or implementation is being added now.

### 13.8 Manifests and physical labels

- **Purpose:** Produce operational documents or labels that carry approved identity and cargo information.
- **Product trigger:** Warehouse, carrier, crew, or customer workflows require printed or machine-readable artifacts.
- **Likely data owner:** Derived export/publication artifact tied to a Load Plan or snapshot.
- **Dependencies:** Approved field set, layout contract, revision/snapshot policy, printing constraints, and access control.
- **Migration/compatibility risks:** Labels becoming stale after edits, mismatched unit identity, incompatible templates, and disclosure of private references.
- **Relationship to v1 identity:** Manifests and labels consume v1 identity; they do not create or own it.
- **V1 status:** No manifest, label field, template, screen, abstraction, or implementation is being added now.

### 13.9 Barcode, QR, RFID, EPC, UPC, and scanning workflows

- **Purpose:** Encode or read operational references through physical scanning technology.
- **Product trigger:** Approved physical workflows require faster or more reliable identification than manual entry.
- **Likely data owner:** Encoding/scan configuration and scan events; the referenced identity remains owned by its Case, Load Plan, or future Handling Unit.
- **Dependencies:** Symbology choice, hardware/browser support, collision scope, offline resolution, security, privacy, labels, and server lookup.
- **Migration/compatibility risks:** Treating an external code as internal identity, duplicate scans, unresolvable offline codes, insecure public lookup, and vendor lock-in.
- **Relationship to v1 identity:** Encoding transports or resolves an approved reference; it never replaces UUID ownership.
- **V1 status:** No encoding specification, barcode field, scanner, screen, abstraction, or implementation is being added now.

### 13.10 Immutable published snapshots and identifier history

- **Purpose:** Preserve exactly what was issued or shared even when the live Case or Load Plan later changes.
- **Product trigger:** Published plans, customer approvals, claims, audits, or crew execution require reproducible historical documents.
- **Likely data owner:** Versioned published Load Plan snapshot and associated identity-history events.
- **Dependencies:** Publishing, permissions, retention, revision policy, share access, signatures, and storage.
- **Migration/compatibility risks:** Confusing live and published records, broken links, duplicated identities, incomplete snapshots, and retention obligations.
- **Relationship to v1 identity:** Snapshots record v1 values at publication time without changing the live UUID or current business identity.
- **V1 status:** No snapshot field, identifier-history log, publication screen, abstraction, or implementation is being added now.

### 13.11 Approval and issued-state locking

- **Purpose:** Prevent or govern identifier edits after a Load Plan or Case reaches an approved operational state.
- **Product trigger:** Customers need controlled issuance, corrections, approvals, or regulatory traceability.
- **Likely data owner:** Case or Load Plan lifecycle, with audit events owned separately.
- **Dependencies:** Lifecycle state machine, roles, correction/void policy, audit history, notifications, and published snapshots.
- **Migration/compatibility risks:** Locking existing editable records unexpectedly, dead-end corrections, inconsistent offline state, and bypass through import.
- **Relationship to v1 identity:** This may constrain v1 editability later but does not redefine UUID or business-identity ownership.
- **V1 status:** No approval state, lock field, correction flow, screen, abstraction, or implementation is being added now.

### 13.12 Authoritative server uniqueness and synchronization conflicts

- **Purpose:** Enforce workspace uniqueness and reconcile concurrent offline/client changes once cargo is server-persisted.
- **Product trigger:** Cases and Load Plans gain authoritative multi-client server persistence.
- **Likely data owner:** Server cargo records keyed by the authoritative tenancy/workspace identity.
- **Dependencies:** Server schema, RLS, sync protocol, conflict versions, offline queue, retries, permissions, and recovery.
- **Migration/compatibility risks:** Split-brain values, server/client mismatch, accidental renumbering, lost edits, and wrong-workspace constraints.
- **Relationship to v1 identity:** The server enforces the same v1 field meanings; it does not replace UUIDs or use workspace slugs as authority.
- **V1 status:** No server table, constraint, sync engine, conflict screen, abstraction, or implementation is being added now.

### 13.13 Schema and data-format versioning

- **Purpose:** Make future Case, Pack, workspace-export, and integration schema evolution explicit and recoverable.
- **Product trigger:** Additive compatibility is no longer sufficient or multiple supported external schema generations must coexist.
- **Likely data owner:** Export/import envelopes and canonical persistence formats, not an individual Case or Load Plan field.
- **Dependencies:** Version policy, migrators, compatibility windows, rollback, validation, documentation, and test fixtures.
- **Migration/compatibility risks:** Rejecting old backups, partial upgrades, divergent local/server versions, and ambiguous downgrade behavior.
- **Relationship to v1 identity:** Versioning protects serialization of v1 identity fields while leaving their ownership and meanings unchanged.
- **V1 status:** No schema-version field, migrator framework, compatibility abstraction, screen, or implementation is being added now.

---

## 14. Approved implementation sequence

This contract closes Business Identity Phase 0. It authorizes planning, not implementation, beyond the following separately gated sequence:

1. **Business Identity Phase 1 — Core Model and Migration**
2. **Cases and Load Plans identifier UI**
3. **Search, import, export, and reporting integration**
4. **Server-persistence uniqueness contract**

Packed-instance identity and all Future Extensions remain deferred.

Business Identity Phase 1 must stop at its approved scope. It must not silently begin UI, reporting, server persistence, Handling Unit, barcode, publication, or other Future Extension work.
