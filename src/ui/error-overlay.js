/**
 * @file error-overlay.js
 * @description App-state error overlay for 404 (route/pack), 500 (fatal), and maintenance.
 *   This is separate from system-overlay.js which handles vendor/platform support failures.
 *   Safe to call before or after app boot — binds to static DOM roots in index.html.
 * @module ui/error-overlay
 * @created 2026-04-19
 */

/**
 * Shared-registry precedence for specialized blockers. Auth registers at 2
 * (auth-overlay.js); ordinary modals default to 0.
 * terminal (System, fatal, maintenance) > auth > recoverable (route, missing Pack).
 */
export const BLOCKER_PRIORITY = Object.freeze({ recoverable: 1, auth: 2, terminal: 3 });

// styles/main.css paints terminal roots at this base (above Auth's 99999),
// which also covers the pre-boot overlay before shared ownership exists.
const TERMINAL_Z_INDEX = 100000;

/**
 * Equal-priority terminal blockers resolve by registration order in the
 * shared registry; paint in that same order. Pass no owner to clear.
 * @param {HTMLElement | null} element
 * @param {{ order: number } | null} [owner]
 */
export function syncTerminalStacking(element, owner = null) {
  if (!element) return;
  element.style.zIndex = owner ? String(TERMINAL_Z_INDEX + owner.order) : '';
}

// The root's data-error-mode is the semantic mode, also written by the
// pre-boot renderer in index.html so the handoff never infers it from text.
const TERMINAL_MODES = new Set(['fatal', 'maintenance']);
const RECOVERABLE_MODES = new Set(['route', 'pack']);

/** @param {{ UIComponents?: any }} [options] */
export function createErrorOverlay({ UIComponents } = {}) {
  const overlay = document.getElementById('error-overlay');
  const titleEl = document.getElementById('error-title');
  const bodyEl = document.getElementById('error-body');
  const actionsEl = document.getElementById('error-actions');
  const iconEl = document.getElementById('error-icon');
  const cardEl = overlay ? overlay.querySelector('.error-card') : null;

  let _onBackToPacks = null;
  let owner = null;
  let ownerTier = null;

  function getMode() {
    const mode = overlay?.getAttribute('data-error-mode');
    return TERMINAL_MODES.has(mode) || RECOVERABLE_MODES.has(mode) ? mode : null;
  }

  function isTerminal() {
    return TERMINAL_MODES.has(getMode());
  }

  // Also called by the pre-boot renderer when it displays this shared root.
  // Keeps exactly one owner whose tier matches the root's current mode.
  function registerPresence() {
    if (!overlay || !overlay.classList.contains('active')) return;
    const mode = getMode();
    // A visible root without a recognized mode is only ever the pre-boot fatal path.
    const tier = RECOVERABLE_MODES.has(mode) ? 'recoverable' : 'terminal';
    if (owner && ownerTier === tier) {
      // Same tier: content may have been replaced under the focused control.
      owner.ensureFocus();
      return;
    }
    const previous = owner;
    // Acquire the new tier before releasing the old one so the background
    // never unlocks between them.
    owner = UIComponents?.modalOwnership?.register({
      kind: 'error', element: overlay, parentId: null, priority: BLOCKER_PRIORITY[tier],
      focusRoot: cardEl,
      initialFocus: () => actionsEl?.querySelector('button') || null,
      canDismiss: () => false,
      restoreFocus: false,
    }) || null;
    ownerTier = owner ? tier : null;
    syncTerminalStacking(overlay, tier === 'terminal' ? owner : null);
    previous?.release({ restoreFocus: false });
  }

  function _btn(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _render(mode, title, body, buttons, { iconVariant = 'warn', iconClass = 'fa-circle-question' } = {}) {
    if (!overlay) return;
    overlay.setAttribute('data-error-mode', mode);
    if (iconEl) {
      iconEl.className = `error-icon error-icon--${iconVariant}`;
      iconEl.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i>`;
    }
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (actionsEl) {
      actionsEl.innerHTML = '';
      buttons.forEach(b => actionsEl.appendChild(b));
    }
    overlay.classList.add('active');
    registerPresence();
  }

  function showNotFound({ kind = 'route' } = {}) {
    // A recoverable state never downgrades an active fatal/maintenance blocker.
    if (isVisible() && isTerminal()) return;
    const isPack = kind === 'pack';
    _render(
      isPack ? 'pack' : 'route',
      isPack ? 'Load plan not found' : 'Page not found',
      isPack
        ? 'This load plan is missing, deleted, or no longer available.'
        : 'The page you tried to open does not exist.',
      [_btn('Back to Load Plans', () => {
        hide();
        if (_onBackToPacks) _onBackToPacks();
      })],
      { iconVariant: 'warn', iconClass: 'fa-triangle-exclamation' }
    );
  }

  function showFatal(opts = {}) {
    /** @type {{ message?: string } | null} */
    const config = opts && typeof opts === 'object' ? opts : null;
    const message = config && typeof config.message === 'string' ? config.message : '';
    _render(
      'fatal',
      'Something went wrong',
      message || 'An unexpected error stopped the app from loading correctly.',
      [_btn('Reload', () => window.location.reload())],
      { iconVariant: 'danger', iconClass: 'fa-triangle-exclamation' }
    );
  }

  function showMaintenance() {
    _render(
      'maintenance',
      "We'll be back soon",
      'Truck Packer 3D is temporarily unavailable while we perform maintenance. Please try again soon.',
      [_btn('Reload', () => window.location.reload())],
      { iconVariant: 'info', iconClass: 'fa-clock' }
    );
  }

  /**
   * Hide the recoverable (route / missing Pack) state. Recovery cleanup paths
   * call this freely, so a terminal fatal/maintenance state is left in place
   * unless `includeTerminal` is passed explicitly.
   * @param {{ includeTerminal?: boolean }} [options]
   */
  function hide({ includeTerminal = false } = {}) {
    if (!overlay) return;
    if (isTerminal() && !includeTerminal) return;
    overlay.classList.remove('active');
    overlay.removeAttribute('data-error-mode');
    syncTerminalStacking(overlay);
    const previous = owner;
    owner = null;
    ownerTier = null;
    previous?.release({ restoreFocus: false });
  }

  function isVisible() {
    return overlay ? overlay.classList.contains('active') : false;
  }

  /**
   * Set the callback invoked when the user clicks "Back to Load Plans" on a 404 overlay.
   * Called by app.js after navigation is wired.
   * @param {() => void} fn
   */
  function setOnBackToPacks(fn) {
    _onBackToPacks = fn;
  }

  return { showNotFound, showFatal, showMaintenance, hide, isVisible, getMode, setOnBackToPacks, registerPresence };
}
