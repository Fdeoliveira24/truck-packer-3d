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

/**
 * @param {{ UIComponents?: any }} [opts]
 */
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
      title: 'Import / Export Help',
      content: `
                  <div class="muted" style="font-size:var(--text-sm);line-height:var(--leading-relaxed)">
                    <div><strong>App Backup</strong>: Exporting app backup downloads a JSON file with all load plans, cases, folders, and preferences. Importing an app backup replaces all local app data. Export an app backup before importing.</div>
                    <div style="height:8px"></div>
                    <div><strong>Workspace Backup</strong>: Exporting workspace backup downloads load plans, cases, and folders for this workspace only. Workspace backup does not support import at this time.</div>
                    <div style="height:8px"></div>
                    <div><strong>Load Plan JSON</strong>: Export Load Plan JSON (from the load plan menu) downloads a single load plan and its cases. Import Load Plan JSON adds that load plan to your library without replacing other load plans.</div>
                    <div style="height:4px"></div>
                    <div><strong>Cases CSV/XLSX</strong>: Import Cases on the Cases screen uploads CSV or XLSX. Valid rows are added; duplicate names and invalid rows are skipped.</div>
                    <div style="height:8px"></div>
                    <div>Export an app backup before large imports so you can restore if needed.</div>
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
