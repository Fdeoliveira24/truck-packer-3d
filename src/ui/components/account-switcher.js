/**
 * @file account-switcher.js
 * @description Account switcher component for switching between personal and organization contexts.
 * @module ui/components/account-switcher
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { clearSession, getSession, setCurrentOrgId, subscribeSession } from '../../auth/session.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, String(v));
  });
  children.forEach(c => node.appendChild(c));
  return node;
}

export function mountAccountSwitcher({ buttonEl, ui, onOrgChange, onSettings, onLogout }) {
  if (!buttonEl) return () => {};
  const openDropdown = ui && ui.openDropdown ? ui.openDropdown : null;
  const showModal = ui && ui.showModal ? ui.showModal : null;
  const showToast = ui && ui.showToast ? ui.showToast : null;

  function renderLabel() {
    const session = getSession();
    const org = session.currentOrg || null;
    const name = org && org.name ? org.name : 'Account';
    const role = org && org.role ? org.role : '';
    buttonEl.querySelector('[data-account-label]').textContent = role ? `${name} (${role})` : name;
  }

  function open() {
    if (!openDropdown) return;
    const session = getSession();
    const currentId = session.user && session.user.currentOrgId ? session.user.currentOrgId : null;
    const orgs = Array.isArray(session.orgs) ? session.orgs : [];
    const current = session.currentOrg || orgs.find(o => o.id === currentId) || orgs[0] || null;
    const currentRole = current && current.role ? current.role : 'Owner';

    const items = [
      ...orgs.map(org => ({
        label: org.id === currentId ? `${org.name} (${currentRole})` : `${org.name}`,
        icon: 'fa-regular fa-user',
        rightIcon: org.id === currentId ? 'fa-solid fa-check' : '',
        onClick: () => {
          try {
            onOrgChange && onOrgChange({ phase: 'before', nextOrgId: org.id, previousOrgId: currentId });
            setCurrentOrgId(org.id);
            onOrgChange && onOrgChange({ phase: 'after', nextOrgId: org.id, previousOrgId: currentId });
            showToast && showToast(`Switched to ${org.name}`, 'success');
          } catch (err) {
            showToast && showToast(err.message, 'error');
          }
        },
      })),
      {
        label: 'Create Organization',
        icon: 'fa-solid fa-plus',
        onClick: () => {
          if (showModal) {
            showModal({
              title: 'Create Organization',
              content: el('div', { className: 'muted', text: 'Coming soon' }),
              actions: [{ label: 'Close', variant: 'primary' }],
            });
            return;
          }
          showToast && showToast('Coming soon', 'info');
        },
      },
      { type: 'divider' },
      {
        label: 'Settings',
        icon: 'fa-solid fa-gear',
        onClick: () => {
          if (typeof onSettings === 'function') {
            onSettings('preferences');
            return;
          }
          showToast && showToast('Settings not available', 'warning');
        },
      },
      {
        label: 'Log out',
        icon: 'fa-solid fa-right-from-bracket',
        onClick: () => {
          clearSession();
          if (typeof onLogout === 'function') {
            onLogout();
            return;
          }
          try {
            window.location.hash = '#/packs';
          } catch {
            // ignore
          }
          showToast && showToast('Logged out', 'info');
        },
      },
    ];

    const rect = buttonEl.getBoundingClientRect();
    openDropdown(buttonEl, items, { align: 'left', width: rect.width });
  }

  const onClick = () => open();
  buttonEl.addEventListener('click', onClick);

  renderLabel();
  const unsub = subscribeSession(() => renderLabel());

  return () => {
    unsub && unsub();
    buttonEl.removeEventListener('click', onClick);
  };
}
