/**
 * @file auth-overlay.js
 * @description Blocking authentication overlay (Supabase) that prevents app interaction until signed in.
 * @module ui/overlays/auth-overlay
 * @created Unknown
 * @updated 01/30/2026
 * @author Truck Packer 3D Team
 */

/*
  MANUAL TESTS
  1) Sign in with wrong password -> shows "Sign in failed: Incorrect email or password."
  2) Sign up with existing email -> shows "Sign up failed: Account already exists. Try Sign In."
  3) Sign up with email confirmation on -> shows "Check your email to confirm..." and keeps overlay open.
*/

// ============================================================================
// SECTION: FACTORY
// ============================================================================

/**
 * @param {{ UIComponents?: any, SupabaseClient?: any, tp3dDebugKey?: string }} [opts]
 */
export function createAuthOverlay({ UIComponents: _UIComponents, SupabaseClient, tp3dDebugKey } = {}) {
  let overlayEl = null;
  let modalEl = null;
  let isOpen = false;
  let busy = false;
  let inFlight = false;
  let mode = 'signin'; // 'signin' | 'signup'
  let keydownHandler = null;
  let phase = 'checking'; // 'checking' | 'form' | 'cantconnect'
  let lastBootstrapError = null;
  let retryHandler = null;
  let showPassword = false;
  let resendDisabledUntil = 0;
  let resendCooldownTimer = null;
  let forcedDisabledMessage = '';

  function toAscii(msg) {
    return String(msg || '')
      .replace(/[^\x20-\x7E]+/g, '')
      .trim();
  }

  function isDebugEnabled() {
    try {
      return window && window.localStorage && window.localStorage.getItem('tp3dDebug') === '1';
    } catch {
      return false;
    }
  }

  function isOffline() {
    try {
      return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    } catch {
      return false;
    }
  }

  function validateEmail(email) {
    const s = String(email || '').trim();
    return s && s.includes('@');
  }

  function validatePassword(password) {
    return String(password || '').length >= 8;
  }

  function mapAuthError(err, action) {
    const raw = err && err.message ? String(err.message) : '';
    const msg = raw.toLowerCase();
    let friendly = '';
    let hideDebugDetails = false;

    if (msg.includes('invalid login credentials')) {
      friendly = 'Incorrect email or password.';
    } else if (msg.includes('email not confirmed')) {
      friendly = 'Please confirm your email, then sign in.';
    } else if (msg.includes('user already registered') || msg.includes('user already exists')) {
      friendly = 'Account already exists. Try Sign In.';
    } else if (msg.includes('user is banned') || msg.includes('user banned') || msg.includes('banned')) {
      // Replace raw Supabase banned messages with a friendly, non-technical message.
      friendly =
        'Account is no longer active. Please use another email, or contact support if you think this is a mistake.';
      hideDebugDetails = true;
    } else if (msg.includes('password') && msg.includes('weak')) {
      friendly = 'Password is too weak.';
    } else if (msg.includes('password') && msg.includes('characters')) {
      friendly = raw ? toAscii(raw) : 'Password is too weak.';
    } else if (raw) {
      friendly = toAscii(raw);
    } else {
      friendly = action === 'signup' ? 'Sign up failed.' : 'Sign in failed.';
    }

    const title = action === 'signup' ? 'Sign up failed' : 'Sign in failed';
    let full = `${title}: ${friendly}`;

    if (isDebugEnabled() && !hideDebugDetails && raw && toAscii(raw) && toAscii(raw) !== friendly) {
      full = `${full} Details: ${toAscii(raw)}`;
    }

    return { title, message: full, code: msg };
  }

  /**
   * @param {string} nextPhase
   * @param {{ error?: any, onRetry?: Function | null }} [opts]
   */
  function setPhase(nextPhase, { error, onRetry } = {}) {
    const p = String(nextPhase || '').toLowerCase();
    phase = p === 'cantconnect' || p === 'form' ? p : 'checking';
    lastBootstrapError = error || null;
    retryHandler = typeof onRetry === 'function' ? onRetry : retryHandler;
    render();
  }

  function getModalRoot() {
    return document.getElementById('modal-root');
  }

  function ensureMounted() {
    if (overlayEl && modalEl) return;
    const modalRoot = getModalRoot();
    if (!modalRoot) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'modal-overlay';
    overlayEl.setAttribute('data-auth-overlay', '1');
    overlayEl.style.zIndex = '99999';
    overlayEl.style.pointerEvents = 'auto';

    modalEl = document.createElement('div');
    modalEl.className = 'modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.style.maxWidth = '460px';
    modalEl.style.width = 'calc(100% - 48px)';
    modalEl.style.padding = '18px';

    overlayEl.appendChild(modalEl);
    modalRoot.appendChild(overlayEl);
  }

  function setBusy(next) {
    busy = Boolean(next);
    if (!modalEl) return;
    const btns = modalEl.querySelectorAll('button');
    btns.forEach(b => {
      b.disabled = busy;
    });
    const inputs = modalEl.querySelectorAll('input');
    inputs.forEach(i => {
      i.disabled = busy;
    });
    const statusEl = modalEl.querySelector('[data-auth-status]');
    if (statusEl) statusEl.textContent = busy ? 'Working...' : '';
  }

  function setInlineError(text) {
    // When offline we suppress inline auth errors (avoid confusing password errors)
    if (isOffline()) {
      try {
        if (!modalEl) return;
        const errEl = modalEl.querySelector('[data-auth-error]');
        if (!errEl) return;
        errEl.textContent = '';
        errEl.style.display = 'none';
      } catch {
        // ignore
      }
      return;
    }

    if (!modalEl) return;
    const errEl = modalEl.querySelector('[data-auth-error]');
    if (!errEl) return;
    errEl.textContent = toAscii(text || '');
    errEl.style.display = errEl.textContent ? 'block' : 'none';
  }

  function setInlineSuccess(text) {
    if (!modalEl) return;
    const okEl = modalEl.querySelector('[data-auth-success]');
    if (!okEl) return;
    okEl.textContent = toAscii(text || '');
    okEl.style.display = okEl.textContent ? 'block' : 'none';
  }

  function clearInlineMessages() {
    setInlineError('');
    setInlineSuccess('');
  }

  function scheduleResendCooldownRerender() {
    if (resendCooldownTimer) window.clearTimeout(resendCooldownTimer);
    const ms = Math.max(0, resendDisabledUntil - Date.now());
    resendCooldownTimer = window.setTimeout(() => {
      if (isOpen) render();
    }, ms || 1);
  }

  function render() {
    if (!modalEl) return;

    const offline = isOffline();

    const user = (() => {
      try {
        return SupabaseClient && SupabaseClient.getUser ? SupabaseClient.getUser() : null;
      } catch {
        return null;
      }
    })();

    const signedInEmail = user && user.email ? String(user.email) : '';

    modalEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = 'Sign in required';

    header.appendChild(title);

    modalEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';

    // Offline banner (toggled)
    try {
      const offBanner = document.createElement('div');
      offBanner.className = 'auth-offline-banner';
      offBanner.setAttribute('data-auth-offline', '');
      offBanner.hidden = !offline;
      offBanner.textContent = 'Offline mode. Reconnect to sign in.';
      body.appendChild(offBanner);
    } catch {
      // ignore
    }

    if (phase === 'checking') {
      if (offline) {
        const t = document.createElement('div');
        t.style.fontWeight = 'var(--font-semibold)';
        t.style.marginBottom = '6px';
        t.textContent = 'You are offline';
        body.appendChild(t);

        const msg = document.createElement('div');
        msg.className = 'muted';
        msg.style.marginBottom = '12px';
        msg.textContent = 'Sign in is not available without an internet connection.';
        body.appendChild(msg);

        modalEl.appendChild(body);
        return;
      }

      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.marginBottom = '10px';
      hint.textContent = 'Checking session...';
      body.appendChild(hint);

      const status = document.createElement('div');
      status.className = 'muted';
      status.setAttribute('data-auth-status', '1');
      status.textContent = busy ? 'Working...' : '';
      body.appendChild(status);

      modalEl.appendChild(body);
      return;
    }

    if (phase === 'cantconnect') {
      const t = document.createElement('div');
      t.style.fontWeight = 'var(--font-semibold)';
      t.style.marginBottom = '6px';
      t.textContent = "Can't connect";
      body.appendChild(t);

      const msg = document.createElement('div');
      msg.className = 'muted';
      msg.style.marginBottom = '12px';
      msg.textContent = 'Please check your connection and try again.';
      body.appendChild(msg);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.justifyContent = 'flex-end';

      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-primary';
      retryBtn.type = 'button';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        try {
          retryHandler && retryHandler();
        } catch {
          // ignore
        }
      });

      row.appendChild(retryBtn);
      body.appendChild(row);

      if (isDebugEnabled() && lastBootstrapError) {
        const details = document.createElement('details');
        details.style.marginTop = '12px';
        const summary = document.createElement('summary');
        summary.textContent = 'Debug';
        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.marginTop = '8px';
        pre.textContent = toAscii(
          lastBootstrapError && lastBootstrapError.message ? lastBootstrapError.message : String(lastBootstrapError)
        );
        details.appendChild(summary);
        details.appendChild(pre);
        body.appendChild(details);
      }

      modalEl.appendChild(body);
      return;
    }

    if (signedInEmail) {
      const info = document.createElement('div');
      info.className = 'muted';
      info.style.marginBottom = '12px';
      info.textContent = `Signed in as ${toAscii(signedInEmail)}`;
      body.appendChild(info);
    } else {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.marginBottom = '12px';
      hint.textContent = 'Please sign in to continue.';
      body.appendChild(hint);

      const emailLabel = document.createElement('div');
      emailLabel.className = 'label';
      emailLabel.textContent = 'Email';
      body.appendChild(emailLabel);

      const emailInput = document.createElement('input');
      emailInput.className = 'input';
      emailInput.type = 'email';
      emailInput.autocomplete = 'email';
      emailInput.placeholder = 'name@example.com';
      // Temporary test helper: prefill email for quicker testing
      emailInput.value = 'test2@test.com';
      emailInput.setAttribute('data-auth-email', '1');
      body.appendChild(emailInput);

      const passLabel = document.createElement('div');
      passLabel.className = 'label';
      passLabel.style.marginTop = '10px';
      passLabel.textContent = 'Password';
      body.appendChild(passLabel);

      const passInput = document.createElement('input');
      passInput.className = 'input';
      passInput.type = 'password';
      passInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
      passInput.placeholder = 'Password';
      // Temporary test helper: prefill password for quicker testing
      passInput.value = 'test2@test.com';
      passInput.setAttribute('data-auth-pass', '1');
      body.appendChild(passInput);

      const passRow = document.createElement('div');
      passRow.style.display = 'flex';
      passRow.style.alignItems = 'center';
      passRow.style.justifyContent = 'space-between';
      passRow.style.marginTop = '8px';

      const showPwLabel = document.createElement('label');
      showPwLabel.className = 'muted';
      showPwLabel.style.display = 'flex';
      showPwLabel.style.alignItems = 'center';
      showPwLabel.style.gap = '8px';
      showPwLabel.style.cursor = 'pointer';

      const showPw = document.createElement('input');
      showPw.type = 'checkbox';
      showPw.checked = Boolean(showPassword);
      showPw.addEventListener('change', () => {
        showPassword = Boolean(showPw.checked);
        passInput.type = showPassword ? 'text' : 'password';
      });

      const showPwText = document.createElement('span');
      showPwText.textContent = 'Show password';
      showPwLabel.appendChild(showPw);
      showPwLabel.appendChild(showPwText);

      passRow.appendChild(showPwLabel);
      body.appendChild(passRow);

      const errorBox = document.createElement('div');
      errorBox.className = 'muted';
      errorBox.setAttribute('data-auth-error', '1');
      errorBox.style.marginTop = '10px';
      errorBox.style.color = 'var(--error)';
      errorBox.style.display = offline ? 'none' : 'none';
      body.appendChild(errorBox);

      const successBox = document.createElement('div');
      successBox.className = 'muted';
      successBox.setAttribute('data-auth-success', '1');
      successBox.style.marginTop = '10px';
      successBox.style.color = 'var(--success)';
      successBox.style.display = 'none';
      body.appendChild(successBox);

      const status = document.createElement('div');
      status.className = 'muted';
      status.setAttribute('data-auth-status', '1');
      status.style.marginTop = '8px';
      status.textContent = '';
      body.appendChild(status);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '10px';
      btnRow.style.marginTop = '14px';

      const signInBtn = document.createElement('button');
      signInBtn.className = mode === 'signin' ? 'btn btn-primary' : 'btn';
      signInBtn.type = 'button';
      signInBtn.textContent = 'Sign In';
      if (offline) signInBtn.disabled = true;
      signInBtn.addEventListener('click', async () => {
        if (isOffline()) {
          // Guard: do not attempt auth while offline
          try {
            setInlineError('Sign in not available offline.');
          } catch {
            void 0;
          }
          return;
        }
        if (inFlight) return;
        clearInlineMessages();
        const email = String(emailInput.value || '').trim();
        const password = String(passInput.value || '');
        if (!validateEmail(email)) {
          setInlineError('Email must be valid.');
          return;
        }
        if (!validatePassword(password)) {
          setInlineError('Password must be at least 8 characters.');
          return;
        }
        try {
          inFlight = true;
          setBusy(true);
          signInBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in\u2026';
          await SupabaseClient.signIn(email, password);

          // Optional post-sign-in safety check: only block if the auth user is actually banned
          // FIX: Use wrapper instead of direct client.auth.getUser() to avoid bypassing single-flight protection
          try {
            let fullUser = null;
            if (SupabaseClient && typeof SupabaseClient.getUserSingleFlight === 'function') {
              fullUser = await SupabaseClient.getUserSingleFlight();
            }
            if (fullUser) {
              const bannedUntil = fullUser.banned_until ? String(fullUser.banned_until) : '';

              if (bannedUntil) {
                const ts = new Date(bannedUntil).getTime();
                if (!Number.isNaN(ts) && ts > Date.now()) {
                  setInlineError('Account is no longer active. Please contact support if you think this is a mistake.');
                  try {
                    // FIX: Use wrapper instead of direct client.auth.signOut()
                    await SupabaseClient.signOut({ scope: 'local' });
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } catch {
            // If this check fails, let sign-in succeed
          }
        } catch (err) {
          const mapped = mapAuthError(err, 'signin');
          setInlineError(mapped.message);
        } finally {
          signInBtn.textContent = 'Sign In';
          setBusy(false);
          inFlight = false;
        }
      });

      const signUpBtn = document.createElement('button');
      signUpBtn.className = mode === 'signup' ? 'btn btn-primary' : 'btn';
      signUpBtn.type = 'button';
      signUpBtn.textContent = 'Sign Up';
      signUpBtn.addEventListener('click', async () => {
        if (inFlight) return;
        clearInlineMessages();
        const email = String(emailInput.value || '').trim();
        const password = String(passInput.value || '');
        if (!validateEmail(email)) {
          setInlineError('Email must be valid.');
          return;
        }
        if (!validatePassword(password)) {
          setInlineError('Password must be at least 8 characters.');
          return;
        }
        try {
          inFlight = true;
          setBusy(true);
          signUpBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing up\u2026';
          const data = await SupabaseClient.signUp(email, password);
          const sess = data && data.session ? data.session : null;
          if (!sess) {
            setInlineSuccess('Check your email to confirm your account, then come back and sign in.');
            mode = 'signin';
            render();
          }
        } catch (err) {
          const mapped = mapAuthError(err, 'signup');
          setInlineError(mapped.message);
        } finally {
          signUpBtn.textContent = 'Sign Up';
          setBusy(false);
          inFlight = false;
        }
      });

      // If app bootstrap marked the account as blocked, show message and disable auth actions
      if (forcedDisabledMessage) {
        try {
          setInlineError(forcedDisabledMessage);
        } catch {
          /* ignore */
        }
        try {
          signInBtn.disabled = true;
        } catch {
          /* ignore */
        }
        try {
          signUpBtn.disabled = true;
        } catch {
          /* ignore */
        }
      }

      btnRow.appendChild(signInBtn);
      btnRow.appendChild(signUpBtn);
      body.appendChild(btnRow);

      const modeRow = document.createElement('div');
      modeRow.style.display = 'flex';
      modeRow.style.justifyContent = 'space-between';
      modeRow.style.marginTop = '10px';

      const modeText = document.createElement('div');
      modeText.className = 'muted';
      modeText.textContent = mode === 'signin' ? 'Mode: Sign In' : 'Mode: Sign Up';
      modeRow.appendChild(modeText);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-ghost';
      toggleBtn.type = 'button';
      toggleBtn.textContent = 'Switch';
      toggleBtn.addEventListener('click', () => {
        if (inFlight) return;
        clearInlineMessages();
        mode = mode === 'signin' ? 'signup' : 'signin';
        render();
        try {
          const emailEl = modalEl.querySelector('[data-auth-email]');
          emailEl && emailEl.focus && emailEl.focus();
        } catch {
          // ignore
        }
      });
      modeRow.appendChild(toggleBtn);

      body.appendChild(modeRow);

      const showResend = (() => {
        const errText = errorBox && errorBox.textContent ? String(errorBox.textContent) : '';
        const okText = successBox && successBox.textContent ? String(successBox.textContent) : '';
        const t = `${errText} ${okText}`.toLowerCase();
        return t.includes('confirm your email') || t.includes('email not confirmed');
      })();

      if (showResend) {
        const resendRow = document.createElement('div');
        resendRow.style.display = 'flex';
        resendRow.style.justifyContent = 'flex-start';
        resendRow.style.marginTop = '10px';

        const resendBtn = document.createElement('button');
        resendBtn.className = 'btn btn-ghost';
        resendBtn.type = 'button';
        const secondsLeft = Math.max(0, Math.ceil((resendDisabledUntil - Date.now()) / 1000));
        resendBtn.textContent = secondsLeft > 0 ? `Resend available in ${secondsLeft}s` : 'Resend confirmation email';
        resendBtn.disabled = secondsLeft > 0 || busy || inFlight;
        resendBtn.addEventListener('click', async () => {
          if (inFlight) return;
          clearInlineMessages();
          const email = String(emailInput.value || '').trim();
          if (!validateEmail(email)) {
            setInlineError('Enter your email above to resend confirmation.');
            return;
          }
          if (Date.now() < resendDisabledUntil) return;
          try {
            inFlight = true;
            setBusy(true);
            await SupabaseClient.resendConfirmation(email);
            setInlineSuccess('Confirmation email sent. Check your inbox.');
            resendDisabledUntil = Date.now() + 45 * 1000;
            scheduleResendCooldownRerender();
          } catch (err) {
            const mapped = mapAuthError(err, 'signin');
            setInlineError(mapped.message);
          } finally {
            setBusy(false);
            inFlight = false;
          }
        });

        resendRow.appendChild(resendBtn);
        body.appendChild(resendRow);
      }
    }

    modalEl.appendChild(body);

    if (tp3dDebugKey) {
      try {
        if (window && window.localStorage && window.localStorage.getItem(tp3dDebugKey) === '1') {
          const dbg = document.createElement('div');
          dbg.className = 'muted';
          dbg.style.marginTop = '10px';
          dbg.textContent = 'Debug: Auth overlay enabled';
          modalEl.appendChild(dbg);
        }
      } catch {
        // ignore
      }
    }
  }

  function installKeydownBlocker() {
    if (keydownHandler) return;
    keydownHandler = ev => {
      try {
        const key = String(ev.key || '').toLowerCase();
        if (key === 'escape') {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }

        const target = ev.target;
        const isTyping =
          target && target.matches && target.matches('input, textarea, select, [contenteditable="true"]');

        if (!isTyping && key !== 'tab') {
          ev.stopPropagation();
          return;
        }

        if (!isTyping && (ev.metaKey || ev.ctrlKey || ev.altKey)) {
          ev.stopPropagation();
        }
      } catch {
        // ignore
      }
    };
    document.addEventListener('keydown', keydownHandler, true);
  }

  function removeKeydownBlocker() {
    if (!keydownHandler) return;
    document.removeEventListener('keydown', keydownHandler, true);
    keydownHandler = null;
  }

  function show() {
    ensureMounted();
    if (!overlayEl) return;
    if (resendCooldownTimer) {
      // keep existing timer
    }
    if (isOpen) {
      render();
      return;
    }
    isOpen = true;
    overlayEl.style.display = 'flex';
    installKeydownBlocker();
    try {
      document.body.style.overflow = 'hidden';
    } catch {
      // ignore
    }
    render();
    try {
      const first = modalEl.querySelector('input');
      first && first.focus && first.focus();
    } catch {
      // ignore
    }
  }

  function hide() {
    ensureMounted();
    if (!overlayEl) return;
    overlayEl.style.display = 'none';
    isOpen = false;

    // Clear forced disabled message when overlay closes
    forcedDisabledMessage = '';

    removeKeydownBlocker();
    try {
      document.body.style.overflow = '';
    } catch {
      // ignore
    }
  }

  function isOpenFn() {
    return Boolean(isOpen);
  }

  function setStatus(text) {
    if (!modalEl) return;
    const statusEl = modalEl.querySelector('[data-auth-status]');
    if (!statusEl) return;
    statusEl.textContent = toAscii(text || '');
  }

  // Helper to expose a safe showStatus (used by online/offline listeners)
  function showStatus(text) {
    try {
      setStatus(text);
    } catch {
      // ignore
    }
  }

  // Safe retry hook - invokes internal retry handler if present
  function retrySessionCheck() {
    try {
      if (typeof retryHandler === 'function') {
        retryHandler();
      }
    } catch {
      // ignore
    }
  }

  // Register global online/offline handlers for the overlay (safe guards)
  try {
    window.addEventListener(
      'online',
      () => {
        try {
          showStatus('Connection restored. Checking session...');
          retrySessionCheck();
        } catch {
          // ignore
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'offline',
      () => {
        try {
          showStatus('You are offline');
        } catch {
          // ignore
        }
      },
      { passive: true }
    );
  } catch {
    // ignore failures attaching listeners
  }

  function showAccountDisabled(message) {
    forcedDisabledMessage = String(message || 'Account is no longer active. Please contact support.');
    mode = 'signin';
    setPhase('form');
    show();
  }

  return {
    show,
    hide,
    isOpen: isOpenFn,
    setStatus,
    setPhase,
    showAccountDisabled,
  };
}
