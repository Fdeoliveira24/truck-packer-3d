/** The Import / Export page owns presentation and delegates import decisions to the existing controllers. */
import * as CoreStorage from '../core/storage.js';
import { on } from '../core/events.js';

export function createImportExportScreen({
  documentRef = document,
  StateStore,
  CaseLibrary,
  ImportExport,
  ImportCasesDialog,
  ImportPackDialog,
  UIComponents,
  Utils,
  OperationLifecycle,
  getWorkspaceName,
  Storage = CoreStorage,
}) {
  const doc = documentRef;
  const review = doc.getElementById('import-export-review');
  const workspaceName = doc.getElementById('import-export-workspace-name');
  const casesBrowse = /** @type {HTMLButtonElement} */ (doc.getElementById('btn-cases-import'));
  const packsBrowse = /** @type {HTMLButtonElement} */ (doc.getElementById('btn-import-pack'));
  const exportButton = /** @type {HTMLButtonElement} */ (doc.getElementById('btn-cases-export'));
  const casesAvailable = doc.getElementById('import-export-cases-available');
  const templateButton = doc.getElementById('btn-cases-template');
  const formatMount = doc.getElementById('import-export-format-control');
  let activeReview = null;
  let activeScope = null;
  let activeToken = 0;
  let committing = false;

  function hideReview() {
    review.replaceChildren();
    review.hidden = true;
  }

  function clearReview() {
    activeToken += 1;
    const oldReview = activeReview;
    activeReview = null;
    activeScope = null;
    if (oldReview) oldReview.close();
    hideReview();
  }

  function syncWorkspace() {
    const scopeChanged = activeReview && !Storage.isScopeContextCurrent(activeScope);
    if (activeReview && (scopeChanged || StateStore.get('currentScreen') !== 'import-export')) {
      clearReview();
      if (scopeChanged) UIComponents.showToast(Storage.IMPORT_SCOPE_CHANGED_MESSAGE, 'warning');
    }
    const name = typeof getWorkspaceName === 'function' ? getWorkspaceName() : '';
    workspaceName.textContent = name || 'No workspace selected';
    const count = CaseLibrary.getCases().length;
    exportButton.disabled = count === 0;
    exportButton.title = count === 0 ? 'No cases to export in this workspace' : '';
    casesAvailable.textContent = count === 0
      ? 'No cases available to export'
      : `${count} case${count === 1 ? '' : 's'} available`;
  }

  function showCompletion({ message, status }) {
    review.replaceChildren();
    const result = doc.createElement('div');
    result.className = 'tp3d-transfer-result' + (status === 'warning' ? ' is-warning' : '');
    result.setAttribute('role', 'status');
    const icon = doc.createElement('i');
    icon.className = status === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
    icon.setAttribute('aria-hidden', 'true');
    const copy = doc.createElement('div');
    const heading = doc.createElement('strong');
    heading.textContent = status === 'warning' ? 'Import finished with warnings' : 'Import complete';
    const detail = doc.createElement('div');
    detail.textContent = message;
    copy.append(heading, detail);
    result.append(icon, copy);
    review.appendChild(result);
    review.hidden = false;
    review.focus();
  }

  function startImport(kind, file, origin) {
    if (!file || origin.disabled || StateStore.get('currentScreen') !== 'import-export') return;
    if (OperationLifecycle && OperationLifecycle.isBusy()) {
      UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Import' });
      return;
    }
    clearReview();
    const token = ++activeToken;
    activeScope = Storage.captureScopeContext();
    review.hidden = false;
    const controller = kind === 'cases' ? ImportCasesDialog : ImportPackDialog;
    try {
      activeReview = controller.open({
        inlineHost: review,
        initialFile: file,
        beforeMutate: () => {
          if (origin.disabled || StateStore.get('currentScreen') !== 'import-export') return false;
          if (!Storage.isScopeContextCurrent(activeScope)) return false;
          // An import writes the same library slices whose outside changes must
          // invalidate a preview. Keep its synchronous commit from closing itself.
          committing = true;
          queueMicrotask(() => { committing = false; });
          return true;
        },
        onClose: () => {
          if (token !== activeToken) return;
          activeReview = null;
          activeScope = null;
          hideReview();
          if (StateStore.get('currentScreen') === 'import-export') origin.focus();
        },
        onComplete: outcome => {
          if (token !== activeToken) return;
          activeReview = null;
          activeScope = null;
          showCompletion(outcome);
          syncWorkspace();
        },
      });
      review.focus();
    } catch (err) {
      clearReview();
      UIComponents.showToast('Could not open import review: ' + (err && err.message), 'error');
    }
  }

  function bindUpload({ panelId, inputId, browse, kind }) {
    const panel = doc.getElementById(panelId);
    const input = /** @type {HTMLInputElement} */ (doc.getElementById(inputId));
    browse.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      startImport(kind, file, browse);
    });
    panel.addEventListener('dragover', event => {
      event.preventDefault();
      if (!browse.disabled) panel.classList.add('is-dragover');
    });
    panel.addEventListener('dragleave', event => {
      if (!panel.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) {
        panel.classList.remove('is-dragover');
      }
    });
    panel.addEventListener('drop', event => {
      event.preventDefault();
      panel.classList.remove('is-dragover');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      startImport(kind, file, browse);
    });
  }

  function init() {
    bindUpload({ panelId: 'import-export-cases-drop', inputId: 'import-export-cases-file', browse: casesBrowse, kind: 'cases' });
    bindUpload({ panelId: 'import-export-packs-drop', inputId: 'import-export-packs-file', browse: packsBrowse, kind: 'packs' });

    const format = UIComponents.createSelect({
      label: 'Export format',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'csv', label: 'CSV' },
        { value: 'xlsx', label: 'XLSX' },
      ],
      value: 'json',
    });
    formatMount.appendChild(format);

    exportButton.addEventListener('click', () => {
      const scope = Storage.captureScopeContext();
      if (!Storage.isScopeContextCurrent(scope)) return;
      const cases = CaseLibrary.getCases();
      if (!cases.length) {
        UIComponents.showToast('No cases to export', 'info');
        return;
      }
      const choice = format.value;
      const key = choice === 'json' ? 'case-catalog-json' : `cases-${choice}`;
      Utils.downloadActionGuard.run(key, () => {
        if (!Storage.isScopeContextCurrent(scope)) {
          UIComponents.showToast('The workspace changed. Choose Export again.', 'warning');
          return false;
        }
        try {
          if (choice === 'json') ImportExport.downloadCaseCatalogExportJSON(cases);
          else ImportExport.downloadCaseSpreadsheetExport(cases, { format: choice });
          UIComponents.showToast('Download started', 'success');
          return true;
        } catch (err) {
          UIComponents.showToast('Export failed: ' + (err && err.message), 'error');
          return false;
        }
      });
    });

    templateButton.addEventListener('click', () => Utils.downloadActionGuard.run('cases-template', () => {
      try {
        ImportExport.downloadCasesTemplate();
        UIComponents.showToast('Download started', 'success');
        return true;
      } catch (err) {
        UIComponents.showToast('Download failed: ' + (err && err.message), 'error');
        return false;
      }
    }));

    StateStore.subscribe(changes => {
      if (activeReview && !committing &&
          (changes.caseLibrary || changes.packLibrary || changes.preferences || changes._undo || changes._redo)) {
        clearReview();
        UIComponents.showToast('Workspace data changed. Select the file again to review the latest import decisions.', 'warning');
      }
      if (changes._replace || (changes.currentScreen && StateStore.get('currentScreen') !== 'import-export')) {
        clearReview();
      }
      syncWorkspace();
    });
    on('auth:changed', detail => {
      if (detail && (detail.event === 'SIGNED_OUT' || detail.isUserSwitch)) clearReview();
      syncWorkspace();
    });
    window.addEventListener('tp3d:org-changed', () => queueMicrotask(syncWorkspace));
    window.addEventListener('tp3d:org-access-lost', clearReview);
    window.addEventListener('focus', syncWorkspace);
    syncWorkspace();
  }

  return { init, clearReview, syncWorkspace };
}
