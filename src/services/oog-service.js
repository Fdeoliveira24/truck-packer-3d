/**
 * @file oog-service.js
 * @description Out-of-Gauge (OOG) detection service for cargo exceeding truck bounds.
 * @module services/oog-service
 * @created 02/07/2026
 * @author Truck Packer 3D Team
 */

/**
 * Computes OOG warnings for cases that exceed truck dimensions.
 * @param {object} pack - Pack object with truck and cases
 * @param {object[]} caseLibrary - Array of case definitions
 * @returns {object[]} Array of warning objects
 */
export function computeOOGWarnings(pack, caseLibrary) {
    if (!pack || !pack.cases || !pack.truck) return [];

    const warnings = [];
    const truck = pack.truck;
    const truckL = Number(truck.length) || 0;
    const truckW = Number(truck.width) || 0;
    const truckH = Number(truck.height) || 0;
    const halfW = truckW / 2;

    const caseMap = new Map(caseLibrary.map(c => [c.id, c]));

    pack.cases.forEach(inst => {
        if (inst.hidden) return;
        const caseData = caseMap.get(inst.caseId);
        if (!caseData) return;

        const dims = caseData.dimensions || { length: 0, width: 0, height: 0 };
        const pos = inst.transform?.position || { x: 0, y: 0, z: 0 };

        const halfL = dims.length / 2;
        const halfH = dims.height / 2;
        const halfCW = dims.width / 2;

        const issues = [];

        // Check X bounds (length)
        if (pos.x - halfL < 0) issues.push('protrudesRear');
        if (pos.x + halfL > truckL) issues.push('protrudesFront');

        // Check Y bounds (height)
        if (pos.y - halfH < 0) issues.push('belowFloor');
        if (pos.y + halfH > truckH) issues.push('exceedsHeight');

        // Check Z bounds (width, centered at 0)
        if (pos.z - halfCW < -halfW) issues.push('protrudesLeft');
        if (pos.z + halfCW > halfW) issues.push('protrudesRight');

        if (issues.length > 0) {
            warnings.push({
                instanceId: inst.id,
                caseId: inst.caseId,
                caseName: caseData.name || 'Unknown',
                issues,
            });
        }
    });

    return warnings;
}

/**
 * Computes pallet weight constraint warnings.
 * @param {object} pack - Pack object
 * @param {object[]} caseLibrary - Case definitions
 * @returns {object[]} Array of pallet warning objects
 */
export function computePalletWarnings(pack, caseLibrary) {
    if (!pack || !pack.cases) return [];

    const warnings = [];
    const caseMap = new Map(caseLibrary.map(c => [c.id, c]));

    // Find all pallets
    const pallets = pack.cases.filter(inst => {
        if (inst.hidden) return false;
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

        // Sum weight of non-hidden cases stacked above the pallet within its footprint
        let loadWeight = 0;
        const loadedCases = [];

        pack.cases.forEach(inst => {
            if (inst.hidden || inst.id === pallet.id) return;
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
