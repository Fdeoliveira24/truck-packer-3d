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

export function createUIComponents() {
            const modalRoot = document.getElementById('modal-root');
            const toastContainer = document.getElementById('toast-container');
            let dropdownKeyDownListener = null;
            let dropdownRepositionListener = null;
            let dropdownDocClickListener = null;
            let dropdownDocClickTimer = null;

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
              header.appendChild(closeBtn);

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
                btn.className = `btn ${action.variant === 'primary' ? 'btn-primary' : ''} ${action.variant === 'danger' ? 'btn-danger' : ''}`;
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
	              const wrap = document.createElement('div');
	              wrap.className = 'dropdown-menu';
	              // The stylesheet defines `.dropdown-menu` as `position:absolute` for inline dropdowns.
	              // For floating viewport-clamped dropdowns we make it participate in layout so the
	              // wrapper element has a measurable width/height.
	              wrap.style.position = 'static';
	              wrap.style.top = 'auto';
	              wrap.style.left = 'auto';
	              wrap.style.right = 'auto';

	              items.forEach(item => {
	                if (item && item.type === 'header') {
	                  const header = document.createElement('div');
	                  header.style.padding = '10px 12px';
	                  header.style.fontWeight = 'var(--font-semibold)';
	                  header.style.borderBottom = '1px solid var(--border-subtle)';
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
                if (item.rightIcon) {
                  const iconRight = document.createElement('i');
                  iconRight.className = item.rightIcon;
                  iconRight.style.marginLeft = 'auto';
                  iconRight.style.color = item.rightIconColor || 'var(--accent-primary)';
                  if (item.rightOnClick) {
                    iconRight.style.cursor = 'pointer';
                    iconRight.title = item.rightTitle ? String(item.rightTitle) : '';
                    iconRight.addEventListener('click', ev => {
                      ev.stopPropagation();
                      if (btn.disabled) return;
                      closeAllDropdowns();
                      item.rightOnClick && item.rightOnClick();
                    });
                  }
                  btn.appendChild(iconRight);
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
              dropdown.dataset.anchorId = anchorEl && anchorEl.id ? String(anchorEl.id) : '';
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
	                const menuRect = dropdown.getBoundingClientRect();
                const menuW = menuRect.width || preferredWidth;
                const menuH = menuRect.height || 0;

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

            return { showToast, showModal, confirm, openDropdown, closeAllDropdowns };
}
