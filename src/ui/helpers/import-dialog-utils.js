/**
 * @file import-dialog-utils.js
 * @description Shared DOM bindings for import dialog file pickers/dropzones.
 */

/**
 * @param {{
 *   drop: HTMLElement,
 *   browseBtn: HTMLButtonElement,
 *   fileInput: HTMLInputElement,
 *   onFile: (file: File) => void
 * }} opts
 */
export function bindImportFileHandlers({ drop, browseBtn, fileInput, onFile }) {
  const dispatchFile = file => {
    if (file) onFile(file);
  };

  browseBtn.addEventListener('click', () => fileInput.click());

  drop.addEventListener('dragover', event => {
    event.preventDefault();
    drop.classList.add('is-dragover');
  });

  drop.addEventListener('dragleave', () => {
    drop.classList.remove('is-dragover');
  });

  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('is-dragover');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    dispatchFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    dispatchFile(file);
  });
}

/**
 * @param {{
 *   documentRef: Document,
 *   UIComponents: any,
 *   title: string,
 *   content: HTMLElement,
 *   accept: string,
 *   drop: HTMLElement,
 *   browseBtn: HTMLButtonElement,
 *   onFile: (file: File, modal: any) => void
 * }} opts
 */
export function openImportDialogWithFilePicker({
  documentRef,
  UIComponents,
  title,
  content,
  accept,
  drop,
  browseBtn,
  onFile,
}) {
  const fileInput = documentRef.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = accept;

  const modal = UIComponents.showModal({
    title,
    content,
    actions: [{ label: 'Close', variant: 'primary' }],
  });

  bindImportFileHandlers({
    drop,
    browseBtn,
    fileInput,
    onFile: file => {
      onFile(file, modal);
    },
  });

  return { modal, fileInput };
}
