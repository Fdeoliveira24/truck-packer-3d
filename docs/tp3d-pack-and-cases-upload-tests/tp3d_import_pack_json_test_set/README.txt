TP3D Pack Import Test Files
===========================

Use these files to test Import Pack JSON and pack-batch behavior.

Recommended test order:
1. 01_good_mixed_dry_van_pack_with_cases.json
   Expected: preview shows real truck dimensions, 11 cases, and real L x W x H / Weight / Category values.

2. 02_good_wheel_wells_pack_with_cases.json
   Expected: preview shows real values and imports a wheel-well pack.

3. 03_good_front_bonus_pack_with_cases.json
   Expected: preview shows real values and imports a front-bonus pack.

4. 04_valid_references_existing_case_library_only.json
   Expected: only previews fully if the referenced case IDs already exist in the CaseLibrary.
   If the app has no matching cases, it should warn/block or clearly mark missing case definitions.

5. 05_invalid_missing_case_definitions_pack.json
   Expected: should NOT say "Pack looks good". It should flag missing case definitions.

6. 06_invalid_bad_truck_dimensions_pack.json
   Expected: should NOT show NaN truck dimensions. It should block or clearly warn.

7. 07_invalid_missing_cases_array_pack.json
   Expected: invalid pack format.

8. 08_not_pack_app_backup_wrapper_should_warn.json
   Expected: should warn that this is App JSON and should be imported through Import App JSON.

9. 09_batch_all_valid_3_packs_with_cases.json
   Expected: imports 3 packs, stays on Packs screen, does not auto-open Editor.

10. 10_batch_mixed_valid_and_invalid_packs.json
   Expected: imports valid packs and skips invalid/warning packs, with a clear summary.
