/**
 * @file auth-overlay.js
 * @description Blocking authentication overlay (Supabase) with Sign In, Sign Up,
 *   Forgot Password, and Reset Password pages. Enterprise-style UI.
 * @module ui/overlays/auth-overlay
 * @updated 02/16/2026
 * @author Truck Packer 3D Team
 */

/*
  MANUAL TESTS
  1) Sign in with wrong password -> shows inline error "Incorrect email or password."
  2) Sign up with existing email -> shows "Account already exists. Try signing in."
  3) Sign up with email confirmation on -> shows success notice, stays on overlay.
  4) Forgot password -> shows success, rate-limited resend.
  5) Reset password (after clicking email link) -> password updated, auto-signs in.
  6) Double-click submit -> only one request fires.
  7) Refresh mid-flow -> overlay re-renders correct page.
  8) Google button hidden behind feature flag.
*/

// ============================================================================
// SECTION: CONSTANTS
// ============================================================================

const COMMON_PASSWORDS = new Set([
  'password', '12345678', '123456789', '1234567890', 'qwerty123', 'abcdefgh',
  'password1', 'iloveyou', 'sunshine1', 'princess1', 'football1', 'charlie1',
  'letmein12', 'welcome1', 'trustno1',
]);

const MIN_PW_LENGTH = 8;
const FORGOT_COOLDOWN_MS = 60_000;
const RESEND_COOLDOWN_MS = 45_000;
const BACKOFF_THRESHOLD = 3;
const BACKOFF_MS = 5_000;

// Feature flag: set to true to show Google sign-in button
const ENABLE_GOOGLE_SIGNIN = false;

// ============================================================================
// SECTION: FACTORY
// ============================================================================

/**
 * @param {{ UIComponents?: any, SupabaseClient?: any, tp3dDebugKey?: string }} [opts]
 */
export function createAuthOverlay({ UIComponents: _UIComponents, SupabaseClient, tp3dDebugKey } = {}) {
  // ---- State ----
  let overlayEl = null;
  let modalEl = null;
  let isOpen = false;
  let inFlight = false;
  let keydownHandler = null;
  let phase = 'checking'; // 'checking' | 'form' | 'cantconnect'
  let lastBootstrapError = null;
  let retryHandler = null;
  let forcedDisabledMessage = '';

  /**
   * Current auth page inside the form phase.
   * 'signin' | 'signup' | 'forgot' | 'reset'
   */
  let page = 'signin';

  // Form field state (preserved across re-renders within same page)
  let fieldEmail = '';
  let fieldPassword = '';
  let fieldPasswordConfirm = '';
  let showPassword = false;

  // Rate-limit / cooldown state
  let forgotCooldownUntil = 0;
  let resendDisabledUntil = 0;
  let cooldownTimer = null;
  let failCount = 0;
  let backoffUntil = 0;

  // For email-confirmation notice after signup
  let pendingConfirmationEmail = '';

  // ---- Helpers ----

  function toAscii(msg) {
    return String(msg || '').replace(/[^\x20-\x7E]+/g, '').trim();
  }

  function isDebugEnabled() {
    try { return window?.localStorage?.getItem('tp3dDebug') === '1'; } catch { return false; }
  }

  function isOffline() {
    try { return navigator?.onLine === false; } catch { return false; }
  }

  function validateEmail(email) {
    const s = String(email || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function validatePassword(pw) {
    const s = String(pw || '');
    if (s.length < MIN_PW_LENGTH) return { ok: false, msg: `At least ${MIN_PW_LENGTH} characters required.` };
    if (COMMON_PASSWORDS.has(s.toLowerCase())) return { ok: false, msg: 'This password is too common.' };
    return { ok: true, msg: '' };
  }

  function mapAuthError(err, action) {
    const raw = err?.message ? String(err.message) : '';
    const msg = raw.toLowerCase();
    let friendly = '';
    let hideDebug = false;

    if (msg.includes('invalid login credentials')) {
      friendly = 'Incorrect email or password.';
    } else if (msg.includes('email not confirmed')) {
      friendly = 'Please confirm your email first, then sign in.';
    } else if (msg.includes('user already registered') || msg.includes('user already exists')) {
      friendly = 'Account already exists. Try signing in.';
    } else if (msg.includes('banned')) {
      friendly = 'Account is no longer active. Please contact support.';
      hideDebug = true;
    } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('characters'))) {
      friendly = raw ? toAscii(raw) : 'Password is too weak.';
    } else if (msg.includes('rate') || msg.includes('too many')) {
      friendly = 'Too many attempts. Please wait a moment.';
    } else if (raw) {
      friendly = toAscii(raw);
    } else {
      friendly = action === 'signup' ? 'Sign up failed.' : 'Sign in failed.';
    }

    const title = action === 'signup' ? 'Sign up failed'
      : action === 'forgot' ? 'Password reset failed'
      : action === 'reset' ? 'Password update failed'
      : 'Sign in failed';
    let full = `${title}: ${friendly}`;
    if (isDebugEnabled() && !hideDebug && raw && toAscii(raw) !== friendly) {
      full += ` (${toAscii(raw)})`;
    }
    return full;
  }

  // ---- DOM Helpers ----

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') { e.className = v; }
      else if (k === 'textContent') { e.textContent = v; }
      else if (k === 'innerHTML') { e.innerHTML = v; }
      else if (k.startsWith('on') && typeof v === 'function') { e.addEventListener(k.slice(2).toLowerCase(), v); }
      else if (k === 'style' && typeof v === 'object') { Object.assign(e.style, v); }
      else if (k === 'disabled') { e.disabled = v; }
      else { e.setAttribute(k, v); }
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (!c) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function getModalRoot() {
    return document.getElementById('modal-root');
  }

  function ensureMounted() {
    if (overlayEl && modalEl) return;
    const root = getModalRoot();
    if (!root) return;

    overlayEl = el('div', {
      className: 'modal-overlay auth-overlay',
      'data-auth-overlay': '1',
      style: { zIndex: '99999', pointerEvents: 'auto' },
    });

    modalEl = el('div', {
      className: 'modal auth-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Authentication',
    });

    overlayEl.appendChild(modalEl);
    root.appendChild(overlayEl);
  }

  // ---- Rendering ----

  function scheduleCooldownTick() {
    if (cooldownTimer) clearTimeout(cooldownTimer);
    const now = Date.now();
    const nextTick = Math.max(0, Math.min(
      forgotCooldownUntil > now ? forgotCooldownUntil - now : Infinity,
      resendDisabledUntil > now ? resendDisabledUntil - now : Infinity,
      backoffUntil > now ? backoffUntil - now : Infinity,
    ));
    if (nextTick < Infinity) {
      cooldownTimer = setTimeout(() => { if (isOpen) render(); }, Math.min(nextTick + 100, 1500));
    }
  }

  function setPhase(nextPhase, { error, onRetry } = {}) {
    const p = String(nextPhase || '').toLowerCase();
    phase = p === 'cantconnect' || p === 'form' ? p : 'checking';
    lastBootstrapError = error || null;
    retryHandler = typeof onRetry === 'function' ? onRetry : retryHandler;
    render();
  }

  function navigateTo(nextPage) {
    page = nextPage;
    fieldPassword = '';
    fieldPasswordConfirm = '';
    showPassword = false;
    render();
    // Focus first input after render
    requestAnimationFrame(() => {
      const first = modalEl?.querySelector('input:not([type="checkbox"])');
      first?.focus();
    });
  }

  function render() {
    if (!modalEl) return;
    modalEl.innerHTML = '';

    if (phase === 'checking') {
      renderChecking();
    } else if (phase === 'cantconnect') {
      renderCantConnect();
    } else {
      // phase === 'form'
      switch (page) {
        case 'signup': renderSignUp(); break;
        case 'forgot': renderForgot(); break;
        case 'reset': renderReset(); break;
        default: renderSignIn(); break;
      }
    }
  }

  // ---- Brand header ----
  function renderBrandHeader(subtitle) {
    return el('div', { className: 'auth-brand' }, [
      el('div', { className: 'auth-logo' }, [
        el('div', { className: 'auth-logo-icon', textContent: 'TP' }),
      ]),
      el('h2', { className: 'auth-title', textContent: 'Truck Packer 3D' }),
      subtitle ? el('p', { className: 'auth-subtitle', textContent: subtitle }) : null,
    ]);
  }

  // ---- Offline banner ----
  function renderOfflineBanner() {
    if (!isOffline()) return null;
    return el('div', { className: 'auth-banner auth-banner--warning', role: 'alert' },
      'You are offline. Connect to the internet to continue.');
  }

  // ---- Checking phase ----
  function renderChecking() {
    const offline = isOffline();
    modalEl.appendChild(el('div', { className: 'auth-page' }, [
      renderBrandHeader(offline ? 'You are offline' : 'Checking session\u2026'),
      renderOfflineBanner(),
      !offline ? el('div', { className: 'auth-spinner-row' }, [
        el('i', { className: 'fa-solid fa-spinner fa-spin', 'aria-hidden': 'true' }),
      ]) : null,
    ]));
  }

  // ---- Can't connect phase ----
  function renderCantConnect() {
    modalEl.appendChild(el('div', { className: 'auth-page' }, [
      renderBrandHeader("Can't connect"),
      el('p', { className: 'auth-subtitle', textContent: 'Check your connection and try again.' }),
      isDebugEnabled() && lastBootstrapError ? el('details', { className: 'auth-debug' }, [
        el('summary', { textContent: 'Debug info' }),
        el('pre', { textContent: toAscii(lastBootstrapError?.message || String(lastBootstrapError)) }),
      ]) : null,
      el('div', { className: 'auth-actions' }, [
        el('button', {
          className: 'btn btn-primary auth-btn-full',
          type: 'button',
          textContent: 'Retry',
          onClick: () => { retryHandler?.(); },
        }),
      ]),
    ]));
  }

  // ---- Inline message elements ----
  function createMessageBox() {
    return el('div', {
      className: 'auth-message',
      'data-auth-msg': '1',
      role: 'alert',
      'aria-live': 'polite',
      style: { display: 'none' },
    });
  }

  function showMessage(msgEl, text, type = 'error') {
    if (!msgEl) return;
    msgEl.textContent = toAscii(text || '');
    msgEl.className = `auth-message auth-message--${type}`;
    msgEl.style.display = text ? 'block' : 'none';
  }

  // ---- Form field builders ----
  function buildField(label, type, attrs = {}) {
    const id = `auth-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const group = el('div', { className: 'auth-field' });

    const lbl = el('label', { className: 'auth-label', for: id, textContent: label });
    group.appendChild(lbl);

    const input = el('input', {
      className: 'input auth-input',
      type,
      id,
      'aria-label': label,
      ...attrs,
    });
    group.appendChild(input);

    return { group, input };
  }

  function buildPasswordField(label, attrs = {}) {
    const id = `auth-${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const group = el('div', { className: 'auth-field' });

    const lbl = el('label', { className: 'auth-label', for: id, textContent: label });
    group.appendChild(lbl);

    const wrapper = el('div', { className: 'auth-password-wrapper' });

    const input = el('input', {
      className: 'input auth-input',
      type: showPassword ? 'text' : 'password',
      id,
      'aria-label': label,
      ...attrs,
    });
    wrapper.appendChild(input);

    const toggle = el('button', {
      className: 'auth-pw-toggle',
      type: 'button',
      'aria-label': showPassword ? 'Hide password' : 'Show password',
      tabindex: '-1',
      innerHTML: showPassword
        ? '<i class="fa-solid fa-eye-slash"></i>'
        : '<i class="fa-solid fa-eye"></i>',
      onClick: () => {
        showPassword = !showPassword;
        input.type = showPassword ? 'text' : 'password';
        toggle.innerHTML = showPassword
          ? '<i class="fa-solid fa-eye-slash"></i>'
          : '<i class="fa-solid fa-eye"></i>';
        toggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
      },
    });
    wrapper.appendChild(toggle);
    group.appendChild(wrapper);

    return { group, input };
  }

  // ---- Backoff check ----
  function isBackedOff() {
    return Date.now() < backoffUntil;
  }

  function recordFailure() {
    failCount++;
    if (failCount >= BACKOFF_THRESHOLD) {
      backoffUntil = Date.now() + BACKOFF_MS * Math.min(failCount - BACKOFF_THRESHOLD + 1, 4);
    }
  }

  function resetFailures() {
    failCount = 0;
    backoffUntil = 0;
  }

  // ---- Google button (feature-flagged) ----
  function buildGoogleButton() {
    if (!ENABLE_GOOGLE_SIGNIN) return null;
    const divider = el('div', { className: 'auth-divider' }, [
      el('span', { textContent: 'or' }),
    ]);
    const btn = el('button', {
      className: 'btn auth-btn-full auth-btn-google',
      type: 'button',
      onClick: async () => {
        if (inFlight) return;
        try {
          inFlight = true;
          await SupabaseClient.signInWithOAuth('google', {
            redirectTo: window.location.origin + window.location.pathname,
          });
        } catch (err) {
          // OAuth redirects, so errors here are unusual
          console.error('[Auth] Google sign-in error', err);
        } finally {
          inFlight = false;
        }
      },
    }, [
      el('svg', { style: { width: '18px', height: '18px', marginRight: '8px' }, innerHTML: '<image href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCI+PHBhdGggZD0iTTE3LjY0IDkuMmMwLS42NC0uMDYtMS4yNS0uMTYtMS44NEg5djMuNDhoNC44NGMtLjIxIDEuMTMtLjg0IDIuMDgtMS43NCAyLjcydjIuMjZoMi44MmMxLjY1LTEuNTIgMi42LTMuNzcgMi42LTYuNjJ6IiBmaWxsPSIjNDI4NUY0Ii8+PHBhdGggZD0iTTkgMThjMi4zNSAwIDQuMzItLjc4IDUuNzYtMi4xMWwtMi44Mi0yLjI2Yy0uNzguNTItMS43OC44My0yLjk0LjgzLTIuMjYgMC00LjE3LTEuNTMtNC44Ni0zLjU4SDEuMjl2Mi4zM0MxLjc0IDE2LjA1IDUuMSAxOCA5IDE4eiIgZmlsbD0iIzM0QTg1MyIvPjxwYXRoIGQ9Ik00LjE0IDEwLjg4Yy0uMTgtLjUyLS4yOC0xLjA3LS4yOC0xLjY0cy4xLTEuMTIuMjgtMS42NFY0LjI3SDEuMjlDLjQ3IDUuOTEgMCA3LjQxIDAgOXMuNDcgMy4wOSAxLjI5IDQuNzNsMi44NS0yLjg1eiIgZmlsbD0iI0ZCQkMwNSIvPjxwYXRoIGQ9Ik05IDMuNThjMS4yOSAwIDIuNDQuNDQgMy4zNSAxLjMxbDIuNS0yLjVDMTMuMzIuOTQgMTEuMzUgMCA5IDBjLTMuOSAwLTcuMjYgMS45NS05LjI5IDUuMjdsMi44NSAyLjg1QzMuNDMgNS4xMSA2LjMzIDMuNTggOSAzLjU4eiIgZmlsbD0iI0VBNDMzNSIvPjwvc3ZnPg==" width="18" height="18" />' }),
      'Continue with Google',
    ]);
    return el('div', {}, [divider, btn]);
  }

  // ---- SIGN IN PAGE ----
  function renderSignIn() {
    const msgBox = createMessageBox();
    const email = buildField('Email', 'email', {
      autocomplete: 'email',
      placeholder: 'name@company.com',
      value: fieldEmail,
    });
    const pw = buildPasswordField('Password', {
      autocomplete: 'current-password',
      placeholder: 'Enter your password',
    });

    if (forcedDisabledMessage) {
      showMessage(msgBox, forcedDisabledMessage, 'error');
    }

    const offline = isOffline();
    const backedOff = isBackedOff();

    const submitBtn = el('button', {
      className: 'btn btn-primary auth-btn-full',
      type: 'submit',
      disabled: offline || inFlight || backedOff,
    }, [
      inFlight ? el('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: '8px' } }) : null,
      inFlight ? 'Signing in\u2026' : 'Sign in',
    ]);

    const form = el('form', {
      className: 'auth-form',
      novalidate: '',
      onSubmit: async (e) => {
        e.preventDefault();
        if (inFlight || isBackedOff() || isOffline()) return;

        const emailVal = String(email.input.value || '').trim();
        const pwVal = String(pw.input.value || '');
        fieldEmail = emailVal;

        if (!validateEmail(emailVal)) {
          showMessage(msgBox, 'Please enter a valid email address.', 'error');
          email.input.focus();
          return;
        }
        const pwCheck = validatePassword(pwVal);
        if (!pwCheck.ok) {
          showMessage(msgBox, pwCheck.msg, 'error');
          pw.input.focus();
          return;
        }

        try {
          inFlight = true;
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in\u2026';
          showMessage(msgBox, '', 'error');

          await SupabaseClient.signIn(emailVal, pwVal);

          // Post-sign-in ban check
          try {
            const fullUser = SupabaseClient.getUserSingleFlight
              ? await SupabaseClient.getUserSingleFlight() : null;
            if (fullUser?.banned_until) {
              const ts = new Date(fullUser.banned_until).getTime();
              if (!isNaN(ts) && ts > Date.now()) {
                showMessage(msgBox, 'Account is no longer active. Please contact support.', 'error');
                try { await SupabaseClient.signOut({ scope: 'local' }); } catch { /* ignore */ }
                return;
              }
            }
          } catch { /* If ban check fails, let sign-in succeed */ }

          resetFailures();
          // Auth state listener in app.js will close the overlay
        } catch (err) {
          recordFailure();
          showMessage(msgBox, mapAuthError(err, 'signin'), 'error');
        } finally {
          inFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign in';
        }
      },
    }, [
      email.group,
      pw.group,
      msgBox,
      renderOfflineBanner(),
      submitBtn,
    ]);

    const googleBtn = buildGoogleButton();

    const pageEl = el('div', { className: 'auth-page' }, [
      renderBrandHeader('Sign in to your account'),
      form,
      googleBtn,
      el('div', { className: 'auth-footer-links' }, [
        el('button', {
          className: 'auth-link',
          type: 'button',
          textContent: 'Forgot password?',
          onClick: () => navigateTo('forgot'),
        }),
        el('span', { className: 'auth-footer-sep', textContent: '\u00B7' }),
        el('button', {
          className: 'auth-link',
          type: 'button',
          textContent: "Don't have an account? Sign up",
          onClick: () => navigateTo('signup'),
        }),
      ]),
    ]);

    modalEl.appendChild(pageEl);
    scheduleCooldownTick();
  }

  // ---- SIGN UP PAGE ----
  function renderSignUp() {
    // If we just signed up and are waiting for email confirmation
    if (pendingConfirmationEmail) {
      renderConfirmationNotice();
      return;
    }

    const msgBox = createMessageBox();
    const email = buildField('Email', 'email', {
      autocomplete: 'email',
      placeholder: 'name@company.com',
      value: fieldEmail,
    });
    const pw = buildPasswordField('Password', {
      autocomplete: 'new-password',
      placeholder: 'Create a password',
    });
    const pwConfirm = buildPasswordField('Confirm password', {
      autocomplete: 'new-password',
      placeholder: 'Confirm your password',
    });

    const pwHint = el('p', { className: 'auth-hint', textContent: `Min. ${MIN_PW_LENGTH} characters. Avoid common passwords.` });

    const offline = isOffline();
    const backedOff = isBackedOff();

    const submitBtn = el('button', {
      className: 'btn btn-primary auth-btn-full',
      type: 'submit',
      disabled: offline || inFlight || backedOff,
    }, [
      inFlight ? el('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: '8px' } }) : null,
      inFlight ? 'Creating account\u2026' : 'Create account',
    ]);

    const form = el('form', {
      className: 'auth-form',
      novalidate: '',
      onSubmit: async (e) => {
        e.preventDefault();
        if (inFlight || isBackedOff() || isOffline()) return;

        const emailVal = String(email.input.value || '').trim();
        const pwVal = String(pw.input.value || '');
        const pwConfirmVal = String(pwConfirm.input.value || '');
        fieldEmail = emailVal;

        if (!validateEmail(emailVal)) {
          showMessage(msgBox, 'Please enter a valid email address.', 'error');
          email.input.focus();
          return;
        }
        const pwCheck = validatePassword(pwVal);
        if (!pwCheck.ok) {
          showMessage(msgBox, pwCheck.msg, 'error');
          pw.input.focus();
          return;
        }
        if (pwVal !== pwConfirmVal) {
          showMessage(msgBox, 'Passwords do not match.', 'error');
          pwConfirm.input.focus();
          return;
        }

        try {
          inFlight = true;
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account\u2026';
          showMessage(msgBox, '', 'error');

          const data = await SupabaseClient.signUp(emailVal, pwVal);
          const sess = data?.session;
          if (!sess) {
            // Email confirmation required
            pendingConfirmationEmail = emailVal;
            resetFailures();
            render();
          } else {
            resetFailures();
            // Session created immediately - auth listener will close overlay
          }
        } catch (err) {
          recordFailure();
          showMessage(msgBox, mapAuthError(err, 'signup'), 'error');
        } finally {
          inFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create account';
        }
      },
    }, [
      email.group,
      pw.group,
      pwHint,
      pwConfirm.group,
      msgBox,
      renderOfflineBanner(),
      submitBtn,
    ]);

    const googleBtn = buildGoogleButton();

    const pageEl = el('div', { className: 'auth-page' }, [
      renderBrandHeader('Create your account'),
      form,
      googleBtn,
      el('div', { className: 'auth-footer-links' }, [
        el('button', {
          className: 'auth-link',
          type: 'button',
          textContent: 'Already have an account? Sign in',
          onClick: () => {
            pendingConfirmationEmail = '';
            navigateTo('signin');
          },
        }),
      ]),
    ]);

    modalEl.appendChild(pageEl);
    scheduleCooldownTick();
  }

  // ---- EMAIL CONFIRMATION NOTICE ----
  function renderConfirmationNotice() {
    const msgBox = createMessageBox();
    const cooldownLeft = Math.max(0, Math.ceil((resendDisabledUntil - Date.now()) / 1000));

    const resendBtn = el('button', {
      className: 'btn auth-btn-full',
      type: 'button',
      disabled: cooldownLeft > 0 || inFlight,
      textContent: cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Resend confirmation email',
      onClick: async () => {
        if (inFlight || Date.now() < resendDisabledUntil) return;
        try {
          inFlight = true;
          resendBtn.disabled = true;
          showMessage(msgBox, '', 'error');
          await SupabaseClient.resendConfirmation(pendingConfirmationEmail);
          showMessage(msgBox, 'Confirmation email sent. Check your inbox.', 'success');
          resendDisabledUntil = Date.now() + RESEND_COOLDOWN_MS;
          scheduleCooldownTick();
        } catch (err) {
          showMessage(msgBox, mapAuthError(err, 'signup'), 'error');
        } finally {
          inFlight = false;
          resendBtn.disabled = false;
        }
      },
    });

    const pageEl = el('div', { className: 'auth-page' }, [
      renderBrandHeader('Check your email'),
      el('div', { className: 'auth-confirmation-notice' }, [
        el('div', { className: 'auth-confirmation-icon' }, [
          el('i', { className: 'fa-solid fa-envelope', 'aria-hidden': 'true' }),
        ]),
        el('p', { textContent: `We sent a confirmation link to:` }),
        el('p', { className: 'auth-email-display', textContent: toAscii(pendingConfirmationEmail) }),
        el('p', { className: 'auth-hint', textContent: 'Click the link in the email to verify your account, then come back here and sign in.' }),
      ]),
      msgBox,
      resendBtn,
      el('div', { className: 'auth-footer-links' }, [
        el('button', {
          className: 'auth-link',
          type: 'button',
          textContent: 'Back to sign in',
          onClick: () => {
            pendingConfirmationEmail = '';
            navigateTo('signin');
          },
        }),
      ]),
    ]);

    modalEl.appendChild(pageEl);
    scheduleCooldownTick();
  }

  // ---- FORGOT PASSWORD PAGE ----
  function renderForgot() {
    const msgBox = createMessageBox();
    const email = buildField('Email', 'email', {
      autocomplete: 'email',
      placeholder: 'name@company.com',
      value: fieldEmail,
    });

    const cooldownLeft = Math.max(0, Math.ceil((forgotCooldownUntil - Date.now()) / 1000));
    const offline = isOffline();

    const submitBtn = el('button', {
      className: 'btn btn-primary auth-btn-full',
      type: 'submit',
      disabled: offline || inFlight || cooldownLeft > 0,
      textContent: cooldownLeft > 0 ? `Retry in ${cooldownLeft}s` : 'Send reset link',
    });

    const form = el('form', {
      className: 'auth-form',
      novalidate: '',
      onSubmit: async (e) => {
        e.preventDefault();
        if (inFlight || isOffline() || Date.now() < forgotCooldownUntil) return;

        const emailVal = String(email.input.value || '').trim();
        fieldEmail = emailVal;

        if (!validateEmail(emailVal)) {
          showMessage(msgBox, 'Please enter a valid email address.', 'error');
          email.input.focus();
          return;
        }

        try {
          inFlight = true;
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending\u2026';
          showMessage(msgBox, '', 'error');

          const redirectTo = window.location.origin + window.location.pathname;
          await SupabaseClient.resetPasswordForEmail(emailVal, redirectTo);

          showMessage(msgBox, 'If that email is registered, you will receive a reset link shortly.', 'success');
          forgotCooldownUntil = Date.now() + FORGOT_COOLDOWN_MS;
          scheduleCooldownTick();
        } catch (err) {
          recordFailure();
          showMessage(msgBox, mapAuthError(err, 'forgot'), 'error');
        } finally {
          inFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send reset link';
        }
      },
    }, [
      email.group,
      el('p', { className: 'auth-hint', textContent: "Enter the email you used to sign up. We'll send you a link to reset your password." }),
      msgBox,
      renderOfflineBanner(),
      submitBtn,
    ]);

    const pageEl = el('div', { className: 'auth-page' }, [
      renderBrandHeader('Reset your password'),
      form,
      el('div', { className: 'auth-footer-links' }, [
        el('button', {
          className: 'auth-link',
          type: 'button',
          textContent: 'Back to sign in',
          onClick: () => navigateTo('signin'),
        }),
      ]),
    ]);

    modalEl.appendChild(pageEl);
    scheduleCooldownTick();
  }

  // ---- RESET PASSWORD PAGE (after clicking email link) ----
  function renderReset() {
    const msgBox = createMessageBox();
    const pw = buildPasswordField('New password', {
      autocomplete: 'new-password',
      placeholder: 'Enter new password',
    });
    const pwConfirm = buildPasswordField('Confirm new password', {
      autocomplete: 'new-password',
      placeholder: 'Confirm new password',
    });

    const pwHint = el('p', { className: 'auth-hint', textContent: `Min. ${MIN_PW_LENGTH} characters. Avoid common passwords.` });

    const submitBtn = el('button', {
      className: 'btn btn-primary auth-btn-full',
      type: 'submit',
      disabled: inFlight,
      textContent: 'Update password',
    });

    const form = el('form', {
      className: 'auth-form',
      novalidate: '',
      onSubmit: async (e) => {
        e.preventDefault();
        if (inFlight) return;

        const pwVal = String(pw.input.value || '');
        const pwConfirmVal = String(pwConfirm.input.value || '');

        const pwCheck = validatePassword(pwVal);
        if (!pwCheck.ok) {
          showMessage(msgBox, pwCheck.msg, 'error');
          pw.input.focus();
          return;
        }
        if (pwVal !== pwConfirmVal) {
          showMessage(msgBox, 'Passwords do not match.', 'error');
          pwConfirm.input.focus();
          return;
        }

        try {
          inFlight = true;
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating\u2026';
          showMessage(msgBox, '', 'error');

          await SupabaseClient.updateUserPassword(pwVal);
          showMessage(msgBox, 'Password updated successfully! Redirecting\u2026', 'success');

          // Small delay then navigate to sign in (auth listener should auto-close)
          setTimeout(() => {
            page = 'signin';
            render();
          }, 1500);
        } catch (err) {
          showMessage(msgBox, mapAuthError(err, 'reset'), 'error');
        } finally {
          inFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update password';
        }
      },
    }, [
      pw.group,
      pwHint,
      pwConfirm.group,
      msgBox,
      submitBtn,
    ]);

    const pageEl = el('div', { className: 'auth-page' }, [
      renderBrandHeader('Set a new password'),
      form,
    ]);

    modalEl.appendChild(pageEl);
  }

  // ---- Overlay show/hide ----

  function installKeydownBlocker() {
    if (keydownHandler) return;
    keydownHandler = ev => {
      try {
        const key = String(ev.key || '').toLowerCase();
        if (key === 'escape') { ev.preventDefault(); ev.stopPropagation(); return; }
        const target = ev.target;
        const isTyping = target?.matches?.('input, textarea, select, [contenteditable="true"]');
        if (!isTyping && key !== 'tab') { ev.stopPropagation(); }
        if (!isTyping && (ev.metaKey || ev.ctrlKey || ev.altKey)) { ev.stopPropagation(); }
      } catch { /* ignore */ }
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
    if (isOpen) { render(); return; }
    isOpen = true;
    overlayEl.style.display = 'flex';
    installKeydownBlocker();
    try { document.body.style.overflow = 'hidden'; } catch { /* ignore */ }
    render();
    requestAnimationFrame(() => {
      const first = modalEl?.querySelector('input:not([type="checkbox"])');
      first?.focus();
    });
  }

  function hide() {
    ensureMounted();
    if (!overlayEl) return;
    overlayEl.style.display = 'none';
    isOpen = false;
    forcedDisabledMessage = '';
    pendingConfirmationEmail = '';
    removeKeydownBlocker();
    try { document.body.style.overflow = ''; } catch { /* ignore */ }
  }

  function isOpenFn() {
    return Boolean(isOpen);
  }

  function setStatus(text) {
    // Kept for backward compatibility with app.js callers
  }

  function showAccountDisabled(message) {
    forcedDisabledMessage = String(message || 'Account is no longer active. Please contact support.');
    page = 'signin';
    setPhase('form');
    show();
  }

  /** Called by app.js when PASSWORD_RECOVERY event is detected */
  function showResetPassword() {
    page = 'reset';
    setPhase('form');
    show();
  }

  // ---- Online/offline listeners ----
  try {
    window.addEventListener('online', () => {
      try { if (isOpen && phase === 'checking') retryHandler?.(); }
      catch { /* ignore */ }
    }, { passive: true });

    window.addEventListener('offline', () => {
      try { if (isOpen) render(); }
      catch { /* ignore */ }
    }, { passive: true });
  } catch { /* ignore */ }

  // ---- Public API ----
  return {
    show,
    hide,
    isOpen: isOpenFn,
    setStatus,
    setPhase,
    showAccountDisabled,
    showResetPassword,
  };
}
