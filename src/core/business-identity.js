/**
 * @file business-identity.js
 * @description Pure normalization, validation, uniqueness, generation, and
 *   migration primitives for Case and Load Plan business identity.
 * @module core/business-identity
 */

export const BUSINESS_IDENTITY_MAX_LENGTH = 64;
export const LOAD_PLAN_NUMBER_PREFIX = 'LP-';
export const LOAD_PLAN_NUMBER_RANDOM_LENGTH = 8;
export const LOAD_PLAN_NUMBER_MAX_ATTEMPTS = 32;
export const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CONTROL_OR_LINE_BREAK = /[\p{Cc}\u2028\u2029]/u;
const BUSINESS_IDENTITY_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'accent',
});

export class BusinessIdentityError extends Error {
  constructor(error) {
    const details = error && typeof error === 'object' ? error : {};
    const code = String(details.code || 'invalid');
    const field = String(details.field || 'businessIdentity');
    super(`Business identity validation failed (${code}) for ${field}`);
    this.name = 'BusinessIdentityError';
    this.code = code;
    this.field = field;
    this.conflictId = details.conflictId == null ? null : String(details.conflictId);
  }
}

export function normalizeBusinessIdentityDisplay(value) {
  if (value == null) return null;
  return String(value).normalize('NFKC').trim() || null;
}

export function normalizeBusinessIdentityComparison(value) {
  const display = normalizeBusinessIdentityDisplay(value);
  return display == null ? null : display.toLowerCase();
}

export function compareBusinessIdentityValues(left, right, { direction = 'asc' } = {}) {
  const leftValue = normalizeBusinessIdentityDisplay(left);
  const rightValue = normalizeBusinessIdentityDisplay(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const comparison = BUSINESS_IDENTITY_COLLATOR.compare(leftValue, rightValue);
  return direction === 'desc' ? -comparison : comparison;
}

export function validateBusinessIdentityValue(value, { field = 'businessIdentity', required = false } = {}) {
  if (value != null && typeof value !== 'string') {
    return {
      ok: false,
      value: null,
      comparison: null,
      error: { code: 'invalid_type', field },
    };
  }

  const normalized = normalizeBusinessIdentityDisplay(value);
  if (normalized == null) {
    if (required) {
      return {
        ok: false,
        value: null,
        comparison: null,
        error: { code: 'required', field },
      };
    }
    return { ok: true, value: null, comparison: null, error: null };
  }

  if (CONTROL_OR_LINE_BREAK.test(normalized)) {
    return {
      ok: false,
      value: normalized,
      comparison: null,
      error: { code: 'control_character', field },
    };
  }

  if (Array.from(normalized).length > BUSINESS_IDENTITY_MAX_LENGTH) {
    return {
      ok: false,
      value: normalized,
      comparison: null,
      error: { code: 'too_long', field },
    };
  }

  return {
    ok: true,
    value: normalized,
    comparison: normalized.toLowerCase(),
    error: null,
  };
}

export function assertBusinessIdentityValue(value, options = {}) {
  const result = validateBusinessIdentityValue(value, options);
  if (!result.ok) throw new BusinessIdentityError(result.error);
  return result.value;
}

function checkAvailability(value, records, {
  field,
  required,
  excludeId = null,
} = {}) {
  const validation = validateBusinessIdentityValue(value, { field, required });
  if (!validation.ok) return { ...validation, available: false, conflictId: null };
  if (validation.comparison == null) {
    return { ...validation, available: true, conflictId: null };
  }

  const excluded = excludeId == null ? null : String(excludeId);
  const conflict = (Array.isArray(records) ? records : []).find(record => {
    if (!record || typeof record !== 'object') return false;
    if (excluded != null && String(record.id) === excluded) return false;
    return normalizeBusinessIdentityComparison(record[field]) === validation.comparison;
  });

  if (!conflict) return { ...validation, available: true, conflictId: null };
  const conflictId = conflict.id == null ? null : String(conflict.id);
  return {
    ok: false,
    available: false,
    value: validation.value,
    comparison: validation.comparison,
    conflictId,
    error: { code: 'not_unique', field, conflictId },
  };
}

export function checkItemCodeAvailability(itemCode, cases, options = {}) {
  return checkAvailability(itemCode, cases, {
    field: 'itemCode',
    required: false,
    ...options,
  });
}

export function checkLoadPlanNumberAvailability(loadPlanNumber, packs, options = {}) {
  return checkAvailability(loadPlanNumber, packs, {
    field: 'loadPlanNumber',
    required: true,
    ...options,
  });
}

export function assertItemCodeAvailable(itemCode, cases, options = {}) {
  const result = checkItemCodeAvailability(itemCode, cases, options);
  if (!result.ok) throw new BusinessIdentityError(result.error);
  return result.value;
}

export function assertLoadPlanNumberAvailable(loadPlanNumber, packs, options = {}) {
  const result = checkLoadPlanNumberAvailability(loadPlanNumber, packs, options);
  if (!result.ok) throw new BusinessIdentityError(result.error);
  return result.value;
}

function secureRandomValues(length) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new BusinessIdentityError({ code: 'random_unavailable', field: 'loadPlanNumber' });
  }
  return cryptoApi.getRandomValues(new Uint8Array(length));
}

export function generateLoadPlanNumber(packs, {
  maxAttempts = LOAD_PLAN_NUMBER_MAX_ATTEMPTS,
  randomValues = secureRandomValues,
} = {}) {
  const requestedAttempts = Number.isFinite(Number(maxAttempts)) ? Math.trunc(Number(maxAttempts)) : 0;
  const attempts = Math.max(1, Math.min(LOAD_PLAN_NUMBER_MAX_ATTEMPTS, requestedAttempts));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const values = randomValues(LOAD_PLAN_NUMBER_RANDOM_LENGTH, attempt);
    if (!values || values.length < LOAD_PLAN_NUMBER_RANDOM_LENGTH) {
      throw new BusinessIdentityError({ code: 'random_unavailable', field: 'loadPlanNumber' });
    }
    let randomPart = '';
    for (let i = 0; i < LOAD_PLAN_NUMBER_RANDOM_LENGTH; i += 1) {
      const byte = Number(values[i]);
      if (!Number.isFinite(byte)) {
        throw new BusinessIdentityError({ code: 'random_unavailable', field: 'loadPlanNumber' });
      }
      randomPart += CROCKFORD_BASE32_ALPHABET[Math.trunc(byte) & 31];
    }
    const candidate = `${LOAD_PLAN_NUMBER_PREFIX}${randomPart}`;
    if (checkLoadPlanNumberAvailability(candidate, packs).available) return candidate;
  }

  throw new BusinessIdentityError({
    code: 'collision_retry_exhausted',
    field: 'loadPlanNumber',
  });
}

/**
 * Add only missing Load Plan Numbers. Existing objects, timestamps, ordering,
 * and every non-identity field remain untouched.
 */
export function migrateLoadPlanNumbers(packLibrary, options = {}) {
  const source = Array.isArray(packLibrary) ? packLibrary : [];
  const reserved = [];
  const validated = source.map(rawPack => {
    const pack = rawPack && typeof rawPack === 'object' ? rawPack : {};
    const validation = validateBusinessIdentityValue(pack.loadPlanNumber, {
      field: 'loadPlanNumber',
      required: false,
    });
    if (!validation.ok) throw new BusinessIdentityError(validation.error);

    if (validation.value != null) {
      assertLoadPlanNumberAvailable(validation.value, reserved);
      reserved.push({ id: pack.id, loadPlanNumber: validation.value });
    }

    return { pack, loadPlanNumber: validation.value };
  });

  let changed = false;
  const packs = validated.map(({ pack, loadPlanNumber: existingNumber }) => {
    if (existingNumber != null) return pack;

    const loadPlanNumber = generateLoadPlanNumber(reserved, options);
    reserved.push({ id: pack.id, loadPlanNumber });
    changed = true;
    return { ...pack, loadPlanNumber };
  });

  return { packLibrary: changed ? packs : source, changed };
}

/**
 * Canonicalize only the additive identity fields and enforce workspace
 * uniqueness. This is intentionally independent of cargo geometry/state.
 */
export function normalizeBusinessIdentityLibraries(caseLibrary, packLibrary) {
  const cases = [];
  for (const rawCase of Array.isArray(caseLibrary) ? caseLibrary : []) {
    const caseData = rawCase && typeof rawCase === 'object' ? rawCase : {};
    const itemCode = assertItemCodeAvailable(caseData.itemCode, cases);
    cases.push({ ...caseData, itemCode });
  }

  const packs = [];
  for (const rawPack of Array.isArray(packLibrary) ? packLibrary : []) {
    const pack = rawPack && typeof rawPack === 'object' ? rawPack : {};
    const loadPlanNumber = assertLoadPlanNumberAvailable(pack.loadPlanNumber, packs);
    const customerReference = assertBusinessIdentityValue(pack.customerReference, {
      field: 'customerReference',
      required: false,
    });
    packs.push({ ...pack, loadPlanNumber, customerReference });
  }

  return { caseLibrary: cases, packLibrary: packs };
}
