/**
 * @file error-overlay.js
 * @description App-state error overlay for 404 (route/pack), 500 (fatal), and maintenance.
 *   This is separate from system-overlay.js which handles vendor/platform support failures.
 *   Safe to call before or after app boot — binds to static DOM roots in index.html.
 * @module ui/error-overlay
 * @created 2026-04-19
 */

export function createErrorOverlay() {
  const overlay = document.getElementById('error-overlay');
  const titleEl = document.getElementById('error-title');
  const bodyEl = document.getElementById('error-body');
  const actionsEl = document.getElementById('error-actions');
  const iconEl = document.getElementById('error-icon');

  let _onBackToPacks = null;

  function _btn(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _render(title, body, buttons, { iconVariant = 'warn', iconClass = 'fa-circle-question' } = {}) {
    if (!overlay) return;
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
  }

  function showNotFound({ kind = 'route' } = {}) {
    const isPack = kind === 'pack';
    _render(
      isPack ? 'Pack not found' : 'Page not found',
      isPack
        ? 'This pack is missing, deleted, or no longer available.'
        : 'The page you tried to open does not exist.',
      [_btn('Back to Packs', () => {
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
      'Something went wrong',
      message || 'An unexpected error stopped the app from loading correctly.',
      [_btn('Reload', () => window.location.reload())],
      { iconVariant: 'danger', iconClass: 'fa-triangle-exclamation' }
    );
  }

  function showMaintenance() {
    _render(
      "We'll be back soon",
      'Truck Packer 3D is temporarily unavailable while maintenance is in progress.',
      [_btn('Reload', () => window.location.reload())],
      { iconVariant: 'info', iconClass: 'fa-clock' }
    );
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove('active');
  }

  function isVisible() {
    return overlay ? overlay.classList.contains('active') : false;
  }

  /**
   * Set the callback invoked when the user clicks "Back to Packs" on a 404 overlay.
   * Called by app.js after navigation is wired.
   * @param {() => void} fn
   */
  function setOnBackToPacks(fn) {
    _onBackToPacks = fn;
  }

  return { showNotFound, showFatal, showMaintenance, hide, isVisible, setOnBackToPacks };
}
