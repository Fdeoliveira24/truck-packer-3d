/**
 * @file help-modal.js
 * @description Help/about modal for documenting import/export and core workflows.
 * @module ui/overlays/help-modal
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

export function createHelpModal({ UIComponents } = {}) {
  let modal = null;

  function isOpen() {
    return Boolean(modal);
  }

  function close() {
    if (!modal) return;
    try {
      modal.close();
    } catch {
      // ignore
    }
    modal = null;
  }

  function open() {
    close();
    modal = UIComponents.showModal({
      title: 'Help - Export / Import',
      content: `
                  <div class="muted" style="font-size:var(--text-sm);line-height:var(--leading-relaxed)">
                    <div><strong>App Export/Import</strong>: Use the top bar Export to download a full JSON backup. Use Import to restore from that backup JSON.</div>
                    <div style="height:8px"></div>
                    <div><strong>Pack Export/Import</strong>: In Packs, open the pack menu (three dots) and choose Export Pack to download a single pack JSON. Use Import Pack on the Packs screen to add a shared pack JSON.</div>
                    <div style="height:8px"></div>
                    <div><strong>Cases Template</strong>: On the Cases screen, click Template to download the CSV headers for cases.</div>
                    <div style="height:4px"></div>
                    <div><strong>Cases Import</strong>: Click Import on the Cases screen to upload CSV or XLSX. Valid rows are added; duplicates and invalid rows are skipped.</div>
                    <div style="height:8px"></div>
                    <div>Tip: Export the app before importing to keep a backup.</div>
                  </div>
                `,
      actions: [{ label: 'Close', variant: 'primary', onClick: () => close() }],
    });
  }

  function init() {
    // No-op; help modal is opened from top bar.
  }

  return { init, open, close, isOpen };
}
