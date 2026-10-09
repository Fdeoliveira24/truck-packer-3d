/**
 * @file oog-service.js
 * @description Out-of-Gauge (OOG) detection service for cargo exceeding truck bounds.
 * @module services/oog-service
 * @created 02/07/2026
 * @author Truck Packer 3D Team
 */

import { isCanonicalCaseMass } from '../core/cargo-canonical.js';
import { getActualPoseDimensions } from '../core/oriented-dims.js';

/**
 * @typedef {{ truck?: { length?: number, width?: number, height?: number }, cases?: Array<Record<string, any>> }} OOGPack
 */

/**
 * Computes pallet weight constraint warnings.
 * @param {OOGPack} pack - Pack object
 * @param {Record<string, any>[]} caseLibrary - Case definitions
 * @param {Set<string|null>|null} [loadedInstanceIds=null] - Canonical loaded IDs when available; direct callers exclude explicitly staged instances
 * @returns {object[]} Array of pallet warning objects
 */
export function computePalletWarnings(pack, caseLibrary, loadedInstanceIds = null) {
    if (!pack || !pack.cases) return [];

    const warnings = [];
    const caseMap = new Map(caseLibrary.map(c => [c.id, c]));
    const hasFinitePosition = position => Boolean(position) &&
        ['x', 'y', 'z'].every(axis => Number.isFinite(position[axis]));
    const isLoaded = inst => {
        if (!inst || inst.placement === 'staged') return false;
        if (!loadedInstanceIds || loadedInstanceIds.has(inst.id == null ? null : String(inst.id))) return true;
        // Missing Case/pose cannot prove a non-staged participant contributes no
        // pallet load. Keep payload incomplete rather than summing only resolved cargo.
        const caseData = caseMap.get(inst.caseId);
        return !caseData || !hasFinitePosition(inst.transform?.position) ||
            !getActualPoseDimensions(caseData, inst).valid;
    };

    // Find all pallets
    const pallets = pack.cases.filter(inst => {
        if (!isLoaded(inst)) return false;
        const caseData = caseMap.get(inst.caseId);
        return caseData?.isPallet === true;
    });

    pallets.forEach(pallet => {
        const palletCase = caseMap.get(pallet.caseId);
        if (!palletCase) return;

        const maxWeight = Number(palletCase.maxPalletWeight) || 0;
        if (maxWeight <= 0) return; // No weight limit

        const palletPos = pallet.transform?.position;
        const palletDims = getActualPoseDimensions(palletCase, pallet).value;
        const validPalletPose = Boolean(palletDims) && hasFinitePosition(palletPos);
        const palletTop = validPalletPose ? palletPos.y + palletDims.height / 2 : null;
        const palletHalfL = validPalletPose ? palletDims.length / 2 : null;
        const palletHalfW = validPalletPose ? palletDims.width / 2 : null;

        // Sum weight of loaded cases stacked above the pallet within its footprint
        let loadWeight = 0;
        let massComplete = validPalletPose;
        const loadedCases = [];

        pack.cases.forEach(inst => {
            if (!isLoaded(inst) || inst.id === pallet.id) return;
            if (!validPalletPose) return;
            const caseData = caseMap.get(inst.caseId);
            if (!caseData) { massComplete = false; return; }

            const pos = inst.transform?.position;
            const dims = getActualPoseDimensions(caseData, inst).value;
            if (!dims || !hasFinitePosition(pos)) { massComplete = false; return; }

            // Check if case is above pallet and within footprint
            const caseBottom = pos.y - dims.height / 2;
            if (caseBottom < palletTop) return; // Not above

            const overlapX = Math.abs(pos.x - palletPos.x) < (palletHalfL + dims.length / 2) * 0.8;
            const overlapZ = Math.abs(pos.z - palletPos.z) < (palletHalfW + dims.width / 2) * 0.8;

            if (overlapX && overlapZ) {
                if (caseData.weight == null || !isCanonicalCaseMass(caseData.weight)) massComplete = false;
                else loadWeight += caseData.weight;
                loadedCases.push(inst.id);
            }
        });

        if (!massComplete || loadWeight > maxWeight) {
            warnings.push({
                palletInstanceId: pallet.id,
                palletName: palletCase.name || 'Pallet',
                maxWeight,
                actualWeight: massComplete ? loadWeight : null,
                massComplete,
                overloadPercent: massComplete ? ((loadWeight - maxWeight) / maxWeight) * 100 : null,
                loadedCaseIds: loadedCases,
            });
        }
    });

    return warnings;
}
