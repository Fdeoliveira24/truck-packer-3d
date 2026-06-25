/**
 * Editor operation lifecycle — the single authoritative "what mutating operation
 * is running right now" state for the 3D editor runtime.
 *
 * Before this module, operation control was scattered across engine-internal flags
 * (AutoPackEngine.isRunning), DOM `disabled` toggles, the TruckChangeController's
 * private `active`, and workspace-generation staleness checks — with Unpack and the
 * truck dropdowns guarded by nothing. That allowed AutoPack/Unpack/Truck-Change to
 * overlap and produce stale commits.
 *
 * This is deliberately tiny: one operation at a time, token-based completion so a
 * stale handler can never clear a newer operation, and a subscribe() fan-out the UI
 * uses to paint working states. It owns NO scene/pack/billing logic — callers run
 * the work and report start/finish here.
 */

export const OPERATION_KINDS = Object.freeze({
  IDLE: 'idle',
  AUTOPACKING: 'autopacking',
  UNPACKING: 'unpacking',
  CHANGING_TRUCK: 'changingTruck',
  PREVIEWING_TRUCK_CHANGE: 'previewingTruckChange',
  CAPTURING_PREVIEW: 'capturingPreview',
});

const MUTATING_KINDS = new Set([
  OPERATION_KINDS.AUTOPACKING,
  OPERATION_KINDS.UNPACKING,
  OPERATION_KINDS.CHANGING_TRUCK,
  OPERATION_KINDS.PREVIEWING_TRUCK_CHANGE,
  OPERATION_KINDS.CAPTURING_PREVIEW,
]);

export function createOperationLifecycle({ now = () => Date.now() } = {}) {
  let state = { kind: OPERATION_KINDS.IDLE, token: null, meta: null, startedAt: 0 };
  let seq = 0;
  const subscribers = new Set();

  function snapshot() {
    return {
      kind: state.kind,
      token: state.token,
      meta: state.meta,
      startedAt: state.startedAt,
      busy: state.kind !== OPERATION_KINDS.IDLE,
    };
  }

  function emit() {
    const snap = snapshot();
    for (const fn of subscribers) {
      try {
        fn(snap);
      } catch {
        // A faulty subscriber must never break operation accounting.
      }
    }
  }

  function isBusy() {
    return state.kind !== OPERATION_KINDS.IDLE;
  }

  function currentOperation() {
    return snapshot();
  }

  /**
   * Claim the single mutating-operation slot. Returns an opaque token on success
   * or null if another operation already holds it (the caller must NOT proceed).
   */
  function beginOperation(kind, meta = null) {
    if (!kind || !MUTATING_KINDS.has(kind)) return null;
    if (isBusy()) return null;
    seq += 1;
    state = { kind, token: `op-${seq}`, meta: meta || null, startedAt: now() };
    emit();
    return state.token;
  }

  /**
   * Release the slot. Only the token returned by the matching beginOperation can
   * clear it — a stale/cancelled handler holding an old token is a no-op, so it can
   * never return a newer operation to idle.
   */
  function finishOperation(token) {
    if (!token || token !== state.token) return false;
    state = { kind: OPERATION_KINDS.IDLE, token: null, meta: null, startedAt: 0 };
    emit();
    return true;
  }

  /** True only while `token` still owns the active slot (use for stale-result guards). */
  function isCurrent(token) {
    return Boolean(token) && token === state.token;
  }

  function assertIdle(message) {
    if (isBusy()) {
      throw new Error(message || `Another operation is in progress (${state.kind}).`);
    }
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    try {
      fn(snapshot());
    } catch {
      // ignore initial-callback failures
    }
    return () => subscribers.delete(fn);
  }

  return {
    KINDS: OPERATION_KINDS,
    beginOperation,
    finishOperation,
    isBusy,
    isCurrent,
    currentOperation,
    assertIdle,
    subscribe,
  };
}
