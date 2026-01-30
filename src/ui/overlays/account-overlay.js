/**
 * @file account-overlay.js
 * @description Dedicated overlay for viewing account details outside of the Settings modal.
 * @module ui/overlays/account-overlay
 */

import { getUserAvatarView } from '../../core/utils/index.js';

export function createAccountOverlay({ documentRef = document, SupabaseClient }) {
  const doc = documentRef;

  let accountOverlay = null;
  let accountModal = null;
  let trapKeydownHandler = null;
  let lastFocusedEl = null;
  let warnedMissingModalRoot = false;

  async function getCurrentUserView() {
    let user = null;
    let profile = null;

    try {
      user = SupabaseClient && typeof SupabaseClient.getUser === 'function' ? SupabaseClient.getUser() : null;
      if (user && SupabaseClient && typeof SupabaseClient.getProfile === 'function') {
        profile = await SupabaseClient.getProfile(user.id);
      }
    } catch {
      profile = null;
    }

    return getUserAvatarView({ user, profile });
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

  async function render() {
    if (!accountModal) return;

    const userView = await getCurrentUserView();

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
    nameRow.innerHTML = `<span class="brand-mark tp3d-settings-account-avatar-lg" aria-hidden="true">${userView.initials || ''
      }</span><div class="tp3d-settings-account-display">${userView.displayName || '—'}</div>`;
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
      const file = e && e.target && e.target.files ? e.target.files[0] : null;
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

        const { error } = await client.storage.from('avatars').upload(filePath, file, { upsert: true });
        if (error) throw error;

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

      // Updated confirmation without "30 days" mention
      if (
        !confirm(
          'You are requesting account deletion. You will be signed out and access will be disabled immediately.\n\nThis action cannot be undone.\n\nAre you sure?'
        )
      ) {
        return;
      }

      try {
        // Call Supabase helper to request deletion (sets status, bans user)
        await SupabaseClient.requestAccountDeletion();

        // Sign out globally and redirect to login/root so the auth overlay can show disabled state
        try {
          await SupabaseClient.signOut({ global: true });
        } catch {
          // ignore
        }
        try {
          window.location.href = '/';
        } catch {
          window.location.reload();
        }
      } catch (err) {
        alert(`Delete request failed: ${err && err.message ? err.message : err}`);
      }
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

    lastFocusedEl = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

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

    const focusTarget = accountModal.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusTarget || accountModal).focus();
  }

  function handleAuthChange() {
    if (isOpen()) {
      void render();
    }
  }

  return { open, close, isOpen, render, handleAuthChange };
}
