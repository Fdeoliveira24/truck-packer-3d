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

export function createSystemOverlay() {
  const overlay = document.getElementById('system-overlay');
  const titleEl = document.getElementById('system-title');
  const messageEl = document.getElementById('system-message');
  const listEl = document.getElementById('system-list');
  const retryBtn = document.getElementById('system-retry');
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
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove('active');
  }

  return { show, hide };
}
