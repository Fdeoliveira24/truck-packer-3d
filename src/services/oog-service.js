/**
 * @file oog-service.js
 * @description Out-of-Gauge (OOG) detection service for cargo exceeding truck bounds.
 * @module services/oog-service
 * @created 02/07/2026
 * @author Truck Packer 3D Team
 */

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
    const isLoaded = inst => inst && (loadedInstanceIds
        ? loadedInstanceIds.has(inst.id == null ? null : String(inst.id))
        : inst.placement !== 'staged');

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

        const palletPos = pallet.transform?.position || { x: 0, y: 0, z: 0 };
        const palletDims = palletCase.dimensions || { length: 0, width: 0, height: 0 };
        const palletTop = palletPos.y + palletDims.height / 2;
        const palletHalfL = palletDims.length / 2;
        const palletHalfW = palletDims.width / 2;

        // Sum weight of loaded cases stacked above the pallet within its footprint
        let loadWeight = 0;
        const loadedCases = [];

        pack.cases.forEach(inst => {
            if (!isLoaded(inst) || inst.id === pallet.id) return;
            const caseData = caseMap.get(inst.caseId);
            if (!caseData) return;

            const pos = inst.transform?.position || { x: 0, y: 0, z: 0 };
            const dims = caseData.dimensions || { length: 0, width: 0, height: 0 };

            // Check if case is above pallet and within footprint
            const caseBottom = pos.y - dims.height / 2;
            if (caseBottom < palletTop) return; // Not above

            const overlapX = Math.abs(pos.x - palletPos.x) < (palletHalfL + dims.length / 2) * 0.8;
            const overlapZ = Math.abs(pos.z - palletPos.z) < (palletHalfW + dims.width / 2) * 0.8;

            if (overlapX && overlapZ) {
                loadWeight += Number(caseData.weight) || 0;
                loadedCases.push(inst.id);
            }
        });

        if (loadWeight > maxWeight) {
            warnings.push({
                palletInstanceId: pallet.id,
                palletName: palletCase.name || 'Pallet',
                maxWeight,
                actualWeight: loadWeight,
                overloadPercent: ((loadWeight - maxWeight) / maxWeight) * 100,
                loadedCaseIds: loadedCases,
            });
        }
    });

    return warnings;
}
