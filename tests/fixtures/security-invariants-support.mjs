// Shared setup for the domain specs extracted from the former security suite.


import test from 'node:test';

import assert from 'node:assert/strict';

import fs from 'node:fs/promises';

import fsSync from 'node:fs';

import vm from 'node:vm';

import { stripTypeScriptTypes } from 'node:module';

import { execFile } from 'node:child_process';

import { promisify } from 'node:util';

import { createHash } from 'node:crypto';

import { createModalOwnership } from '../../src/ui/ui-components.js';

const execFileAsync = promisify(execFile);

let __XLSX = null;

function loadVendorXLSX() {
  if (__XLSX) return __XLSX;
  const code = fsSync.readFileSync(new URL('../../vendor/xlsx.full.min.js', import.meta.url), 'utf8');
  // Run in the SHARED realm so XLSX recognizes host ArrayBuffer/Uint8Array (a vm
  // sandbox has its own typed-array constructors and would reject File buffers).
  if (!globalThis.self) globalThis.self = globalThis;
  if (!globalThis.window) globalThis.window = globalThis;
  vm.runInThisContext(code);
  __XLSX = globalThis.XLSX;
  return __XLSX;
}

function installWindowXLSX() {
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.XLSX = loadVendorXLSX();
  return globalThis.window.XLSX;
}

function makeCsvFile(text, name = 'cases.csv') {
  return new File([text], name, { type: 'text/csv' });
}

function makeXlsxFile(aoa, name = 'cases.xlsx') {
  const XLSX = loadVendorXLSX();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Cases');
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([new Uint8Array(arr)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const billingServiceUrl = new URL('../../src/data/services/billing.service.js', import.meta.url);

const accountOverlayPath = new URL('../../src/ui/overlays/account-overlay.js', import.meta.url);

const appPath = new URL('../../src/app.js', import.meta.url);

const billingServicePath = new URL('../../src/services/billing-service.js', import.meta.url);

const organizationServicePath = new URL('../../src/services/organization-service.js', import.meta.url);

const authServicePath = new URL('../../src/services/auth-service.js', import.meta.url);

const accountSwitcherPath = new URL('../../src/account-switcher.js', import.meta.url);

async function readAppSource() {
  return (await fs.readFile(appPath, 'utf8'))
    + '\n\n' + (await fs.readFile(billingServicePath, 'utf8'))
    + '\n\n' + (await fs.readFile(organizationServicePath, 'utf8'))
    + '\n\n' + (await fs.readFile(authServicePath, 'utf8'))
    + '\n\n' + (await fs.readFile(accountSwitcherPath, 'utf8'));
}

const indexHtmlPath = new URL('../../index.html', import.meta.url);

const storagePath = new URL('../../src/core/storage.js', import.meta.url);

const browserPath = new URL('../../src/core/browser.js', import.meta.url);

const importExportPath = new URL('../../src/services/import-export.js', import.meta.url);

const importCasesDialogPath = new URL('../../src/ui/overlays/import-cases-dialog.js', import.meta.url);

const folderLibraryPath = new URL('../../src/services/folder-library.js', import.meta.url);

const caseLibraryPath = new URL('../../src/services/case-library.js', import.meta.url);

const packLibraryPath = new URL('../../src/services/pack-library.js', import.meta.url);

const autoPackEnginePath = new URL('../../src/services/autopack-engine.js', import.meta.url);

const autoPackItemBuilderPath = new URL('../../src/services/autopack-item-builder.js', import.meta.url);

const autoPackSolverPath = new URL('../../src/services/autopack-solver.js', import.meta.url);

const packingCorePath = new URL('../../src/packing-core/index.js', import.meta.url);

const packingCoreValidationPath = new URL('../../src/packing-core/validation.js', import.meta.url);

const packsScreenPath = new URL('../../src/screens/packs-screen.js', import.meta.url);

const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);

const trailerGeometryPath = new URL('../../src/editor/trailer-geometry.js', import.meta.url);

const keyboardManagerPath = new URL('../../src/ui/keyboard-manager.js', import.meta.url);

const recoverableErrorOverlayPath = new URL('../../src/ui/recoverable-error-overlay.js', import.meta.url);

const debuggerPath = new URL('../../src/debugger.js', import.meta.url);

const truckChangeControllerPath = new URL('../../src/ui/truck-change-controller.js', import.meta.url);

const sceneRuntimePath = new URL('../../src/editor/scene-runtime.js', import.meta.url);

const casesScreenPath = new URL('../../src/screens/cases-screen.js', import.meta.url);

const categoryServicePath = new URL('../../src/services/category-service.js', import.meta.url);

const stylesMainPath = new URL('../../styles/main.css', import.meta.url);

const stateStorePath = new URL('../../src/core/state-store.js', import.meta.url);

const normalizerPath = new URL('../../src/core/normalizer.js', import.meta.url);

const orientedDimsPath = new URL('../../src/core/oriented-dims.js', import.meta.url);

const cargoCanonicalPath = new URL('../../src/core/cargo-canonical.js', import.meta.url);

const operationLifecyclePath = new URL('../../src/core/operation-lifecycle.js', import.meta.url);

const beamCsvFixturePath = new URL('../../docs/tp3d-pack-and-cases-upload-tests/cargo_cases_valid.csv', import.meta.url);

const beamXlsxFixturePath = new URL('../../docs/tp3d-pack-and-cases-upload-tests/cargo_cases_valid.xlsx', import.meta.url);

const vendorThreePath = new URL('../../vendor/three.module.js', import.meta.url);

const coreUtilsPath = new URL('../../src/core/utils.js', import.meta.url);

const coreUtilsIndexPath = new URL('../../src/core/utils/index.js', import.meta.url);

const corsSharedPath = new URL('../../supabase/functions/_shared/cors.ts', import.meta.url);

const supabasePath = new URL('../../src/core/supabase-client.js', import.meta.url);

const authOverlayPath = new URL('../../src/ui/overlays/auth-overlay.js', import.meta.url);

const settingsOverlayPath = new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url);

const caseModalPath = new URL('../../src/ui/overlays/case-modal.js', import.meta.url);

const cardDisplayOverlayPath = new URL('../../src/ui/overlays/card-display-overlay.js', import.meta.url);

const notesOverlayPath = new URL('../../src/ui/overlays/notes-overlay.js', import.meta.url);

const helpModalPath = new URL('../../src/ui/overlays/help-modal.js', import.meta.url);

const importAppDialogPath = new URL('../../src/ui/overlays/import-app-dialog.js', import.meta.url);

const importPackDialogPath = new URL('../../src/ui/overlays/import-pack-dialog.js', import.meta.url);

const billingStatusPath = new URL('../../supabase/functions/billing-status/index.ts', import.meta.url);

const billingCatalogPath = new URL('../../supabase/functions/_shared/billing-catalog.ts', import.meta.url);

const stripeCheckoutPath = new URL('../../supabase/functions/stripe-create-checkout-session/index.ts', import.meta.url);

const stripePortalPath = new URL('../../supabase/functions/stripe-create-portal-session/index.ts', import.meta.url);

const orgInvitePath = new URL('../../supabase/functions/org-invite/index.ts', import.meta.url);

const orgInviteRevokePath = new URL('../../supabase/functions/org-invite-revoke/index.ts', import.meta.url);

const orgInviteAcceptPath = new URL('../../supabase/functions/org-invite-accept/index.ts', import.meta.url);

const orgCreateWorkspacePath = new URL('../../supabase/functions/org-create-workspace/index.ts', import.meta.url);

const orgMemberRoleUpdatePath = new URL('../../supabase/functions/org-member-role-update/index.ts', import.meta.url);

const orgMemberRemovePath = new URL('../../supabase/functions/org-member-remove/index.ts', import.meta.url);

const orgTransferOwnershipPath = new URL('../../supabase/functions/org-transfer-ownership/index.ts', import.meta.url);

const orgLeaveWorkspacePath = new URL('../../supabase/functions/org-leave-workspace/index.ts', import.meta.url);

const orgArchiveWorkspacePath = new URL('../../supabase/functions/org-archive-workspace/index.ts', import.meta.url);

const orgRestoreWorkspacePath = new URL('../../supabase/functions/org-restore-workspace/index.ts', import.meta.url);

const deleteAccountPath = new URL('../../supabase/functions/delete-account/index.ts', import.meta.url);

const banUserPath = new URL('../../supabase/functions/ban-user/index.ts', import.meta.url);

const unbanUserPath = new URL('../../supabase/functions/unban-user/index.ts', import.meta.url);

const requestAccountDeletionPath = new URL('../../supabase/functions/request-account-deletion/index.ts', import.meta.url);

const cancelAccountDeletionPath = new URL('../../supabase/functions/cancel-account-deletion/index.ts', import.meta.url);

const purgeDeletedUsersPath = new URL('../../supabase/functions/purge-deleted-users/index.ts', import.meta.url);

const purgeDeletedAccountsPath = new URL('../../supabase/functions/purge-deleted-accounts/index.ts', import.meta.url);

const supabaseConfigPath = new URL('../../supabase/config.toml', import.meta.url);

const supabaseFunctionsDir = new URL('../../supabase/functions/', import.meta.url);

const orgInviteExpirationMigrationPath = new URL(
  '../../supabase/migrations/2026050501_organization_invites_expiration.sql',
  import.meta.url
);

const orgArchiveMigrationPath = new URL(
  '../../supabase/migrations/2026050701_organization_archive.sql',
  import.meta.url
);

const signupAutoOrgUuidMigrationPath = new URL(
  '../../supabase/migrations/2026050601_fix_signup_auto_org_uuid.sql',
  import.meta.url
);

const orgMemberAdminDeleteGuardMigrationPath = new URL(
  '../../supabase/migrations/2026050702_org_member_admin_delete_guard.sql',
  import.meta.url
);

const transferOwnershipMigrationPath = new URL(
  '../../supabase/migrations/2026050801_transfer_ownership_fn.sql',
  import.meta.url
);

const transferOwnershipLiveFixMigrationPath = new URL(
  '../../supabase/migrations/2026050802_transfer_ownership_live_schema_fix.sql',
  import.meta.url
);

const restoreWorkspaceMigrationPath = new URL(
  '../../supabase/migrations/2026050803_restore_workspace.sql',
  import.meta.url
);

const accountPurgeStatusMigrationPath = new URL(
  '../../supabase/migrations/2026050804_account_purge_status.sql',
  import.meta.url
);

const guardProfileDeletionFieldsMigrationPath = new URL(
  '../../supabase/migrations/2026061301_guard_profile_deletion_fields.sql',
  import.meta.url
);

const createWorkspaceMigrationPath = new URL(
  '../../supabase/migrations/20260716061516_server_controlled_workspace_creation.sql',
  import.meta.url
);

const enforceWorkspaceLimitMigrationPath = new URL(
  '../../supabase/migrations/20260717142844_enforce_server_workspace_limits.sql',
  import.meta.url
);

const restrictMembershipMutationMigrationPath = new URL(
  '../../supabase/migrations/20260716061518_restrict_direct_membership_mutations.sql',
  import.meta.url
);

const enforceWorkspaceSlugIntegrityMigrationPath = new URL(
  '../../supabase/migrations/20260717150000_enforce_workspace_slug_integrity.sql',
  import.meta.url
);

async function readFunctionSources(dirUrl = supabaseFunctionsDir) {
  const entries = await fs.readdir(dirUrl, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) {
      sources.push(...await readFunctionSources(childUrl));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      sources.push([childUrl.pathname, await fs.readFile(childUrl, 'utf8')]);
    }
  }
  return sources;
}

function makePackImportSafeCase(overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id: overrides.id || 'case-import-safe',
    name: overrides.name || 'Import Safe Box',
    manufacturer: overrides.manufacturer || 'QA',
    category: overrides.category || 'Default',
    color: overrides.color || '#9ca3af',
    dimensions,
    weight: overrides.weight === undefined ? 10 : overrides.weight,
    volume: dimensions.length * dimensions.width * dimensions.height,
    shape: 'box',
    orientationLock: 'any',
    stackable: overrides.stackable ?? true,
    ...overrides,
  };
}

function makePackImportInstance(caseId, overrides = {}) {
  return {
    id: overrides.id || `inst-${Math.random().toString(36).slice(2)}`,
    caseId,
    hidden: false,
    groupId: null,
    ...overrides,
    transform: { rotation: { x: 0, y: 0, z: 0 }, ...overrides.transform },
  };
}

function getPackImportDims(inst, caseData) {
  return inst.orientedDims || caseData.dimensions;
}

function getPackImportAabb(inst, caseData) {
  const dims = getPackImportDims(inst, caseData);
  const pos = inst.transform.position;
  return {
    min: {
      x: pos.x - dims.length / 2,
      y: pos.y - dims.height / 2,
      z: pos.z - dims.width / 2,
    },
    max: {
      x: pos.x + dims.length / 2,
      y: pos.y + dims.height / 2,
      z: pos.z + dims.width / 2,
    },
  };
}

function packImportAabbsOverlap(a, b) {
  const EPS = 0.001;
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
}

function assertPackImportNoOverlaps(instances, caseData) {
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      assert.equal(
        packImportAabbsOverlap(
          getPackImportAabb(instances[i], caseData),
          getPackImportAabb(instances[j], caseData)
        ),
        false,
        `instances ${i} and ${j} must not overlap`
      );
    }
  }
}

function testAabbInsideTruckBox(aabb, truck, eps = 0.05) {
  return (
    aabb.min.x >= -eps &&
    aabb.max.x <= Number(truck.length) + eps &&
    aabb.min.y >= -eps &&
    aabb.max.y <= Number(truck.height) + eps &&
    aabb.min.z >= -Number(truck.width) / 2 - eps &&
    aabb.max.z <= Number(truck.width) / 2 + eps
  );
}

function testAabbInsidePhysicalTrailer(PackLib, aabb, zones, truck, eps = 0.05) {
  if (PackLib.isAabbContainedInAnyZone(aabb, zones, eps)) return true;
  if (truck?.shapeMode !== 'wheelWells') return false;
  return (
    testAabbInsideTruckBox(aabb, truck, eps) &&
    !PackLib.aabbIntersectsWheelWellBlockedBody(aabb, truck)
  );
}

function testAabbOnPhysicalFloor(PackLib, aabb, zones, truck, eps = 0.05) {
  const onZoneFloor = zones.some(zone =>
    Math.abs(aabb.min.y - zone.min.y) <= eps &&
    PackLib.isAabbContainedInAnyZone(aabb, [zone], eps)
  );
  if (onZoneFloor) return true;
  return (
    truck?.shapeMode === 'wheelWells' &&
    Math.abs(aabb.min.y) <= eps &&
    testAabbInsidePhysicalTrailer(PackLib, aabb, zones, truck, eps)
  );
}

function makePackImportPayload(caseData, instances, overrides = {}) {
  return {
    pack: {
      id: overrides.packId || `pack-import-${Math.random().toString(36).slice(2)}`,
      title: overrides.title || 'Import Safety Pack',
      truck: overrides.truck || { length: 120, width: 60, height: 60 },
      cases: instances,
      folderId: overrides.folderId || null,
    },
    bundledCases: overrides.bundledCases === undefined ? [caseData] : overrides.bundledCases,
  };
}

function packImportStateSnapshot(StateStore) {
  return {
    caseLibrary: JSON.stringify(StateStore.get('caseLibrary') || []),
    packLibrary: JSON.stringify(StateStore.get('packLibrary') || []),
  };
}

function makeMultiCasePayload(bundledCases) {
  return {
    pack: {
      id: 'p-multi', title: 'Multi', truck: { length: 240, width: 96, height: 96 },
      cases: bundledCases.map((c, i) => makePackImportInstance(c.id, { id: `i-${i}`, transform: { position: { x: 8 + i * 16, y: 5, z: 0 } } })),
    },
    bundledCases,
  };
}

function wwAabb(minX, minY, minZ, maxX, maxY, maxZ) {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

const WW_SUPPORT_TRUCK = {
  length: 240, width: 96, height: 96, shapeMode: 'wheelWells',
  shapeConfig: { wellHeight: 18, wellWidth: 12, wellLength: 60, wellOffsetFromRear: 60 },
};

function wwResultPlacements(Solver, result, items = []) {
  const itemById = new Map(items.map(item => [item.instanceId, item]));
  return [...result.placements].map(([id, pos]) => {
    const od = result.orientedDims.get(id);
    const aabb = Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height });
    return { id, pos, od, aabb, item: itemById.get(id) || { weight: 30 } };
  });
}

function wwOnZoneFloor(Solver, placement, zones) {
  return zones.some(zone =>
    Solver.isAabbContainedInAnyZone(placement.aabb, [zone]) &&
    Math.abs(placement.aabb.min.y - zone.min.y) <= 0.05
  );
}

function wwAssertHardSafe(Solver, result, truck, zones, items, label) {
  const geo = Solver.getWheelWellGeometry(truck);
  const placed = wwResultPlacements(Solver, result, items);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    assert.equal(Solver.aabbIntersectsWheelWellBody(p.aabb, geo), false, `${label}: ${p.id} never penetrates the well body`);
    assert.equal(Solver.isAabbWithinTruckMinusBlocked(p.aabb, geo), true, `${label}: ${p.id} stays inside truck-minus-blocked`);
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(Solver.aabbsOverlap(p.aabb, placed[j].aabb), false, `${label}: no overlap ${p.id}/${placed[j].id}`);
    }
    if (!wwOnZoneFloor(Solver, p, zones)) {
      const packedWithout = placed.filter(other => other !== p).map(other => ({
        instanceId: other.id,
        aabb: other.aabb,
        item: other.item,
      }));
      assert.equal(Solver.isWheelWellSupportedAndStable(p.aabb, packedWithout, geo, p.item), true,
        `${label}: ${p.id} has real stable cargo/well-top support`);
    }
  }
}

function wwNonFloorFrontSlack(Solver, result, truck, zones, items) {
  const geo = Solver.getWheelWellGeometry(truck);
  return wwResultPlacements(Solver, result, items).reduce((sum, placement) => {
    if (wwOnZoneFloor(Solver, placement, zones)) return sum;
    const zone = zones.find(z => Solver.isAabbContainedInAnyZone(placement.aabb, [z]));
    const maxX = zone ? zone.max.x : geo.truckBox.max.x;
    return sum + Math.max(0, maxX - placement.aabb.max.x);
  }, 0);
}

function wwFloorSideSlack(Solver, result, zones, items) {
  return wwResultPlacements(Solver, result, items).reduce((sum, placement) => {
    const zone = zones.find(z =>
      Solver.isAabbContainedInAnyZone(placement.aabb, [z]) &&
      Math.abs(placement.aabb.min.y - z.min.y) <= 0.05
    );
    if (!zone) return sum;
    return sum + Math.min(
      Math.abs(placement.aabb.min.z - zone.min.z),
      Math.abs(placement.aabb.max.z - zone.max.z)
    );
  }, 0);
}

function wwFloorForwardSlack(Solver, result, zones, items) {
  return wwResultPlacements(Solver, result, items).reduce((sum, placement) => {
    const zone = zones.find(z =>
      Solver.isAabbContainedInAnyZone(placement.aabb, [z]) &&
      Math.abs(placement.aabb.min.y - z.min.y) <= 0.05
    );
    if (!zone) return sum;
    return sum + Math.max(0, zone.max.x - placement.aabb.max.x);
  }, 0);
}

function wwAvoidableForwardFloorMove(Solver, result, zones, items) {
  const byId = new Map(items.map(item => [item.instanceId, item]));
  const placed = wwResultPlacements(Solver, result, items);
  const round = value => Math.round(value * 1e6) / 1e6;

  for (const placement of placed) {
    const currentZone = zones.find(zone =>
      Solver.isAabbContainedInAnyZone(placement.aabb, [zone]) &&
      Math.abs(placement.aabb.min.y - zone.min.y) <= 0.05
    );
    if (!currentZone) continue;
    const item = byId.get(placement.id);
    if (!item) continue;
    const matchingOrientations = Solver.buildOrientationCandidates(item.dims, item).filter(candidate =>
      Math.abs(candidate.l - placement.od.length) <= 0.05 &&
      Math.abs(candidate.w - placement.od.width) <= 0.05 &&
      Math.abs(candidate.h - placement.od.height) <= 0.05
    );

    for (const orientation of matchingOrientations) {
      for (const zone of zones) {
        if (Math.abs(zone.min.y - placement.aabb.min.y) > 0.05) continue;
        const xAnchors = new Set([zone.min.x, zone.max.x - orientation.l].map(round));
        const zAnchors = new Set([zone.min.z, zone.max.z - orientation.w].map(round));
        for (const other of placed) {
          xAnchors.add(round(other.aabb.min.x));
          xAnchors.add(round(other.aabb.max.x));
          xAnchors.add(round(other.aabb.min.x - orientation.l));
          xAnchors.add(round(other.aabb.max.x - orientation.l));
          zAnchors.add(round(other.aabb.min.z));
          zAnchors.add(round(other.aabb.max.z));
          zAnchors.add(round(other.aabb.min.z - orientation.w));
          zAnchors.add(round(other.aabb.max.z - orientation.w));
        }
        for (const xMin of xAnchors) {
          for (const zMin of zAnchors) {
            const position = {
              x: xMin + orientation.l / 2,
              y: zone.min.y + orientation.h / 2,
              z: zMin + orientation.w / 2,
            };
            const aabb = Solver.getAabb(position, orientation);
            if (aabb.max.x <= placement.aabb.max.x + 0.05) continue;
            if (!Solver.isAabbContainedInAnyZone(aabb, [zone])) continue;
            if (placed.some(other => other !== placement && Solver.aabbsOverlap(aabb, other.aabb))) continue;
            return { id: placement.id, from: placement.aabb, to: aabb };
          }
        }
      }
    }
  }
  return null;
}

function wwStagedRaisedOverhangOpportunity(Solver, result, truck, zones, items) {
  const geo = Solver.getWheelWellGeometry(truck);
  const packedLike = wwResultPlacements(Solver, result, items).map(p => ({
    instanceId: p.id,
    aabb: p.aabb,
    item: p.item,
  }));
  const staged = items.filter(item => !result.placements.has(item.instanceId));
  const round = value => Math.round(value * 1e6) / 1e6;
  const yLevels = [...new Set(packedLike.map(p => round(p.aabb.max.y)))]
    .filter(y => y >= geo.wellHeight - 0.05)
    .sort((a, b) => a - b);
  for (const item of staged) {
    for (const o of Solver.buildOrientationCandidates(item.dims, item)) {
      for (const y of yLevels) {
        if (y + o.h > truck.height + 0.05) continue;
        for (const rect of Solver.buildStackLayerFreeRects(packedLike, y)) {
          const rectL = rect.maxX - rect.minX;
          const rectW = rect.maxZ - rect.minZ;
          if (o.l > 2 * rectL + 0.05 || o.w > 2 * rectW + 0.05) continue;
          for (const xMin of [rect.minX, rect.maxX - o.l, rect.minX + (rectL - o.l) / 2]) {
            for (const zMin of [rect.minZ, rect.maxZ - o.w, rect.minZ + (rectW - o.w) / 2]) {
              const aabb = {
                min: { x: xMin, y, z: zMin },
                max: { x: xMin + o.l, y: y + o.h, z: zMin + o.w },
              };
              if (!Solver.isAabbWithinTruckMinusBlocked(aabb, geo)) continue;
              if (packedLike.some(p => Solver.aabbsOverlap(aabb, p.aabb))) continue;
              if (!Solver.isWheelWellSupportedAndStable(aabb, packedLike, geo, item)) continue;
              return { id: item.instanceId, aabb };
            }
          }
        }
      }
    }
  }
  return null;
}

const HANDLING_FIELDS = ['orientationLock', 'noStackOnTop', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority'];

const RULED_CASE = {
  id: 'rt-case', name: 'Ruled Case', category: 'default',
  dimensions: { length: 36, width: 24, height: 18 }, weight: 120,
  orientationLock: 'onSide', noStackOnTop: true, stackable: false,
  maxStackCount: 3, isPallet: true, maxPalletWeight: 1800, laneItem: false, loadPriority: 1,
};

async function threeOrientedTruth() {
  const THREE = await import(`${vendorThreePath.href}`);
  // Case length->world X, height->world Y, width->world Z.
  return function truth(dims, rot) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.length, dims.height, dims.width));
    mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0, 'XYZ');
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const r = (n) => Math.round(n * 1e6) / 1e6;
    return { length: r(size.x), width: r(size.z), height: r(size.y) };
  };
}

const CARGO_HEADER = 'name,length,width,height,weight,canFlip,orientationLock,laneItem,maxStackCount';

const CARGO_BAD_ROW = 'Widget,10,10,10,5,maybe,sideways,sometimes,2.7';

function findRowWarning(record, field) {
  return (record.warnings || []).find(w => w.field === field) || null;
}

function hostileRawCase(overrides = {}) {
  // JSON-safe by default (the restore/import paths only ever receive JSON). The
  // upsert/duplicate tests add a function override to prove it is dropped.
  return {
    id: 'hostile', name: 'Hostile Box', manufacturer: 'ACME', category: 'Tools',
    dimensions: { length: 30, width: 20, height: 10 },
    weight: '50',
    canFlip: 'false', stackable: 'no', noStackOnTop: 'maybe', isPallet: '1',
    maxStackCount: '3.9', maxPalletWeight: 'abc', laneItem: 'always', loadPriority: '1',
    shape: 'CYLINDER',
    customMeta: 'keep-me',
    ...overrides,
  };
}

function assertHostileCanonical(c, { extensions = true } = {}) {
  assert.equal(c.canFlip, undefined, 'retired canFlip is stripped, including safe extensions');
  assert.equal(c.stackable, false, '"no" -> stackable false');
  assert.equal(c.noStackOnTop, false, '"maybe" invalid -> noStackOnTop default false');
  assert.equal(c.isPallet, true, '"1" -> isPallet true');
  assert.equal(c.maxStackCount, 3, '"3.9" floored to 3');
  assert.equal(c.maxPalletWeight, 0, '"abc" invalid -> 0');
  assert.equal(c.laneItem, true, '"always" -> true');
  assert.equal(c.loadPriority, 1, '"1" -> 1');
  assert.equal(c.shape, 'cylinder', '"CYLINDER" -> cylinder');
  assert.ok(Number.isFinite(c.volume), 'volume finite');
  assert.equal(typeof c.evil, 'undefined', 'function extension dropped (not stored)');
  if (extensions) assert.equal(c.customMeta, 'keep-me', 'safe extension preserved');
}

function assertStackSafeOutput(Solver, output, itemsById, zones, label) {
  const placed = [...output.placements.keys()].map(id => {
    const od = output.orientedDims.get(id);
    return { id, item: itemsById.get(id), aabb: Solver.getAabb(output.placements.get(id), { l: od.length, w: od.width, h: od.height }) };
  });
  const canSupport = it => !(it && (it.noStackOnTop === true || it.stackable === false));
  const xzOverlap = (a, b) =>
    (Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) > 0.05 &&
    (Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)) > 0.05;

  for (const p of placed) {
    assert.equal(Solver.isAabbContainedInAnyZone(p.aabb, zones), true, `${label}: ${p.id} must stay inside a usable zone`);
    for (const q of placed) {
      if (q === p) continue;
      assert.equal(Solver.aabbsOverlap(p.aabb, q.aabb), false, `${label}: ${p.id} must not overlap ${q.id}`);
    }
    if (p.aabb.min.y <= 0.05) continue; // floor item
    const supports = placed.filter(q => q !== p && Math.abs(q.aabb.max.y - p.aabb.min.y) < 0.06 && xzOverlap(p.aabb, q.aabb));
    assert.ok(supports.length > 0, `${label}: stacked ${p.id} must rest on a support, not float`);
    for (const s of supports) {
      assert.equal(canSupport(s.item), true, `${label}: ${p.id} must not rest on no-stack support ${s.id}`);
      const isPallet = s.item && s.item.isPallet === true;
      assert.ok(isPallet || (Number(p.item.weight) || 0) <= (Number(s.item.weight) || 0),
        `${label}: heavier ${p.id} must not rest on lighter non-pallet ${s.id}`);
    }
    const frac = Solver.computeSupportFraction(p.aabb, supports.map(s => s.aabb));
    assert.ok(frac >= 0.5, `${label}: ${p.id} support fraction ${frac.toFixed(2)} must be >= 0.5`);
  }
  // maxStackCount is a per-support direct-children cap.
  for (const s of placed) {
    const max = Number(s.item && s.item.maxStackCount) || 0;
    if (max <= 0) continue;
    const direct = placed.filter(q => q !== s && Math.abs(q.aabb.min.y - s.aabb.max.y) < 0.06 && xzOverlap(q.aabb, s.aabb)).length;
    assert.ok(direct <= max, `${label}: support ${s.id} has ${direct} direct children, exceeds maxStackCount ${max}`);
  }
}

const R1_HALF = Math.PI / 2;

const r1Truth = (caseDims, rot, truth) => {
  const t = truth(caseDims, rot);
  return { l: t.length, w: t.width, h: t.height };
};

async function r1bModules() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return {
    Engine: await import(`${autoPackEnginePath.href}${stamp}`),
    ItemBuilder: await import(`${autoPackItemBuilderPath.href}${stamp}`),
    PackLib: await import(`${packLibraryPath.href}${stamp}`),
    Solver: await import(`${autoPackSolverPath.href}${stamp}`),
  };
}

function r1bLegacyItem(mods, caseObj, inst = {}) {
  const { ItemBuilder, PackLib } = mods;
  const items = ItemBuilder.buildLegacyAutoPackItems({
    instances: [{ id: 'inst', caseId: caseObj.id, hidden: false, ...inst }],
    getCaseById: id => (id === caseObj.id ? caseObj : null),
    volumeInCubicInches: d => d.length * d.width * d.height,
    orientationTools: {
      normalizeRightAngleRotation: PackLib.normalizeRightAngleRotation,
      getOrientedDimsForRotation: PackLib.getOrientedDimsForRotation,
    },
  });
  return items[0];
}

function r1bComposeStaged(mods, caseObj, truck, inst = {}) {
  const item = r1bLegacyItem(mods, caseObj, inst);
  const pose = mods.Engine.buildStagedPose(item);
  const staged = mods.PackLib.findSafeStagingPosition({ truck }, pose.dims, []);
  return {
    position: staged.position,
    rotation: pose.rotation,
    orientedDims: { length: pose.dims.length, width: pose.dims.width, height: pose.dims.height },
  };
}

function r1bAssertAtomicFloor(mods, caseObj, staged, truth, label) {
  const helper = mods.PackLib.getOrientedDimsForRotation(caseObj.dimensions, staged.rotation);
  const got = { l: staged.orientedDims.length, w: staged.orientedDims.width, h: staged.orientedDims.height };
  assert.deepEqual(got, { l: helper.length, w: helper.width, h: helper.height }, `${label}: orientedDims == shared helper(rotation)`);
  const t = truth(caseObj.dimensions, staged.rotation);
  assert.deepEqual(got, { l: t.length, w: t.width, h: t.height }, `${label}: orientedDims == THREE Box3(rotation)`);
  const bottom = staged.position.y - staged.orientedDims.height / 2;
  assert.ok(Math.abs(bottom) <= 0.05, `${label}: staged bottom rests on the floor (gap=${bottom})`);
}

async function r1bImportBeam(name) {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const csv = fsSync.readFileSync(beamCsvFixturePath, 'utf8');
  const parsed = await IE.parseAndValidateSpreadsheet(makeCsvFile(csv), []);
  const { nextCaseLibrary } = IE.importCaseRows(parsed.valid, []);
  const c = nextCaseLibrary.find(x => x.name === name);
  assert.ok(c, `imported beam fixture "${name}" exists`);
  return c;
}

function r1cSolverItem(extra) {
  return { instanceId: 'i', caseId: 'c', dims: { l: 144, w: 8, h: 8 }, ...extra };
}

const r1dRound = n => Math.round(n * 1e6) / 1e6;

async function runEnginePack({ caseObj, instances, truck }) {
  const THREE = await import(`${vendorThreePath.href}`);
  // Shared (non-cache-busted) singletons so PackLibrary/CaseLibrary/StateStore agree.
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(packLibraryPath.href);
  const CaseLibrary = await import(caseLibraryPath.href);
  const Utils = await import(coreUtilsIndexPath.href);
  const Engine = await import(autoPackEnginePath.href);

  StateStore.init({
    caseLibrary: [caseObj],
    packLibrary: [{ id: 'p', title: 'P', truck, cases: instances }],
    folderLibrary: [], preferences: {}, currentPackId: 'p',
  });

  // Real THREE objects: base case geometry (length->x, height->y, width->z), each
  // starting lying flat on the floor (identity rotation) — the pre-AutoPack pose.
  const objects = new Map();
  for (const inst of instances) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(caseObj.dimensions.length, caseObj.dimensions.height, caseObj.dimensions.width));
    mesh.userData = {};
    mesh.position.set(0, caseObj.dimensions.height / 2, 0);
    objects.set(inst.id, mesh);
  }

  const frames = [];
  const snapshot = (label) => {
    const objs = {};
    for (const [id, obj] of objects) {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); b.getSize(size);
      objs[id] = { minY: r1dRound(b.min.y), sizeY: r1dRound(size.y), posY: r1dRound(obj.position.y) };
    }
    frames.push({ label, objs });
  };

  const realSetTimeout = setTimeout;
  const win = {
    performance: { now: () => Date.now() },
    // Capture object state on every scheduled animation frame.
    requestAnimationFrame: (cb) => { snapshot('raf'); return realSetTimeout(() => cb(Date.now()), 0); },
    setTimeout: (fn) => realSetTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    TWEEN: null,
    OrgContext: null,
    __TP3D_BILLING: { getBillingState: () => ({ ok: true, orgId: '' }) },
  };
  const SceneManager = {
    vecInchesToWorld: v => ({ x: v.x, y: v.y, z: v.z }),
    toWorld: n => n,
  };
  const CaseScene = { getObject: id => objects.get(id) || null };

  const engine = Engine.createAutoPackEngine({
    CaseLibrary, CaseScene, capturePackPreview: () => {},
    getActiveOrgIdForBilling: () => '', getOrgRoleHydrationState: () => 'ready',
    getProRuleSet: () => ({ canUseProFeature: true }), getWorkspaceSwitchState: () => null,
    maybeScheduleBillingRefresh: () => {}, normalizeOrgIdForBilling: x => x, openSettingsOverlay: () => {},
    PackLibrary, runtimeWindow: win, SceneManager, StateStore, toast: () => {},
    TrailerGeometry: PackLibrary, UIComponents: { showToast: () => {} }, Utils,
  });

  await engine.pack();
  snapshot('final');
  const storedPack = PackLibrary.getById('p');
  return { THREE, objects, frames, storedPack, engine, StateStore, PackLibrary, snapshot };
}

function assertNoFloatFrames(frames, ids, label) {
  assert.ok(frames.some(f => f.label === 'raf'), `${label}: scheduled animation frames were captured`);
  for (const f of frames) {
    for (const id of ids) {
      const o = f.objs[id];
      if (!o) continue;
      assert.ok(Math.abs(o.minY) <= 0.05, `${label}: frame "${f.label}" object ${id} rests on floor (minY=${o.minY}, not floating)`);
    }
  }
}

function r1eLexLess(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0; const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

function r1eStackCandidate({ x, bottomY = 16, waste = 0, sf = 1 }) {
  return {
    aabb: { min: { x, y: bottomY, z: 0 }, max: { x: x + 24, y: bottomY + 16, z: 18 } },
    dims: { l: 24, w: 18, h: 16 },
    freeRect: { minX: 0, maxX: 24, minZ: 0, maxZ: (432 + waste) / 24 },
    supportFraction: sf,
  };
}

function r1eCartonItems(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({ instanceId: `i${i}`, caseId: 'c', dims: { l: 24, w: 18, h: 16 }, shape: 'box', weight: 35, orientationLock: 'any', canFlip: false, ...extra }));
}

function r1ePlaced(Solver, res, caseDims) {
  const out = [];
  for (const [id, pos] of res.placements) {
    const od = res.orientedDims.get(id);
    out.push({ id, pos, od, aabb: Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }), minY: pos.y - od.height / 2, maxY: pos.y + od.height / 2 });
  }
  return out;
}

function r1eOverlapXZ(a, b) {
  return Math.abs(a.pos.x - b.pos.x) < (a.od.length / 2 + b.od.length / 2) - 0.01 &&
         Math.abs(a.pos.z - b.pos.z) < (a.od.width / 2 + b.od.width / 2) - 0.01;
}

const RECON_CASE_LIB = [{ id: 'c', name: 'Carton', dimensions: { length: 24, width: 18, height: 16 },
  weight: 20, orientationLock: 'any' }];

const RECON_DIMS = { length: 24, width: 18, height: 16 };

function reconAabb(pos, dims) {
  return {
    min: { x: pos.x - dims.length / 2, y: pos.y - dims.height / 2, z: pos.z - dims.width / 2 },
    max: { x: pos.x + dims.length / 2, y: pos.y + dims.height / 2, z: pos.z + dims.width / 2 },
  };
}

function reconInst(id, x, y, z) {
  return { id, caseId: 'c', transform: { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, placement: 'packed', hidden: false };
}

function assertReconLayoutSafe(PackLib, finalCases, truck, label) {
  const zones = PackLib.getTrailerUsableZones(truck);
  const blocked = [
    ...(PackLib.getFrontBonusBlockedZones ? PackLib.getFrontBonusBlockedZones(truck) : []),
  ];
  const aabbs = finalCases.filter(c => !c.hidden).map(c => ({ c, aabb: reconAabb(c.transform.position, RECON_DIMS) }));
  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i].aabb, b = aabbs[j].aabb;
      const overlap = a.min.x < b.max.x - 0.05 && a.max.x > b.min.x + 0.05 &&
        a.min.y < b.max.y - 0.05 && a.max.y > b.min.y + 0.05 &&
        a.min.z < b.max.z - 0.05 && a.max.z > b.min.z + 0.05;
      assert.equal(overlap, false, `${label}: ${aabbs[i].c.id} and ${aabbs[j].c.id} must not overlap`);
    }
  }
  for (const { c, aabb } of aabbs) {
    // No blocked-zone use.
    for (const bz of blocked) {
      const inBlocked = aabb.min.x < bz.max.x - 0.05 && aabb.max.x > bz.min.x + 0.05 &&
        aabb.min.y < bz.max.y - 0.05 && aabb.max.y > bz.min.y + 0.05 &&
        aabb.min.z < bz.max.z - 0.05 && aabb.max.z > bz.min.z + 0.05;
      assert.equal(inBlocked, false, `${label}: ${c.id} must not enter a blocked zone`);
    }
    if (truck?.shapeMode === 'wheelWells') {
      assert.equal(PackLib.aabbIntersectsWheelWellBlockedBody(aabb, truck), false,
        `${label}: ${c.id} must not enter a wheel-well blocked body`);
    }
    if (c.placement === 'packed') {
      assert.equal(testAabbInsidePhysicalTrailer(PackLib, aabb, zones, truck), true,
        `${label}: packed ${c.id} is physically contained (no OOB/blocked body)`);
      // No floating: rests on a zone floor OR on another item with support >= MIN.
      const onFloor = testAabbOnPhysicalFloor(PackLib, aabb, zones, truck);
      if (!onFloor) {
        const supporters = aabbs.filter(o => o.c !== c && Math.abs(aabb.min.y - o.aabb.max.y) <= 0.05).map(o => o.aabb);
        assert.ok(PackLib.computeSupportFraction(aabb, supporters, 0.05) >= PackLib.MIN_SUPPORT_FRACTION, `${label}: packed ${c.id} is supported (not floating)`);
      }
    } else {
      // Staged items rest on the ground (bottom ~ 0) and sit outside the usable zones.
      assert.ok(Math.abs(aabb.min.y) <= 1.01, `${label}: staged ${c.id} is floor-contacting`);
      assert.equal(PackLib.isAabbContainedInAnyZone(aabb, zones), false, `${label}: staged ${c.id} is outside the usable zones`);
    }
  }
}

function assertCanonicalReconLayoutSafe(PackLib, finalCases, truck, caseLibrary, label) {
  const caseMap = new Map(caseLibrary.map(c => [c.id, c]));
  const zones = PackLib.getTrailerUsableZones(truck);
  const entries = finalCases.map(c => {
    const canonical = PackLib.getCanonicalInstanceEffectiveDims(c, caseMap.get(c.caseId));
    assert.equal(canonical.ok, true, `${label}: ${c.id} has canonical physical dimensions`);
    return { c, aabb: reconAabb(c.transform.position, canonical.dims) };
  });
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i].aabb, b = entries[j].aabb;
      const overlap = a.min.x < b.max.x - 0.001 && a.max.x > b.min.x + 0.001 &&
        a.min.y < b.max.y - 0.001 && a.max.y > b.min.y + 0.001 &&
        a.min.z < b.max.z - 0.001 && a.max.z > b.min.z + 0.001;
      assert.equal(overlap, false, `${label}: ${entries[i].c.id}/${entries[j].c.id} do not overlap`);
    }
  }
  const packed = entries.filter(entry => entry.c.placement === 'packed');
  for (const entry of entries) {
    if (entry.c.placement !== 'packed') {
      assert.ok(Math.abs(entry.aabb.min.y) <= 0.05, `${label}: staged ${entry.c.id} rests exactly on staging floor`);
      assert.equal(PackLib.isAabbInStagingZone({ truck }, entry.aabb), true, `${label}: staged ${entry.c.id} is reachable`);
      continue;
    }
    assert.equal(testAabbInsidePhysicalTrailer(PackLib, entry.aabb, zones, truck), true,
      `${label}: packed ${entry.c.id} physically contained`);
    if (truck?.shapeMode === 'wheelWells') {
      assert.equal(PackLib.aabbIntersectsWheelWellBlockedBody(entry.aabb, truck), false,
        `${label}: packed ${entry.c.id} clears wheel-well blocked bodies`);
    }
    const onFloor = testAabbOnPhysicalFloor(PackLib, entry.aabb, zones, truck);
    if (!onFloor) {
      const supports = packed.filter(other => other !== entry && Math.abs(entry.aabb.min.y - other.aabb.max.y) <= 0.05);
      assert.ok(PackLib.computeSupportFraction(entry.aabb, supports.map(s => s.aabb), 0.05) >= PackLib.MIN_SUPPORT_FRACTION,
        `${label}: packed ${entry.c.id} supported`);
    }
  }
}

const RECON_RECT = { length: 240, width: 96, height: 96, shapeMode: 'rect' };

const RECON_WW = { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' };

const reconFB = (bonusHeight = 43.2, bonusLength = 48) => ({ length: 240, width: 96, height: 96, shapeMode: 'frontBonus', shapeConfig: { bonusLength, bonusHeight } });

function buildLargeReconStagingRows(count, truck, caseData, options = {}) {
  const dims = caseData.dimensions;
  const gap = 12;
  const originZ = Number(truck.width) / 2 + gap;
  const cols = Math.max(1, Math.floor((Number(truck.length) + gap) / (dims.length + gap)));
  const verticalOffset = Number(options.verticalOffset) || 0;
  const prefix = options.prefix || 'large-stage';
  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const id = `${prefix}-${String(index).padStart(4, '0')}`;
    return {
      id,
      caseId: caseData.id,
      placement: 'staged',
      hidden: false,
      orientedDims: { ...dims },
      transform: {
        position: {
          x: dims.length / 2 + col * (dims.length + gap),
          y: dims.height / 2 + verticalOffset,
          z: originZ + dims.width / 2 + row * (dims.width + gap),
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      metadata: { sourceIndex: index },
      ...(options.packedProfile ? { packedProfile: options.packedProfile } : {}),
    };
  });
}

function assertLargeReconStagingSafe(PackLib, instances, truck, caseLibrary, label) {
  const caseMap = new Map(caseLibrary.map(caseData => [caseData.id, caseData]));
  const zones = PackLib.getTrailerUsableZones(truck);
  const entries = instances.map(inst => {
    const canonical = PackLib.getCanonicalInstanceEffectiveDims(inst, caseMap.get(inst.caseId));
    assert.equal(canonical.ok, true, `${label}: ${inst.id} has canonical dimensions`);
    const aabb = reconAabb(inst.transform.position, canonical.dims);
    assert.equal(inst.placement, 'staged', `${label}: ${inst.id} remains staged`);
    assert.ok(Math.abs(aabb.min.y) <= 0.05, `${label}: ${inst.id} rests on the staging ground`);
    assert.equal(zones.some(zone => packImportAabbsOverlap(aabb, zone)), false,
      `${label}: ${inst.id} does not intersect a usable truck volume`);
    assert.equal(PackLib.aabbIntersectsWheelWellBlockedBody(aabb, truck), false,
      `${label}: ${inst.id} clears Wheel Wells blocked bodies`);
    assert.equal(PackLib.aabbIntersectsFrontBonusBlockedBody(aabb, truck), false,
      `${label}: ${inst.id} clears Front Overhang blocked bodies`);
    return { inst, aabb };
  });
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      assert.equal(packImportAabbsOverlap(entries[i].aabb, entries[j].aabb), false,
        `${label}: ${entries[i].inst.id}/${entries[j].inst.id} do not overlap`);
    }
  }
  return entries;
}

function makeTruckChangeHarness() {
  const listeners = new Set();
  const documentRef = {
    // textContent mirrors the DOM: explicit text, else the children's text.
    createElement: tagName => ({
      tagName,
      children: [],
      className: '',
      ownText: '',
      get textContent() { return this.ownText || this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.ownText = String(value); },
      classList: { add() {} },
      appendChild(child) { this.children.push(child); return child; },
    }),
    addEventListener(type, fn) { if (type === 'keydown') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'keydown') listeners.delete(fn); },
    escape() { escapeCapture({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); },
  };
  let escapeCapture;
  const ownership = createModalOwnership({ documentRef,
    windowRef: { addEventListener(_type, callback) { escapeCapture = callback; } } });
  const modals = [];
  const toasts = [];
  const UIComponents = {
    showToast(message, type, options) { toasts.push({ message, type, options }); },
    showModal(config) {
      let closed = false;
      const buttons = (config.actions || []).map(action => ({ disabled: false, action }));
      const ref = {
        modal: { querySelectorAll: () => buttons },
        close() {
          if (closed) return;
          closed = true;
          ref.owner.release();
          if (config.onClose) config.onClose();
        },
      };
      ref.owner = ownership.register({ parentId: config.parentOwnerId, onDismiss: () => ref.close() });
      modals.push({ config, ref, buttons, get closed() { return closed; } });
      return ref;
    },
  };
  function click(index, label) {
    const record = modals[index];
    const action = record.config.actions.find(candidate => candidate.label === label);
    assert.ok(action, `modal ${index} has action ${label}`);
    const result = action.onClick ? action.onClick() : undefined;
    if (result !== false) record.ref.close();
    return result;
  }
  return { documentRef, UIComponents, modals, toasts, click };
}

const PHB_DIMS = { length: 24, width: 18, height: 16 };

async function phbSolverModules() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return {
    Solver: await import(`${autoPackSolverPath.href}${stamp}`),
    PackLib: await import(`${packLibraryPath.href}${stamp}`),
  };
}

function phbPlaced(Solver, res, dims) {
  return [...res.placements].map(([id, pos]) => {
    const od = res.orientedDims.get(id);
    return { id, pos, od, minY: pos.y - od.height / 2, maxY: pos.y + od.height / 2, aabb: Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }) };
  });
}

function phbOverlapXZ(a, b) {
  return Math.abs(a.pos.x - b.pos.x) < (a.od.length / 2 + b.od.length / 2) - 0.01 &&
         Math.abs(a.pos.z - b.pos.z) < (a.od.width / 2 + b.od.width / 2) - 0.01;
}

function phb2FloorHole(Solver, result, zones, itemSpec) {
  const packed = [...result.placements].map(([id, position]) => {
    const dims = result.orientedDims.get(id);
    return {
      id,
      aabb: Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height }),
    };
  });
  const orientations = Solver.buildOrientationCandidates(itemSpec.dims, itemSpec);
  const round = value => Math.round(value * 1e6) / 1e6;
  for (const zone of zones) {
    for (const orientation of orientations) {
      const xAnchors = new Set([zone.min.x, zone.max.x - orientation.l].map(round));
      const zAnchors = new Set([zone.min.z, zone.max.z - orientation.w].map(round));
      for (const placement of packed) {
        xAnchors.add(round(placement.aabb.min.x));
        xAnchors.add(round(placement.aabb.max.x));
        xAnchors.add(round(placement.aabb.min.x - orientation.l));
        xAnchors.add(round(placement.aabb.max.x - orientation.l));
        zAnchors.add(round(placement.aabb.min.z));
        zAnchors.add(round(placement.aabb.max.z));
        zAnchors.add(round(placement.aabb.min.z - orientation.w));
        zAnchors.add(round(placement.aabb.max.z - orientation.w));
      }
      for (const xMin of xAnchors) {
        for (const zMin of zAnchors) {
          const position = {
            x: xMin + orientation.l / 2,
            y: zone.min.y + orientation.h / 2,
            z: zMin + orientation.w / 2,
          };
          const aabb = Solver.getAabb(position, orientation);
          if (!Solver.isAabbContainedInAnyZone(aabb, [zone])) continue;
          if (packed.some(placement => Solver.aabbsOverlap(aabb, placement.aabb))) continue;
          return { position, orientation, aabb };
        }
      }
    }
  }
  return null;
}

function phb2FloorCount(result, zones, Solver) {
  let count = 0;
  for (const [id, position] of result.placements) {
    const dims = result.orientedDims.get(id);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    if (zones.some(zone =>
      Solver.isAabbContainedInAnyZone(aabb, [zone]) &&
      Math.abs(aabb.min.y - zone.min.y) <= 0.05
    )) count++;
  }
  return count;
}

function phb2SequentialForwardViolation(Solver, result, zones, itemSpecsById, options = {}) {
  const prior = [];
  const round = value => Math.round(value * 1e6) / 1e6;
  const sameLayerOnly = options.sameLayerOnly !== false;

  for (const [id, position] of result.placements) {
    const dims = result.orientedDims.get(id);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    const floorZone = zones.find(zone =>
      Solver.isAabbContainedInAnyZone(aabb, [zone]) &&
      Math.abs(aabb.min.y - zone.min.y) <= 0.05
    );
    if (!floorZone) continue;

    const itemSpec = itemSpecsById.get(id);
    const caseId = itemSpec?.caseId || '';
    const advancesRearward = prior.some(placement =>
      placement.caseId === caseId &&
      (!sameLayerOnly || Math.abs(placement.aabb.min.y - aabb.min.y) <= 0.05) &&
      placement.aabb.max.x > aabb.max.x + 0.05
    );

    if (advancesRearward && itemSpec) {
      for (const orientation of Solver.buildOrientationCandidates(itemSpec.dims, itemSpec)) {
        for (const zone of zones) {
          if (sameLayerOnly && Math.abs(zone.min.y - aabb.min.y) > 0.05) continue;
          const xAnchors = new Set([zone.min.x, zone.max.x - orientation.l].map(round));
          const zAnchors = new Set([zone.min.z, zone.max.z - orientation.w].map(round));
          for (const placement of prior) {
            xAnchors.add(round(placement.aabb.min.x));
            xAnchors.add(round(placement.aabb.max.x));
            xAnchors.add(round(placement.aabb.min.x - orientation.l));
            xAnchors.add(round(placement.aabb.max.x - orientation.l));
            zAnchors.add(round(placement.aabb.min.z));
            zAnchors.add(round(placement.aabb.max.z));
            zAnchors.add(round(placement.aabb.min.z - orientation.w));
            zAnchors.add(round(placement.aabb.max.z - orientation.w));
          }
          for (const xMin of xAnchors) {
            for (const zMin of zAnchors) {
              const candidatePosition = {
                x: xMin + orientation.l / 2,
                y: zone.min.y + orientation.h / 2,
                z: zMin + orientation.w / 2,
              };
              const candidateAabb = Solver.getAabb(candidatePosition, orientation);
              if (candidateAabb.max.x <= aabb.max.x + 0.05) continue;
              if (!Solver.isAabbContainedInAnyZone(candidateAabb, [zone])) continue;
              if (prior.some(placement => Solver.aabbsOverlap(candidateAabb, placement.aabb))) continue;
              return {
                selected: { id, caseId, position, dims, aabb },
                alternative: { position: candidatePosition, orientation, aabb: candidateAabb },
              };
            }
          }
        }
      }
    }

    prior.push({ id, caseId, aabb });
  }
  return null;
}

function phb2AssertDirectStackLimit(Solver, result, limit, label) {
  const placed = [...result.placements].map(([id, position]) => {
    const dims = result.orientedDims.get(id);
    return { id, aabb: Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height }) };
  });
  for (const support of placed) {
    const directChildren = placed.filter(child =>
      child !== support &&
      Math.abs(child.aabb.min.y - support.aabb.max.y) <= 0.05 &&
      Solver.computeXzOverlapArea(child.aabb, support.aabb) > 0.05
    );
    assert.ok(directChildren.length <= limit,
      `${label}: ${support.id} has ${directChildren.length} direct children (limit ${limit})`);
  }
}

function phb2AssertSafe(Solver, PackLib, result, zones, label, truck = null) {
  const placed = phbPlaced(Solver, result, PHB_DIMS);
  for (let i = 0; i < placed.length; i++) {
    assert.equal(testAabbInsidePhysicalTrailer(PackLib, placed[i].aabb, zones, truck), true,
      `${label}: contained ${placed[i].id}`);
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(Solver.aabbsOverlap(placed[i].aabb, placed[j].aabb), false, `${label}: no overlap ${placed[i].id}/${placed[j].id}`);
    }
    const onFloor = testAabbOnPhysicalFloor(PackLib, placed[i].aabb, zones, truck);
    if (!onFloor) {
      const supports = placed.filter(other =>
        other !== placed[i] &&
        Math.abs(other.aabb.max.y - placed[i].aabb.min.y) <= 0.05 &&
        phbOverlapXZ(placed[i], other)
      ).map(other => other.aabb);
      assert.ok(PackLib.computeSupportFraction(placed[i].aabb, supports, 0.05) >= PackLib.MIN_SUPPORT_FRACTION,
        `${label}: supported ${placed[i].id}`);
    }
  }
}

function phcResultBytes(result) {
  return JSON.stringify({
    placements: [...result.placements],
    rotations: [...result.rotations],
    orientedDims: [...result.orientedDims],
    unpacked: result.unpacked,
    phaseStats: result.phaseStats,
    warnings: result.warnings,
  });
}

function phcFloorTable(Solver, result, zones) {
  const table = new Map();
  for (const [id, position] of result.placements) {
    const dims = result.orientedDims.get(id);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    if (!zones.some(zone =>
      Solver.isAabbContainedInAnyZone(aabb, [zone]) &&
      Math.abs(aabb.min.y - zone.min.y) <= 0.05
    )) continue;
    const key = `${Math.round(aabb.min.y * 10) / 10}|${Math.round(aabb.max.x * 10) / 10}`;
    table.set(key, (table.get(key) || 0) + 1);
  }
  return [...table].map(([surface, count]) => ({ surface, count }));
}

function phcFrontOverhangTruck() {
  return {
    length: 240,
    width: 96,
    height: 96,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 28.8, bonusWidth: 96, bonusHeight: 43.2 },
  };
}

function phc2Aabb(minX, maxX, minY, maxY, minZ, maxZ) {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

function phc2Instance(id, caseId, position, dims, extra = {}) {
  return {
    id,
    caseId,
    placement: 'packed',
    transform: {
      position: { ...position },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    orientedDims: { ...dims },
    ...extra,
  };
}

function e1Placed(Solver, res) {
  return [...res.placements].map(([id, pos]) => {
    const od = res.orientedDims.get(id);
    return { id, pos, od, minY: pos.y - od.height / 2, maxY: pos.y + od.height / 2, aabb: Solver.getAabb(pos, { l: od.length, w: od.width, h: od.height }) };
  });
}

function e1Items(n, dims, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({ instanceId: `i${i}`, caseId: 'A', dims, shape: 'box', orientationLock: 'any', canFlip: false, weight: 30, ...extra }));
}

function e1AssertSafe(Solver, PackLib, P, zones, label) {
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    assert.equal(Solver.aabbsOverlap(P[i].aabb, P[j].aabb), false, `${label}: no overlap`);
  }
  for (const p of P) {
    assert.equal(PackLib.isAabbContainedInAnyZone(p.aabb, zones), true, `${label}: contained (no OOB/blocked)`);
    const floorY = Math.min(...P.map(q => q.minY));
    if (p.minY > floorY + 0.5) {
      const supports = P.filter(s => s !== p && Math.abs(s.maxY - p.minY) <= 0.05 &&
        Math.min(p.aabb.max.x, s.aabb.max.x) - Math.max(p.aabb.min.x, s.aabb.min.x) > 0.05 &&
        Math.min(p.aabb.max.z, s.aabb.max.z) - Math.max(p.aabb.min.z, s.aabb.min.z) > 0.05).map(s => s.aabb);
      assert.ok(PackLib.computeSupportFraction(p.aabb, supports, 0.05) >= PackLib.MIN_SUPPORT_FRACTION, `${label}: supported (not floating)`);
    }
  }
}

function e1LayerFollowFraction(P) {
  const floorY = Math.min(...P.map(p => p.minY));
  let stacked = 0, following = 0;
  for (const c of P) {
    if (Math.abs(c.minY - floorY) < 0.5) continue;
    stacked++;
    const support = P.find(s => s !== c && Math.abs(s.maxY - c.minY) < 0.5 &&
      Math.abs(s.pos.x - c.pos.x) < 0.5 && Math.abs(s.pos.z - c.pos.z) < 0.5 &&
      Math.round(s.od.length) === Math.round(c.od.length) && Math.round(s.od.width) === Math.round(c.od.width));
    if (support) following++;
  }
  return { stacked, following, fraction: stacked ? following / stacked : 1 };
}

const STRESS_ENABLED = process.env.TP3D_STRESS === '1';

const stressTest = (name, fn) => STRESS_ENABLED
  ? test(name, fn)
  : test(name, { skip: 'stress-gated: set TP3D_STRESS=1 (npm run test:stress)' }, fn);

const STRESS_COUNT_THRESHOLD = 500;

const stressCounts = counts => STRESS_ENABLED
  ? counts
  : counts.filter(n => n < STRESS_COUNT_THRESHOLD);

function e2aYawCounts(Solver, res) {
  const counts = new Map();
  for (const [id] of res.placements) {
    const od = res.orientedDims.get(id);
    const key = `${Math.round(od.length)}x${Math.round(od.width)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function e2aFlips(Solver, res) {
  const counts = [...e2aYawCounts(Solver, res).values()].sort((a, b) => b - a);
  return res.placements.size - (counts[0] || 0);
}

function e2bChannelStackLayers(Solver, res) {
  const pl = [...res.placements].map(([id, pos]) => {
    const od = res.orientedDims.get(id);
    return { x: pos.x, z: pos.z, minY: pos.y - od.height / 2 };
  });
  const ch = pl.filter(p => p.x > 159 && p.x < 381.6 && p.z >= -35.7 && p.z <= 35.7);
  if (!ch.length) return [];
  const floorY = Math.min(...ch.map(p => p.minY));
  const stack = ch.filter(p => p.minY > floorY + 0.5);
  const byLayer = new Map();
  for (const p of stack) {
    const k = Math.round(p.minY);
    byLayer.set(k, (byLayer.get(k) || 0) + 1);
  }
  return [...byLayer.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

function phdAlternatingItems(countA, countB, overrides = {}) {
  const items = [];
  const count = Math.max(countA, countB);
  for (let index = 0; index < count; index++) {
    if (index < countA) {
      items.push({
        instanceId: `A${index}`, caseId: 'A', dims: { l: 24, w: 18, h: 16 },
        orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
        ...overrides,
      });
    }
    if (index < countB) {
      items.push({
        instanceId: `B${index}`, caseId: 'B', dims: { l: 24, w: 18, h: 16 },
        orientationLock: 'any', canFlip: false, weight: 30, maxStackCount: 2,
        ...overrides,
      });
    }
  }
  return items;
}

function phdSpatialRows(Solver, result, items) {
  const itemById = new Map(items.map(item => [item.instanceId, item]));
  const rows = new Map();
  const records = [...result.placements].map(([id, position]) => {
    const dims = result.orientedDims.get(id);
    const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
    return {
      id,
      caseId: itemById.get(id)?.caseId || '',
      aabb,
      orientation: `${dims.length}x${dims.width}x${dims.height}`,
    };
  }).sort((a, b) =>
    b.aabb.max.x - a.aabb.max.x ||
    a.aabb.min.y - b.aabb.min.y ||
    a.aabb.min.z - b.aabb.min.z ||
    a.id.localeCompare(b.id)
  );

  for (const record of records) {
    const key = `${Math.round(record.aabb.min.y * 10) / 10}|${Math.round(record.aabb.max.x * 10) / 10}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(record);
  }
  return [...rows].map(([row, entries]) => ({
    row,
    cases: entries.map(entry => entry.caseId).join(''),
    orientations: entries.map(entry => entry.orientation),
  }));
}

function phdSplitRunCount(rows) {
  const sequence = rows.flatMap(row => [...row.cases]);
  const runs = sequence.filter((caseId, index) => index === 0 || caseId !== sequence[index - 1]);
  return Math.max(0, runs.length - new Set(sequence).size);
}

function phdRowFragmentCount(rows) {
  return rows.reduce((total, row) => {
    const sequence = [...row.cases];
    const runs = sequence.filter((caseId, index) => index === 0 || caseId !== sequence[index - 1]);
    return total + Math.max(0, runs.length - new Set(sequence).size);
  }, 0);
}

function phb2AnimationRecord(Solver, result, caseIds, id, position) {
  const dims = result.orientedDims.get(id);
  const aabb = Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height });
  return { id, position, dims, aabb, caseId: caseIds.get(id) || '' };
}

function phb2AssertAnimationBatches(Solver, result, caseIds, batches, label) {
  const batchIndex = new Map();
  const flattened = [];
  batches.forEach((batch, index) => {
    assert.ok(batch.length > 0 && batch.length <= 4, `${label}: batch ${index} is bounded to 1..4 items`);
    const records = batch.map(([id, position]) => phb2AnimationRecord(Solver, result, caseIds, id, position));
    const layerKeys = new Set(records.map(record => Math.round(record.aabb.min.y / 0.05)));
    const rowKeys = new Set(records.map(record => Math.round(record.aabb.max.x / 0.05)));
    const groups = new Set(records.map(record => record.caseId));
    assert.equal(layerKeys.size, 1, `${label}: batch ${index} does not cross support layers`);
    assert.equal(rowKeys.size, 1, `${label}: batch ${index} does not cross X-row/load-wall boundaries`);
    assert.equal(groups.size, 1, `${label}: batch ${index} does not cross caseId groups`);
    for (const record of records) {
      batchIndex.set(record.id, index);
      flattened.push(record);
    }
  });

  const byLayer = new Map();
  for (const record of flattened) {
    const key = Math.round(record.aabb.min.y / 0.05);
    if (!byLayer.has(key)) byLayer.set(key, []);
    byLayer.get(key).push(record);
  }
  for (const [layer, records] of byLayer) {
    for (let index = 1; index < records.length; index++) {
      assert.ok(records[index].aabb.max.x <= records[index - 1].aabb.max.x + 0.05,
        `${label}: layer ${layer} completes high-X walls before lower-X walls`);
    }
  }

  const bySemanticRow = new Map();
  for (const record of flattened) {
    const key = `${Math.round(record.aabb.min.y / 0.05)}|${Math.round(record.aabb.max.x / 0.05)}`;
    if (!bySemanticRow.has(key)) bySemanticRow.set(key, []);
    bySemanticRow.get(key).push(record.caseId);
  }
  for (const [row, caseSequence] of bySemanticRow) {
    const runs = caseSequence.filter((caseId, index) => index === 0 || caseId !== caseSequence[index - 1]);
    assert.equal(new Set(runs).size, runs.length, `${label}: row ${row} does not return to a caseId after another group starts`);
  }

  for (const child of flattened) {
    for (const support of flattened) {
      if (support === child) continue;
      if (Math.abs(support.aabb.max.y - child.aabb.min.y) > 0.05) continue;
      if (Solver.computeXzOverlapArea(support.aabb, child.aabb) <= 0.05) continue;
      assert.ok(batchIndex.get(support.id) < batchIndex.get(child.id),
        `${label}: supporter ${support.id} completes before child ${child.id}`);
    }
  }
  return flattened;
}

async function executeOrgMemberRoleUpdate(options = {}) {
  const source = await fs.readFile(orgMemberRoleUpdatePath, 'utf8');
  const executableSource = source.replace(/^import[^\n]*\n/gm, '');
  const actorId = options.actorId || '11111111-1111-4111-8111-111111111111';
  const targetUserId = options.targetUserId || '22222222-2222-4222-8222-222222222222';
  const organizationId = options.organizationId || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const calls = {
    serviceClient: 0,
    organizationReads: 0,
    membershipReads: 0,
    updates: [],
    logs: [],
  };
  let handler = null;

  function createQuery(table) {
    let operation = 'select';
    let updatePayload = null;
    const filters = [];
    const query = {
      select() {
        return query;
      },
      update(payload) {
        operation = 'update';
        updatePayload = payload;
        return query;
      },
      eq(field, value) {
        filters.push([String(field), value]);
        return query;
      },
      async maybeSingle() {
        const filterValue = field => {
          const match = filters.find(([candidate]) => candidate === field);
          return match ? match[1] : undefined;
        };

        if (table === 'organizations') {
          calls.organizationReads += 1;
          if (options.failure === 'organization') {
            return { data: null, error: { message: 'relation organizations leaked detail' } };
          }
          if (options.organizationMissing) return { data: null, error: null };
          return {
            data: { owner_id: options.canonicalOwnerId || actorId },
            error: null,
          };
        }

        if (table !== 'organization_members') {
          throw new Error(`Unexpected table ${table}`);
        }

        const requestedUserId = String(filterValue('user_id') || '');
        if (operation === 'update') {
          calls.updates.push({ payload: updatePayload, filters: [...filters] });
          if (options.failure === 'update') {
            return { data: null, error: { message: 'update organization_members leaked detail' } };
          }
          if (options.updateReturnsNull) return { data: null, error: null };
          return {
            data: {
              id: '44444444-4444-4444-8444-444444444444',
              organization_id: organizationId,
              user_id: targetUserId,
              role: String(updatePayload?.role || ''),
              joined_at: null,
            },
            error: null,
          };
        }

        calls.membershipReads += 1;
        if (requestedUserId === actorId) {
          if (options.failure === 'actor') {
            return { data: null, error: { message: 'actor organization_members leaked detail' } };
          }
          return options.actorMissing
            ? { data: null, error: null }
            : { data: { role: options.actorRole || 'owner' }, error: null };
        }
        if (requestedUserId === targetUserId) {
          if (options.failure === 'target') {
            return { data: null, error: { message: 'target organization_members leaked detail' } };
          }
          return options.targetMissing
            ? { data: null, error: null }
            : { data: { role: options.targetRole || 'member' }, error: null };
        }
        return { data: null, error: null };
      },
    };
    return query;
  }

  const sandbox = {
    Deno: {
      serve(fn) {
        handler = fn;
      },
    },
    getAllowedOrigin: () => 'https://app.test',
    handleCors: () => null,
    json: (body, init = {}) => ({ status: Number(init.status || 200), body }),
    requireUser: async () => ({ ok: true, user: { id: actorId } }),
    serviceClient: () => {
      calls.serviceClient += 1;
      return { from: table => createQuery(table) };
    },
    console: {
      error: (...args) => calls.logs.push(args),
    },
  };

  vm.runInNewContext(stripTypeScriptTypes(executableSource, { mode: 'strip' }), sandbox);
  assert.equal(typeof handler, 'function', 'production Edge Function handler must be captured');

  const response = await handler({
    method: 'POST',
    json: async () => ({
      org_id: options.payloadOrgId ?? organizationId,
      user_id: options.payloadUserId ?? targetUserId,
      role: options.nextRole || 'member',
    }),
  });
  return { response, calls, actorId, targetUserId, organizationId };
}

function previewHarnessVisualSignature(pack) {
  return JSON.stringify((pack.cases || []).map(inst => ({ id: inst.id, transform: inst.transform || null })));
}

const previewHarnessViewSignature = () => 'settled-view';

async function createPackPreviewSchedulerHarness({
  currentScreen = 'editor',
  currentPackId = 'pack-a',
  workspaceKey = 'user-a|workspace-a',
  pack = null,
  onCapture = null,
} = {}) {
  const src = await fs.readFile(appPath, 'utf8');
  const start = src.indexOf('function createPackPreviewScheduler(');
  const end = src.indexOf('\n\nconst TP3D_BUILD_STAMP', start);
  assert.ok(start >= 0 && end > start, 'Pack preview scheduler is extractable from the production owner');

  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    ${src.slice(start, end)}
    globalThis.__createPackPreviewScheduler = createPackPreviewScheduler;
  `, context);

  const { createOperationLifecycle } = await import(
    `${operationLifecyclePath.href}?preview-scheduler=${Date.now()}-${Math.random()}`
  );
  const OperationLifecycle = createOperationLifecycle();
  const state = { currentScreen, currentPackId };
  const packs = new Map();
  const initialPack = pack || {
    id: 'pack-a',
    cases: [{ id: 'instance-a' }],
    lastEdited: 200,
    thumbnailUpdatedAt: 100,
  };
  if (initialPack) packs.set(initialPack.id, initialPack);

  let activeWorkspaceKey = workspaceKey;
  let nextTimerId = 0;
  const timers = new Map();
  const captures = [];
  const setTimer = (fn, delay) => {
    nextTimerId += 1;
    timers.set(nextTimerId, { fn, delay });
    return nextTimerId;
  };
  const clearTimer = timerId => timers.delete(timerId);
  const capturePackPreview = (packId, options) => {
    captures.push({ packId, options });
    return onCapture ? onCapture({ packId, options, packs, state }) : true;
  };
  const scheduler = context.__createPackPreviewScheduler({
    StateStore: { get: key => state[key] },
    PackLibrary: { getById: packId => packs.get(packId) || null },
    OperationLifecycle,
    capturePackPreview,
    getActiveWorkspaceKey: () => activeWorkspaceKey,
    getVisualSignature: previewHarnessVisualSignature,
    getViewSignature: previewHarnessViewSignature,
    delayMs: 300,
    setTimer,
    clearTimer,
  });

  return {
    OperationLifecycle,
    captures,
    packs,
    scheduler,
    state,
    timers,
    setWorkspaceKey(nextWorkspaceKey) {
      activeWorkspaceKey = nextWorkspaceKey;
    },
    runTimers() {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach(({ fn }) => fn());
    },
  };
}

async function p5Modules() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return {
    Core: await import(`${packingCorePath.href}${stamp}`),
    Solver: await import(`${autoPackSolverPath.href}${stamp}`),
    PackLib: await import(`${packLibraryPath.href}${stamp}`),
  };
}

function p8WheelWellTruck() {
  return {
    length: 240, width: 96, height: 96, shapeMode: 'wheelWells',
    shapeConfig: { wellOffsetFromRear: 80, wellLength: 80, wellHeight: 34, wellWidth: 14.4 },
  };
}

function p8Item(Solver, id, dims, extra = {}) {
  const raw = { instanceId: id, caseId: id, orientationLock: 'upright', canFlip: false, weight: 50, ...extra };
  const candidates = Solver.buildOrientationCandidates(dims, raw);
  return {
    id, item: raw, dims, candidates,
    volume: dims.l * dims.w * dims.h, footprint: dims.l * dims.w,
    weight: raw.weight, index: 0, className: 'STANDARD',
  };
}

function p8PackedEntry(Solver, item, position) {
  const orientation = item.candidates[0];
  const dims = { l: orientation.l, w: orientation.w, h: orientation.h };
  return {
    instanceId: item.id, item, pos: position, dims,
    aabb: Solver.getAabb(position, dims), orientation, phase: 'floor', zone: null,
  };
}

function maxAResultBytes(result) {
  return JSON.stringify({
    placements: [...result.placements],
    rotations: [...result.rotations],
    orientedDims: [...result.orientedDims],
    retentionDependencies: [...result.retentionDependencies],
    unpacked: result.unpacked,
    warnings: result.warnings,
    rejectionReasons: result.rejectionReasons,
    solveStatus: result.solveStatus,
    phaseStats: result.phaseStats,
  });
}

function maxAPlaced(Solver, result, items) {
  const itemById = new Map(items.map(item => [item.instanceId, item]));
  return [...result.placements].map(([id, position]) => {
    const dims = result.orientedDims.get(id);
    return {
      id,
      item: itemById.get(id),
      position,
      rotation: result.rotations.get(id),
      dims,
      aabb: Solver.getAabb(position, { l: dims.length, w: dims.width, h: dims.height }),
    };
  });
}

function maxAAssertPhysicalSafety({ Solver, PackLib, Oriented, result, truck, zones, items, label, fixedPlacements = [] }) {
  const placed = maxAPlaced(Solver, result, items);
  const wheelWell = Solver.getWheelWellGeometry(truck);
  const cabVoid = truck.shapeMode === 'frontBonus' ? PackLib.getFrontBonusBlockedZones(truck) : [];

  for (let i = 0; i < placed.length; i++) {
    const placement = placed[i];
    const sourceDims = placement.item.dims;
    const expectedDims = Oriented.getOrientedDimsForRotation({
      length: sourceDims.l,
      width: sourceDims.w,
      height: sourceDims.h,
    }, placement.rotation);
    assert.deepEqual(placement.dims, expectedDims, `${label}: ${placement.id} uses real oriented dimensions`);
    for (const axis of ['x', 'y', 'z']) {
      const quarterTurns = Number(placement.rotation?.[axis] || 0) / (Math.PI / 2);
      assert.ok(Math.abs(quarterTurns - Math.round(quarterTurns)) <= 1e-9,
        `${label}: ${placement.id} ${axis} rotation is a canonical 90-degree turn`);
    }

    assert.equal(testAabbInsidePhysicalTrailer(PackLib, placement.aabb, zones, truck), true,
      `${label}: ${placement.id} remains contained in physical space`);
    if (wheelWell) {
      assert.equal(Solver.aabbIntersectsWheelWellBody(placement.aabb, wheelWell), false,
        `${label}: ${placement.id} never penetrates a wheel-well body`);
    }
    for (const blocked of cabVoid) {
      assert.equal(Solver.aabbsOverlap(placement.aabb, blocked), false,
        `${label}: ${placement.id} never enters the Front Overhang cab void`);
    }
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(Solver.aabbsOverlap(placement.aabb, placed[j].aabb), false,
        `${label}: no overlap ${placement.id}/${placed[j].id}`);
    }

    if (!testAabbOnPhysicalFloor(PackLib, placement.aabb, zones, truck)) {
      const supports = placed.filter(other =>
        other !== placement &&
        Math.abs(other.aabb.max.y - placement.aabb.min.y) <= 0.05 &&
        Solver.computeXzOverlapArea(other.aabb, placement.aabb) > 0.05
      );
      assert.ok(PackLib.computeSupportFraction(placement.aabb, supports.map(other => other.aabb), 0.05) >= PackLib.MIN_SUPPORT_FRACTION,
        `${label}: ${placement.id} has real cargo support and does not float`);
      if (wheelWell) {
        const physicalOnlyItem = item => ({
          ...item,
          noStackOnTop: false,
          stackable: true,
          maxStackCount: 0,
          relaxWeightComparison: true,
        });
        const packedWithout = placed.filter(other => other !== placement).map(other => ({
          instanceId: other.id,
          aabb: other.aabb,
          item: physicalOnlyItem(other.item),
        }));
        assert.equal(Solver.isWheelWellSupportedAndStable(
          placement.aabb,
          packedWithout,
          wheelWell,
          physicalOnlyItem(placement.item)
        ), true, `${label}: ${placement.id} keeps Wheel Wells support, COM, and cantilever safety`);
      }
    }

    if (truck.shapeMode === 'frontBonus') {
      const accepted = [
        ...fixedPlacements,
        ...placed.filter(other => other !== placement).map(other => ({
          instanceId: other.id,
          aabb: other.aabb,
          placement: 'packed',
          valid: true,
        })),
      ];
      assert.equal(
        PackLib.evaluateFrontOverhangRearRetention(placement.aabb, accepted, truck, zones).retained,
        true,
        `${label}: ${placement.id} keeps required Front Overhang rear retention`
      );
    }
  }
}

async function createBillingPumpRuntimeHarness() {
  const appSrc = await fs.readFile(appPath, 'utf8');
  const billingSrc = await fs.readFile(billingServicePath, 'utf8');
  // Stage 1: the authoritative-refresh block moved into the extracted billing service.
  const authoritativeStart = billingSrc.indexOf('let _billingAuthoritativeRefreshGeneration = 0;');
  const authoritativeEnd = billingSrc.indexOf('function nullableFiniteNumber(', authoritativeStart);
  assert.ok(authoritativeStart >= 0 && authoritativeEnd > authoritativeStart,
    'production authoritative-refresh state block is extractable from billing-service');
  const authoritativeSource = billingSrc.slice(authoritativeStart, authoritativeEnd);
  // The retained billing pump still lives in app.js and now delegates to BillingService.*
  const pumpStart = appSrc.indexOf('const BILLING_PUMP_RETRY_MS = 200;');
  const pumpEnd = appSrc.indexOf('function handleOrgAccessLoss(', pumpStart);
  assert.ok(pumpStart >= 0 && pumpEnd > pumpStart, 'production billing-pump block is extractable');
  const pumpSource = appSrc.slice(pumpStart, pumpEnd);

  const context = {
    __now: 100000,
    __activeOrgId: 'org-a',
    __userId: 'user-a',
    __billingState: {
      ok: false,
      loading: false,
      pending: false,
      error: null,
      orgId: null,
      lastFetchedAt: 0,
    },
    __calls: [],
    __logs: [],
    __clearedTimers: [],
    __failNext: false,
    __shared: null,
    __sharedFreshAt: 0,
    __sharedApplyCount: 0,
  };
  context.Date = class FakeDate extends Date {
    static now() { return context.__now; }
  };
  context.SupabaseClient = { isAuthProven: () => true };
  context.getAuthTruthSnapshot = () => ({ status: 'signed_in', userId: context.__userId, session: null });
  context.getActiveOrgIdNow = () => context.__activeOrgId;
  context.normalizeOrgIdForBilling = value => String(value || '').trim();
  context.billingDebugLog = (...args) => context.__logs.push(args);
  context.clearTimeout = timer => {
    if (timer !== null && typeof timer !== 'undefined') context.__clearedTimers.push(timer);
  };
  context.setTimeout = (_fn, _delay) => ({ id: context.__clearedTimers.length + 1 });
  context._readShareableBillingResult = () => context.__shared;
  context._applySharedBillingSnapshot = (_orgId, shared) => {
    if (!shared) return false;
    context.__sharedApplyCount += 1;
    Object.assign(context.__billingState, shared);
    return true;
  };
  context._shouldApplySharedBillingSnapshotForOrg = () => true;
  context._getSharedBillingFreshness = () => context.__sharedFreshAt;
  context._readSharedBillingResult = () => context.__shared;
  context._BILLING_SHARED_FRESH_MS = 90000;
  context.refreshBilling = options => {
    context.__calls.push({ ...options, orgId: context.__activeOrgId, at: context.__now });
    const authoritativeRefresh = options && options.authoritativeRefresh ? options.authoritativeRefresh : null;
    if (authoritativeRefresh && !context.__authoritative.begin(authoritativeRefresh)) {
      return Promise.resolve({ ...context.__billingState });
    }
    if (context.__failNext) {
      context.__failNext = false;
      Object.assign(context.__billingState, {
        ok: false,
        loading: false,
        pending: false,
        error: { message: 'billing unavailable' },
        orgId: context.__activeOrgId,
        lastFetchedAt: context.__now,
      });
      context.__authoritative.preserve(authoritativeRefresh);
    } else {
      Object.assign(context.__billingState, {
        ok: true,
        loading: false,
        pending: false,
        error: null,
        orgId: context.__activeOrgId,
        lastFetchedAt: context.__now,
      });
      if (authoritativeRefresh) {
        context.window.__TP3D_USER_SWITCH_PENDING = false;
        context.__authoritative.complete(authoritativeRefresh);
      }
    }
    context.__authoritative.finish(authoritativeRefresh);
    return Promise.resolve({ ...context.__billingState });
  };
  context.window = {
    __TP3D_USER_SWITCH_PENDING: false,
    __TP3D_BILLING: {
      getBillingState: () => context.__billingState,
    },
  };

  vm.createContext(context);
  vm.runInContext(`
    let _billingEpoch = 1;
    let _authTruthSnapshotAccessor = () => ({ userId: globalThis.__userId });
    const _billingState = globalThis.__billingState;
    let _lastBillingKey = '';
    let _lastBillingKeyAt = 0;
    ${authoritativeSource}
    ${pumpSource}
    // Stage 1: the retained pump delegates to BillingService.*; map each call to the
    // eval'd authoritative fn (real) or the controlled mock, matching pre-extraction behavior.
    globalThis.BillingService = {
      refreshBilling: (...a) => refreshBilling(...a),
      getBillingState: () => _billingState,
      _applySharedBillingSnapshot: (...a) => _applySharedBillingSnapshot(...a),
      _getSharedBillingFreshness: (...a) => _getSharedBillingFreshness(...a),
      _readShareableBillingResult: (...a) => _readShareableBillingResult(...a),
      _readSharedBillingResult: (...a) => _readSharedBillingResult(...a),
      _shouldApplySharedBillingSnapshotForOrg: (...a) => _shouldApplySharedBillingSnapshotForOrg(...a),
      abbreviateBillingLifecycleId: (...a) => abbreviateBillingLifecycleId(...a),
      billingAuthLifecycleDebugLog: (...a) => billingAuthLifecycleDebugLog(...a),
      getCurrentBillingAuthUserId: (...a) => getCurrentBillingAuthUserId(...a),
      getBillingAuthoritativeRefreshToken: (...a) => getBillingAuthoritativeRefreshToken(...a),
      isBillingAuthoritativeRefreshInFlight: (...a) => isBillingAuthoritativeRefreshInFlight(...a),
      resetRefreshDedupForUserSwitch: () => { _lastBillingKey = ''; _lastBillingKeyAt = 0; },
    };
    // Stage 2 CP2: the pump resolves the active org via OrganizationService.getActiveOrgIdNow.
    globalThis.OrganizationService = {
      getActiveOrgIdNow: (...a) => getActiveOrgIdNow(...a),
    };
    globalThis.__authoritative = {
      begin: token => beginBillingAuthoritativeRefreshAttempt(token),
      complete: token => clearBillingAuthoritativeRefreshRequirement(token),
      finish: token => finishBillingAuthoritativeRefreshAttempt(token),
      preserve: token => preserveUserSwitchPendingForBillingFailure(token),
      isCurrent: token => isCurrentBillingAuthoritativeRefreshToken(token, token && token.orgId),
      snapshot: () => _billingAuthoritativeRefreshRequired
        ? { ..._billingAuthoritativeRefreshRequired }
        : null,
    };
    globalThis.__pump = {
      run: reason => maybeScheduleBillingRefresh(reason),
      reset: () => resetBillingPumpForUserSwitch(),
      setOrg: orgId => { globalThis.__activeOrgId = orgId; },
      setIdentityWithoutRequirement: (userId, orgId) => {
        globalThis.__userId = userId;
        globalThis.__activeOrgId = orgId;
      },
      advanceEpochWithoutRequirement: () => { _billingEpoch += 1; },
      switchIdentity: (userId, orgId) => {
        globalThis.__userId = userId;
        globalThis.__activeOrgId = orgId;
        globalThis.window.__TP3D_USER_SWITCH_PENDING = true;
        resetBillingPumpForUserSwitch();
        _billingEpoch += 1;
        requireBillingAuthoritativeRefreshForUserSwitch(userId);
      },
      signOut: ({ authenticated = true } = {}) => {
        clearBillingAuthoritativeRefreshRequirement();
        globalThis.window.__TP3D_USER_SWITCH_PENDING = false;
        if (authenticated) markBillingAuthoritativeRefreshForNextSignIn();
        globalThis.__userId = '';
        _billingEpoch += 1;
      },
      authEvent: (event, userId = '', orgId = '') => {
        if (userId) {
          globalThis.__userId = userId;
          globalThis.__activeOrgId = orgId;
        }
        return transferPendingPostSignoutBillingRequirementForAuthenticatedUser({
          userId,
          source: 'auth-listener',
          authEvent: event,
        });
      },
      renderAuthenticated: (event, userId = '', orgId = '') => {
        if (userId) {
          globalThis.__userId = userId;
          globalThis.__activeOrgId = orgId;
        }
        return transferPendingPostSignoutBillingRequirementForAuthenticatedUser({
          userId,
          source: 'render-auth-state',
          authEvent: event,
        });
      },
      rehydrateAuthenticated: (reason, userId = '', orgId = '') => {
        if (userId) {
          globalThis.__userId = userId;
          globalThis.__activeOrgId = orgId;
        }
        return transferPendingPostSignoutBillingRequirementForAuthenticatedUser({
          userId,
          source: 'rehydrate-auth-state',
          authEvent: reason,
        });
      },
      setShared: (shared, freshAt = globalThis.__now) => {
        globalThis.__shared = shared;
        globalThis.__sharedFreshAt = freshAt;
      },
      getAuthoritativeToken: () => getBillingAuthoritativeRefreshToken(globalThis.__activeOrgId),
      beginAuthoritative: token => beginBillingAuthoritativeRefreshAttempt(token),
      completeAuthoritative: token => clearBillingAuthoritativeRefreshRequirement(token),
      isAuthoritativeCurrent: token => isCurrentBillingAuthoritativeRefreshToken(token, token && token.orgId),
      isAuthoritativeCurrentForOrg: (token, orgId) => isCurrentBillingAuthoritativeRefreshToken(token, orgId),
      advance: ms => { globalThis.__now += ms; },
      failNext: () => { globalThis.__failNext = true; },
      seedOwnedState: () => {
        _billingPumpTimer = { id: 'prior-user-retry' };
        _billingPumpTries = 4;
        _billingPumpEverRan = true;
        _billingPumpLastByReason.set('org-context', globalThis.__now);
        _billingPumpLastRunAtMs = globalThis.__now;
        _lastBillingKey = 'prior-user|pump:org-context|1';
        _lastBillingKeyAt = globalThis.__now;
      },
      snapshot: () => ({
        timer: _billingPumpTimer,
        tries: _billingPumpTries,
        everRan: _billingPumpEverRan,
        reasons: Array.from(_billingPumpLastByReason.entries()),
        lastRunAtMs: _billingPumpLastRunAtMs,
        lastBillingKey: _lastBillingKey,
        lastBillingKeyAt: _lastBillingKeyAt,
        authoritativeRequired: _billingAuthoritativeRefreshRequired
          ? { ..._billingAuthoritativeRefreshRequired }
          : null,
        requireOnNextSignIn: _billingRequireAuthoritativeOnNextSignIn,
        pending: Boolean(globalThis.window.__TP3D_USER_SWITCH_PENDING),
        sharedApplyCount: globalThis.__sharedApplyCount,
      }),
    };
  `, context);

  return {
    pump: context.__pump,
    calls: context.__calls,
    logs: context.__logs,
    clearedTimers: context.__clearedTimers,
    billingState: context.__billingState,
  };
}

async function createOrgContextApplyRuntimeHarness({
  initialActiveOrgId = null,
  localOrgId = null,
  hasLoadedWorkspace = false,
  storageScope = 'anon',
  workspaceScope = 'no-org',
  currentScreen = 'packs',
  workspaceSwitchActive = false,
} = {}) {
  const src = await readAppSource();
  const resolverStart = src.indexOf('function resolveOrgContextFromBundle(bundle)');
  const applyStart = src.indexOf('async function applyOrgContextFromBundle(');
  const applyEnd = src.indexOf('async function refreshOrgContext(', applyStart);
  assert.ok(resolverStart >= 0 && applyStart > resolverStart && applyEnd > applyStart,
    'production org-context resolver/apply functions are extractable');

  const resolverSource = src.slice(resolverStart, src.indexOf('// ── Workspace-ready event replay buffer', resolverStart));
  const applySource = src.slice(applyStart, applyEnd);
  const context = {
    __accountSwitcherRefreshes: 0,
    __orgRequiredCalls: [],
    __renderCalls: [],
    __billingReasons: [],
    __writtenOrgIds: [],
    __workspaceApplies: [],
    __workspaceResets: [],
    __accessGateCalls: 0,
    __legacyMigrationFinalizations: 0,
    __initialActiveOrgId: initialActiveOrgId,
    __localOrgId: localOrgId,
    __hasLoadedWorkspace: hasLoadedWorkspace,
    __storageScope: storageScope,
    __workspaceScope: workspaceScope,
    __currentScreen: currentScreen,
    __workspaceSwitchActive: workspaceSwitchActive,
    console: { info() { }, warn() { }, error() { } },
    document: { hidden: false },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(`
    let orgContext = {
      activeOrgId: globalThis.__initialActiveOrgId,
      activeOrg: null,
      orgs: [],
      role: null,
      updatedAt: 0,
    };
    let hasLoadedScopedState = globalThis.__hasLoadedWorkspace;
    let orgContextResolved = false;
    let orgContextQueued = false;
    let lastOrgPersistAt = 0;
    let lastOrgIdNotified = null;
    let lastOrgChangeAt = 0;
    let _orgBundleFetchInflightForOrg = null;
    const ORG_PERSIST_COOLDOWN_MS = 5000;
    const ORG_CONTEXT_DEDUP_MS = 500;
    const orgContextMetrics = {
      orgChangedQueuedWhileHidden: 0,
      orgChangedIgnoredSameId: 0,
      orgChangedEmitted: 0,
    };
    const SupabaseClient = {};
    const Storage = {
      finalizeLegacyMigration: () => { globalThis.__legacyMigrationFinalizations += 1; },
      getStorageScope: () => globalThis.__storageScope,
      getWorkspaceScope: () => globalThis.__workspaceScope,
    };
    const AccountSwitcher = {
      refresh: () => { globalThis.__accountSwitcherRefreshes += 1; },
    };
    const readLocalOrgId = () => globalThis.__localOrgId;
    const writeLocalOrgId = orgId => { globalThis.__writtenOrgIds.push(orgId); };
    const getWorkspaceStorageScope = orgId => String(orgId || '').trim() || 'no-org';
    const StateStore = {
      get: key => key === 'currentScreen' ? globalThis.__currentScreen : null,
    };
    const applyWorkspaceScopedLocalState = (orgId, options) => {
      globalThis.__workspaceApplies.push({ orgId, options: { ...(options || {}) } });
    };
    const resetWorkspaceScopedUiState = orgId => { globalThis.__workspaceResets.push(orgId); };
    const applyOrgRequiredUi = value => { globalThis.__orgRequiredCalls.push(value); };
    const queueOrgScopedRender = reason => { globalThis.__renderCalls.push(reason); };
    const maybeScheduleBillingRefresh = reason => { globalThis.__billingReasons.push(reason); };
    const applyAccessGateFromBilling = () => { globalThis.__accessGateCalls += 1; };
    const getBillingState = () => ({ ok: false });
    const BillingService = {
      applyAccessGateFromBilling: (...a) => applyAccessGateFromBilling(...a),
      getBillingState: (...a) => getBillingState(...a),
      clearBillingAuthoritativeRefreshRequirement: () => {},
    };
    // Stage 2 CP2: storage mirrors + facade reads moved to OrganizationService.
    const OrganizationService = {
      readLocalOrgId: (...a) => readLocalOrgId(...a),
      writeLocalOrgId: (...a) => writeLocalOrgId(...a),
      getActiveOrgId: () => orgContext.activeOrgId,
      getActiveOrgIdNow: () => orgContext.activeOrgId,
      // Stage 2 CP3: org-changed publication moved to OrganizationService.
      dispatchOrgContextChanged: (...a) => dispatchOrgContextChanged(...a),
      getWorkspaceSwitchState: () => ({ active: globalThis.__workspaceSwitchActive }),
    };
    const getAuthTruthSnapshot = () => ({ status: 'signed_in', isSignedIn: true });
    const isTp3dDebugEnabled = () => false;
    const dispatchOrgContextChanged = () => { };
    const clearOrgContext = ({ confirmedNoOrg = false } = {}) => {
      orgContext = { activeOrgId: null, activeOrg: null, orgs: [], role: null, updatedAt: Date.now() };
      orgContextResolved = Boolean(confirmedNoOrg);
    };
    ${resolverSource}
    ${applySource}
    globalThis.__applyOrgContextFromBundle = applyOrgContextFromBundle;
    globalThis.__orgContextSnapshot = () => ({
      orgContext: JSON.parse(JSON.stringify(orgContext)),
      orgContextResolved,
      accountSwitcherRefreshes: globalThis.__accountSwitcherRefreshes,
    });
  `, context);

  return {
    apply: (bundle, options) => context.__applyOrgContextFromBundle(bundle, options),
    snapshot: () => context.__orgContextSnapshot(),
    calls: context,
  };
}

async function createBillingStatusDirectIdentityRuntime(options = {}) {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const catalogSrc = await fs.readFile(billingCatalogPath, 'utf8');
  const executableSource = `${catalogSrc.replace(/^export\s+/gm, '')}\n${src.replace(/^import[\s\S]*?;\s*$/gm, '')}`;
  let handler = null;

  const ownerUserId = '11111111-1111-4111-8111-111111111111';
  const defaultOrganizations = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', owner_id: ownerUserId, created_at: '2025-01-01T00:00:00.000Z', archived_at: null },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', owner_id: ownerUserId, created_at: '2025-02-01T00:00:00.000Z', archived_at: null },
  ];
  const organizations = (options.organizations || defaultOrganizations).map(row => ({ ...row }));
  const memberships = (options.memberships || organizations.map(row => ({
    organization_id: row.id,
    user_id: ownerUserId,
    role: 'owner',
  }))).map(row => ({ ...row }));
  const subscriptions = (options.subscriptions || []).map(row => ({
    user_id: ownerUserId,
    stripe_customer_id: 'cus_owner',
    created_at: '2025-03-01T00:00:00.000Z',
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    ...row,
  }));
  const billingCustomers = (options.billingCustomers || subscriptions.map(row => ({
    organization_id: row.organization_id,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    status: row.status,
    plan_name: row.status === 'canceled' ? 'free' : 'pro',
    billing_interval: row.interval,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    trial_ends_at: row.trial_end,
    created_at: row.created_at,
  }))).map(row => ({ ...row }));
  const tables = {
    organizations,
    organization_members: memberships,
    subscriptions,
    billing_customers: billingCustomers,
    stripe_customers: [{ user_id: ownerUserId, stripe_customer_id: 'cus_owner' }],
    profiles: (options.profiles || []).map(row => ({ ...row })),
  };
  const calls = { updates: [], upserts: [], logs: [], queries: [], auth: [], stripe: 0 };

  const createQuery = (table) => {
    const filters = [];
    const orders = [];
    let rowLimit = null;
    let selectOptions = null;
    let updatePayload = null;
    let upsertPayload = null;

    const query = {
      select(_columns, opts = null) { selectOptions = opts; return query; },
      eq(column, value) { filters.push(row => String(row?.[column] ?? '') === String(value ?? '')); return query; },
      in(column, values) {
        const allowed = new Set((values || []).map(value => String(value)));
        filters.push(row => allowed.has(String(row?.[column] ?? '')));
        return query;
      },
      order(column, { ascending = true } = {}) { orders.push({ column, ascending }); return query; },
      limit(value) { rowLimit = Number(value); return query; },
      update(payload) { updatePayload = { ...payload }; return query; },
      upsert(payload) { upsertPayload = { ...payload }; return query; },
      async maybeSingle() {
        const result = execute();
        if (result.data.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
        }
        return { data: result.data[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };

    const execute = () => {
      let rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      for (const { column, ascending } of orders) {
        rows = [...rows].sort((a, b) => {
          const left = String(a?.[column] ?? '');
          const right = String(b?.[column] ?? '');
          return (left.localeCompare(right)) * (ascending ? 1 : -1);
        });
      }
      if (Number.isFinite(rowLimit)) rows = rows.slice(0, rowLimit);
      if (updatePayload) {
        rows.forEach(row => Object.assign(row, updatePayload));
        calls.updates.push({ table, rows: rows.map(row => ({ ...row })), payload: updatePayload });
      }
      if (upsertPayload) calls.upserts.push({ table, payload: upsertPayload });
      if (selectOptions?.head && selectOptions?.count === 'exact') {
        return { data: null, count: rows.length, error: null };
      }
      return { data: rows.map(row => ({ ...row })), error: null };
    };
    return query;
  };

  const admin = {
    from(table) {
      calls.queries.push(table);
      return createQuery(table);
    },
  };
  const env = new Map([
    ['URL', 'https://runtime.supabase.co'],
    ['SUPABASE_ANON_KEY', 'anon-key'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'service-key'],
    ['STRIPE_SECRET_KEY', ''],
    ['STRIPE_PRICE_PRO_MONTHLY', 'price_pro_month'],
    ['STRIPE_PRICE_PRO_YEARLY', 'price_pro_year'],
    ['STRIPE_PRICE_BUSINESS_MONTHLY', 'price_business_month'],
    ['STRIPE_PRICE_BUSINESS_YEARLY', 'price_business_year'],
    ['STRIPE_PRICE_PRO_MONTHLY_LEGACY', 'price_pro_legacy_month'],
    ['STRIPE_PRICE_PRO_YEARLY_LEGACY', 'price_pro_legacy_year'],
    ['STRIPE_PRICE_BUSINESS_MONTHLY_LEGACY', 'price_business_legacy_month'],
    ['STRIPE_PRICE_BUSINESS_YEARLY_LEGACY', 'price_business_legacy_year'],
    ['TP3D_PRO_WORKSPACE_LIMIT', '3'],
    ['TP3D_BUSINESS_WORKSPACE_LIMIT', '10'],
    ['TP3D_TRIAL_WORKSPACE_LIMIT', '1'],
    ['TP3D_DEBUG', '1'],
  ]);
  for (const [name, value] of Object.entries(options.env || {})) {
    if (typeof value === 'undefined') env.delete(name);
    else env.set(name, String(value));
  }
  const sandbox = {
    URL, Request, Response, Headers, Date, Map, Set, Promise,
    setTimeout, clearTimeout,
    Deno: {
      env: { get: key => env.get(key) || '' },
      serve(fn) { handler = fn; },
    },
    corsHeaders: () => ({}),
    handleCors: () => null,
    createClient: (_url, key) => key === 'anon-key'
      ? { auth: { getUser: async (jwt) => {
        calls.auth.push(jwt);
        if (jwt === 'invalid-runtime-token') {
          return { data: { user: null }, error: { message: 'invalid token' } };
        }
        return {
          data: { user: { id: options.authenticatedUserId || ownerUserId } },
          error: null,
        };
      } } }
      : admin,
    stripeClient: () => {
      calls.stripe += 1;
      throw new Error('Stripe must not be called by the DB-only runtime fixture');
    },
    console: {
      log: (...args) => calls.logs.push(['log', ...args]),
      warn: (...args) => calls.logs.push(['warn', ...args]),
      error: (...args) => calls.logs.push(['error', ...args]),
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(executableSource, { mode: 'strip' }), sandbox);
  assert.equal(typeof handler, 'function', 'billing-status production handler captured');

  const invoke = async ({ query = '', jwt = 'redacted-runtime-token', includeJwt = true } = {}) => {
    const headers = includeJwt ? { 'x-user-jwt': jwt } : {};
    const req = new Request(
      `https://runtime.test/billing-status?tp3dDebug=1${query ? `&${query}` : ''}`,
      { method: 'GET', headers },
    );
    const response = await handler(req);
    return { status: response.status, body: await response.json() };
  };
  const request = organizationId => invoke({
    query: `organization_id=${encodeURIComponent(organizationId)}`,
  });
  return { request, invoke, calls, organizations, ownerUserId };
}

async function loadRequestedDirectBindingRuntime() {
  const src = await fs.readFile(billingStatusPath, 'utf8');
  const paymentStart = src.indexOf('function paymentGraceActive(');
  const paymentEnd = src.indexOf('function statusPriority(', paymentStart);
  const uuidStart = src.indexOf('const UUID_RE =');
  const uuidEnd = src.indexOf('function normalizeSupabaseUrl(', uuidStart);
  assert.ok(paymentStart >= 0 && paymentEnd > paymentStart, 'direct-binding production helper span found');
  assert.ok(uuidStart >= 0 && uuidEnd > uuidStart, 'organization normalizer span found');
  const executable = `${src.slice(paymentStart, paymentEnd)}\n${src.slice(uuidStart, uuidEnd)}\n` +
    'globalThis.__resolveRequestedDirectBinding = resolveRequestedDirectBinding;';
  const sandbox = { Date, Map, Set };
  vm.runInNewContext(stripTypeScriptTypes(executable, { mode: 'strip' }), sandbox);
  return sandbox.__resolveRequestedDirectBinding;
}

function createStabilizationMemoryStorage() {
  const values = new Map();
  let failingKey = null;
  return {
    values,
    setFailingKey(key) {
      failingKey = key;
    },
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failingKey && key === failingKey) throw new Error('quota');
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
  };
}

async function createLateWorkspaceHydrationRuntime({
  liveScreen = 'editor',
  livePackId = 'pack-a',
  livePacks = [{ id: 'pack-a', title: 'Pack A' }],
  storedPackId = null,
  storedPacks = [{ id: 'pack-a', title: 'Pack A (stored)' }],
  withPriorHistory = false,
} = {}) {
  const src = await fs.readFile(appPath, 'utf8');
  const scopeStart = src.indexOf('function getWorkspaceStorageScope(');
  const scopeEnd = src.indexOf('\n    // ============================================================================\n    // SECTION: BOOT HELPERS (RUNTIME VALIDATION)', scopeStart);
  const uiResetStart = src.indexOf('function resetWorkspaceScopedUiState(');
  const uiResetEnd = src.indexOf('\n    function clearOrgContext(', uiResetStart);
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart,
    'production workspace scoped-state helpers are extractable');
  assert.ok(uiResetStart >= 0 && uiResetEnd > uiResetStart,
    'production workspace UI reset is extractable');

  const StateStore = await import(`${stateStorePath.href}?late-hydration=${Date.now()}-${Math.random()}`);
  StateStore.init({
    currentScreen: liveScreen,
    currentPackId: livePackId,
    selectedInstanceIds: ['instance-a'],
    caseLibrary: [],
    packLibrary: livePacks,
    folderLibrary: [],
    preferences: { theme: 'light' },
  });
  if (withPriorHistory) {
    StateStore.set({ caseLibrary: [{ id: 'prior-history-entry' }] });
  }

  const context = {
    __StateStore: StateStore,
    __stored: {
      currentPackId: storedPackId,
      caseLibrary: [],
      packLibrary: storedPacks,
      folderLibrary: [],
      preferences: { theme: 'light' },
    },
    __workspaceScope: 'org-a',
    __flushes: 0,
  };
  vm.createContext(context);
  vm.runInContext(`
    let suspendAutoSave = false;
    let hasLoadedScopedState = true;
    let lastLoadedWorkspaceStorageKey = 'user-a|startup-pending';
    let lastWorkspaceUiResetKey = '';
    let applyPostLogoutLocalStateReset = () => {};
    const StateStore = globalThis.__StateStore;
    const Storage = {
      getStorageScope: () => 'user-a',
      getWorkspaceScope: () => globalThis.__workspaceScope,
      setWorkspaceScope: scope => { globalThis.__workspaceScope = String(scope); },
      flushPendingSave: () => { globalThis.__flushes += 1; },
      load: () => JSON.parse(JSON.stringify(globalThis.__stored)),
      saveNow: () => {},
    };
    const KeyboardManager = { clearClipboard: () => {} };
    const AutoPackEngine = { bumpWorkspaceGeneration: () => {} };
    const PacksUI = null;
    const SessionManager = { clear: () => {} };
    const PackLibrary = {
      repairRestoredPackPlacements: pack => JSON.parse(JSON.stringify(pack)),
      computeStats: () => ({}),
    };
    const Defaults = {
      defaultPreferences: { theme: 'light' },
      seedCases: () => [],
      seedPack: () => ({ id: 'demo-pack', cases: [] }),
    };
    const Utils = { volumeInCubicInches: () => 0 };
    const applyCaseDefaultColor = value => value;
    const applyCanonicalCargoFields = value => value;
    ${src.slice(scopeStart, scopeEnd)}
    ${src.slice(uiResetStart, uiResetEnd)}
    globalThis.__applyWorkspaceScopedLocalState = applyWorkspaceScopedLocalState;
    globalThis.__resetAppStateToEmpty = resetAppStateToEmpty;
    globalThis.__resetWorkspaceScopedUiState = resetWorkspaceScopedUiState;
  `, context);

  return {
    apply: (orgId, options) => context.__applyWorkspaceScopedLocalState(orgId, options),
    reset: () => context.__resetAppStateToEmpty(),
    resetWorkspaceUi: orgId => context.__resetWorkspaceScopedUiState(orgId),
    snapshot: () => StateStore.snapshot(),
    undo: () => StateStore.undo(),
    counters: context,
  };
}

async function createPhase2OrgOrderingHarness({ initialActiveOrgId = null } = {}) {
  const src = await readAppSource();
  const helperStart = src.indexOf('function parseOrgContextVersion(');
  const helperEnd = src.indexOf('\n  /**\n   * @param {{', helperStart);
  const handleStart = src.indexOf('function handleIncomingOrgContextSync(');
  const handleEnd = src.indexOf('\n    // ── Billing org-ready pump', handleStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && handleStart >= 0 && handleEnd > handleStart,
    'Phase 2 org ordering functions are extractable');

  const context = {
    __dispatches: [],
    __appliedOrgs: [],
    __applyOptions: [],
    __workspaceResets: [],
    __writes: [],
    __initialActiveOrgId: initialActiveOrgId,
    console: { info() { }, warn() { }, error() { } },
  };
  vm.createContext(context);
  vm.runInContext(`
    let orgContextVersion = 0;
    let lastAppliedOrgContextVersion = 0;
    let lastAppliedOrgContextTabId = '';
    let orgContext = { activeOrgId: globalThis.__initialActiveOrgId, activeOrg: null, orgs: [], role: null, updatedAt: 0 };
    let orgContextQueued = false;
    let _orgBundleFetchInflightForOrg = null;
    const orgContextTabId = 'tab-local';
    const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const _ORG_ROLE_GRACE_MS = 1000;
    const _orgRoleHydrationGraceUntilByOrg = new Map();
    const getSignedInUserIdStrict = () => 'user-1';
    const isTp3dDebugEnabled = () => false;
    const beginWorkspaceSwitch = () => {};
    const writeLocalOrgId = orgId => { globalThis.__writes.push(orgId); };
    const applyWorkspaceScopedLocalState = (orgId, options) => {
      globalThis.__appliedOrgs.push(orgId);
      globalThis.__applyOptions.push(options || null);
    };
    const resetWorkspaceScopedUiState = orgId => { globalThis.__workspaceResets.push(orgId); };
    const reconcileBillingStateForActiveOrg = () => {};
    const markWorkspaceSwitchReady = () => {};
    const markWorkspaceSwitchOrgReadyIfResolved = () => {};
    const markWorkspaceSwitchBillingReadyIfSettled = () => {};
    const getBillingState = () => ({});
    const dispatchOrgContextChanged = options => { globalThis.__dispatches.push(options); };
    const applyOrgRequiredUi = () => {};
    const queueOrgScopedRender = () => {};
    const maybeScheduleBillingRefresh = () => {};
    const isLogoutInProgress = () => true;
    const authGateIsSettled = () => true;
    // Stage 3 CP1: handleIncomingOrgContextSync reaches auth truth/gate via AuthService.
    const AuthService = {
      getSignedInUserIdStrict: (...a) => getSignedInUserIdStrict(...a),
      authGateIsSettled: (...a) => authGateIsSettled(...a),
    };
    const refreshOrgContext = () => Promise.resolve();
    const BillingService = {
      getBillingState: (...a) => getBillingState(...a),
      reconcileBillingStateForActiveOrg: (...a) => reconcileBillingStateForActiveOrg(...a),
    };
    // Stage 2 CP1: the workspace-switch state machine moved to OrganizationService.
    // handleIncomingOrgContextSync now reaches switch marks via OrganizationService.*.
    // This test asserts org-context ordering, not switch behavior, so the switch
    // methods stay no-ops (mapped to the existing bare mocks) — invariant unchanged.
    const OrganizationService = {
      beginWorkspaceSwitch: (...a) => beginWorkspaceSwitch(...a),
      markWorkspaceSwitchReady: (...a) => markWorkspaceSwitchReady(...a),
      markWorkspaceSwitchOrgReadyIfResolved: (...a) => markWorkspaceSwitchOrgReadyIfResolved(...a),
      markWorkspaceSwitchBillingReadyIfSettled: (...a) => markWorkspaceSwitchBillingReadyIfSettled(...a),
      // Stage 2 CP2: storage mirrors + facade reads also moved to OrganizationService.
      writeLocalOrgId: (...a) => writeLocalOrgId(...a),
      readLocalOrgId: () => null,
      getActiveOrgId: () => orgContext.activeOrgId,
      getActiveOrgIdNow: () => orgContext.activeOrgId,
      // Stage 2 CP3: version ordering + org-changed publication moved to OrganizationService.
      // handleIncomingOrgContextSync reaches them here; version helpers map to the eval'd
      // slice below (hoisted), dispatch maps to the local recording mock.
      markOrgContextVersion: (...a) => markOrgContextVersion(...a),
      compareOrgContextOrder: (...a) => compareOrgContextOrder(...a),
      getOrgContextEffectiveVersion: (...a) => getOrgContextEffectiveVersion(...a),
      dispatchOrgContextChanged: (...a) => dispatchOrgContextChanged(...a),
    };
    ${src.slice(helperStart, helperEnd)}
    ${src.slice(handleStart, handleEnd)}
    globalThis.__handle = handleIncomingOrgContextSync;
    globalThis.__effective = getOrgContextEffectiveVersion;
    globalThis.__compare = compareOrgContextOrder;
    globalThis.__next = nextOrgContextVersion;
    globalThis.__setOrder = (version, tabId) => {
      orgContextVersion = Number(version) || 0;
      lastAppliedOrgContextVersion = Number(version) || 0;
      lastAppliedOrgContextTabId = String(tabId || '');
    };
    globalThis.__snapshot = () => ({
      orgContextVersion,
      lastAppliedOrgContextVersion,
      lastAppliedOrgContextTabId,
      activeOrgId: orgContext.activeOrgId,
    });
  `, context);

  return {
    handle: payload => context.__handle(payload, { source: 'phase2-test' }),
    effective: payload => context.__effective(payload),
    next: () => context.__next(),
    setOrder: (version, tabId) => context.__setOrder(version, tabId),
    snapshot: () => context.__snapshot(),
    calls: context,
  };
}

async function createPhase2BillingLockHarness() {
  const src = await readAppSource();
  const keyStart = src.indexOf('function _billingLockKey(');
  const keyEnd = src.indexOf('/**\n * Try to acquire a cross-tab billing lock', keyStart);
  const readStart = src.indexOf('function _readStorageJson(', keyEnd);
  const acquireStart = src.indexOf('function _tryAcquireBillingLock(', readStart);
  const releaseStart = src.indexOf('function _releaseBillingLock(', acquireStart);
  assert.ok(keyStart >= 0 && keyEnd > keyStart && readStart >= 0 && acquireStart > readStart && releaseStart > acquireStart,
    'Phase 2 billing lock helpers are extractable');

  const localStorage = createStabilizationMemoryStorage();
  const context = { window: { localStorage }, __now: 100000 };
  vm.createContext(context);
  vm.runInContext(`
    const _BILLING_LOCK_TTL_MS = 20000;
    const _BILLING_LOCK_RETRY_MIN_MS = 1200;
    const _BILLING_LOCK_RETRY_GRACE_MS = 100;
    const _billingTabId = 'tab-current';
    const billingDebugLog = () => {};
    const Date = { now: () => globalThis.__now };
    ${src.slice(keyStart, keyEnd)}
    ${src.slice(readStart, acquireStart)}
    ${src.slice(acquireStart, releaseStart)}
    globalThis.__delay = _getBillingLockRetryDelay;
    globalThis.__acquire = _tryAcquireBillingLock;
    globalThis.__key = _billingLockKey;
    globalThis.__legacyKey = _billingLegacyLockKey;
  `, context);

  return {
    localStorage,
    setNow: now => { context.__now = now; },
    delay: orgId => context.__delay(orgId, context.__now),
    acquire: orgId => context.__acquire(orgId, 'phase2-test'),
    key: orgId => context.__key(orgId),
    legacyKey: orgId => context.__legacyKey(orgId),
  };
}

async function createPhase4InviteHarness({ response = null, throwMessage = '' } = {}) {
  const src = await readAppSource();
  const constantsStart = src.indexOf('const inviteHandoffSigninMessage');
  const constantsEnd = src.indexOf('let inviteHandoffNotice = null;', constantsStart);
  const mapStart = src.indexOf('function mapInviteAcceptFailureMessage(', constantsEnd);
  const terminalStart = src.indexOf('function isTerminalInviteAcceptFailure(', mapStart);
  const clearTokenStart = src.indexOf('function clearPendingInviteToken(', terminalStart);
  const clearNoticeStart = src.indexOf('function clearInviteHandoffNotice(', clearTokenStart);
  const tryStart = src.indexOf('async function tryAcceptPendingInvite(', clearNoticeStart);
  const tryEnd = src.indexOf('\n\n      if (!authListenerInstalled)', tryStart);
  assert.ok(
    constantsStart >= 0 && constantsEnd > constantsStart &&
    mapStart > constantsEnd && terminalStart > mapStart &&
    clearTokenStart > terminalStart && clearNoticeStart > clearTokenStart &&
    tryStart > clearNoticeStart && tryEnd > tryStart,
    'Phase 4 invite helpers are extractable',
  );

  const sessionStorage = createStabilizationMemoryStorage();
  sessionStorage.setItem('tp3d:pending_invite_token', 'phase4-secret-token');
  const context = {
    window: { sessionStorage },
    __response: response,
    __throwMessage: throwMessage,
    __toasts: [],
    __tokenAtRefresh: undefined,
  };
  vm.createContext(context);
  vm.runInContext(`
    let pendingInviteToken = 'phase4-secret-token';
    let inviteAcceptInFlight = false;
    const inviteTokenStorageKey = 'tp3d:pending_invite_token';
    ${src.slice(constantsStart, constantsEnd)}
    ${src.slice(mapStart, terminalStart)}
    ${src.slice(terminalStart, clearTokenStart)}
    ${src.slice(clearTokenStart, clearNoticeStart)}
    const SupabaseClient = { getSession: () => ({ access_token: 'session-access-token' }) };
    const UIComponents = {
      showToast(message) { globalThis.__toasts.push(String(message)); },
    };
    const acceptOrgInvite = async () => {
      if (globalThis.__throwMessage) throw new Error(globalThis.__throwMessage);
      return globalThis.__response;
    };
    const clearInviteHandoffNotice = () => {};
    const setInviteHandoffNotice = () => {};
    const scheduleInviteHandoffNoticeRender = () => {};
    const refreshOrgContext = async () => {
      globalThis.__tokenAtRefresh = pendingInviteToken;
    };
    const setActiveOrgId = async () => {};
    const requestAuthRefresh = () => {};
    const SettingsOverlay = { open() {} };
    ${src.slice(tryStart, tryEnd)}
    globalThis.__run = tryAcceptPendingInvite;
    globalThis.__getToken = () => pendingInviteToken;
  `, context);
  return { context, sessionStorage };
}

async function createPhase4LogoutHarness(mode = 'resolve') {
  const src = await readAppSource();
  const finalizerStart = src.indexOf('function finalizeSignedOutLocally(');
  const finalizerEnd = src.indexOf('\n\n    async function performUserInitiatedLogout(', finalizerStart);
  const performStart = src.indexOf('async function performUserInitiatedLogout(', finalizerEnd);
  const performEnd = src.indexOf('\n\n    // Listen for auth signed-out events', performStart);
  assert.ok(finalizerStart >= 0 && finalizerEnd > finalizerStart && performStart > finalizerEnd && performEnd > performStart,
    'Phase 4 logout functions are extractable');

  const context = { __mode: mode, __calls: null };
  vm.createContext(context);
  vm.runInContext(`
    let logoutActionPromise = null;
    let logoutInProgress = false;
    let logoutStartedAt = 0;
    let signedOutFinalized = false;
    let signedOutFinalizationInFlight = false;
    const calls = {
      resets: 0,
      cleanupAttempts: 0,
      cleanups: [],
      signOuts: 0,
      signOutOptions: null,
      authIntents: [],
    };
    const bootstrapAuthGate = () => {};
    const applyPostLogoutLocalStateReset = () => { calls.resets += 1; };
    const isLogoutInProgress = () => logoutInProgress;
    const setLogoutInProgress = next => {
      logoutInProgress = Boolean(next);
      logoutStartedAt = logoutInProgress ? Date.now() : 0;
    };
    const _executeSignedOutCleanup = options => {
      calls.cleanupAttempts += 1;
      if (globalThis.__cleanupFailuresRemaining > 0) {
        globalThis.__cleanupFailuresRemaining -= 1;
        throw new Error('cleanup failed');
      }
      calls.cleanups.push(options);
    };
    const UIComponents = { closeAllDropdowns() {} };
    const SettingsOverlay = { close() {} };
    const AccountOverlay = { close() {} };
    const isTp3dDebugEnabled = () => false;
    const SupabaseClient = {
      setAuthIntent(intent) { calls.authIntents.push(intent); },
      async signOut(options) {
        calls.signOuts += 1;
        calls.signOutOptions = options;
        if (globalThis.__mode === 'event') {
          finalizeSignedOutLocally({
            source: 'tp3d:auth-signed-out',
            userInitiatedSignOut: isLogoutInProgress(),
          });
        }
        if (globalThis.__mode === 'throw') throw new Error('offline sign-out failure');
        return { ok: true, offline: false };
      },
    };
    ${src.slice(finalizerStart, finalizerEnd)}
    ${src.slice(performStart, performEnd)}
    globalThis.__run = performUserInitiatedLogout;
    globalThis.__finalize = finalizeSignedOutLocally;
    globalThis.__calls = calls;
  `, context);
  return context;
}

function handlingRulesP0dMemoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
  };
}

const RIGHT_ANGLE = Math.PI / 2;

const RIGHT_ANGLES = [0, RIGHT_ANGLE, Math.PI, 3 * RIGHT_ANGLE];

function threeOracleHeightAxisVertical(THREE, x, y, z) {
  const v = new THREE.Vector3(0, 1, 0);
  v.applyEuler(new THREE.Euler(x, y, z, 'XYZ'));
  const EPS = 1e-6;
  return Math.abs(v.x) <= EPS && Math.abs(v.z) <= EPS;
}

function handlingRulesP0cCase(overrides = {}) {
  const dimensions = overrides.dimensions || { length: 10, width: 10, height: 10 };
  return {
    id: overrides.id || 'case-p0c',
    name: 'P0C Case',
    manufacturer: 'QA',
    category: 'Default',
    color: '#9ca3af',
    dimensions,
    weight: overrides.weight === undefined ? 10 : overrides.weight,
    volume: dimensions.length * dimensions.width * dimensions.height,
    shape: 'box',
    orientationLock: 'any',
    stackable: true,
    ...overrides,
  };
}

function handlingRulesP0cInstance(id, caseId, rotation) {
  return {
    id, caseId, placement: 'packed', hidden: false, groupId: null,
    transform: { position: { x: 60, y: 5, z: 0 }, rotation, scale: { x: 1, y: 1, z: 1 } },
  };
}

export {
  CARGO_BAD_ROW,
  CARGO_HEADER,
  HANDLING_FIELDS,
  PHB_DIMS,
  R1_HALF,
  RECON_CASE_LIB,
  RECON_DIMS,
  RECON_RECT,
  RECON_WW,
  RIGHT_ANGLE,
  RIGHT_ANGLES,
  RULED_CASE,
  STRESS_COUNT_THRESHOLD,
  STRESS_ENABLED,
  WW_SUPPORT_TRUCK,
  __XLSX,
  accountOverlayPath,
  accountPurgeStatusMigrationPath,
  accountSwitcherPath,
  appPath,
  assert,
  assertCanonicalReconLayoutSafe,
  assertHostileCanonical,
  assertLargeReconStagingSafe,
  assertNoFloatFrames,
  assertPackImportNoOverlaps,
  assertReconLayoutSafe,
  assertStackSafeOutput,
  authOverlayPath,
  authServicePath,
  autoPackEnginePath,
  autoPackItemBuilderPath,
  autoPackSolverPath,
  banUserPath,
  beamCsvFixturePath,
  beamXlsxFixturePath,
  billingCatalogPath,
  billingServicePath,
  billingServiceUrl,
  billingStatusPath,
  browserPath,
  buildLargeReconStagingRows,
  cancelAccountDeletionPath,
  cardDisplayOverlayPath,
  cargoCanonicalPath,
  caseLibraryPath,
  caseModalPath,
  casesScreenPath,
  categoryServicePath,
  coreUtilsIndexPath,
  coreUtilsPath,
  corsSharedPath,
  createBillingPumpRuntimeHarness,
  createBillingStatusDirectIdentityRuntime,
  createHash,
  createLateWorkspaceHydrationRuntime,
  createModalOwnership,
  createOrgContextApplyRuntimeHarness,
  createPackPreviewSchedulerHarness,
  createPhase2BillingLockHarness,
  createPhase2OrgOrderingHarness,
  createPhase4InviteHarness,
  createPhase4LogoutHarness,
  createStabilizationMemoryStorage,
  createWorkspaceMigrationPath,
  debuggerPath,
  deleteAccountPath,
  e1AssertSafe,
  e1Items,
  e1LayerFollowFraction,
  e1Placed,
  e2aFlips,
  e2aYawCounts,
  e2bChannelStackLayers,
  editorScreenPath,
  enforceWorkspaceLimitMigrationPath,
  enforceWorkspaceSlugIntegrityMigrationPath,
  execFile,
  execFileAsync,
  executeOrgMemberRoleUpdate,
  findRowWarning,
  folderLibraryPath,
  fs,
  fsSync,
  getPackImportAabb,
  getPackImportDims,
  guardProfileDeletionFieldsMigrationPath,
  handlingRulesP0cCase,
  handlingRulesP0cInstance,
  handlingRulesP0dMemoryStorage,
  helpModalPath,
  hostileRawCase,
  importAppDialogPath,
  importCasesDialogPath,
  importExportPath,
  importPackDialogPath,
  indexHtmlPath,
  installWindowXLSX,
  keyboardManagerPath,
  loadRequestedDirectBindingRuntime,
  loadVendorXLSX,
  makeCsvFile,
  makeMultiCasePayload,
  makePackImportInstance,
  makePackImportPayload,
  makePackImportSafeCase,
  makeTruckChangeHarness,
  makeXlsxFile,
  maxAAssertPhysicalSafety,
  maxAPlaced,
  maxAResultBytes,
  normalizerPath,
  notesOverlayPath,
  operationLifecyclePath,
  orgArchiveMigrationPath,
  orgArchiveWorkspacePath,
  orgCreateWorkspacePath,
  orgInviteAcceptPath,
  orgInviteExpirationMigrationPath,
  orgInvitePath,
  orgInviteRevokePath,
  orgLeaveWorkspacePath,
  orgMemberAdminDeleteGuardMigrationPath,
  orgMemberRemovePath,
  orgMemberRoleUpdatePath,
  orgRestoreWorkspacePath,
  orgTransferOwnershipPath,
  organizationServicePath,
  orientedDimsPath,
  p5Modules,
  p8Item,
  p8PackedEntry,
  p8WheelWellTruck,
  packImportAabbsOverlap,
  packImportStateSnapshot,
  packLibraryPath,
  packingCorePath,
  packingCoreValidationPath,
  packsScreenPath,
  phb2AnimationRecord,
  phb2AssertAnimationBatches,
  phb2AssertDirectStackLimit,
  phb2AssertSafe,
  phb2FloorCount,
  phb2FloorHole,
  phb2SequentialForwardViolation,
  phbOverlapXZ,
  phbPlaced,
  phbSolverModules,
  phc2Aabb,
  phc2Instance,
  phcFloorTable,
  phcFrontOverhangTruck,
  phcResultBytes,
  phdAlternatingItems,
  phdRowFragmentCount,
  phdSpatialRows,
  phdSplitRunCount,
  previewHarnessViewSignature,
  previewHarnessVisualSignature,
  promisify,
  purgeDeletedAccountsPath,
  purgeDeletedUsersPath,
  r1Truth,
  r1bAssertAtomicFloor,
  r1bComposeStaged,
  r1bImportBeam,
  r1bLegacyItem,
  r1bModules,
  r1cSolverItem,
  r1dRound,
  r1eCartonItems,
  r1eLexLess,
  r1eOverlapXZ,
  r1ePlaced,
  r1eStackCandidate,
  readAppSource,
  readFunctionSources,
  reconAabb,
  reconFB,
  reconInst,
  recoverableErrorOverlayPath,
  requestAccountDeletionPath,
  restoreWorkspaceMigrationPath,
  restrictMembershipMutationMigrationPath,
  runEnginePack,
  sceneRuntimePath,
  settingsOverlayPath,
  signupAutoOrgUuidMigrationPath,
  stateStorePath,
  storagePath,
  stressCounts,
  stressTest,
  stripTypeScriptTypes,
  stripeCheckoutPath,
  stripePortalPath,
  stylesMainPath,
  supabaseConfigPath,
  supabaseFunctionsDir,
  supabasePath,
  test,
  testAabbInsidePhysicalTrailer,
  testAabbInsideTruckBox,
  testAabbOnPhysicalFloor,
  threeOracleHeightAxisVertical,
  threeOrientedTruth,
  trailerGeometryPath,
  transferOwnershipLiveFixMigrationPath,
  transferOwnershipMigrationPath,
  truckChangeControllerPath,
  unbanUserPath,
  vendorThreePath,
  vm,
  wwAabb,
  wwAssertHardSafe,
  wwAvoidableForwardFloorMove,
  wwFloorForwardSlack,
  wwFloorSideSlack,
  wwNonFloorFrontSlack,
  wwOnZoneFloor,
  wwResultPlacements,
  wwStagedRaisedOverhangOpportunity,
};
