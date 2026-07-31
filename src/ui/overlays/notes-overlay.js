/**
 * Shared, single-field Notes overlay.
 *
 * Entity ownership stays with the caller: this module owns only modal state,
 * accessibility, focus, and safe write orchestration. Callers provide narrow
 * resolve/read/save adapters for their Case or Load Plan record.
 */

import { formatRelativeTime } from '../../core/utils/index.js';

let activeNotesOverlay = null;
let notesOverlaySequence = 0;

function contextsEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => contextsEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && contextsEqual(left[key], right[key])
    );
}

function resolveText(value, entity, fallback = '') {
  try {
    const resolved = typeof value === 'function' ? value(entity) : value;
    return String(resolved == null ? fallback : resolved);
  } catch (_) {
    return String(fallback);
  }
}

function focusSoon(target) {
  if (!target || typeof target.focus !== 'function') return;
  const focus = () => {
    if (target.isConnected !== false && typeof target.focus === 'function') target.focus();
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(focus);
  else window.setTimeout(focus, 0);
}

function restoreTriggerFocus(trigger, entityType, entityId) {
  let target = trigger;
  if (!target || typeof target.focus !== 'function' || target.isConnected === false) {
    target = Array.from(document.querySelectorAll('[data-notes-entity-id]')).find(candidate =>
      candidate instanceof HTMLElement &&
      candidate.dataset.notesEntityType === entityType &&
      candidate.dataset.notesEntityId === entityId
    ) || null;
  }
  if (!target || typeof target.focus !== 'function' || target.isConnected === false) return;
  focusSoon(target);
}

/**
 * @param {{
 *   UIComponents: { showModal: Function, showToast?: Function },
 *   entityType: string,
 *   entityId: string,
 *   capturedContext?: unknown,
 *   getCurrentContext?: () => unknown,
 *   resolveEntity: (args: {
 *     entityType: string,
 *     entityId: string,
 *     capturedContext: unknown,
 *     currentContext: unknown
 *   }) => any,
 *   readNote: (entity: any) => unknown,
 *   saveNote: (args: {
 *     entity: any,
 *     entityType: string,
 *     entityId: string,
 *     value: unknown,
 *     capturedContext: unknown,
 *     currentContext: unknown,
 *     cleared: boolean
 *   }) => unknown,
 *   clearValue: unknown,
 *   title: string,
 *   subtitle?: string | ((entity: any) => string),
 *   fieldLabel?: string,
 *   emptyText?: string,
 *   placeholder?: string,
 *   mutationGuard?: () => boolean | void,
 *   getLastEdited?: (entity: any) => unknown,
 *   onSaved?: (args: {
 *     entity: any,
 *     entityType: string,
 *     entityId: string,
 *     value: unknown,
 *     cleared: boolean,
 *     result: unknown
 *   }) => void,
 *   trigger?: HTMLElement | null,
 *   missingMessage?: string,
 *   contextMessage?: string
 * }} config
 */
export function openNotesOverlay(config) {
  const ui = config && config.UIComponents;
  if (!ui || typeof ui.showModal !== 'function') {
    throw new Error('openNotesOverlay requires UIComponents.showModal');
  }
  if (typeof config.resolveEntity !== 'function' ||
      typeof config.readNote !== 'function' ||
      typeof config.saveNote !== 'function') {
    throw new Error('openNotesOverlay requires resolveEntity, readNote, and saveNote adapters');
  }

  if (activeNotesOverlay) activeNotesOverlay.close({ restoreFocus: false });

  const entityType = String(config.entityType || 'record');
  const entityId = String(config.entityId || '');
  const capturedContext = config.capturedContext;
  const trigger = config.trigger || null;
  const overlayId = `tp3d-notes-overlay-${++notesOverlaySequence}`;
  const titleId = `${overlayId}-title`;
  const fieldLabelId = `${overlayId}-field-label`;
  const textareaId = `${overlayId}-textarea`;
  let modalRef = null;
  let closed = false;
  let restoreFocusOnClose = true;
  let writing = false;

  const contentRoot = document.createElement('div');
  contentRoot.className = 'tp3d-notes-modal-content';

  function showToast(message, type = 'error') {
    if (typeof ui.showToast === 'function') {
      ui.showToast(message, type, { title: resolveText(config.title, null, 'Notes') });
    }
  }

  function getCurrentContext() {
    return typeof config.getCurrentContext === 'function'
      ? config.getCurrentContext()
      : capturedContext;
  }

  function resolveCurrentEntity(currentContext = getCurrentContext()) {
    return config.resolveEntity({
      entityType,
      entityId,
      capturedContext,
      currentContext,
    }) || null;
  }

  function contextIsCurrent(currentContext) {
    if (typeof config.getCurrentContext !== 'function') return true;
    return contextsEqual(capturedContext, currentContext);
  }

  function missingMessage() {
    return String(config.missingMessage || `This ${entityType} no longer exists.`);
  }

  function contextMessage() {
    return String(config.contextMessage || `The active ${entityType} changed. Close Notes and try again.`);
  }

  function close({ restoreFocus = true } = {}) {
    restoreFocusOnClose = restoreFocus;
    if (modalRef) modalRef.close();
  }

  function handleClose() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', handleEscape);
    if (activeNotesOverlay && activeNotesOverlay.modal === modalRef.modal) activeNotesOverlay = null;
    if (restoreFocusOnClose) restoreTriggerFocus(trigger, entityType, entityId);
  }

  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  const initialContext = getCurrentContext();
  const initialEntity = resolveCurrentEntity(initialContext);
  if (!initialEntity) {
    showToast(missingMessage());
    restoreTriggerFocus(trigger, entityType, entityId);
    return null;
  }

  modalRef = ui.showModal({
    title: resolveText(config.title, initialEntity, 'Notes'),
    content: contentRoot,
    actions: [],
    onClose: handleClose,
  });
  modalRef.modal.classList.add('tp3d-notes-modal');
  modalRef.modal.setAttribute('role', 'dialog');
  modalRef.modal.setAttribute('aria-modal', 'true');
  modalRef.modal.setAttribute('aria-labelledby', titleId);

  const heading = modalRef.modal.querySelector('.modal-title');
  const closeButton = modalRef.modal.querySelector('.modal-header .btn');
  if (closeButton) {
    closeButton.setAttribute('aria-label', `Close ${resolveText(config.title, initialEntity, 'Notes')}`);
  }
  let headingTitle = null;
  let headingSubtitle = null;
  if (heading) {
    heading.textContent = '';
    heading.id = titleId;
    heading.classList.add('tp3d-notes-modal-heading');

    const headingIcon = document.createElement('span');
    headingIcon.className = 'tp3d-notes-modal-heading-icon';
    headingIcon.setAttribute('aria-hidden', 'true');
    const headingIconGlyph = document.createElement('i');
    headingIconGlyph.className = 'fa-regular fa-file-lines';
    headingIcon.appendChild(headingIconGlyph);

    const headingCopy = document.createElement('span');
    headingCopy.className = 'tp3d-notes-modal-heading-copy';
    headingTitle = document.createElement('span');
    headingTitle.className = 'tp3d-notes-modal-heading-title';
    headingSubtitle = document.createElement('span');
    headingSubtitle.className = 'tp3d-notes-modal-heading-subtitle';
    headingCopy.appendChild(headingTitle);
    headingCopy.appendChild(headingSubtitle);
    heading.appendChild(headingIcon);
    heading.appendChild(headingCopy);
  }

  const footer = modalRef.modal.querySelector('.modal-footer');

  function updateHeading(entity) {
    if (headingTitle) headingTitle.textContent = resolveText(config.title, entity, 'Notes');
    if (headingSubtitle) headingSubtitle.textContent = resolveText(config.subtitle, entity, entityType);
  }

  function makeAction(label, variant, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      `btn ${variant === 'primary' ? 'btn-primary' : ''} ${variant === 'danger' ? 'btn-danger' : ''} ${variant === 'ghost' ? 'btn-ghost' : ''}`
        .trim()
        .replace(/\s+/g, ' ');
    button.textContent = label;
    button.addEventListener('click', () => {
      Promise.resolve(onClick()).catch(() => {
        showToast(`Could not update ${resolveText(config.fieldLabel, null, 'Notes')}.`);
      });
    });
    return button;
  }

  function setActions(actions) {
    if (!footer) return [];
    footer.textContent = '';
    const buttons = actions.map(action => makeAction(action.label, action.variant, action.onClick));
    buttons.forEach(button => footer.appendChild(button));
    return buttons;
  }

  function setWriting(nextWriting) {
    writing = nextWriting;
    if (!footer) return;
    footer.querySelectorAll('button').forEach(button => {
      button.disabled = writing;
    });
  }

  async function writeValue(value, cleared, draftTarget = null) {
    if (writing) return false;
    let resolvedEntity = null;
    setWriting(true);
    try {
      if (typeof config.mutationGuard === 'function') {
        const allowed = await config.mutationGuard();
        if (allowed === false) {
          setWriting(false);
          return false;
        }
      }

      const currentContext = getCurrentContext();
      if (!contextIsCurrent(currentContext)) {
        setWriting(false);
        showToast(contextMessage());
        if (draftTarget) focusSoon(draftTarget);
        return false;
      }

      resolvedEntity = resolveCurrentEntity(currentContext);
      if (!resolvedEntity) {
        setWriting(false);
        showToast(missingMessage());
        if (draftTarget) focusSoon(draftTarget);
        return false;
      }

      const result = await config.saveNote({
        entity: resolvedEntity,
        entityType,
        entityId,
        value,
        capturedContext,
        currentContext,
        cleared,
      });
      if (typeof config.onSaved === 'function') {
        try {
          config.onSaved({ entity: resolvedEntity, entityType, entityId, value, cleared, result });
        } catch (_) {
          // Persistence succeeded; a secondary refresh callback must not turn it
          // into a reported save failure or invite a duplicate write.
        }
      }
      setWriting(false);
      render('auto');
      return true;
    } catch (_) {
      setWriting(false);
      showToast(`Could not update ${resolveText(config.fieldLabel, resolvedEntity, 'Notes')}.`);
      if (draftTarget) focusSoon(draftTarget);
      return false;
    }
  }

  function appendFieldLabel(target, entity) {
    const label = document.createElement('div');
    label.id = fieldLabelId;
    label.classList.add('tp3d-editor-fw-semibold');
    label.textContent = resolveText(config.fieldLabel, entity, 'Notes');
    target.appendChild(label);
    return label;
  }

  function appendLastEdited(entity, target) {
    if (typeof config.getLastEdited !== 'function') return;
    const editedAt = Number(config.getLastEdited(entity));
    if (!Number.isFinite(editedAt) || editedAt <= 0) return;
    const lastEdited = document.createElement('div');
    lastEdited.className = 'muted tp3d-notes-last-edited';
    lastEdited.textContent = `Last edited ${formatRelativeTime(editedAt)}`;
    target.appendChild(lastEdited);
  }

  function render(requestedState = 'auto') {
    const currentContext = getCurrentContext();
    const entity = resolveCurrentEntity(currentContext);
    if (!entity) {
      showToast(missingMessage());
      close();
      return;
    }
    updateHeading(entity);

    const savedNote = String(config.readNote(entity) || '').trim();
    const state = requestedState === 'auto'
      ? (savedNote ? 'read' : 'empty')
      : requestedState;
    contentRoot.textContent = '';

    if (state === 'empty') {
      const emptyState = document.createElement('div');
      emptyState.className = 'tp3d-notes-empty-state';
      const emptyIcon = document.createElement('span');
      emptyIcon.className = 'tp3d-notes-empty-state-icon';
      emptyIcon.setAttribute('aria-hidden', 'true');
      const emptyIconGlyph = document.createElement('i');
      emptyIconGlyph.className = 'fa-regular fa-file-lines';
      emptyIcon.appendChild(emptyIconGlyph);
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'muted';
      emptyMessage.textContent = String(config.emptyText || `No notes for this ${entityType} yet.`);
      emptyState.appendChild(emptyIcon);
      emptyState.appendChild(emptyMessage);
      contentRoot.appendChild(emptyState);
      const buttons = setActions([
        { label: 'Add Note', variant: 'primary', onClick: () => render('edit') },
      ]);
      focusSoon(buttons[0]);
      return;
    }

    if (state === 'read') {
      appendFieldLabel(contentRoot, entity);
      const note = document.createElement('div');
      note.classList.add('tp3d-editor-sub-sm', 'tp3d-case-notes-read', 'tp3d-notes-item-read');
      note.setAttribute('aria-labelledby', fieldLabelId);
      note.textContent = savedNote;
      contentRoot.appendChild(note);
      appendLastEdited(entity, contentRoot);
      const buttons = setActions([
        { label: 'Close', variant: 'ghost', onClick: () => close() },
        {
          label: 'Clear',
          variant: 'ghost',
          onClick: () => {
            const clearValue = typeof config.clearValue === 'function'
              ? config.clearValue(entity)
              : config.clearValue;
            return writeValue(clearValue, true);
          },
        },
        { label: 'Edit', variant: 'primary', onClick: () => render('edit') },
      ]);
      focusSoon(buttons[2] || buttons[0]);
      return;
    }

    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.id = fieldLabelId;
    label.className = 'label';
    label.htmlFor = textareaId;
    label.textContent = resolveText(config.fieldLabel, entity, 'Notes');
    const textarea = document.createElement('textarea');
    textarea.id = textareaId;
    textarea.className = 'input tp3d-textarea-minh-60';
    textarea.placeholder = String(config.placeholder || 'Add notes...');
    textarea.value = savedNote;
    field.appendChild(label);
    field.appendChild(textarea);
    contentRoot.appendChild(field);

    const actions = [
      { label: 'Cancel', variant: 'ghost', onClick: () => render('auto') },
    ];
    if (savedNote) {
      actions.push({
        label: 'Clear',
        variant: 'ghost',
        onClick: () => {
          const clearValue = typeof config.clearValue === 'function'
            ? config.clearValue(entity)
            : config.clearValue;
          return writeValue(clearValue, true, textarea);
        },
      });
    }
    actions.push({
      label: 'Save',
      variant: 'primary',
      onClick: () => {
        const trimmed = textarea.value.trim();
        if (!trimmed) {
          showToast(
            savedNote
              ? 'Use Clear to remove the saved note.'
              : 'Enter a note before saving.',
            'warning'
          );
          focusSoon(textarea);
          return false;
        }
        return writeValue(trimmed, false, textarea);
      },
    });
    setActions(actions);
    focusSoon(textarea);
  }

  document.addEventListener('keydown', handleEscape);
  activeNotesOverlay = {
    close,
    modal: modalRef.modal,
    overlay: modalRef.overlay,
    entityType,
    entityId,
  };
  render('auto');
  return activeNotesOverlay;
}
