/**
 * @file storage.js
 * @description Persistence adapter for saving and loading app state.
 * @module core/storage
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { APP_VERSION } from './version.js';
import * as Utils from './utils/index.js';
import { debounce } from './browser.js';
import * as StateStore from './state-store.js';
import {
  normalizeAppData,
  sanitizeLegacyPackQuantityLibrary,
} from './normalizer.js';
import {
  migrateLoadPlanNumbers,
  normalizeBusinessIdentityLibraries,
} from './business-identity.js';
import { emit } from './events.js';
import {
  IMPORT_KIND,
  isPlainRecord,
  isCargoPlannerEnvelope,
  parseCargoPlannerEnvelope,
  validateWorkspaceGraph,
} from './import-schema.js';

export const STORAGE_KEY = 'truckPacker3d:v1';
export const IMPORT_SCOPE_CHANGED_MESSAGE =
  'Import stopped because the signed-in user or active workspace changed. Select the file again.';
export const APP_RESTORE_RECOVERY_REQUIRED = 'APP_RESTORE_RECOVERY_REQUIRED';

const APP_RESTORE_RECOVERY_VERSION = 1;
const APP_RESTORE_RECOVERY_SUFFIX = ':app-restore-recovery';

// Storage is scoped first by user, then by active workspace. Preferences stay
// user-scoped while packs/cases/currentPackId live under the active workspace.
let STORAGE_SCOPE = 'anon';
let WORKSPACE_SCOPE = 'no-org';
let SCOPE_GENERATION = 0;
let pendingLegacyMigration = null;

/** Set the current storage scope (typically the signed-in user id). */
export function setStorageScope(scope) {
  const nextScope = String(scope || 'anon').trim() || 'anon';
  if (nextScope !== STORAGE_SCOPE) {
    pendingLegacyMigration = null;
    SCOPE_GENERATION += 1;
  }
  STORAGE_SCOPE = nextScope;
}

/** Return the current scope value (for diagnostics). */
export function getStorageScope() {
  return STORAGE_SCOPE;
}

/** Set the current workspace scope (typically the active org id). */
export function setWorkspaceScope(scope) {
  const nextScope = String(scope || 'no-org').trim() || 'no-org';
  if (nextScope !== WORKSPACE_SCOPE) {
    pendingLegacyMigration = null;
    SCOPE_GENERATION += 1;
  }
  WORKSPACE_SCOPE = nextScope;
}

/** Return the current workspace scope value. */
export function getWorkspaceScope() {
  return WORKSPACE_SCOPE;
}

/** Capture the user/workspace identity that owns an import operation. */
export function captureScopeContext() {
  return Object.freeze({
    storageScope: STORAGE_SCOPE,
    workspaceScope: WORKSPACE_SCOPE,
    generation: SCOPE_GENERATION,
  });
}

/** Return whether a captured import identity is still the active identity. */
export function isScopeContextCurrent(context) {
  return Boolean(
    context &&
      context.storageScope === STORAGE_SCOPE &&
      context.workspaceScope === WORKSPACE_SCOPE &&
      context.generation === SCOPE_GENERATION
  );
}

/** Fail closed when an asynchronous import outlives its user/workspace. */
export function assertScopeContextCurrent(context) {
  if (isScopeContextCurrent(context)) return;
  const error = Object.assign(new Error(IMPORT_SCOPE_CHANGED_MESSAGE), {
    code: 'IMPORT_SCOPE_CHANGED',
  });
  throw error;
}

/** Build the localStorage key for the active user scope. */
function getScopedKey() {
  return STORAGE_SCOPE === 'anon' ? STORAGE_KEY : `${STORAGE_KEY}:${STORAGE_SCOPE}`;
}

/** Build the localStorage key for the active workspace scope. */
function getWorkspaceScopedKey() {
  return `${getScopedKey()}:workspace:${WORKSPACE_SCOPE}`;
}

function getAppRestoreRecoveryKey(workspaceKey) {
  return `${workspaceKey}${APP_RESTORE_RECOVERY_SUFFIX}`;
}

function fingerprintRaw(raw) {
  const value = raw == null ? '<null>' : String(raw);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

function canonicalJSONStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJSONStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJSONStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Recovery identity deliberately excludes only the top-level save timestamp.
 * Object keys are canonicalized, while all meaningful values and array order
 * remain part of the fingerprint.
 */
function fingerprintPersistedPayload(raw) {
  if (raw == null) return `raw:${fingerprintRaw(raw)}`;
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(String(raw), null));
  if (!isPlainRecord(parsed)) return `raw:${fingerprintRaw(raw)}`;
  const meaningfulPayload = {};
  Object.keys(parsed).forEach(key => {
    if (key !== 'savedAt') meaningfulPayload[key] = parsed[key];
  });
  return `payload:${fingerprintRaw(canonicalJSONStringify(meaningfulPayload))}`;
}

function createAppRestoreRecoveryError(cause, {
  scopedKey = null,
  workspaceKey = null,
  recoveryKey = null,
  recoverable = true,
} = {}) {
  if (cause && cause.code === APP_RESTORE_RECOVERY_REQUIRED) return cause;
  const detail = cause && cause.message ? ` ${cause.message}` : '';
  return Object.assign(
    new Error(`App restore recovery requires attention before this workspace can be loaded.${detail}`),
    {
      code: APP_RESTORE_RECOVERY_REQUIRED,
      cause,
      recoverable: Boolean(recoverable),
      scopedKey,
      workspaceKey,
      recoveryKey,
    }
  );
}

function getAppRestoreSaveBlock(scopedKey, workspaceKey) {
  const recoveryKey = getAppRestoreRecoveryKey(workspaceKey);
  const recoveryRaw = window.localStorage.getItem(recoveryKey);
  if (recoveryRaw == null) return null;
  return createAppRestoreRecoveryError(
    new Error('Normal autosave is suspended while an App restore recovery record is unresolved.'),
    { scopedKey, workspaceKey, recoveryKey, recoverable: true }
  );
}

function restoreRawValue(key, raw) {
  if (raw == null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, raw);
  if (window.localStorage.getItem(key) !== raw) {
    throw new Error(`Recovery verification failed for ${key}`);
  }
}

function isRestoreRecoveryRecord(record, scopedKey, workspaceKey) {
  return Boolean(
    record &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      record.version === APP_RESTORE_RECOVERY_VERSION &&
      typeof record.transactionId === 'string' &&
      record.scopedKey === scopedKey &&
      record.workspaceKey === workspaceKey &&
      (record.priorUserRaw == null || typeof record.priorUserRaw === 'string') &&
      (record.priorWorkspaceRaw == null || typeof record.priorWorkspaceRaw === 'string') &&
      typeof record.candidateUserFingerprint === 'string' &&
      typeof record.candidateWorkspaceFingerprint === 'string'
  );
}

function rollbackRestoreRecord(record, recoveryKey, recoveryRaw) {
  try {
    if (window.localStorage.getItem(recoveryKey) !== recoveryRaw) {
      throw new Error('App restore recovery record changed');
    }
    const currentUserRaw = window.localStorage.getItem(record.scopedKey);
    const currentWorkspaceRaw = window.localStorage.getItem(record.workspaceKey);
    const userIsKnown =
      currentUserRaw === record.priorUserRaw ||
      fingerprintPersistedPayload(currentUserRaw) === record.candidateUserFingerprint;
    const workspaceIsKnown =
      currentWorkspaceRaw === record.priorWorkspaceRaw ||
      fingerprintPersistedPayload(currentWorkspaceRaw) === record.candidateWorkspaceFingerprint;
    if (!userIsKnown || !workspaceIsKnown) {
      throw new Error('App restore destination changed during recovery');
    }

    restoreRawValue(record.scopedKey, record.priorUserRaw);
    restoreRawValue(record.workspaceKey, record.priorWorkspaceRaw);
    window.localStorage.removeItem(recoveryKey);
    if (window.localStorage.getItem(recoveryKey) !== null) {
      throw new Error('App restore recovery cleanup failed');
    }
    return { ok: true, rolledBack: true, recoverable: false };
  } catch (error) {
    const recoverable = window.localStorage.getItem(recoveryKey) === recoveryRaw;
    return {
      ok: false,
      rolledBack: false,
      recoverable,
      error: createAppRestoreRecoveryError(error, {
        scopedKey: record.scopedKey,
        workspaceKey: record.workspaceKey,
        recoveryKey,
        recoverable,
      }),
    };
  }
}

function recoverInterruptedAppRestore(scopedKey, workspaceKey) {
  const recoveryKey = getAppRestoreRecoveryKey(workspaceKey);
  const recoveryRaw = window.localStorage.getItem(recoveryKey);
  if (!recoveryRaw) return { ok: true, recovered: false };

  const record = Utils.sanitizeJSON(Utils.safeJsonParse(recoveryRaw, null));
  if (!isRestoreRecoveryRecord(record, scopedKey, workspaceKey)) {
    return {
      ok: false,
      error: createAppRestoreRecoveryError(
        new Error('Invalid App restore recovery record'),
        { scopedKey, workspaceKey, recoveryKey, recoverable: true }
      ),
    };
  }

  const candidateIsDurable =
    fingerprintPersistedPayload(window.localStorage.getItem(scopedKey)) === record.candidateUserFingerprint &&
    fingerprintPersistedPayload(window.localStorage.getItem(workspaceKey)) === record.candidateWorkspaceFingerprint;
  if (candidateIsDurable) {
    try {
      window.localStorage.removeItem(recoveryKey);
      if (window.localStorage.getItem(recoveryKey) !== null) {
        throw new Error('App restore recovery cleanup failed');
      }
      return { ok: true, recovered: true, finalized: true };
    } catch (error) {
      return {
        ok: false,
        error: createAppRestoreRecoveryError(error, {
          scopedKey,
          workspaceKey,
          recoveryKey,
          recoverable: window.localStorage.getItem(recoveryKey) === recoveryRaw,
        }),
      };
    }
  }

  return rollbackRestoreRecord(record, recoveryKey, recoveryRaw);
}

function readUserScopedRaw(scopedKey) {
  let raw = window.localStorage.getItem(scopedKey);
  let sourceKey = raw ? scopedKey : null;

  // Legacy fallback stays non-destructive until a full account bundle confirms
  // which workspace owns the combined payload.
  if (!raw && scopedKey !== STORAGE_KEY) {
    try {
      const legacyRaw = window.localStorage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        raw = legacyRaw;
        sourceKey = STORAGE_KEY;
      }
    } catch (_migrationErr) {
      // migration is best-effort; fall through to normal null return
    }
  }

  return { raw, sourceKey };
}

function parseStoredPayload(raw, key) {
  if (!raw) return null;
  const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, null));
  if (!parsed || typeof parsed !== 'object') {
    emit('storage:load_error', { key, message: 'Invalid stored data' });
    return null;
  }
  return parsed;
}

const saveDebounced = debounce(saveNow, 250);

function hasWorkspaceData(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      Array.isArray(payload.caseLibrary) &&
      Array.isArray(payload.packLibrary)
  );
}

function combinedLegacyPayloadAt(key) {
  if (!key) return null;
  const payload = parseStoredPayload(window.localStorage.getItem(key), key);
  return hasWorkspaceData(payload) ? payload : null;
}

export function readJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(raw, fallback));
    return parsed == null ? fallback : parsed;
  } catch (err) {
    emit('storage:read_error', {
      key,
      message: err && err.message ? err.message : 'Read failed',
      error: err,
    });
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    emit('storage:write_error', {
      key,
      message: err && err.message ? err.message : 'Write failed',
      error: err,
    });
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    emit('storage:remove_error', {
      key,
      message: err && err.message ? err.message : 'Remove failed',
      error: err,
    });
  }
}

export function load() {
  const scopedKey = getScopedKey();
  const workspaceKey = getWorkspaceScopedKey();
  pendingLegacyMigration = null;
  try {
    const interruptedRestore = recoverInterruptedAppRestore(scopedKey, workspaceKey);
    if (!interruptedRestore.ok) throw interruptedRestore.error;

    const userRead = readUserScopedRaw(scopedKey);
    const userPayload = parseStoredPayload(userRead.raw, userRead.sourceKey || scopedKey);

    const workspaceRaw = window.localStorage.getItem(workspaceKey);
    const workspacePayload = parseStoredPayload(workspaceRaw, workspaceKey);
    const workspaceDataAvailable = hasWorkspaceData(workspacePayload);
    let legacyWorkspacePayload = hasWorkspaceData(userPayload) ? userPayload : null;
    let legacySourceKey = legacyWorkspacePayload ? (userRead.sourceKey || scopedKey) : null;
    let legacySourceRaw = legacyWorkspacePayload ? userRead.raw : null;
    if (!legacyWorkspacePayload && scopedKey !== STORAGE_KEY) {
      const baseRaw = window.localStorage.getItem(STORAGE_KEY);
      const basePayload = parseStoredPayload(baseRaw, STORAGE_KEY);
      if (hasWorkspaceData(basePayload)) {
        legacyWorkspacePayload = basePayload;
        legacySourceKey = STORAGE_KEY;
        legacySourceRaw = baseRaw;
      }
    }
    const effectiveWorkspacePayload = workspaceDataAvailable ? workspacePayload : legacyWorkspacePayload;
    const hasEffectiveWorkspaceData = hasWorkspaceData(effectiveWorkspacePayload);
    const quantitySanitization = hasEffectiveWorkspaceData
      ? sanitizeLegacyPackQuantityLibrary(effectiveWorkspacePayload.packLibrary)
      : { packLibrary: [], changed: false };
    const identityMigration = hasEffectiveWorkspaceData
      ? migrateLoadPlanNumbers(quantitySanitization.packLibrary)
      : { packLibrary: [], changed: false };
    const identityLibraries = hasEffectiveWorkspaceData
      ? normalizeBusinessIdentityLibraries(
          effectiveWorkspacePayload.caseLibrary,
          identityMigration.packLibrary
        )
      : { caseLibrary: null, packLibrary: null };

    // Persist only the additive Load Plan Number migration and removal of the
    // rejected legacy quantity-target field at the workspace storage boundary.
    // Keep version/savedAt and every other field byte-for-byte equivalent after
    // JSON serialization. Legacy combined data remains under its existing
    // guarded finalization flow below.
    if (workspaceDataAvailable && (identityMigration.changed || quantitySanitization.changed)) {
      try {
        window.localStorage.setItem(
          workspaceKey,
          JSON.stringify({
            ...workspacePayload,
            packLibrary: identityMigration.packLibrary,
          })
        );
      } catch (migrationErr) {
        emit('storage:write_error', {
          key: workspaceKey,
          message: migrationErr && migrationErr.message ? migrationErr.message : 'Storage compatibility migration write failed',
          error: migrationErr,
        });
      }
    }

    pendingLegacyMigration = legacyWorkspacePayload
      ? {
          sourceKey: legacySourceKey,
          sourceRaw: legacySourceRaw,
          scopedKey,
          workspaceKey,
          storageScope: STORAGE_SCOPE,
          workspaceScope: WORKSPACE_SCOPE,
          conflict: workspaceDataAvailable,
        }
      : null;
    const preferences =
      userPayload && userPayload.preferences && typeof userPayload.preferences === 'object'
        ? userPayload.preferences
        : legacyWorkspacePayload && legacyWorkspacePayload.preferences && typeof legacyWorkspacePayload.preferences === 'object'
          ? legacyWorkspacePayload.preferences
        : null;

    if (!preferences && !hasEffectiveWorkspaceData) return null;

    return {
      version:
        (effectiveWorkspacePayload && effectiveWorkspacePayload.version) ||
        (userPayload && userPayload.version) ||
        APP_VERSION,
      savedAt:
        (effectiveWorkspacePayload && effectiveWorkspacePayload.savedAt) ||
        (userPayload && userPayload.savedAt) ||
        0,
      preferences,
      caseLibrary: identityLibraries.caseLibrary,
      packLibrary: identityLibraries.packLibrary,
      folderLibrary:
        hasEffectiveWorkspaceData && Array.isArray(effectiveWorkspacePayload.folderLibrary)
          ? effectiveWorkspacePayload.folderLibrary
          : [],
      currentPackId: hasEffectiveWorkspaceData ? effectiveWorkspacePayload.currentPackId || null : null,
    };
  } catch (err) {
    emit('storage:load_error', {
      key: scopedKey,
      message: err && err.message ? err.message : 'Load failed',
      error: err,
    });
    if (err && err.code === APP_RESTORE_RECOVERY_REQUIRED) throw err;
    return null;
  }
}

export function saveSoon() {
  const scopedKey = getScopedKey();
  const workspaceKey = getWorkspaceScopedKey();
  try {
    const blocked = getAppRestoreSaveBlock(scopedKey, workspaceKey);
    if (blocked) {
      emit('storage:save_error', {
        key: workspaceKey,
        message: blocked.message,
        error: blocked,
        blocked: true,
      });
      return false;
    }
  } catch (error) {
    emit('storage:save_error', {
      key: workspaceKey,
      message: error && error.message ? error.message : 'Autosave safety check failed',
      error,
      blocked: true,
    });
    return false;
  }
  saveDebounced();
  return true;
}

export function flushPendingSave() {
  return typeof saveDebounced.flush === 'function' ? saveDebounced.flush() : undefined;
}

export function cancelPendingSave() {
  if (typeof saveDebounced.cancel === 'function') saveDebounced.cancel();
}

export function finalizeLegacyMigration() {
  const pending = pendingLegacyMigration;
  if (!pending) return { ok: false, skipped: true, reason: 'none' };
  if (
    pending.storageScope !== STORAGE_SCOPE ||
    pending.workspaceScope !== WORKSPACE_SCOPE ||
    STORAGE_SCOPE === 'anon' ||
    WORKSPACE_SCOPE === 'no-org'
  ) {
    return { ok: false, skipped: true, reason: 'scope' };
  }
  if (
    !pending.sourceKey ||
    window.localStorage.getItem(pending.sourceKey) !== pending.sourceRaw
  ) {
    return { ok: false, skipped: true, reason: 'source-changed' };
  }
  if (pending.conflict || hasWorkspaceData(combinedLegacyPayloadAt(pending.workspaceKey))) {
    return { ok: false, skipped: true, reason: 'workspace-exists' };
  }

  const state = StateStore.get();
  const savedAt = Date.now();
  const sanitizedPacks = sanitizeLegacyPackQuantityLibrary(state.packLibrary).packLibrary;
  const workspacePayload = {
    version: APP_VERSION,
    savedAt,
    caseLibrary: state.caseLibrary,
    packLibrary: sanitizedPacks,
    folderLibrary: Array.isArray(state.folderLibrary) ? state.folderLibrary : [],
    currentPackId: state.currentPackId,
  };
  const userPayload = {
    version: APP_VERSION,
    savedAt,
    preferences: state.preferences,
  };
  const workspaceRaw = JSON.stringify(workspacePayload);
  const userRaw = JSON.stringify(userPayload);

  try {
    window.localStorage.setItem(pending.workspaceKey, workspaceRaw);
    if (window.localStorage.getItem(pending.workspaceKey) !== workspaceRaw) {
      throw new Error('Workspace migration verification failed');
    }
    window.localStorage.setItem(pending.scopedKey, userRaw);
    if (window.localStorage.getItem(pending.scopedKey) !== userRaw) {
      throw new Error('User migration verification failed');
    }
    if (pending.sourceKey === STORAGE_KEY && pending.sourceKey !== pending.scopedKey) {
      window.localStorage.removeItem(pending.sourceKey);
    }
    pendingLegacyMigration = null;
    emit('storage:saved', { key: pending.workspaceKey, savedAt });
    return { ok: true, migrated: true };
  } catch (err) {
    emit('storage:save_error', {
      key: pending.workspaceKey,
      message: err && err.message ? err.message : 'Legacy migration failed',
      error: err,
    });
    return { ok: false, error: err };
  }
}

function serializeAppStateForScope(state, savedAt) {
  const sanitizedPacks = sanitizeLegacyPackQuantityLibrary(state.packLibrary).packLibrary;
  return {
    userRaw: JSON.stringify({
      version: APP_VERSION,
      savedAt,
      preferences: state.preferences,
    }),
    workspaceRaw: JSON.stringify({
      version: APP_VERSION,
      savedAt,
      caseLibrary: state.caseLibrary,
      packLibrary: sanitizedPacks,
      folderLibrary: Array.isArray(state.folderLibrary) ? state.folderLibrary : [],
      currentPackId: state.currentPackId,
    }),
  };
}

/**
 * Persist and read back an App Restore candidate while retaining the exact prior
 * scoped payloads in a durable recovery record. StateStore is not mutated here.
 * @param {Record<string, any>} candidateState
 * @param {{ expectedScope?: any }} [options]
 */
export function beginAppRestore(candidateState, { expectedScope } = {}) {
  let workspaceKey = null;
  let recoveryKey = null;
  let recoveryRaw = null;
  let recoveryRecord = null;
  let recoveryWritten = false;
  try {
    assertScopeContextCurrent(expectedScope);
    const scopedKey = getScopedKey();
    workspaceKey = getWorkspaceScopedKey();
    recoveryKey = getAppRestoreRecoveryKey(workspaceKey);

    const interruptedRestore = recoverInterruptedAppRestore(scopedKey, workspaceKey);
    if (!interruptedRestore.ok) throw interruptedRestore.error;
    assertScopeContextCurrent(expectedScope);

    const savedAt = Date.now();
    const { userRaw, workspaceRaw } = serializeAppStateForScope(candidateState, savedAt);
    recoveryRecord = {
      version: APP_RESTORE_RECOVERY_VERSION,
      transactionId: Utils.uuid(),
      scopedKey,
      workspaceKey,
      storageScope: expectedScope.storageScope,
      workspaceScope: expectedScope.workspaceScope,
      scopeGeneration: expectedScope.generation,
      priorUserRaw: window.localStorage.getItem(scopedKey),
      priorWorkspaceRaw: window.localStorage.getItem(workspaceKey),
      candidateUserFingerprint: fingerprintPersistedPayload(userRaw),
      candidateWorkspaceFingerprint: fingerprintPersistedPayload(workspaceRaw),
    };
    recoveryRaw = JSON.stringify(recoveryRecord);

    window.localStorage.setItem(recoveryKey, recoveryRaw);
    recoveryWritten = true;
    if (window.localStorage.getItem(recoveryKey) !== recoveryRaw) {
      throw new Error('App restore recovery snapshot verification failed');
    }
    assertScopeContextCurrent(expectedScope);

    window.localStorage.setItem(scopedKey, userRaw);
    if (window.localStorage.getItem(scopedKey) !== userRaw) {
      throw new Error('App restore preferences read-back verification failed');
    }
    assertScopeContextCurrent(expectedScope);

    window.localStorage.setItem(workspaceKey, workspaceRaw);
    if (window.localStorage.getItem(workspaceKey) !== workspaceRaw) {
      throw new Error('App restore workspace read-back verification failed');
    }
    assertScopeContextCurrent(expectedScope);

    if (
      window.localStorage.getItem(scopedKey) !== userRaw ||
      window.localStorage.getItem(workspaceKey) !== workspaceRaw
    ) {
      throw new Error('App restore durable verification failed');
    }

    return {
      ok: true,
      transactionId: recoveryRecord.transactionId,
      expectedScope,
      scopedKey,
      workspaceKey,
      recoveryKey,
      recoveryRaw,
      recoveryRecord,
      userRaw,
      workspaceRaw,
      savedAt,
    };
  } catch (error) {
    let rollback = { ok: true, rolledBack: true, recoverable: false };
    if (recoveryWritten && recoveryRecord && recoveryRaw && recoveryKey) {
      rollback = rollbackRestoreRecord(recoveryRecord, recoveryKey, recoveryRaw);
    } else if (recoveryKey && window.localStorage.getItem(recoveryKey) != null) {
      rollback = {
        ok: false,
        rolledBack: false,
        recoverable: true,
        error: createAppRestoreRecoveryError(error, {
          workspaceKey,
          recoveryKey,
          recoverable: true,
        }),
      };
    }
    emit('storage:restore_error', {
      key: workspaceKey,
      message: error && error.message ? error.message : 'App restore persistence failed',
      error,
      recoverable: Boolean(rollback.recoverable),
    });
    return {
      ok: false,
      error,
      rolledBack: rollback.rolledBack,
      recoverable: rollback.recoverable,
      rollbackError: rollback.ok ? null : rollback.error,
    };
  }
}

/** Complete an App Restore only after both scoped payloads still match. */
export function finalizeAppRestore(receipt) {
  try {
    if (!receipt || !receipt.ok) throw new Error('Invalid App restore receipt');
    assertScopeContextCurrent(receipt.expectedScope);
    if (window.localStorage.getItem(receipt.recoveryKey) !== receipt.recoveryRaw) {
      throw new Error('App restore recovery record changed before finalization');
    }
    if (
      window.localStorage.getItem(receipt.scopedKey) !== receipt.userRaw ||
      window.localStorage.getItem(receipt.workspaceKey) !== receipt.workspaceRaw
    ) {
      throw new Error('App restore durable state changed before finalization');
    }
    window.localStorage.removeItem(receipt.recoveryKey);
    if (window.localStorage.getItem(receipt.recoveryKey) !== null) {
      throw new Error('App restore finalization cleanup failed');
    }
    emit('storage:saved', { key: receipt.workspaceKey, savedAt: receipt.savedAt });
    return { ok: true, savedAt: receipt.savedAt };
  } catch (error) {
    emit('storage:restore_error', {
      key: receipt && receipt.workspaceKey,
      message: error && error.message ? error.message : 'App restore finalization failed',
      error,
      recoverable: Boolean(receipt && receipt.recoveryRaw),
    });
    return { ok: false, error };
  }
}

/** Roll back a prepared App Restore using its scoped durable recovery record. */
export function rollbackAppRestore(receipt) {
  if (!receipt || !receipt.recoveryRecord || !receipt.recoveryKey || !receipt.recoveryRaw) {
    return {
      ok: false,
      rolledBack: false,
      recoverable: false,
      error: new Error('Invalid App restore receipt'),
    };
  }
  return rollbackRestoreRecord(receipt.recoveryRecord, receipt.recoveryKey, receipt.recoveryRaw);
}

export function saveNow() {
  const scopedKey = getScopedKey();
  const workspaceKey = getWorkspaceScopedKey();
  try {
    const blocked = getAppRestoreSaveBlock(scopedKey, workspaceKey);
    if (blocked) {
      emit('storage:save_error', {
        key: workspaceKey,
        message: blocked.message,
        error: blocked,
        blocked: true,
      });
      return;
    }
    const state = StateStore.get();
    const sanitizedPacks = sanitizeLegacyPackQuantityLibrary(state.packLibrary).packLibrary;
    const userPayload = {
      version: APP_VERSION,
      savedAt: Date.now(),
      preferences: state.preferences,
    };
    const workspacePayload = {
      version: APP_VERSION,
      savedAt: userPayload.savedAt,
      caseLibrary: state.caseLibrary,
      packLibrary: sanitizedPacks,
      folderLibrary: Array.isArray(state.folderLibrary) ? state.folderLibrary : [],
      currentPackId: state.currentPackId,
    };
    const existingCombinedUserPayload = combinedLegacyPayloadAt(scopedKey);
    if (!existingCombinedUserPayload) {
      window.localStorage.setItem(scopedKey, JSON.stringify(userPayload));
    }
    window.localStorage.setItem(workspaceKey, JSON.stringify(workspacePayload));
    emit('storage:saved', { key: workspaceKey, savedAt: workspacePayload.savedAt });
  } catch (err) {
    emit('storage:save_error', {
      key: workspaceKey,
      message: err && err.message ? err.message : 'Save failed',
      error: err,
    });
  }
}

export function clearAll() {
  const scopedKey = getScopedKey();
  const workspacePrefix = `${scopedKey}:workspace:`;
  try {
    const keysToRemove = [scopedKey];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || key === scopedKey) continue;
      if (key.startsWith(workspacePrefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => window.localStorage.removeItem(key));
  } catch (err) {
    emit('storage:save_error', {
      key: scopedKey,
      message: err && err.message ? err.message : 'Clear failed',
      error: err,
    });
  }
}

export function exportAppJSON() {
  const state = StateStore.get();
  const sanitizedPacks = sanitizeLegacyPackQuantityLibrary(state.packLibrary).packLibrary;
  const payload = {
    app: 'Truck Packer 3D',
    version: APP_VERSION,
    exportedAt: Date.now(),
    data: {
      caseLibrary: state.caseLibrary,
      packLibrary: sanitizedPacks,
      folderLibrary: Array.isArray(state.folderLibrary) ? state.folderLibrary : [],
      preferences: state.preferences,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function exportWorkspaceJSON(workspaceName) {
  const state = StateStore.get();
  const sanitizedPacks = sanitizeLegacyPackQuantityLibrary(state.packLibrary).packLibrary;
  const strippedPacks = sanitizedPacks.map(pack => ({
    ...(pack || {}),
    thumbnail: null,
    thumbnailUpdatedAt: null,
  }));
  const payload = {
    app: 'Truck Packer 3D',
    exportType: 'workspace',
    schemaVersion: 'workspace-export-v1',
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    workspaceName: workspaceName ? String(workspaceName).trim() : '',
    data: {
      caseLibrary: Array.isArray(state.caseLibrary) ? state.caseLibrary : [],
      packLibrary: strippedPacks,
      folderLibrary: Array.isArray(state.folderLibrary) ? state.folderLibrary : [],
    },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Accepts either the new versioned Cargo Planner envelope
 * (kind: active-workspace-backup) or the legacy bare/`{data}` App backup
 * shape. Format/kind/schemaVersion/units are rejected before any graph
 * validation or normalization runs (see core/import-schema.js), and the
 * legacy path is byte-for-byte the pre-existing behavior.
 */
export function importAppJSON(jsonText) {
  try {
    const parsed = Utils.sanitizeJSON(Utils.safeJsonParse(jsonText, null));
    if (!isPlainRecord(parsed)) throw new Error('Invalid JSON: expected an object');
    let data;
    if (isCargoPlannerEnvelope(parsed)) {
      const envelope = parseCargoPlannerEnvelope(parsed, {
        expectedKinds: [IMPORT_KIND.ACTIVE_WORKSPACE_BACKUP],
      });
      data = envelope.data;
    } else {
      const hasEnvelope = Object.prototype.hasOwnProperty.call(parsed, 'data');
      if (hasEnvelope && !isPlainRecord(parsed.data)) {
        throw new Error('Invalid App backup envelope: data must be an object');
      }
      data = hasEnvelope ? parsed.data : parsed;
    }
    const { cases, packs, folders } = validateWorkspaceGraph(data, { requirePreferences: true });
    return normalizeAppData({
      caseLibrary: cases,
      packLibrary: packs,
      folderLibrary: folders,
      preferences: data.preferences,
      currentPackId: data.currentPackId || null,
    });
  } catch (err) {
    emit('storage:import_error', {
      message: err && err.message ? err.message : 'Import failed',
      error: err,
    });
    throw err;
  }
}
