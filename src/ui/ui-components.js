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

/**
 * Logical interaction ownership and Escape assignment. Surface callbacks retain
 * their close/cancel behavior. Install before application keyboard listeners.
 */
export function createModalOwnership({ windowRef = window, documentRef = document } = {}) {
  const owners = new Map();
  const eventOwners = new WeakMap();
  const escapeClaims = new WeakMap();
  let order = 0;

  function getActiveOwner() {
    let active = null;
    for (const owner of owners.values()) {
      if (!owner.isActive()) continue;
      if (!active || owner.priority > active.priority ||
          (owner.priority === active.priority && owner.order > active.order)) {
        active = owner;
      }
    }
    return active;
  }

  function getOwnerForElement(element) {
    return [...owners.values()].reverse().find(owner =>
      owner.isActive() && element && owner.element?.contains(element)) || null;
  }

  /** @param {{ kind?: string, element?: Element, parentId?: symbol | null, priority?: number,
   * isActive?: () => boolean, canDismiss?: (source: string) => boolean,
   * onDismiss?: (source: string) => void, onParentClose?: () => void }} [options] */
  function register({ kind = 'modal', element = null, parentId, priority = 0,
    isActive = () => true, canDismiss = () => true, onDismiss, onParentClose } = {}) {
    if (parentId === undefined) {
      // Infer ancestry only from an already registered owner's focused content.
      // DOM classes, visibility and ARIA never establish ownership.
      let parent = getOwnerForElement(documentRef.activeElement);
      // A transient popup is not the lifetime owner of a dialog it launches.
      while (parent?.kind === 'popup') parent = owners.get(parent.parentId);
      parentId = parent?.id || null;
    }
    const id = Symbol(kind);
    const owner = Object.freeze({
      id, kind, element, parentId, priority, order: ++order, isActive, onParentClose,
      requestDismiss(source) {
        if (!owners.has(id) || !canDismiss(source) || !onDismiss) return false;
        onDismiss(source);
        return true;
      },
      release() {
        if (!owners.delete(id)) return;
        for (const child of [...owners.values()]) {
          if (child.parentId === id) child.onParentClose?.();
        }
      },
    });
    owners.set(id, owner);
    return owner;
  }

  windowRef.addEventListener('keydown', event => {
    // Window capture precedes legacy document capture handlers which can close
    // an owner. Keep that entry snapshot even after its registration is released.
    const owner = getActiveOwner();
    eventOwners.set(event, owner?.id || null);
    escapeClaims.delete(event);
    if (event.key !== 'Escape' || !owner) return;
    // Claim before invoking a callback: it may release this owner or open another.
    // The same event cannot be reassigned to that new owner or to the Editor.
    escapeClaims.set(event, owner.id);
    event.preventDefault();
    event.stopPropagation();
    owner.requestDismiss('escape');
  }, true);

  function blocksKeyboardEvent(event) {
    return Boolean(eventOwners.get(event) || getActiveOwner());
  }

  return { register, getActiveOwner, getOwnerForElement,
    getOwners: () => [...owners.values()], blocksKeyboardEvent,
    getEscapeClaim: event => escapeClaims.get(event) || null };
}

export function createUIComponents() {
  const modalOwnership = createModalOwnership();
  const modalRoot = document.getElementById('modal-root');
  const toastContainer = document.getElementById('toast-container');
  let dropdownKeyDownListener = null;
  let dropdownRepositionListener = null;
  let dropdownDocClickListener = null;
  let dropdownDocClickTimer = null;
  let dropdownActiveAnchorEl = null;
  let dropdownActiveAnchorClasses = [];
  let dropdownSemanticAnchorEl = null;
  const registeredDropdownSurfaces = new Map();
  let dropdownOwner = null;
  let dropdownHost = null;
  let dropdownActionParentId;
  let closingDropdowns = false;

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
    let owner = null;
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
    closeBtn.addEventListener('click', () => owner.requestDismiss('close-button'));

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
      if (ev.target === overlay && config.dismissible !== false) owner.requestDismiss('backdrop');
    });

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      owner.release();
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      try {
        config.onClose && config.onClose();
      } catch (_) {
        // Ignore errors from onClose callback
      }
    }

    modalRoot.appendChild(overlay);
    owner = modalOwnership.register({
      element: overlay,
      parentId: config.parentOwnerId === undefined ? dropdownActionParentId : config.parentOwnerId,
      canDismiss: source =>
        (source !== 'escape' || config.dismissible !== false) &&
        (!config.canDismiss || config.canDismiss(source) !== false),
      onDismiss: close,
      onParentClose: close,
    });
    return { close, requestDismiss: owner.requestDismiss, overlay, modal, body, owner };
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
      // Guarded settlement: the Confirm/Cancel actions settle explicitly (true/false)
      // before the primitive auto-closes; X/backdrop/other primitive closes settle
      // false via onClose as a fallback. The guard makes whichever settles first win
      // and every later attempt (including the onClose fallback after an explicit
      // settlement) a no-op, so the Promise always settles exactly once.
      let settled = false;
      const settle = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      showModal({
        title: options.title || 'Confirm',
        content: options.message || 'Are you sure?',
        actions: [
          { label: options.cancelLabel || 'Cancel', onClick: () => settle(false) },
          {
            label: options.okLabel || 'Confirm',
            variant: options.danger ? 'danger' : 'primary',
            onClick: () => settle(true),
          },
        ],
        onClose: () => settle(false),
      });
    });
  }

  function openDropdown(anchorEl, items, options = {}) {
    const parent = modalOwnership.getOwnerForElement(anchorEl);
    const invokeAction = (callback, ...args) => {
      const previousParentId = dropdownActionParentId;
      dropdownActionParentId = parent?.id || null;
      try { return callback?.(...args); }
      finally { dropdownActionParentId = previousParentId; }
    };
    const anchorKey = options.anchorKey ? String(options.anchorKey) : '';
    const fallbackAnchorId = anchorEl && anchorEl.id ? String(anchorEl.id) : '';
    const resolvedAnchorId = anchorKey || fallbackAnchorId;
    const role = options.role ? String(options.role) : '';
    const existing = Array.from(document.querySelectorAll('[data-dropdown="1"]')).find(candidate => {
      const candidateEl = /** @type {HTMLElement} */ (candidate);
      return candidateEl.dataset.anchorId === resolvedAnchorId && candidateEl.dataset.role === role;
    });
    const shouldToggleClosed = options.toggle === true && Boolean(existing);
    closeAllDropdowns();
    const menuSemantics = options.menuSemantics === true;
    const manageTriggerState = menuSemantics || options.manageTriggerState === true;
    if (shouldToggleClosed) return null;
    if (manageTriggerState && anchorEl) {
      dropdownSemanticAnchorEl = anchorEl;
      anchorEl.setAttribute('aria-haspopup', 'menu');
      anchorEl.setAttribute('aria-expanded', 'true');
    }
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
      if (menuSemantics) btn.setAttribute('role', 'menuitem');

      // Apply variant (e.g., danger for delete actions)
      if (item && item.variant) {
        btn.dataset.variant = item.variant;
      }

      if (item && item.disabled) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
      }
      if (item && item.status === true) {
        btn.dataset.status = '1';
        btn.tabIndex = -1;
        btn.setAttribute('aria-disabled', 'true');
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
            invokeAction(handler, Boolean(target && target.checked));
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
            invokeAction(item.rightOnClick);
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
        if (btn.disabled || (item && item.status === true)) return;
        closeAllDropdowns();
        invokeAction(item.onClick);
        if (manageTriggerState && anchorEl && typeof anchorEl.focus === 'function') anchorEl.focus();
      });
      wrap.appendChild(btn);
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';
    if (options.dropdownClass) {
      String(options.dropdownClass)
        .split(/\s+/)
        .filter(Boolean)
        .forEach(className => dropdown.classList.add(className));
    }
    dropdown.dataset.dropdown = '1';
    if (menuSemantics) dropdown.setAttribute('role', 'menu');
    dropdown.dataset.anchorId = resolvedAnchorId;
    if (role) dropdown.dataset.role = role;
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '16000';
    dropdown.style.visibility = 'hidden';

    const preferredWidth = Math.max(180, Number(options.width) || 220);
    dropdown.style.minWidth = `${preferredWidth}px`;
    dropdown.appendChild(wrap);

    // A sibling of the modal panel escapes its scrolling/clipped content, while
    // remaining inside the owner's stacking context below a later child dialog.
    if (parent?.element) {
      dropdownHost = document.createElement('div');
      dropdownHost.className = 'modal-popup-host';
      parent.element.appendChild(dropdownHost);
      dropdownHost.appendChild(dropdown);
    } else {
      document.body.appendChild(dropdown);
    }
    dropdownOwner = modalOwnership.register({
      kind: 'popup', element: dropdown, parentId: parent?.id || null,
      priority: parent?.priority || 0,
      onDismiss: () => {
        const focusTarget = dropdownSemanticAnchorEl;
        closeAllDropdowns();
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
      },
      onParentClose: closeAllDropdowns,
    });

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
    if (menuSemantics) {
      const firstItem = /** @type {HTMLElement | null} */ (
        wrap.querySelector('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])')
      );
      if (firstItem) firstItem.focus();
    }
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
      if (menuSemantics && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) {
        const menuItems = /** @type {HTMLElement[]} */ (
          Array.from(wrap.querySelectorAll('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])'))
        );
        if (!menuItems.length) return;
        ev.preventDefault();
        const activeElement = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        const currentIndex = activeElement ? menuItems.indexOf(activeElement) : -1;
        let nextIndex;
        if (ev.key === 'Home') nextIndex = 0;
        else if (ev.key === 'End') nextIndex = menuItems.length - 1;
        else if (ev.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % menuItems.length;
        else nextIndex = currentIndex <= 0 ? menuItems.length - 1 : currentIndex - 1;
        const nextItem = menuItems[nextIndex];
        if (nextItem) nextItem.focus();
      }
    };
    document.addEventListener('keydown', dropdownKeyDownListener);

    dropdownRepositionListener = () => positionDropdown();
    window.addEventListener('resize', dropdownRepositionListener);
    // Capture scroll events from nested scroll containers too.
    window.addEventListener('scroll', dropdownRepositionListener, true);
    return dropdown;
  }

  function closeAllDropdowns() {
    if (closingDropdowns) return;
    closingDropdowns = true;
    try {
      dropdownOwner?.release();
      dropdownOwner = null;
      document.querySelectorAll('[data-dropdown="1"]').forEach(el => el.remove());
      dropdownHost?.remove();
      dropdownHost = null;
      if (dropdownActiveAnchorEl && dropdownActiveAnchorClasses.length) {
        dropdownActiveAnchorClasses.forEach(className => dropdownActiveAnchorEl.classList.remove(className));
      }
      dropdownActiveAnchorEl = null;
      dropdownActiveAnchorClasses = [];
      if (dropdownSemanticAnchorEl) dropdownSemanticAnchorEl.setAttribute('aria-expanded', 'false');
      dropdownSemanticAnchorEl = null;
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
      registeredDropdownSurfaces.forEach((_unregister, surface) => {
        if (surface && typeof surface.isOpen === 'function' && surface.isOpen()) surface.close();
      });
    } finally {
      closingDropdowns = false;
    }
  }

  function registerDropdownSurface(surface) {
    if (!surface || typeof surface.isOpen !== 'function' || typeof surface.close !== 'function') {
      return () => {};
    }
    const existing = registeredDropdownSurfaces.get(surface);
    if (existing) return existing;
    // Persistent page filters expose their existing open state explicitly. They
    // join the same arbiter, below modal owners, without a second Escape listener.
    const owner = modalOwnership.register({
      kind: 'popup', parentId: null, priority: -1, isActive: () => surface.isOpen(),
      onDismiss: () => {
        const focusTarget = surface.getAnchor?.();
        closeAllDropdowns();
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
      },
    });
    const unregister = () => {
      if (registeredDropdownSurfaces.get(surface) !== unregister) return;
      owner.release();
      registeredDropdownSurfaces.delete(surface);
    };
    registeredDropdownSurfaces.set(surface, unregister);
    return unregister;
  }

  return {
    modalOwnership,
    showToast,
    showModal,
    showAutoPackLoadingOverlay,
    confirm,
    openDropdown,
    closeAllDropdowns,
    registerDropdownSurface,
  };
}
