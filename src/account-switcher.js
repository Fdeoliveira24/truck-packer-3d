/**
 * @file account-switcher.js
 * @description AccountSwitcher UI (Stage 5 extraction from app.js): the bottom-left
 * workspace chip rendering plus the account/workspace dropdown menu and its interaction
 * lifecycle. This module owns presentation and user interaction only. Domain actions —
 * workspace switch, sign-out, open settings/account, create workspace — are forwarded to
 * narrow injected callbacks; the app / domain services still own the consequences.
 *
 * Public API (unchanged from the former inline object): { init, bind, refresh }.
 *   - init():   bind the sidebar switcher button (#btn-account-switcher).
 *   - bind(buttonEl, { align }): mount the switcher on a button; returns an unmount fn.
 *   - refresh(): re-render every mounted button (e.g. after org/session change).
 *
 * Listener lifecycle: exactly one click listener + one SessionManager subscription per
 * mounted button, tracked in `mounts` and released by the returned unmount fn. Idempotent
 * per button (a second bind of the same element returns the existing unmount).
 *
 * Side-effect-free on import.
 * @module account-switcher
 */

export function createAccountSwitcher({
  documentRef,
  UIComponents,
  SessionManager,
  getOrgContext,
  isOrgContextResolved,
  isOrgContextInFlight,
  getAuthRehydratePromise,
  getSidebarAvatarView,
  getActiveWorkspaceInitials,
  renderSidebarBrandMarks,
  closeDropdowns,
  openSettingsOverlay,
  openCreateWorkspaceFlow,
  setActiveOrgId,
  performUserInitiatedLogout,
}) {
  let anchorKeyCounter = 0;
  const mounts = new Map();

  function getDisplay() {
    // Injected getters aliased to the original app.js free-variable names so the display
    // logic below stays behavior-identical (and source-audit-stable). All reads are
    // synchronous within this call, so snapshotting here matches the prior inline reads.
    const orgContext = getOrgContext();
    const orgContextResolved = isOrgContextResolved();
    const orgContextInFlight = isOrgContextInFlight();
    const authRehydratePromise = getAuthRehydratePromise();
    const view = getSidebarAvatarView();
    const isAuthed = Boolean(view && view.isAuthed);
    const displayName = (view && view.displayName) || (isAuthed ? 'User' : 'Guest');
    const activeOrg = orgContext && orgContext.activeOrg ? orgContext.activeOrg : null;
    const activeOrgs = orgContext && Array.isArray(orgContext.orgs) ? orgContext.orgs : [];
    const noActiveWorkspace = Boolean(isAuthed && !activeOrg && orgContextResolved && activeOrgs.length === 0);
    // Show 'Loading…' instead of generic 'Workspace' when user is authed
    // but org context hasn't arrived yet (cross-tab boot gap).
    const orgHydrating = Boolean(
      isAuthed && !activeOrg && !orgContextResolved && (orgContextInFlight || authRehydratePromise)
    );
    const accountName = activeOrg && activeOrg.name
      ? activeOrg.name
      : noActiveWorkspace
        ? 'No workspace'
        : (orgHydrating ? 'Loading…' : 'Workspace');
    const role =
      (orgContext && orgContext.role ? String(orgContext.role) : null) ||
      (activeOrg && activeOrg.role ? String(activeOrg.role) : null) ||
      (noActiveWorkspace ? 'No active workspace' : null) ||
      (isAuthed ? 'Owner' : 'Guest');

    return {
      accountName,
      role,
      userName: noActiveWorkspace ? 'Create or join' : displayName || '—',
      orgInitials: noActiveWorkspace ? '' : getActiveWorkspaceInitials(),
      initials: (view && view.initials) || '',
    };
  }

  function renderButton(buttonEl) {
    if (!buttonEl) return;
    const display = getDisplay();
    const avatarEl = buttonEl.querySelector('.brand-mark');
    if (avatarEl) avatarEl.textContent = display.orgInitials || '';
    const nameEl = buttonEl.querySelector('[data-account-name]');
    if (nameEl) nameEl.textContent = display.userName;
    const orgNameEl = buttonEl.querySelector('[data-org-name]');
    if (orgNameEl) orgNameEl.textContent = display.accountName;
    renderSidebarBrandMarks();
  }

  function _showComingSoon() {
    UIComponents.showToast('Coming soon', 'info');
  }

  function createWorkspacePrompt() {
    openCreateWorkspaceFlow({ source: 'account-switcher' });
  }

  function switchWorkspace(orgId, { source = 'account-switcher' } = {}) {
    return setActiveOrgId(String(orgId), { source }).catch(err => {
      console.error('[AccountSwitcher] Failed to switch workspace:', err);
      UIComponents.showToast(
        err && err.message ? String(err.message) : 'Failed to switch workspace.',
        'error'
      );
    });
  }

  async function logout() {
    await performUserInitiatedLogout({ source: 'account-switcher' });
  }

  function getAnchorKey(anchorEl) {
    if (!anchorEl) return '';
    if (!anchorEl.dataset.accountSwitcherKey) {
      anchorEl.dataset.accountSwitcherKey = `account-switcher-${++anchorKeyCounter}`;
    }
    return anchorEl.dataset.accountSwitcherKey;
  }

  /**
   * @param {HTMLElement} anchorEl
   * @param {{ align?: string }} [opts]
   */
  function openMenu(anchorEl, { align } = {}) {
    const display = getDisplay();
    const orgContext = getOrgContext();
    const anchorKey = getAnchorKey(anchorEl);
    const existingDropdown = /** @type {HTMLElement|null} */ (
      documentRef.querySelector('[data-dropdown="1"][data-role="account-switcher"]')
    );
    if (existingDropdown && existingDropdown.dataset.anchorId === anchorKey) {
      closeDropdowns();
      return;
    }
    closeDropdowns();
    const allOrgs = orgContext && Array.isArray(orgContext.orgs) ? orgContext.orgs : [];
    const activeOrgId = orgContext && orgContext.activeOrgId ? String(orgContext.activeOrgId) : '';
    const otherOrgs = allOrgs.filter(o => o && o.id && String(o.id) !== activeOrgId);
    const items = [
      {
        label: `${display.accountName} (${display.role})`,
        icon: 'fa-regular fa-user',
        rightIcon: 'fa-solid fa-check',
        disabled: true,
      },
      ...otherOrgs.map(o => ({
        label: o.name || 'Workspace',
        icon: 'fa-solid fa-building',
        onClick: () => void switchWorkspace(String(o.id), { source: 'account-switcher' }),
      })),
      {
        label: 'New Workspace',
        icon: 'fa-solid fa-plus',
        onClick: () => createWorkspacePrompt(),
      },
      { type: 'divider' },
      {
        label: 'Account',
        icon: 'fa-regular fa-user',
        onClick: () => openSettingsOverlay('account'),
      },
      {
        label: 'Settings',
        icon: 'fa-solid fa-gear',
        onClick: () => openSettingsOverlay(),
      },
      {
        label: 'Log out',
        icon: 'fa-solid fa-right-from-bracket',
        onClick: () => void logout(),
      },
    ];

    const rect = anchorEl.getBoundingClientRect();
    UIComponents.openDropdown(anchorEl, items, {
      align: align || 'left',
      width: rect.width,
      role: 'account-switcher',
      anchorKey,
    });
  }

  /**
   * @param {HTMLElement} buttonEl
   * @param {{ align?: string }} [opts]
   */
  function bind(buttonEl, { align } = {}) {
    if (!buttonEl) return () => { };
    if (mounts.has(buttonEl)) return mounts.get(buttonEl);

    renderButton(buttonEl);
    const onClick = ev => {
      ev.stopPropagation();
      openMenu(buttonEl, { align });
    };
    buttonEl.addEventListener('click', onClick);
    const unsub = SessionManager.subscribe(() => renderButton(buttonEl));

    const unmount = () => {
      try {
        unsub && unsub();
      } catch {
        // ignore
      }
      buttonEl.removeEventListener('click', onClick);
      mounts.delete(buttonEl);
    };
    mounts.set(buttonEl, unmount);
    return unmount;
  }

  function initAccountSwitcher() {
    const sidebarBtn = documentRef.getElementById('btn-account-switcher');
    bind(sidebarBtn, { align: 'left' });
  }

  function refreshAll() {
    mounts.forEach((_, buttonEl) => {
      renderButton(buttonEl);
    });
  }

  return { init: initAccountSwitcher, bind, refresh: refreshAll };
}
