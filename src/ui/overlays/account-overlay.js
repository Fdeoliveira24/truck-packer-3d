/**
 * @file account-overlay.js
 * @updated 01/30/2026
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

  function showDeleteConfirmationModal(userEmail, onConfirm) {
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';

    const modal = doc.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const header = doc.createElement('div');
    header.className = 'modal-header';
    const title = doc.createElement('h2');
    title.textContent = 'Request Account Deletion';
    header.appendChild(title);

    const body = doc.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '20px';

    const msgBlock = doc.createElement('p');
    msgBlock.textContent = 'User will no longer have access to the project.';
    body.appendChild(msgBlock);

    const p0 = doc.createElement('p');
    p0.style.fontWeight = '600';
    p0.textContent = 'Confirm to delete user';
    body.appendChild(p0);

    const p1 = doc.createElement('p');
    p1.textContent = 'Deleting a user is irreversible.';
    body.appendChild(p1);

    const p2 = doc.createElement('p');
    p2.textContent = 'This will remove the selected user from the project and all associated data.';
    body.appendChild(p2);

    const p3 = doc.createElement('p');
    p3.style.marginTop = '12px';
    p3.style.fontWeight = '600';
    p3.innerHTML = `This is permanent! Are you sure you want to delete the user <strong>${userEmail || 'unknown'}</strong>?`;
    body.appendChild(p3);

    const p4 = doc.createElement('p');
    p4.style.marginTop = '16px';
    p4.textContent = 'Type DELETE.';
    body.appendChild(p4);

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.placeholder = 'DELETE';
    input.style.marginTop = '8px';
    body.appendChild(input);

    const inlineErr = doc.createElement('div');
    inlineErr.className = 'muted';
    inlineErr.style.marginTop = '12px';
    inlineErr.style.color = 'var(--error)';
    inlineErr.style.display = 'none';
    body.appendChild(inlineErr);

    const footer = doc.createElement('div');
    footer.className = 'modal-footer';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.style.marginTop = '20px';

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';

    const deleteBtn = doc.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete Account';
    deleteBtn.disabled = true;

    footer.appendChild(cancelBtn);
    footer.appendChild(deleteBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    input.addEventListener('input', () => {
      inlineErr.style.display = 'none';
      deleteBtn.disabled = input.value !== 'DELETE';
    });

    const cleanup = () => {
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {
        // ignore
      }
      try {
        doc.body.classList.remove('modal-open');
      } catch {
        // ignore
      }
    };

    cancelBtn.addEventListener('click', cleanup);

    overlay.addEventListener('click', ev => {
      if (ev.target === overlay) cleanup();
    });

    deleteBtn.addEventListener('click', () => {
      // Offline guard: do not call Edge Function while offline — show friendly message
      try {
        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
          inlineErr.textContent = 'Unable to delete account while offline. Please reconnect and try again.';
          inlineErr.style.display = 'block';
          // Ensure button is enabled again for retry
          deleteBtn.disabled = false;
          return;
        }
      } catch (e) {
        // If navigator check fails for some reason, proceed as normal
      }

      cleanup();
      onConfirm();
    });

    const handleEscape = ev => {
      if (ev.key === 'Escape') {
        cleanup();
        doc.removeEventListener('keydown', handleEscape, true);
      }
    };
    doc.addEventListener('keydown', handleEscape, true);

    const root = doc.getElementById('modal-root');
    if (root) {
      root.appendChild(overlay);
    } else {
      doc.body.appendChild(overlay);
    }

    doc.body.classList.add('modal-open');
    input.focus();
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
    nameRow.innerHTML = `<span class="brand-mark tp3d-settings-account-avatar-lg" aria-hidden="true">${
      userView.initials || ''
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
    avatarRight.className = 'tp3d-account-avatar-right';
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
        const ext = String(file.name || '').split('.').pop() || 'png';
        const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const filePath = `${user.id}/avatar.${safeExt}`;
        const client = SupabaseClient && typeof SupabaseClient.getClient === 'function' ? SupabaseClient.getClient() : null;
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

      showDeleteConfirmationModal(userView.email, async () => {
        try {
          await SupabaseClient.requestAccountDeletion();

          try {
            await SupabaseClient.signOut({ global: true, allowOffline: true });
          } catch {
            // Ignore - local state cleared anyway
          }

          close();

          try {
            window.location.reload();
          } catch {
            window.location.reload();
          }
        } catch (err) {
          alert(`Delete request failed: ${err && err.message ? err.message : String(err)}`);
        }
      });
    });
    dRight.appendChild(delBtn);
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
    accountModal.className = 'modal tp3d-settings-modal tp3d-account-overlay-modal';
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