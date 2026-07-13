/**
 * Shared confirmation controller for every production truck-geometry writer.
 * It keeps reconciliation pure until the user accepts one complete transaction.
 */

function normalizedTruckGeometry(truck = {}) {
  const mode = truck.shapeMode === 'wheelWells' || truck.shapeMode === 'frontBonus'
    ? truck.shapeMode
    : 'rect';
  const cfg = truck.shapeConfig && typeof truck.shapeConfig === 'object' && !Array.isArray(truck.shapeConfig)
    ? truck.shapeConfig
    : {};
  const shapeConfig = mode === 'wheelWells'
    ? {
        wellHeight: Number(cfg.wellHeight) || 0,
        wellWidth: Number(cfg.wellWidth) || 0,
        wellLength: Number(cfg.wellLength) || 0,
        wellOffsetFromRear: Number(cfg.wellOffsetFromRear) || 0,
      }
    : mode === 'frontBonus'
      ? {
          bonusLength: Number(cfg.bonusLength) || 0,
          bonusHeight: Number(cfg.bonusHeight) || 0,
          bonusWidth: Number(truck.width) || 0,
        }
      : {};
  return {
    length: Number(truck.length) || 0,
    width: Number(truck.width) || 0,
    height: Number(truck.height) || 0,
    shapeMode: mode,
    shapeConfig,
  };
}

export function truckGeometryEqual(a, b) {
  return JSON.stringify(normalizedTruckGeometry(a)) === JSON.stringify(normalizedTruckGeometry(b));
}

export function createTruckChangeController({
  PackLibrary,
  CaseLibrary,
  UIComponents,
  documentRef = document,
}) {
  let active = null;

  function appendCaseCountList(content, ids, pack, caseLibrary) {
    const caseById = new Map((caseLibrary || []).map(caseData => [caseData.id, caseData]));
    const instanceById = new Map(((pack && pack.cases) || []).map(inst => [inst.id, inst]));
    const counts = new Map();
    for (const id of ids || []) {
      const inst = instanceById.get(id);
      const caseData = inst ? caseById.get(inst.caseId) : null;
      const label = String(caseData?.name || inst?.name || 'Unknown case').trim() || 'Unknown case';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (!counts.size) return;
    const list = documentRef.createElement('ul');
    list.className = 'tp3d-editor-card-grid-gap-12';
    [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([label, count]) => {
        const item = documentRef.createElement('li');
        item.textContent = `${count} × ${label}`;
        list.appendChild(item);
      });
    content.appendChild(list);
  }

  function buildSafePreview(ctx, sourcePack, stagedIds, excludedIds = []) {
    const ids = [...new Set([
      ...(ctx.reconciliation?.stagedAdjusted || []),
      ...(stagedIds || []),
    ])];
    const staged = ids.length
      ? PackLibrary.stagePlacementIds(
          sourcePack,
          ids,
          ctx.nextTruck,
          ctx.caseLibrary,
          { grouped: true }
        )
      : { pack: sourcePack, stagedIds: [], failedIds: [] };
    const excluded = new Set([...(excludedIds || []), ...(staged.failedIds || [])]);
    return {
      pack: {
        ...staged.pack,
        truck: ctx.nextTruck,
        cases: (staged.pack.cases || []).filter(inst => !excluded.has(inst.id)),
      },
      stagedIds: staged.stagedIds || [],
      failedIds: staged.failedIds || [],
      excludedIds: [...excluded],
    };
  }

  function renderPreview(ctx, preview) {
    if (typeof ctx.renderPreview === 'function') ctx.renderPreview(preview);
  }

  function makeSummaryContent(recon, heading) {
    const content = documentRef.createElement('div');
    const intro = documentRef.createElement('div');
    intro.className = 'tp3d-editor-sub-sm';
    intro.textContent = heading;
    content.appendChild(intro);

    const list = documentRef.createElement('ul');
    list.className = 'tp3d-editor-card-grid-gap-12';
    const rows = [
      `${recon.summary.kept} kept in place`,
      `${recon.summary.adjusted} safely adjusted`,
      `${recon.summary.invalid} no longer fit (shown in staging preview)`,
      `${recon.summary.stagedUnchanged} existing staged items unchanged`,
    ];
    if (recon.summary.stagedAdjusted) rows.push(`${recon.summary.stagedAdjusted} unsafe staged items corrected`);
    if (recon.summary.unresolved) rows.push(`${recon.summary.unresolved} unresolved items require attention`);
    if (recon.summary.malformed) rows.push(`${recon.summary.malformed} malformed items require attention`);
    rows.forEach(text => {
      const li = documentRef.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    content.appendChild(list);

    if (recon.unresolved.length || recon.malformed.length) {
      const blocked = documentRef.createElement('div');
      blocked.className = 'muted tp3d-editor-sub-sm';
      const messages = [];
      if (recon.unresolved.length) {
        messages.push(`${recon.unresolved.length} unresolved item(s) reference missing case definitions`);
      }
      if (recon.malformed.length) {
        messages.push(`${recon.malformed.length} malformed item(s) have invalid physical data`);
      }
      blocked.textContent = `${messages.join('; ')}. Resolve or remove them before changing the truck.`;
      content.appendChild(blocked);
    }
    const previewNote = documentRef.createElement('div');
    previewNote.className = 'muted tp3d-editor-sub-sm';
    previewNote.textContent = 'The scene shows the proposed truck. Items that no longer fit are shown in staging. No changes are saved until you confirm.';
    content.appendChild(previewNote);
    return content;
  }

  function disableActions(ctx, disabled) {
    const modal = ctx.modalRef && ctx.modalRef.modal;
    if (!modal || typeof modal.querySelectorAll !== 'function') return;
    modal.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  }

  function finishContext(ctx) {
    if (active === ctx) active = null;
    ctx.inFlight = false;
    ctx.modalRef = null;
  }

  function showManagedModal(ctx, config) {
    let escapeHandler = null;
    const originalOnClose = config.onClose;
    const modalRef = UIComponents.showModal({
      ...config,
      dismissible: config.dismissible !== false,
      onClose: () => {
        if (escapeHandler && documentRef.removeEventListener) {
          documentRef.removeEventListener('keydown', escapeHandler, true);
        }
        if (ctx.suppressRestoreOnce) {
          ctx.suppressRestoreOnce = false;
        } else {
          if (!ctx.committed && typeof ctx.restoreControls === 'function') ctx.restoreControls();
          finishContext(ctx);
        }
        if (typeof originalOnClose === 'function') originalOnClose();
      },
    });
    ctx.modalRef = modalRef;
    escapeHandler = event => {
      if (event && event.key === 'Escape' && ctx.modalRef === modalRef) {
        event.preventDefault && event.preventDefault();
        modalRef.close();
      }
    };
    if (documentRef.addEventListener) documentRef.addEventListener('keydown', escapeHandler, true);
    return modalRef;
  }

  function guarded(ctx, action) {
    return () => {
      if (ctx.inFlight || ctx.committed) return false;
      ctx.inFlight = true;
      disableActions(ctx, true);
      try {
        return action();
      } catch (error) {
        ctx.inFlight = false;
        disableActions(ctx, false);
        UIComponents.showToast(
          error && error.message ? error.message : 'Truck change could not be completed.',
          'error',
          { title: 'Truck change' }
        );
        return false;
      }
    };
  }

  function commit(ctx, finalPack, message) {
    const committed = ctx.commit
      ? ctx.commit(finalPack)
      : PackLibrary.update(ctx.pack.id, { truck: ctx.nextTruck, cases: finalPack.cases });
    if (!committed) throw new Error('Truck change could not be saved. No changes were applied.');
    ctx.committed = true;
    if (typeof ctx.onCommitted === 'function') ctx.onCommitted(committed);
    if (message) UIComponents.showToast(message, 'success', { title: 'Truck' });
    return true;
  }

  function showRemainingDecision(ctx, outcome) {
    const preview = buildSafePreview(ctx, outcome.pack, outcome.failedIds);
    renderPreview(ctx, {
      kind: 'repack',
      pack: preview.pack,
      keptIds: ctx.reconciliation.kept,
      adjustedIds: ctx.reconciliation.adjusted.map(entry => entry.id),
      repackedIds: outcome.repackedIds,
      stagedPreviewIds: preview.stagedIds,
      excludedIds: preview.excludedIds,
    });
    const content = documentRef.createElement('div');
    const summary = documentRef.createElement('div');
    summary.className = 'tp3d-editor-sub-sm';
    const repackedLabel = `${outcome.repackedIds.length} item${outcome.repackedIds.length === 1 ? '' : 's'} repacked.`;
    const failedLabel = `Could not be repacked: ${outcome.failedIds.length} item${outcome.failedIds.length === 1 ? '' : 's'}.`;
    summary.textContent = `${repackedLabel} ${failedLabel}`;
    content.appendChild(summary);
    appendCaseCountList(content, outcome.failedIds, outcome.pack, ctx.caseLibrary);
    const note = documentRef.createElement('div');
    note.className = 'muted tp3d-editor-sub-sm';
    note.textContent = 'Items that could not be repacked are shown in the staging preview. No truck or cargo changes have been saved yet.';
    content.appendChild(note);

    showManagedModal(ctx, {
      title: 'Some items still do not fit',
      content,
      actions: [
        { label: 'Keep current truck and cancel' },
        {
          label: 'Move remaining items to staging',
          variant: 'primary',
          onClick: guarded(ctx, () => {
            if (preview.failedIds.length) {
              throw new Error(`Could not safely stage ${preview.failedIds.length} item(s). No changes were applied.`);
            }
            return commit(
              ctx,
              preview.pack,
              `Truck updated. ${outcome.repackedIds.length} repacked and ${outcome.failedIds.length} moved to staging.`
            );
          }),
        },
      ],
    });
  }

  function showPreview(ctx) {
    const recon = ctx.reconciliation;
    const blocked = recon.unresolved.length > 0 || recon.malformed.length > 0;
    const actions = [{ label: 'Cancel' }];
    const excludedIds = [
      ...recon.unresolved.map(entry => entry.id),
      ...recon.malformed.map(entry => entry.id),
    ];
    const preview = buildSafePreview(ctx, recon.nextPack, recon.invalid, excludedIds);
    renderPreview(ctx, {
      kind: 'reconciliation',
      pack: preview.pack,
      keptIds: recon.kept,
      adjustedIds: recon.adjusted.map(entry => entry.id),
      repackedIds: [],
      stagedPreviewIds: preview.stagedIds,
      excludedIds: preview.excludedIds,
    });

    if (!blocked && recon.invalid.length === 0) {
      actions.push({
        label: 'Apply change',
        variant: 'primary',
        onClick: guarded(ctx, () => {
          if (preview.failedIds.length) {
            throw new Error(`Could not safely stage ${preview.failedIds.length} item(s). No changes were applied.`);
          }
          return commit(
            ctx,
            preview.pack,
            recon.adjusted.length
              ? `${ctx.successMessage}. ${recon.adjusted.length} item(s) safely adjusted.`
              : ctx.successMessage
          );
        }),
      });
    } else if (!blocked) {
      actions.push({
        label: 'Move to staging',
        onClick: guarded(ctx, () => {
          if (preview.failedIds.length) {
            throw new Error(`Could not safely stage ${preview.failedIds.length} item(s). No changes were applied.`);
          }
          return commit(ctx, preview.pack, `Truck updated. ${recon.invalid.length} item(s) moved to staging.`);
        }),
      });
      actions.push({
        label: 'Repack invalid',
        variant: 'primary',
        onClick: guarded(ctx, () => {
          const outcome = PackLibrary.repackInvalidPlacements(recon, ctx.nextTruck, ctx.caseLibrary);
          if (!outcome.failedIds.length) {
            const finalPlan = buildSafePreview(ctx, outcome.pack, []);
            if (finalPlan.failedIds.length) {
              throw new Error(`Could not safely stage ${finalPlan.failedIds.length} item(s). No changes were applied.`);
            }
            return commit(ctx, finalPlan.pack, `Truck updated. ${outcome.repackedIds.length} item(s) repacked.`);
          }
          ctx.inFlight = false;
          ctx.suppressRestoreOnce = true;
          showRemainingDecision(ctx, outcome);
          return true;
        }),
      });
    }

    showManagedModal(ctx, {
      title: 'Truck change',
      content: makeSummaryContent(recon, 'Changing the truck affects placed cases:'),
      actions,
    });
  }

  function request(options = {}) {
    const pack = options.pack;
    const nextTruck = options.nextTruck;
    if (!pack || !nextTruck) return { status: 'invalid-request' };
    if (active) {
      UIComponents.showToast('Finish the current truck change first.', 'warning', { title: 'Truck change' });
      return { status: 'busy' };
    }

    if (truckGeometryEqual(pack.truck, nextTruck)) {
      if (options.commitWhenUnchanged && typeof options.commit === 'function') {
        try {
          const committed = options.commit({ ...pack, truck: nextTruck, cases: pack.cases || [] });
          if (committed) {
            if (typeof options.onCommitted === 'function') options.onCommitted(committed);
            if (options.successMessage) {
              UIComponents.showToast(options.successMessage, 'success', { title: 'Truck' });
            }
          } else {
            UIComponents.showToast('Pack update could not be saved.', 'error', { title: 'Truck change' });
          }
          return { status: committed ? 'committed' : 'failed' };
        } catch (error) {
          UIComponents.showToast(error && error.message ? error.message : 'Pack update could not be saved.', 'error', { title: 'Truck change' });
          return { status: 'failed' };
        }
      }
      return { status: 'unchanged' };
    }

    let caseLibrary;
    let reconciliation;
    try {
      caseLibrary = CaseLibrary.getCases();
      reconciliation = (pack.cases || []).length
        ? PackLibrary.reconcilePlacementsForTruck(pack, nextTruck, caseLibrary)
        : null;
    } catch (error) {
      UIComponents.showToast(
        error && error.message ? error.message : 'Truck change could not be previewed.',
        'error',
        { title: 'Truck change' }
      );
      return { status: 'failed' };
    }
    const ctx = {
      pack,
      nextTruck,
      caseLibrary,
      commit: options.commit,
      onCommitted: options.onCommitted,
      restoreControls: options.restoreControls,
      renderPreview: options.renderPreview,
      successMessage: options.successMessage || 'Truck updated',
      committed: false,
      inFlight: false,
      suppressRestoreOnce: false,
      modalRef: null,
    };

    if (!(pack.cases || []).length) {
      try {
        commit(ctx, { ...pack, truck: nextTruck, cases: [] }, options.successMessage || 'Truck updated.');
        finishContext(ctx);
        return { status: 'committed' };
      } catch (error) {
        UIComponents.showToast(error.message, 'error', { title: 'Truck change' });
        if (typeof options.restoreControls === 'function') options.restoreControls();
        return { status: 'failed' };
      }
    }

    ctx.reconciliation = reconciliation;
    active = ctx;
    showPreview(ctx);
    return { status: 'preview', reconciliation: ctx.reconciliation };
  }

  return {
    request,
    isActive: () => Boolean(active),
    truckGeometryEqual,
  };
}
