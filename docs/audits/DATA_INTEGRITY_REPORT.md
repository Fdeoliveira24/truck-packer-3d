# DATA_INTEGRITY_REPORT

## PASS F — Data corruption + import/export attacks

## Import hardening controls
- Supported file types only (`csv`, `xlsx`): `src/services/import-export.js:20-22`, `100-102`.
- Max upload size 10MB: `src/services/import-export.js:21`, `103-106`.
- Max row count 5000: `src/services/import-export.js:20`, `121-124`.
- Required schema columns: `name,length,width,height` (`src/services/import-export.js:130-133`).
- Row-level validation with explicit error collection (`src/services/import-export.js:163-173`, `181-183`).
- Duplicate prevention against existing + in-file names (`src/services/import-export.js:134-143`, `175-186`).
- Write-path revalidation guard (`src/services/import-export.js:208-216`).

## Export/version controls
- Version tag for app export payload (`src/core/storage.js:169-171`).
- Version tag for pack export payload (`src/services/import-export.js:246-248`).
- App import requires structural keys before returning state (`src/core/storage.js:184-191`).

## Attack simulation matrix

| Attack input | Expected | Verification |
|---|---|---|
| Unsupported extension (`.json`) | reject with clear error | `tests/audit/import-export.spec.mjs:53-71` |
| >5000 rows | reject with row-limit error | `tests/audit/import-export.spec.mjs:73-96` |
| >10MB file | reject with size-limit error | `tests/audit/import-export.spec.mjs:98-116` |
| Duplicate rows in same file | only first accepted, duplicate reported | `tests/audit/import-export.spec.mjs:29-51` |
| Invalid dimensions at ingest | row ignored, no bad write | `tests/audit/import-export.spec.mjs:118-131` |
| Empty/invalid JSON app import | throws and emits import_error | `src/core/storage.js:181-198` |

## Determinism notes
- Export contains `exportedAt/savedAt` timestamps, so byte-for-byte deterministic output is not expected.
- Schema determinism (field presence/order) is stable and versioned via `APP_VERSION`.

## Residual risk
- No checksum/signature for backup files; integrity relies on JSON parse + schema checks.
