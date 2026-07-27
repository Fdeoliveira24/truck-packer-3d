/**
 * organization-service.js — Organization / Workspace domain (Stage 2 extraction).
 *
 * Checkpoint 1 (scaffold): the self-contained workspace-switch state machine.
 * Behavior-preserving move of app.js's workspace-switch subsystem into a factory.
 * app.js remains authoritative for orgContext state during CP1 and reads are bridged
 * through the injected getOrgContextSnapshot() accessor. Wiring/flip happens in a
 * later checkpoint. Billing (Stage 1) is frozen and only reached via injected
 * BillingService methods. No Billing storage keys / channels / timing are changed.
 */
export function createOrganizationService(deps) {
  const {
    // shared normalizers (also used by Billing; injected, not re-implemented)
    normalizeOrgIdForBilling,
    normalizeBillingEntitlementStatus,
    // auth truth accessor (Auth ownership stays in app.js)
    getSignedInUserIdStrict,
    // frozen Billing service (Stage 1)
    BillingService,
    // active org context snapshot (app.js remains authoritative in CP1)
    getOrgContextSnapshot,
    // stable per-tab org-context id (owned by app.js, shared with org-sync)
    getOrgContextTabId,
    ORG_UUID_RE,
  } = deps;

  const WORKSPACE_SWITCH_SYNC_KEY = 'tp3d:workspace-switch-state-sync';
  const orgContextTabId = getOrgContextTabId();

  const WORKSPACE_SWITCH_MAX_MS = 6000;
  let workspaceSwitchTimer = null;
  let workspaceSwitchState = {
    active: false,
    fromOrgId: null,
    toOrgId: null,
    source: null,
    startedAt: 0,
    finishedAt: 0,
    version: 0,
    localStateReady: false,
    orgReady: false,
    billingReady: false,
    remote: false,
  };
  let lastAppliedWorkspaceSwitchOrder = {
    transitionAt: 0,
    stateAt: 0,
    tabId: '',
  };

  function getWorkspaceSwitchState() {
    return { ...workspaceSwitchState };
  }

  function normalizeWorkspaceSwitchOrder(payload, fallbackTabId = '') {
    if (!payload || typeof payload !== 'object') return null;
    const active = Boolean(payload.active);
    const startedAt = Number(payload.startedAt || 0);
    const finishedAt = Number(payload.finishedAt || 0);
    const dispatchedAt = Number(payload.ts || 0);
    const transitionAt = Number.isFinite(startedAt) && startedAt > 0
      ? startedAt
      : active
        ? dispatchedAt
        : finishedAt || dispatchedAt;
    const stateAt = active
      ? dispatchedAt || transitionAt
      : Math.max(
        Number.isFinite(finishedAt) ? finishedAt : 0,
        Number.isFinite(dispatchedAt) ? dispatchedAt : 0,
        transitionAt
      );
    if (!Number.isFinite(transitionAt) || transitionAt <= 0 || !Number.isFinite(stateAt) || stateAt <= 0) {
      return null;
    }
    return {
      transitionAt: Math.floor(transitionAt),
      stateAt: Math.floor(stateAt),
      tabId: String(payload.tabId || fallbackTabId || ''),
    };
  }

  function compareWorkspaceSwitchOrder(incoming, applied = lastAppliedWorkspaceSwitchOrder) {
    if (!incoming) return -1;
    if (incoming.transitionAt !== applied.transitionAt) {
      return incoming.transitionAt > applied.transitionAt ? 1 : -1;
    }
    if (incoming.stateAt !== applied.stateAt) {
      return incoming.stateAt > applied.stateAt ? 1 : -1;
    }
    if (incoming.tabId === applied.tabId) return 0;
    return incoming.tabId > applied.tabId ? 1 : -1;
  }

  function recordWorkspaceSwitchOrder(order) {
    if (!order || compareWorkspaceSwitchOrder(order) < 0) return false;
    lastAppliedWorkspaceSwitchOrder = { ...order };
    return true;
  }

  function nextWorkspaceSwitchDispatchTimestamp() {
    return Math.max(Date.now(), Number(lastAppliedWorkspaceSwitchOrder.stateAt || 0) + 1);
  }

  function dispatchWorkspaceSwitchStateChanged(
    reason = 'update',
    { broadcast = true, recordOrder = true } = {}
  ) {
    const detail = {
      ...getWorkspaceSwitchState(),
      reason: reason || 'update',
    };
    const dispatchTs = nextWorkspaceSwitchDispatchTimestamp();
    if (recordOrder) {
      recordWorkspaceSwitchOrder(normalizeWorkspaceSwitchOrder({
        ...detail,
        tabId: orgContextTabId,
        ts: dispatchTs,
      }));
    }
    try {
      window.dispatchEvent(new CustomEvent('tp3d:workspace-switch-state', { detail }));
    } catch {
      // ignore
    }
    if (!broadcast) return;
    try {
      const userId = getSignedInUserIdStrict();
      if (!userId) return;
      const payload = {
        ...detail,
        userId,
        tabId: orgContextTabId,
        ts: dispatchTs,
      };
      const encoded = JSON.stringify(payload);
      window.localStorage.setItem(WORKSPACE_SWITCH_SYNC_KEY, encoded);
      window.setTimeout(() => {
        try {
          const raw = window.localStorage.getItem(WORKSPACE_SWITCH_SYNC_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            parsed.tabId === orgContextTabId &&
            Number(parsed.version || 0) === Number(payload.version || 0) &&
            String(parsed.reason || '') === String(payload.reason || '')
          ) {
            window.localStorage.removeItem(WORKSPACE_SWITCH_SYNC_KEY);
          }
        } catch {
          // ignore
        }
      }, 1500);
    } catch {
      // ignore
    }
  }

  function clearWorkspaceSwitchTimer() {
    if (!workspaceSwitchTimer) return;
    try {
      window.clearTimeout(workspaceSwitchTimer);
    } catch {
      // ignore
    }
    workspaceSwitchTimer = null;
  }

  function scheduleWorkspaceSwitchTimeout(version) {
    clearWorkspaceSwitchTimer();
    try {
      workspaceSwitchTimer = window.setTimeout(() => {
        if (workspaceSwitchState.active && workspaceSwitchState.version === version) {
          finishWorkspaceSwitch('timeout');
        }
      }, WORKSPACE_SWITCH_MAX_MS);
    } catch {
      workspaceSwitchTimer = null;
    }
  }

  function beginWorkspaceSwitch(toOrgId, source = 'org-switch') {
    const nextOrgId = normalizeOrgIdForBilling(toOrgId);
    if (!nextOrgId) return getWorkspaceSwitchState();
    BillingService.clearBillingPendingRetry();
    const fromOrgId = normalizeOrgIdForBilling(getOrgContextSnapshot() && getOrgContextSnapshot().activeOrgId ? getOrgContextSnapshot().activeOrgId : '');
    const nextVersion = (workspaceSwitchState.version || 0) + 1;
    workspaceSwitchState = {
      active: true,
      fromOrgId: fromOrgId || null,
      toOrgId: nextOrgId,
      source: source || 'org-switch',
      startedAt: Date.now(),
      finishedAt: 0,
      version: nextVersion,
      localStateReady: false,
      orgReady: false,
      billingReady: false,
      remote: false,
    };
    dispatchWorkspaceSwitchStateChanged('begin');
    scheduleWorkspaceSwitchTimeout(nextVersion);
    return getWorkspaceSwitchState();
  }

  function finishWorkspaceSwitch(reason = 'complete', options = {}) {
    BillingService.clearBillingPendingRetry();
    if (!workspaceSwitchState.active) {
      clearWorkspaceSwitchTimer();
      return getWorkspaceSwitchState();
    }
    clearWorkspaceSwitchTimer();
    workspaceSwitchState = {
      ...workspaceSwitchState,
      active: false,
      finishedAt: Date.now(),
    };
    dispatchWorkspaceSwitchStateChanged(reason || 'complete', options);
    return getWorkspaceSwitchState();
  }

  function markWorkspaceSwitchReady(partial = {}, reason = 'ready') {
    if (!workspaceSwitchState.active) return getWorkspaceSwitchState();
    workspaceSwitchState = {
      ...workspaceSwitchState,
      localStateReady: partial.localStateReady ? true : workspaceSwitchState.localStateReady,
      orgReady: partial.orgReady ? true : workspaceSwitchState.orgReady,
      billingReady: partial.billingReady ? true : workspaceSwitchState.billingReady,
    };
    if (workspaceSwitchState.localStateReady && workspaceSwitchState.orgReady && workspaceSwitchState.billingReady) {
      return finishWorkspaceSwitch(reason || 'ready');
    }
    dispatchWorkspaceSwitchStateChanged(reason || 'ready');
    return getWorkspaceSwitchState();
  }

  function hasWorkspaceSwitchOrgContextReady(orgId) {
    const targetOrgId = normalizeOrgIdForBilling(orgId);
    if (!targetOrgId) return false;
    const activeOrgId = normalizeOrgIdForBilling(getOrgContextSnapshot() && getOrgContextSnapshot().activeOrgId ? getOrgContextSnapshot().activeOrgId : '');
    if (activeOrgId !== targetOrgId) return false;
    const activeOrg = getOrgContextSnapshot() && getOrgContextSnapshot().activeOrg ? getOrgContextSnapshot().activeOrg : null;
    const activeOrgMatches = normalizeOrgIdForBilling(activeOrg && activeOrg.id ? activeOrg.id : activeOrgId) === targetOrgId;
    if (activeOrgMatches && activeOrg && String(activeOrg.name || '').trim()) return true;
    const orgs = Array.isArray(getOrgContextSnapshot() && getOrgContextSnapshot().orgs) ? getOrgContextSnapshot().orgs : [];
    return orgs.some(org => (
      normalizeOrgIdForBilling(org && org.id ? org.id : '') === targetOrgId &&
      String(org && org.name ? org.name : '').trim()
    ));
  }

  function markWorkspaceSwitchOrgReadyIfResolved(reason = 'org-ready') {
    if (!workspaceSwitchState.active) return;
    if (hasWorkspaceSwitchOrgContextReady(workspaceSwitchState.toOrgId)) {
      markWorkspaceSwitchReady({ orgReady: true }, reason);
    }
  }

  function markWorkspaceSwitchBillingReadyIfSettled(snapshot, reason = 'billing-ready') {
    if (!workspaceSwitchState.active) return;
    const state = snapshot || BillingService.getBillingState();
    const billingOrgId = normalizeOrgIdForBilling(state && state.orgId ? state.orgId : '');
    if (!billingOrgId || billingOrgId !== workspaceSwitchState.toOrgId) return;
    const hasEntitlement = Boolean(normalizeBillingEntitlementStatus(state && state.entitlementStatus));
    const hasUsableTargetSnapshot = Boolean(state.ok && state.lastFetchedAt && !state.error && hasEntitlement);
    const settled = !state.loading && !state.pending && Boolean((state.ok && hasEntitlement) || state.error || (!state.ok && state.lastFetchedAt));
    if (settled || hasUsableTargetSnapshot) {
      markWorkspaceSwitchReady({ billingReady: true }, reason);
    }
  }

  function parseWorkspaceSwitchSyncPayload(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function handleIncomingWorkspaceSwitchState(payload) {
    if (!payload || typeof payload !== 'object') return;
    const incomingTabId = payload.tabId ? String(payload.tabId) : '';
    if (incomingTabId && incomingTabId === orgContextTabId) return;

    const payloadUserId = payload.userId ? String(payload.userId) : '';
    const currentUserId = getSignedInUserIdStrict();
    if (!currentUserId || !payloadUserId || payloadUserId !== currentUserId) return;

    const targetOrgId = normalizeOrgIdForBilling(payload.toOrgId || '');
    if (!targetOrgId) return;

    const incomingOrder = normalizeWorkspaceSwitchOrder(payload, incomingTabId);
    if (!incomingOrder || compareWorkspaceSwitchOrder(incomingOrder) <= 0) return;

    const nextVersion = Number(payload.version || 0) || ((workspaceSwitchState.version || 0) + 1);
    const incomingTs = Number(payload.ts || payload.startedAt || 0) || 0;
    const incomingActive = Boolean(payload.active);
    if (incomingActive) {
      if (
        !workspaceSwitchState.active &&
        workspaceSwitchState.toOrgId === targetOrgId &&
        workspaceSwitchState.finishedAt &&
        incomingTs &&
        incomingTs < workspaceSwitchState.finishedAt
      ) {
        return;
      }
      recordWorkspaceSwitchOrder(incomingOrder);
      clearWorkspaceSwitchTimer();
      const appliedVersion = Math.max(Number(workspaceSwitchState.version || 0) || 0, nextVersion);
      workspaceSwitchState = {
        active: true,
        fromOrgId: normalizeOrgIdForBilling(payload.fromOrgId || '') || null,
        toOrgId: targetOrgId,
        source: payload.source ? String(payload.source) : 'workspace-switch-sync',
        startedAt: Number(payload.startedAt || payload.ts || Date.now()) || Date.now(),
        finishedAt: 0,
        version: appliedVersion,
        localStateReady: Boolean(payload.localStateReady),
        orgReady: Boolean(payload.orgReady),
        billingReady: Boolean(payload.billingReady),
        remote: true,
      };
      dispatchWorkspaceSwitchStateChanged(payload.reason || 'sync', {
        broadcast: false,
        recordOrder: false,
      });
      try {
        workspaceSwitchTimer = window.setTimeout(() => {
          if (workspaceSwitchState.active && workspaceSwitchState.version === appliedVersion) {
            finishWorkspaceSwitch('sync-timeout', { broadcast: false });
          }
        }, WORKSPACE_SWITCH_MAX_MS);
      } catch {
        workspaceSwitchTimer = null;
      }
      return;
    }

    if (workspaceSwitchState.active && workspaceSwitchState.toOrgId && workspaceSwitchState.toOrgId !== targetOrgId) {
      return;
    }
    if (workspaceSwitchState.active && workspaceSwitchState.remote !== true) {
      return;
    }
    recordWorkspaceSwitchOrder(incomingOrder);
    clearWorkspaceSwitchTimer();
    workspaceSwitchState = {
      ...workspaceSwitchState,
      active: false,
      fromOrgId: normalizeOrgIdForBilling(payload.fromOrgId || '') || workspaceSwitchState.fromOrgId || null,
      toOrgId: targetOrgId,
      source: payload.source ? String(payload.source) : workspaceSwitchState.source,
      finishedAt: Number(payload.finishedAt || payload.ts || Date.now()) || Date.now(),
      version: Math.max(Number(workspaceSwitchState.version || 0) || 0, nextVersion),
      localStateReady: Boolean(payload.localStateReady),
      orgReady: Boolean(payload.orgReady),
      billingReady: Boolean(payload.billingReady),
      remote: true,
    };
    dispatchWorkspaceSwitchStateChanged(payload.reason || 'sync-complete', {
      broadcast: false,
      recordOrder: false,
    });
  }

  // ── Active-org context reads + storage mirrors (Stage 2 CP2) ──────────────
  const ORG_CONTEXT_LS_KEY = 'tp3d:active-org-id';

  function getActiveOrgId() {
    return getOrgContextSnapshot().activeOrgId;
  }

  function getActiveRole() {
    const c = getOrgContextSnapshot();
    return c && typeof c.role === 'string' ? c.role : '';
  }

  function readLocalOrgId() {
    try {
      const raw = window.localStorage.getItem(ORG_CONTEXT_LS_KEY);
      return raw ? String(raw) : null;
    } catch {
      return null;
    }
  }

  function writeLocalOrgId(orgId) {
    try {
      if (!orgId) {
        window.localStorage.removeItem(ORG_CONTEXT_LS_KEY);
        return;
      }
      window.localStorage.setItem(ORG_CONTEXT_LS_KEY, String(orgId));
    } catch {
      // ignore
    }
  }

  // best-effort sync active orgId with fallbacks
  function getActiveOrgIdNow() {
    // 1) canonical billing-resolved active org id
    try {
      const wcId = BillingService.getActiveOrgIdForBilling();
      if (wcId) return wcId;
    } catch { /* ignore */ }
    // 2) module org-context snapshot
    try {
      const snap = getOrgContextSnapshot();
      const id = normalizeOrgIdForBilling(snap && snap.activeOrgId);
      if (id) return id;
    } catch { /* ignore */ }
    // 3) localStorage hint (UUID-validated)
    try {
      const lsId = readLocalOrgId();
      if (lsId && ORG_UUID_RE.test(lsId)) return lsId;
    } catch { /* ignore */ }
    return '';
  }

  // ── Org-changed publication + version ordering (Stage 2 CP3) ──────────────
  const ORG_CONTEXT_SYNC_KEY = 'tp3d:org-context-sync';
  let orgContextVersion = 0;
  let lastAppliedOrgContextVersion = 0;
  let lastAppliedOrgContextTabId = '';

  function parseOrgContextVersion(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  function nextOrgContextVersion() {
    orgContextVersion = Math.max(parseOrgContextVersion(orgContextVersion) + 1, Date.now());
    return orgContextVersion;
  }

  function getOrgContextEffectiveVersion(payload) {
    if (!payload || typeof payload !== 'object') return 0;
    return Math.max(
      parseOrgContextVersion(payload.epoch),
      parseOrgContextVersion(payload.version),
      parseOrgContextVersion(payload.ts),
      parseOrgContextVersion(payload.timestamp)
    );
  }

  function compareOrgContextOrder(version, tabId = '') {
    const parsed = parseOrgContextVersion(version);
    if (!parsed) return -1;
    if (parsed !== lastAppliedOrgContextVersion) {
      return parsed > lastAppliedOrgContextVersion ? 1 : -1;
    }
    const incomingTabId = String(tabId || '');
    if (incomingTabId === lastAppliedOrgContextTabId) return 0;
    return incomingTabId > lastAppliedOrgContextTabId ? 1 : -1;
  }

  function markOrgContextVersion(version, tabId = '') {
    const parsed = parseOrgContextVersion(version);
    if (!parsed) return 0;
    orgContextVersion = Math.max(orgContextVersion, parsed);
    if (compareOrgContextOrder(parsed, tabId) >= 0) {
      lastAppliedOrgContextVersion = parsed;
      lastAppliedOrgContextTabId = String(tabId || '');
    }
    return parsed;
  }

  /**
   * @param {{
   *   orgId?: string|null,
   *   reason?: string|null,
   *   version?: number,
   *   broadcast?: boolean,
   *   source?: string|null,
   *   ts?: number,
   *   tabId?: string|null,
   *   userId?: string|null,
   *   allowEmpty?: boolean,
   *   confirmedNoOrg?: boolean,
   * }} [options]
   * @returns {number}
   */
  function dispatchOrgContextChanged(options = {}) {
    const {
      orgId,
      reason = 'org-context',
      version = 0,
      broadcast = false,
      source = 'local',
      ts = Date.now(),
      userId = null,
      allowEmpty = false,
      confirmedNoOrg: dispatchConfirmedNoOrg = false,
    } = options || {};
    const nextOrgId = orgId ? String(orgId).trim() : '';
    if (!nextOrgId && !(allowEmpty && dispatchConfirmedNoOrg)) return 0;
    const signedInUserId = userId || getSignedInUserIdStrict();
    if (!signedInUserId) return 0;
    const detailTabId = options && options.tabId ? String(options.tabId) : orgContextTabId;
    const nextVersion = markOrgContextVersion(version || nextOrgContextVersion(), detailTabId);
    const detail = {
      orgId: nextOrgId,
      reason: reason || null,
      userId: signedInUserId,
      confirmedNoOrg: dispatchConfirmedNoOrg || undefined,
      ts: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
      timestamp: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
      epoch: nextVersion,
      tabId: detailTabId,
      source,
    };

    try {
      window.dispatchEvent(new CustomEvent('tp3d:org-changed', { detail }));
    } catch {
      // ignore
    }

    if (broadcast) {
      try {
        window.localStorage.setItem(ORG_CONTEXT_SYNC_KEY, JSON.stringify(detail));
        // Keep the key ephemeral so stale payloads are less likely to be replayed.
        window.setTimeout(() => {
          try {
            const raw = window.localStorage.getItem(ORG_CONTEXT_SYNC_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (
              parsed &&
              parsed.tabId === orgContextTabId &&
              parseOrgContextVersion(parsed.epoch) === nextVersion
            ) {
              window.localStorage.removeItem(ORG_CONTEXT_SYNC_KEY);
            }
          } catch {
            // ignore
          }
        }, 1500);
      } catch {
        // ignore
      }
    }

    return nextVersion;
  }

  function parseOrgContextSyncPayload(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function getOrgContextVersionState() {
    return { orgContextVersion, lastAppliedOrgContextVersion, lastAppliedOrgContextTabId };
  }

  function resetOrgContextVersion() {
    orgContextVersion = 0;
    lastAppliedOrgContextVersion = 0;
    lastAppliedOrgContextTabId = '';
  }

  return {
    getWorkspaceSwitchState,
    beginWorkspaceSwitch,
    finishWorkspaceSwitch,
    markWorkspaceSwitchReady,
    markWorkspaceSwitchOrgReadyIfResolved,
    markWorkspaceSwitchBillingReadyIfSettled,
    hasWorkspaceSwitchOrgContextReady,
    parseWorkspaceSwitchSyncPayload,
    handleIncomingWorkspaceSwitchState,
    getActiveOrgId,
    getActiveRole,
    getActiveOrgIdNow,
    readLocalOrgId,
    writeLocalOrgId,
    dispatchOrgContextChanged,
    parseOrgContextSyncPayload,
    markOrgContextVersion,
    compareOrgContextOrder,
    getOrgContextEffectiveVersion,
    getOrgContextVersionState,
    resetOrgContextVersion,
  };
}
