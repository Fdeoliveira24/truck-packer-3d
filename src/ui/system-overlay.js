/**
 * @file system-overlay.js
 * @description System-level overlay UI for fatal/runtime failures (missing dependencies, startup errors).
 * @module ui/system-overlay
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { BLOCKER_PRIORITY, syncTerminalStacking } from './error-overlay.js';

/** @param {{ UIComponents?: any }} [options] */
export function createSystemOverlay({ UIComponents } = {}) {
  const overlay = document.getElementById('system-overlay');
  const titleEl = document.getElementById('system-title');
  const messageEl = document.getElementById('system-message');
  const listEl = document.getElementById('system-list');
  const retryBtn = document.getElementById('system-retry');
  const cardEl = overlay ? overlay.querySelector('.system-card') : null;
  let owner = null;
  if (retryBtn) retryBtn.addEventListener('click', () => window.location.reload());

  function show({ title, message, items }) {
    if (!overlay) return;
    if (titleEl) titleEl.textContent = title || 'Truck Packer 3D';
    if (messageEl) messageEl.textContent = message || '';
    if (listEl) {
      listEl.innerHTML = '';
      (items || []).forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        listEl.appendChild(li);
      });
    }
    overlay.classList.add('active');
    if (owner) {
      // Same owner and order: repair focus only while this blocker is the
      // active owner (shared focus refuses otherwise), never re-stack.
      owner.ensureFocus();
      return;
    }
    // Terminal runtime blocker: one owner, never dismissible, and no return to
    // whatever happened to be focused before the failure.
    owner = UIComponents?.modalOwnership?.register({
      kind: 'system', element: overlay, parentId: null, priority: BLOCKER_PRIORITY.terminal,
      focusRoot: cardEl, initialFocus: () => retryBtn, canDismiss: () => false,
      restoreFocus: false,
    }) || null;
    syncTerminalStacking(overlay, owner);
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove('active');
    syncTerminalStacking(overlay);
    owner?.release({ restoreFocus: false });
    owner = null;
  }

  return { show, hide };
}
