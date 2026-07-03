/**
 * @file ui-components.js
 * @description UI primitives (modal, toast, dropdown) used across the application.
 * @module ui/ui-components
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

const AUTOPACK_LOADING_IMAGE_SRC = 'media/autopack-loading-truck-480w.gif?v=20260703';
const AUTOPACK_LOADING_MESSAGE_INTERVAL_MS = 2600;
const AUTOPACK_LOADING_MAX_MS = 90000;
const AUTOPACK_LOADING_MESSAGES = Object.freeze([
  'Preparing your load plan...',
  'Checking fit, stacking, and safety rules...',
  'Testing legal rotations and orientations...',
  'Looking for stable support surfaces...',
  'Filling usable floor space...',
  'Checking wheel wells and raised surfaces...',
  'Recovering leftover cargo where possible...',
  'Finalizing your load plan...',
]);

export function createUIComponents() {
  const modalRoot = document.getElementById('modal-root');
  const toastContainer = document.getElementById('toast-container');
  let dropdownKeyDownListener = null;
  let dropdownRepositionListener = null;
  let dropdownDocClickListener = null;
  let dropdownDocClickTimer = null;
  let dropdownActiveAnchorEl = null;
  let dropdownActiveAnchorClasses = [];

  const toastTypes = {
    success: { title: 'Success', color: 'var(--success)', icon: '✓' },
    error: { title: 'Error', color: 'var(--error)', icon: '✕' },
    warning: { title: 'Warning', color: 'var(--warning)', icon: '⚠' },
    info: { title: 'Info', color: 'var(--info)', icon: 'ℹ' },
  };

  function showToast(message, type = 'info', options = {}) {
    const cfg = toastTypes[type] || toastTypes.info;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    icon.style.background = cfg.color;
    icon.textContent = cfg.icon;

    const body = document.createElement('div');
    body.className = 'toast-body';

    const title = document.createElement('div');
    title.className = 'toast-title';
    title.textContent = options.title || cfg.title;

    const msg = document.createElement('div');
    msg.className = 'toast-message';
    msg.textContent = String(message || '');

    body.appendChild(title);
    body.appendChild(msg);

    if (Array.isArray(options.actions) && options.actions.length) {
      const actions = document.createElement('div');
      actions.className = 'toast-actions';
      options.actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'toast-btn';
        btn.type = 'button';
        btn.textContent = action.label || 'Action';
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          try {
            action.onClick && action.onClick();
          } catch (_) {
            // Ignore errors from action handlers
          }
          removeToast(toast);
        });
        actions.appendChild(btn);
      });
      body.appendChild(actions);
    }

    toast.appendChild(icon);
    toast.appendChild(body);

    toast.addEventListener('click', () => removeToast(toast));
    toastContainer.appendChild(toast);

    while (toastContainer.children.length > 3) {
      toastContainer.removeChild(toastContainer.firstChild);
    }

    const duration = Number.isFinite(options.duration) ? options.duration : 3200;
    if (duration > 0) window.setTimeout(() => removeToast(toast), duration);
  }

  function removeToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    window.setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 180);
  }

  function showModal(config) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const showCloseButton = !(config && (config.hideClose === true || config.showCloseButton === false));

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = config.title || 'Dialog';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', () => close());

    header.appendChild(title);
    if (showCloseButton) {
      header.appendChild(closeBtn);
    }

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (typeof config.content === 'string') {
      // SECURITY: Treat string content as trusted HTML only. For user-provided text, pass an HTMLElement and set textContent.
      const div = document.createElement('div');
      div.innerHTML = config.content;
      body.appendChild(div);
    } else if (config.content instanceof HTMLElement) {
      body.appendChild(config.content);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    (config.actions || [{ label: 'Close' }]).forEach(action => {
      const btn = document.createElement('button');
      btn.className =
        `btn ${action.variant === 'primary' ? 'btn-primary' : ''} ${action.variant === 'danger' ? 'btn-danger' : ''} ${action.variant === 'ghost' ? 'btn-ghost' : ''}`
          .trim()
          .replace(/\s+/g, ' ');
      btn.type = 'button';
      btn.textContent = action.label || 'OK';
      btn.addEventListener('click', () => {
        try {
          const res = action.onClick ? action.onClick() : undefined;
          if (res === false) return;
        } catch (_) {
          // Ignore errors from modal actions
        }
        close();
      });
      footer.appendChild(btn);
    });

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', ev => {
      if (ev.target === overlay && config.dismissible !== false) close();
    });

    function close() {
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      try {
        config.onClose && config.onClose();
      } catch (_) {
        // Ignore errors from onClose callback
      }
    }

    modalRoot.appendChild(overlay);
    return { close, overlay, modal, body };
  }

  function showAutoPackLoadingOverlay(options = {}) {
    const root = modalRoot || document.body;
    const messages = Array.isArray(options.messages) && options.messages.length
      ? options.messages.map(message => String(message || '')).filter(Boolean)
      : AUTOPACK_LOADING_MESSAGES;
    const imageSrc = String(options.imageSrc || AUTOPACK_LOADING_IMAGE_SRC || '').trim();
    const resolvedImageSrc = imageSrc
      ? (() => {
          try {
            return new URL(imageSrc, document.baseURI).href;
          } catch {
            return imageSrc;
          }
        })()
      : '';
    const titleText = String(options.title || 'Building your load plan');
    const titleId = `autopack-loading-title-${Date.now()}`;
    const messageId = `autopack-loading-message-${Date.now()}`;
    let messageIndex = 0;
    let closed = false;
    let intervalId = null;
    let maxTimerId = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay autopack-loading-overlay';
    overlay.dataset.tp3dAutopackLoading = '1';

    const modal = document.createElement('div');
    modal.className = 'modal autopack-loading-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal.setAttribute('aria-describedby', messageId);

    const body = document.createElement('div');
    body.className = 'autopack-loading-body';

    const visual = document.createElement('div');
    visual.className = 'autopack-loading-visual';
    visual.setAttribute('aria-hidden', 'true');

    const fallback = document.createElement('div');
    fallback.className = 'autopack-loading-fallback';
    fallback.hidden = true;
    fallback.innerHTML = '<i class="fa-solid fa-truck-ramp-box"></i><i class="fa-solid fa-spinner fa-spin"></i>';

    if (resolvedImageSrc) {
      const img = document.createElement('img');
      img.className = 'autopack-loading-image';
      img.src = resolvedImageSrc;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'eager';
      img.addEventListener('load', () => {
        visual.classList.add('has-image');
      }, { once: true });
      img.addEventListener('error', () => {
        img.hidden = true;
        fallback.hidden = false;
        visual.classList.add('is-fallback');
      }, { once: true });
      visual.appendChild(img);
    } else {
      fallback.hidden = false;
      visual.classList.add('is-fallback');
    }
    visual.appendChild(fallback);

    const title = document.createElement('h3');
    title.className = 'autopack-loading-title';
    title.id = titleId;
    title.textContent = titleText;

    const message = document.createElement('p');
    message.className = 'autopack-loading-message';
    message.id = messageId;
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    const progress = document.createElement('div');
    progress.className = 'autopack-loading-progress';
    progress.setAttribute('aria-hidden', 'true');
    progress.appendChild(document.createElement('span'));

    body.appendChild(visual);
    body.appendChild(title);
    body.appendChild(message);
    body.appendChild(progress);
    modal.appendChild(body);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    const setMessage = nextMessage => {
      const text = String(nextMessage || '').trim();
      if (text) message.textContent = text;
    };
    setMessage(options.initialMessage || messages[0]);
    messageIndex = 1;

    if (messages.length > 1) {
      intervalId = window.setInterval(() => {
        setMessage(messages[messageIndex % messages.length]);
        messageIndex += 1;
      }, AUTOPACK_LOADING_MESSAGE_INTERVAL_MS);
    }

    maxTimerId = window.setTimeout(() => {
      close();
    }, Number.isFinite(options.maxMs) ? options.maxMs : AUTOPACK_LOADING_MAX_MS);

    function close() {
      if (closed) return;
      closed = true;
      if (intervalId) window.clearInterval(intervalId);
      if (maxTimerId) window.clearTimeout(maxTimerId);
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
    }

    return { close, setMessage, overlay, modal };
  }

  function confirm(options) {
    return new Promise(resolve => {
      showModal({
        title: options.title || 'Confirm',
        content: options.message || 'Are you sure?',
        actions: [
          { label: options.cancelLabel || 'Cancel', onClick: () => resolve(false) },
          {
            label: options.okLabel || 'Confirm',
            variant: options.danger ? 'danger' : 'primary',
            onClick: () => resolve(true),
          },
        ],
      });
    });
  }

  function openDropdown(anchorEl, items, options = {}) {
    closeAllDropdowns();
    const activeAnchorClass = String(options.activeAnchorClass || '').trim();
    if (activeAnchorClass && anchorEl && anchorEl.classList) {
      dropdownActiveAnchorEl = anchorEl;
      dropdownActiveAnchorClasses = activeAnchorClass.split(/\s+/).filter(Boolean);
      dropdownActiveAnchorClasses.forEach(className => anchorEl.classList.add(className));
    }
    const wrap = document.createElement('div');
    wrap.className = 'dropdown-menu';
    // The stylesheet defines `.dropdown-menu` as `position:absolute` for inline dropdowns.
    // For floating viewport-clamped dropdowns we keep it absolute but hide it while measuring.
    wrap.style.top = '0';
    wrap.style.left = '0';
    wrap.style.right = 'auto';
    wrap.style.visibility = 'hidden';

    items.forEach(item => {
      if (item && item.type === 'header') {
        const header = document.createElement('div');
        header.style.padding = '10px 12px';
        header.style.fontWeight = 'var(--font-semibold)';
        header.style.borderBottom = '1px solid var(--border-subtle)';
        header.style.position = 'sticky';
        header.style.top = '0';
        header.style.background = 'var(--bg-secondary)';
        header.style.zIndex = '1';
        header.textContent = String(item.label || '');
        wrap.appendChild(header);
        return;
      }

      if (item && (item.type === 'divider' || item.divider === true)) {
        const divider = document.createElement('div');
        divider.setAttribute('role', 'separator');
        divider.style.height = '1px';
        divider.style.margin = `${8}px ${6}px`;
        divider.style.background = 'var(--border-subtle)';
        wrap.appendChild(divider);
        return;
      }

      // Add divider before this item if requested
      if (item && item.dividerBefore) {
        const divider = document.createElement('div');
        divider.setAttribute('role', 'separator');
        divider.style.height = '1px';
        divider.style.margin = `${8}px ${6}px`;
        divider.style.background = 'var(--border-subtle)';
        wrap.appendChild(divider);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dropdown-item';

      // Apply variant (e.g., danger for delete actions)
      if (item && item.variant) {
        btn.dataset.variant = item.variant;
      }

      if (item && item.disabled) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
      }
      if (item && item.active) {
        btn.style.background = 'var(--bg-hover)';
      }
      if (item.icon) {
        const icon = document.createElement('i');
        icon.className = item.icon;
        if (item.iconColor) icon.style.color = String(item.iconColor);
        btn.appendChild(icon);
      }
      const text = document.createElement('span');
      text.textContent = String(item.label || '');
      text.style.flex = '1';
      btn.appendChild(text);

      if (item.checkbox === true) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = Boolean(item.checked);
        cb.disabled = Boolean(item.disabled);
        cb.style.marginLeft = 'auto';
        cb.setAttribute('aria-label', item.checkboxLabel || text.textContent || 'Toggle');
        cb.addEventListener('click', ev => ev.stopPropagation());
        cb.addEventListener('change', ev => {
          if (btn.disabled) return;
          try {
            const handler = item.onCheckboxChange || item.onClick;
            const target = /** @type {HTMLInputElement|null} */ (ev.target);
            if (handler) handler(Boolean(target && target.checked));
          } finally {
            if (options.closeOnCheckboxChange !== false) closeAllDropdowns();
          }
        });
        btn.appendChild(cb);
      } else if (item.rightIcon) {
        const iconRight = document.createElement('i');
        iconRight.className = item.rightIcon;
        iconRight.style.color = item.rightIconColor || 'var(--accent-primary)';
        if (item.rightOnClick) {
          iconRight.style.cursor = 'pointer';
          // Wrap in a span for the tooltip: putting data-tooltip directly on <i> triggers
          // [data-tooltip]::before{content:""} in main.css which wipes the Font Awesome glyph.
          const iconWrap = document.createElement('span');
          iconWrap.style.marginLeft = 'auto';
          iconWrap.style.display = 'inline-flex';
          iconWrap.style.alignItems = 'center';
          if (item.rightTitle) iconWrap.setAttribute('data-tooltip', String(item.rightTitle));
          iconWrap.addEventListener('click', ev => {
            ev.stopPropagation();
            if (btn.disabled) return;
            closeAllDropdowns();
            item.rightOnClick && item.rightOnClick();
          });
          iconWrap.appendChild(iconRight);
          btn.appendChild(iconWrap);
        } else {
          iconRight.style.marginLeft = 'auto';
          btn.appendChild(iconRight);
        }
      }
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (btn.disabled) return;
        closeAllDropdowns();
        item.onClick && item.onClick();
      });
      wrap.appendChild(btn);
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';
    dropdown.dataset.dropdown = '1';
    const anchorKey = options && options.anchorKey ? String(options.anchorKey) : '';
    const fallbackAnchorId = anchorEl && anchorEl.id ? String(anchorEl.id) : '';
    dropdown.dataset.anchorId = anchorKey || fallbackAnchorId;
    if (options && options.role) dropdown.dataset.role = String(options.role);
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '16000';
    dropdown.style.visibility = 'hidden';

    const preferredWidth = Math.max(180, Number(options.width) || 220);
    dropdown.style.minWidth = `${preferredWidth}px`;
    dropdown.appendChild(wrap);

    document.body.appendChild(dropdown);

    const positionDropdown = () => {
      if (!dropdown.isConnected) return;
      const pad = 8;
      const gap = 6;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const rect = anchorEl.getBoundingClientRect();

      dropdown.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;
      dropdown.style.maxHeight = `${Math.max(0, vh - pad * 2)}px`;
      dropdown.style.overflowY = 'auto';

      // Measure after maxWidth/minWidth are applied.
      const menuRect = wrap.getBoundingClientRect();
      const menuW = Math.max(menuRect.width, wrap.scrollWidth || 0, preferredWidth);
      const menuH = Math.max(menuRect.height, wrap.scrollHeight || 0, 0);
      dropdown.style.width = `${Math.ceil(menuW)}px`;
      dropdown.style.height = `${Math.ceil(menuH)}px`;

      // Default: open below the trigger.
      let top = rect.bottom + gap;
      if (top + menuH > vh - pad) top = rect.top - gap - menuH;
      top = Math.max(pad, Math.min(top, Math.max(pad, vh - pad - menuH)));

      // Backwards-compatible default: align dropdown's right edge with trigger's right edge.
      let left = rect.right - menuW;
      if (options.align === 'left') left = rect.left;
      left = Math.max(pad, Math.min(left, Math.max(pad, vw - pad - menuW)));

      dropdown.style.left = `${Math.round(left)}px`;
      dropdown.style.top = `${Math.round(top)}px`;
    };

    positionDropdown();
    wrap.style.visibility = 'visible';
    dropdown.style.visibility = 'visible';
    if (dropdownDocClickTimer) {
      window.clearTimeout(dropdownDocClickTimer);
      dropdownDocClickTimer = null;
    }
    if (dropdownDocClickListener) {
      document.removeEventListener('click', dropdownDocClickListener);
      dropdownDocClickListener = null;
    }
    dropdownDocClickTimer = window.setTimeout(() => {
      dropdownDocClickListener = () => closeAllDropdowns();
      document.addEventListener('click', dropdownDocClickListener, { once: true });
      dropdownDocClickTimer = null;
    }, 0);

    dropdownKeyDownListener = ev => {
      if (ev.key === 'Escape') closeAllDropdowns();
    };
    document.addEventListener('keydown', dropdownKeyDownListener);

    dropdownRepositionListener = () => positionDropdown();
    window.addEventListener('resize', dropdownRepositionListener);
    // Capture scroll events from nested scroll containers too.
    window.addEventListener('scroll', dropdownRepositionListener, true);
  }

  function closeAllDropdowns() {
    document.querySelectorAll('[data-dropdown="1"]').forEach(el => el.remove());
    if (dropdownActiveAnchorEl && dropdownActiveAnchorClasses.length) {
      dropdownActiveAnchorClasses.forEach(className => dropdownActiveAnchorEl.classList.remove(className));
    }
    dropdownActiveAnchorEl = null;
    dropdownActiveAnchorClasses = [];
    if (dropdownDocClickTimer) {
      window.clearTimeout(dropdownDocClickTimer);
      dropdownDocClickTimer = null;
    }
    if (dropdownDocClickListener) {
      document.removeEventListener('click', dropdownDocClickListener);
      dropdownDocClickListener = null;
    }
    if (dropdownKeyDownListener) {
      document.removeEventListener('keydown', dropdownKeyDownListener);
      dropdownKeyDownListener = null;
    }
    if (dropdownRepositionListener) {
      window.removeEventListener('resize', dropdownRepositionListener);
      window.removeEventListener('scroll', dropdownRepositionListener, true);
      dropdownRepositionListener = null;
    }
  }

  return { showToast, showModal, showAutoPackLoadingOverlay, confirm, openDropdown, closeAllDropdowns };
}
