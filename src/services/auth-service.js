/**
 * auth-service.js — Application Authentication runtime (Stage 3).
 *
 * CP1: the Auth truth-snapshot + stability-gate subsystem. Consumes the existing
 * SupabaseClient (session/client ownership stays there) and owns the app-level auth
 * truth interpretation + stability gate. renderAuthState / rehydrate orchestration,
 * getCurrentAuthSnapshot (Auth+Org), lastAuthEventSnapshot, and the account-enforcement
 * latch (setAuthBlocked/clearAuthBlocked) remain in app.js. Side-effect-free on import.
 */
export function createAuthService(deps) {
  const {
    // Supabase session/client boundary — consumed, never owned here.
    SupabaseClient,
    // shared helpers
    isTp3dDebugEnabled,
    isLogoutInProgress,
    // lastAuthEventSnapshot stays app.js-owned (read by getCurrentAuthSnapshot,
    // written by the retained auth listener) — the gate/truth read it via this accessor.
    getLastAuthEventSnapshot,
  } = deps;

  // Late-bound Organization storage accessor. Breaks the Auth<->Org construction
  // cycle: Org needs AuthService.getSignedInUserIdStrict at build time, while the
  // gate needs OrganizationService.readLocalOrgId at runtime. Set after Org is built.
  let _readLocalOrgId = () => null;

  const FALLBACK_AUTH_TTL_MS = 8000;
  const AUTH_SIGNED_OUT_STABLE_MS = 2000;

  const _authGate = {
    lastSignedInAt: 0,
    signedOutCandidateAt: 0,
    signedOutTimer: /** @type {ReturnType<typeof setTimeout>|null} */ (null),
    settled: false,
  };
  // Settled dedupe: avoid repeated settled:set for the same status+user
  let _settledStatus = /** @type {string|null} */ (null);
  let _settledUserId = /** @type {string|null} */ (null);

  function authGateIsSettled() {
    return _authGate.settled;
  }

  /** Mark auth as settled + signed-in. Cancels any pending signed-out candidate. */
  function authGateSignedIn() {
    _authGate.lastSignedInAt = Date.now();
    if (_authGate.signedOutTimer) {
      clearTimeout(_authGate.signedOutTimer);
      _authGate.signedOutTimer = null;
      if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCancelledBySignedIn');
    }
    if (_authGate.signedOutCandidateAt) {
      _authGate.signedOutCandidateAt = 0;
    }
    // Dedupe: skip if already settled with same status + user
    const nextUserId = getSignedInUserIdStrict();
    if (_authGate.settled && _settledStatus === 'signed_in' && _settledUserId === nextUserId) {
      if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedIn', status: 'signed_in', userIdTail: nextUserId ? nextUserId.slice(-6) : null });
      return;
    }
    _authGate.settled = true;
    _settledStatus = 'signed_in';
    _settledUserId = nextUserId;
    if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'signedIn', status: 'signed_in', userIdTail: nextUserId ? nextUserId.slice(-6) : null });
  }

  /**
   * Start signed-out candidate timer. Only confirms signed-out after
   * AUTH_SIGNED_OUT_STABLE_MS with no intervening SIGNED_IN.
   * @param {() => void} onConfirmed — called when signed-out is stable
   */
  function authGateSignedOutCandidate(onConfirmed) {
    _authGate.signedOutCandidateAt = Date.now();
    if (_authGate.signedOutTimer) clearTimeout(_authGate.signedOutTimer);

    // During boot phase (never seen SIGNED_IN yet), ALWAYS wait the full FALLBACK_AUTH_TTL_MS.
    // Reason: when Supabase fires SIGNED_OUT it has already cleared its own localStorage tokens,
    // so checking for sb-*-auth-token or a cached org ID is unreliable — both can be absent even
    // when a valid SIGNED_IN is imminent via cross-tab broadcast (which can take 2–5 s on slow
    // connections). Using the short 2-second window during boot causes premature org-clearing and
    // the "Create or join a workspace" banner flash on the secondary tab.
    const isBootPhase = _authGate.lastSignedInAt === 0;
    // Keep hasSessionIndicators for logging / future use, but do not use it to shorten the timeout.
    let hasSessionIndicators = false;
    if (isBootPhase) {
      try {
        hasSessionIndicators = Boolean(_readLocalOrgId());
        if (!hasSessionIndicators) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
              hasSessionIndicators = true;
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }
    // Boot phase: always 8s so cross-tab SIGNED_IN has time to arrive regardless of cache state.
    // Post-boot: 2s is enough — a real sign-out from a live session should be stable quickly.
    const timeoutMs = isBootPhase
      ? FALLBACK_AUTH_TTL_MS   // 8s during any boot phase (SIGNED_IN may come from cross-tab)
      : AUTH_SIGNED_OUT_STABLE_MS; // 2s for stable post-boot sign-out

    if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCandidate', { isBootPhase, hasSessionIndicators, timeoutMs });
    _authGate.signedOutTimer = setTimeout(() => {
      _authGate.signedOutTimer = null;
      // Only confirm if no SIGNED_IN arrived in the interim
      if (_authGate.signedOutCandidateAt && !_authGate.lastSignedInAt) {
        if (_authGate.settled && _settledStatus === 'signed_out' && _settledUserId === null) {
          if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedOutConfirmed', status: 'signed_out' });
          return;
        }
        _authGate.settled = true;
        _settledStatus = 'signed_out';
        _settledUserId = null;
        if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source: 'signedOutConfirmed', status: 'signed_out', timeoutMs });
        onConfirmed();
      } else if (_authGate.lastSignedInAt > _authGate.signedOutCandidateAt) {
        if (isTp3dDebugEnabled()) console.info('[authGate] signedOutCancelledBySignedIn (timer)');
      } else {
        // Fallback: lastSignedInAt exists but is older than signedOutCandidateAt.
        // Guard: block if we have a recent signed-in signal (snapshot, gate, or wrapper).
        const _snapshotAgeMs = getLastAuthEventSnapshot() ? Date.now() - (getLastAuthEventSnapshot().ts || 0) : Infinity;
        const _hasRecentSignedInSnapshot = Boolean(
          getLastAuthEventSnapshot() && getLastAuthEventSnapshot().status === 'signed_in' && _snapshotAgeMs < FALLBACK_AUTH_TTL_MS
        );
        const _gateSignedInAgeMs = _authGate.lastSignedInAt ? Date.now() - _authGate.lastSignedInAt : Infinity;
        const _hasRecentGateSignedIn = _gateSignedInAgeMs < FALLBACK_AUTH_TTL_MS;
        const _logoutLatchActive = isLogoutInProgress();
        const _authTruth = (() => { try { return getAuthTruthSnapshot(); } catch { return null; } })();
        const _authWrapperStatus = _authTruth ? _authTruth.status : null;
        const _wrapperSignedIn = Boolean(_authTruth && _authTruth.isSignedIn);
        const _hasRecentSignedIn = _hasRecentSignedInSnapshot || _hasRecentGateSignedIn || _wrapperSignedIn;
        // Only block cleanup when the wrapper still shows signed-in.
        // If the wrapper already reports signed-out the session is gone; allow cleanup
        // even if a recent SIGNED_IN is on record (covers cross-tab sign-out case).
        if (_hasRecentSignedIn && !_logoutLatchActive && _wrapperSignedIn) {
          if (isTp3dDebugEnabled()) {
            console.info('[authGate] signedOutFallback:block', {
              hasRecentSignedInSnapshot: _hasRecentSignedInSnapshot,
              snapshotAgeMs: _snapshotAgeMs,
              gateSignedInAgeMs: _gateSignedInAgeMs,
              wrapperSignedIn: _wrapperSignedIn,
              hasSessionIndicators,
              authWrapperStatus: _authWrapperStatus,
              logoutLatchActive: _logoutLatchActive,
            });
          }
          return;
        }
        if (_authGate.settled && _settledStatus === 'signed_out' && _settledUserId === null) {
          if (isTp3dDebugEnabled()) console.info('[authGate] settled:dedupe', { source: 'signedOutConfirmedFallback', status: 'signed_out' });
          return;
        }
        _authGate.settled = true;
        _settledStatus = 'signed_out';
        _settledUserId = null;
        if (isTp3dDebugEnabled()) {
          console.info('[authGate] signedOutFallback:confirm', {
            hasRecentSignedInSnapshot: _hasRecentSignedInSnapshot,
            snapshotAgeMs: _snapshotAgeMs,
            gateSignedInAgeMs: _gateSignedInAgeMs,
            wrapperSignedIn: _wrapperSignedIn,
            hasSessionIndicators,
            authWrapperStatus: _authWrapperStatus,
            logoutLatchActive: _logoutLatchActive,
          });
          console.info('[authGate] settled:set', { source: 'signedOutConfirmedFallback', status: 'signed_out', timeoutMs });
        }
        onConfirmed();
      }
    }, timeoutMs);
  }

  /** INITIAL_SESSION with user===null: auth not settled yet. */
  function authGateInitialSession() {
    if (isTp3dDebugEnabled()) console.info('[authGate] initial-session');
    // Do NOT set settled — wait for SIGNED_IN or stable SIGNED_OUT.
  }

  function getAuthTruthSnapshot() {
    const authState =
      SupabaseClient && typeof SupabaseClient.getAuthState === 'function' ? SupabaseClient.getAuthState() : null;
    const status = authState && authState.status ? authState.status : 'unknown';
    const session = authState && authState.session ? authState.session : null;
    const user = authState && authState.user ? authState.user : session && session.user ? session.user : null;
    const userId = user && user.id ? String(user.id) : null;
    const hasToken = Boolean(session && session.access_token);
    const isSignedIn = Boolean(status === 'signed_in' && hasToken && userId);
    return { status, userId, hasToken, session, user, isSignedIn };
  }

  function shouldUseSignedInHint() {
    if (isLogoutInProgress()) return false;
    if (!getLastAuthEventSnapshot()) return false;
    if (getLastAuthEventSnapshot().status !== 'signed_in') return false;
    if (!getLastAuthEventSnapshot().hasToken || !getLastAuthEventSnapshot().session) return false;
    const age = Date.now() - (getLastAuthEventSnapshot().ts || 0);
    return age < FALLBACK_AUTH_TTL_MS;
  }

  function getSignedInUserIdStrict() {
    const truth = getAuthTruthSnapshot();
    return truth && truth.isSignedIn && truth.userId ? String(truth.userId) : null;
  }

  // Auth-truth accessor mirrored into Billing (getCurrentBillingAuthUserId) and the
  // module-level _authTruthSnapshotAccessor consumed by ensureWorkspaceReadyForUI.
  const authTruthAccessor = () => {
    const truth = getAuthTruthSnapshot();
    return {
      status: truth.status,
      userId: truth.userId,
      hasToken: truth.hasToken,
      isSignedIn: truth.isSignedIn,
    };
  };

  // Semantic gate mutation for the retained bootstrap paths: mark settled+signed_out
  // only when the gate is idle (not settled, no signed-out candidate timer running).
  function markSignedOutSettledIfIdle(source) {
    if (!_authGate.settled && !_authGate.signedOutTimer) {
      _authGate.settled = true;
      _settledStatus = 'signed_out';
      _settledUserId = null;
      if (isTp3dDebugEnabled()) console.info('[authGate] settled:set', { source, status: 'signed_out' });
      return true;
    }
    return false;
  }

  function setReadLocalOrgIdAccessor(fn) {
    _readLocalOrgId = typeof fn === 'function' ? fn : () => null;
  }

  // ── Rehydration / refresh guards (Stage 3 CP2) ───────────────────────────
  const AUTH_REHYDRATE_COOLDOWN_MS = 750;
  const AUTH_REFRESH_WINDOW_MS = 10000;
  const AUTH_REFRESH_MAX_ATTEMPTS = 3;
  let lastAuthRehydrateAt = 0;
  let authRefreshWindowStart = 0;
  let authRefreshAttempts = 0;

  function canStartAuthRehydrate({ force = false } = {}) {
    if (force) {
      lastAuthRehydrateAt = Date.now();
      return true;
    }
    const now = Date.now();
    if (now - lastAuthRehydrateAt < AUTH_REHYDRATE_COOLDOWN_MS) return false;
    lastAuthRehydrateAt = now;
    return true;
  }

  // Register one auth-refresh attempt within the rolling window; returns true when the
  // attempt count now exceeds the max (the caller applies the auto-only/force policy).
  function registerAuthRefreshAttempt() {
    const now = Date.now();
    if (!authRefreshWindowStart || now - authRefreshWindowStart > AUTH_REFRESH_WINDOW_MS) {
      authRefreshWindowStart = now;
      authRefreshAttempts = 0;
    }
    authRefreshAttempts += 1;
    return authRefreshAttempts > AUTH_REFRESH_MAX_ATTEMPTS;
  }

  // ── Account-enforcement latch (Stage 3 CP3) ──────────────────────────────
  // Root orchestration interprets this and performs the disabled/banned UI, forced
  // sign-out, and Billing/Organization clearing; the service just owns the state.
  let authBlockState = null;

  function setAuthBlocked(message) {
    try {
      authBlockState = { message: message || 'Your account has been disabled.', ts: Date.now() };
    } catch {
      authBlockState = { message: 'Your account has been disabled.', ts: Date.now() };
    }
  }

  function clearAuthBlocked() {
    authBlockState = null;
  }

  function getAuthBlockState() {
    return authBlockState;
  }

  return {
    authGateIsSettled,
    authGateSignedIn,
    authGateSignedOutCandidate,
    authGateInitialSession,
    getAuthTruthSnapshot,
    shouldUseSignedInHint,
    getSignedInUserIdStrict,
    authTruthAccessor,
    markSignedOutSettledIfIdle,
    setReadLocalOrgIdAccessor,
    canStartAuthRehydrate,
    registerAuthRefreshAttempt,
    setAuthBlocked,
    clearAuthBlocked,
    getAuthBlockState,
  };
}
