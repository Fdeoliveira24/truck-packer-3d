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
      `${recon.summary.invalid} no longer fit`,
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
      const ids = [
        ...recon.unresolved.map(entry => `${entry.id} (${entry.name})`),
        ...recon.malformed.map(entry => `${entry.id} (${entry.reason})`),
      ];
      blocked.textContent = `Resolve or remove these items before changing the truck: ${ids.join(', ')}`;
      content.appendChild(blocked);
    }
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
    const content = documentRef.createElement('div');
    const summary = documentRef.createElement('div');
    summary.className = 'tp3d-editor-sub-sm';
    summary.textContent = `${outcome.repackedIds.length} item(s) can be repacked; ${outcome.failedIds.length} still do not fit.`;
    content.appendChild(summary);
    const failures = documentRef.createElement('div');
    failures.className = 'muted tp3d-editor-sub-sm';
    failures.textContent = `Still unresolved: ${outcome.failedIds.join(', ')}. No truck or cargo state has changed yet.`;
    content.appendChild(failures);

    showManagedModal(ctx, {
      title: 'Some items still do not fit',
      content,
      actions: [
        { label: 'Keep current truck and cancel' },
        {
          label: 'Move remaining items to staging',
          variant: 'primary',
          onClick: guarded(ctx, () => {
            const staged = PackLibrary.stagePlacementIds(
              outcome.pack,
              outcome.failedIds,
              ctx.nextTruck,
              ctx.caseLibrary
            );
            if (staged.failedIds.length) {
              throw new Error(`Could not safely stage ${staged.failedIds.length} item(s). No changes were applied.`);
            }
            return commit(
              ctx,
              staged.pack,
              `Truck updated. ${outcome.repackedIds.length} repacked and ${staged.stagedIds.length} moved to staging.`
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

    if (!blocked && recon.invalid.length === 0) {
      actions.push({
        label: 'Apply change',
        variant: 'primary',
        onClick: guarded(ctx, () => commit(
          ctx,
          recon.nextPack,
          recon.adjusted.length
            ? `${ctx.successMessage}. ${recon.adjusted.length} item(s) safely adjusted.`
            : ctx.successMessage
        )),
      });
    } else if (!blocked) {
      actions.push({
        label: 'Move to staging',
        onClick: guarded(ctx, () => {
          const staged = PackLibrary.stagePlacementIds(
            recon.nextPack,
            recon.invalid,
            ctx.nextTruck,
            ctx.caseLibrary
          );
          if (staged.failedIds.length) {
            throw new Error(`Could not safely stage ${staged.failedIds.length} item(s). No changes were applied.`);
          }
          return commit(ctx, staged.pack, `Truck updated. ${staged.stagedIds.length} item(s) moved to staging.`);
        }),
      });
      actions.push({
        label: 'Repack invalid',
        variant: 'primary',
        onClick: guarded(ctx, () => {
          const outcome = PackLibrary.repackInvalidPlacements(recon, ctx.nextTruck, ctx.caseLibrary);
          if (!outcome.failedIds.length) {
            return commit(ctx, outcome.pack, `Truck updated. ${outcome.repackedIds.length} item(s) repacked.`);
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
