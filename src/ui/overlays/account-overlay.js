/**
 * @file account-overlay.js
 * @description Dedicated overlay for viewing account details outside of the Settings modal.
 * @module ui/overlays/account-overlay
 */

import { getUserAvatarView } from '../../core/utils/index.js';

/**
 * @param {{ documentRef?: Document, SupabaseClient?: any, UIComponents?: any }} [opts]
 */
export function createAccountOverlay(opts = {}) {
  const { documentRef = document, SupabaseClient, UIComponents } = opts;
  const doc = documentRef;

  let accountOverlay = null;
  let accountModal = null;
  let trapKeydownHandler = null;
  let lastFocusedEl = null;
  let warnedMissingModalRoot = false;

  // Epoch guard for race condition protection
  let renderRequestId = 0;
  let cachedUserView = null;
  let cachedUserViewAt = 0;
  let refreshUserViewPromise = null;
  let lastRefreshAt = 0;
  let lastKnownUserId = null;

  async function fetchUserView({ force = false } = {}) {
    let user = null;
    let profile = null;

    try {
      // Use the single-flight bundle approach for consistent data
      if (SupabaseClient && typeof SupabaseClient.getAccountBundleSingleFlight === 'function') {
        const bundle = await SupabaseClient.getAccountBundleSingleFlight({ force });
        if (bundle && !bundle.canceled) {
          user = bundle.user || null;
          profile = bundle.profile || null;
        }
      } else {
        // Fallback for older code paths
        user = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
        if (user && SupabaseClient && typeof SupabaseClient.getProfile === 'function') {
          profile = await SupabaseClient.getProfile(user.id);
        }
      }
    } catch {
      profile = null;
    }

    const view = getUserAvatarView({ user, profile });
    cachedUserView = view;
    cachedUserViewAt = Date.now();
    lastKnownUserId = user && user.id ? String(user.id) : lastKnownUserId;
    return view;
  }

  async function refreshUserViewAsync() {
    if (refreshUserViewPromise) return refreshUserViewPromise;
    refreshUserViewPromise = fetchUserView({ force: true })
      .then(() => {
        if (accountModal) void render();
      })
      .catch(() => {})
      .finally(() => {
        refreshUserViewPromise = null;
      });
    return refreshUserViewPromise;
  }

  async function getCurrentUserView() {
    if (cachedUserView) {
      const now = Date.now();
      const ageMs = cachedUserViewAt ? now - cachedUserViewAt : Number.POSITIVE_INFINITY;
      if (ageMs > 500 && now - lastRefreshAt > 500) {
        lastRefreshAt = now;
        void refreshUserViewAsync();
      }
      return cachedUserView;
    }
    return fetchUserView();
  }

  function isOpen() {
    return Boolean(accountOverlay);
  }

  function close() {
    if (!accountOverlay) return;

    try {
      accountOverlay._tp3dCleanup && accountOverlay._tp3dCleanup();
    } catch {
      // ignore
    }

    try {
      doc.body.classList.remove('modal-open');
    } catch {
      // ignore
    }

    try {
      if (trapKeydownHandler) doc.removeEventListener('keydown', trapKeydownHandler, true);
    } catch {
      // ignore
    }
    trapKeydownHandler = null;

    try {
      if (accountOverlay.parentElement) accountOverlay.parentElement.removeChild(accountOverlay);
    } catch {
      // ignore
    }

    accountOverlay = null;
    accountModal = null;

    try {
      if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
        lastFocusedEl.focus();
      }
    } catch {
      // ignore
    }
    lastFocusedEl = null;
  }

  function row(label, valueEl) {
    const wrap = doc.createElement('div');
    wrap.classList.add('tp3d-settings-row');
    const l = doc.createElement('div');
    l.classList.add('tp3d-settings-row-label');
    l.textContent = label;
    wrap.appendChild(l);
    wrap.appendChild(valueEl);
    return wrap;
  }

  function showDeleteAccountConfirmModal({ email = '', onConfirm }) {
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';

    const modal = doc.createElement('div');
    modal.className = 'modal tp3d-settings-modal';
    modal.style.maxWidth = '560px';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('tabindex', '-1');

    const header = doc.createElement('div');
    header.className = 'row space-between';
    header.classList.add('tp3d-settings-right-header');

    const headerText = doc.createElement('div');
    headerText.classList.add('tp3d-settings-right-text');

    const title = doc.createElement('div');
    title.classList.add('tp3d-settings-right-title');
    title.textContent = 'Request Account Deletion';

    const subtitle = doc.createElement('div');
    subtitle.classList.add('tp3d-settings-right-subtitle');
    subtitle.classList.add('muted');
    subtitle.textContent = 'User will no longer have access to the project.';

    headerText.appendChild(title);
    headerText.appendChild(subtitle);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    header.appendChild(headerText);
    header.appendChild(closeBtn);

    const body = doc.createElement('div');
    body.classList.add('tp3d-settings-right-body');

    const p1 = doc.createElement('div');
    p1.style.marginTop = '4px';
    p1.textContent = 'Confirm to delete user';

    const p2 = doc.createElement('div');
    p2.className = 'muted';
    p2.style.marginTop = '6px';
    p2.textContent =
      'Deleting a user is irreversible. This will remove the selected user from the project and all associated data.';

    const safeEmail = String(email || '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const p3 = doc.createElement('div');
    p3.style.marginTop = '12px';
    p3.innerHTML = `This is permanent. Are you sure you want to delete the user <strong>${safeEmail}</strong>?`;

    const p4 = doc.createElement('div');
    p4.className = 'muted';
    p4.style.marginTop = '12px';
    p4.textContent = 'Type DELETE to confirm.';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.placeholder = 'Type DELETE';
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.style.marginTop = '10px';

    const error = doc.createElement('div');
    error.className = 'muted';
    error.style.marginTop = '8px';
    error.style.minHeight = '18px';
    error.style.color = 'var(--danger, #dc2626)';
    error.textContent = '';

    const footer = doc.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.style.marginTop = '16px';

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';

    const deleteBtn = doc.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete account';
    deleteBtn.disabled = true;

    footer.appendChild(cancelBtn);
    footer.appendChild(deleteBtn);

    body.appendChild(p1);
    body.appendChild(p2);
    body.appendChild(p3);
    body.appendChild(p4);
    body.appendChild(input);
    body.appendChild(error);
    body.appendChild(footer);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    let escapeHandler = null;

    const cleanup = () => {
      try {
        if (escapeHandler) doc.removeEventListener('keydown', escapeHandler, true);
      } catch {
        // ignore
      }
      escapeHandler = null;

      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {
        // ignore
      }
    };

    const isValid = () =>
      String(input.value || '')
        .trim()
        .toUpperCase() === 'DELETE';

    const sync = () => {
      const ok = isValid();
      deleteBtn.disabled = !ok;
      if (ok) error.textContent = '';
    };

    input.addEventListener('input', sync);

    // Prevent Enter from acting like "confirm"; Enter focuses the delete button
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      ev.stopPropagation();

      if (!isValid()) {
        error.textContent = 'Type DELETE to confirm.';
        return;
      }

      try {
        deleteBtn.focus();
      } catch {
        // ignore
      }
    });

    const runConfirm = () => {
      // Validate intent: require typed DELETE even on click
      if (!isValid()) {
        error.textContent = 'Type DELETE to confirm.';
        return;
      }

      // Do not call Edge Functions while offline
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        error.textContent = 'You are offline. Reconnect to delete your account.';
        return;
      }

      cleanup();
      try {
        onConfirm && onConfirm();
      } catch {
        // ignore
      }
    };

    closeBtn.addEventListener('click', cleanup);
    cancelBtn.addEventListener('click', cleanup);
    deleteBtn.addEventListener('click', runConfirm);

    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) cleanup();
    });

    escapeHandler = ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cleanup();
      }
    };
    doc.addEventListener('keydown', escapeHandler, true);

    const root = doc.getElementById('modal-root');
    if (root) root.appendChild(overlay);
    else doc.body.appendChild(overlay);

    // focus
    setTimeout(() => {
      try {
        input.focus();
      } catch {
        // ignore
      }
    }, 0);
  }

  async function render() {
    if (!accountModal) return;

    // Epoch guard: capture request ID before async work
    const thisRequestId = ++renderRequestId;

    const userView = await getCurrentUserView();

    // Stale check: if another render started, discard this result
    if (thisRequestId !== renderRequestId) return;

    accountModal.innerHTML = '';

    const header = doc.createElement('div');
    header.className = 'row space-between';
    header.classList.add('tp3d-settings-right-header');

    const headerText = doc.createElement('div');
    headerText.classList.add('tp3d-settings-right-text');

    const title = doc.createElement('div');
    title.classList.add('tp3d-settings-right-title');
    title.textContent = 'Account';

    const helper = doc.createElement('div');
    helper.classList.add('tp3d-settings-right-subtitle');
    helper.classList.add('muted');
    helper.textContent = 'Manage your profile and workspace identity.';

    headerText.appendChild(title);
    headerText.appendChild(helper);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());

    header.appendChild(headerText);
    header.appendChild(closeBtn);
    accountModal.appendChild(header);

    const body = doc.createElement('div');
    body.classList.add('tp3d-settings-right-body');
    accountModal.appendChild(body);

    const nameRow = doc.createElement('div');
    nameRow.className = 'row';
    nameRow.classList.add('tp3d-settings-account-row');
    nameRow.innerHTML = `<span class="brand-mark tp3d-settings-account-avatar-lg" aria-hidden="true">${userView.initials || ''}</span>
      <div class="tp3d-settings-account-display">${userView.displayName || '—'}</div>`;
    body.appendChild(nameRow);

    const emailEl = doc.createElement('div');
    emailEl.textContent = userView.isAuthed && userView.email ? userView.email : 'Not signed in';
    body.appendChild(row('Email', emailEl));

    const avatarRow = doc.createElement('div');
    avatarRow.classList.add('tp3d-settings-row');

    const avatarLabel = doc.createElement('div');
    avatarLabel.classList.add('tp3d-settings-row-label');
    avatarLabel.textContent = 'Avatar';

    const avatarRight = doc.createElement('div');
    avatarRight.style.display = 'flex';
    avatarRight.style.flexDirection = 'column';
    avatarRight.style.gap = '6px';

    const avatarInput = doc.createElement('input');
    avatarInput.type = 'file';
    avatarInput.accept = 'image/jpeg,image/png,image/webp';
    avatarInput.disabled = !userView.isAuthed;

    const avatarHint = doc.createElement('div');
    avatarHint.className = 'muted';
    avatarHint.textContent = userView.isAuthed ? 'Upload a JPG, PNG, or WebP.' : 'Sign in to upload an avatar.';

    avatarInput.addEventListener('change', async e => {
      const inputEl = /** @type {HTMLInputElement|null} */ (e && e.target ? e.target : null);
      const file = inputEl && inputEl.files ? inputEl.files[0] : null;
      if (!file) return;
      const user = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
      if (!user) return;

      try {
        avatarInput.disabled = true;

        const ext =
          String(file.name || '')
            .split('.')
            .pop() || 'png';
        const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const filePath = `${user.id}/avatar.${safeExt}`;

        const client =
          SupabaseClient && typeof SupabaseClient.getClient === 'function' ? SupabaseClient.getClient() : null;
        if (!client || !client.storage) throw new Error('Storage not available');

        const { error: uploadErr } = await client.storage.from('avatars').upload(filePath, file, { upsert: true });
        if (uploadErr) throw uploadErr;

        const { data } = client.storage.from('avatars').getPublicUrl(filePath);
        const publicUrl = data && data.publicUrl ? data.publicUrl : '';

        if (publicUrl && SupabaseClient && typeof SupabaseClient.updateProfile === 'function') {
          await SupabaseClient.updateProfile({ avatar_url: publicUrl });
        }
      } catch (err) {
        console.warn('Avatar upload failed:', err && err.message ? err.message : err);
      } finally {
        avatarInput.disabled = !userView.isAuthed;
        render();
      }
    });

    avatarRight.appendChild(avatarInput);
    avatarRight.appendChild(avatarHint);

    avatarRow.appendChild(avatarLabel);
    avatarRow.appendChild(avatarRight);
    body.appendChild(avatarRow);

    const danger = doc.createElement('div');
    danger.classList.add('tp3d-settings-danger');
    danger.innerHTML = `
      <div class="tp3d-settings-danger-title">Danger Zone</div>
      <div class="tp3d-settings-danger-divider"></div>
    `;

    const dangerRow = doc.createElement('div');
    dangerRow.classList.add('tp3d-settings-danger-row');

    const dLeft = doc.createElement('div');
    dLeft.classList.add('tp3d-settings-danger-left');
    dLeft.textContent = 'Delete Account';

    const dRight = doc.createElement('div');
    dRight.classList.add('tp3d-settings-danger-right');

    const delBtn = doc.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete account';
    delBtn.disabled = !userView.isAuthed;

    delBtn.addEventListener('click', async () => {
      if (!userView.isAuthed) return;

      showDeleteAccountConfirmModal({
        email: userView.email || '',
        onConfirm: async () => {
          try {
            // Request deletion (sets status, bans user)
            await SupabaseClient.requestAccountDeletion();

            // Sign out (allowOffline keeps UI safe if the network drops mid-flow)
            try {
              await SupabaseClient.signOut({ global: true, allowOffline: true });
            } catch {
              // ignore
            }

            // Avoid hard redirect to `/` (can show directory listing in local dev).
            // Reload is enough: app bootstrap + tp3d:auth-signed-out will handle UI.
            try {
              close();
            } catch {
              // ignore
            }
            window.location.reload();
          } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (UIComponents && typeof UIComponents.showToast === 'function') {
              UIComponents.showToast(`Delete request failed: ${msg}`, 'error');
            } else {
              console.error('[AccountOverlay] Delete request failed:', msg);
            }
          }
        },
      });
    });

    const dMsg = doc.createElement('div');
    dMsg.className = 'muted';
    dMsg.classList.add('tp3d-settings-danger-msg');

    const warnIcon = doc.createElement('i');
    warnIcon.className = 'fa-solid fa-triangle-exclamation';
    warnIcon.setAttribute('aria-hidden', 'true');
    warnIcon.classList.add('tp3d-settings-danger-warn-icon');

    const warnText = doc.createElement('span');
    warnText.textContent = 'This action is permanent and cannot be undone.';

    dMsg.appendChild(warnIcon);
    dMsg.appendChild(warnText);

    dRight.appendChild(delBtn);
    dRight.appendChild(dMsg);

    dangerRow.appendChild(dLeft);
    dangerRow.appendChild(dRight);

    danger.appendChild(dangerRow);
    body.appendChild(danger);
  }

  function open() {
    if (accountOverlay) {
      render();
      return;
    }

    const activeEl = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    lastFocusedEl = activeEl && typeof activeEl.focus === 'function' ? activeEl : null;

    accountOverlay = doc.createElement('div');
    accountOverlay.className = 'modal-overlay';

    accountModal = doc.createElement('div');
    accountModal.className = 'modal tp3d-settings-modal';
    accountModal.style.display = 'flex';
    accountModal.style.flexDirection = 'column';
    accountModal.setAttribute('role', 'dialog');
    accountModal.setAttribute('aria-modal', 'true');
    accountModal.setAttribute('tabindex', '-1');

    accountOverlay.appendChild(accountModal);

    accountOverlay.addEventListener('click', ev => {
      if (ev.target === accountOverlay) close();
    });

    trapKeydownHandler = ev => {
      if (ev.key === 'Escape') {
        close();
        return;
      }

      if (ev.key !== 'Tab') return;
      if (!accountModal) return;

      const focusables = Array.from(
        accountModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

      if (!focusables.length) {
        ev.preventDefault();
        accountModal.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc.activeElement;

      if (ev.shiftKey) {
        if (active === first || active === accountModal) {
          ev.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        ev.preventDefault();
        first.focus();
      }
    };

    doc.addEventListener('keydown', trapKeydownHandler, true);

    const root = doc.getElementById('modal-root');
    if (root) {
      root.appendChild(accountOverlay);
    } else {
      if (!warnedMissingModalRoot) {
        console.warn('Account overlay: #modal-root not found, falling back to document.body');
        warnedMissingModalRoot = true;
      }
      doc.body.appendChild(accountOverlay);
    }

    doc.body.classList.add('modal-open');

    accountOverlay._tp3dCleanup = () => {
      if (trapKeydownHandler) {
        doc.removeEventListener('keydown', trapKeydownHandler, true);
      }
    };

    void render();

    const focusTarget = /** @type {HTMLElement|null} */ (
      accountModal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    (focusTarget || accountModal).focus();
  }

  function handleAuthChange(_event) {
    if (_event === 'SIGNED_OUT') {
      cachedUserView = null;
      cachedUserViewAt = 0;
      lastKnownUserId = null;
      return;
    }
    try {
      const u = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
      const currentUserId = u && u.id ? String(u.id) : null;
      if (currentUserId && lastKnownUserId && currentUserId !== lastKnownUserId) {
        cachedUserView = null;
        cachedUserViewAt = 0;
      }
      if (currentUserId) lastKnownUserId = currentUserId;
    } catch {
      // ignore
    }
    // Bump render request ID to invalidate any in-flight renders with stale data
    renderRequestId++;

    if (isOpen()) {
      void render();
    }
  }

  return { open, close, isOpen, render, handleAuthChange };
}
